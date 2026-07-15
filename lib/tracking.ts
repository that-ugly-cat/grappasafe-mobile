import * as Location from "expo-location";
import * as Notifications from "expo-notifications";
import * as TaskManager from "expo-task-manager";
import { Accelerometer } from "expo-sensors";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { sendGps, sendEmergency, GpsPayload } from "./api";

export const LOCATION_TASK = "grappasafe-location";
const GPS_INTERVAL_MS = 15_000;

// L'impatto lo decide il server, con una soglia per attività. L'app manda il
// PICCO di accelerazione dall'ultimo invio GPS (non l'istantaneo), così lo
// spike dell'urto non va perso tra un tick e l'altro.
let _lastAccel = { x: 0, y: 0, z: 1 };
let _accelPeak = 1.0; // picco |accel| in g dall'ultimo invio (1g = a riposo)
let _accelSub: ReturnType<typeof Accelerometer.addListener> | null = null;

export function startAccelerometer() {
  Accelerometer.setUpdateInterval(100);
  _accelSub = Accelerometer.addListener(({ x, y, z }) => {
    _lastAccel = { x, y, z };
    const mag = Math.sqrt(x * x + y * y + z * z);
    if (mag > _accelPeak) _accelPeak = mag;
  });
}

export function stopAccelerometer() {
  _accelSub?.remove();
  _accelSub = null;
}

function motionState(
  speed_ms: number | null,
  alt_m: number | null
): "STATIONARY" | "MOVING" | "FLYING" {
  if (speed_ms === null) return "STATIONARY";
  if (speed_ms > 5) return "FLYING"; // > 18 km/h
  if (speed_ms > 0.5) return "MOVING";
  return "STATIONARY";
}

// Il background task viene eseguito da expo-task-manager
TaskManager.defineTask(LOCATION_TASK, async ({ data, error }) => {
  if (error) return;
  const { locations } = data as { locations: Location.LocationObject[] };
  const loc = locations[locations.length - 1];
  if (!loc) return;

  const { latitude: lat, longitude: lon, altitude, speed } = loc.coords;
  const alt_m = altitude ?? null;
  const speed_ms = speed != null && speed >= 0 ? speed : null;

  const payload: GpsPayload = {
    lat,
    lon,
    alt_m,
    speed_ms,
    motion_state: motionState(speed_ms, alt_m),
    impact_detected: false, // l'impatto lo decide il server dal picco
    accel_magnitude: _accelPeak,
    battery_pct: null, // expo-battery opzionale, non incluso di default
    ts: new Date(loc.timestamp).toISOString(),
  };
  _accelPeak = 1.0; // apri una nuova finestra di picco per il prossimo invio

  try {
    const resp = await sendGps(payload);

    if (!resp) return;  // errore di rete — mantieni stato locale invariato

    if (resp.pending_emergency) {
      // Salva per il polling del tracking screen
      await AsyncStorage.setItem(
        "pending_emergency",
        JSON.stringify(resp.pending_emergency)
      );
      // Manda notifica locale solo al primo rilevamento (non ad ogni tick)
      const alreadyNotified = await AsyncStorage.getItem("pending_notif_id");
      if (!alreadyNotified) {
        const notifId = await Notifications.scheduleNotificationAsync({
          content: {
            title: "⚠️ GrappaSafe — Emergenza rilevata",
            body: "Apri l'app per rispondere. Hai 3 minuti prima che i soccorsi vengano allertati.",
            sound: true,
            priority: Notifications.AndroidNotificationPriority.MAX,
            data: {
              trigger:    resp.pending_emergency.trigger,
              expires_in: resp.pending_emergency.expires_in,
            },
          },
          trigger: null, // immediata
        });
        await AsyncStorage.setItem("pending_notif_id", notifId);
      }
    } else if (resp.pending_emergency === null) {
      // Server conferma: nessun pending attivo → pulizia locale
      const prev = await AsyncStorage.getItem("pending_emergency");
      if (prev) {
        await AsyncStorage.removeItem("pending_emergency");
        const notifId = await AsyncStorage.getItem("pending_notif_id");
        if (notifId) {
          await Notifications.dismissNotificationAsync(notifId);
          await AsyncStorage.removeItem("pending_notif_id");
        }
      }
    }
  } catch {
    // silenzioso — prossimo ciclo riprova
  }
});

export async function requestPermissions(): Promise<boolean> {
  const { status: fg } = await Location.requestForegroundPermissionsAsync();
  if (fg !== "granted") return false;
  const { status: bg } = await Location.requestBackgroundPermissionsAsync();
  return bg === "granted";
}

export async function startTracking(): Promise<void> {
  const granted = await requestPermissions();
  if (!granted) throw new Error("Permessi GPS non concessi");

  await Location.startLocationUpdatesAsync(LOCATION_TASK, {
    accuracy: Location.Accuracy.BestForNavigation,
    timeInterval: GPS_INTERVAL_MS,
    distanceInterval: 20,
    foregroundService: {
      notificationTitle: "GrappaSafe attivo",
      notificationBody: "Monitoraggio in corso",
      notificationColor: "#e63946",
    },
    pausesUpdatesAutomatically: false,
    showsBackgroundLocationIndicator: true,
  });

  startAccelerometer();
}

export async function stopTracking(): Promise<void> {
  const isRunning = await Location.hasStartedLocationUpdatesAsync(LOCATION_TASK);
  if (isRunning) {
    await Location.stopLocationUpdatesAsync(LOCATION_TASK);
  }
  stopAccelerometer();
}

export async function triggerEmergency(
  lat: number,
  lon: number,
  alt_m: number | null
): Promise<void> {
  await sendEmergency(lat, lon, alt_m);
}

export async function getCurrentPosition(): Promise<Location.LocationObject | null> {
  try {
    return await Location.getCurrentPositionAsync({
      accuracy: Location.Accuracy.High,
    });
  } catch {
    return null;
  }
}

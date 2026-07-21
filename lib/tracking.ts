import * as Location from "expo-location";
import * as Notifications from "expo-notifications";
import * as TaskManager from "expo-task-manager";
import { Accelerometer } from "expo-sensors";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { sendGps, sendEmergency, GpsPayload } from "./api";
import { loadSettings, loadAreaConfig } from "./store";

export const LOCATION_TASK = "grappasafe-location";
const GPS_INTERVAL_FALLBACK_MS = 15_000;
const OUT_OF_ZONE_RENOTIFY_MS = 5 * 60_000; // ri-avvisa al più ogni 5 minuti

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

function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371;
  const p1 = (lat1 * Math.PI) / 180;
  const p2 = (lat2 * Math.PI) / 180;
  const dp = ((lat2 - lat1) * Math.PI) / 180;
  const dl = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dp / 2) ** 2 +
    Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
  return R * 2 * Math.asin(Math.sqrt(a));
}

// Geofence "sei fuori zona". Confronta la posizione col cerchio monitorato
// (cache scritta da getConfig). Scrive un flag per il banner del tracking e,
// se abilitato, manda una notifica locale con debounce.
async function checkGeofence(lat: number, lon: number): Promise<void> {
  const area = await loadAreaConfig();
  if (!area) return; // area sconosciuta finché non arriva da /api/config
  const dist = haversineKm(lat, lon, area.area_lat, area.area_lon);
  const outside = dist > area.area_radius_km;

  await AsyncStorage.setItem("out_of_zone", outside ? "1" : "0");
  if (!outside) {
    await AsyncStorage.removeItem("out_of_zone_notified");
    return;
  }

  const settings = await loadSettings();
  if (!settings.outOfZoneAlerts) return;

  const last = await AsyncStorage.getItem("out_of_zone_notified");
  const now = Date.now();
  if (last && now - Number(last) < OUT_OF_ZONE_RENOTIFY_MS) return;

  await Notifications.scheduleNotificationAsync({
    content: {
      title: "⚠️ Fuori dalla zona monitorata",
      body: `Sei a ${dist.toFixed(1)} km dal centro (raggio ${area.area_radius_km} km). Il monitoraggio automatico potrebbe non coprirti.`,
      sound: true,
      priority: Notifications.AndroidNotificationPriority.HIGH,
    },
    trigger: null,
  });
  await AsyncStorage.setItem("out_of_zone_notified", String(now));
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

  // Geofence locale — indipendente dall'esito della rete.
  await checkGeofence(lat, lon);

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

  const settings = await loadSettings();

  await Location.startLocationUpdatesAsync(LOCATION_TASK, {
    accuracy: Location.Accuracy.BestForNavigation,
    timeInterval: settings.gpsIntervalMs ?? GPS_INTERVAL_FALLBACK_MS,
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
  // Stopping can reject even when hasStarted reports true: the task may be
  // registered under a stale app id (a reload in Expo Go changes the anonymous
  // app id), which surfaces as TaskNotFound. There is nothing to stop in that
  // case, so swallow it instead of leaking an unhandled rejection.
  try {
    if (await Location.hasStartedLocationUpdatesAsync(LOCATION_TASK)) {
      await Location.stopLocationUpdatesAsync(LOCATION_TASK);
    }
  } catch {
    // already gone / registered under a different app instance — ignore
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

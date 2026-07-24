import * as Location from "expo-location";
import * as Notifications from "expo-notifications";
import * as TaskManager from "expo-task-manager";
import { Accelerometer } from "expo-sensors";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { sendGps, sendEmergency, GpsPayload, GpsResponse, API_BASE } from "./api";
import {
  enqueueGps, flushGps, loadQueuedEmergency, clearQueuedEmergency,
  markEmergencyFailed, clearEmergencyFailed,
} from "./outbox";
import {
  acquireWakeLock, releaseWakeLock,
  hasNativeAccel, startNativeAccel, stopNativeAccel, getAndResetNativePeak,
  hasNativeSender, startNativeSender, stopNativeSender, isNativeSenderRunning,
  getNativeLastResponse,
} from "./wakelock";
import { loadSettings, loadAreaConfig, loadSession } from "./store";
import { t } from "./i18n";

export const LOCATION_TASK = "grappasafe-location";
const GPS_INTERVAL_FALLBACK_MS = 15_000;
const OUT_OF_ZONE_RENOTIFY_MS = 5 * 60_000; // ri-avvisa al più ogni 5 minuti

// L'impatto lo decide il server, con una soglia per attività. L'app manda il
// PICCO di accelerazione dall'ultimo invio GPS (non l'istantaneo), così lo
// spike dell'urto non va perso tra un tick e l'altro.
//
// Il picco lo accumula il modulo NATIVO (wakelock): expo-sensors si disiscrive
// dal sensore quando l'app va in background (schermo spento) — proprio lo
// scenario bersaglio. Il fallback JS via expo-sensors resta per Expo Go e
// build vecchi: funziona solo a schermo acceso.
let _accelStarted = false;
let _accelPeak = 1.0; // picco del fallback JS (1g = a riposo)
let _accelSub: ReturnType<typeof Accelerometer.addListener> | null = null;

export function startAccelerometer() {
  if (_accelStarted) return; // idempotente: non orfanare il listener già attivo
  _accelStarted = true;
  if (hasNativeAccel()) {
    startNativeAccel();
    return;
  }
  Accelerometer.setUpdateInterval(100);
  _accelSub = Accelerometer.addListener(({ x, y, z }) => {
    const mag = Math.sqrt(x * x + y * y + z * z);
    if (mag > _accelPeak) _accelPeak = mag;
  });
}

export function stopAccelerometer() {
  _accelStarted = false;
  stopNativeAccel();
  _accelSub?.remove();
  _accelSub = null;
  _accelPeak = 1.0;
}

/** Picco |accel| in g dall'ultimo prelievo; apre una nuova finestra. */
function takeAccelPeak(): number {
  if (hasNativeAccel()) return getAndResetNativePeak();
  const p = _accelPeak;
  _accelPeak = 1.0;
  return p;
}

// FLYING ha senso solo per le attività di volo: per un escursionista in auto
// (o un ciclista in discesa) sopra i 18 km/h dichiarare FLYING confonderebbe
// la macchina a stati del server.
const AIRBORNE = new Set(["PARAGLIDER", "HANGGLIDER"]);

function motionState(
  speed_ms: number | null,
  attivita: string
): "STATIONARY" | "MOVING" | "FLYING" {
  if (speed_ms === null) return "STATIONARY";
  if (AIRBORNE.has(attivita) && speed_ms > 5) return "FLYING"; // > 18 km/h
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
      title: t("notif.outOfZoneTitle"),
      body: t("notif.outOfZoneBody", { dist: dist.toFixed(1), radius: area.area_radius_km }),
      sound: true,
      priority: Notifications.AndroidNotificationPriority.HIGH,
    },
    // Canale HIGH dedicato (creato in _layout): sul canale default Android può
    // non suonare a schermo spento.
    trigger: { channelId: "alerts-v1" },
  });
  await AsyncStorage.setItem("out_of_zone_notified", String(now));
}

// Gestisce la risposta del server a un pin (sia live sia svuotato dalla coda):
// apre/chiude il pending d'emergenza + la notifica locale. Idempotente sulla
// notifica (una sola al primo rilevamento) così vale anche per punti arretrati.
async function handleGpsResponse(resp: GpsResponse): Promise<void> {
  if (resp.pending_emergency) {
    await AsyncStorage.setItem(
      "pending_emergency",
      JSON.stringify(resp.pending_emergency)
    );
    const alreadyNotified = await AsyncStorage.getItem("pending_notif_id");
    if (!alreadyNotified) {
      const notifId = await Notifications.scheduleNotificationAsync({
        content: {
          title: t("notif.emergencyTitle"),
          body: t("notif.emergencyBody"),
          sound: "alarm.wav", // iOS; su Android il suono lo dà il canale
          priority: Notifications.AndroidNotificationPriority.MAX,
          data: {
            trigger:    resp.pending_emergency.trigger,
            expires_in: resp.pending_emergency.expires_in,
          },
        },
        // Instrada sul canale "emergency-v3" (MAX + bypassDnd + suono sullo stream
        // sveglia): senza channelId la notifica finiva sul canale default, spesso
        // muto/basso; con lo stream sveglia si sente anche in silenzioso.
        trigger: { channelId: "emergency-v3" },
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
}

// Variante di handleGpsResponse per le risposte viste dal SENDER NATIVO: la
// notifica di pre-emergenza l'ha già postata (o ritirata) il nativo, qui si
// allinea solo lo stato locale che alimenta la schermata /alarm (il poll della
// mappa legge pending_emergency da AsyncStorage).
async function handleNativeResponse(resp: GpsResponse): Promise<void> {
  if (resp.pending_emergency) {
    await AsyncStorage.setItem(
      "pending_emergency",
      JSON.stringify(resp.pending_emergency)
    );
  } else if (resp.pending_emergency === null) {
    await AsyncStorage.removeItem("pending_emergency");
    // Un'eventuale notifica JS residua (posti misti vecchio/nuovo build):
    const notifId = await AsyncStorage.getItem("pending_notif_id");
    if (notifId) {
      await Notifications.dismissNotificationAsync(notifId).catch(() => {});
      await AsyncStorage.removeItem("pending_notif_id");
    }
  }
}

// Ritenta un SOS manuale rimasto in coda (assenza di rete al momento del tap).
// Safety-first: si riprova a ogni tick finché il server lo prende.
async function flushQueuedEmergency(): Promise<void> {
  const qe = await loadQueuedEmergency();
  if (!qe) return;
  const res = await sendEmergency(qe.lat, qe.lon, qe.alt_m);
  if (res.kind === "ok") {
    await clearQueuedEmergency();
    await clearEmergencyFailed();
  } else if (res.kind === "rejected" && res.status >= 400 && res.status < 500) {
    // 4xx = rifiuto permanente (es. sessione non valida): togli dalla coda e
    // ferma il loop. Ma segnala il fallimento col flag: l'overlay (se aperto)
    // ritenta lo stesso SOS in parallelo e, se il task vince la corsa svuotando
    // la coda, senza flag non vedrebbe mai il rifiuto → mostrerebbe "in attesa"
    // all'infinito. Col flag mostra l'errore chiunque consumi il rifiuto.
    // Flag PRIMA di svuotare: un poll dell'overlay che si interleava tra le due
    // vedrebbe altrimenti coda vuota + flag assente → potrebbe chiudersi in
    // silenzio. Con quest'ordine vede sempre o la coda (ritenta) o il flag.
    await markEmergencyFailed();
    await clearQueuedEmergency();
  }
  // network o 5xx (server giù, transitorio) → resta in coda, riprova: è il
  // backstop headless, non vogliamo perdere un SOS su un blip del server.
}

// Il background task. Le invocazioni sono SERIALIZZATE: su rete lenta expo può
// richiamare il task prima che il precedente abbia finito (le await di rete
// possono durare più dell'intervallo GPS), e due invocazioni concorrenti
// farebbero read-modify-write in conflitto sulla outbox (pin duplicati o persi)
// e sul reset di _accelPeak. La catena garantisce un'invocazione per volta, in
// ordine; il .catch tiene viva la catena anche se un giro lancia.
let _taskChain: Promise<void> = Promise.resolve();

TaskManager.defineTask(LOCATION_TASK, ({ data, error }) => {
  _taskChain = _taskChain.then(() => handleLocationUpdate(data, error)).catch(() => {});
  return _taskChain;
});

async function handleLocationUpdate(data: unknown, error: unknown): Promise<void> {
  if (error) return;

  // Auto-riparazione. startAccelerometer() gira solo in startTracking()
  // (contesto UI). Se Android ricicla il processo durante una sessione lunga
  // (schermo spento, telefono in tasca — lo scenario bersaglio), il task
  // riparte in un contesto HEADLESS con lo stato del modulo azzerato
  // (_accelStarted=false) e startTracking() NON viene rieseguito. Senza questo,
  // il listener non verrebbe mai riregistrato: ogni pin partirebbe con
  // accel_magnitude=1.0 → rilevamento impatto morto mentre il GPS continua a
  // scorrere (fallimento mascherato). Idempotente: nel caso normale è un no-op.
  if (!_accelStarted) startAccelerometer();
  // Il wake lock si ri-acquisisce a OGNI giro, non solo al ripristino: alcuni
  // OEM revocano i lock di lunga durata — così torna su al primo punto GPS.
  acquireWakeLock();

  // Heartbeat per la diagnostica: quando è girato l'ultimo task. Se a schermo
  // spento questo timestamp invecchia, la CPU sta dormendo (wake lock inerte).
  AsyncStorage.setItem("gs_last_tick", String(Date.now())).catch(() => {});

  // TUTTE le posizioni del batch, non solo l'ultima. In Doze/risparmio energia
  // Android consegna gli update in batch (anche hardware-batched): tenere solo
  // l'ultima buttava via i punti intermedi — la traccia sul server aveva buchi
  // esattamente nei periodi a schermo spento.
  const { locations } = data as { locations: Location.LocationObject[] };
  if (!locations?.length) return;
  const points = [...locations].sort((a, b) => a.timestamp - b.timestamp);

  const newest = points[points.length - 1];

  // Geofence locale sul punto più recente — indipendente dall'esito della rete.
  await checkGeofence(newest.coords.latitude, newest.coords.longitude).catch(() => {});

  // Col SENDER NATIVO attivo, il trasporto non passa di qui: questo task (che
  // Android congela a schermo spento e sveglia in raffica allo sblocco) fa solo
  // il lavoro di contorno — geofence (sopra), drenaggio della coda legacy,
  // retry del SOS, allineamento dello stato pending dalla risposta nativa.
  // Inviare anche da qui creerebbe punti duplicati sul server. NB: questo
  // return sta PRIMA di takeAccelPeak(): il picco lo consuma solo il sender.
  if (isNativeSenderRunning()) {
    try { await flushGps(sendGps, handleGpsResponse); } catch {}
    try { await flushQueuedEmergency(); } catch {}
    try {
      const raw = getNativeLastResponse();
      if (raw) await handleNativeResponse(JSON.parse(raw) as GpsResponse);
    } catch {}
    return;
  }

  // Il picco d'accelerazione copre la finestra dall'ultimo invio: va sul punto
  // più RECENTE del batch; per i punti arretrati non abbiamo il dettaglio
  // per-punto, quindi 1.0 (riposo) — meglio nessun falso impatto retrodatato.
  const peak = takeAccelPeak();
  const attivita = (await loadSession())?.attivita ?? "";

  const payloads: GpsPayload[] = points.map((loc, i) => {
    const { latitude: lat, longitude: lon, altitude, speed } = loc.coords;
    const alt_m = altitude ?? null;
    const speed_ms = speed != null && speed >= 0 ? speed : null;
    return {
      lat,
      lon,
      alt_m,
      speed_ms,
      motion_state: motionState(speed_ms, attivita),
      impact_detected: false, // l'impatto lo decide il server dal picco
      accel_magnitude: i === points.length - 1 ? peak : 1.0,
      battery_pct: null, // expo-battery opzionale, non incluso di default
      ts: new Date(loc.timestamp).toISOString(),
    };
  });

  // Ogni passo è isolato nel proprio try: prima erano in un unico blocco, e un
  // errore nello svuotamento della coda (passo 1) saltava anche l'invio del
  // punto corrente SENZA accodarlo → pin perso in silenzio.

  // 1. Svuota la coda offline PRIMA del punto nuovo (i pin vecchi hanno ts più
  //    vecchi: la macchina a stati server-side vuole timestamp monotoni). E
  //    ritenta un eventuale SOS manuale rimasto in coda.
  try { await flushGps(sendGps, handleGpsResponse); } catch {}
  try { await flushQueuedEmergency(); } catch {}

  // 2. Invia i punti del batch in ordine (sendGps non lancia mai: esiti
  //    tipizzati). Al primo errore di rete, questo e tutti i successivi vanno
  //    in coda (l'ordine dei ts resta monotono).
  try {
    for (let i = 0; i < payloads.length; i++) {
      const res = await sendGps(payloads[i]);
      if (res.kind === "network") {
        for (const p of payloads.slice(i)) await enqueueGps(p);
        return;
      }
      if (res.kind === "rejected") continue; // server raggiungibile ma rifiuta → scarta
      // Il punto è già consegnato: un errore nella gestione della risposta non
      // deve rimetterlo in coda (duplicato) né far cadere il giro.
      try { await handleGpsResponse(res.response); } catch {}
    }
  } catch {
    // silenzioso — prossimo ciclo riprova
  }
}

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
    // 0 = nessuna soglia di spostamento: i punti arrivano sul solo intervallo
    // di tempo anche da fermo. Con una soglia in metri (es. 20) Android
    // sopprimerebbe gli update quando il soggetto è immobile — proprio quando
    // servono di più (rilevamento immobilità + picco d'impatto viaggiano col GPS).
    distanceInterval: 0,
    // Nessun batching di consegna: senza questi espliciti a 0, il Fused
    // Location Provider può accumulare update e consegnarli in blocco (specie
    // in risparmio energia) — il monitoraggio live vuole un punto per volta.
    deferredUpdatesInterval: 0,
    deferredUpdatesDistance: 0,
    foregroundService: {
      notificationTitle: t("notif.trackingTitle"),
      notificationBody: t("notif.trackingBody"),
      notificationColor: "#e63946",
    },
    pausesUpdatesAutomatically: false,
    showsBackgroundLocationIndicator: true,
  });

  startAccelerometer();
  // CPU sveglia a schermo spento: senza, Android sospende l'accelerometro e
  // l'impatto col telefono in tasca sfugge. Rilasciato in stopTracking.
  acquireWakeLock();

  // Trasporto nativo: l'unico vivo a schermo spento (la consegna al task JS
  // passa da JobScheduler, congelato a schermo spento). Il task JS smette di
  // inviare finché il sender gira (vedi handleLocationUpdate).
  if (hasNativeSender()) {
    const cookie = (await AsyncStorage.getItem("session_cookie")) ?? "";
    const attivita = (await loadSession())?.attivita ?? "";
    startNativeSender({
      url: `${API_BASE}/api/gps`,
      cookie,
      intervalMs: settings.gpsIntervalMs ?? GPS_INTERVAL_FALLBACK_MS,
      attivita,
      notifTitle: t("notif.emergencyTitle"),
      notifBody: t("notif.emergencyBody"),
    });
  }
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
  stopNativeSender();
  stopAccelerometer();
  releaseWakeLock();
}

// Posizione per SOS/conferma emergenza. Un fix GPS a freddo può richiedere
// decine di secondi e getCurrentPositionAsync non ha timeout: un SOS non può
// aspettare. Corsa a 8s sul fix fresco; se perde, ultima posizione nota (≤5
// minuti — durante una sessione il task GPS la tiene freschissima); poi null.
const POSITION_TIMEOUT_MS = 8_000;

export async function getCurrentPosition(): Promise<Location.LocationObject | null> {
  try {
    const fresh = await Promise.race([
      Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High }),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), POSITION_TIMEOUT_MS)),
    ]);
    if (fresh) return fresh;
  } catch {
    /* GPS non disponibile: prova comunque l'ultima nota */
  }
  try {
    return await Location.getLastKnownPositionAsync({ maxAge: 5 * 60_000 });
  } catch {
    return null;
  }
}

import AsyncStorage from "@react-native-async-storage/async-storage";
import { GpsPayload, GpsSendResult, GpsResponse } from "./api";

// Outbox offline: se un pin (o un SOS) non parte per assenza di rete, non va
// perso — resta in coda locale e viene ri-inviato al primo contatto utile. I
// punti conservano il loro `ts`, così il server li piazza e li valuta al tempo
// giusto (traccia ricomposta, impatti/immobilità rilevati in ritardo ma non
// persi). Vanno svuotati IN ORDINE e prima del punto nuovo: la macchina a stati
// server-side assume timestamp monotoni.

const GPS_KEY = "gs_gps_outbox";
const EM_KEY = "gs_em_outbox";
// ~2 ore a 15s. Oltre, si scartano i più vecchi: in un buco così lungo i punti
// remoti hanno poco valore e non vogliamo far crescere lo storage all'infinito.
const GPS_CAP = 500;

async function loadGps(): Promise<GpsPayload[]> {
  const raw = await AsyncStorage.getItem(GPS_KEY);
  if (!raw) return [];
  try {
    return JSON.parse(raw) as GpsPayload[];
  } catch {
    return [];
  }
}

async function saveGps(q: GpsPayload[]): Promise<void> {
  if (q.length) await AsyncStorage.setItem(GPS_KEY, JSON.stringify(q));
  else await AsyncStorage.removeItem(GPS_KEY);
}

/** Accoda un pin non inviato (in coda ai più vecchi), scartando la testa se si
 *  supera il tetto. */
export async function enqueueGps(p: GpsPayload): Promise<void> {
  const q = await loadGps();
  q.push(p);
  if (q.length > GPS_CAP) q.splice(0, q.length - GPS_CAP);
  await saveGps(q);
}

export async function gpsOutboxSize(): Promise<number> {
  return (await loadGps()).length;
}

/**
 * Svuota la coda GPS in ordine (vecchi → nuovi) con `send`:
 *  - `network` → si ferma e conserva il resto (riproverà al prossimo giro);
 *  - `rejected` → scarta quel punto e prosegue (il server l'ha rifiutato);
 *  - `ok` → lo rimuove e passa la risposta a `onResponse` (per pending_emergency).
 * Ritorna true se la coda è completamente svuotata.
 */
export async function flushGps(
  send: (p: GpsPayload) => Promise<GpsSendResult>,
  onResponse: (r: GpsResponse) => Promise<void>
): Promise<boolean> {
  let q = await loadGps();
  while (q.length) {
    const res = await send(q[0]);
    if (res.kind === "network") {
      await saveGps(q);
      return false;
    }
    if (res.kind === "ok") {
      // Il punto è consegnato: un errore nel gestore della risposta (es. una
      // notifica che fallisce headless) non deve lasciare la testa in coda —
      // al giro dopo verrebbe ri-inviata (duplicato) o bloccherebbe il flush.
      try { await onResponse(res.response); } catch {}
    }
    // ok o rejected: la testa esce dalla coda
    q = q.slice(1);
    await saveGps(q);
  }
  return true;
}

// --- SOS manuale: un solo elemento in coda (l'emergenza è one-shot) ----------

export interface QueuedEmergency {
  lat: number;
  lon: number;
  alt_m: number | null;
}

export async function queueEmergency(e: QueuedEmergency): Promise<void> {
  await AsyncStorage.setItem(EM_KEY, JSON.stringify(e));
}

export async function loadQueuedEmergency(): Promise<QueuedEmergency | null> {
  const raw = await AsyncStorage.getItem(EM_KEY);
  return raw ? (JSON.parse(raw) as QueuedEmergency) : null;
}

export async function clearQueuedEmergency(): Promise<void> {
  await AsyncStorage.removeItem(EM_KEY);
}

// Flag "l'ultimo SOS è stato RIFIUTATO dal server" (4xx permanente). È il ponte
// tra il task di background e l'overlay: entrambi ritentano lo stesso SOS in
// coda, e se il task vince la corsa e svuota la coda su un 4xx (headless, senza
// UI), l'overlay non vedrebbe mai il rifiuto e resterebbe a mentire "in attesa"
// (o si chiuderebbe in silenzio). Con il flag, chiunque consumi il rifiuto lo
// segnala, e l'overlay mostra comunque l'errore. Va azzerato all'inizio di un
// nuovo SOS e quando c'è un'emergenza server-attiva (che non è un fallimento).
const EM_FAILED_KEY = "gs_em_failed";

export async function markEmergencyFailed(): Promise<void> {
  await AsyncStorage.setItem(EM_FAILED_KEY, "1");
}

export async function loadEmergencyFailed(): Promise<boolean> {
  return (await AsyncStorage.getItem(EM_FAILED_KEY)) === "1";
}

export async function clearEmergencyFailed(): Promise<void> {
  await AsyncStorage.removeItem(EM_FAILED_KEY);
}

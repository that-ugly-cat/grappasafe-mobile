import AsyncStorage from "@react-native-async-storage/async-storage";
import { t } from "./i18n";

export const API_BASE = "https://grappasafe.borant.eu";

// Timeout di rete. Su mobile una connessione può restare appesa senza mai
// risolvere (socket aperto, nessun dato). Senza abort, una richiesta bloccata
// terrebbe fermo il task GPS (e lo svuotamento della sua coda) a tempo
// indefinito. 15s = pari all'intervallo GPS: una richiesta stallata non tiene
// occupato il task più di un ciclo (poi il punto va in coda e si riprova).
const REQUEST_TIMEOUT_MS = 15_000;

async function fetchWithTimeout(url: string, options: RequestInit = {}): Promise<Response> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), REQUEST_TIMEOUT_MS);
  try {
    return await fetch(url, { ...options, signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
  }
}

/** Translate a server error: prefer the machine-readable `code` (mapped to an
 *  err.* i18n key), fall back to the server text, then a generic key. */
function serverError(data: { code?: string; error?: string }, fallbackKey: string): string {
  if (data?.code) return t("err." + data.code);
  return data?.error ?? t(fallbackKey);
}

export type Attivita =
  | "PARAGLIDER"
  | "HANGGLIDER"
  | "CYCLIST"
  | "CLIMBER"
  | "HIKER"
  | "RUNNER"
  | "OTHER_ON_GROUND";

export interface GpsPayload {
  lat: number;
  lon: number;
  alt_m: number | null;
  speed_ms: number | null;
  motion_state: "STATIONARY" | "MOVING" | "FLYING";
  impact_detected: boolean;
  accel_magnitude: number;
  battery_pct: number | null;
  ts: string;
}

async function request(
  path: string,
  options: RequestInit = {}
): Promise<Response> {
  const cookie = await AsyncStorage.getItem("session_cookie");
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(options.headers as Record<string, string>),
  };
  if (cookie) {
    headers["Cookie"] = cookie;
  }
  const res = await fetchWithTimeout(`${API_BASE}${path}`, { ...options, headers });

  // salva Set-Cookie se presente
  const setCookie = res.headers.get("set-cookie");
  if (setCookie) {
    const match = setCookie.match(/(session=[^;]+)/);
    if (match) await AsyncStorage.setItem("session_cookie", match[1]);
  }
  return res;
}

export async function login(
  username: string,
  password: string
): Promise<{ ok: boolean; error?: string }> {
  // Usa /api/login JSON — accetta tutti gli utenti, non solo admin.
  // La funzione request() gestisce automaticamente Set-Cookie.
  try {
    const res = await request("/api/login", {
      method: "POST",
      body: JSON.stringify({ username, password }),
    });
    if (res.ok) return { ok: true };
    const data = await res.json().catch(() => ({})) as { error?: string; code?: string };
    return { ok: false, error: serverError(data, "login.loginFailed") };
  } catch {
    return { ok: false, error: t("common.netError") };
  }
}

export async function logout(): Promise<void> {
  await request("/logout", { method: "POST" });
  await AsyncStorage.removeItem("session_cookie");
}


export async function startSession(
  attivita: Attivita
): Promise<{ session_id: number; state: string }> {
  const res = await request("/api/session/start", {
    method: "POST",
    body: JSON.stringify({ attivita }),
  });
  if (!res.ok) throw new Error(`startSession: ${res.status}`);
  return res.json();
}

export async function endSession(): Promise<void> {
  const res = await request("/api/session/end", { method: "POST" });
  if (!res.ok) throw new Error(`endSession: ${res.status}`);
}

export interface GpsResponse {
  sm_state:          string;
  db_state:          string;
  /** Presente se il server ha rilevato una condizione anomala e aspetta conferma.
   *  null se non c'è nulla di pending. */
  pending_emergency: { trigger: string; expires_in: number } | null;
}

// Esito distinto dell'invio di un pin: la outbox deve sapere se ritentare
// (rete assente) o scartare (il server ha risposto ma rifiuta, es. sessione
// finita → ritentare all'infinito sarebbe inutile).
export type GpsSendResult =
  | { kind: "ok"; response: GpsResponse }
  | { kind: "network" }
  | { kind: "rejected"; status: number };

export async function sendGps(payload: GpsPayload): Promise<GpsSendResult> {
  try {
    const res = await request("/api/gps", {
      method: "POST",
      body: JSON.stringify(payload),
    });
    if (res.ok) return { kind: "ok", response: await res.json() };
    return { kind: "rejected", status: res.status };
  } catch {
    return { kind: "network" };
  }
}

/** Utente conferma l'emergenza dal telefono (ha bisogno di aiuto). */
export async function confirmEmergency(
  lat: number,
  lon: number,
  alt_m: number | null
): Promise<void> {
  const res = await request("/api/emergency/confirm", {
    method: "POST",
    body: JSON.stringify({ lat, lon, alt_m }),
  });
  if (!res.ok) throw new Error(`confirmEmergency: ${res.status}`);
}

/** Utente segnala "sto bene" — cancella il pending senza aprire l'emergenza. */
export async function cancelEmergency(): Promise<void> {
  const res = await request("/api/session/ok", { method: "POST" });
  if (!res.ok) throw new Error(`cancelEmergency: ${res.status}`);
}

// Esito distinto dell'invio di un SOS, come per il GPS: la coda deve sapere se
// ritentare (rete assente) o smettere (il server ha risposto ma rifiuta →
// ritentare all'infinito è inutile e mente all'utente con "in attesa").
export type EmergencySendResult =
  | { kind: "ok"; message?: string }
  | { kind: "network" }
  | { kind: "rejected"; status: number };

/** Invia un SOS manuale. Il server gestisce sia il caso con sessione attiva
 *  sia senza. `ok` porta il messaggio da mostrare; `network` = rete assente
 *  (ritenta); `rejected` = server raggiungibile ma rifiuta (non ritentare). */
export async function sendEmergency(
  lat: number,
  lon: number,
  alt_m: number | null
): Promise<EmergencySendResult> {
  try {
    const res = await request("/api/emergency", {
      method: "POST",
      body: JSON.stringify({ lat, lon, alt_m }),
    });
    if (res.ok) {
      const data = (await res.json().catch(() => ({}))) as { message?: string };
      return { kind: "ok", message: data.message };
    }
    return { kind: "rejected", status: res.status };
  } catch {
    return { kind: "network" };
  }
}

export interface EmergencyStatus {
  active: boolean;
  emergency_id?: number;
  since?: string;
  /** true quando un operatore ha preso in carico l'emergenza. */
  acknowledged?: boolean;
  message: string;
}

/** Stato dell'emergenza dell'utente. L'app lo polla per tenere su l'overlay
 *  rosso finché il server non risolve. */
export async function emergencyStatus(): Promise<EmergencyStatus | null> {
  try {
    const res = await request("/api/emergency/status");
    if (!res.ok) return null;
    return res.json();
  } catch {
    return null;
  }
}

export interface SessionStatus {
  active:      boolean;
  session_id?: number;
  attivita?:   string;
  state?:      string;
}

/** Verifica se la sessione è ancora attiva sul server. */
export async function getSessionStatus(): Promise<SessionStatus | null> {
  try {
    const res = await request("/api/session/status");
    if (!res.ok) return null;
    return res.json();
  } catch {
    return null;
  }
}

export interface AreaConfig {
  area_lat: number;
  area_lon: number;
  area_radius_km: number;
}

/** Configurazione dal server: il cerchio monitorato (centro + raggio).
 *  L'app non hardcoda l'area, la legge da qui e la cachea. */
export async function getConfig(): Promise<AreaConfig | null> {
  try {
    const res = await request("/api/config");
    if (!res.ok) return null;
    return res.json();
  } catch {
    return null;
  }
}

export interface LiveMap {
  active: boolean;
  track?: { lat: number; lon: number }[];
  latest?: { lat: number; lon: number } | null;
}

/** Mappa live pubblica: la traccia della sessione attiva, via lo share_token.
 *  È lo stesso endpoint che alimenta il link condivisibile. */
export async function getLiveMap(shareToken: string): Promise<LiveMap | null> {
  try {
    const res = await fetchWithTimeout(`${API_BASE}/api/map/${shareToken}`);
    if (!res.ok) return null;
    return res.json();
  } catch {
    return null;
  }
}

export interface Profile {
  id: number;
  username: string;
  nome: string;
  cognome: string;
  is_admin: boolean;
  share_token: string;
  telefono: string;
  gruppo_sanguigno: string;
  emergenza_contatto: string;
  emergenza_telefono: string;
  note_salute: string;
  data_nascita: string;
  email: string;
  lingua: string;
}

// Esito del check di autenticazione all'avvio. Distinguere "sessione scaduta"
// da "rete assente" è vitale: in montagna senza segnale l'app deve comunque
// aprire mappa e SOS con l'utente in cache, non buttare al login (dove offline
// non si può fare nulla).
export type AuthCheck = "ok" | "unauthorized" | "network";

export async function checkAuth(): Promise<AuthCheck> {
  try {
    const res = await request("/api/me");
    if (res.status === 401) return "unauthorized";
    // Anche un 5xx passa: un errore del server non deve sloggare l'utente.
    return "ok";
  } catch {
    return "network";
  }
}

export async function getMe(): Promise<Profile | null> {
  try {
    const res = await request("/api/me");
    if (res.status === 401) return null;
    return res.json();
  } catch {
    return null;
  }
}

export interface Device {
  id: number;
  display_name: string;
  ogn_id: string | null;
  activity: string | null;
  color: string;
}

/** I device/vele dell'utente (nome + eventuale ID OGN/FLARM). */
export async function getDevices(): Promise<Device[]> {
  try {
    const res = await request("/api/me/devices");
    if (!res.ok) return [];
    return res.json();
  } catch {
    return [];
  }
}

export async function saveDevice(
  d: { display_name: string; ogn_id?: string },
  id?: number
): Promise<boolean> {
  try {
    const res = await request(id ? `/api/me/devices/${id}` : "/api/me/devices", {
      method: id ? "PUT" : "POST",
      body: JSON.stringify(d),
    });
    return res.ok;
  } catch {
    return false;
  }
}

export async function deleteDevice(id: number): Promise<boolean> {
  try {
    const res = await request(`/api/me/devices/${id}`, { method: "DELETE" });
    return res.ok;
  } catch {
    return false;
  }
}

// ── Inoltro dati a sistemi terzi ────────────────────────────────────────────
// L'inoltro lo fa il SERVER, non l'app: il trasporto vivo a schermo spento è il
// sender nativo, che parla solo con /api/gps, e un secondo giro di rete dal
// telefono costerebbe batteria per niente. Qui si configura solo il "dove".

export interface ForwardTarget {
  id: number;
  name: string;
  url: string;
  /** Ultime 4 cifre del token, o null se non ce n'è uno. Il token per intero
   *  non torna mai indietro dal server: viaggia solo quando lo si scrive. */
  token_hint: string | null;
  enabled: number;
  min_interval_s: number;
  last_ok_at: string | null;
  last_error: string | null;
  last_error_at: string | null;
}

export async function getForwardTargets(): Promise<ForwardTarget[]> {
  try {
    const res = await request("/api/me/forward-targets");
    if (!res.ok) return [];
    return res.json();
  } catch {
    return [];
  }
}

/** Crea o aggiorna un target. `token` si manda **solo** quando l'utente lo
 *  scrive: ometterlo lascia intatto quello salvato (il server non lo restituisce
 *  mai, quindi il client non può rimandarlo indietro per sbaglio). */
export async function saveForwardTarget(
  target: { name: string; url: string; token?: string; enabled?: boolean },
  id?: number
): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await request(
      id ? `/api/me/forward-targets/${id}` : "/api/me/forward-targets",
      { method: id ? "PUT" : "POST", body: JSON.stringify(target) }
    );
    if (res.ok) return { ok: true };
    const data = (await res.json().catch(() => ({}))) as { error?: string; code?: string };
    return { ok: false, error: serverError(data, "settings.forwardSaveError") };
  } catch {
    return { ok: false, error: t("common.netError") };
  }
}

export async function deleteForwardTarget(id: number): Promise<boolean> {
  try {
    const res = await request(`/api/me/forward-targets/${id}`, { method: "DELETE" });
    return res.ok;
  } catch {
    return false;
  }
}

/** Handshake verso il sistema terzo: dice subito se il token è quello giusto,
 *  invece di scoprirlo dopo un volo che nessuno ha visto. */
export async function testForwardTarget(
  id: number
): Promise<{ ok: boolean; message?: string }> {
  try {
    const res = await request(`/api/me/forward-targets/${id}/test`, { method: "POST" });
    if (!res.ok) return { ok: false, message: `HTTP ${res.status}` };
    return res.json();
  } catch {
    return { ok: false, message: t("common.netError") };
  }
}

/** Aggiorna i campi profilo modificabili dall'utente (self-service). */
export async function updateMe(
  profile: Partial<Omit<Profile, "id" | "username" | "is_admin">>
): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await request("/api/me", {
      method: "PUT",
      body: JSON.stringify(profile),
    });
    if (res.ok) return { ok: true };
    const data = (await res.json().catch(() => ({}))) as { error?: string; code?: string };
    return { ok: false, error: serverError(data, "settings.profileSaveError") };
  } catch {
    return { ok: false, error: t("common.netError") };
  }
}

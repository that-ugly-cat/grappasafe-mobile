import AsyncStorage from "@react-native-async-storage/async-storage";

export const API_BASE = "https://grappasafe.borant.eu";

export type Attivita =
  | "PARAGLIDER"
  | "HANGGLIDER"
  | "GLIDER"
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
  const res = await fetch(`${API_BASE}${path}`, { ...options, headers });

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
    const data = await res.json().catch(() => ({})) as { error?: string };
    return { ok: false, error: data.error ?? "Credenziali non valide" };
  } catch {
    return { ok: false, error: "Errore di rete" };
  }
}

export async function logout(): Promise<void> {
  await request("/logout", { method: "POST" });
  await AsyncStorage.removeItem("session_cookie");
}

export interface RegisterPayload {
  username: string;
  password: string;
  nome: string;
  cognome: string;
  telefono?: string;
  gruppo_sanguigno?: string;
  emergenza_contatto?: string;
  emergenza_telefono?: string;
}

/** Auto-registrazione pubblica. In caso di successo il server logga già
 *  l'utente (Set-Cookie), quindi la sessione è pronta come dopo il login. */
export async function register(
  payload: RegisterPayload
): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await request("/api/register", {
      method: "POST",
      body: JSON.stringify(payload),
    });
    if (res.ok) return { ok: true };
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    return { ok: false, error: data.error ?? "Registrazione non riuscita" };
  } catch {
    return { ok: false, error: "Errore di rete" };
  }
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

export async function sendGps(payload: GpsPayload): Promise<GpsResponse | null> {
  try {
    const res = await request("/api/gps", {
      method: "POST",
      body: JSON.stringify(payload),
    });
    if (!res.ok) return null;
    return res.json();
  } catch {
    return null;
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

/** Invia un SOS manuale. Il server gestisce sia il caso con sessione attiva
 *  sia senza. Ritorna il messaggio da mostrare all'utente (se presente). */
export async function sendEmergency(
  lat: number,
  lon: number,
  alt_m: number | null
): Promise<{ message?: string }> {
  const res = await request("/api/emergency", {
    method: "POST",
    body: JSON.stringify({ lat, lon, alt_m }),
  });
  if (!res.ok) throw new Error(`sendEmergency: ${res.status}`);
  return (await res.json().catch(() => ({}))) as { message?: string };
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
    const res = await fetch(`${API_BASE}/api/map/${shareToken}`);
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
  lingua: string;
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

/** Aggiorna i campi profilo modificabili dall'utente (self-service). */
export async function updateMe(
  profile: Partial<Omit<Profile, "id" | "username" | "is_admin">>
): Promise<boolean> {
  try {
    const res = await request("/api/me", {
      method: "PUT",
      body: JSON.stringify(profile),
    });
    return res.ok;
  } catch {
    return false;
  }
}

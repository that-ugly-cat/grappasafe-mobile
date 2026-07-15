import AsyncStorage from "@react-native-async-storage/async-storage";

export const API_BASE = "https://grappasafe.borant.eu";

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

export async function sendEmergency(
  lat: number,
  lon: number,
  alt_m: number | null
): Promise<void> {
  const res = await request("/api/emergency", {
    method: "POST",
    body: JSON.stringify({ lat, lon, alt_m }),
  });
  if (!res.ok) throw new Error(`sendEmergency: ${res.status}`);
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

export async function getMe(): Promise<{
  id: number;
  username: string;
  nome: string;
  cognome: string;
  is_admin: boolean;
} | null> {
  try {
    const res = await request("/api/me");
    if (res.status === 401) return null;
    return res.json();
  } catch {
    return null;
  }
}

import AsyncStorage from "@react-native-async-storage/async-storage";
import { AreaConfig } from "./api";

const KEYS = {
  USER: "gs_user",
  SESSION: "gs_session",
  SETTINGS: "gs_settings",
  AREA: "gs_area",
  PAUSED: "gs_paused",
};

export interface Settings {
  /** Intervallo di aggiornamento dei pin GPS, in ms. */
  gpsIntervalMs: number;
  /** Avvisa l'utente quando esce dal cerchio monitorato. */
  outOfZoneAlerts: boolean;
  /** Usa le tile locali (offline) invece di OpenTopoMap online. */
  mapOffline: boolean;
}

export const GPS_INTERVAL_MIN_MS = 5_000;
export const GPS_INTERVAL_MAX_MS = 60_000;

export const DEFAULT_SETTINGS: Settings = {
  gpsIntervalMs: 15_000,
  outOfZoneAlerts: true,
  mapOffline: false,
};

export async function saveEmergencyMessage(msg: string) {
  if (msg) await AsyncStorage.setItem("gs_em_msg", msg);
}

/** The last server-provided emergency message, or null if none cached yet.
 * The caller falls back to a translated default (see i18n emergency.fallbackMsg). */
export async function loadEmergencyMessage(): Promise<string | null> {
  return (await AsyncStorage.getItem("gs_em_msg")) || null;
}

export async function loadSettings(): Promise<Settings> {
  const raw = await AsyncStorage.getItem(KEYS.SETTINGS);
  if (!raw) return DEFAULT_SETTINGS;
  try {
    return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export async function saveSettings(settings: Settings) {
  await AsyncStorage.setItem(KEYS.SETTINGS, JSON.stringify(settings));
}

/** Cache dell'area monitorata (centro + raggio), scritta da getConfig().
 *  Serve al geofence nel task in background, che non può fare fetch sincroni. */
export async function saveAreaConfig(area: AreaConfig) {
  await AsyncStorage.setItem(KEYS.AREA, JSON.stringify(area));
}

export async function loadAreaConfig(): Promise<AreaConfig | null> {
  const raw = await AsyncStorage.getItem(KEYS.AREA);
  return raw ? JSON.parse(raw) : null;
}

export interface StoredUser {
  id: number;
  username: string;
  nome: string;
  cognome: string;
  is_admin: boolean;
}

export interface StoredSession {
  session_id: number;
  state: string;
  attivita: string;
  started_at: string;
}

export async function saveUser(user: StoredUser) {
  await AsyncStorage.setItem(KEYS.USER, JSON.stringify(user));
}

export async function loadUser(): Promise<StoredUser | null> {
  const raw = await AsyncStorage.getItem(KEYS.USER);
  return raw ? JSON.parse(raw) : null;
}

export async function clearUser() {
  await AsyncStorage.removeItem(KEYS.USER);
  await AsyncStorage.removeItem("session_cookie");
}

export async function saveSession(session: StoredSession) {
  await AsyncStorage.setItem(KEYS.SESSION, JSON.stringify(session));
}

export async function loadSession(): Promise<StoredSession | null> {
  const raw = await AsyncStorage.getItem(KEYS.SESSION);
  return raw ? JSON.parse(raw) : null;
}

export async function clearSession() {
  await AsyncStorage.removeItem(KEYS.SESSION);
  await AsyncStorage.removeItem(KEYS.PAUSED);
}

// Stato "tracking in pausa". Il task di localizzazione (e la sessione) vivono
// oltre un riavvio dell'app, ma lo stato React no: senza persistenza, dopo un
// riavvio in pausa la UI mostrerebbe "live" con il GPS fermo.
export async function savePaused(paused: boolean) {
  if (paused) await AsyncStorage.setItem(KEYS.PAUSED, "1");
  else await AsyncStorage.removeItem(KEYS.PAUSED);
}

export async function loadPaused(): Promise<boolean> {
  return (await AsyncStorage.getItem(KEYS.PAUSED)) === "1";
}

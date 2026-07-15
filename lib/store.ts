import AsyncStorage from "@react-native-async-storage/async-storage";

const KEYS = {
  USER: "gs_user",
  SESSION: "gs_session",
};

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
}

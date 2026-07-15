import { useEffect, useState } from "react";
import {
  View, Text, TouchableOpacity, StyleSheet, Alert,
} from "react-native";
import { router } from "expo-router";
import { logout } from "../lib/api";
import { loadUser, clearUser, clearSession } from "../lib/store";

export default function DashboardScreen() {
  const [user, setUser] = useState<{ nome: string; cognome: string; username: string } | null>(null);

  useEffect(() => {
    loadUser().then(setUser);
  }, []);

  async function handleLogout() {
    await logout();
    await clearUser();
    await clearSession();
    router.replace("/login");
  }

  return (
    <View style={s.container}>
      <View style={s.header}>
        <Text style={s.welcome}>
          Ciao, {user?.nome || user?.username || "—"}
        </Text>
        <Text style={s.subtitle}>Pronto per una nuova uscita?</Text>
      </View>

      <TouchableOpacity
        style={s.bigBtn}
        onPress={() => router.push("/activity")}
      >
        <Text style={s.bigBtnIcon}>🚀</Text>
        <Text style={s.bigBtnText}>Inizia sessione</Text>
      </TouchableOpacity>

      <TouchableOpacity style={s.logoutBtn} onPress={handleLogout}>
        <Text style={s.logoutText}>Esci</Text>
      </TouchableOpacity>
    </View>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#0f0f1a", padding: 24 },
  header: { marginTop: 40, marginBottom: 48 },
  welcome: { fontSize: 26, color: "#fff", fontWeight: "bold" },
  subtitle: { fontSize: 14, color: "#888", marginTop: 4 },
  bigBtn: {
    backgroundColor: "#1e1e30", borderRadius: 16, padding: 32,
    alignItems: "center", borderWidth: 2, borderColor: "#e63946",
  },
  bigBtnIcon: { fontSize: 48, marginBottom: 12 },
  bigBtnText: { color: "#e63946", fontSize: 22, fontWeight: "bold" },
  logoutBtn: { marginTop: "auto", padding: 16, alignItems: "center" },
  logoutText: { color: "#555", fontSize: 14 },
});

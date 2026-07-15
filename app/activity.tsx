import { useState } from "react";
import {
  View, Text, TouchableOpacity, StyleSheet, Alert, ScrollView,
} from "react-native";
import { router } from "expo-router";
import { startSession, Attivita } from "../lib/api";
import { saveSession } from "../lib/store";
import { startTracking } from "../lib/tracking";

const ACTIVITIES: { id: Attivita; label: string; icon: string }[] = [
  { id: "PARAGLIDER",      label: "Parapendio",    icon: "🪂" },
  { id: "HANGGLIDER",      label: "Deltaplano",    icon: "🦅" },
  { id: "CYCLIST",         label: "Ciclismo",      icon: "🚴" },
  { id: "CLIMBER",         label: "Arrampicata",   icon: "🧗" },
  { id: "HIKER",           label: "Escursionismo", icon: "🥾" },
  { id: "RUNNER",          label: "Corsa",         icon: "🏃" },
  { id: "OTHER_ON_GROUND", label: "Altro",         icon: "🏕" },
];

export default function ActivityScreen() {
  const [selected, setSelected] = useState<Attivita | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleStart() {
    if (!selected) {
      Alert.alert("Seleziona un'attività");
      return;
    }
    setLoading(true);
    try {
      const { session_id, state } = await startSession(selected);
      await saveSession({
        session_id,
        state,
        attivita: selected,
        started_at: new Date().toISOString(),
      });
      await startTracking();
      router.replace("/tracking");
    } catch (e: any) {
      Alert.alert("Errore", e.message ?? "Impossibile avviare la sessione");
    } finally {
      setLoading(false);
    }
  }

  return (
    <View style={s.container}>
      <Text style={s.title}>Cosa stai facendo?</Text>
      <ScrollView contentContainerStyle={s.grid}>
        {ACTIVITIES.map((a) => (
          <TouchableOpacity
            key={a.id}
            style={[s.card, selected === a.id && s.cardSelected]}
            onPress={() => setSelected(a.id)}
          >
            <Text style={s.icon}>{a.icon}</Text>
            <Text style={[s.label, selected === a.id && s.labelSelected]}>
              {a.label}
            </Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      <TouchableOpacity
        style={[s.startBtn, (!selected || loading) && s.startBtnDisabled]}
        onPress={handleStart}
        disabled={!selected || loading}
      >
        <Text style={s.startBtnText}>
          {loading ? "Avvio..." : "Inizia monitoraggio"}
        </Text>
      </TouchableOpacity>
    </View>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#0f0f1a", padding: 24 },
  title: { fontSize: 22, color: "#fff", fontWeight: "bold", marginBottom: 24 },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 12 },
  card: {
    width: "46%", backgroundColor: "#1e1e30", borderRadius: 12,
    padding: 20, alignItems: "center", borderWidth: 2, borderColor: "#333",
  },
  cardSelected: { borderColor: "#e63946", backgroundColor: "#2a1a1f" },
  icon: { fontSize: 36, marginBottom: 8 },
  label: { color: "#aaa", fontSize: 14, textAlign: "center" },
  labelSelected: { color: "#e63946", fontWeight: "bold" },
  startBtn: {
    marginTop: 24, backgroundColor: "#e63946", borderRadius: 12,
    padding: 18, alignItems: "center",
  },
  startBtnDisabled: { opacity: 0.4 },
  startBtnText: { color: "#fff", fontSize: 18, fontWeight: "bold" },
});

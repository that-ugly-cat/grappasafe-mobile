import { useState } from "react";
import {
  Modal, View, Text, TouchableOpacity, ScrollView,
  StyleSheet, Alert, ActivityIndicator,
} from "react-native";
import { startSession, Attivita } from "../lib/api";
import { saveSession } from "../lib/store";
import { startTracking } from "../lib/tracking";
import { useT } from "../lib/i18n";

const ACTIVITIES: Attivita[] = [
  "PARAGLIDER", "HANGGLIDER", "CYCLIST", "CLIMBER", "HIKER", "RUNNER", "OTHER_ON_GROUND",
];

interface Props {
  visible: boolean;
  onClose: () => void;
  /** Chiamato quando la sessione è partita (server + tracking avviati). */
  onStarted: (attivita: Attivita) => void;
}

export default function ActivityModal({ visible, onClose, onStarted }: Props) {
  const t = useT();
  const [loading, setLoading] = useState<Attivita | null>(null);

  async function pick(a: Attivita) {
    setLoading(a);
    try {
      const { session_id, state } = await startSession(a);
      await saveSession({
        session_id,
        state,
        attivita: a,
        started_at: new Date().toISOString(),
      });
      await startTracking();
      onStarted(a);
    } catch (e: any) {
      Alert.alert(t("common.error"), t("activity.cannotStart"));
    } finally {
      setLoading(null);
    }
  }

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={s.backdrop}>
        <View style={s.sheet}>
          <View style={s.handle} />
          <Text style={s.title}>{t("activity.title")}</Text>
          <ScrollView contentContainerStyle={s.grid}>
            {ACTIVITIES.map((a) => {
              const busy = loading === a;
              return (
                <TouchableOpacity
                  key={a}
                  style={[s.card, busy && s.cardBusy]}
                  onPress={() => pick(a)}
                  disabled={loading !== null}
                >
                  {busy ? (
                    <ActivityIndicator color="#e63946" />
                  ) : (
                    <Text style={s.label}>{t("act." + a)}</Text>
                  )}
                </TouchableOpacity>
              );
            })}
          </ScrollView>
          <TouchableOpacity style={s.cancel} onPress={onClose} disabled={loading !== null}>
            <Text style={s.cancelText}>{t("common.cancel")}</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

const s = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.6)", justifyContent: "flex-end" },
  sheet: {
    backgroundColor: "#12121f", borderTopLeftRadius: 20, borderTopRightRadius: 20,
    padding: 20, paddingBottom: 32, maxHeight: "80%",
  },
  handle: { width: 40, height: 4, borderRadius: 2, backgroundColor: "#333", alignSelf: "center", marginBottom: 16 },
  title: { fontSize: 20, color: "#fff", fontWeight: "bold", marginBottom: 18 },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 12 },
  card: {
    width: "47%", backgroundColor: "#1e1e30", borderRadius: 12,
    paddingVertical: 22, alignItems: "center", borderWidth: 1, borderColor: "#333",
    minHeight: 96, justifyContent: "center",
  },
  cardBusy: { borderColor: "#e63946" },
  label: { color: "#eee", fontSize: 17, textAlign: "center", fontWeight: "600" },
  cancel: { marginTop: 16, padding: 14, alignItems: "center" },
  cancelText: { color: "#888", fontSize: 15 },
});

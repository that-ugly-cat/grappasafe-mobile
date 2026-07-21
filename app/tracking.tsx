import { useEffect, useRef, useState } from "react";
import {
  View, Text, TouchableOpacity, StyleSheet, Alert,
  Animated, Vibration, AppState,
} from "react-native";
import { router } from "expo-router";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { endSession, cancelEmergency, getSessionStatus, AreaConfig } from "../lib/api";
import { stopTracking, triggerEmergency, getCurrentPosition } from "../lib/tracking";
import { loadSession, clearSession, loadUser, loadAreaConfig } from "../lib/store";
import { isMapDownloaded } from "../lib/tiles";
import SafeMap from "../components/SafeMap";

const HOLD_MS = 3000;

export default function TrackingScreen() {
  const [session, setSession] = useState<{
    attivita: string; started_at: string; session_id: number;
  } | null>(null);
  const [elapsed, setElapsed] = useState("00:00");
  const [emergencySent, setEmergencySent] = useState(false);
  const [pauseMsg, setPauseMsg] = useState<string | null>(null);
  const [area, setArea] = useState<AreaConfig | null>(null);
  const [offlineReady, setOfflineReady] = useState(false);
  const [outOfZone, setOutOfZone] = useState(false);
  const holdProgress = useRef(new Animated.Value(0)).current;
  const holdAnim = useRef<Animated.CompositeAnimation | null>(null);
  const holdActive = useRef(false);

  useEffect(() => {
    loadSession().then(setSession);
    loadAreaConfig().then(setArea);
    isMapDownloaded().then(setOfflineReady);
  }, []);

  // Legge il flag geofence scritto dal task background per il banner "fuori zona".
  useEffect(() => {
    async function readZone() {
      const v = await AsyncStorage.getItem("out_of_zone");
      setOutOfZone(v === "1");
    }
    readZone();
    const id = setInterval(readZone, 5_000);
    return () => clearInterval(id);
  }, []);

  // Fix #5 — verifica che la sessione sia ancora viva sul server al mount.
  // Necessario dopo riavvii del server o interruzioni di rete prolungate.
  useEffect(() => {
    async function verifySession() {
      try {
        const status = await getSessionStatus();
        if (status !== null && !status.active) {
          await clearSession();
          router.replace("/dashboard");
        }
      } catch { /* errore di rete — non bloccare, il GPS gestirà i 404 */ }
    }
    verifySession();
  }, []);

  // Polling per emergenza pending: il background task scrive in AsyncStorage
  // quando riceve pending_emergency dalla risposta GPS.
  // Intervallo: 5s — abbastanza reattivo, non aggressivo.
  useEffect(() => {
    async function checkPending() {
      try {
        const raw = await AsyncStorage.getItem("pending_emergency");
        if (raw) {
          const pending = JSON.parse(raw) as { trigger: string; expires_in: number };
          router.push({
            pathname: "/alarm",
            params: {
              trigger:    pending.trigger,
              expires_in: String(pending.expires_in),
            },
          });
        }
      } catch { /* ignore */ }
    }
    checkPending(); // check immediato al mount
    const id = setInterval(checkPending, 5_000);
    return () => clearInterval(id);
  }, []);

  // timer elapsed
  useEffect(() => {
    if (!session) return;
    const start = new Date(session.started_at).getTime();
    const id = setInterval(() => {
      const diff = Math.floor((Date.now() - start) / 1000);
      const h = Math.floor(diff / 3600);
      const m = Math.floor((diff % 3600) / 60);
      const s = diff % 60;
      setElapsed(
        h > 0
          ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`
          : `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`
      );
    }, 1000);
    return () => clearInterval(id);
  }, [session]);

  function onEmergencyPressIn() {
    holdActive.current = true;
    holdAnim.current = Animated.timing(holdProgress, {
      toValue: 1,
      duration: HOLD_MS,
      useNativeDriver: false,
    });
    holdAnim.current.start(async ({ finished }) => {
      if (finished && holdActive.current) {
        Vibration.vibrate([0, 200, 100, 200]);
        await fireEmergency();
      }
    });
  }

  function onEmergencyPressOut() {
    holdActive.current = false;
    holdAnim.current?.stop();
    Animated.timing(holdProgress, {
      toValue: 0,
      duration: 300,
      useNativeDriver: false,
    }).start();
  }

  async function fireEmergency() {
    if (emergencySent) return;
    setEmergencySent(true);
    const pos = await getCurrentPosition();
    const lat = pos?.coords.latitude ?? 0;
    const lon = pos?.coords.longitude ?? 0;
    const alt_m = pos?.coords.altitude ?? null;
    try {
      await triggerEmergency(lat, lon, alt_m);
      Alert.alert(
        "🆘 EMERGENZA INVIATA",
        "Il soccorso è stato allertato. Rimani fermo e visibile.",
        [{ text: "OK" }]
      );
    } catch {
      Alert.alert("Errore", "Impossibile inviare l'allarme. Chiama il 118.");
    }
  }

  async function handlePause() {
    try {
      await cancelEmergency(); // POST /api/session/ok — resetta EM context
      setPauseMsg("Monitoraggio sospeso per 30 minuti");
      setTimeout(() => setPauseMsg(null), 5000);
    } catch {
      Alert.alert("Errore", "Impossibile contattare il server");
    }
  }

  async function handleEnd() {
    Alert.alert(
      "Termina sessione",
      "Vuoi terminare il monitoraggio?",
      [
        { text: "Annulla", style: "cancel" },
        {
          text: "Termina",
          style: "destructive",
          onPress: async () => {
            try {
              await stopTracking();
              await endSession();
              await clearSession();
              router.replace("/dashboard");
            } catch {
              Alert.alert("Errore", "Impossibile terminare la sessione");
            }
          },
        },
      ]
    );
  }

  const progressWidth = holdProgress.interpolate({
    inputRange: [0, 1],
    outputRange: ["0%", "100%"],
  });

  const activityLabel: Record<string, string> = {
    PARAGLIDER: "Parapendio 🪂",
    HANGGLIDER: "Deltaplano 🦅",
    CYCLIST: "Ciclismo 🚴",
    CLIMBER: "Arrampicata 🧗",
    HIKER: "Escursionismo 🥾",
    RUNNER: "Corsa 🏃",
    OTHER_ON_GROUND: "Altro 🏕",
  };

  return (
    <View style={s.container}>
      {/* Status bar */}
      <View style={s.statusBar}>
        <View style={s.statusDot} />
        <Text style={s.statusText}>MONITORAGGIO ATTIVO</Text>
      </View>

      {/* Mappa del cerchio monitorato + posizione */}
      {area && <SafeMap area={area} offlineReady={offlineReady} style={s.map} />}

      {outOfZone && (
        <View style={s.zoneBanner}>
          <Text style={s.zoneBannerText}>⚠️ Sei fuori dalla zona monitorata</Text>
        </View>
      )}

      {/* Info sessione */}
      <View style={s.infoBox}>
        <Text style={s.activityLabel}>
          {session ? activityLabel[session.attivita] ?? session.attivita : "—"}
        </Text>
        <Text style={s.elapsed}>{elapsed}</Text>
      </View>

      {/* Pulsante emergenza */}
      <View style={s.emergencyContainer}>
        <Text style={s.emergencyHint}>
          {emergencySent
            ? "Allarme inviato — rimani fermo"
            : "Tieni premuto 3 secondi per emergenza"}
        </Text>
        <TouchableOpacity
          style={[s.emergencyBtn, emergencySent && s.emergencyBtnSent]}
          onPressIn={onEmergencyPressIn}
          onPressOut={onEmergencyPressOut}
          disabled={emergencySent}
          activeOpacity={0.8}
        >
          <Text style={s.emergencyIcon}>🆘</Text>
          <Text style={s.emergencyText}>SOS</Text>
          {/* progress ring visivo */}
          <Animated.View
            style={[s.progressOverlay, { width: progressWidth }]}
          />
        </TouchableOpacity>
      </View>

      {/* Mi fermo un attimo */}
      <View style={s.pauseArea}>
        {pauseMsg ? (
          <Text style={s.pauseConfirm}>✓ {pauseMsg}</Text>
        ) : (
          <TouchableOpacity style={s.pauseBtn} onPress={handlePause}>
            <Text style={s.pauseBtnText}>📍 Mi fermo un attimo</Text>
          </TouchableOpacity>
        )}
      </View>

      {/* Termina */}
      <TouchableOpacity style={s.endBtn} onPress={handleEnd}>
        <Text style={s.endBtnText}>Termina sessione</Text>
      </TouchableOpacity>
    </View>
  );
}

const s = StyleSheet.create({
  container: {
    flex: 1, backgroundColor: "#0f0f1a",
    padding: 24, alignItems: "center",
  },
  statusBar: {
    flexDirection: "row", alignItems: "center", gap: 8,
    marginTop: 20, marginBottom: 32,
  },
  statusDot: {
    width: 10, height: 10, borderRadius: 5, backgroundColor: "#2ecc71",
  },
  statusText: { color: "#2ecc71", fontSize: 12, fontWeight: "bold", letterSpacing: 2 },
  map: { width: "100%", height: 200, marginBottom: 12 },
  zoneBanner: {
    width: "100%", backgroundColor: "#7a2530", borderRadius: 8,
    padding: 10, marginBottom: 12,
  },
  zoneBannerText: { color: "#fff", fontWeight: "600", textAlign: "center", fontSize: 13 },
  infoBox: { alignItems: "center", marginBottom: 48 },
  activityLabel: { color: "#fff", fontSize: 22, fontWeight: "bold" },
  elapsed: { color: "#e63946", fontSize: 48, fontWeight: "bold", marginTop: 8 },
  emergencyContainer: { alignItems: "center", flex: 1, justifyContent: "center" },
  emergencyHint: { color: "#888", fontSize: 13, marginBottom: 20, textAlign: "center" },
  emergencyBtn: {
    width: 180, height: 180, borderRadius: 90,
    backgroundColor: "#c0392b",
    alignItems: "center", justifyContent: "center",
    borderWidth: 4, borderColor: "#e74c3c",
    overflow: "hidden",
    elevation: 8,
    shadowColor: "#e63946",
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.8,
    shadowRadius: 20,
  },
  emergencyBtnSent: { backgroundColor: "#555", borderColor: "#777" },
  emergencyIcon: { fontSize: 56 },
  emergencyText: { color: "#fff", fontSize: 24, fontWeight: "bold" },
  progressOverlay: {
    position: "absolute", bottom: 0, left: 0, height: 8,
    backgroundColor: "rgba(255,255,255,0.4)",
  },
  pauseArea: { marginBottom: 8, alignItems: "center", minHeight: 40, justifyContent: "center" },
  pauseBtn: {
    paddingVertical: 10, paddingHorizontal: 24,
    borderRadius: 20, borderWidth: 1, borderColor: "#3a3a5e",
    backgroundColor: "#1a1a2e",
  },
  pauseBtnText: { color: "#888", fontSize: 14 },
  pauseConfirm: { color: "#f0a500", fontSize: 13 },
  endBtn: {
    marginBottom: 16, padding: 16,
  },
  endBtnText: { color: "#555", fontSize: 15, textDecorationLine: "underline" },
});

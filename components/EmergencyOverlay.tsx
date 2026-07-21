import { useEffect, useRef, useState } from "react";
import {
  View, Text, StyleSheet, Animated, Pressable, Vibration, ActivityIndicator,
} from "react-native";
import { sendEmergency, emergencyStatus } from "../lib/api";
import { getCurrentPosition } from "../lib/tracking";
import {
  loadEmergencyMessage, saveEmergencyMessage, EMERGENCY_FALLBACK_MSG,
} from "../lib/store";

const HOLD_MS = 3000;
const POLL_MS = 15_000;

type Phase = "arming" | "sending" | "sent";

interface Props {
  /** Chiamato quando l'utente annulla (prima dell'invio) o l'emergenza è risolta. */
  onClose: () => void;
  /** Apri già in stato "inviato" (es. emergenza ancora aperta all'avvio dell'app). */
  initialSent?: boolean;
}

export default function EmergencyOverlay({ onClose, initialSent }: Props) {
  const [phase, setPhase] = useState<Phase>(initialSent ? "sent" : "arming");
  const [message, setMessage] = useState(EMERGENCY_FALLBACK_MSG);
  const [countdown, setCountdown] = useState(3);
  const progress = useRef(new Animated.Value(0)).current;
  const anim = useRef<Animated.CompositeAnimation | null>(null);
  const holding = useRef(false);

  useEffect(() => {
    loadEmergencyMessage().then(setMessage);
    const id = progress.addListener(({ value }) =>
      setCountdown(Math.max(1, Math.ceil(3 * (1 - value))))
    );
    return () => progress.removeListener(id);
  }, []);

  // Polling della risoluzione mentre l'emergenza è inviata.
  useEffect(() => {
    if (phase !== "sent") return;
    let alive = true;
    async function poll() {
      const st = await emergencyStatus();
      if (!alive || !st) return;
      if (st.message) {
        setMessage(st.message);
        saveEmergencyMessage(st.message);
      }
      if (!st.active) onClose();
    }
    poll();
    const id = setInterval(poll, POLL_MS);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [phase]);

  function onPressIn() {
    if (phase !== "arming") return;
    holding.current = true;
    progress.setValue(0);
    anim.current = Animated.timing(progress, {
      toValue: 1, duration: HOLD_MS, useNativeDriver: false,
    });
    anim.current.start(({ finished }) => {
      if (finished && holding.current) fire();
    });
  }

  function onPressOut() {
    if (phase !== "arming") return;
    holding.current = false;
    anim.current?.stop();
    Animated.timing(progress, { toValue: 0, duration: 200, useNativeDriver: false }).start();
  }

  async function fire() {
    setPhase("sending");
    Vibration.vibrate([0, 300, 100, 300]);
    const pos = await getCurrentPosition();
    try {
      const res = await sendEmergency(
        pos?.coords.latitude ?? 0,
        pos?.coords.longitude ?? 0,
        pos?.coords.altitude ?? null
      );
      if (res.message) {
        setMessage(res.message);
        saveEmergencyMessage(res.message);
      }
      setPhase("sent");
    } catch {
      // invio fallito: torna ad armare, l'utente può ritentare
      setPhase("arming");
      progress.setValue(0);
    }
  }

  const ringWidth = progress.interpolate({ inputRange: [0, 1], outputRange: ["0%", "100%"] });

  // Fase "arming": tutto lo schermo è il bersaglio del tocco.
  if (phase === "arming") {
    return (
      <Pressable style={s.overlay} onPressIn={onPressIn} onPressOut={onPressOut}>
        <Text style={s.title}>Emergenza manuale</Text>
        <Text style={s.count}>{countdown}</Text>
        <Text style={s.instr}>
          Tieni premuto ovunque per 3 secondi{"\n"}per segnalare un'emergenza
        </Text>
        <Animated.View style={[s.holdProgress, { width: ringWidth }]} />
        <View style={s.cancelWrap}>
          <Pressable onPress={onClose} hitSlop={20}>
            <Text style={s.cancel}>Annulla</Text>
          </Pressable>
        </View>
      </Pressable>
    );
  }

  return (
    <View style={s.overlay}>
      {phase === "sending" && (
        <>
          <ActivityIndicator size="large" color="#fff" />
          <Text style={s.instr}>Invio emergenza…</Text>
        </>
      )}

      {phase === "sent" && (
        <>
          <Text style={s.sentTitle}>EMERGENZA INVIATA</Text>
          <Text style={s.sentMsg}>{message}</Text>
          <View style={s.pulse}>
            <ActivityIndicator color="#fff" />
            <Text style={s.waiting}>Soccorsi allertati · resta dove sei</Text>
          </View>
        </>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(155,20,30,0.97)",
    alignItems: "center",
    justifyContent: "center",
    padding: 32,
    zIndex: 100,
  },
  title: { color: "#fff", fontSize: 22, fontWeight: "bold", marginBottom: 12 },
  instr: { color: "#ffdada", fontSize: 15, textAlign: "center", marginBottom: 32, lineHeight: 22 },
  count: { color: "#fff", fontSize: 120, fontWeight: "bold", marginVertical: 8 },
  holdProgress: {
    position: "absolute", bottom: 0, left: 0, height: 10,
    backgroundColor: "rgba(255,255,255,0.6)",
  },
  cancelWrap: { position: "absolute", bottom: 48, alignSelf: "center" },
  cancel: {
    color: "#fff", fontSize: 16,
    textDecorationLine: "underline", padding: 12,
  },
  sentTitle: { color: "#fff", fontSize: 26, fontWeight: "bold", letterSpacing: 1, marginBottom: 20 },
  sentMsg: { color: "#fff", fontSize: 20, textAlign: "center", lineHeight: 28, fontWeight: "600" },
  pulse: { alignItems: "center", marginTop: 40, gap: 12 },
  waiting: { color: "#ffdada", fontSize: 14 },
});

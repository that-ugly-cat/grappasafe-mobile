import { useEffect, useRef, useState } from "react";
import {
  View, Text, StyleSheet, Animated, Pressable, Vibration, ActivityIndicator,
} from "react-native";
import { sendEmergency, emergencyStatus } from "../lib/api";
import { getCurrentPosition } from "../lib/tracking";
import { loadEmergencyMessage, saveEmergencyMessage } from "../lib/store";
import { queueEmergency, loadQueuedEmergency, clearQueuedEmergency } from "../lib/outbox";
import { playConfirm } from "../lib/sfx";
import { useT } from "../lib/i18n";

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
  const t = useT();
  const [phase, setPhase] = useState<Phase>(initialSent ? "sent" : "arming");
  const [message, setMessage] = useState(t("emergency.fallbackMsg"));
  const [acknowledged, setAcknowledged] = useState(false);
  // true finché un SOS partito senza rete resta in coda (invio non confermato).
  const [queued, setQueued] = useState(false);
  const [countdown, setCountdown] = useState(3);
  const progress = useRef(new Animated.Value(0)).current;
  const anim = useRef<Animated.CompositeAnimation | null>(null);
  const holding = useRef(false);

  useEffect(() => {
    loadEmergencyMessage().then((m) => m && setMessage(m));
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
      // Se un SOS è rimasto in coda (partito senza rete), ritenta a ogni giro
      // finché il server non lo prende — anche senza sessione attiva (quando il
      // task GPS non gira). L'outbox è la fonte di verità dello stato "in coda".
      const qe = await loadQueuedEmergency();
      if (qe) {
        try {
          const res = await sendEmergency(qe.lat, qe.lon, qe.alt_m);
          await clearQueuedEmergency();
          if (res.message) {
            setMessage(res.message);
            saveEmergencyMessage(res.message);
          }
          if (alive) setQueued(false);
        } catch {
          return; // ancora niente rete: resta in coda, riprova al prossimo giro
        }
      } else if (alive) {
        setQueued(false);
      }

      const st = await emergencyStatus();
      if (!alive || !st) return;
      if (st.message) {
        setMessage(st.message);
        saveEmergencyMessage(st.message);
      }
      setAcknowledged(!!st.acknowledged);
      if (!st.active) onClose();
    }
    poll();
    const id = setInterval(poll, POLL_MS);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [phase]);

  // Suono di conferma quando un operatore prende in carico l'emergenza.
  useEffect(() => {
    if (acknowledged) playConfirm();
  }, [acknowledged]);

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
      // Invio fallito (quasi sempre assenza di rete): NON perdere l'SOS. Mettilo
      // in coda, resta in stato "inviato" e segnala "in attesa di rete"; il retry
      // parte dal polling qui sotto (e dal task GPS, se c'è una sessione attiva).
      await queueEmergency({
        lat: pos?.coords.latitude ?? 0,
        lon: pos?.coords.longitude ?? 0,
        alt_m: pos?.coords.altitude ?? null,
      });
      setQueued(true);
      setPhase("sent");
    }
  }

  const ringWidth = progress.interpolate({ inputRange: [0, 1], outputRange: ["0%", "100%"] });

  // Fase "arming": tutto lo schermo è il bersaglio del tocco.
  if (phase === "arming") {
    return (
      <Pressable style={s.overlay} onPressIn={onPressIn} onPressOut={onPressOut}>
        <Text style={s.title}>{t("emergency.manualTitle")}</Text>
        <Text style={s.count}>{countdown}</Text>
        <Text style={s.instr}>{t("emergency.holdInstr")}</Text>
        <Animated.View style={[s.holdProgress, { width: ringWidth }]} />
        <View style={s.cancelWrap}>
          <Pressable onPress={onClose} hitSlop={20}>
            <Text style={s.cancel}>{t("common.cancel")}</Text>
          </Pressable>
        </View>
      </Pressable>
    );
  }

  // Once sent, the panel drops to the bottom half so the map above stays
  // visible and pannable — the person may need to check terrain or an exit.
  return (
    <View style={s.sheet} pointerEvents="box-none">
      <View style={s.sheetInner}>
      <View style={s.handle} />
      {phase === "sending" && (
        <>
          <ActivityIndicator size="large" color="#fff" />
          <Text style={s.instr}>{t("emergency.sending")}</Text>
        </>
      )}

      {phase === "sent" && (
        <>
          <Text style={s.sentTitle}>{t("emergency.sentTitle")}</Text>
          <Text style={s.sentMsg}>{message}</Text>
          {acknowledged ? (
            <View style={s.ackBox}>
              <Text style={s.ackTitle}>{t("emergency.ackTitle")}</Text>
              <Text style={s.ackText}>{t("emergency.ackText")}</Text>
            </View>
          ) : (
            <View style={s.pulse}>
              <ActivityIndicator color="#fff" />
              <Text style={s.waiting}>
                {queued ? t("emergency.queued") : t("emergency.waiting")}
              </Text>
            </View>
          )}
        </>
      )}
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "#9b141e",
    alignItems: "center",
    justifyContent: "center",
    padding: 32,
    zIndex: 100,
  },
  // Sent phase: full-screen transparent layer that lets touches through to the
  // map, with the red panel pinned to the bottom half.
  sheet: { ...StyleSheet.absoluteFillObject, justifyContent: "flex-end", zIndex: 100 },
  sheetInner: {
    height: "52%", width: "100%",
    backgroundColor: "#9b141e",
    alignItems: "center", justifyContent: "center",
    paddingHorizontal: 24, paddingBottom: 24, paddingTop: 28,
    borderTopLeftRadius: 22, borderTopRightRadius: 22,
  },
  handle: {
    position: "absolute", top: 10, alignSelf: "center",
    width: 44, height: 5, borderRadius: 3, backgroundColor: "rgba(255,255,255,0.5)",
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
  sentTitle: { color: "#fff", fontSize: 26, fontWeight: "bold", letterSpacing: 1, marginBottom: 14 },
  sentMsg: { color: "#fff", fontSize: 20, textAlign: "center", lineHeight: 28, fontWeight: "600" },
  pulse: { alignItems: "center", marginTop: 22, gap: 12 },
  waiting: { color: "#ffdada", fontSize: 14 },
  ackBox: {
    marginTop: 20, backgroundColor: "rgba(255,255,255,0.15)",
    borderRadius: 12, padding: 18, alignItems: "center",
  },
  ackTitle: { color: "#fff", fontSize: 18, fontWeight: "bold", marginBottom: 6 },
  ackText: { color: "#fff", fontSize: 15, textAlign: "center", lineHeight: 21 },
});


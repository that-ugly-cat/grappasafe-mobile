/**
 * AlarmScreen — schermata di conferma emergenza pending.
 *
 * Mostrata quando il server rileva AUTO_IMPACT o AUTO_IMMOBILE e aspetta
 * conferma dall'utente. L'utente ha "expires_in" secondi per rispondere.
 *
 * Due azioni:
 *   "Sto bene"        → POST /api/session/ok   → annulla il pending
 *   "Chiama soccorsi" → POST /api/emergency/confirm → apre emergenza reale
 *
 * Se il timer scade senza risposta, il client conferma automaticamente
 * (il server fa lo stesso in autonomia come fallback).
 *
 * Impossibile chiudere la schermata senza scegliere (back disabilitato).
 */

import { useEffect, useRef, useState } from "react";
import {
  View, Text, TouchableOpacity, StyleSheet,
  Vibration, BackHandler, Platform,
} from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { useKeepAwake } from "expo-keep-awake";
import * as Notifications from "expo-notifications";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { confirmEmergency, cancelEmergency } from "../lib/api";
import { getCurrentPosition } from "../lib/tracking";

// Vibrazione SOS morse: · · ·  — — —  · · ·
// Formato RN: [wait, vibrate, wait, vibrate, ...]
const SOS_PATTERN = [
  0,   200, 100, 200, 100, 200,  // S: · · ·
  300,
  0,   500, 200, 500, 200, 500,  // O: — — —
  300,
  0,   200, 100, 200, 100, 200,  // S: · · ·
  1200,                           // pausa inter-ciclo
];

const TRIGGER_LABELS: Record<string, { title: string; detail: string }> = {
  AUTO_IMPACT:   { title: "Impatto rilevato",         detail: "Il sensore ha rilevato un impatto. Sei ferito?" },
  AUTO_IMMOBILE: { title: "Sei fermo da troppo tempo", detail: "Non ti muovi da diversi minuti. Hai bisogno di aiuto?" },
};

const DEFAULT_LABEL = { title: "Situazione anomala rilevata", detail: "Il sistema ha rilevato qualcosa di insolito." };

export default function AlarmScreen() {
  useKeepAwake();

  const params = useLocalSearchParams<{ trigger?: string; expires_in?: string }>();
  const initialSeconds = parseInt(params.expires_in ?? "180", 10);
  const trigger        = params.trigger ?? "";
  const label          = TRIGGER_LABELS[trigger] ?? DEFAULT_LABEL;

  const [countdown, setCountdown] = useState(Math.max(0, initialSeconds));
  const [resolved,  setResolved]  = useState(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const resolvedRef = useRef(false);  // per handleConfirm chiamato da timer

  // Blocca il tasto back hardware (Android)
  useEffect(() => {
    const sub = BackHandler.addEventListener("hardwareBackPress", () => true);
    return () => sub.remove();
  }, []);

  // Avvia vibrazione SOS loop + countdown
  useEffect(() => {
    Vibration.vibrate(SOS_PATTERN, true);

    intervalRef.current = setInterval(() => {
      setCountdown(prev => {
        if (prev <= 1) {
          // Timer scaduto: il client conferma (server farà lo stesso autonomamente)
          if (!resolvedRef.current) {
            handleConfirm();
          }
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => {
      Vibration.cancel();
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, []);

  function stopAlarm() {
    Vibration.cancel();
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    setResolved(true);
    resolvedRef.current = true;
  }

  async function clearLocalState() {
    await AsyncStorage.removeItem("pending_emergency");
    const notifId = await AsyncStorage.getItem("pending_notif_id");
    if (notifId) {
      await Notifications.dismissNotificationAsync(notifId).catch(() => {});
      await AsyncStorage.removeItem("pending_notif_id");
    }
    await Notifications.dismissAllNotificationsAsync().catch(() => {});
  }

  async function handleCancel() {
    if (resolvedRef.current) return;
    stopAlarm();
    try {
      await cancelEmergency();
    } catch { /* server lo gestisce anche senza risposta */ }
    await clearLocalState();
    router.replace("/map");
  }

  async function handleConfirm() {
    if (resolvedRef.current) return;
    stopAlarm();
    try {
      const pos = await getCurrentPosition();
      await confirmEmergency(
        pos?.coords.latitude  ?? 0,
        pos?.coords.longitude ?? 0,
        pos?.coords.altitude  ?? null,
      );
    } catch { /* server auto-conferma comunque dopo il timeout */ }
    await clearLocalState();
    router.replace("/map");
  }

  const minutes = Math.floor(countdown / 60);
  const seconds = countdown % 60;
  const urgent  = countdown < 30 && !resolved;

  return (
    <View style={s.container}>
      {/* Icona */}
      <Text style={s.icon}>⚠️</Text>

      {/* Titolo emergenza */}
      <Text style={s.title}>{label.title.toUpperCase()}</Text>
      <Text style={s.detail}>{label.detail}</Text>

      {/* Countdown */}
      <View style={[s.countdownBox, urgent && s.countdownBoxUrgent]}>
        <Text style={[s.countdownTime, urgent && s.countdownTimeUrgent]}>
          {String(minutes).padStart(2, "0")}:{String(seconds).padStart(2, "0")}
        </Text>
        <Text style={s.countdownLabel}>
          {resolved
            ? "Risposta inviata"
            : "I soccorsi vengono allertati automaticamente"}
        </Text>
      </View>

      {/* Azioni */}
      <View style={s.actions}>
        <TouchableOpacity
          style={[s.btnOk, resolved && s.btnDisabled]}
          onPress={handleCancel}
          disabled={resolved}
          activeOpacity={0.75}
        >
          <Text style={s.btnOkText}>✅  Sto bene</Text>
          <Text style={s.btnSubtext}>Falso allarme</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[s.btnSos, resolved && s.btnDisabled]}
          onPress={handleConfirm}
          disabled={resolved}
          activeOpacity={0.75}
        >
          <Text style={s.btnSosText}>🆘  Ho bisogno di aiuto</Text>
          <Text style={s.btnSubtext}>Allerta i soccorsi</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#1a0000",
    alignItems: "center",
    justifyContent: "center",
    padding: 28,
  },
  icon: {
    fontSize: 72,
    marginBottom: 12,
  },
  title: {
    color: "#ff4444",
    fontSize: 22,
    fontWeight: "bold",
    letterSpacing: 1.5,
    textAlign: "center",
    marginBottom: 8,
  },
  detail: {
    color: "#ccc",
    fontSize: 15,
    textAlign: "center",
    marginBottom: 36,
    lineHeight: 22,
  },
  countdownBox: {
    borderWidth: 2,
    borderColor: "#ff4444",
    borderRadius: 16,
    paddingVertical: 20,
    paddingHorizontal: 32,
    alignItems: "center",
    marginBottom: 44,
    backgroundColor: "#2a0000",
  },
  countdownBoxUrgent: {
    borderColor: "#ff0000",
    backgroundColor: "#3a0000",
  },
  countdownTime: {
    color: "#ff4444",
    fontSize: 56,
    fontWeight: "bold",
    fontVariant: ["tabular-nums"],
  },
  countdownTimeUrgent: {
    color: "#ff0000",
  },
  countdownLabel: {
    color: "#888",
    fontSize: 12,
    marginTop: 6,
    textAlign: "center",
  },
  actions: {
    width: "100%",
    gap: 16,
  },
  btnOk: {
    backgroundColor: "#1a4a1a",
    borderWidth: 2,
    borderColor: "#2ecc71",
    borderRadius: 14,
    paddingVertical: 20,
    alignItems: "center",
  },
  btnOkText: {
    color: "#2ecc71",
    fontSize: 20,
    fontWeight: "bold",
  },
  btnSos: {
    backgroundColor: "#4a0a0a",
    borderWidth: 2,
    borderColor: "#e74c3c",
    borderRadius: 14,
    paddingVertical: 20,
    alignItems: "center",
  },
  btnSosText: {
    color: "#e74c3c",
    fontSize: 20,
    fontWeight: "bold",
  },
  btnSubtext: {
    color: "#888",
    fontSize: 12,
    marginTop: 4,
  },
  btnDisabled: {
    opacity: 0.4,
  },
});

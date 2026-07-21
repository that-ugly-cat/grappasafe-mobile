import { useCallback, useEffect, useState } from "react";
import {
  View, Text, TouchableOpacity, StyleSheet, Alert, Pressable, Share,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { router, useFocusEffect } from "expo-router";
import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  getConfig, getMe, emergencyStatus, endSession, getSessionStatus,
  AreaConfig, Attivita, API_BASE,
} from "../lib/api";
import {
  loadAreaConfig, saveAreaConfig, loadSettings, loadSession, clearSession,
  StoredSession,
} from "../lib/store";
import { startTracking, stopTracking } from "../lib/tracking";
import { isMapDownloaded } from "../lib/tiles";
import SafeMap from "../components/SafeMap";
import ActivityModal from "../components/ActivityModal";
import EmergencyOverlay from "../components/EmergencyOverlay";

const ACTIVITY_LABEL: Record<string, string> = {
  PARAGLIDER: "Parapendio",
  HANGGLIDER: "Deltaplano",
  GLIDER: "Aliante",
  CYCLIST: "Ciclismo",
  CLIMBER: "Arrampicata",
  HIKER: "Escursionismo",
  RUNNER: "Corsa",
  OTHER_ON_GROUND: "Altro",
};

export default function MapScreen() {
  const insets = useSafeAreaInsets();
  const [area, setArea] = useState<AreaConfig | null>(null);
  const [offlineReady, setOfflineReady] = useState(false);
  const [session, setSession] = useState<StoredSession | null>(null);
  const [paused, setPaused] = useState(false);
  const [outOfZone, setOutOfZone] = useState(false);
  const [showActivity, setShowActivity] = useState(false);
  const [showEmergency, setShowEmergency] = useState(false);
  const [emergencyInitialSent, setEmergencyInitialSent] = useState(false);
  const [shareToken, setShareToken] = useState<string | null>(null);

  // Setup iniziale: area (cache + refresh dal server), modalità mappa, sessione,
  // e se c'è già un'emergenza aperta riapre l'overlay.
  useEffect(() => {
    loadAreaConfig().then((a) => a && setArea(a));
    getConfig().then((c) => {
      if (c) {
        saveAreaConfig(c);
        setArea(c);
      }
    });
    loadSession().then(setSession);
    getMe().then((me) => me && setShareToken(me.share_token));
    emergencyStatus().then((st) => {
      if (st?.active) {
        setEmergencyInitialSent(true);
        setShowEmergency(true);
      }
    });
  }, []);

  // Rilegge modalità mappa e area ad ogni focus della schermata: così tornando
  // dai Settings (dove attivi l'offline) la mappa si aggiorna subito.
  useFocusEffect(
    useCallback(() => {
      (async () => {
        const settings = await loadSettings();
        setOfflineReady(settings.mapOffline && (await isMapDownloaded()));
        const a = await loadAreaConfig();
        if (a) setArea(a);
        syncServerSession();
      })();
    }, [])
  );

  // Banner "fuori zona" (flag scritto dal task background).
  useEffect(() => {
    async function read() {
      const v = await AsyncStorage.getItem("out_of_zone");
      setOutOfZone(v === "1");
    }
    read();
    const id = setInterval(read, 5_000);
    return () => clearInterval(id);
  }, []);

  // Pending auto-emergenza dal server (durante una sessione) → schermata alarm.
  useEffect(() => {
    if (!session) return;
    async function checkPending() {
      const raw = await AsyncStorage.getItem("pending_emergency");
      if (raw) {
        const p = JSON.parse(raw) as { trigger: string; expires_in: number };
        router.push({
          pathname: "/alarm",
          params: { trigger: p.trigger, expires_in: String(p.expires_in) },
        });
      }
    }
    checkPending();
    const id = setInterval(checkPending, 5_000);
    return () => clearInterval(id);
  }, [session]);

  function onActivityStarted(_a: Attivita) {
    setShowActivity(false);
    setPaused(false);
    loadSession().then(setSession);
  }

  async function shareLive() {
    if (!shareToken) return;
    const url = `${API_BASE}/map/${shareToken}`;
    try {
      await Share.share({
        message: `Segui il mio tracking live su GrappaSafe: ${url}`,
        url,
      });
    } catch {
      /* condivisione annullata */
    }
  }

  // Riallinea con il server: se la sessione non è più attiva (es. l'emergenza
  // è stata risolta e il server ha chiuso l'attività), ferma il tracking locale.
  async function syncServerSession() {
    const status = await getSessionStatus();
    if (status && !status.active) {
      await stopTracking();
      await clearSession();
      setSession(null);
      setPaused(false);
    }
  }

  async function handlePauseToggle() {
    try {
      if (paused) {
        await startTracking();
        setPaused(false);
      } else {
        await stopTracking();
        setPaused(true);
      }
    } catch {
      Alert.alert("Errore", "Impossibile cambiare stato del monitoraggio");
    }
  }

  function handleStop() {
    Alert.alert("Termina sessione", "Vuoi terminare il monitoraggio?", [
      { text: "Annulla", style: "cancel" },
      {
        text: "Termina",
        style: "destructive",
        onPress: async () => {
          try {
            await stopTracking();
            await endSession();
            await clearSession();
            setSession(null);
            setPaused(false);
          } catch {
            Alert.alert("Errore", "Impossibile terminare la sessione");
          }
        },
      },
    ]);
  }

  return (
    <View style={s.container}>
      {/* Base: mappa */}
      {area ? (
        <SafeMap
          area={area}
          offlineReady={offlineReady}
          style={[StyleSheet.absoluteFillObject, s.mapFull]}
        />
      ) : (
        <View style={[StyleSheet.absoluteFillObject, s.mapPlaceholder]} />
      )}

      {/* Top: chip live + banner fuori zona */}
      <View style={[s.top, { paddingTop: insets.top + 8 }]} pointerEvents="box-none">
        {session && (
          <Pressable
            style={[s.chip, paused && s.chipPaused]}
            onPress={shareLive}
            disabled={!shareToken}
          >
            <View style={[s.liveDot, paused && s.liveDotPaused]} />
            <Text style={s.chipText}>
              {paused ? "IN PAUSA" : "LIVE"} · {ACTIVITY_LABEL[session.attivita] ?? session.attivita}
            </Text>
            {shareToken && <Text style={s.chipShare}>· condividi</Text>}
          </Pressable>
        )}
        {outOfZone && (
          <View style={s.zoneBanner}>
            <Text style={s.zoneBannerText}>⚠️ Sei fuori dalla zona monitorata</Text>
          </View>
        )}
      </View>

      {/* Impostazioni (in alto a destra) */}
      <TouchableOpacity
        style={[s.gear, { top: insets.top + 8 }]}
        onPress={() => router.push("/settings")}
      >
        <Text style={s.gearIcon}>⚙</Text>
      </TouchableOpacity>

      {/* Controlli in basso */}
      <View style={[s.bottom, { paddingBottom: insets.bottom + 16 }]} pointerEvents="box-none">
        {session ? (
          <View style={s.liveControls}>
            <TouchableOpacity style={s.ctrlBtn} onPress={handlePauseToggle}>
              <Text style={s.ctrlText}>{paused ? "▶  Riprendi" : "⏸  Pausa"}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[s.ctrlBtn, s.stopBtn]} onPress={handleStop}>
              <Text style={s.ctrlText}>⏹  Stop</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <TouchableOpacity style={s.startBtn} onPress={() => setShowActivity(true)}>
            <Text style={s.startText}>▶  Inizia attività</Text>
          </TouchableOpacity>
        )}

        <Pressable style={s.sos} onPress={() => setShowEmergency(true)}>
          <Text style={s.sosText}>SOS</Text>
        </Pressable>
      </View>

      <ActivityModal
        visible={showActivity}
        onClose={() => setShowActivity(false)}
        onStarted={onActivityStarted}
      />

      {showEmergency && (
        <EmergencyOverlay
          initialSent={emergencyInitialSent}
          onClose={() => {
            setShowEmergency(false);
            setEmergencyInitialSent(false);
            syncServerSession();
          }}
        />
      )}
    </View>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#0f0f1a" },
  mapFull: { borderRadius: 0, borderWidth: 0 },
  mapPlaceholder: { backgroundColor: "#0f0f1a" },

  top: { position: "absolute", left: 0, right: 0, top: 0, alignItems: "center", gap: 8, paddingHorizontal: 64 },
  chip: {
    flexDirection: "row", alignItems: "center", gap: 8,
    backgroundColor: "rgba(15,15,26,0.9)", borderRadius: 20,
    paddingVertical: 8, paddingHorizontal: 16, borderWidth: 1, borderColor: "#2ecc71",
  },
  chipPaused: { borderColor: "#f0a500" },
  liveDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: "#2ecc71" },
  liveDotPaused: { backgroundColor: "#f0a500" },
  chipText: { color: "#fff", fontSize: 13, fontWeight: "600", letterSpacing: 0.5 },
  chipShare: { color: "#e63946", fontSize: 12, fontWeight: "700", marginLeft: 4 },
  zoneBanner: { backgroundColor: "#7a2530", borderRadius: 8, paddingVertical: 8, paddingHorizontal: 14 },
  zoneBannerText: { color: "#fff", fontWeight: "600", fontSize: 13 },

  gear: {
    position: "absolute", right: 12,
    width: 44, height: 44, borderRadius: 22,
    backgroundColor: "rgba(15,15,26,0.9)", alignItems: "center", justifyContent: "center",
    borderWidth: 1, borderColor: "#2a2a44",
  },
  gearIcon: { fontSize: 22, color: "#fff" },

  bottom: { position: "absolute", left: 0, right: 0, bottom: 0, alignItems: "center", gap: 16 },
  liveControls: { flexDirection: "row", gap: 12 },
  ctrlBtn: {
    backgroundColor: "rgba(30,30,48,0.95)", borderRadius: 24,
    paddingVertical: 14, paddingHorizontal: 28, borderWidth: 1, borderColor: "#3a3a5e",
  },
  stopBtn: { borderColor: "#e63946" },
  ctrlText: { color: "#fff", fontSize: 16, fontWeight: "600" },
  startBtn: {
    backgroundColor: "#1e1e30", borderRadius: 26,
    paddingVertical: 16, paddingHorizontal: 40, borderWidth: 2, borderColor: "#e63946",
  },
  startText: { color: "#e63946", fontSize: 18, fontWeight: "bold" },

  sos: {
    width: 96, height: 96, borderRadius: 48,
    backgroundColor: "#c0392b", alignItems: "center", justifyContent: "center",
    borderWidth: 4, borderColor: "#e74c3c",
    elevation: 8, shadowColor: "#e63946", shadowOpacity: 0.7, shadowRadius: 16,
  },
  sosText: { color: "#fff", fontSize: 28, fontWeight: "bold", letterSpacing: 1 },
});

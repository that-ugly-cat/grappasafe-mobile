import { useEffect, useState } from "react";
import {
  View, Text, TouchableOpacity, Switch, ScrollView,
  StyleSheet, Alert, ActivityIndicator,
} from "react-native";
import {
  loadSettings, saveSettings, Settings, DEFAULT_SETTINGS,
} from "../lib/store";
import {
  isMapDownloaded, downloadMap, deleteMap, getLocalManifest,
} from "../lib/tiles";

const INTERVAL_PRESETS_S = [5, 10, 15, 30, 60];

export default function SettingsScreen() {
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [mapReady, setMapReady] = useState(false);
  const [tileCount, setTileCount] = useState<number | null>(null);
  const [downloading, setDownloading] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0 });

  useEffect(() => {
    loadSettings().then(setSettings);
    refreshMapStatus();
  }, []);

  async function refreshMapStatus() {
    const ready = await isMapDownloaded();
    setMapReady(ready);
    if (ready) {
      const m = await getLocalManifest();
      setTileCount(m?.count ?? null);
    } else {
      setTileCount(null);
    }
  }

  async function update(patch: Partial<Settings>) {
    const next = { ...settings, ...patch };
    setSettings(next);
    await saveSettings(next);
  }

  async function handleDownload() {
    setDownloading(true);
    setProgress({ done: 0, total: 0 });
    try {
      await downloadMap((p) => setProgress(p));
      await refreshMapStatus();
      Alert.alert("Mappa offline", "Download completato.");
    } catch (e) {
      Alert.alert(
        "Errore",
        "Impossibile scaricare la mappa. Verifica la connessione e che il server abbia le tile pronte."
      );
    } finally {
      setDownloading(false);
    }
  }

  function handleDelete() {
    Alert.alert("Elimina mappa offline", "Liberare lo spazio delle tile scaricate?", [
      { text: "Annulla", style: "cancel" },
      {
        text: "Elimina",
        style: "destructive",
        onPress: async () => {
          await deleteMap();
          await refreshMapStatus();
        },
      },
    ]);
  }

  const intervalS = Math.round(settings.gpsIntervalMs / 1000);
  const pct = progress.total ? Math.round((progress.done / progress.total) * 100) : 0;

  return (
    <ScrollView style={s.container} contentContainerStyle={s.inner}>
      {/* Frequenza pin */}
      <Text style={s.section}>Frequenza aggiornamento pin</Text>
      <Text style={s.hint}>
        Ogni quanto l'app invia la posizione. Più frequente = tracciamento fitto ma più
        batteria.
      </Text>
      <View style={s.chips}>
        {INTERVAL_PRESETS_S.map((sec) => {
          const active = intervalS === sec;
          return (
            <TouchableOpacity
              key={sec}
              style={[s.chip, active && s.chipActive]}
              onPress={() => update({ gpsIntervalMs: sec * 1000 })}
            >
              <Text style={[s.chipText, active && s.chipTextActive]}>{sec}s</Text>
            </TouchableOpacity>
          );
        })}
      </View>
      {intervalS > 30 && (
        <Text style={s.warn}>
          ⚠️ Intervalli lunghi ammorbidiscono il rilevamento automatico delle emergenze.
        </Text>
      )}

      {/* Alert fuori zona */}
      <View style={s.divider} />
      <View style={s.row}>
        <View style={s.rowText}>
          <Text style={s.section}>Avviso "sei fuori zona"</Text>
          <Text style={s.hint}>
            Notifica quando esci dal cerchio monitorato dal consorzio.
          </Text>
        </View>
        <Switch
          value={settings.outOfZoneAlerts}
          onValueChange={(v) => update({ outOfZoneAlerts: v })}
          trackColor={{ true: "#e63946", false: "#333" }}
          thumbColor="#fff"
        />
      </View>

      {/* Mappa offline */}
      <View style={s.divider} />
      <Text style={s.section}>Mappa offline (OpenTopoMap)</Text>
      <Text style={s.hint}>
        Scarica una volta le tile del cerchio per vederle senza segnale in montagna.
      </Text>

      {mapReady ? (
        <>
          <Text style={s.ok}>
            ✓ Mappa scaricata{tileCount ? ` — ${tileCount} tile` : ""}
          </Text>
          <TouchableOpacity style={s.btnGhost} onPress={handleDelete} disabled={downloading}>
            <Text style={s.btnGhostText}>Elimina mappa offline</Text>
          </TouchableOpacity>
        </>
      ) : downloading ? (
        <View style={s.progressWrap}>
          <View style={s.progressBar}>
            <View style={[s.progressFill, { width: `${pct}%` }]} />
          </View>
          <Text style={s.hint}>
            {progress.total
              ? `${progress.done} / ${progress.total} tile (${pct}%)`
              : "Preparazione…"}
          </Text>
        </View>
      ) : (
        <TouchableOpacity style={s.btn} onPress={handleDownload}>
          <Text style={s.btnText}>Scarica mappa offline</Text>
        </TouchableOpacity>
      )}
      {downloading && <ActivityIndicator color="#e63946" style={{ marginTop: 12 }} />}
    </ScrollView>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#0f0f1a" },
  inner: { padding: 24, paddingBottom: 48 },
  section: { fontSize: 16, color: "#fff", fontWeight: "bold" },
  hint: { fontSize: 13, color: "#888", marginTop: 4, lineHeight: 18 },
  warn: { fontSize: 13, color: "#f0a500", marginTop: 10 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 10, marginTop: 14 },
  chip: {
    paddingVertical: 10, paddingHorizontal: 18, borderRadius: 20,
    borderWidth: 1, borderColor: "#333", backgroundColor: "#1e1e30",
  },
  chipActive: { backgroundColor: "#e63946", borderColor: "#e63946" },
  chipText: { color: "#aaa", fontSize: 15, fontWeight: "600" },
  chipTextActive: { color: "#fff" },
  divider: { height: 1, backgroundColor: "#222", marginVertical: 28 },
  row: { flexDirection: "row", alignItems: "center", gap: 16 },
  rowText: { flex: 1 },
  ok: { color: "#2ecc71", fontSize: 14, marginTop: 14, marginBottom: 8 },
  btn: {
    backgroundColor: "#e63946", borderRadius: 10, padding: 16,
    alignItems: "center", marginTop: 16,
  },
  btnText: { color: "#fff", fontSize: 16, fontWeight: "bold" },
  btnGhost: { padding: 14, alignItems: "center", marginTop: 4 },
  btnGhostText: { color: "#888", fontSize: 14, textDecorationLine: "underline" },
  progressWrap: { marginTop: 16 },
  progressBar: {
    height: 10, borderRadius: 5, backgroundColor: "#1e1e30", overflow: "hidden",
  },
  progressFill: { height: 10, backgroundColor: "#e63946" },
});

import { useEffect, useState } from "react";
import {
  View, Text, TextInput, TouchableOpacity, Switch, ScrollView,
  StyleSheet, Alert, ActivityIndicator,
} from "react-native";
import { router } from "expo-router";
import {
  loadSettings, saveSettings, Settings, DEFAULT_SETTINGS, saveUser,
  clearUser, clearSession,
} from "../lib/store";
import { getMe, updateMe, logout, Profile } from "../lib/api";
import {
  isMapDownloaded, downloadMap, deleteMap, getLocalManifest,
} from "../lib/tiles";

const INTERVAL_PRESETS_S = [5, 10, 15, 30, 60];

type ProfileForm = Pick<
  Profile,
  "nome" | "cognome" | "telefono" | "gruppo_sanguigno" |
  "emergenza_contatto" | "emergenza_telefono" | "note_salute"
>;
const EMPTY_PROFILE: ProfileForm = {
  nome: "", cognome: "", telefono: "", gruppo_sanguigno: "",
  emergenza_contatto: "", emergenza_telefono: "", note_salute: "",
};

export default function SettingsScreen() {
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [profile, setProfile] = useState<ProfileForm>(EMPTY_PROFILE);
  const [savingProfile, setSavingProfile] = useState(false);
  const [mapReady, setMapReady] = useState(false);
  const [tileCount, setTileCount] = useState<number | null>(null);
  const [downloading, setDownloading] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0 });

  useEffect(() => {
    loadSettings().then(setSettings);
    getMe().then((me) => {
      if (me) {
        setProfile({
          nome: me.nome, cognome: me.cognome, telefono: me.telefono,
          gruppo_sanguigno: me.gruppo_sanguigno,
          emergenza_contatto: me.emergenza_contatto,
          emergenza_telefono: me.emergenza_telefono,
          note_salute: me.note_salute,
        });
      }
    });
    refreshMapStatus();
  }, []);

  async function refreshMapStatus() {
    const ready = await isMapDownloaded();
    setMapReady(ready);
    setTileCount(ready ? (await getLocalManifest())?.count ?? null : null);
  }

  async function update(patch: Partial<Settings>) {
    const next = { ...settings, ...patch };
    setSettings(next);
    await saveSettings(next);
  }

  function setP(patch: Partial<ProfileForm>) {
    setProfile((p) => ({ ...p, ...patch }));
  }

  async function handleSaveProfile() {
    setSavingProfile(true);
    try {
      const ok = await updateMe(profile);
      if (!ok) throw new Error();
      const fresh = await getMe();
      if (fresh) await saveUser(fresh);
      Alert.alert("Profilo", "Dati salvati.");
    } catch {
      Alert.alert("Errore", "Impossibile salvare il profilo.");
    } finally {
      setSavingProfile(false);
    }
  }

  async function handleLogout() {
    await logout();
    await clearUser();
    await clearSession();
    router.replace("/login");
  }

  async function handleDownload() {
    setDownloading(true);
    setProgress({ done: 0, total: 0 });
    try {
      await downloadMap((p) => setProgress(p));
      await refreshMapStatus();
      Alert.alert("Mappa offline", "Download completato.");
    } catch {
      Alert.alert("Errore", "Download non riuscito. Verifica connessione e tile sul server.");
    } finally {
      setDownloading(false);
    }
  }

  function handleDelete() {
    Alert.alert("Elimina mappa offline", "Liberare lo spazio delle tile scaricate?", [
      { text: "Annulla", style: "cancel" },
      {
        text: "Elimina", style: "destructive",
        onPress: async () => { await deleteMap(); await refreshMapStatus(); },
      },
    ]);
  }

  const intervalS = Math.round(settings.gpsIntervalMs / 1000);
  const pct = progress.total ? Math.round((progress.done / progress.total) * 100) : 0;

  return (
    <ScrollView style={s.container} contentContainerStyle={s.inner} keyboardShouldPersistTaps="handled">
      {/* Profilo */}
      <Text style={s.section}>Profilo</Text>
      <Text style={s.hint}>Questi dati raggiungono i soccorsi in caso di emergenza.</Text>
      <View style={s.row2}>
        <TextInput style={[s.input, s.half]} placeholder="Nome" placeholderTextColor="#666"
          value={profile.nome} onChangeText={(v) => setP({ nome: v })} />
        <TextInput style={[s.input, s.half]} placeholder="Cognome" placeholderTextColor="#666"
          value={profile.cognome} onChangeText={(v) => setP({ cognome: v })} />
      </View>
      <TextInput style={s.input} placeholder="Telefono" placeholderTextColor="#666"
        keyboardType="phone-pad" value={profile.telefono} onChangeText={(v) => setP({ telefono: v })} />
      <TextInput style={s.input} placeholder="Gruppo sanguigno (es. 0+)" placeholderTextColor="#666"
        autoCapitalize="characters" value={profile.gruppo_sanguigno} onChangeText={(v) => setP({ gruppo_sanguigno: v })} />
      <TextInput style={s.input} placeholder="Contatto d'emergenza (nome)" placeholderTextColor="#666"
        value={profile.emergenza_contatto} onChangeText={(v) => setP({ emergenza_contatto: v })} />
      <TextInput style={s.input} placeholder="Telefono contatto d'emergenza" placeholderTextColor="#666"
        keyboardType="phone-pad" value={profile.emergenza_telefono} onChangeText={(v) => setP({ emergenza_telefono: v })} />
      <TextInput style={[s.input, s.multiline]} placeholder="Note di salute (allergie, terapie…)" placeholderTextColor="#666"
        multiline value={profile.note_salute} onChangeText={(v) => setP({ note_salute: v })} />
      <TouchableOpacity style={[s.btn, savingProfile && s.btnDisabled]} onPress={handleSaveProfile} disabled={savingProfile}>
        <Text style={s.btnText}>{savingProfile ? "Salvataggio…" : "Salva profilo"}</Text>
      </TouchableOpacity>

      {/* Mappa */}
      <View style={s.divider} />
      <View style={s.rowSwitch}>
        <View style={s.rowText}>
          <Text style={s.section}>Usa mappa offline</Text>
          <Text style={s.hint}>Default: OpenTopoMap online. Attiva per usare le tile scaricate.</Text>
        </View>
        <Switch value={settings.mapOffline} onValueChange={(v) => update({ mapOffline: v })}
          trackColor={{ true: "#e63946", false: "#333" }} thumbColor="#fff" />
      </View>
      {settings.mapOffline && !mapReady && (
        <Text style={s.warn}>⚠️ Mappa offline non ancora scaricata — scaricala qui sotto.</Text>
      )}
      {downloading ? (
        <View style={s.progressWrap}>
          <View style={s.progressBar}><View style={[s.progressFill, { width: `${pct}%` }]} /></View>
          <Text style={s.hint}>{progress.total ? `${progress.done} / ${progress.total} tile (${pct}%)` : "Preparazione…"}</Text>
          <ActivityIndicator color="#e63946" style={{ marginTop: 10 }} />
        </View>
      ) : mapReady ? (
        <>
          <Text style={s.ok}>✓ Mappa scaricata{tileCount ? ` — ${tileCount} tile` : ""}</Text>
          <TouchableOpacity style={s.btn} onPress={handleDownload}>
            <Text style={s.btnText}>Aggiorna mappa</Text>
          </TouchableOpacity>
          <TouchableOpacity style={s.btnGhost} onPress={handleDelete}>
            <Text style={s.btnGhostText}>Elimina mappa offline</Text>
          </TouchableOpacity>
        </>
      ) : (
        <TouchableOpacity style={s.btn} onPress={handleDownload}>
          <Text style={s.btnText}>Scarica mappa offline</Text>
        </TouchableOpacity>
      )}

      {/* Frequenza pin */}
      <View style={s.divider} />
      <Text style={s.section}>Frequenza aggiornamento pin</Text>
      <Text style={s.hint}>Ogni quanto l'app invia la posizione.</Text>
      <View style={s.chips}>
        {INTERVAL_PRESETS_S.map((sec) => {
          const active = intervalS === sec;
          return (
            <TouchableOpacity key={sec} style={[s.chip, active && s.chipActive]}
              onPress={() => update({ gpsIntervalMs: sec * 1000 })}>
              <Text style={[s.chipText, active && s.chipTextActive]}>{sec}s</Text>
            </TouchableOpacity>
          );
        })}
      </View>
      {intervalS > 30 && (
        <Text style={s.warn}>⚠️ Intervalli lunghi ammorbidiscono il rilevamento automatico delle emergenze.</Text>
      )}

      {/* Alert fuori zona */}
      <View style={s.divider} />
      <View style={s.rowSwitch}>
        <View style={s.rowText}>
          <Text style={s.section}>Avviso "sei fuori zona"</Text>
          <Text style={s.hint}>Notifica quando esci dal cerchio monitorato.</Text>
        </View>
        <Switch value={settings.outOfZoneAlerts} onValueChange={(v) => update({ outOfZoneAlerts: v })}
          trackColor={{ true: "#e63946", false: "#333" }} thumbColor="#fff" />
      </View>

      {/* Logout */}
      <View style={s.divider} />
      <TouchableOpacity style={s.logoutBtn} onPress={handleLogout}>
        <Text style={s.logoutText}>Esci dall'account</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#0f0f1a" },
  inner: { padding: 24, paddingBottom: 48 },
  section: { fontSize: 16, color: "#fff", fontWeight: "bold" },
  hint: { fontSize: 13, color: "#888", marginTop: 4, lineHeight: 18 },
  warn: { fontSize: 13, color: "#f0a500", marginTop: 10 },
  row2: { flexDirection: "row", gap: 12, marginTop: 14 },
  half: { flex: 1 },
  input: {
    width: "100%", backgroundColor: "#1e1e30", color: "#fff",
    borderRadius: 10, padding: 14, fontSize: 16,
    marginTop: 14, borderWidth: 1, borderColor: "#333",
  },
  multiline: { minHeight: 72, textAlignVertical: "top" },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 10, marginTop: 14 },
  chip: {
    paddingVertical: 10, paddingHorizontal: 18, borderRadius: 20,
    borderWidth: 1, borderColor: "#333", backgroundColor: "#1e1e30",
  },
  chipActive: { backgroundColor: "#e63946", borderColor: "#e63946" },
  chipText: { color: "#aaa", fontSize: 15, fontWeight: "600" },
  chipTextActive: { color: "#fff" },
  divider: { height: 1, backgroundColor: "#222", marginVertical: 28 },
  rowSwitch: { flexDirection: "row", alignItems: "center", gap: 16 },
  rowText: { flex: 1 },
  ok: { color: "#2ecc71", fontSize: 14, marginTop: 14, marginBottom: 8 },
  btn: { backgroundColor: "#e63946", borderRadius: 10, padding: 16, alignItems: "center", marginTop: 18 },
  btnDisabled: { opacity: 0.5 },
  btnText: { color: "#fff", fontSize: 16, fontWeight: "bold" },
  btnGhost: { padding: 14, alignItems: "center", marginTop: 4 },
  btnGhostText: { color: "#888", fontSize: 14, textDecorationLine: "underline" },
  progressWrap: { marginTop: 16 },
  progressBar: { height: 10, borderRadius: 5, backgroundColor: "#1e1e30", overflow: "hidden" },
  progressFill: { height: 10, backgroundColor: "#e63946" },
  logoutBtn: {
    padding: 14, alignItems: "center", borderRadius: 10,
    borderWidth: 1, borderColor: "#5a2530",
  },
  logoutText: { color: "#e63946", fontSize: 15, fontWeight: "600" },
});

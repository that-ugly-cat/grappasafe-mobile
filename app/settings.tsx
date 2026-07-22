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
import {
  getMe, updateMe, logout, getDevices, saveDevice, deleteDevice, Profile, Device,
} from "../lib/api";
import {
  isMapDownloaded, downloadMap, deleteMap, getLocalManifest,
} from "../lib/tiles";
import { useT, LANGS, LANG_NAMES, getLang, setLang } from "../lib/i18n";

const INTERVAL_PRESETS_S = [5, 10, 15, 30, 60];

type ProfileForm = Pick<
  Profile,
  "nome" | "cognome" | "telefono" | "data_nascita" | "gruppo_sanguigno" |
  "emergenza_contatto" | "emergenza_telefono" | "note_salute"
>;
const EMPTY_PROFILE: ProfileForm = {
  nome: "", cognome: "", telefono: "", data_nascita: "", gruppo_sanguigno: "",
  emergenza_contatto: "", emergenza_telefono: "", note_salute: "",
};

export default function SettingsScreen() {
  const t = useT();
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [profile, setProfile] = useState<ProfileForm>(EMPTY_PROFILE);
  const [savingProfile, setSavingProfile] = useState(false);
  const [mapReady, setMapReady] = useState(false);
  const [tileCount, setTileCount] = useState<number | null>(null);
  const [downloading, setDownloading] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [devices, setDevices] = useState<Device[]>([]);
  const [showDeviceForm, setShowDeviceForm] = useState(false);
  const [editDevId, setEditDevId] = useState<number | null>(null);
  const [devName, setDevName] = useState("");
  const [devOgn, setDevOgn] = useState("");
  const [savingDevice, setSavingDevice] = useState(false);

  useEffect(() => {
    loadSettings().then(setSettings);
    refreshDevices();
    getMe().then((me) => {
      if (me) {
        setProfile({
          nome: me.nome, cognome: me.cognome, telefono: me.telefono,
          data_nascita: me.data_nascita,
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

  async function refreshDevices() {
    setDevices(await getDevices());
  }

  function openAddDevice() {
    setEditDevId(null);
    setDevName("");
    setDevOgn("");
    setShowDeviceForm(true);
  }

  function openEditDevice(d: Device) {
    setEditDevId(d.id);
    setDevName(d.display_name);
    setDevOgn(d.ogn_id || "");
    setShowDeviceForm(true);
  }

  async function saveDeviceForm() {
    if (!devName.trim()) {
      Alert.alert(t("common.warning"), t("settings.wingNameRequired"));
      return;
    }
    setSavingDevice(true);
    try {
      const ok = await saveDevice(
        { display_name: devName.trim(), ogn_id: devOgn.trim() || undefined },
        editDevId ?? undefined
      );
      if (!ok) throw new Error();
      setShowDeviceForm(false);
      await refreshDevices();
    } catch {
      Alert.alert(t("common.error"), t("settings.deviceSaveError"));
    } finally {
      setSavingDevice(false);
    }
  }

  function removeDevice(id: number) {
    Alert.alert(t("common.delete"), t("settings.deleteDeviceMsg"), [
      { text: t("common.cancel"), style: "cancel" },
      {
        text: t("common.delete"),
        style: "destructive",
        onPress: async () => {
          await deleteDevice(id);
          await refreshDevices();
        },
      },
    ]);
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
      Alert.alert(t("settings.profile"), t("settings.profileSaved"));
    } catch {
      Alert.alert(t("common.error"), t("settings.profileSaveError"));
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
      Alert.alert(t("settings.offlineMapTitle"), t("settings.downloadDone"));
    } catch {
      Alert.alert(t("common.error"), t("settings.downloadError"));
    } finally {
      setDownloading(false);
    }
  }

  function handleDelete() {
    Alert.alert(t("settings.deleteOfflineMap"), t("settings.deleteOfflineMapMsg"), [
      { text: t("common.cancel"), style: "cancel" },
      {
        text: t("common.delete"), style: "destructive",
        onPress: async () => { await deleteMap(); await refreshMapStatus(); },
      },
    ]);
  }

  const intervalS = Math.round(settings.gpsIntervalMs / 1000);
  const pct = progress.total ? Math.round((progress.done / progress.total) * 100) : 0;

  return (
    <ScrollView style={s.container} contentContainerStyle={s.inner} keyboardShouldPersistTaps="handled">
      {/* Profilo */}
      <Text style={s.section}>{t("settings.profile")}</Text>
      <Text style={s.hint}>{t("settings.profileHint")}</Text>
      <View style={s.row2}>
        <TextInput style={[s.input, s.half]} placeholder={t("register.name")} placeholderTextColor="#666"
          value={profile.nome} onChangeText={(v) => setP({ nome: v })} />
        <TextInput style={[s.input, s.half]} placeholder={t("register.surname")} placeholderTextColor="#666"
          value={profile.cognome} onChangeText={(v) => setP({ cognome: v })} />
      </View>
      <TextInput style={s.input} placeholder={t("settings.phone")} placeholderTextColor="#666"
        keyboardType="phone-pad" value={profile.telefono} onChangeText={(v) => setP({ telefono: v })} />
      <TextInput style={s.input}
        placeholder={t("register.dob") + " (" + t("register.dobPlaceholder") + ")"}
        placeholderTextColor="#666"
        value={profile.data_nascita} onChangeText={(v) => setP({ data_nascita: v })} />
      <TextInput style={s.input} placeholder={t("register.bloodType")} placeholderTextColor="#666"
        autoCapitalize="characters" value={profile.gruppo_sanguigno} onChangeText={(v) => setP({ gruppo_sanguigno: v })} />
      <TextInput style={s.input} placeholder={t("register.emergencyContactName")} placeholderTextColor="#666"
        value={profile.emergenza_contatto} onChangeText={(v) => setP({ emergenza_contatto: v })} />
      <TextInput style={s.input} placeholder={t("register.emergencyContactPhone")} placeholderTextColor="#666"
        keyboardType="phone-pad" value={profile.emergenza_telefono} onChangeText={(v) => setP({ emergenza_telefono: v })} />
      <TextInput style={[s.input, s.multiline]} placeholder={t("settings.healthNotes")} placeholderTextColor="#666"
        multiline value={profile.note_salute} onChangeText={(v) => setP({ note_salute: v })} />
      <TouchableOpacity style={[s.btn, savingProfile && s.btnDisabled]} onPress={handleSaveProfile} disabled={savingProfile}>
        <Text style={s.btnText}>{savingProfile ? t("common.saving") : t("settings.saveProfile")}</Text>
      </TouchableOpacity>

      {/* Vela / device */}
      <View style={s.divider} />
      <Text style={s.section}>{t("settings.devicesTitle")}</Text>
      <Text style={s.hint}>{t("settings.devicesHint")}</Text>
      {devices.map((d) => (
        <View key={d.id} style={s.deviceRow}>
          <View style={{ flex: 1 }}>
            <Text style={s.deviceName}>{d.display_name}</Text>
            {d.ogn_id ? <Text style={s.hint}>OGN/FLARM: {d.ogn_id}</Text> : null}
          </View>
          <TouchableOpacity onPress={() => openEditDevice(d)}>
            <Text style={s.linkAction}>{t("settings.edit")}</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => removeDevice(d.id)}>
            <Text style={s.linkDanger}>{t("common.delete")}</Text>
          </TouchableOpacity>
        </View>
      ))}
      {showDeviceForm ? (
        <View style={{ marginTop: 8 }}>
          <TextInput
            style={s.input} placeholder={t("settings.wingNamePlaceholder")} placeholderTextColor="#666"
            value={devName} onChangeText={setDevName}
          />
          <TextInput
            style={s.input} placeholder={t("settings.ognIdOptional")} placeholderTextColor="#666"
            autoCapitalize="characters" autoCorrect={false}
            value={devOgn} onChangeText={setDevOgn}
          />
          <TouchableOpacity style={[s.btn, savingDevice && s.btnDisabled]} onPress={saveDeviceForm} disabled={savingDevice}>
            <Text style={s.btnText}>{savingDevice ? t("common.saving") : t("common.save")}</Text>
          </TouchableOpacity>
          <TouchableOpacity style={s.btnGhost} onPress={() => setShowDeviceForm(false)}>
            <Text style={s.btnGhostText}>{t("common.cancel")}</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <TouchableOpacity style={s.btnGhost} onPress={openAddDevice}>
          <Text style={s.linkAction}>{t("settings.addDevice")}</Text>
        </TouchableOpacity>
      )}

      {/* Mappa */}
      <View style={s.divider} />
      <View style={s.rowSwitch}>
        <View style={s.rowText}>
          <Text style={s.section}>{t("settings.useOfflineMap")}</Text>
          <Text style={s.hint}>{t("settings.offlineMapHint")}</Text>
        </View>
        <Switch value={settings.mapOffline} onValueChange={(v) => update({ mapOffline: v })}
          trackColor={{ true: "#e63946", false: "#333" }} thumbColor="#fff" />
      </View>
      {settings.mapOffline && !mapReady && (
        <Text style={s.warn}>{t("settings.offlineNotDownloaded")}</Text>
      )}
      {downloading ? (
        <View style={s.progressWrap}>
          <View style={s.progressBar}><View style={[s.progressFill, { width: `${pct}%` }]} /></View>
          <Text style={s.hint}>{progress.total ? t("settings.tilesProgress", { done: progress.done, total: progress.total, pct }) : t("settings.preparing")}</Text>
          <ActivityIndicator color="#e63946" style={{ marginTop: 10 }} />
        </View>
      ) : mapReady ? (
        <>
          <Text style={s.ok}>{t("settings.mapDownloaded")}{tileCount ? t("settings.mapDownloadedTiles", { n: tileCount }) : ""}</Text>
          <TouchableOpacity style={s.btn} onPress={handleDownload}>
            <Text style={s.btnText}>{t("settings.updateMap")}</Text>
          </TouchableOpacity>
          <TouchableOpacity style={s.btnGhost} onPress={handleDelete}>
            <Text style={s.btnGhostText}>{t("settings.deleteOfflineMap")}</Text>
          </TouchableOpacity>
        </>
      ) : (
        <TouchableOpacity style={s.btn} onPress={handleDownload}>
          <Text style={s.btnText}>{t("settings.downloadOfflineMap")}</Text>
        </TouchableOpacity>
      )}

      {/* Frequenza pin */}
      <View style={s.divider} />
      <Text style={s.section}>{t("settings.gpsFreqTitle")}</Text>
      <Text style={s.hint}>{t("settings.gpsFreqHint")}</Text>
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
        <Text style={s.warn}>{t("settings.gpsFreqWarn")}</Text>
      )}

      {/* Alert fuori zona */}
      <View style={s.divider} />
      <View style={s.rowSwitch}>
        <View style={s.rowText}>
          <Text style={s.section}>{t("settings.outOfZoneTitle")}</Text>
          <Text style={s.hint}>{t("settings.outOfZoneHint")}</Text>
        </View>
        <Switch value={settings.outOfZoneAlerts} onValueChange={(v) => update({ outOfZoneAlerts: v })}
          trackColor={{ true: "#e63946", false: "#333" }} thumbColor="#fff" />
      </View>

      {/* Lingua */}
      <View style={s.divider} />
      <Text style={s.section}>{t("settings.language")}</Text>
      <View style={s.chips}>
        {LANGS.map((l) => {
          const active = getLang() === l;
          return (
            <TouchableOpacity key={l} style={[s.chip, active && s.chipActive]}
              onPress={() => setLang(l)}>
              <Text style={[s.chipText, active && s.chipTextActive]}>{LANG_NAMES[l]}</Text>
            </TouchableOpacity>
          );
        })}
      </View>

      {/* Logout */}
      <View style={s.divider} />
      <TouchableOpacity style={s.logoutBtn} onPress={handleLogout}>
        <Text style={s.logoutText}>{t("settings.logout")}</Text>
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
  deviceRow: {
    flexDirection: "row", alignItems: "center", gap: 14,
    paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: "#222",
  },
  deviceName: { color: "#eee", fontSize: 15, fontWeight: "600" },
  linkAction: { color: "#e63946", fontSize: 14, fontWeight: "600" },
  linkDanger: { color: "#888", fontSize: 14 },
  progressWrap: { marginTop: 16 },
  progressBar: { height: 10, borderRadius: 5, backgroundColor: "#1e1e30", overflow: "hidden" },
  progressFill: { height: 10, backgroundColor: "#e63946" },
  logoutBtn: {
    padding: 14, alignItems: "center", borderRadius: 10,
    borderWidth: 1, borderColor: "#5a2530",
  },
  logoutText: { color: "#e63946", fontSize: 15, fontWeight: "600" },
});

import { useState } from "react";
import {
  View, Text, TextInput, TouchableOpacity, Image, ScrollView,
  StyleSheet, KeyboardAvoidingView, Platform, Alert, Linking,
} from "react-native";
import { router } from "expo-router";
import { login, getMe, API_BASE } from "../lib/api";
import { saveUser } from "../lib/store";
import { useT } from "../lib/i18n";

export default function LoginScreen() {
  const t = useT();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleLogin() {
    if (!username.trim() || !password.trim()) {
      Alert.alert(t("common.warning"), t("login.needUserPass"));
      return;
    }
    setLoading(true);
    try {
      const result = await login(username.trim(), password);
      if (!result.ok) {
        Alert.alert(t("common.error"), result.error ?? t("login.loginFailed"));
        return;
      }
      const me = await getMe();
      if (!me) {
        Alert.alert(t("common.error"), t("login.cannotFetchProfile"));
        return;
      }
      await saveUser(me);
      router.replace("/map");
    } catch (e) {
      Alert.alert(t("common.netError"), t("common.cannotReachServer"));
    } finally {
      setLoading(false);
    }
  }

  return (
    <KeyboardAvoidingView
      style={s.container}
      behavior={Platform.OS === "ios" ? "padding" : "height"}
    >
      <ScrollView
        contentContainerStyle={s.inner}
        keyboardShouldPersistTaps="handled"
      >
        <View style={s.logoBox}>
          <Image
            source={require("../assets/logo-consorzio.png")}
            style={s.logoImg}
            resizeMode="contain"
          />
        </View>
        <Text style={s.appName}>GrappaSafe</Text>
        <Text style={s.subtitle}>{t("login.subtitle")}</Text>

        <TextInput
          style={s.input}
          placeholder={t("common.username")}
          placeholderTextColor="#666"
          autoCapitalize="none"
          autoCorrect={false}
          value={username}
          onChangeText={setUsername}
        />
        <TextInput
          style={s.input}
          placeholder={t("common.password")}
          placeholderTextColor="#666"
          secureTextEntry
          autoCapitalize="none"
          autoCorrect={false}
          value={password}
          onChangeText={setPassword}
          onSubmitEditing={handleLogin}
        />

        <TouchableOpacity
          style={[s.btn, loading && s.btnDisabled]}
          onPress={handleLogin}
          disabled={loading}
        >
          <Text style={s.btnText}>{loading ? t("login.loading") : t("login.signIn")}</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={s.btnSecondary}
          onPress={() => Linking.openURL(`${API_BASE}/register?from=app`)}
          disabled={loading}
        >
          <Text style={s.btnSecondaryText}>{t("login.noAccount")}</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={s.forgot}
          onPress={() => Linking.openURL(`${API_BASE}/forgot`)}
          disabled={loading}
        >
          <Text style={s.forgotText}>{t("login.forgotPassword")}</Text>
        </TouchableOpacity>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#0f0f1a" },
  inner: {
    flexGrow: 1, justifyContent: "center", alignItems: "center", padding: 32,
  },
  logoBox: {
    backgroundColor: "#fff", borderRadius: 14,
    paddingVertical: 16, paddingHorizontal: 24, marginBottom: 20,
  },
  logoImg: { width: 220, height: 92 },
  appName: { fontSize: 30, color: "#e63946", fontWeight: "bold", marginBottom: 6 },
  subtitle: { fontSize: 14, color: "#888", marginBottom: 40 },
  input: {
    width: "100%", backgroundColor: "#1e1e30", color: "#fff",
    borderRadius: 10, padding: 14, fontSize: 16,
    marginBottom: 14, borderWidth: 1, borderColor: "#333",
  },
  btn: {
    width: "100%", backgroundColor: "#e63946", borderRadius: 10,
    padding: 16, alignItems: "center", marginTop: 8,
  },
  btnDisabled: { opacity: 0.5 },
  btnText: { color: "#fff", fontSize: 18, fontWeight: "bold" },
  btnSecondary: {
    width: "100%", padding: 14, alignItems: "center", marginTop: 16,
  },
  btnSecondaryText: { color: "#e63946", fontSize: 15, fontWeight: "600" },
  forgot: { width: "100%", padding: 8, alignItems: "center" },
  forgotText: { color: "#888", fontSize: 14, textDecorationLine: "underline" },
});

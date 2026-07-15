import { useState } from "react";
import {
  View, Text, TextInput, TouchableOpacity,
  StyleSheet, KeyboardAvoidingView, Platform, Alert,
} from "react-native";
import { router } from "expo-router";
import { login, getMe } from "../lib/api";
import { saveUser } from "../lib/store";

export default function LoginScreen() {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleLogin() {
    if (!username.trim() || !password.trim()) {
      Alert.alert("Attenzione", "Inserisci username e password");
      return;
    }
    setLoading(true);
    try {
      const result = await login(username.trim(), password);
      if (!result.ok) {
        Alert.alert("Errore", result.error ?? "Login fallito");
        return;
      }
      const me = await getMe();
      if (!me) {
        Alert.alert("Errore", "Impossibile recuperare il profilo");
        return;
      }
      await saveUser(me);
      router.replace("/dashboard");
    } catch (e) {
      Alert.alert("Errore di rete", "Impossibile contattare il server");
    } finally {
      setLoading(false);
    }
  }

  return (
    <KeyboardAvoidingView
      style={s.container}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <View style={s.inner}>
        <Text style={s.logo}>⛰ GrappaSafe</Text>
        <Text style={s.subtitle}>Consorzio di Volo del Grappa</Text>

        <TextInput
          style={s.input}
          placeholder="Username"
          placeholderTextColor="#666"
          autoCapitalize="none"
          autoCorrect={false}
          value={username}
          onChangeText={setUsername}
        />
        <TextInput
          style={s.input}
          placeholder="Password"
          placeholderTextColor="#666"
          secureTextEntry
          value={password}
          onChangeText={setPassword}
          onSubmitEditing={handleLogin}
        />

        <TouchableOpacity
          style={[s.btn, loading && s.btnDisabled]}
          onPress={handleLogin}
          disabled={loading}
        >
          <Text style={s.btnText}>{loading ? "Accesso..." : "Accedi"}</Text>
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#0f0f1a" },
  inner: {
    flex: 1, justifyContent: "center", alignItems: "center", padding: 32,
  },
  logo: { fontSize: 36, color: "#e63946", fontWeight: "bold", marginBottom: 8 },
  subtitle: { fontSize: 14, color: "#888", marginBottom: 48 },
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
});

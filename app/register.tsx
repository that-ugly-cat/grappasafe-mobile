import { useState } from "react";
import {
  View, Text, TextInput, TouchableOpacity, ScrollView,
  StyleSheet, KeyboardAvoidingView, Platform, Alert,
} from "react-native";
import { router } from "expo-router";
import { register, getMe } from "../lib/api";
import { saveUser } from "../lib/store";

export default function RegisterScreen() {
  const [nome, setNome] = useState("");
  const [cognome, setCognome] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [telefono, setTelefono] = useState("");
  const [gruppo, setGruppo] = useState("");
  const [emContatto, setEmContatto] = useState("");
  const [emTelefono, setEmTelefono] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleRegister() {
    if (!nome.trim() || !cognome.trim() || !username.trim() || !password) {
      Alert.alert("Attenzione", "Nome, cognome, username e password sono obbligatori");
      return;
    }
    if (password.length < 6) {
      Alert.alert("Attenzione", "La password deve avere almeno 6 caratteri");
      return;
    }
    setLoading(true);
    try {
      const result = await register({
        username: username.trim(),
        password,
        nome: nome.trim(),
        cognome: cognome.trim(),
        telefono: telefono.trim() || undefined,
        gruppo_sanguigno: gruppo.trim() || undefined,
        emergenza_contatto: emContatto.trim() || undefined,
        emergenza_telefono: emTelefono.trim() || undefined,
      });
      if (!result.ok) {
        Alert.alert("Errore", result.error ?? "Registrazione non riuscita");
        return;
      }
      // Il server ha già creato la sessione: recupera il profilo e prosegui.
      const me = await getMe();
      if (!me) {
        Alert.alert("Errore", "Account creato ma impossibile recuperare il profilo");
        return;
      }
      await saveUser(me);
      router.replace("/map");
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
      <ScrollView
        contentContainerStyle={s.inner}
        keyboardShouldPersistTaps="handled"
      >
        <Text style={s.title}>Crea il tuo account</Text>
        <Text style={s.subtitle}>Consorzio di Volo del Grappa</Text>

        <Text style={s.section}>Dati personali</Text>
        <TextInput
          style={s.input} placeholder="Nome" placeholderTextColor="#666"
          value={nome} onChangeText={setNome}
        />
        <TextInput
          style={s.input} placeholder="Cognome" placeholderTextColor="#666"
          value={cognome} onChangeText={setCognome}
        />
        <TextInput
          style={s.input} placeholder="Username" placeholderTextColor="#666"
          autoCapitalize="none" autoCorrect={false}
          value={username} onChangeText={setUsername}
        />
        <TextInput
          style={s.input} placeholder="Password (min 6 caratteri)" placeholderTextColor="#666"
          secureTextEntry autoCapitalize="none" autoCorrect={false}
          value={password} onChangeText={setPassword}
        />

        <Text style={s.section}>Dati d'emergenza (opzionali)</Text>
        <TextInput
          style={s.input} placeholder="Il tuo telefono" placeholderTextColor="#666"
          keyboardType="phone-pad"
          value={telefono} onChangeText={setTelefono}
        />
        <TextInput
          style={s.input} placeholder="Gruppo sanguigno (es. 0+)" placeholderTextColor="#666"
          autoCapitalize="characters"
          value={gruppo} onChangeText={setGruppo}
        />
        <TextInput
          style={s.input} placeholder="Contatto d'emergenza (nome)" placeholderTextColor="#666"
          value={emContatto} onChangeText={setEmContatto}
        />
        <TextInput
          style={s.input} placeholder="Telefono contatto d'emergenza" placeholderTextColor="#666"
          keyboardType="phone-pad"
          value={emTelefono} onChangeText={setEmTelefono}
        />

        <TouchableOpacity
          style={[s.btn, loading && s.btnDisabled]}
          onPress={handleRegister}
          disabled={loading}
        >
          <Text style={s.btnText}>{loading ? "Creazione..." : "Registrati"}</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={s.btnSecondary}
          onPress={() => router.back()}
          disabled={loading}
        >
          <Text style={s.btnSecondaryText}>Hai già un account? Accedi</Text>
        </TouchableOpacity>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#0f0f1a" },
  inner: { padding: 32, paddingTop: 48, paddingBottom: 48 },
  title: { fontSize: 26, color: "#e63946", fontWeight: "bold", marginBottom: 6 },
  subtitle: { fontSize: 14, color: "#888", marginBottom: 24 },
  section: {
    fontSize: 13, color: "#888", fontWeight: "600",
    textTransform: "uppercase", marginTop: 12, marginBottom: 10,
  },
  input: {
    width: "100%", backgroundColor: "#1e1e30", color: "#fff",
    borderRadius: 10, padding: 14, fontSize: 16,
    marginBottom: 14, borderWidth: 1, borderColor: "#333",
  },
  btn: {
    width: "100%", backgroundColor: "#e63946", borderRadius: 10,
    padding: 16, alignItems: "center", marginTop: 12,
  },
  btnDisabled: { opacity: 0.5 },
  btnText: { color: "#fff", fontSize: 18, fontWeight: "bold" },
  btnSecondary: { width: "100%", padding: 14, alignItems: "center", marginTop: 8 },
  btnSecondaryText: { color: "#e63946", fontSize: 15, fontWeight: "600" },
});

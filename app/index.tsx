import { useEffect } from "react";
import { View, ActivityIndicator } from "react-native";
import { router } from "expo-router";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { loadUser } from "../lib/store";
import { checkAuth } from "../lib/api";

export default function SplashRedirect() {
  useEffect(() => {
    (async () => {
      const user = await loadUser();
      if (!user) {
        router.replace("/login");
        return;
      }
      // Emergenza pending (notifica toccata ad app chiusa): niente giro di
      // verifica sessione — dritto alla mappa, il cui poll apre subito /alarm.
      // Ogni secondo qui è un secondo del countdown di conferma.
      const pending = await AsyncStorage.getItem("pending_emergency");
      if (pending) {
        router.replace("/map");
        return;
      }
      // Verifica la sessione server. Solo un 401 esplicito manda al login:
      // offline (o server giù) si prosegue con l'utente in cache — l'app deve
      // restare usabile in montagna senza segnale (mappa offline, SOS in coda).
      const auth = await checkAuth();
      if (auth === "unauthorized") {
        router.replace("/login");
        return;
      }
      router.replace("/map");
    })();
  }, []);

  return (
    <View style={{ flex: 1, backgroundColor: "#0f0f1a", alignItems: "center", justifyContent: "center" }}>
      <ActivityIndicator size="large" color="#e63946" />
    </View>
  );
}

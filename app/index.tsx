import { useEffect } from "react";
import { View, ActivityIndicator } from "react-native";
import { router } from "expo-router";
import { loadUser } from "../lib/store";
import { getMe } from "../lib/api";

export default function SplashRedirect() {
  useEffect(() => {
    (async () => {
      const user = await loadUser();
      if (!user) {
        router.replace("/login");
        return;
      }
      // verifica che la sessione server sia ancora valida
      const me = await getMe();
      if (!me) {
        router.replace("/login");
        return;
      }
      // La MapScreen gestisce da sé lo stato (idle / live / emergency).
      router.replace("/map");
    })();
  }, []);

  return (
    <View style={{ flex: 1, backgroundColor: "#0f0f1a", alignItems: "center", justifyContent: "center" }}>
      <ActivityIndicator size="large" color="#e63946" />
    </View>
  );
}

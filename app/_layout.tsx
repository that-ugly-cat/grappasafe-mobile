import { useEffect, useRef } from "react";
import { Platform } from "react-native";
import { Stack, router } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { SafeAreaProvider } from "react-native-safe-area-context";
import * as Notifications from "expo-notifications";

// Controlla come mostrare la notifica quando l'app è in foreground.
// shouldShowBanner: true → mostra il banner anche se l'app è aperta.
// shouldShowList: true → tiene la notifica nel centro notifiche.
// Con le emergenze vogliamo il banner + suono anche in foreground.
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList:   true,
    shouldPlaySound:  true,
    shouldSetBadge:   false,
  }),
});

export default function RootLayout() {
  const responseListener = useRef<Notifications.Subscription | null>(null);

  useEffect(() => {
    // Crea il canale Android ad alta priorità (ignorato su iOS)
    if (Platform.OS === "android") {
      Notifications.setNotificationChannelAsync("emergency", {
        name:             "Emergenza GrappaSafe",
        importance:       Notifications.AndroidImportance.MAX,
        vibrationPattern: [0, 250, 250, 250],
        lightColor:       "#e63946",
        sound:            "default",
        bypassDnd:        true,
      });
    }

    // Richiede i permessi per le notifiche (necessario su iOS, best-practice su Android 13+)
    Notifications.requestPermissionsAsync().catch(() => {});

    // Listener: utente tocca una notifica (app in background o chiusa)
    responseListener.current = Notifications.addNotificationResponseReceivedListener(
      (response) => {
        const data = response.notification.request.content.data as
          | { trigger?: string; expires_in?: number }
          | undefined;

        // Naviga alla schermata allarme passando i dati dalla notifica
        router.push({
          pathname: "/alarm",
          params: {
            trigger:    String(data?.trigger    ?? ""),
            expires_in: String(data?.expires_in ?? 180),
          },
        });
      }
    );

    return () => {
      responseListener.current?.remove();
    };
  }, []);

  return (
    <SafeAreaProvider>
      <StatusBar style="light" />
      <Stack
        screenOptions={{
          headerStyle:      { backgroundColor: "#1a1a2e" },
          headerTintColor:  "#e63946",
          headerTitleStyle: { fontWeight: "bold" },
          contentStyle:     { backgroundColor: "#0f0f1a" },
        }}
      >
        <Stack.Screen name="index"    options={{ headerShown: false }} />
        <Stack.Screen name="login"    options={{ title: "GrappaSafe", headerShown: false }} />
        <Stack.Screen name="register" options={{ title: "Registrati" }} />
        <Stack.Screen name="map"      options={{ headerShown: false }} />
        <Stack.Screen name="settings" options={{ title: "Impostazioni" }} />
        <Stack.Screen
          name="alarm"
          options={{
            title:           "Emergenza",
            headerShown:     false,   // full screen, nessun header
            headerBackVisible: false,
            gestureEnabled:  false,   // niente swipe per chiudere
          }}
        />
      </Stack>
    </SafeAreaProvider>
  );
}

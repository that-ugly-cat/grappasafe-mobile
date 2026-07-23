import { useEffect, useRef } from "react";
import { Platform } from "react-native";
import { Stack, router } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { SafeAreaProvider } from "react-native-safe-area-context";
import * as Notifications from "expo-notifications";
import { useT, initLang } from "../lib/i18n";

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
  const t = useT();
  const responseListener = useRef<Notifications.Subscription | null>(null);

  // Applica la lingua salvata (override sulla lingua del dispositivo).
  useEffect(() => {
    initLang();
  }, []);

  useEffect(() => {
    // Crea il canale Android ad alta priorità (ignorato su iOS)
    if (Platform.OS === "android") {
      // id "-v3": le impostazioni di un canale sono immutabili dopo la creazione,
      // quindi per cambiare gli audioAttributes serve un canale nuovo.
      Notifications.setNotificationChannelAsync("emergency-v3", {
        name:             t("notif.channelName"),
        importance:       Notifications.AndroidImportance.MAX,
        vibrationPattern: [0, 250, 250, 250],
        lightColor:       "#e63946",
        sound:            "alarm.wav",
        bypassDnd:        true,
        // Suono sullo stream SVEGLIA, non su quello notifiche: la modalità
        // silenziosa azzera il ring/notification stream ma NON quello alarm,
        // quindi la pre-emergenza si sente anche a telefono in silenzioso e
        // schermo spento. enforceAudibility forza l'audibilità anche in DND.
        audioAttributes: {
          usage:       Notifications.AndroidAudioUsage.ALARM,
          contentType: Notifications.AndroidAudioContentType.SONIFICATION,
          flags:       { enforceAudibility: true, requestHardwareAudioVideoSynchronization: false },
        },
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

        // Apri l'allarme SOLO per le notifiche d'emergenza (hanno un trigger).
        // Senza questa guardia, toccare la notifica persistente del
        // foreground-service ("monitoraggio in corso") per riaprire l'app aprirebbe
        // un falso allarme "situazione anomala" (trigger vuoto → messaggio default).
        if (!data?.trigger) return;

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
        <Stack.Screen name="map"      options={{ headerShown: false }} />
        <Stack.Screen name="settings" options={{ title: t("nav.settings") }} />
        <Stack.Screen
          name="alarm"
          options={{
            title:           t("nav.emergency"),
            headerShown:     false,   // full screen, nessun header
            headerBackVisible: false,
            gestureEnabled:  false,   // niente swipe per chiudere
          }}
        />
      </Stack>
    </SafeAreaProvider>
  );
}

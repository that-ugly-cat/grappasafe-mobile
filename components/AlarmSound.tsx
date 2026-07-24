import { useEffect, useRef } from "react";
import { useAudioPlayer, setAudioModeAsync } from "expo-audio";
import { VolumeManager } from "react-native-volume-manager";

/**
 * AlarmSound — sirena d'emergenza: loop a volume massimo, anche a telefono
 * silenzioso. Forza il volume media al max su Android e suona attraverso il
 * silenzioso su iOS, ripristinando il volume precedente allo smontaggio.
 *
 * Isolato in un componente a sé perché usa moduli nativi (expo-audio,
 * react-native-volume-manager) NON presenti in Expo Go: il loro import lancia
 * quando i moduli non sono linkati. Per questo viene montato solo da
 * `SafeAlarmSound` (require protetto + error boundary), mai importato
 * staticamente da una schermata/route — altrimenti l'import fallito farebbe
 * cadere l'intera route (`/alarm` → "unmatched route" in Expo Go).
 *
 * Non renderizza nulla: è puro effetto collaterale audio. Suona finché è
 * montato; smontarlo (es. emergenza risolta) ferma la sirena e ripristina il
 * volume.
 */
export default function AlarmSound() {
  const player = useAudioPlayer(require("../assets/alarm.wav"));
  const prevVolume = useRef<number | null>(null);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        await setAudioModeAsync({
          playsInSilentMode: true,        // iOS: suona anche con l'interruttore silenzioso
          interruptionMode: "doNotMix",   // prende il focus audio
          // La sirena deve continuare anche se l'utente spegne lo schermo o
          // l'app finisce in background durante l'allarme: è il punto stesso
          // della sirena (richiamare l'attenzione finché non si risponde).
          shouldPlayInBackground: true,
        });
        const cur = await VolumeManager.getVolume();
        prevVolume.current = typeof cur?.volume === "number" ? cur.volume : null;
        await VolumeManager.setVolume(1.0, { showUI: false });   // Android: volume media al max
      } catch { /* volume non forzabile: si suona comunque a volume corrente */ }

      if (cancelled) return;
      try {
        player.loop = true;
        player.volume = 1.0;
        player.play();
      } catch {}
    })();

    return () => {
      cancelled = true;
      try { player.pause(); } catch {}
      if (prevVolume.current != null) {
        VolumeManager.setVolume(prevVolume.current, { showUI: false }).catch(() => {});
        prevVolume.current = null;
      }
    };
  }, []);

  return null;
}

// Suono di conferma ("don-din" ×2): presa in carico dell'emergenza e "sto bene".
// expo-audio è un modulo nativo assente in Expo Go, e il suo import lancia se non
// linkato: lo carichiamo con require protetto così importare questo modulo non
// lancia mai. Se manca, playConfirm() è un no-op silenzioso.
// eslint-disable-next-line @typescript-eslint/no-var-requires
let audio: any = null;
try {
  audio = require("expo-audio");
} catch {
  audio = null;
}

let player: any = null;

/** Riproduce il breve suono di conferma. Fire-and-forget: il player è globale,
 *  quindi il suono continua anche se la schermata che l'ha lanciato si smonta. */
export function playConfirm(): void {
  if (!audio) return;
  try {
    if (!player) player = audio.createAudioPlayer(require("../assets/confirm.wav"));
    player.seekTo(0);
    player.play();
  } catch {
    /* niente audio se il modulo/asset non è disponibile */
  }
}

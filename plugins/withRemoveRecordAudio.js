const { withAndroidManifest, AndroidConfig } = require("@expo/config-plugins");

/**
 * expo-audio dichiara android.permission.RECORD_AUDIO nel proprio manifest
 * nativo (supporta la registrazione). GrappaSafe la sirena la *suona*, non
 * registra nulla: per un'app di sicurezza chiedere il microfono è una bandiera
 * rossa. `microphonePermission: false` sul plugin expo-audio non basta (blocca
 * solo l'aggiunta lato-plugin, non la dichiarazione nel manifest della libreria).
 *
 * Qui iniettiamo `<uses-permission android:name="…RECORD_AUDIO" tools:node="remove"/>`
 * nel manifest dell'app: il merge tool di Android rimuove così il permesso dal
 * manifest finale, ovunque una libreria lo dichiari.
 */
const withRemoveRecordAudio = (config) => {
  return withAndroidManifest(config, (config) => {
    const manifest = config.modResults.manifest;

    // Serve il namespace tools sul <manifest> per usare tools:node.
    AndroidConfig.Manifest.ensureToolsAvailable(config.modResults);

    manifest["uses-permission"] = manifest["uses-permission"] || [];
    const RECORD_AUDIO = "android.permission.RECORD_AUDIO";

    // Via qualsiasi dichiarazione esistente del permesso...
    manifest["uses-permission"] = manifest["uses-permission"].filter(
      (p) => p?.$?.["android:name"] !== RECORD_AUDIO
    );
    // ...e aggiungi la direttiva di rimozione per il merge.
    manifest["uses-permission"].push({
      $: { "android:name": RECORD_AUDIO, "tools:node": "remove" },
    });

    return config;
  });
};

module.exports = withRemoveRecordAudio;

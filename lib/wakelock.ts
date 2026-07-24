// Partial wake lock nativo: tiene la CPU sveglia a schermo spento durante
// un'attività, così l'accelerometro (expo-sensors) continua a consegnare eventi
// e il PICCO d'impatto viene catturato anche col telefono in tasca — esattamente
// come a schermo acceso. Senza, Android sospende il sensore a schermo spento
// (il wake lock della posizione copre solo il GPS).
//
// Il modulo nativo (`modules/wakelock`) è caricato con require protetto: finché
// non è compilato nel build, acquire/release sono no-op silenziosi — nessun crash.
let native: {
  acquire: () => void;
  release: () => void;
  isIgnoringBatteryOptimizations?: () => boolean;
  requestIgnoreBatteryOptimizations?: () => void;
} | null = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { requireNativeModule } = require("expo-modules-core");
  native = requireNativeModule("WakeLock");
} catch {
  native = null;
}

export function acquireWakeLock(): void {
  try {
    native?.acquire();
  } catch {
    /* modulo assente o errore: si prosegue senza wake lock */
  }
}

export function releaseWakeLock(): void {
  try {
    native?.release();
  } catch {
    /* idem */
  }
}

// Esenzione dall'ottimizzazione batteria. Senza, in (light) Doze Android
// sospende la rete e può congelare l'accelerometro: i pin si accumulano in
// outbox e partono solo allo sblocco — il monitoraggio live è cieco proprio
// quando serve. In dubbio (modulo assente, build vecchio senza la funzione)
// si risponde true: meglio nessun prompt che un prompt che non può funzionare.
export function isIgnoringBatteryOptimizations(): boolean {
  try {
    return native?.isIgnoringBatteryOptimizations?.() ?? true;
  } catch {
    return true;
  }
}

/** Apre il dialog di sistema "consenti esecuzione in background". */
export function requestIgnoreBatteryOptimizations(): void {
  try {
    native?.requestIgnoreBatteryOptimizations?.();
  } catch {
    /* modulo assente: no-op */
  }
}

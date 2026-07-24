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
  startAccel?: () => void;
  stopAccel?: () => void;
  getAndResetPeak?: () => number;
  getDiagnostics?: () => WakelockDiagnostics;
  startSender?: (
    url: string, cookie: string, intervalMs: number,
    attivita: string, notifTitle: string, notifBody: string,
  ) => void;
  stopSender?: () => void;
  isSenderRunning?: () => boolean;
  getLastResponse?: () => string;
} | null = null;

export interface WakelockDiagnostics {
  wakeLockHeld: boolean;
  accelActive: boolean;
  /** ms dall'ultimo evento del sensore; -1 = mai visto un evento. */
  lastAccelEventAgeMs: number;
  /** true se il sender nativo sta girando (build recenti). */
  senderRunning?: boolean;
  /** ms dall'ultimo invio riuscito del sender; -1 = mai. */
  lastSentAgeMs?: number;
}
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

// Accelerometro nativo — sostituisce expo-sensors per il rilevamento impatti:
// expo-sensors si disiscrive dal sensore quando l'app va in background
// (schermo spento), quindi i picchi si perdevano proprio nello scenario
// bersaglio. Il listener nativo, col partial wake lock, vive sempre.

/** True se il build include l'accelerometro nativo. */
export function hasNativeAccel(): boolean {
  return typeof native?.getAndResetPeak === "function";
}

export function startNativeAccel(): void {
  try {
    native?.startAccel?.();
  } catch {
    /* modulo assente: no-op */
  }
}

export function stopNativeAccel(): void {
  try {
    native?.stopAccel?.();
  } catch {
    /* idem */
  }
}

/** Picco |accel| in g dall'ultima lettura; azzera la finestra. 1.0 = riposo. */
export function getAndResetNativePeak(): number {
  try {
    return native?.getAndResetPeak?.() ?? 1.0;
  } catch {
    return 1.0;
  }
}

/** Stato reale di wake lock e sensore (null se il build non li espone). */
export function getWakelockDiagnostics(): WakelockDiagnostics | null {
  try {
    return native?.getDiagnostics?.() ?? null;
  } catch {
    return null;
  }
}

// Sender nativo: il trasporto GPS→server a schermo spento. La consegna delle
// posizioni al task JS passa da JobScheduler, che Android congela a schermo
// spento (i job si scaricano in raffica allo sblocco): nessun invio real-time
// può vivere in JS. Il loop nativo, col wake lock, sì.

export function hasNativeSender(): boolean {
  return typeof native?.startSender === "function";
}

export function startNativeSender(opts: {
  url: string;
  cookie: string;
  intervalMs: number;
  attivita: string;
  notifTitle: string;
  notifBody: string;
}): void {
  try {
    native?.startSender?.(
      opts.url, opts.cookie, opts.intervalMs,
      opts.attivita, opts.notifTitle, opts.notifBody,
    );
  } catch {
    /* modulo assente: il task JS resta l'unico trasporto */
  }
}

export function stopNativeSender(): void {
  try {
    native?.stopSender?.();
  } catch {
    /* idem */
  }
}

export function isNativeSenderRunning(): boolean {
  try {
    return native?.isSenderRunning?.() ?? false;
  } catch {
    return false;
  }
}

/** Ultima risposta JSON di /api/gps vista dal sender ("" se nessuna). */
export function getNativeLastResponse(): string {
  try {
    return native?.getLastResponse?.() ?? "";
  } catch {
    return "";
  }
}

package expo.modules.wakelock

import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.PowerManager
import android.provider.Settings
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class WakelockModule : Module() {
  private var wakeLock: PowerManager.WakeLock? = null

  override fun definition() = ModuleDefinition {
    // Nome usato da JS: requireNativeModule("WakeLock").
    Name("WakeLock")

    // Acquisisce un PARTIAL_WAKE_LOCK: la CPU resta sveglia a schermo spento, così
    // l'accelerometro continua a consegnare e il picco d'impatto viene catturato
    // anche col telefono in tasca. Idempotente.
    // NB: niente `return@Function` — dentro Function{} il blocco è tipizzato Any?,
    // un return nudo (Unit) darebbe "Return type mismatch". Solo if annidati.
    Function("acquire") {
      if (wakeLock?.isHeld != true) {
        val pm = appContext.reactContext?.getSystemService(Context.POWER_SERVICE) as? PowerManager
        if (pm != null) {
          wakeLock = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "GrappaSafe::Tracking").apply {
            setReferenceCounted(false)
            acquire()
          }
        }
      }
    }

    // Rilascia il wake lock (fine attività).
    Function("release") {
      wakeLock?.let { if (it.isHeld) it.release() }
      wakeLock = null
    }

    // True se l'app è esente dall'ottimizzazione batteria. Senza esenzione, in
    // (light) Doze Android sospende la RETE e può congelare i sensori: i pin si
    // accumulano e partono solo allo sblocco dello schermo — inaccettabile per
    // il monitoraggio live. In dubbio risponde true (nessun prompt inutile).
    Function("isIgnoringBatteryOptimizations") {
      val ctx = appContext.reactContext
      if (ctx == null) {
        true
      } else {
        val pm = ctx.getSystemService(Context.POWER_SERVICE) as? PowerManager
        pm?.isIgnoringBatteryOptimizations(ctx.packageName) ?: true
      }
    }

    // Apre il dialog di sistema "consenti esecuzione in background" per l'app.
    // Richiede REQUEST_IGNORE_BATTERY_OPTIMIZATIONS nel manifest (app.json).
    Function("requestIgnoreBatteryOptimizations") {
      val ctx = appContext.reactContext
      if (ctx != null) {
        val intent = Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS).apply {
          data = Uri.parse("package:" + ctx.packageName)
          addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        }
        ctx.startActivity(intent)
      }
    }
  }
}

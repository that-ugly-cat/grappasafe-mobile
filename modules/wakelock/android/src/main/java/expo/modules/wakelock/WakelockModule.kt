package expo.modules.wakelock

import android.content.Context
import android.os.PowerManager
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
    Function("acquire") {
      if (wakeLock?.isHeld == true) return@Function
      val ctx = appContext.reactContext ?: return@Function
      val pm = ctx.getSystemService(Context.POWER_SERVICE) as PowerManager
      wakeLock = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "GrappaSafe::Tracking").apply {
        setReferenceCounted(false)
        acquire()
      }
    }

    // Rilascia il wake lock (fine attività).
    Function("release") {
      wakeLock?.let { if (it.isHeld) it.release() }
      wakeLock = null
    }
  }
}

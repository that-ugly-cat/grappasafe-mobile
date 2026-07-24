package expo.modules.wakelock

import android.content.Context
import android.content.Intent
import android.hardware.Sensor
import android.hardware.SensorEvent
import android.hardware.SensorEventListener
import android.hardware.SensorManager
import android.net.Uri
import android.os.PowerManager
import android.provider.Settings
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import kotlin.math.sqrt

class WakelockModule : Module() {
  private var wakeLock: PowerManager.WakeLock? = null
  private var sensorManager: SensorManager? = null
  private var accelListener: SensorEventListener? = null
  @Volatile private var peakG: Double = 1.0
  @Volatile private var lastAccelEventMs: Long = 0L

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

    // ── Accelerometro nativo ─────────────────────────────────────────────────
    // expo-sensors si DISISCRIVE dal sensore quando l'Activity va in background
    // (OnActivityEntersBackground → stopObserving): a schermo spento i picchi
    // d'impatto vanno persi anche con la CPU sveglia. Qui il listener è
    // registrato direttamente sul SensorManager, slegato dal lifecycle: col
    // partial wake lock continua a consegnare anche a schermo spento.
    // Il picco si accumula qui in nativo; il task JS lo preleva a ogni tick GPS
    // con getAndResetPeak. Idempotente.
    Function("startAccel") {
      if (accelListener == null) {
        val ctx = appContext.reactContext
        if (ctx != null) {
          val sm = ctx.getSystemService(Context.SENSOR_SERVICE) as? SensorManager
          val sensor = sm?.getDefaultSensor(Sensor.TYPE_ACCELEROMETER)
          if (sm != null && sensor != null) {
            val listener = object : SensorEventListener {
              override fun onSensorChanged(event: SensorEvent) {
                val x = event.values[0].toDouble()
                val y = event.values[1].toDouble()
                val z = event.values[2].toDouble()
                // Modulo in g (1.0 = a riposo), come si aspetta il server.
                val g = sqrt(x * x + y * y + z * z) / SensorManager.GRAVITY_EARTH
                if (g > peakG) peakG = g
                lastAccelEventMs = System.currentTimeMillis()
              }
              override fun onAccuracyChanged(sensor: Sensor?, accuracy: Int) = Unit
            }
            // SENSOR_DELAY_GAME (~20ms): abbastanza fitto da catturare lo
            // spike di un urto, che dura pochi centisecondi.
            sm.registerListener(listener, sensor, SensorManager.SENSOR_DELAY_GAME)
            sensorManager = sm
            accelListener = listener
          }
        }
      }
    }

    Function("stopAccel") {
      accelListener?.let { sensorManager?.unregisterListener(it) }
      accelListener = null
      peakG = 1.0
    }

    // Picco |accel| in g dall'ultima lettura; azzera la finestra.
    Function("getAndResetPeak") {
      val p = peakG
      peakG = 1.0
      p
    }

    // Stato reale del pipeline nativo, per la diagnostica nel modale permessi:
    // dice se il wake lock è davvero tenuto (o l'OEM l'ha revocato / mai
    // acquisito) e da quanto il sensore non consegna eventi — il modo più
    // rapido per capire dove muore il tracking a schermo spento.
    Function("getDiagnostics") {
      mapOf(
        "wakeLockHeld" to (wakeLock?.isHeld == true),
        "accelActive" to (accelListener != null),
        "lastAccelEventAgeMs" to
          (if (lastAccelEventMs == 0L) -1L else System.currentTimeMillis() - lastAccelEventMs)
      )
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

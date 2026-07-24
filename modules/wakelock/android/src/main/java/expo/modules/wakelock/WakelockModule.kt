package expo.modules.wakelock

import android.app.Notification
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.hardware.Sensor
import android.hardware.SensorEvent
import android.hardware.SensorEventListener
import android.hardware.SensorManager
import android.location.Location
import android.location.LocationListener
import android.location.LocationManager
import android.media.AudioManager
import android.net.Uri
import android.os.BatteryManager
import android.os.Handler
import android.os.HandlerThread
import android.os.PowerManager
import android.provider.Settings
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.TimeZone
import kotlin.math.sqrt

class WakelockModule : Module() {
  private var wakeLock: PowerManager.WakeLock? = null
  private var sensorManager: SensorManager? = null
  private var accelListener: SensorEventListener? = null
  @Volatile private var peakG: Double = 1.0
  @Volatile private var lastAccelEventMs: Long = 0L

  // ── Stato del sender nativo ──────────────────────────────────────────────
  // Il trasporto GPS→server DEVE vivere qui: la consegna delle posizioni al
  // task JS passa da JobScheduler (expo-task-manager), e Android congela i job
  // a schermo spento — il JS riceve tutto in raffica solo allo sblocco. Questo
  // loop gira su un HandlerThread nativo che, col partial wake lock, resta
  // vivo a schermo spento: legge i fix (provider passivo: si aggancia a quelli
  // già prodotti dal foreground service di expo-location, zero GPS extra),
  // preleva il picco accel, POSTa al server e — se il server apre una
  // pre-emergenza — posta la notifica sul canale sveglia anche col JS fermo.
  private var senderThread: HandlerThread? = null
  private var senderHandler: Handler? = null
  @Volatile private var senderRunning = false
  private var passiveListener: LocationListener? = null
  @Volatile private var lastFix: Location? = null
  // Toccati solo dal thread del sender:
  private var lastEnqueuedTs: Long = 0L
  private val sendQueue = ArrayDeque<Pair<Long, JSONObject>>()
  private var pendingNotified = false
  // Config/stato condivisi (scritti da JS, letti dal thread sender):
  @Volatile private var senderUrl = ""
  @Volatile private var senderCookie = ""
  @Volatile private var senderIntervalMs = 15_000L
  @Volatile private var senderAttivita = ""
  @Volatile private var notifTitle = ""
  @Volatile private var notifBody = ""
  @Volatile private var lastSentTs: Long = 0L
  @Volatile private var lastResponse = ""
  // Volume sveglia precedente, da ripristinare quando il pending rientra.
  private var prevAlarmVolume: Int = -1

  companion object {
    private const val QUEUE_CAP = 1000       // ~4h a 15s: oltre, si scarta il più vecchio
    private const val EMERGENCY_NOTIF_ID = 0x6E
    private const val EMERGENCY_CHANNEL = "emergency-v3"
  }

  override fun definition() = ModuleDefinition {
    // Nome usato da JS: requireNativeModule("WakeLock").
    Name("WakeLock")

    // Acquisisce un PARTIAL_WAKE_LOCK: la CPU resta sveglia a schermo spento, così
    // l'accelerometro continua a consegnare e il picco d'impatto viene catturato
    // anche col telefono in tasca. Idempotente.
    // NB: niente `return@Function` — dentro Function{} il blocco è tipizzato Any?,
    // un return nudo (Unit) darebbe "Return type mismatch". Solo if annidati.
    Function("acquire") {
      acquireLock()
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
          (if (lastAccelEventMs == 0L) -1L else System.currentTimeMillis() - lastAccelEventMs),
        "senderRunning" to senderRunning,
        "lastSentAgeMs" to
          (if (lastSentTs == 0L) -1L else System.currentTimeMillis() - lastSentTs)
      )
    }

    // ── Sender nativo ────────────────────────────────────────────────────────

    // Avvia il loop di invio. Idempotente; la config si può aggiornare al volo
    // richiamandolo (es. cambio intervallo). title/body sono le stringhe già
    // localizzate della notifica di pre-emergenza.
    Function("startSender") { url: String, cookie: String, intervalMs: Double, attivita: String, title: String, body: String ->
      senderUrl = url
      senderCookie = cookie
      senderIntervalMs = intervalMs.toLong().coerceAtLeast(5_000L)
      senderAttivita = attivita
      notifTitle = title
      notifBody = body
      acquireLock() // difensivo: il loop vive solo con la CPU sveglia
      if (!senderRunning) {
        senderRunning = true
        val thread = HandlerThread("GrappaSender").apply { start() }
        senderThread = thread
        val handler = Handler(thread.looper)
        senderHandler = handler
        handler.post { registerLocationListeners() }
        handler.post(senderLoop)
      }
    }

    Function("stopSender") {
      senderRunning = false
      senderHandler?.removeCallbacksAndMessages(null)
      unregisterLocationListeners()
      senderThread?.quitSafely()
      senderThread = null
      senderHandler = null
      lastFix = null
      lastSentTs = 0L
      lastResponse = ""
    }

    Function("isSenderRunning") { senderRunning }

    // Ultima risposta JSON di /api/gps vista dal sender: il task JS la legge
    // (quando è sveglio) per allineare lo stato pending_emergency locale.
    Function("getLastResponse") { lastResponse }

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

  // ── Implementazione privata ────────────────────────────────────────────────

  private fun acquireLock() {
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

  private fun takePeak(): Double {
    val p = peakG
    peakG = 1.0
    return p
  }

  // Sorgenti posizione del sender, sul looper del suo thread (vivo col wake
  // lock): richiesta ATTIVA sul provider fused (API 31+, fonde GPS/wifi/celle
  // — funziona anche indoor) o gps come ripiego, PIÙ il provider passivo che
  // raccoglie gratis i fix già prodotti dal foreground service di expo-location.
  // Doppia fonte, stessa destinazione: lastFix; il tick deduplica su fix.time.
  private fun registerLocationListeners() {
    val ctx = appContext.reactContext ?: return
    val lm = ctx.getSystemService(Context.LOCATION_SERVICE) as? LocationManager ?: return
    val looper = senderThread?.looper ?: return
    val listener = object : LocationListener {
      override fun onLocationChanged(location: Location) {
        // Il provider passivo raccoglie anche i fix scadenti richiesti da
        // altre app (celle/wifi, errore di centinaia di metri, senza quota):
        // in campo producevano salti di ~3.6 km nella traccia. Un fix
        // GNSS/fused buono ha accuracy di pochi metri: sopra i 100 m si scarta.
        if (location.hasAccuracy() && location.accuracy > 100f) return
        lastFix = location
      }
    }
    val provider = if (
      android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.S &&
      lm.allProviders.contains(LocationManager.FUSED_PROVIDER)
    ) {
      LocationManager.FUSED_PROVIDER
    } else {
      LocationManager.GPS_PROVIDER
    }
    try {
      lm.requestLocationUpdates(provider, senderIntervalMs, 0f, listener, looper)
      lm.requestLocationUpdates(LocationManager.PASSIVE_PROVIDER, 1_000L, 0f, listener, looper)
      passiveListener = listener
    } catch (e: SecurityException) {
      // permesso posizione mancante: il sender resta muto, il JS fa da solo
    } catch (e: IllegalArgumentException) {
      // provider inesistente su questo device: tenta almeno il passivo
      try {
        lm.requestLocationUpdates(LocationManager.PASSIVE_PROVIDER, 1_000L, 0f, listener, looper)
        passiveListener = listener
      } catch (_: Throwable) {}
    }
  }

  private fun unregisterLocationListeners() {
    val ctx = appContext.reactContext
    val lm = ctx?.getSystemService(Context.LOCATION_SERVICE) as? LocationManager
    passiveListener?.let { lm?.removeUpdates(it) }
    passiveListener = null
  }

  private val senderLoop: Runnable = object : Runnable {
    override fun run() {
      if (!senderRunning) return
      try {
        tick()
      } catch (t: Throwable) {
        // mai far morire il loop per un errore di un giro
      }
      senderHandler?.postDelayed(this, senderIntervalMs)
    }
  }

  private fun tick() {
    // 1. Accoda il fix più recente (se nuovo). Il picco accel copre la
    //    finestra dall'ultimo giro e va sul punto corrente.
    val fix = lastFix
    if (fix != null && fix.time > lastEnqueuedTs) {
      lastEnqueuedTs = fix.time
      sendQueue.addLast(fix.time to buildPayload(fix))
      while (sendQueue.size > QUEUE_CAP) sendQueue.removeFirst()
    }
    // 2. Svuota in ordine (ts monotoni per la macchina a stati del server).
    while (sendQueue.isNotEmpty()) {
      val (ts, payload) = sendQueue.first()
      val code = postGps(payload)
      if (code in 200..299) {
        sendQueue.removeFirst()
        lastSentTs = ts
      } else if (code in 400..499) {
        sendQueue.removeFirst() // rifiuto permanente: scarta, non bloccare la coda
      } else {
        break // rete assente o 5xx: riprova al prossimo giro, nulla è perso
      }
    }
  }

  private fun buildPayload(fix: Location): JSONObject {
    val speed: Double? = if (fix.hasSpeed()) fix.speed.toDouble() else null
    val airborne = senderAttivita == "PARAGLIDER" || senderAttivita == "HANGGLIDER"
    val motion = when {
      speed == null -> "STATIONARY"
      airborne && speed > 5 -> "FLYING"
      speed > 0.5 -> "MOVING"
      else -> "STATIONARY"
    }
    val iso = SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.US).apply {
      timeZone = TimeZone.getTimeZone("UTC")
    }.format(Date(fix.time))
    return JSONObject().apply {
      put("lat", fix.latitude)
      put("lon", fix.longitude)
      put("alt_m", if (fix.hasAltitude()) fix.altitude else JSONObject.NULL)
      put("accuracy_m", if (fix.hasAccuracy()) fix.accuracy.toDouble() else JSONObject.NULL)
      put("speed_ms", speed ?: JSONObject.NULL)
      put("motion_state", motion)
      put("impact_detected", false) // l'impatto lo decide il server dal picco
      put("accel_magnitude", takePeak())
      put("battery_pct", batteryPct() ?: JSONObject.NULL)
      put("ts", iso)
    }
  }

  private fun batteryPct(): Int? {
    val ctx = appContext.reactContext ?: return null
    val bm = ctx.getSystemService(Context.BATTERY_SERVICE) as? BatteryManager ?: return null
    val v = bm.getIntProperty(BatteryManager.BATTERY_PROPERTY_CAPACITY)
    return if (v in 0..100) v else null
  }

  /** POST del payload a /api/gps. Ritorna lo status HTTP, o -1 per errore di rete. */
  private fun postGps(payload: JSONObject): Int {
    return try {
      val conn = URL(senderUrl).openConnection() as HttpURLConnection
      try {
        conn.requestMethod = "POST"
        conn.connectTimeout = 15_000
        conn.readTimeout = 15_000
        conn.setRequestProperty("Content-Type", "application/json")
        if (senderCookie.isNotEmpty()) conn.setRequestProperty("Cookie", senderCookie)
        conn.doOutput = true
        conn.outputStream.use { it.write(payload.toString().toByteArray(Charsets.UTF_8)) }
        val code = conn.responseCode
        // Rotazione cookie di sessione, come fa request() lato JS.
        conn.headerFields["Set-Cookie"]?.forEach { h ->
          Regex("(session=[^;]+)").find(h ?: "")?.let { senderCookie = it.groupValues[1] }
        }
        if (code in 200..299) {
          val text = conn.inputStream.use { it.readBytes().toString(Charsets.UTF_8) }
          lastResponse = text
          handleServerResponse(text)
        } else {
          try { conn.errorStream?.close() } catch (_: Throwable) {}
        }
        code
      } finally {
        conn.disconnect()
      }
    } catch (t: Throwable) {
      -1
    }
  }

  // pending_emergency nella risposta → notifica sul canale sveglia, UNA volta
  // per pending. Il JS, congelato a schermo spento, non può farlo; qui suona
  // comunque. Quando il pending si chiude, la notifica si ritira.
  private fun handleServerResponse(text: String) {
    try {
      val json = JSONObject(text)
      val pending = json.optJSONObject("pending_emergency")
      if (pending != null) {
        if (!pendingNotified) {
          postEmergencyNotification()
          pendingNotified = true
        }
      } else if (pendingNotified) {
        cancelEmergencyNotification()
        pendingNotified = false
      }
    } catch (t: Throwable) {
      // risposta non-JSON: ignora
    }
  }

  private fun postEmergencyNotification() {
    val ctx = appContext.reactContext?.applicationContext ?: return
    val nm = ctx.getSystemService(Context.NOTIFICATION_SERVICE) as? NotificationManager ?: return
    // Volume sveglia al MASSIMO: il canale suona sullo stream alarm ma al
    // volume corrente dell'utente — un allarme di sicurezza non può suonare
    // piano. Il volume precedente si ripristina quando il pending rientra.
    try {
      val am = ctx.getSystemService(Context.AUDIO_SERVICE) as? AudioManager
      if (am != null) {
        if (prevAlarmVolume < 0) prevAlarmVolume = am.getStreamVolume(AudioManager.STREAM_ALARM)
        am.setStreamVolume(AudioManager.STREAM_ALARM, am.getStreamMaxVolume(AudioManager.STREAM_ALARM), 0)
      }
    } catch (_: Throwable) {
      // volume non forzabile (es. DnD con restrizioni): si suona comunque
    }
    val launch = ctx.packageManager.getLaunchIntentForPackage(ctx.packageName) ?: return
    val pi = PendingIntent.getActivity(
      ctx, 0, launch,
      PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
    )
    // Il canale emergency-v3 (stream sveglia, bypass DnD) è creato dall'app al
    // primo avvio via expo-notifications: qui lo si riusa.
    val builder = if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.O) {
      Notification.Builder(ctx, EMERGENCY_CHANNEL)
    } else {
      @Suppress("DEPRECATION")
      Notification.Builder(ctx)
    }
    val n = builder
      .setContentTitle(notifTitle)
      .setContentText(notifBody)
      .setSmallIcon(ctx.applicationInfo.icon)
      .setContentIntent(pi)
      .setAutoCancel(true)
      .setCategory(Notification.CATEGORY_ALARM)
      .build()
    nm.notify(EMERGENCY_NOTIF_ID, n)
  }

  private fun cancelEmergencyNotification() {
    val ctx = appContext.reactContext?.applicationContext ?: return
    val nm = ctx.getSystemService(Context.NOTIFICATION_SERVICE) as? NotificationManager ?: return
    nm.cancel(EMERGENCY_NOTIF_ID)
    // Ripristina il volume sveglia dell'utente.
    if (prevAlarmVolume >= 0) {
      try {
        val am = ctx.getSystemService(Context.AUDIO_SERVICE) as? AudioManager
        am?.setStreamVolume(AudioManager.STREAM_ALARM, prevAlarmVolume, 0)
      } catch (_: Throwable) {}
      prevAlarmVolume = -1
    }
  }
}

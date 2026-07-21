/**
 * Lightweight i18n for GrappaSafe. No external deps.
 *
 * Language is picked from the device locale (via Intl) at startup and can be
 * overridden by the user in Settings; the override is persisted in AsyncStorage.
 * Components use the useT() hook so they re-render when the language changes;
 * non-component code (background task, notifications) calls t() directly.
 */

import { useEffect, useReducer } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";

export type Lang = "it" | "en" | "de";
export const LANGS: Lang[] = ["it", "en", "de"];
export const LANG_NAMES: Record<Lang, string> = {
  it: "Italiano",
  en: "English",
  de: "Deutsch",
};

const STORAGE_KEY = "app_lang";

function detectDeviceLang(): Lang {
  try {
    const loc = Intl.DateTimeFormat().resolvedOptions().locale || "";
    const code = loc.slice(0, 2).toLowerCase();
    if (code === "it" || code === "de") return code;
    return "en";
  } catch {
    return "en";
  }
}

let _lang: Lang = detectDeviceLang();

const listeners = new Set<() => void>();
function emit() {
  listeners.forEach((l) => l());
}

export function getLang(): Lang {
  return _lang;
}

/** Load the saved override (call once at startup). */
export async function initLang(): Promise<void> {
  try {
    const saved = await AsyncStorage.getItem(STORAGE_KEY);
    if (saved === "it" || saved === "en" || saved === "de") {
      _lang = saved;
      emit();
    }
  } catch {
    /* keep detected language */
  }
}

export async function setLang(l: Lang): Promise<void> {
  _lang = l;
  emit();
  try {
    await AsyncStorage.setItem(STORAGE_KEY, l);
  } catch {
    /* in-memory change still applies */
  }
}

export function t(key: string, vars?: Record<string, string | number>): string {
  const table = DICT[_lang] || DICT.it;
  let s = table[key] ?? DICT.it[key] ?? key;
  if (vars) {
    for (const k of Object.keys(vars)) {
      s = s.replace(new RegExp(`\\{${k}\\}`, "g"), String(vars[k]));
    }
  }
  return s;
}

/** Hook: returns t and re-renders the component when the language changes. */
export function useT(): typeof t {
  const [, force] = useReducer((x: number) => x + 1, 0);
  useEffect(() => {
    listeners.add(force);
    return () => {
      listeners.delete(force);
    };
  }, []);
  return t;
}

type Table = Record<string, string>;

const it: Table = {
  // common
  "common.warning": "Attenzione",
  "common.error": "Errore",
  "common.netError": "Errore di rete",
  "common.cannotReachServer": "Impossibile contattare il server",
  "common.cancel": "Annulla",
  "common.save": "Salva",
  "common.saving": "Salvataggio…",
  "common.delete": "Elimina",

  // activities
  "act.PARAGLIDER": "Parapendio",
  "act.HANGGLIDER": "Deltaplano",
  "act.CYCLIST": "Ciclismo",
  "act.CLIMBER": "Arrampicata",
  "act.HIKER": "Escursionismo",
  "act.RUNNER": "Corsa",
  "act.OTHER_ON_GROUND": "Altro",

  // login
  "login.subtitle": "Consorzio di Volo del Grappa",
  "login.loading": "Accesso…",
  "login.signIn": "Accedi",
  "login.noAccount": "Non hai un account? Registrati",
  "login.needUserPass": "Inserisci username e password",
  "login.loginFailed": "Login fallito",
  "login.cannotFetchProfile": "Impossibile recuperare il profilo",

  // register
  "register.title": "Crea il tuo account",
  "register.personalData": "Dati personali",
  "register.name": "Nome",
  "register.surname": "Cognome",
  "register.passwordMin": "Password (min 6 caratteri)",
  "register.emergencyDataOpt": "Dati d'emergenza (opzionali)",
  "register.yourPhone": "Il tuo telefono",
  "register.bloodType": "Gruppo sanguigno (es. 0+)",
  "register.emergencyContactName": "Contatto d'emergenza (nome)",
  "register.emergencyContactPhone": "Telefono contatto d'emergenza",
  "register.creating": "Creazione…",
  "register.signUp": "Registrati",
  "register.haveAccount": "Hai già un account? Accedi",
  "register.requiredFields": "Nome, cognome, username e password sono obbligatori",
  "register.passwordTooShort": "La password deve avere almeno 6 caratteri",
  "register.failed": "Registrazione non riuscita",
  "register.createdNoProfile": "Account creato ma impossibile recuperare il profilo",

  // map
  "map.paused": "IN PAUSA",
  "map.live": "LIVE",
  "map.share": "condividi",
  "map.outOfZone": "⚠️ Sei fuori dalla zona monitorata",
  "map.resume": "▶  Riprendi",
  "map.pause": "⏸  Pausa",
  "map.stop": "⏹  Stop",
  "map.startActivity": "▶  Inizia attività",
  "map.shareMessage": "Segui il mio tracking live su GrappaSafe: {url}",
  "map.cannotToggle": "Impossibile cambiare stato del monitoraggio",
  "map.endSessionTitle": "Termina sessione",
  "map.endSessionMsg": "Vuoi terminare il monitoraggio?",
  "map.end": "Termina",
  "map.cannotEnd": "Impossibile terminare la sessione",
  "map.unavailable": "🗺️ Mappa non disponibile qui",
  "map.needDevBuild": "Serve una development build",
  "map.onlineBadge": "mappa online — scaricala nei settings per l'offline",

  // alarm
  "alarm.impactTitle": "Impatto rilevato",
  "alarm.impactDetail": "Il sensore ha rilevato un impatto. Sei ferito?",
  "alarm.immobileTitle": "Sei fermo da troppo tempo",
  "alarm.immobileDetail": "Non ti muovi da diversi minuti. Hai bisogno di aiuto?",
  "alarm.defaultTitle": "Situazione anomala rilevata",
  "alarm.defaultDetail": "Il sistema ha rilevato qualcosa di insolito.",
  "alarm.responseSent": "Risposta inviata",
  "alarm.autoAlerting": "I soccorsi vengono allertati automaticamente",
  "alarm.imOk": "✅  Sto bene",
  "alarm.falseAlarm": "Falso allarme",
  "alarm.needHelp": "🆘  Ho bisogno di aiuto",
  "alarm.alertRescuers": "Allerta i soccorsi",

  // settings
  "settings.profile": "Profilo",
  "settings.profileHint": "Questi dati raggiungono i soccorsi in caso di emergenza.",
  "settings.phone": "Telefono",
  "settings.healthNotes": "Note di salute (allergie, terapie…)",
  "settings.saveProfile": "Salva profilo",
  "settings.profileSaved": "Dati salvati.",
  "settings.profileSaveError": "Impossibile salvare il profilo.",
  "settings.devicesTitle": "La tua vela / device",
  "settings.devicesHint":
    "Nome della vela (es. \"Vela rossa, Ozone Rush\") e, se hai un FLARM/OGN, il suo ID. Compare ai soccorsi in caso di emergenza.",
  "settings.wingNameRequired": "Il nome della vela è obbligatorio",
  "settings.deviceSaveError": "Impossibile salvare il device",
  "settings.deleteDeviceMsg": "Eliminare questa vela/device?",
  "settings.edit": "Modifica",
  "settings.wingNamePlaceholder": "Nome vela / device",
  "settings.ognIdOptional": "ID OGN/FLARM (opzionale)",
  "settings.addDevice": "+ Aggiungi vela / device",
  "settings.useOfflineMap": "Usa mappa offline",
  "settings.offlineMapHint": "Default: OpenTopoMap online. Attiva per usare le tile scaricate.",
  "settings.offlineNotDownloaded": "⚠️ Mappa offline non ancora scaricata — scaricala qui sotto.",
  "settings.preparing": "Preparazione…",
  "settings.tilesProgress": "{done} / {total} tile ({pct}%)",
  "settings.mapDownloaded": "✓ Mappa scaricata",
  "settings.mapDownloadedTiles": " — {n} tile",
  "settings.updateMap": "Aggiorna mappa",
  "settings.deleteOfflineMap": "Elimina mappa offline",
  "settings.downloadOfflineMap": "Scarica mappa offline",
  "settings.offlineMapTitle": "Mappa offline",
  "settings.downloadDone": "Download completato.",
  "settings.downloadError": "Download non riuscito. Verifica connessione e tile sul server.",
  "settings.deleteOfflineMapMsg": "Liberare lo spazio delle tile scaricate?",
  "settings.gpsFreqTitle": "Frequenza aggiornamento pin",
  "settings.gpsFreqHint":
    "Ogni quanto l'app invia la posizione. Frequenza più alta = traccia più precisa, ma maggiore consumo di batteria.",
  "settings.gpsFreqWarn": "⚠️ Intervalli lunghi ammorbidiscono il rilevamento automatico delle emergenze.",
  "settings.outOfZoneTitle": "Avviso \"sei fuori zona\"",
  "settings.outOfZoneHint": "Notifica quando esci dal cerchio monitorato.",
  "settings.logout": "Esci dall'account",
  "settings.language": "Lingua",

  // activity modal
  "activity.title": "Cosa stai facendo?",
  "activity.cannotStart": "Impossibile avviare la sessione",

  // emergency overlay
  "emergency.manualTitle": "Emergenza manuale",
  "emergency.holdInstr": "Tieni premuto ovunque per 3 secondi\nper segnalare un'emergenza",
  "emergency.sending": "Invio emergenza…",
  "emergency.sentTitle": "EMERGENZA INVIATA",
  "emergency.ackTitle": "✓ Presa in carico",
  "emergency.ackText": "Un operatore ha visto la tua richiesta di soccorso e la sta gestendo.",
  "emergency.waiting": "Allerta inviata · in attesa di risposta",
  "emergency.fallbackMsg": "Resta dove sei, i soccorsi sono in arrivo.",

  // notifications (background)
  "notif.outOfZoneTitle": "⚠️ Fuori dalla zona monitorata",
  "notif.outOfZoneBody":
    "Sei a {dist} km dal centro (raggio {radius} km). Il monitoraggio automatico potrebbe non coprirti.",
  "notif.emergencyTitle": "⚠️ GrappaSafe — Emergenza rilevata",
  "notif.emergencyBody": "Apri l'app per rispondere. Hai 3 minuti prima che i soccorsi vengano allertati.",
  "notif.trackingTitle": "GrappaSafe attivo",
  "notif.trackingBody": "Monitoraggio in corso",
  "notif.channelName": "Emergenza GrappaSafe",

  // navigation
  "nav.register": "Registrati",
  "nav.settings": "Impostazioni",
  "nav.emergency": "Emergenza",
};

const en: Table = {
  "common.warning": "Warning",
  "common.error": "Error",
  "common.netError": "Network error",
  "common.cannotReachServer": "Could not reach the server",
  "common.cancel": "Cancel",
  "common.save": "Save",
  "common.saving": "Saving…",
  "common.delete": "Delete",

  "act.PARAGLIDER": "Paragliding",
  "act.HANGGLIDER": "Hang gliding",
  "act.CYCLIST": "Cycling",
  "act.CLIMBER": "Climbing",
  "act.HIKER": "Hiking",
  "act.RUNNER": "Running",
  "act.OTHER_ON_GROUND": "Other",

  "login.subtitle": "Consorzio di Volo del Grappa",
  "login.loading": "Signing in…",
  "login.signIn": "Sign in",
  "login.noAccount": "No account? Sign up",
  "login.needUserPass": "Enter username and password",
  "login.loginFailed": "Login failed",
  "login.cannotFetchProfile": "Could not load the profile",

  "register.title": "Create your account",
  "register.personalData": "Personal details",
  "register.name": "First name",
  "register.surname": "Last name",
  "register.passwordMin": "Password (min 6 characters)",
  "register.emergencyDataOpt": "Emergency details (optional)",
  "register.yourPhone": "Your phone",
  "register.bloodType": "Blood type (e.g. 0+)",
  "register.emergencyContactName": "Emergency contact (name)",
  "register.emergencyContactPhone": "Emergency contact phone",
  "register.creating": "Creating…",
  "register.signUp": "Sign up",
  "register.haveAccount": "Already have an account? Sign in",
  "register.requiredFields": "First name, last name, username and password are required",
  "register.passwordTooShort": "The password must be at least 6 characters",
  "register.failed": "Registration failed",
  "register.createdNoProfile": "Account created but the profile could not be loaded",

  "map.paused": "PAUSED",
  "map.live": "LIVE",
  "map.share": "share",
  "map.outOfZone": "⚠️ You are outside the monitored area",
  "map.resume": "▶  Resume",
  "map.pause": "⏸  Pause",
  "map.stop": "⏹  Stop",
  "map.startActivity": "▶  Start activity",
  "map.shareMessage": "Follow my live tracking on GrappaSafe: {url}",
  "map.cannotToggle": "Could not change monitoring state",
  "map.endSessionTitle": "End session",
  "map.endSessionMsg": "End monitoring?",
  "map.end": "End",
  "map.cannotEnd": "Could not end the session",
  "map.unavailable": "🗺️ Map not available here",
  "map.needDevBuild": "A development build is required",
  "map.onlineBadge": "online map — download it in settings for offline",

  "alarm.impactTitle": "Impact detected",
  "alarm.impactDetail": "The sensor detected an impact. Are you hurt?",
  "alarm.immobileTitle": "You've been still too long",
  "alarm.immobileDetail": "You haven't moved for several minutes. Do you need help?",
  "alarm.defaultTitle": "Unusual situation detected",
  "alarm.defaultDetail": "The system detected something unusual.",
  "alarm.responseSent": "Response sent",
  "alarm.autoAlerting": "Rescuers are being alerted automatically",
  "alarm.imOk": "✅  I'm OK",
  "alarm.falseAlarm": "False alarm",
  "alarm.needHelp": "🆘  I need help",
  "alarm.alertRescuers": "Alert the rescuers",

  "settings.profile": "Profile",
  "settings.profileHint": "This information reaches rescuers in an emergency.",
  "settings.phone": "Phone",
  "settings.healthNotes": "Health notes (allergies, medication…)",
  "settings.saveProfile": "Save profile",
  "settings.profileSaved": "Saved.",
  "settings.profileSaveError": "Could not save the profile.",
  "settings.devicesTitle": "Your wing / device",
  "settings.devicesHint":
    "Wing name (e.g. \"Red wing, Ozone Rush\") and, if you have a FLARM/OGN, its ID. Shown to rescuers in an emergency.",
  "settings.wingNameRequired": "The wing name is required",
  "settings.deviceSaveError": "Could not save the device",
  "settings.deleteDeviceMsg": "Delete this wing/device?",
  "settings.edit": "Edit",
  "settings.wingNamePlaceholder": "Wing / device name",
  "settings.ognIdOptional": "OGN/FLARM ID (optional)",
  "settings.addDevice": "+ Add wing / device",
  "settings.useOfflineMap": "Use offline map",
  "settings.offlineMapHint": "Default: OpenTopoMap online. Turn on to use downloaded tiles.",
  "settings.offlineNotDownloaded": "⚠️ Offline map not downloaded yet — download it below.",
  "settings.preparing": "Preparing…",
  "settings.tilesProgress": "{done} / {total} tiles ({pct}%)",
  "settings.mapDownloaded": "✓ Map downloaded",
  "settings.mapDownloadedTiles": " — {n} tiles",
  "settings.updateMap": "Update map",
  "settings.deleteOfflineMap": "Delete offline map",
  "settings.downloadOfflineMap": "Download offline map",
  "settings.offlineMapTitle": "Offline map",
  "settings.downloadDone": "Download complete.",
  "settings.downloadError": "Download failed. Check your connection and the tiles on the server.",
  "settings.deleteOfflineMapMsg": "Free up the downloaded tiles?",
  "settings.gpsFreqTitle": "Pin update frequency",
  "settings.gpsFreqHint":
    "How often the app sends your position. Higher frequency = more precise track, but more battery use.",
  "settings.gpsFreqWarn": "⚠️ Long intervals soften the automatic emergency detection.",
  "settings.outOfZoneTitle": "\"Out of area\" alert",
  "settings.outOfZoneHint": "Notifies you when you leave the monitored circle.",
  "settings.logout": "Log out",
  "settings.language": "Language",

  "activity.title": "What are you doing?",
  "activity.cannotStart": "Could not start the session",

  "emergency.manualTitle": "Manual emergency",
  "emergency.holdInstr": "Hold anywhere for 3 seconds\nto report an emergency",
  "emergency.sending": "Sending emergency…",
  "emergency.sentTitle": "EMERGENCY SENT",
  "emergency.ackTitle": "✓ Taken in charge",
  "emergency.ackText": "An operator has seen your call for help and is handling it.",
  "emergency.waiting": "Alert sent · awaiting response",
  "emergency.fallbackMsg": "Stay where you are, help is on the way.",

  "notif.outOfZoneTitle": "⚠️ Outside the monitored area",
  "notif.outOfZoneBody":
    "You are {dist} km from the centre (radius {radius} km). Automatic monitoring may not cover you.",
  "notif.emergencyTitle": "⚠️ GrappaSafe — Emergency detected",
  "notif.emergencyBody": "Open the app to respond. You have 3 minutes before rescuers are alerted.",
  "notif.trackingTitle": "GrappaSafe active",
  "notif.trackingBody": "Monitoring in progress",
  "notif.channelName": "GrappaSafe Emergency",

  "nav.register": "Sign up",
  "nav.settings": "Settings",
  "nav.emergency": "Emergency",
};

const de: Table = {
  "common.warning": "Achtung",
  "common.error": "Fehler",
  "common.netError": "Netzwerkfehler",
  "common.cannotReachServer": "Server nicht erreichbar",
  "common.cancel": "Abbrechen",
  "common.save": "Speichern",
  "common.saving": "Speichern…",
  "common.delete": "Löschen",

  "act.PARAGLIDER": "Gleitschirm",
  "act.HANGGLIDER": "Drachen",
  "act.CYCLIST": "Radfahren",
  "act.CLIMBER": "Klettern",
  "act.HIKER": "Wandern",
  "act.RUNNER": "Laufen",
  "act.OTHER_ON_GROUND": "Sonstiges",

  "login.subtitle": "Consorzio di Volo del Grappa",
  "login.loading": "Anmeldung…",
  "login.signIn": "Anmelden",
  "login.noAccount": "Kein Konto? Registrieren",
  "login.needUserPass": "Benutzername und Passwort eingeben",
  "login.loginFailed": "Anmeldung fehlgeschlagen",
  "login.cannotFetchProfile": "Profil konnte nicht geladen werden",

  "register.title": "Konto erstellen",
  "register.personalData": "Persönliche Daten",
  "register.name": "Vorname",
  "register.surname": "Nachname",
  "register.passwordMin": "Passwort (mind. 6 Zeichen)",
  "register.emergencyDataOpt": "Notfalldaten (optional)",
  "register.yourPhone": "Deine Telefonnummer",
  "register.bloodType": "Blutgruppe (z. B. 0+)",
  "register.emergencyContactName": "Notfallkontakt (Name)",
  "register.emergencyContactPhone": "Telefon des Notfallkontakts",
  "register.creating": "Wird erstellt…",
  "register.signUp": "Registrieren",
  "register.haveAccount": "Bereits ein Konto? Anmelden",
  "register.requiredFields": "Vorname, Nachname, Benutzername und Passwort sind erforderlich",
  "register.passwordTooShort": "Das Passwort muss mindestens 6 Zeichen haben",
  "register.failed": "Registrierung fehlgeschlagen",
  "register.createdNoProfile": "Konto erstellt, aber Profil konnte nicht geladen werden",

  "map.paused": "PAUSIERT",
  "map.live": "LIVE",
  "map.share": "teilen",
  "map.outOfZone": "⚠️ Du bist außerhalb des überwachten Gebiets",
  "map.resume": "▶  Fortsetzen",
  "map.pause": "⏸  Pause",
  "map.stop": "⏹  Stopp",
  "map.startActivity": "▶  Aktivität starten",
  "map.shareMessage": "Verfolge mein Live-Tracking auf GrappaSafe: {url}",
  "map.cannotToggle": "Überwachungsstatus konnte nicht geändert werden",
  "map.endSessionTitle": "Sitzung beenden",
  "map.endSessionMsg": "Überwachung beenden?",
  "map.end": "Beenden",
  "map.cannotEnd": "Sitzung konnte nicht beendet werden",
  "map.unavailable": "🗺️ Karte hier nicht verfügbar",
  "map.needDevBuild": "Ein Development-Build ist erforderlich",
  "map.onlineBadge": "Online-Karte — in den Einstellungen für offline herunterladen",

  "alarm.impactTitle": "Aufprall erkannt",
  "alarm.impactDetail": "Der Sensor hat einen Aufprall erkannt. Bist du verletzt?",
  "alarm.immobileTitle": "Du bist zu lange bewegungslos",
  "alarm.immobileDetail": "Du hast dich seit einigen Minuten nicht bewegt. Brauchst du Hilfe?",
  "alarm.defaultTitle": "Ungewöhnliche Situation erkannt",
  "alarm.defaultDetail": "Das System hat etwas Ungewöhnliches erkannt.",
  "alarm.responseSent": "Antwort gesendet",
  "alarm.autoAlerting": "Die Rettungskräfte werden automatisch alarmiert",
  "alarm.imOk": "✅  Mir geht's gut",
  "alarm.falseAlarm": "Fehlalarm",
  "alarm.needHelp": "🆘  Ich brauche Hilfe",
  "alarm.alertRescuers": "Rettungskräfte alarmieren",

  "settings.profile": "Profil",
  "settings.profileHint": "Diese Daten erreichen die Rettungskräfte im Notfall.",
  "settings.phone": "Telefon",
  "settings.healthNotes": "Gesundheitshinweise (Allergien, Medikamente…)",
  "settings.saveProfile": "Profil speichern",
  "settings.profileSaved": "Gespeichert.",
  "settings.profileSaveError": "Profil konnte nicht gespeichert werden.",
  "settings.devicesTitle": "Dein Schirm / Gerät",
  "settings.devicesHint":
    "Name des Schirms (z. B. \"Roter Schirm, Ozone Rush\") und, falls vorhanden, die FLARM/OGN-ID. Wird den Rettungskräften im Notfall angezeigt.",
  "settings.wingNameRequired": "Der Name des Schirms ist erforderlich",
  "settings.deviceSaveError": "Gerät konnte nicht gespeichert werden",
  "settings.deleteDeviceMsg": "Diesen Schirm / dieses Gerät löschen?",
  "settings.edit": "Bearbeiten",
  "settings.wingNamePlaceholder": "Name Schirm / Gerät",
  "settings.ognIdOptional": "OGN/FLARM-ID (optional)",
  "settings.addDevice": "+ Schirm / Gerät hinzufügen",
  "settings.useOfflineMap": "Offline-Karte verwenden",
  "settings.offlineMapHint": "Standard: OpenTopoMap online. Aktivieren, um heruntergeladene Kacheln zu verwenden.",
  "settings.offlineNotDownloaded": "⚠️ Offline-Karte noch nicht heruntergeladen — unten herunterladen.",
  "settings.preparing": "Vorbereitung…",
  "settings.tilesProgress": "{done} / {total} Kacheln ({pct}%)",
  "settings.mapDownloaded": "✓ Karte heruntergeladen",
  "settings.mapDownloadedTiles": " — {n} Kacheln",
  "settings.updateMap": "Karte aktualisieren",
  "settings.deleteOfflineMap": "Offline-Karte löschen",
  "settings.downloadOfflineMap": "Offline-Karte herunterladen",
  "settings.offlineMapTitle": "Offline-Karte",
  "settings.downloadDone": "Download abgeschlossen.",
  "settings.downloadError": "Download fehlgeschlagen. Verbindung und Kacheln auf dem Server prüfen.",
  "settings.deleteOfflineMapMsg": "Speicherplatz der heruntergeladenen Kacheln freigeben?",
  "settings.gpsFreqTitle": "Aktualisierungsintervall",
  "settings.gpsFreqHint":
    "Wie oft die App deine Position sendet. Höhere Frequenz = genauere Spur, aber mehr Akkuverbrauch.",
  "settings.gpsFreqWarn": "⚠️ Lange Intervalle schwächen die automatische Notfallerkennung.",
  "settings.outOfZoneTitle": "\"Außerhalb des Gebiets\"-Hinweis",
  "settings.outOfZoneHint": "Benachrichtigt dich, wenn du den überwachten Bereich verlässt.",
  "settings.logout": "Abmelden",
  "settings.language": "Sprache",

  "activity.title": "Was machst du gerade?",
  "activity.cannotStart": "Sitzung konnte nicht gestartet werden",

  "emergency.manualTitle": "Manueller Notruf",
  "emergency.holdInstr": "Halte 3 Sekunden lang irgendwo gedrückt,\num einen Notfall zu melden",
  "emergency.sending": "Notruf wird gesendet…",
  "emergency.sentTitle": "NOTRUF GESENDET",
  "emergency.ackTitle": "✓ Übernommen",
  "emergency.ackText": "Ein Mitarbeiter hat deinen Hilferuf gesehen und kümmert sich darum.",
  "emergency.waiting": "Alarm gesendet · warte auf Antwort",
  "emergency.fallbackMsg": "Bleib, wo du bist, Hilfe ist unterwegs.",

  "notif.outOfZoneTitle": "⚠️ Außerhalb des überwachten Gebiets",
  "notif.outOfZoneBody":
    "Du bist {dist} km vom Zentrum entfernt (Radius {radius} km). Die automatische Überwachung deckt dich möglicherweise nicht ab.",
  "notif.emergencyTitle": "⚠️ GrappaSafe — Notfall erkannt",
  "notif.emergencyBody": "Öffne die App zum Antworten. Du hast 3 Minuten, bevor die Rettungskräfte alarmiert werden.",
  "notif.trackingTitle": "GrappaSafe aktiv",
  "notif.trackingBody": "Überwachung läuft",
  "notif.channelName": "GrappaSafe Notfall",

  "nav.register": "Registrieren",
  "nav.settings": "Einstellungen",
  "nav.emergency": "Notfall",
};

const DICT: Record<Lang, Table> = { it, en, de };

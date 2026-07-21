# GrappaSafe Mobile

App React Native + Expo (**SDK 54**) per il monitoraggio outdoor del Consorzio di Volo del Grappa.

## Requisiti

- Node 20+ (testato su 24)
- **Expo Go (SDK 54)** per un test rapido su device, oppure una **dev build EAS** per background e notifiche affidabili
- Un device fisico sulla stessa LAN del PC (per Expo Go)

## Setup

```bash
npm install
npx expo start
```

Poi apri Expo Go sul telefono → scansiona il QR, oppure **"Enter URL manually"** → `exp://<ip-lan>:8081`.

Su una macchina nuova, se emergono versioni o peer dependency disallineate:

```bash
npx expo install --fix
```

## Configurazione server

Il base URL è in `lib/api.ts`:

```ts
export const API_BASE = "https://grappasafe.borant.eu";  // produzione
```

Per sviluppo locale contro il backend in LAN usa `http://<ip-lan>:8010` — **non** `localhost`
(il device fisico non lo risolve; il server dev deve essere in ascolto su `0.0.0.0`, porta **8010**).

## Struttura

```
app/
  _layout.tsx   — stack navigator + handler notifiche
  index.tsx     — splash redirect (login / dashboard / tracking)
  login.tsx     — login + logo del consorzio
  register.tsx  — auto-registrazione pubblica
  dashboard.tsx — home utente loggato, nessuna sessione attiva
  activity.tsx  — selezione attività prima di avviare il monitoraggio
  tracking.tsx  — schermata principale durante la sessione + SOS
  alarm.tsx     — countdown full-screen su emergenza pending
lib/
  api.ts        — client HTTP verso il backend (cookie di sessione)
  tracking.ts   — background GPS + accelerometro (peak-g)
  store.ts      — AsyncStorage (user, session, cookie)
assets/
  logo-consorzio.png
```

## Flusso utente

1. **Login** (o **Registrati**) → salva il cookie di sessione
2. **Dashboard** → "Inizia sessione"
3. **Activity** → scelta attività → `POST /api/session/start`
4. **Tracking** → GPS ogni 15 s → `POST /api/gps` → mappa live
5. **SOS** (hold 3 s) → `POST /api/emergency`
6. **Emergenza** rilevata dal server → notifica → `alarm.tsx` → conferma / annulla
7. "Termina sessione" → `POST /api/session/end` → Dashboard

La registrazione è pubblica: `register.tsx` raccoglie i dati personali (più contatti d'emergenza
opzionali) e chiama `POST /api/register`, che crea un account `user` e logga subito l'utente.

## Rilevamento impatto

La soglia impatto è **decisa dal server**, con un valore per attività (`impact_g_<attivita>`).
L'app invia il **picco** di accelerazione (in g) dall'ultimo tick GPS e lascia `impact_detected: false`:
è il backend a giudicare l'impatto. Non c'è più alcuna soglia lato client (la vecchia "3.5g" è superata).

## Permessi

- **Android**: `ACCESS_BACKGROUND_LOCATION`, `FOREGROUND_SERVICE`, `FOREGROUND_SERVICE_LOCATION`,
  `POST_NOTIFICATIONS` — già in `app.json`
- **iOS**: background mode `location` in `infoPlist.UIBackgroundModes` — già in `app.json`

## Expo Go vs dev build

Expo Go (SDK 54) basta per login, registrazione, sessione, GPS in foreground e mappa. **Non** è
affidabile per:

- **background location** a schermo spento;
- **notifiche** complete — dall'SDK 53 le push remote sono rimosse da Expo Go (l'app usa solo
  notifiche locali, ma il flusso emergenza va comunque verificato fuori da Expo Go).

Per questi due punti serve una **dev build EAS** (`bundleIdentifier` / `package` = `eu.borant.grappasafe`).

## Stato

Verificati su device reale (Expo Go, Android): login, registrazione, avvio sessione, invio GPS,
mappa live. Da fare: background affidabile via dev build, calibrazione delle soglie impatto,
distribuzione, attività `GLIDER`, `battery_pct`.

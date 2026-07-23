# GrappaSafe Mobile

App React Native + Expo per il monitoraggio outdoor del Consorzio Vivere il Grappa.
Un utente avvia un'attività (volo, hike, bici…), il telefono manda posizione e
accelerazione al backend, e in caso di emergenza — manuale o rilevata dal server —
i soccorsi vengono allertati con l'identità e i contatti della persona.

Backend e pannelli (admin/observer/user, OGN, emergenze) stanno nel repo
[`grappasafe`](https://github.com/that-ugly-cat/grappasafe), in produzione su
`grappasafe.borant.eu`. Questo repo è solo l'app.

## Stack

- Expo SDK 54, React Native 0.81, React 19, expo-router 6
- Mappa: `@maplibre/maplibre-react-native` (nessuna base Google/Apple, nessuna
  API key: la base è OpenTopoMap via tile raster, online + scaricabili offline)
- GPS in background: `expo-location` + `expo-task-manager`; accelerometro:
  `expo-sensors`; tile offline: `expo-file-system`; notifiche: `expo-notifications`
- Allarme sonoro: `expo-audio` + `react-native-volume-manager` (sirena in loop a
  volume massimo, anche a telefono silenzioso); data di nascita:
  `@react-native-community/datetimepicker`
- **Lingue**: modulo i18n interno (`lib/i18n.ts`, senza dipendenze) — 8 lingue
  (it/en/de/fr/pl/nl/es/cs), rilevate dal dispositivo con override in Impostazioni

## Requisiti e setup

- Node 20+ (testato su 24)
- Un device Android fisico. Per il primo giro basta **Expo Go (SDK 54)**; per il
  background serio e la distribuzione serve una **dev build EAS** (vedi sotto).

```bash
npm install
npx expo start
```

Poi Expo Go → scansiona il QR, oppure "Enter URL manually" → `exp://<ip-lan>:8081`.
Su una macchina nuova, se le versioni litigano: `npx expo install --fix`.
C'è un `.npmrc` con `legacy-peer-deps=true` perché expo-router 6 tira un `react-dom`
(lato web) più nuovo del `react` fissato: frizione nota, il nativo non usa react-dom.

Il base URL del server è in `lib/api.ts`:

```ts
export const API_BASE = "https://grappasafe.borant.eu";  // produzione
```

Per lo sviluppo contro un backend locale usare `http://<ip-lan>:8010` — **non**
`localhost` (il device fisico non lo risolve; il server dev deve ascoltare su
`0.0.0.0`, porta 8010).

## Architettura: la mappa è l'app

Dopo il login c'è **una sola schermata**, `map.tsx`: la mappa a schermo intero è la
base, tutto il resto è overlay. Non ci sono più dashboard/activity/tracking separate.

Stati della MapScreen:
- **idle** — tre controlli in overlay: ⚙ impostazioni, "Inizia attività", SOS.
- **live / in pausa** — chip in alto (toccabile → condivide il link), controlli
  Pausa/Riprendi e Stop.
- **emergency** — overlay rosso a tutto schermo sopra ogni cosa.

### Schermate (`app/`)

| File | Ruolo |
|------|-------|
| `index.tsx` | splash: se loggato → `/map`, altrimenti → `/login` |
| `login.tsx` | login + logo consorzio; "Registrati" e "password dimenticata?" aprono le pagine **web** (la registrazione è solo online). Precompila lo username dal deep-link di ritorno `grappasafe://login?username=…` |
| `map.tsx` | schermata unica: mappa + overlay + attività + emergenza + share |
| `settings.tsx` | profilo (con email + data di nascita), vele/device + modale "?" sull'ID OGN, lingua, modalità mappa, frequenza GPS, alert zona, mappa offline, logout |
| `alarm.tsx` | countdown full-screen su emergenza *pending*, con **sirena a volume massimo** + vibrazione SOS |
| `_layout.tsx` | stack navigator + handler notifiche + SafeAreaProvider |

### Componenti (`components/`)

| File | Ruolo |
|------|-------|
| `OfflineMap.tsx` | `Map` MapLibre (stile scuro minimo) + base raster OTM online + tile locali sopra + cerchio zona + traccia + pallino utente |
| `SafeMap.tsx` | error boundary attorno a `OfflineMap`: se MapLibre manca nel runtime (es. Expo Go), mostra un placeholder invece di far cadere la schermata |
| `ActivityModal.tsx` | modale di scelta attività (avvia sessione + tracking) |
| `EmergencyOverlay.tsx` | overlay rosso: hold 3s per confermare, stato inviato, presa in carico, polling risoluzione |
| `AlarmSound.tsx` | sirena d'emergenza (loop, volume max): isola `expo-audio` + `react-native-volume-manager`, moduli nativi assenti in Expo Go |
| `SafeAlarmSound.tsx` | require protetto + error boundary attorno a `AlarmSound`: senza i moduli nativi (es. Expo Go) niente suono, ma `alarm.tsx` non cade su "unmatched route" |

### Libreria (`lib/`)

| File | Ruolo |
|------|-------|
| `api.ts` | client HTTP (cookie di sessione), tutti gli endpoint, `API_BASE` |
| `tracking.ts` | task GPS in background + accelerometro (picco-g) + geofence "fuori zona" |
| `store.ts` | AsyncStorage: user, session, cookie, settings, cache area, cache messaggio emergenza |
| `tiles.ts` | mappa offline: download/gestione tile, manifest, template `file://` per la RasterSource MapLibre |
| `outbox.ts` | coda offline: pin GPS e SOS non inviati (assenza rete) bufferizzati e ri-spediti al ritorno della rete |
| `sfx.ts` | suono di conferma ("don-din") su presa in carico e "sto bene"; `expo-audio` dietro require protetto |

## Flusso utente

1. **Login** → cookie di sessione salvato. La **registrazione è solo web**: "Registrati" apre `/register?from=app` nel browser; a fine flusso una pagina "Torna all'app" fa deep-link `grappasafe://login?username=…` e riporta al login col campo precompilato.
2. Sulla mappa, **Inizia attività** → modale → `POST /api/session/start` → chip LIVE.
3. Il task GPS manda `POST /api/gps` a intervallo configurabile (default 15s). La
   traccia compare sulla mappa (dallo stesso endpoint del link condiviso).
4. **Pausa** ferma il GPS localmente tenendo viva la sessione; **Stop** la termina.
5. **SOS**: tap → overlay rosso → tieni premuto ovunque 3s → `POST /api/emergency`.
6. Emergenza *auto*: il server la rileva, risponde al GPS con `pending_emergency` →
   notifica locale → `alarm.tsx` (conferma / "sto bene").
7. A emergenza inviata l'overlay resta col messaggio del server finché un operatore
   non la risolve; se la **prende in carico**, l'app lo segnala.

## Mappe offline (OpenTopoMap)

Le tile raster sono **self-hosted**: uno script sul backend (`fetch_map_tiles.py`)
scarica una volta le tile del cerchio monitorato (zoom 9–16, ~10k tile) e le serve
su `/map-tiles/{z}/{x}/{y}.png` + un `manifest.json`. Gli utenti non colpiscono mai
OpenTopoMap: il fetch è controllato e una tantum (la policy OTM vieta il download di
massa dai client).

Lato app (Impostazioni → "Scarica mappa offline"): `tiles.ts` scarica il manifest e
le tile in `FileSystem.documentDirectory/map-tiles/…` e le rende via una RasterSource
MapLibre (schema `file://`). Dettagli in `OfflineMap.tsx`:
- selettore online/offline nei settings (default online);
- in offline le tile locali stanno **sopra** una base OpenTopoMap online: dentro il
  cerchio vince l'offline, fuori traspare l'online — e senza rete resta solo la zona
  scaricata;
- **clamp di zoom in offline**: la camera è vincolata al range scaricato
  `[min_zoom, max_zoom]` (dal manifest), così non si esce mai dalle tile locali —
  niente overzoom sfocato né schermo nero ai bordi di zoom. Per andare oltre (vista più
  larga o dettaglio z17 online) si passa alla **modalità online** (base completa, nessun clamp).

Il cerchio monitorato (centro + raggio) arriva da `GET /api/config`, non è hardcodato.

## Emergenze

- **Manuale**: `POST /api/emergency`. Il server la gestisce sia con sessione attiva
  sia senza; in ogni caso l'emergenza porta l'identità dell'utente (nome, telefono,
  gruppo sanguigno, contatto d'emergenza).
- **Automatica**: macchina a stati server-side (discesa rapida → atterraggio →
  immobile). L'app non applica soglie: manda il **picco** di accelerazione, decide
  il server.
- **Messaggio all'utente**: configurabile dal pannello admin (`emergency_user_message`),
  ricevuto in `POST /api/emergency` e nel polling; cachato in locale con una costante
  di fallback, così non è mai vuoto anche offline.
- **Presa in carico / risoluzione**: l'app polla `GET /api/emergency/status`. Quando
  un operatore prende in carico → messaggio "un operatore la sta gestendo"; quando
  risolve → il server **chiude la sessione** e l'app ferma il tracking (durante
  l'emergenza il GPS resta vivo per i soccorsi).
- **Overlay a metà schermo**: durante la conferma (hold) l'overlay è a tutto schermo;
  a emergenza **inviata** scende alla metà inferiore, lasciando la **mappa visibile e
  navigabile** sopra (chip LIVE e ingranaggio nascosti mentre l'emergenza è aperta).
- **Allarme sonoro**: sull'emergenza *pending* (`alarm.tsx`) parte una **sirena in loop
  a volume massimo** oltre alla vibrazione SOS — forza il volume media su Android e suona
  attraverso il silenzioso su iOS, ripristinando il volume alla chiusura. Il suono è in
  `assets/alarm.wav` (sirena wail ~6s, segnaposto sostituibile). **Lo stesso `alarm.wav`**
  è anche il suono della **notifica** d'emergenza (canale Android ad alta priorità), così
  suona forte anche prima che la schermata si apra.
- **Conferma sonora** (`lib/sfx.ts`, `assets/confirm.wav`): un breve "don-din" alla
  **presa in carico** da parte dell'operatore e quando l'utente conferma **"sto bene"**.

## Resilienza offline (outbox)

In ombra radio/cella un pin (o un SOS) **non si perde**: `lib/outbox.ts` lo bufferizza
in locale e lo ri-spedisce al primo contatto utile.

- **Pin GPS**: su errore di rete il punto va in coda (cap ~500, scarta i più vecchi).
  A ogni tick la coda viene svuotata **dal più vecchio, prima del punto nuovo** — il
  server usa il `ts` del payload e la macchina a stati vuole tempo monotono — così la
  **traccia si ricompone** e **impatti/immobilità** del buco vengono valutati dal
  server in ritardo ma **non persi**. `sendGps` distingue rete assente (riprova) da
  rifiuto server (scarta, es. sessione finita).
- **SOS manuale**: un invio fallito viene accodato e ritentato — dal task GPS **e** dal
  polling dell'overlay, quindi funziona **anche senza sessione attiva**. L'overlay resta
  "inviato" con la nota **"in attesa di rete"** finché il server non lo prende.
- **Limiti (per scelta)**: recupero **differito** (la risposta real-time resta ritardata
  quanto il buco); l'SOS in coda è timbrato all'orario di consegna, non del tap.

## Condivisione live

Ogni utente ha uno `share_token` (in `GET /api/me`). Toccando il chip LIVE si apre
il foglio di condivisione col link pubblico `https://grappasafe.borant.eu/map/{token}`,
una mappa che si aggiorna ogni 15s. Il token è **per-utente e stabile** (non
per-sessione): mostra sempre la sessione attualmente attiva.

## Contratto server

Tutto sotto sessione via cookie `session`, HTTPS.

| Endpoint | Uso |
|----------|-----|
| `POST /api/login`, `POST /api/register`, `POST /logout` | auth |
| `GET /api/me`, `PUT /api/me` | profilo (include `share_token`); self-edit |
| `GET /api/config` | cerchio monitorato (centro, raggio) |
| `POST /api/session/start` / `end` / `status`, `POST /api/session/ok` | sessione |
| `POST /api/gps` | cuore del monitoraggio (payload sotto) |
| `POST /api/emergency`, `/emergency/confirm`, `GET /api/emergency/status` | emergenza |
| `GET /api/map/{token}` (pubblico) | traccia live (app + link condiviso) |
| `GET /map-tiles/manifest.json`, `/map-tiles/{z}/{x}/{y}.png` | tile offline |

Payload GPS (app → server): `{ lat, lon, alt_m, speed_ms, motion_state,
impact_detected, accel_magnitude, battery_pct, ts }`. Risposta: `{ sm_state,
db_state, pending_emergency: {trigger, expires_in} | null }`.

## Permessi

- **Android**: `ACCESS_BACKGROUND_LOCATION`, `FOREGROUND_SERVICE`,
  `FOREGROUND_SERVICE_LOCATION`, `POST_NOTIFICATIONS` — in `app.json`.
- **iOS**: background mode `location` in `infoPlist.UIBackgroundModes` — in `app.json`.

## Expo Go vs dev build

Expo Go (SDK 54) basta per login, registrazione, sessione, GPS in foreground, mappa,
overlay emergenza. **Non** è affidabile per:
- **background location** a schermo spento;
- **notifiche** complete — dall'SDK 53 le push remote sono rimosse da Expo Go (l'app
  usa solo notifiche locali, ma il flusso emergenza va verificato fuori da Expo Go);
- **moduli nativi aggiunti** — date picker (`@react-native-community/datetimepicker`) e
  soprattutto il **suono d'allarme** (`expo-audio` + `react-native-volume-manager`) non
  sono in Expo Go: la sirena è isolata dietro `SafeAlarmSound` (require protetto + error
  boundary) e degrada in silenzio senza far cadere la schermata `alarm`, ma va provata
  su dev build.

Per tutto questo serve una **dev build EAS**. `bundleIdentifier` / `package` =
`eu.borant.grappasafe`.

## Verso gli app store — cosa manca

- **Dev build EAS**: mai fatta. È il prossimo gate — sblocca background affidabile e
  notifiche complete, e va provata su device reale a schermo spento.
- **Icone e splash**: `assets/icon.png`, `splash.png`, `adaptive-icon.png` sono
  **placeholder da 70 byte**. Servono asset veri prima di qualsiasi store.
- **Suono d'allarme**: `assets/alarm.wav` è una sirena segnaposto generata — sostituirla
  con il suono definitivo (mantenendo il nome file o aggiornando il `require` in `alarm.tsx`).
- **Distribuzione**: decidere canale (APK diretto al consorzio vs Play Store / App Store).
- **Calibrazione soglia impatto**: server-side (`impact_g_<attivita>`), da tarare con
  tracce reali di volo/atterraggio.
- **`battery_pct` sempre `null`**: `expo-battery` non è incluso. Aggiungerlo se il
  livello batteria serve al monitoraggio (device che si spegne = fine tracce).

## Possibili feature future

### Far suonare il telefono dalla dashboard ("locate", find-my-phone)
Un operatore, dalla dashboard admin, fa **suonare a volume massimo** il telefono di una
persona monitorata, per **localizzarla a orecchio** sul campo (es. persona svenuta con il
telefono in tasca).

- **Canale**: nessuna infrastruttura nuova — passa per il **polling già esistente**. Il
  server setta un flag `locate` per la sessione, lo include nella risposta a `/api/gps`
  (o `/api/emergency/status`), l'app reagisce e un endpoint lo **spegne**.
- **Reazione app**: riusa la sirena (`assets/alarm.wav`) e la plumbing di `SafeAlarmSound`
  (volume forzato, loop, silenzioso bypassato) + vibrazione, con schermo "un soccorritore
  ti sta cercando · silenzia". L'operatore mantiene il **clear** finché non trovata.
- **Vincolo chiave**: funziona solo se l'**app è viva** — cioè durante un'**attività attiva**
  (il foreground service tiene vivo il polling). Nello scenario di soccorso in genere è così
  (la sessione era attiva). Con **app chiusa / nessuna sessione** servirebbe un **push remoto
  (FCM)** per risvegliarla — infrastruttura più grossa, da valutare a parte.
- **Da validare**: audio in **loop dal contesto background/poll** (fallback robusto: notifiche
  sonore ripetute col canale); **latenza** fino a ~15s (accelerabile mentre `locate` è attivo).
- **Extra**: bottone **silenzia** lato utente (persona cosciente), **audit** di chi attiva il
  locate, e **batteria %** in dashboard (telefono scarico = inutile far suonare).

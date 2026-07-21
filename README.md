# GrappaSafe Mobile

App React Native + Expo per il monitoraggio outdoor del Consorzio di Volo del Grappa.
Un utente avvia un'attività (volo, hike, bici…), il telefono manda posizione e
accelerazione al backend, e in caso di emergenza — manuale o rilevata dal server —
i soccorsi vengono allertati con l'identità e i contatti della persona.

Backend e pannelli (admin/observer/user, OGN, emergenze) stanno nel repo
[`grappasafe`](https://github.com/that-ugly-cat/grappasafe), in produzione su
`grappasafe.borant.eu`. Questo repo è solo l'app.

## Stack

- Expo SDK 54, React Native 0.81, React 19, expo-router 6
- Mappa: `react-native-maps` (Google/Apple sotto, ma usata solo come contenitore:
  la base è OpenTopoMap via tile)
- GPS in background: `expo-location` + `expo-task-manager`; accelerometro:
  `expo-sensors`; tile offline: `expo-file-system`; notifiche: `expo-notifications`

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
| `login.tsx` | login + logo consorzio (form in ScrollView per la tastiera) |
| `register.tsx` | auto-registrazione pubblica (dati personali + emergenza) |
| `map.tsx` | schermata unica: mappa + overlay + attività + emergenza + share |
| `settings.tsx` | profilo, modalità mappa, frequenza GPS, alert zona, mappa offline, logout |
| `alarm.tsx` | countdown full-screen su emergenza *pending* (auto-rilevata) |
| `_layout.tsx` | stack navigator + handler notifiche + SafeAreaProvider |

### Componenti (`components/`)

| File | Ruolo |
|------|-------|
| `OfflineMap.tsx` | `MapView` (`mapType="none"`) + base OTM online + tile locali sopra + cerchio zona + traccia + pallino utente |
| `SafeMap.tsx` | error boundary attorno a `OfflineMap`: se `react-native-maps` manca nel runtime (es. Expo Go), mostra un placeholder invece di far cadere la schermata |
| `ActivityModal.tsx` | modale di scelta attività (avvia sessione + tracking) |
| `EmergencyOverlay.tsx` | overlay rosso: hold 3s per confermare, stato inviato, presa in carico, polling risoluzione |

### Libreria (`lib/`)

| File | Ruolo |
|------|-------|
| `api.ts` | client HTTP (cookie di sessione), tutti gli endpoint, `API_BASE` |
| `tracking.ts` | task GPS in background + accelerometro (picco-g) + geofence "fuori zona" |
| `store.ts` | AsyncStorage: user, session, cookie, settings, cache area, cache messaggio emergenza |
| `tiles.ts` | mappa offline: download/gestione tile, manifest, path per `LocalTile` |

## Flusso utente

1. **Login** o **Registrati** → cookie di sessione salvato.
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
le tile in `FileSystem.documentDirectory/map-tiles/…` e le rende via `<LocalTile>`.
Dettagli in `OfflineMap.tsx`:
- selettore online/offline nei settings (default online);
- in offline le tile locali stanno **sopra** una base OpenTopoMap online: dove il
  locale copre vince l'offline, altrove (adiacenti fuori dal cerchio, o sotto lo
  zoom minimo) traspare l'online — e senza rete resta solo la zona scaricata;
- zoom-in bloccato al livello massimo scaricato (niente tile oltre = niente vuoto).

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
  usa solo notifiche locali, ma il flusso emergenza va verificato fuori da Expo Go).

Per entrambi serve una **dev build EAS**. `bundleIdentifier` / `package` =
`eu.borant.grappasafe`.

## Verso gli app store — cosa manca

- **Dev build EAS**: mai fatta. È il prossimo gate — sblocca background affidabile e
  notifiche complete, e va provata su device reale a schermo spento.
- **Icone e splash**: `assets/icon.png`, `splash.png`, `adaptive-icon.png` sono
  **placeholder da 70 byte**. Servono asset veri prima di qualsiasi store.
- **Distribuzione**: decidere canale (APK diretto al consorzio vs Play Store / App Store).
- **Calibrazione soglia impatto**: server-side (`impact_g_<attivita>`), da tarare con
  tracce reali di volo/atterraggio.
- **`battery_pct` sempre `null`**: `expo-battery` non è incluso. Aggiungerlo se il
  livello batteria serve al monitoraggio (device che si spegne = fine tracce).

## Possibile futuro: mappa vettoriale (MapLibre)

Le tile OpenTopoMap sono raster e a certi zoom si vedono un po' pixelate.
Un giorno, **forse**, si potrebbe passare a **MapLibre GL** (vettoriale): nitido a
ogni zoom, pacchetti offline molto più leggeri, ristilabile. Costa però una
riarchitettura della mappa (via `react-native-maps`, dentro
`@maplibre/maplibre-react-native`), obbliga alla dev build (modulo nativo, fuori da
Expo Go) e richiede una sorgente + stile topo vettoriale (es. estratto `.pmtiles`
dell'area, con curve di livello derivate dal DEM SRTM che il backend ha già). Da
valutare **abbinato al passaggio a dev build**, non prima.

## Convenzione repo

Repo pubblico. Nei commit niente tracce AI: commenti in inglese, stile umano,
nessun trailer di co-autore.

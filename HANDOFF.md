# GrappaSafe — Handoff app mobile

*Aggiornato: 21 luglio 2026*

Stato e prossimi passi dell'app mobile. Per architettura, struttura file e contratto
server c'è il `README.md`; qui sta il racconto di dove siamo e cosa resta verso gli
store. Il backend è chiuso e in produzione su `grappasafe.borant.eu`
([repo `grappasafe`](https://github.com/that-ugly-cat/grappasafe)).

---

## Dove siamo

L'app è stata ripensata **map-first** e validata su Android/Expo Go. Non è più uno
scaffold non testato: login, registrazione, sessione, GPS, mappa, overlay emergenza,
settings e condivisione girano su device reale contro la produzione.

Cosa è stato fatto in questo giro:

- **Toolchain da zero** su macchina nuova e **upgrade SDK 52 → 54** (RN 0.81, React 19),
  con i breaking change di `expo-notifications` migrati.
- **Restructure map-first**: una sola `map.tsx` (mappa + overlay) al posto di
  dashboard/activity/tracking separate. Chip LIVE, Pausa/Stop, modale attività,
  overlay emergenza.
- **Auto-registrazione pubblica** (`register.tsx` + `POST /api/register`), **profilo
  self-edit** (`PUT /api/me`), **logout** nei settings.
- **Mappe offline OpenTopoMap**: tile self-hosted (zoom 9–16) scaricabili sul device,
  con base online sotto per le aree non coperte e blocco zoom-in al massimo.
- **Emergenze**: SOS manuale con hold 3s su tutto lo schermo; messaggio configurabile
  dal server (cache + fallback); **presa in carico** dall'operatore mostrata sull'app;
  alla **risoluzione** il server chiude la sessione e l'app ferma il tracking (il GPS
  resta vivo *durante* l'emergenza per i soccorsi).
- **Identità emergenza**: colonna `user_id` su `emergencies` — un SOS manuale *senza
  sessione* porta comunque nome, telefono, gruppo sanguigno, contatto d'emergenza.
- **Condivisione live**: il chip LIVE apre il link pubblico `/map/{share_token}`.
- **Traccia** disegnata sulla mappa dell'app (stesso endpoint del link).
- Fix vari: password auto-capitalizzata (login 401), `GLIDER` accettato lato server,
  tastiera che copriva la password, chip che si sovrapponeva ai settings.

---

## Contratto server (mobile → backend)

Tutto sotto cookie `session`, HTTPS. Endpoint usati dall'app:

- Auth: `POST /api/login`, `POST /api/register`, `POST /logout`
- Profilo: `GET /api/me` (include `share_token`), `PUT /api/me`
- Config: `GET /api/config` (cerchio monitorato: `area_lat/lon`, `area_radius_km`)
- Sessione: `POST /api/session/start` `{attivita}`, `/end`, `GET /status`, `POST /ok`
- GPS: `POST /api/gps` — payload `{lat, lon, alt_m, speed_ms, motion_state,
  impact_detected, accel_magnitude, battery_pct, ts}`; risposta `{sm_state, db_state,
  pending_emergency: {trigger, expires_in} | null}`
- Emergenza: `POST /api/emergency`, `/emergency/confirm`, `GET /api/emergency/status`
  (`{active, acknowledged, message, …}`)
- Live/offline: `GET /api/map/{token}` (pubblico, traccia), `/map-tiles/{z}/{x}/{y}.png`

**Impatto:** l'app manda il **picco** di accelerazione (g) dall'ultimo invio e lascia
`impact_detected:false` — decide il server, soglia per attività (`impact_g_<attivita>`,
regola `AUTO_IMPACT`). Vedi `lib/tracking.ts` (finestra di picco a 100 ms).

**Logica emergenza volo in produzione:** `descending_fast → landed → immobile 120 s`.
`AUTO_IMMOBILE` puro **disattivato** di default (evita "fermo a mangiare"),
`SIGNAL_LOST` **rimosso**.

---

## Punti aperti (verso gli store, in ordine)

1. **Dev build EAS** — mai fatta, è il gate principale: sblocca background location a
   schermo spento e notifiche complete (fuori da Expo Go). Provare il foreground
   service Android col GPS a schermo spento.
2. **Icone e splash** — `assets/icon.png`, `splash.png`, `adaptive-icon.png` sono
   placeholder da 70 byte. Servono asset veri prima di ogni store.
3. **Distribuzione** — canale da decidere: APK diretto al consorzio vs Play/App Store.
   `bundleIdentifier`/`package` = `eu.borant.grappasafe`.
4. **Calibrazione soglia impatto** — server-side, con tracce reali di volo/atterraggio.
5. **`battery_pct` sempre `null`** — `expo-battery` non incluso; aggiungerlo se serve.
6. **Emergenza end-to-end su dev build** — verificare notifica → `alarm.tsx` →
   conferma/annulla, e la presa in carico/risoluzione dal pannello, fuori da Expo Go.

**Forse, un giorno:** passaggio della mappa a **MapLibre GL** vettoriale (nitido a
ogni zoom, offline più leggero). Costa una riarchitettura e obbliga alla dev build;
da valutare abbinato a quel milestone, non prima. Dettaglio nel `README.md`.

---

## Come far girare

```bash
npm install
npx expo start
```

Server di default in `lib/api.ts`: `https://grappasafe.borant.eu`. Per lo sviluppo
locale puntare a `http://<ip-lan>:8010` (non `localhost`: il device fisico non lo
risolve; server in ascolto su `0.0.0.0`). Su macchina nuova: `npx expo install --fix`.

---

## Stato webapp (contesto)

- Deploy: VPS borant, `/opt/apps/grappasafe`, Docker, Caddy → `grappasafe.borant.eu`,
  porta 8010. Redeploy: `cd /opt/apps/grappasafe && git pull && docker compose up -d --build`.
- Ruoli: `user`, `observer` (dashboard read-only + risolve/prende in carico emergenze),
  `admin`. Guard: `require_auth` / `require_viewer` / `require_admin`.
- OGN attivo (callsign `GSAFE1`). Precedenza attività: utente > device > tipo OGN.
- Orari in UTC, mostrati in ora di Roma. Retention tracce: 7 giorni, tracce legate a
  emergenze conservate.
- Aggiunte lato backend guidate dal mobile: `/api/register`, `/api/config`,
  `/api/emergency/status`, presa in carico (`/admin/emergency/{id}/ack`), `PUT /api/me`
  con `share_token`, colonna `user_id` su `emergencies`, tile offline
  (`fetch_map_tiles.py` + mount `/map-tiles` da volume), chiusura sessione alla
  risoluzione emergenza, `GLIDER` accettato in `session_start`.
- **Vincolo commit**: niente tracce AI (commenti in inglese, stile umano, nessun
  trailer di co-autore).

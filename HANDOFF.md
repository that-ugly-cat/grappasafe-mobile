# GrappaSafe — Handoff per il giro sull'app mobile

*Aggiornato: 14 luglio 2026*

Documento di passaggio di consegne. Il lavoro sulla **webapp** (backend + pannelli
admin/observer/user + OGN + emergenze + retention + mobile responsive) è chiuso e
in produzione su `grappasafe.borant.eu`. Il prossimo giro è sull'**app mobile**.

---

## 1. Dove siamo

L'app in `mobile/` è un progetto **Expo Router (React Native)** già scaffoldato e
scritto per intero. Tutte le schermate esistono e sono cablate agli endpoint del
server. **Non è mai stata testata end-to-end contro il server live**, né buildata
per distribuzione. Questo è il cuore del prossimo giro: farla girare su un device
reale, testarla contro la produzione, calibrare, e distribuirla.

Schermate (tutte implementate, non stub):

| File | Ruolo | Righe |
|------|-------|-------|
| `app/index.tsx` | splash + redirect (login / dashboard / tracking) | 35 |
| `app/login.tsx` | login username/password | 99 |
| `app/dashboard.tsx` | home utente loggato senza sessione attiva | 60 |
| `app/activity.tsx` | scelta attività prima di avviare il monitoraggio | 96 |
| `app/tracking.tsx` | schermata attiva durante la sessione + SOS | 286 |
| `app/alarm.tsx` | countdown full-screen su emergenza pending | 279 |
| `app/_layout.tsx` | stack navigator + handler notifiche | 90 |

Libreria:

| File | Ruolo |
|------|-------|
| `lib/api.ts` | client HTTP verso il backend (cookie di sessione) |
| `lib/tracking.ts` | GPS in background + accelerometro (peak-g) |
| `lib/store.ts` | AsyncStorage (user, session, cookie) |

---

## 2. Contratto API — verificato contro `app.py`

Gli endpoint che l'app chiama esistono tutti sul server. Nessun disallineamento
di rotta. Riepilogo dei punti di contatto (tutti sotto sessione via cookie
`session`, HTTPS):

| App (`lib/api.ts`) | Server | Note |
|--------------------|--------|------|
| `POST /api/login` `{username,password}` | `app.py:149` | accetta tutti gli utenti, non solo admin |
| `POST /logout` | route form | cancella cookie lato app |
| `GET /api/me` | `app.py:644` | `{id,username,nome,cognome,is_admin}` |
| `POST /api/session/start` `{attivita}` | `app.py:292` | ritorna `{session_id,state}` |
| `POST /api/session/end` | `app.py:326` | |
| `GET /api/session/status` | `app.py:402` | `{active,session_id?,attivita?,state?}` |
| `POST /api/gps` (payload sotto) | `app.py:425` | cuore del monitoraggio |
| `POST /api/emergency/confirm` `{lat,lon,alt_m}` | `app.py:362` | utente conferma "ho bisogno di aiuto" |
| `POST /api/session/ok` | `app.py:341` | utente segnala "sto bene", resetta il pending |
| `POST /api/emergency` `{lat,lon,alt_m}` | `app.py:574` | SOS manuale |

### Payload GPS (app → server)

```ts
{ lat, lon, alt_m, speed_ms, motion_state, impact_detected,
  accel_magnitude, battery_pct, ts }
```

**Importante sull'impatto:** l'app manda `accel_magnitude` come **picco** di
accelerazione (in g) dall'ultimo invio, e lascia `impact_detected:false`.
**È il server a decidere l'impatto**, con una soglia per attività
(`impact_g_<attivita>` nella config emergency). L'app non deve più applicare una
soglia sua. Vedi `lib/tracking.ts` (finestra di picco su listener a 100 ms) e la
regola `AUTO_IMPACT` server-side.

### Risposta GPS (server → app)

```ts
{ sm_state, db_state, pending_emergency: { trigger, expires_in } | null }
```

`pending_emergency` non-null → il server ha rilevato una condizione anomala e
aspetta conferma entro `expires_in` secondi. L'app mostra la notifica al primo
rilevamento e apre `alarm.tsx`. Se non risponde entro il timeout, il server apre
l'emergenza da solo (auto-confirm, ridondanza sul client).

Logica emergenza volo attualmente in produzione: `descending_fast → landed →
immobile 120 s`. `AUTO_IMMOBILE` puro è **disattivato di default** (evita il caso
"fermo a mangiare"). `SIGNAL_LOST` è stato **rimosso**. L'app non lo referenzia
già, quindi nessun intervento richiesto lì.

---

## 3. Punti aperti per il prossimo giro (in ordine)

1. **Far girare l'app su device reale** (`npx expo start`, Expo Go per un primo
   giro). Verificare login → start sessione → invio GPS → risposta → end.
2. **Testare il flusso emergenza end-to-end** con dati reali: provocare un pending
   (o iniettarlo), verificare notifica, `alarm.tsx`, confirm e cancel, e che sul
   pannello admin l'emergenza compaia e si risolva.
3. **Calibrare la soglia impatto** ora che è server-side. Raccogliere qualche
   traccia reale di volo/atterraggio e tarare `impact_g_<attivita>`. La nota nel
   `README.md` che parla di "3.5g client-side" è **stale**: la decisione è passata
   al server, va riscritta.
4. **Background location affidabile.** Expo Go ha limiti sul background: per un
   test serio serve una **dev build EAS** (non Expo Go). Verificare che il
   foreground service Android tenga il GPS vivo a schermo spento.
5. **Distribuzione.** Mai fatto un build EAS. `bundleIdentifier` /
   `package` = `eu.borant.grappasafe`. Decidere canale (APK diretto vs store).
6. **Allineare la lista attività.** `lib/api.ts` `Attivita` manca `GLIDER`
   (aliante), che il server conosce. `AIRCRAFT`/`HELICOPTER` sono solo OGN e
   giustamente non selezionabili nell'app. Aggiungere `GLIDER` alla lista e alla
   schermata `activity.tsx`.
7. **`battery_pct` è sempre `null`.** `expo-battery` non è incluso. Se il livello
   batteria serve al monitoraggio (device che si spegne = fine tracce), aggiungerlo.

---

## 4. Come far girare / testare

```bash
cd tools/grappasafe/mobile
npm install
npx expo start
```

Server di default in `lib/api.ts`: `https://grappasafe.borant.eu` (produzione).
Per sviluppo locale puntare a `http://<ip-lan>:8010` (non `localhost`: il device
fisico non lo risolve; serve l'IP della macchina sulla LAN, e il server FastAPI
in ascolto su `0.0.0.0`).

Permessi: su Android serve `ACCESS_BACKGROUND_LOCATION` (già in `app.json`); su
iOS il background mode `location` (già configurato). Su Android 13+ anche
`POST_NOTIFICATIONS`.

---

## 5. Stato webapp (contesto, già chiuso)

- Deploy: VPS borant, `/opt/apps/grappasafe`, Docker, Caddy → `grappasafe.borant.eu`,
  porta 8010. Redeploy: `cd /opt/apps/grappasafe && git pull && docker compose up -d --build`.
- Ruoli: `user`, `observer` (dashboard read-only + può risolvere emergenze),
  `admin`. Guard: `require_auth` / `require_viewer` / `require_admin`.
- OGN attivo (callsign `GSAFE1`, passcode derivato). Parapendio vs aeromobile
  distinti per tipo OGN. Precedenza attività: utente > device > tipo OGN.
- Orari salvati in UTC, mostrati in ora di Roma (server e client).
- Retention tracce: 7 giorni, job giornaliero, tracce legate a emergenze conservate.
- Repo pubblico: `github.com/that-ugly-cat/grappasafe`. **Vincolo: niente tracce
  AI nei commit** (commenti in inglese, stile umano, nessun trailer di co-autore).
  Il repo va seminato dal disco, mai dalla history di Ono3.

### Ancora da verificare a occhio dopo il deploy webapp

- Barogrammi + tracce con dati veri (le tile su VPS mostrano AMSL/AGL distinti).
- Estetica delle isoipse di sfondo (SVG da sopratutto.eu) su landing e pannelli.
- Lo scrubber del barogramma (pin che scorre sulla mappa, ~80% opacità).
- Il responsive mobile della webapp appena pushato (misurato via JS, non a occhio).

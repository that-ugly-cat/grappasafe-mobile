# GrappaSafe Mobile

App React Native + Expo per il monitoraggio outdoor del Consorzio di Volo del Grappa.

## Setup

```bash
cd tools/grappasafe/mobile
npm install
npx expo start
```

## Dipendenze sistema

- Node 18+
- Expo Go (test su device) oppure EAS Build per distribuzione

## Configurazione server

Il base URL del server è hardcodato in `lib/api.ts`:

```ts
export const API_BASE = "https://grappasafe.borant.eu";
```

Cambia in `http://localhost:8000` per sviluppo locale.

## Struttura

```
app/
  _layout.tsx      — layout Expo Router (stack navigator)
  index.tsx        — splash redirect (login / dashboard / tracking)
  login.tsx        — schermata login
  dashboard.tsx    — home utente loggato, nessuna sessione attiva
  activity.tsx     — selezione attività prima di avviare il monitoraggio
  tracking.tsx     — schermata principale durante sessione attiva
lib/
  api.ts           — client HTTP verso il backend FastAPI
  tracking.ts      — background GPS + accelerometro
  store.ts         — AsyncStorage (user, session, cookie)
```

## Flusso utente

1. Login → salva cookie di sessione
2. Dashboard → "Inizia sessione"
3. Activity → scelta attività → `POST /api/session/start`
4. Tracking → GPS background ogni 15s → `POST /api/gps`
5. SOS hold 3s → `POST /api/emergency`
6. "Termina sessione" → `POST /api/session/end` → Dashboard

## Note

- Il background tracking richiede i permessi `ACCESS_BACKGROUND_LOCATION` su Android
- Su iOS è necessario il capability `location` in Background Modes (già configurato in app.json)
- La soglia impatto è 3.5g (expo-sensors Accelerometer) — da calibrare con dati reali

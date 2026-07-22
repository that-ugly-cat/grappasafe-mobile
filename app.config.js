// Estende app.json a runtime iniettando la Google Maps API key da variabile
// d'ambiente. react-native-maps su Android inizializza Google Maps all'avvio e
// pretende una API key nel manifest: senza, l'app crasha con
// "IllegalStateException: API key not found" (Expo Go ne ha una propria, la
// build standalone no).
//
// La chiave NON sta nel repo (pubblico): in locale arriva da .env (gitignored),
// in cloud da un EAS secret. Vedi .env.example.
//
// Expo legge prima app.json e lo passa qui come `config`; noi lo restituiamo
// arricchito, preservando tutto (incluso extra.eas.projectId).
export default ({ config }) => {
  const apiKey = process.env.GOOGLE_MAPS_API_KEY;

  return {
    ...config,
    android: {
      ...config.android,
      config: {
        ...config.android?.config,
        // Se la chiave manca, non aggiungiamo il blocco: build valida ma senza
        // mappa Google (utile a capire subito se la env non è arrivata).
        ...(apiKey ? { googleMaps: { apiKey } } : {}),
      },
    },
  };
};

import { useEffect, useState } from "react";
import { StyleSheet, View, Text } from "react-native";
import MapView, { Circle, LocalTile, UrlTile } from "react-native-maps";
import { AreaConfig } from "../lib/api";
import { localTilePathTemplate, getLocalManifest } from "../lib/tiles";

interface Props {
  area: AreaConfig;
  /** Se true stratifica le tile locali (offline) sopra la base online. */
  offlineReady: boolean;
  style?: object;
}

const ONLINE_URL = "https://a.tile.opentopomap.org/{z}/{x}/{y}.png";

// Mappa OpenTopoMap centrata sul cerchio monitorato. mapType="none" nasconde la
// base di Google/Apple. In offline le tile locali stanno SOPRA una base online:
// dove il locale ha la tile vince l'offline, altrove (adiacenti fuori dal
// cerchio, o sotto lo zoom minimo scaricato) traspare l'online. Senza rete
// resta solo la zona scaricata. Lo zoom-in è bloccato oltre il livello massimo.
export default function OfflineMap({ area, offlineReady, style }: Props) {
  const delta = Math.max(0.5, (area.area_radius_km * 2.4) / 111);
  const region = {
    latitude: area.area_lat,
    longitude: area.area_lon,
    latitudeDelta: delta,
    longitudeDelta: delta,
  };

  const [maxZoom, setMaxZoom] = useState<number | null>(null);

  useEffect(() => {
    if (offlineReady) {
      getLocalManifest().then((m) => m && setMaxZoom(m.max_zoom));
    } else {
      setMaxZoom(null);
    }
  }, [offlineReady]);

  return (
    <View style={[styles.wrap, style]}>
      <MapView
        style={StyleSheet.absoluteFill}
        mapType="none"
        initialRegion={region}
        showsUserLocation
        showsMyLocationButton={false}
        toolbarEnabled={false}
        maxZoomLevel={offlineReady ? maxZoom ?? 16 : undefined}
      >
        {/* Base online (sotto). Serve da fallback per le aree non scaricate. */}
        <UrlTile urlTemplate={ONLINE_URL} maximumZ={17} tileSize={256} zIndex={-1} />
        {/* Tile locali (sopra). Coprono la zona scaricata anche senza rete. */}
        {offlineReady && (
          <LocalTile pathTemplate={localTilePathTemplate()} tileSize={256} zIndex={0} />
        )}
        <Circle
          center={{ latitude: area.area_lat, longitude: area.area_lon }}
          radius={area.area_radius_km * 1000}
          strokeColor="#e63946"
          strokeWidth={2}
          fillColor="rgba(230,57,70,0.08)"
          zIndex={1}
        />
      </MapView>
      {!offlineReady && (
        <Text style={styles.badge}>mappa online — scaricala nei settings per l'offline</Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    overflow: "hidden",
    borderRadius: 14,
    backgroundColor: "#12121f",
    borderWidth: 1,
    borderColor: "#2a2a44",
  },
  badge: {
    position: "absolute",
    bottom: 6,
    left: 6,
    right: 6,
    textAlign: "center",
    fontSize: 11,
    color: "#ccc",
    backgroundColor: "rgba(15,15,26,0.7)",
    paddingVertical: 3,
    borderRadius: 6,
  },
});

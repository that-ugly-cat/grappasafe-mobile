import { useEffect, useState } from "react";
import { StyleSheet, View, Text } from "react-native";
import MapView, { Circle, LocalTile, UrlTile } from "react-native-maps";
import { AreaConfig } from "../lib/api";
import { localTilePathTemplate, getLocalManifest } from "../lib/tiles";

interface Props {
  area: AreaConfig;
  /** Se true usa le tile locali (offline) nel range coperto; altrimenti online. */
  offlineReady: boolean;
  style?: object;
}

const ONLINE_URL = "https://a.tile.opentopomap.org/{z}/{x}/{y}.png";

// zoom approssimato dal delta longitudinale della regione visibile.
function zoomFromLonDelta(lonDelta: number): number {
  return Math.round(Math.log2(360 / lonDelta));
}

// Mappa OpenTopoMap centrata sul cerchio monitorato. mapType="none" nasconde la
// base di Google/Apple: si vedono solo le tile topografiche + il cerchio zona.
// Offline: usa le tile locali dentro il range scaricato (z_min–z_max), blocca
// lo zoom-in oltre il massimo, e fa fallback online sotto il minimo.
export default function OfflineMap({ area, offlineReady, style }: Props) {
  const delta = Math.max(0.5, (area.area_radius_km * 2.4) / 111);
  const region = {
    latitude: area.area_lat,
    longitude: area.area_lon,
    latitudeDelta: delta,
    longitudeDelta: delta,
  };

  const [zoom, setZoom] = useState(zoomFromLonDelta(delta));
  const [range, setRange] = useState<{ min: number; max: number } | null>(null);

  useEffect(() => {
    if (offlineReady) {
      getLocalManifest().then((m) => m && setRange({ min: m.min_zoom, max: m.max_zoom }));
    } else {
      setRange(null);
    }
  }, [offlineReady]);

  const minZoom = range?.min ?? 9;
  const maxZoom = range?.max ?? 16;
  // Tile locali solo se offline attivo e siamo entro il minimo coperto;
  // sotto il minimo (zoom-out ampio) → OpenTopoMap online.
  const useLocal = offlineReady && zoom >= minZoom;

  return (
    <View style={[styles.wrap, style]}>
      <MapView
        style={StyleSheet.absoluteFill}
        mapType="none"
        initialRegion={region}
        showsUserLocation
        showsMyLocationButton={false}
        toolbarEnabled={false}
        maxZoomLevel={offlineReady ? maxZoom : undefined}
        onRegionChangeComplete={(r) => setZoom(zoomFromLonDelta(r.longitudeDelta))}
      >
        {useLocal ? (
          <LocalTile pathTemplate={localTilePathTemplate()} tileSize={256} />
        ) : (
          <UrlTile urlTemplate={ONLINE_URL} maximumZ={17} tileSize={256} />
        )}
        <Circle
          center={{ latitude: area.area_lat, longitude: area.area_lon }}
          radius={area.area_radius_km * 1000}
          strokeColor="#e63946"
          strokeWidth={2}
          fillColor="rgba(230,57,70,0.08)"
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

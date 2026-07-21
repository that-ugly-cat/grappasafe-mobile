import { StyleSheet, View, Text } from "react-native";
import MapView, { Circle, LocalTile, UrlTile } from "react-native-maps";
import { AreaConfig } from "../lib/api";
import { localTilePathTemplate } from "../lib/tiles";

interface Props {
  area: AreaConfig;
  /** Se true usa le tile locali (offline); altrimenti OpenTopoMap online. */
  offlineReady: boolean;
  style?: object;
}

// Mappa OpenTopoMap centrata sul cerchio monitorato. mapType="none" nasconde
// la base di Google/Apple: si vedono solo le nostre tile (topografiche) + il
// cerchio della zona. Il pin dell'utente è il dot nativo (showsUserLocation).
export default function OfflineMap({ area, offlineReady, style }: Props) {
  const delta = Math.max(0.5, (area.area_radius_km * 2.4) / 111);
  const region = {
    latitude: area.area_lat,
    longitude: area.area_lon,
    latitudeDelta: delta,
    longitudeDelta: delta,
  };

  return (
    <View style={[styles.wrap, style]}>
      <MapView
        style={StyleSheet.absoluteFill}
        mapType="none"
        initialRegion={region}
        showsUserLocation
        showsMyLocationButton={false}
        toolbarEnabled={false}
      >
        {offlineReady ? (
          <LocalTile pathTemplate={localTilePathTemplate()} tileSize={256} />
        ) : (
          <UrlTile
            urlTemplate="https://a.tile.opentopomap.org/{z}/{x}/{y}.png"
            maximumZ={16}
            tileSize={256}
          />
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

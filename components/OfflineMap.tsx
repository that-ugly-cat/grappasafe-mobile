import { useEffect, useMemo, useState } from "react";
import { StyleSheet, View, Text } from "react-native";
import {
  Map,
  Camera,
  RasterSource,
  GeoJSONSource,
  Layer,
  UserLocation,
  type LngLatBounds,
} from "@maplibre/maplibre-react-native";
import { AreaConfig } from "../lib/api";
import { localTileUriTemplate, getLocalManifest } from "../lib/tiles";
import { useT } from "../lib/i18n";

interface Props {
  area: AreaConfig;
  /** Se true stratifica le tile locali (offline) sopra la base online. */
  offlineReady: boolean;
  /** Traccia della sessione attiva (opzionale). */
  track?: { latitude: number; longitude: number }[];
  style?: object;
}

const ONLINE_URL = "https://a.tile.opentopomap.org/{z}/{x}/{y}.png";

// Stile MapLibre minimo: solo uno sfondo scuro. Nessuna base Google/Apple →
// nessuna API key. Le tile (OTM online + locali offline) e gli overlay li
// montiamo come layer figli sopra questo sfondo, nell'ordine di rendering.
const BASE_STYLE = JSON.stringify({
  version: 8,
  sources: {},
  layers: [{ id: "bg", type: "background", paint: { "background-color": "#12121f" } }],
});

// MapLibre non ha un cerchio geografico in metri (il circle-layer è in pixel),
// quindi il cerchio monitorato lo approssimiamo con un poligono GeoJSON.
function circleFeature(lat: number, lon: number, radiusKm: number, points = 72): GeoJSON.Feature {
  const latR = (radiusKm / 6371) * (180 / Math.PI);
  const lonR = latR / Math.cos((lat * Math.PI) / 180);
  const coords: [number, number][] = [];
  for (let i = 0; i <= points; i++) {
    const th = (i / points) * 2 * Math.PI;
    coords.push([lon + lonR * Math.cos(th), lat + latR * Math.sin(th)]);
  }
  return { type: "Feature", properties: {}, geometry: { type: "Polygon", coordinates: [coords] } };
}

// Mappa OpenTopoMap centrata sul cerchio monitorato. Base OTM online sotto; in
// offline le tile locali stanno SOPRA: dove il locale ha la tile vince
// l'offline, altrove traspare l'online. Senza rete resta la sola zona scaricata.
// Lo zoom-in è bloccato oltre il livello massimo scaricato (niente vuoti).
export default function OfflineMap({ area, offlineReady, track, style }: Props) {
  const t = useT();

  const [maxZoom, setMaxZoom] = useState<number | null>(null);
  const [minZoom, setMinZoom] = useState<number | null>(null);
  useEffect(() => {
    if (offlineReady) {
      getLocalManifest().then((m) => {
        if (!m) return;
        setMaxZoom(m.max_zoom);
        setMinZoom(m.min_zoom);
      });
    } else {
      setMaxZoom(null);
      setMinZoom(null);
    }
  }, [offlineReady]);

  // Inquadratura iniziale: i bounds del cerchio (esatta e indipendente dallo
  // schermo). Ordine LngLatBounds = [ovest, sud, est, nord]; 1.2x di margine.
  const bounds = useMemo<LngLatBounds>(() => {
    const latR = ((area.area_radius_km * 1.2) / 6371) * (180 / Math.PI);
    const lonR = latR / Math.cos((area.area_lat * Math.PI) / 180);
    return [
      area.area_lon - lonR,
      area.area_lat - latR,
      area.area_lon + lonR,
      area.area_lat + latR,
    ];
  }, [area.area_lat, area.area_lon, area.area_radius_km]);

  const zone = useMemo(
    () => circleFeature(area.area_lat, area.area_lon, area.area_radius_km),
    [area.area_lat, area.area_lon, area.area_radius_km]
  );

  const trackFeature = useMemo<GeoJSON.Feature | null>(() => {
    if (!track || track.length < 2) return null;
    return {
      type: "Feature",
      properties: {},
      geometry: { type: "LineString", coordinates: track.map((p) => [p.longitude, p.latitude]) },
    };
  }, [track]);

  return (
    <View style={[styles.wrap, style]}>
      <Map
        style={StyleSheet.absoluteFill}
        mapStyle={BASE_STYLE}
        logo={false}
        compass={false}
        attribution={false}
      >
        {/* In offline si clampa solo il MINIMO al pavimento delle tile scaricate:
            sotto z9 senza rete sarebbe schermo nero (zoom-out per l'overview → vuoto).
            Il massimo resta libero, così lo zoom-in raggiunge le online z17 nitide
            (con rete). Online (offlineReady false) nessun clamp: la base copre tutto. */}
        <Camera
          initialViewState={{ bounds }}
          minZoom={offlineReady ? minZoom ?? 9 : undefined}
        />

        {/* Base OTM online (sotto): fallback dove il locale non copre. */}
        <RasterSource id="otm-online" tiles={[ONLINE_URL]} tileSize={256} maxzoom={17}>
          <Layer id="otm-online-layer" type="raster" />
        </RasterSource>

        {/* Tile locali: sopra la base online, ma SOTTO gli overlay. `beforeId`
            le ancora sotto `zone-fill`: montano dopo il primo render (offlineReady
            diventa true async), e senza l'ancora MapLibre le metterebbe in cima,
            coprendo cerchio/traccia/pallino. */}
        {offlineReady && (
          <RasterSource
            id="otm-offline"
            tiles={[localTileUriTemplate()]}
            tileSize={256}
            minzoom={minZoom ?? 9}
            maxzoom={maxZoom ?? 16}
          >
            {/* minzoom sulla source: sotto il livello minimo scaricato l'offline
                non è attiva → traspare la base online (niente tile stirate).
                maxzoom sul layer = un filo oltre il massimo scaricato: le locali si
                vedono fino al loro top, oltre lasciano il posto alle online nitide. */}
            <Layer
              id="otm-offline-layer"
              type="raster"
              beforeId="zone-fill"
              maxzoom={(maxZoom ?? 16) + 1}
            />
          </RasterSource>
        )}

        {/* Cerchio monitorato: riempimento tenue + bordo. */}
        <GeoJSONSource id="zone" data={zone}>
          <Layer id="zone-fill" type="fill" paint={{ "fill-color": "#e63946", "fill-opacity": 0.08 }} />
          <Layer id="zone-line" type="line" paint={{ "line-color": "#e63946", "line-width": 2 }} />
        </GeoJSONSource>

        {/* Traccia della sessione attiva. */}
        {trackFeature && (
          <GeoJSONSource id="track" data={trackFeature}>
            <Layer
              id="track-line"
              type="line"
              paint={{ "line-color": "#e74c3c", "line-width": 4 }}
              layout={{ "line-cap": "round", "line-join": "round" }}
            />
          </GeoJSONSource>
        )}

        {/* Pallino utente. */}
        <UserLocation />
      </Map>

      {!offlineReady && <Text style={styles.badge}>{t("map.onlineBadge")}</Text>}
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

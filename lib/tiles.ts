import * as FileSystem from "expo-file-system/legacy";
import { API_BASE } from "./api";

// Le tile raster OpenTopoMap del cerchio monitorato, scaricate una volta dal
// nostro server e usate offline via la RasterSource di MapLibre (schema file://).

const TILES_DIR = FileSystem.documentDirectory + "map-tiles/";
const LOCAL_MANIFEST = TILES_DIR + "manifest.json";
const MANIFEST_URL = `${API_BASE}/map-tiles/manifest.json`;

export interface TileManifest {
  area: { lat: number; lon: number; radius_km: number };
  min_zoom: number;
  max_zoom: number;
  tile_size: number;
  count: number;
  tiles: [number, number, number][];
}

export interface DownloadProgress {
  done: number;
  total: number;
}

/** Template file:// per la RasterSource offline di MapLibre. */
export function localTileUriTemplate(): string {
  return TILES_DIR + "{z}/{x}/{y}.png";
}

/** True se la mappa offline è stata scaricata per intero (marker = manifest locale). */
export async function isMapDownloaded(): Promise<boolean> {
  const info = await FileSystem.getInfoAsync(LOCAL_MANIFEST);
  return info.exists;
}

export async function getLocalManifest(): Promise<TileManifest | null> {
  try {
    const raw = await FileSystem.readAsStringAsync(LOCAL_MANIFEST);
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

async function fetchManifest(): Promise<TileManifest> {
  // Cache-buster + no-cache: evita che un manifest vecchio venga servito da una
  // cache (device/rete) e faccia perdere le tile aggiunte lato server.
  const res = await fetch(`${MANIFEST_URL}?t=${Date.now()}`, {
    headers: { "Cache-Control": "no-cache" },
  });
  if (!res.ok) throw new Error(`manifest non disponibile: HTTP ${res.status}`);
  return (await res.json()) as TileManifest;
}

/**
 * Scarica tutte le tile del cerchio nel filesystem del device.
 * Idempotente: salta quelle già presenti, così è ripetibile/resumibile.
 * Il manifest locale viene scritto solo a download completo (marker).
 */
export async function downloadMap(
  onProgress?: (p: DownloadProgress) => void
): Promise<void> {
  const manifest = await fetchManifest();
  await FileSystem.makeDirectoryAsync(TILES_DIR, { intermediates: true }).catch(() => {});

  const tiles = manifest.tiles;
  const total = tiles.length;
  const CONCURRENCY = 6;
  const madeDirs = new Set<string>();
  let done = 0;
  let idx = 0;

  async function one([z, x, y]: [number, number, number]) {
    const dir = `${TILES_DIR}${z}/${x}/`;
    if (!madeDirs.has(dir)) {
      madeDirs.add(dir);
      await FileSystem.makeDirectoryAsync(dir, { intermediates: true }).catch(() => {});
    }
    const dest = `${dir}${y}.png`;
    const info = await FileSystem.getInfoAsync(dest);
    if (!info.exists) {
      try {
        // downloadAsync NON fallisce sugli errori HTTP: un 404 salverebbe la
        // pagina d'errore come tile .png (quadrato corrotto in mappa, per
        // sempre — il retry la vede "già presente"). Controlla lo status.
        const res = await FileSystem.downloadAsync(`${API_BASE}/map-tiles/${z}/${x}/${y}.png`, dest);
        if (res.status !== 200) {
          await FileSystem.deleteAsync(dest, { idempotent: true }).catch(() => {});
        }
      } catch {
        /* salta la singola tile, non bloccare l'intero download */
      }
    }
    done++;
    if (done % 25 === 0 || done === total) onProgress?.({ done, total });
  }

  async function worker() {
    while (idx < tiles.length) {
      await one(tiles[idx++]);
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));

  await FileSystem.writeAsStringAsync(LOCAL_MANIFEST, JSON.stringify(manifest));
}

export async function deleteMap(): Promise<void> {
  await FileSystem.deleteAsync(TILES_DIR, { idempotent: true });
}

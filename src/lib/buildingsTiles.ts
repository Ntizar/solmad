// Edificios ESTÁTICOS del Ayto. de Madrid (public/buildings/*.bin).
//
// 464.500 edificios con huella oficial y altura oficial (CC BY 4.0), simplificados
// a ~7 puntos (tolerancia 1,2 m: sobra para sombras) y empaquetados en 341 tiles
// de ~1,3 km (13 MB en total, 29 bytes por edificio).
//
// Ventajas frente a Overpass en vivo:
//   - instantáneo (fichero estático, cacheable, servido por CDN)
//   - sin rate limits, sin timeouts, sin cuelgues de Safari
//   - alturas reales de Madrid en TODA la ciudad, no solo en el bbox visible
//
// Formato SMBD v1 (little endian):
//   u32 'SMBD' | u8 version | u8 flags | u16 reservado | f64 originLng | f64 originLat
//   u32 nEdificios | por edificio: u8 altura_m, u8 nPuntos, nPuntos x (u16 x_dm, u16 y_dm)
import type { BuildingPoly } from './types';

export const TILE_SIZE_DEG = 0.012; // misma rejilla que el generador
export const MANIFEST_URL = '/buildings/manifest.json';
const M_PER_DEG_LAT = 111320;
const mPerDegLng = (lat: number) => M_PER_DEG_LAT * Math.cos((lat * Math.PI) / 180);

export interface BuildingsManifest {
  version: number;
  format: string;
  tileSizeDeg: number;
  generatedAt: string;
  tiles: Record<string, { n: number; bytes: number }>;
}

let manifestPromise: Promise<BuildingsManifest | null> | null = null;
let manifestCache: BuildingsManifest | null | undefined;

export function loadBuildingsManifest(): Promise<BuildingsManifest | null> {
  if (manifestCache !== undefined) return Promise.resolve(manifestCache);
  if (manifestPromise) return manifestPromise;
  manifestPromise = (async () => {
    try {
      const res = await fetch(MANIFEST_URL, { cache: 'force-cache' });
      if (!res.ok) { manifestCache = null; return null; }
      const data = (await res.json()) as BuildingsManifest;
      manifestCache = data?.tiles ? data : null;
      return manifestCache;
    } catch {
      manifestCache = null;
      return null;
    } finally {
      manifestPromise = null;
    }
  })();
  return manifestPromise;
}

export function tileKey(row: number, col: number) {
  return `${row}_${col}`;
}

export function tileKeyForCoords(lat: number, lng: number) {
  return tileKey(Math.floor(lat / TILE_SIZE_DEG), Math.floor(lng / TILE_SIZE_DEG));
}

/** Decodifica un tile binario a edificios con anillo WGS84 y altura en metros. */
export function decodeTileBuffer(buf: ArrayBuffer): BuildingPoly[] {
  const dv = new DataView(buf);
  if (buf.byteLength < 28) return [];
  const magic = String.fromCharCode(dv.getUint8(0), dv.getUint8(1), dv.getUint8(2), dv.getUint8(3));
  if (magic !== 'SMBD') return [];
  const version = dv.getUint8(4);
  if (version !== 1) return [];
  const originLng = dv.getFloat64(8, true);
  const originLat = dv.getFloat64(16, true);
  const n = dv.getUint32(24, true);
  const kx = mPerDegLng(originLat + TILE_SIZE_DEG / 2); // misma escala que el generador
  const out: BuildingPoly[] = [];
  let o = 28;
  for (let i = 0; i < n; i++) {
    if (o + 2 > buf.byteLength) break;
    const height = dv.getUint8(o); o += 1;
    const npts = dv.getUint8(o); o += 1;
    if (o + npts * 4 > buf.byteLength) break;
    const ring: [number, number][] = new Array(npts);
    for (let k = 0; k < npts; k++) {
      const x = dv.getUint16(o, true);
      const y = dv.getUint16(o + 2, true);
      o += 4;
      ring[k] = [originLng + (x / 10) / kx, originLat + (y / 10) / M_PER_DEG_LAT];
    }
    out.push({ ring, height });
  }
  return out;
}

/** Descarga y decodifica un tile. Devuelve null si no existe (fuera del municipio). */
export async function fetchStaticTile(row: number, col: number): Promise<BuildingPoly[] | null> {
  const manifest = await loadBuildingsManifest();
  if (!manifest) return null;
  if (!manifest.tiles[tileKey(row, col)]) return null;
  try {
    const res = await fetch(`/buildings/${tileKey(row, col)}.bin`);
    if (!res.ok) return null;
    return decodeTileBuffer(await res.arrayBuffer());
  } catch {
    return null;
  }
}

/** ¿La rejilla estática cubre este tile? (sin descargar nada) */
export async function staticTileExists(row: number, col: number): Promise<boolean> {
  const manifest = await loadBuildingsManifest();
  return !!manifest?.tiles[tileKey(row, col)];
}

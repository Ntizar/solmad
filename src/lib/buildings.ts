import type { BuildingPoly } from './types';

// Origen de edificios: ArcGIS del Ayto. de Madrid (dato abierto CC BY 4.0).
// Trae la geometría Y la altura oficial (ALTURA) de cada edificio, así que
// sustituye a Overpass (lento, rate-limited y sin alturas reales).
const SIGMA_URL = 'https://sigma.madrid.es/hosted/rest/services/CARTOGRAFIA/EDIFICIOS_ALTURAS/MapServer/0/query';
const RECORD_COUNT = 2000;
const DEFAULT_HEIGHT_M = 10;
const TILE_CACHE_KEY = 'solmad:buildings:tiles:v2'; // v2: origen ArcGIS/Ayto.
const TILE_TTL_MS = 1000 * 60 * 60 * 24 * 7; // tiles oficiales: 7 días
const TILE_SIZE_DEG = 0.012; // ~1.3km. Más fácil de cachear y reusar al panear.

interface TileEntry { ts: number; data: BuildingPoly[]; }
type TileCache = Record<string, TileEntry>;

const isMobile = typeof navigator !== 'undefined' && /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent);
const TILE_CONCURRENCY = isMobile ? 2 : 3;
const TILE_TIMEOUT_SEC = isMobile ? 16 : 24;

function readCache(): TileCache {
  try {
    const raw = localStorage.getItem(TILE_CACHE_KEY);
    if (!raw) return {};
    return JSON.parse(raw) as TileCache;
  } catch { return {}; }
}

function writeCache(cache: TileCache) {
  try {
    const now = Date.now();
    for (const k of Object.keys(cache)) {
      if (now - cache[k].ts > TILE_TTL_MS) delete cache[k];
    }
    localStorage.setItem(TILE_CACHE_KEY, JSON.stringify(cache));
  } catch { /* quota: ignorar */ }
}

function tileKey(row: number, col: number) {
  return `${row}:${col}`;
}

function bboxToTiles(bbox: [number, number, number, number]) {
  const [south, west, north, east] = bbox;
  const rowStart = Math.floor(south / TILE_SIZE_DEG);
  const rowEnd = Math.floor(north / TILE_SIZE_DEG);
  const colStart = Math.floor(west / TILE_SIZE_DEG);
  const colEnd = Math.floor(east / TILE_SIZE_DEG);
  const tiles: { row: number; col: number; bbox: [number, number, number, number] }[] = [];
  for (let row = rowStart; row <= rowEnd; row++) {
    for (let col = colStart; col <= colEnd; col++) {
      const s = row * TILE_SIZE_DEG;
      const w = col * TILE_SIZE_DEG;
      tiles.push({ row, col, bbox: [s, w, s + TILE_SIZE_DEG, w + TILE_SIZE_DEG] });
    }
  }
  return tiles;
}

async function pool<T, R>(items: T[], limit: number, work: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await work(items[index], index);
    }
  });
  await Promise.all(workers);
  return results;
}

/** Simplifica un polígono a ~8 vértices (suficiente para proyectar la sombra). */
function simplifyRing(pts: [number, number][]): [number, number][] {
  if (pts.length <= 8) return pts;
  const out: [number, number][] = [pts[0]];
  const step = (pts.length - 1) / 7;
  for (let i = 1; i < 7; i++) out.push(pts[Math.round(i * step)]);
  out.push(pts[pts.length - 1]);
  return out;
}

/** Convierte un feature del ArcGIS del Ayto. a BuildingPoly (con altura oficial). */
function arcgisToPolygon(feature: any): BuildingPoly | null {
  const attrs = feature?.attributes ?? {};
  const ring = feature?.geometry?.rings?.[0];
  if (!ring || ring.length < 3) return null;
  let height = Number(attrs.ALTURA);
  if (!Number.isFinite(height) || height <= 0) {
    // Fallback: diferencia de zetas si ALTURA no viene.
    height = Number(attrs.Z_EDIFICIO_CAMBIO_ALTURA) - Number(attrs.Z_EDIFICIO_HUELLA);
  }
  if (!Number.isFinite(height) || height <= 0) height = DEFAULT_HEIGHT_M;
  const coords: [number, number][] = ring.map((p: [number, number]) => [p[0], p[1]]);
  return { ring: simplifyRing(coords), height };
}

/** Query al ArcGIS del Ayto. por bbox (acepta WGS84 directly). Página a 2000. */
async function fetchArcGisPage(bbox: [number, number, number, number], offset: number) {
  const [s, w, n, e] = bbox;
  const geometry = `${w},${s},${e},${n}`;
  const params = new URLSearchParams({
    f: 'json',
    where: '1=1',
    geometry,
    geometryType: 'esriGeometryEnvelope',
    spatialRel: 'esriSpatialRelIntersects',
    inSR: '4326',
    outSR: '4326',
    returnGeometry: 'true',
    outFields: 'ALTURA,Z_EDIFICIO_CAMBIO_ALTURA,Z_EDIFICIO_HUELLA',
    resultOffset: String(offset),
    resultRecordCount: String(RECORD_COUNT),
  });
  // User-Agent custom: el ArcGIS responde 403 sin él.
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), (TILE_TIMEOUT_SEC + 4) * 1000);
  try {
    const res = await fetch(`${SIGMA_URL}?${params.toString()}`, {
      headers: { 'User-Agent': 'SolMAD/1.0 (datos abiertos Ayto. Madrid)' },
      signal: controller.signal
    });
    if (!res.ok) throw new Error(`ArcGIS ${res.status}`);
    return await res.json();
  } finally {
    window.clearTimeout(timer);
  }
}

async function fetchTile(bbox: [number, number, number, number]) {
  const out: BuildingPoly[] = [];
  let offset = 0;
  let lastError: unknown = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const json = await fetchArcGisPage(bbox, offset);
      const features = json.features ?? [];
      for (const f of features) {
        const poly = arcgisToPolygon(f);
        if (poly) out.push(poly);
      }
      if (!json.exceededTransferLimit || features.length === 0) break;
      offset += RECORD_COUNT;
    } catch (err) {
      lastError = err;
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }
  if (out.length === 0 && lastError) console.warn('[solmad] Tile de edificios (ArcGIS) omitido:', lastError);
  return out;
}

interface FetchOptions {
  onProgress?: (done: number, total: number) => void;
  onPartial?: (buildings: BuildingPoly[]) => void;
  signal?: { cancelled: boolean };
}

/**
 * Descarga edificios por tiles ~1.3km desde el ArcGIS del Ayto. (dato abierto).
 * Cada tile trae geometría + altura oficial; se cachea 7 días en localStorage.
 * bbox = [south, west, north, east]
 */
export async function fetchBuildings(
  bbox: [number, number, number, number],
  opts: FetchOptions = {}
): Promise<BuildingPoly[]> {
  const cache = readCache();
  const tiles = bboxToTiles(bbox);
  if (tiles.length === 0) return [];

  const cy = (bbox[0] + bbox[2]) / 2;
  const cx = (bbox[1] + bbox[3]) / 2;
  const centerRow = cy / TILE_SIZE_DEG;
  const centerCol = cx / TILE_SIZE_DEG;
  tiles.sort((a, b) => {
    const da = (a.row - centerRow) ** 2 + (a.col - centerCol) ** 2;
    const db = (b.row - centerRow) ** 2 + (b.col - centerCol) ** 2;
    return da - db;
  });

  const total = tiles.length;
  let done = 0;
  const acc: BuildingPoly[] = [];
  let cacheDirty = false;

  // Primero vacía caché y emite acumulado de tiles cacheados (instantáneo).
  for (const tile of tiles) {
    const key = tileKey(tile.row, tile.col);
    const entry = cache[key];
    if (entry && Date.now() - entry.ts <= TILE_TTL_MS) {
      acc.push(...entry.data);
      done++;
      opts.onProgress?.(done, total);
    }
  }
  if (acc.length) opts.onPartial?.(acc);

  const pending = tiles.filter((tile) => {
    const key = tileKey(tile.row, tile.col);
    const entry = cache[key];
    return !entry || Date.now() - entry.ts > TILE_TTL_MS;
  });

  if (pending.length === 0) {
    return acc;
  }

  await pool(pending, TILE_CONCURRENCY, async (tile) => {
    if (opts.signal?.cancelled) return;
    const data = await fetchTile(tile.bbox);
    if (opts.signal?.cancelled) return;
    cache[tileKey(tile.row, tile.col)] = { ts: Date.now(), data };
    cacheDirty = true;
    acc.push(...data);
    done++;
    opts.onProgress?.(done, total);
    opts.onPartial?.(acc);
  });

  if (cacheDirty) writeCache(cache);
  return acc;
}

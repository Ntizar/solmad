import type { BuildingPoly } from './types';

const ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass.osm.ch/api/interpreter'
];
// Alturas oficiales del Ayto. de Madrid (CC BY 4.0). Mejor que OSM levels*3.2.
const SIGMA_ALTURAS_URL = 'https://sigma.madrid.es/hosted/rest/services/CARTOGRAFIA/EDIFICIOS_ALTURAS/MapServer/0/query';
const DEFAULT_HEIGHT_M = 10;
const LEVEL_HEIGHT_M = 3.2;
const TILE_CACHE_KEY = 'solmad:buildings:tiles:v1';
const ALTURAS_CACHE_KEY = 'solmad:buildings:alturas:v1';
const TILE_TTL_MS = 1000 * 60 * 60 * 24 * 3; // 3 días por tile
const ALTURAS_TTL_MS = 1000 * 60 * 60 * 24 * 30; // alturas oficiales: 1 mes
const TILE_SIZE_DEG = 0.012; // ~1.3km. Más fácil de cachear y reusar al panear.

interface TileEntry { ts: number; data: BuildingPoly[]; }
type TileCache = Record<string, TileEntry>;

const isMobile = typeof navigator !== 'undefined' && /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent);
const TILE_CONCURRENCY = isMobile ? 2 : 3;
const TILE_TIMEOUT_SEC = isMobile ? 14 : 22;

function readCache(): TileCache {
  try {
    const raw = localStorage.getItem(TILE_CACHE_KEY);
    if (!raw) return {};
    return JSON.parse(raw) as TileCache;
  } catch { return {}; }
}

function writeCache(cache: TileCache) {
  try {
    // Limpia entradas viejas para no inflar el storage.
    const now = Date.now();
    for (const k of Object.keys(cache)) {
      if (now - cache[k].ts > TILE_TTL_MS) delete cache[k];
    }
    localStorage.setItem(TILE_CACHE_KEY, JSON.stringify(cache));
  } catch { /* quota: ignorar */ }
}

function parseHeight(tags: Record<string, string> | undefined): number {
  if (!tags) return DEFAULT_HEIGHT_M;
  if (tags.height) {
    const n = parseFloat(tags.height);
    if (Number.isFinite(n) && n > 0) return n;
  }
  if (tags['building:levels']) {
    const lv = parseFloat(tags['building:levels']);
    if (Number.isFinite(lv) && lv > 0) return lv * LEVEL_HEIGHT_M;
  }
  return DEFAULT_HEIGHT_M;
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

function parseElements(json: any): BuildingPoly[] {
  const out: BuildingPoly[] = [];
  for (const el of json.elements ?? []) {
    if (el.type !== 'way' || !el.geometry) continue;
    const ring = el.geometry.map((p: any) => [p.lon, p.lat]) as [number, number][];
    if (ring.length < 3) continue;
    out.push({ ring, height: parseHeight(el.tags) });
  }
  return out;
}

async function postOverpass(endpoint: string, bbox: [number, number, number, number]) {
  const [s, w, n, e] = bbox;
  const q = `[out:json][timeout:${TILE_TIMEOUT_SEC}];(way["building"](${s},${w},${n},${e}););out body geom;`;
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), (TILE_TIMEOUT_SEC + 4) * 1000);
  try {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'data=' + encodeURIComponent(q),
      signal: controller.signal
    });
    if (!res.ok) throw new Error(`Overpass ${res.status}`);
    return res.json();
  } finally {
    window.clearTimeout(timer);
  }
}

async function fetchTile(bbox: [number, number, number, number]) {
  let lastError: unknown = null;
  for (const endpoint of ENDPOINTS) {
    try {
      const json = await postOverpass(endpoint, bbox);
      return parseElements(json);
    } catch (err) {
      lastError = err;
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }
  console.warn('[solmad] Tile de edificios omitido:', lastError);
  return [];
}

interface FetchOptions {
  onProgress?: (done: number, total: number) => void;
  onPartial?: (buildings: BuildingPoly[]) => void;
  signal?: { cancelled: boolean };
}

/**
 * Descarga edificios por tiles ~1.3km. Cada tile se cachea por 3 días en localStorage,
 * así que paneo y zoom son casi gratis. Llama onProgress por tile completado y
 * onPartial con el set acumulado para que la UI pueda refinar sombras de inmediato.
 *
 * bbox = [south, west, north, east]
 */
export async function fetchBuildings(
  bbox: [number, number, number, number],
  opts: FetchOptions = {}
): Promise<BuildingPoly[]> {
  const cache = readCache();
  const tiles = bboxToTiles(bbox);
  if (tiles.length === 0) return [];

  // Centro para priorizar primero los tiles más cercanos: los del bar/usuario.
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
    // Emite cada tile: la estimacion de fachada debe estar disponible cuanto antes.
    opts.onPartial?.(acc);
  });

  if (cacheDirty) writeCache(cache);
  return acc;
}

// ---- Alturas oficiales del Ayto. de Madrid (CC BY 4.0) ----
// Un edificio OSM se enriquece con su altura real si cae cerca de un polígono
// oficial. Sin matching, conserva la altura de OSM. Fallback silencioso.

const ENRICH_RADIUS_M = 35; // radio de matching entre centroide OSM y polígono oficial

interface AlturaEntry { lat: number; lng: number; height: number; }

function readAlturasCache(): Record<string, { ts: number; data: AlturaEntry[] }> {
  try {
    const raw = localStorage.getItem(ALTURAS_CACHE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch { return {}; }
}

function writeAlturasCache(cache: Record<string, { ts: number; data: AlturaEntry[] }>) {
  try {
    const now = Date.now();
    for (const k of Object.keys(cache)) if (now - cache[k].ts > ALTURAS_TTL_MS) delete cache[k];
    localStorage.setItem(ALTURAS_CACHE_KEY, JSON.stringify(cache));
  } catch { /* quota */ }
}

function polygonCentroid(ring: [number, number][]): [number, number] {
  // WGS84 lng/lat → punto medio simple (suficiente para matching a 35m).
  let sx = 0, sy = 0;
  for (const [lng, lat] of ring) { sx += lng; sy += lat; }
  return [sy / ring.length, sx / ring.length]; // [lat, lng]
}

function haversineM(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const R = 6371000;
  const dLat = (bLat - aLat) * Math.PI / 180;
  const dLng = (bLng - aLng) * Math.PI / 180;
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(aLat * Math.PI / 180) * Math.cos(bLat * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
}

/** Query al ArcGIS de alturas por bbox (el servicio acepta WGS84 directamente). */
async function fetchAlturasForClock(bboxWgs84: [number, number, number, number]): Promise<AlturaEntry[]> {
  const [s, w, n, e] = bboxWgs84;
  // El servicio de alturas acepta el bbox en EPSG:4326 (WGS84) sin conversión.
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
    resultRecordCount: '8000',
  });
  try {
    const res = await fetch(`${SIGMA_ALTURAS_URL}?${params.toString()}`);
    if (!res.ok) return [];
    const json = await res.json();
    const features: any[] = json.features ?? [];
    const out: AlturaEntry[] = [];
    for (const f of features) {
      const attrs = f?.attributes ?? {};
      const poly = f?.geometry?.rings?.[0];
      if (!poly) continue;
      let height = Number(attrs.ALTURA);
      if (!Number.isFinite(height) || height <= 0) {
        height = Number(attrs.Z_EDIFICIO_CAMBIO_ALTURA) - Number(attrs.Z_EDIFICIO_HUELLA);
      }
      if (!Number.isFinite(height) || height <= 0) continue;
      // rings → [[lng,lat]...]
      const ring: [number, number][] = poly.map((p: [number, number]) => [p[0], p[1]]);
      const [lat, lng] = polygonCentroid(ring);
      out.push({ lat, lng, height });
    }
    return out;
  } catch { return []; }
}

/**
 * Enriquece edificios con alturas oficiales del Ayto. (CC BY 4.0).
 * Indempotente y con fallback: si el servicio falla, mantiene la altura OSM.
 */
export async function enrichBuildingsAlturas(buildings: BuildingPoly[], bboxWgs84: [number, number, number, number]) {
  if (buildings.length === 0) return buildings;
  try {
    const cache = readAlturasCache();
    const key = bboxWgs84.map((n) => n.toFixed(4)).join('|');
    let entries: AlturaEntry[] | null = null;
    const cached = cache[key];
    if (cached && Date.now() - cached.ts <= ALTURAS_TTL_MS) entries = cached.data;
    if (!entries) {
      entries = await fetchAlturasForClock(bboxWgs84);
      cache[key] = { ts: Date.now(), data: entries };
      writeAlturasCache(cache);
    }
    // Matchear cada OSM con el edificio oficial más cercano.

    return buildings.map((b) => {
      const [lat, lng] = polygonCentroid(b.ring);
      let best: AlturaEntry | null = null, bestD = ENRICH_RADIUS_M;
      for (const e of entries) {
        const d = haversineM(lat, lng, e.lat, e.lng);
        if (d < bestD) { best = e; bestD = d; }
      }
      return best ? { ...b, height: best.height } : b;
    });
  } catch { return buildings; }
}

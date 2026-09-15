#!/usr/bin/env node
// Construye el tileset ESTATICO de edificios de Madrid a partir de los chunks
// crudos del Ayto. (scratch/bldgs/) -> public/buildings/*.bin + manifest.json
//
// Formato binario SMBD v1 (little endian):
//   u32 magic 'SMBD' | u8 version | u8 flags | u16 reservado
//   f64 originLng | f64 originLat        (esquina SW del tile)
//   u32 nBuildings
//   por edificio: u8 altura_m | u8 nPts | nPts x (u16 x_dm, u16 y_dm)
//     x_dm/y_dm = decimetros relativos al origen del tile (0..65535 -> hasta 6,5 km)
//
// Los edificios se asignan al tile de su CENTROIDE pero se guardan COMPLETOS:
// asi un edificio a caballo entre dos tiles no queda cortado.
//
// Uso: node scripts/build-buildings-tiles.mjs
import { readdirSync, readFileSync, writeFileSync, mkdirSync, statSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const SRC_DIR = resolve(ROOT, 'scratch', 'bldgs');
const OUT_DIR = resolve(ROOT, 'public', 'buildings');
const TILE_SIZE_DEG = 0.012; // misma rejilla que usaba la app (~1,3 km)
const SIMPLIFY_TOL_M = 1.2;  // tolerancia Douglas-Peucker (sombra: 1 m sobra)
const MIN_AREA_M2 = 4;       // descarta ruido (casetas, restos)
const MIN_HEIGHT_M = 2;
const MAX_HEIGHT_M = 255;
const M_LAT = 111320;

const mLngAt = (lat) => M_LAT * Math.cos((lat * Math.PI) / 180);

// ---- Douglas-Peucker en metros ----
function rdp(pts, tol) {
  if (pts.length <= 4) return pts.slice();
  const keep = new Uint8Array(pts.length);
  keep[0] = 1; keep[pts.length - 1] = 1;
  const stack = [[0, pts.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop();
    if (b - a < 2) continue;
    const ax = pts[a][0], ay = pts[a][1], bx = pts[b][0], by = pts[b][1];
    const dx = bx - ax, dy = by - ay;
    const len = Math.hypot(dx, dy) || 1e-9;
    let best = -1, bestD = tol;
    for (let i = a + 1; i < b; i++) {
      const d = Math.abs((pts[i][0] - ax) * dy - (pts[i][1] - ay) * dx) / len;
      if (d > bestD) { bestD = d; best = i; }
    }
    if (best > 0) { keep[best] = 1; stack.push([a, best], [best, b]); }
  }
  const out = [];
  for (let i = 0; i < pts.length; i++) if (keep[i]) out.push(pts[i]);
  return out;
}

function ringAreaM2(pts, lat) {
  // shoelace en grados y luego escalado a m² (grados² * m/°lng * m/°lat)
  let s = 0;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    s += pts[j][0] * pts[i][1] - pts[i][0] * pts[j][1];
  }
  return Math.abs(s / 2) * mLngAt(lat) * M_LAT;
}

// ---- 1) lectura y limpieza ----
const files = readdirSync(SRC_DIR).filter((f) => f.startsWith('chunk-')).sort();
if (!files.length) { console.error('Sin chunks en ' + SRC_DIR); process.exit(1); }
console.log(`[tiles] leyendo ${files.length} chunks...`);

const tiles = new Map(); // "row_col" -> { row, col, buildings: [] }
let nRaw = 0, nOk = 0, nSmall = 0, nSinAltura = 0, ptsTotal = 0;

function heightOf(attrs) {
  let h = Number(attrs.ALTURA);
  if (!Number.isFinite(h) || h <= 0) {
    const a = Number(attrs.Z_EDIFICIO_CAMBIO_ALTURA);
    const b = Number(attrs.Z_EDIFICIO_HUELLA);
    if (Number.isFinite(a) && Number.isFinite(b)) h = a - b;
  }
  return h;
}

for (const f of files) {
  const feats = JSON.parse(readFileSync(resolve(SRC_DIR, f), 'utf8'));
  for (const feat of feats) {
    nRaw++;
    const ring = feat?.geometry?.rings?.[0];
    if (!ring || ring.length < 4) continue;
    const attrs = feat.attributes ?? {};
    let h = heightOf(attrs);
    if (!Number.isFinite(h) || h < MIN_HEIGHT_M) { nSinAltura++; h = 12; } // fallback conservador
    h = Math.min(MAX_HEIGHT_M, Math.max(MIN_HEIGHT_M, h));

    // centroide (media) para asignar tile y latitud de trabajo
    let sx = 0, sy = 0;
    for (const p of ring) { sx += p[0]; sy += p[1]; }
    const clng = sx / ring.length, clat = sy / ring.length;

    const area = ringAreaM2(ring, clat);
    if (area < MIN_AREA_M2) { nSmall++; continue; }

    const kx = mLngAt(clat);
    let local = ring.map((p) => [(p[0] - clng) * kx, (p[1] - clat) * M_LAT]);
    // El anillo viene cerrado (primer punto == último). Douglas-Peucker necesita
    // el anillo ABIERTO: con el punto repetido el segmento inicial mide 0 y el
    // algoritmo colapsa la figura a 2 puntos.
    if (local.length > 1) {
      const f0 = local[0], l0 = local[local.length - 1];
      if (Math.abs(f0[0] - l0[0]) < 1e-9 && Math.abs(f0[1] - l0[1]) < 1e-9) local.pop();
    }
    let simp = rdp(local, SIMPLIFY_TOL_M);
    if (simp.length > 24) simp = rdp(local, SIMPLIFY_TOL_M * 3);
    if (simp.length < 3) continue;
    simp.push(simp[0]); // vuelve a cerrar el anillo para el raycast

    const row = Math.floor(clat / TILE_SIZE_DEG);
    const col = Math.floor(clng / TILE_SIZE_DEG);
    const key = `${row}_${col}`;
    let tile = tiles.get(key);
    if (!tile) { tile = { row, col, buildings: [] }; tiles.set(key, tile); }
    tile.buildings.push({ h: Math.round(h), pts: simp, lng: clng, lat: clat });
    nOk++; ptsTotal += simp.length;
  }
}
console.log(`[tiles] crudos=${nRaw} validos=${nOk} pequenos=${nSmall} sin_altura=${nSinAltura} pts_medios=${(ptsTotal / Math.max(nOk, 1)).toFixed(1)} tiles=${tiles.size}`);

// ---- 2) empaquetado binario ----
mkdirSync(OUT_DIR, { recursive: true });
const manifest = { version: 1, format: 'SMBD', tileSizeDeg: TILE_SIZE_DEG, generatedAt: new Date().toISOString(), tiles: {} };
let bytesTotal = 0, buildTotal = 0;

for (const [key, tile] of tiles) {
  const originLng = tile.col * TILE_SIZE_DEG;
  const originLat = tile.row * TILE_SIZE_DEG;
  const kx = mLngAt(originLat + TILE_SIZE_DEG / 2);
  const bufs = [];
  for (const b of tile.buildings) {
    const n = b.pts.length;
    const buf = Buffer.alloc(2 + n * 4);
    buf.writeUInt8(b.h, 0);
    buf.writeUInt8(n, 1);
    let off = 2;
    for (const [lx, ly] of b.pts) {
      // local (m) -> WGS84 -> decimetros relativos al origen del tile
      const lng = b.lng + lx / kx;
      const lat = b.lat + ly / M_LAT;
      const x = Math.round(((lng - originLng) * kx) * 10);
      const y = Math.round(((lat - originLat) * M_LAT) * 10);
      buf.writeUInt16LE(Math.max(0, Math.min(65535, x)), off);
      buf.writeUInt16LE(Math.max(0, Math.min(65535, y)), off + 2);
      off += 4;
    }
    bufs.push(buf);
  }
  const header = Buffer.alloc(4 + 1 + 1 + 2 + 8 + 8 + 4);
  header.write('SMBD', 0, 'ascii');
  header.writeUInt8(1, 4);
  header.writeUInt8(0, 5);
  header.writeUInt16LE(0, 6);
  header.writeDoubleLE(originLng, 8);
  header.writeDoubleLE(originLat, 16);
  header.writeUInt32LE(bufs.length, 24);
  const body = Buffer.concat([header, ...bufs]);
  writeFileSync(resolve(OUT_DIR, `${key}.bin`), body);
  manifest.tiles[key] = { n: bufs.length, bytes: body.length };
  bytesTotal += body.length;
  buildTotal += bufs.length;
}
writeFileSync(resolve(OUT_DIR, 'manifest.json'), JSON.stringify(manifest));
console.log(`[tiles] ${tiles.size} tiles, ${buildTotal} edificios, ${(bytesTotal / 1048576).toFixed(1)} MB (${(bytesTotal / buildTotal).toFixed(1)} B/edificio) -> ${OUT_DIR}`);

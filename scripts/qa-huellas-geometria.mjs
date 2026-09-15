// Diagnostico geometrico fino: para una muestra de terrazas del centro, mide la
// distancia FIRMADA de cada punto de la huella (4 esquinas + 4 muestras) al
// edificio mas cercano. Negativo = dentro del edificio (mal), positivo = en la calle.
import { readFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { readTile } from './lib/tiles.mjs';

const ROOT = resolve(import.meta.dirname, '..');
const PUB = resolve(ROOT, 'public');
const TILES = resolve(PUB, 'buildings');
const TILE = 0.012;
const M_LAT = 111320;
const kx = M_LAT * Math.cos((40.4168 * Math.PI) / 180);

const terrazas = JSON.parse(readFileSync(resolve(PUB, 'terrazas.min.json'), 'utf8'));
const huellas = JSON.parse(readFileSync(resolve(PUB, 'terrazas-huellas.json'), 'utf8'));
const byId = new Map(terrazas.map((t) => [t.id, t]));

const cache = new Map();
function bldsAround(lat, lng) {
  const row = Math.floor(lat / TILE), col = Math.floor(lng / TILE);
  const acc = [];
  for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
    const k = `${row + dr}_${col + dc}`;
    if (!cache.has(k)) {
      try { cache.set(k, readTile(join(TILES, k + '.bin'))); } catch { cache.set(k, []); }
    }
    acc.push(...cache.get(k));
  }
  return acc;
}

function distSegM(px, py, ax, ay, bx, by) {
  const vx = bx - ax, vy = by - ay, l2 = vx * vx + vy * vy;
  const t = l2 <= 1e-12 ? 0 : Math.max(0, Math.min(1, ((px - ax) * vx + (py - ay) * vy) / l2));
  return Math.hypot(px - (ax + vx * t), py - (ay + vy * t));
}
function inside(lng, lat, ring) {
  let ins = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0], yi = ring[i][1], xj = ring[j][0], yj = ring[j][1];
    if ((yi > lat) !== (yj > lat) && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) ins = !ins;
  }
  return ins;
}

/** distancia firmada en metros: >0 fuera (a la calle), <0 dentro */
function signedDist(lng, lat, blds) {
  const x = lng * kx, y = lat * M_LAT;
  let best = Infinity, dentro = false;
  for (const b of blds) {
    if (inside(lng, lat, b.ring)) dentro = true;
    const r = b.ring;
    for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
      const d = distSegM(x, y, r[j][0] * kx, r[j][1] * M_LAT, r[i][0] * kx, r[i][1] * M_LAT);
      if (d < best) best = d;
    }
  }
  return dentro ? -best : best;
}

const ids = Object.keys(huellas).map(Number).filter((id) => byId.has(id));
// muestra: 40 terrazas repartidas del centro
const muestra = [];
for (let i = 0; i < 40; i++) muestra.push(ids[Math.floor((i * ids.length) / 40)]);

let negativas = 0, total = 0;
const histograma = { '<0': 0, '0-0.5': 0, '0.5-1.5': 0, '1.5-3': 0, '3-6': 0, '>6': 0 };
for (const id of muestra) {
  const h = huellas[id];
  const blds = bldsAround(h.samples[0][1], h.samples[0][0]);
  if (!blds.length) continue;
  const puntos = [...h.ring, ...h.samples];
  for (const [lng, lat] of puntos) {
    const d = signedDist(lng, lat, blds);
    total++;
    if (d < 0) negativas++;
    if (d < 0) histograma['<0']++;
    else if (d < 0.5) histograma['0-0.5']++;
    else if (d < 1.5) histograma['0.5-1.5']++;
    else if (d < 3) histograma['1.5-3']++;
    else if (d < 6) histograma['3-6']++;
    else histograma['>6']++;
  }
}
console.log(`puntos medidos: ${total} (${muestra.length} terrazas)`);
console.log(`DENTRO de un edificio: ${negativas} (${(100 * negativas / Math.max(total, 1)).toFixed(1)}%)`);
console.log('histograma de distancia a la fachada mas cercana (m):', JSON.stringify(histograma));

// casos concretos con detalle
for (const id of [37, 1067, 42]) {
  const h = huellas[id];
  if (!h) continue;
  const t = byId.get(id);
  const blds = bldsAround(h.samples[0][1], h.samples[0][0]);
  const ds = [...h.ring, ...h.samples].map(([lng, lat]) => signedDist(lng, lat, blds).toFixed(2));
  console.log(`id ${id} (${(t?.via || '')} / ${t?.ubicacion || ''}): puntos a la calle = [${ds.join(', ')}] m`);
}

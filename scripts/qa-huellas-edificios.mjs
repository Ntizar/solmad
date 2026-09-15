#!/usr/bin/env node
// QA de calidad: ¿cuántas muestras de huella de terraza caen DENTRO de un edificio?
//
// Si una terraza tiene sus 4 muestras dentro de un edificio, el motor la marcará
// en sombra permanentemente (el edificio la tapa desde todos los ángulos). Es un
// síntoma de huella mal colocada (offset de acera insuficiente o eje de vía raro).
//
// Uso: node scratch/qa-huellas-edificios.mjs
import { readFileSync, readdirSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { readTile } from './lib/tiles.mjs';

const ROOT = resolve(import.meta.dirname, '..');
const PUB = resolve(ROOT, 'public');
const TILES = resolve(PUB, 'buildings');
const TILE = 0.012;

const terrazas = JSON.parse(readFileSync(resolve(PUB, 'terrazas.min.json'), 'utf8'));
const huellas = JSON.parse(readFileSync(resolve(PUB, 'terrazas-huellas.json'), 'utf8'));
const matrix = (() => {
  const b = readFileSync(resolve(PUB, 'solar-matrix.bin'));
  const n = b.readUInt32LE(8), slots = b.readUInt16LE(6);
  const ids = new Map();
  for (let i = 0; i < n; i++) ids.set(b.readUInt32LE(16 + i * 4), i);
  const off = 16 + n * 4;
  return { ids, off, slots, per: slots / 4, buf: b };
})();

const cacheTiles = new Map();
function buildingsAround(lat, lng) {
  const row = Math.floor(lat / TILE), col = Math.floor(lng / TILE);
  const out = [];
  for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
    const key = `${row + dr}_${col + dc}`;
    if (!cacheTiles.has(key)) {
      try { cacheTiles.set(key, readTile(join(TILES, key + '.bin'))); } catch { cacheTiles.set(key, []); }
    }
    out.push(...cacheTiles.get(key));
  }
  return out;
}

function pointInRing(x, y, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0], yi = ring[i][1], xj = ring[j][0], yj = ring[j][1];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

let total = 0, algunaDentro = 0, todasDentro = 0, sinHuella = 0;
const ejemplos = [];
for (const t of terrazas) {
  const h = huellas[t.id];
  if (!h?.samples?.length) { sinHuella++; continue; }
  const blds = buildingsAround(t.lat, t.lng);
  let dentro = 0;
  for (const [lng, lat] of h.samples) {
    if (blds.some((b) => pointInRing(lng, lat, b.ring))) dentro++;
  }
  total++;
  if (dentro > 0) algunaDentro++;
  if (dentro === h.samples.length) {
    todasDentro++;
    if (ejemplos.length < 6) {
      const idx = matrix.ids.get(t.id);
      let sol = 0;
      if (idx !== undefined) {
        for (let s = 0; s < matrix.slots; s++) {
          const byte = matrix.buf[matrix.off + idx * matrix.per + (s >> 2)];
          if (((byte >> ((s & 3) * 2)) & 3) === 1) sol++;
        }
      }
      ejemplos.push({ id: t.id, nombre: t.name, via: t.via, ubicacion: t.ubicacion, distrito: t.distrito, franjasSol: sol });
    }
  }
}

console.log(`terrazas con huella: ${total} (sin huella: ${sinHuella})`);
console.log(`con ALGUNA muestra dentro de edificio: ${algunaDentro} (${(100 * algunaDentro / total).toFixed(1)}%)`);
console.log(`con TODAS las muestras dentro: ${todasDentro} (${(100 * todasDentro / total).toFixed(1)}%)`);
console.log('ejemplos con todas dentro (nunca tendrian sol):');
for (const e of ejemplos) console.log('  ', JSON.stringify(e));

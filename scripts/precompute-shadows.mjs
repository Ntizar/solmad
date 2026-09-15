#!/usr/bin/env node
// PRECOMPUTE de la matriz solar: estado sol/sombra/noche de CADA terraza en cada
// franja de 30 min del dia -> public/solar-matrix.bin
//
// Esto es lo que hace que el mapa se pinte AL INSTANTE: el cliente ya no necesita
// raycasting ni edificios para colorear las 6.200 terrazas; solo lee 12 bytes por
// terraza. El calculo pesado se hace aqui, una vez, automaticamente (cron diario).
//
// Reanudable por zonas (tile de 0,012°) y con presupuesto de tiempo:
//   node scripts/precompute-shadows.mjs [--budget 300] [--threads 6] [--force]
//
// Salida:
//   public/solar-matrix.bin       (magic SMSH, ids + estados 2 bits)
//   public/solar-matrix.meta.json (fecha, slots, estadisticas)
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Worker } from 'node:worker_threads';
import os from 'node:os';

process.env.TZ = 'Europe/Madrid';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const PUB = resolve(ROOT, 'public');
const TILES_DIR = resolve(PUB, 'buildings');
const SLOT_COUNT = 48;      // 48 franjas de 30 min
const STEP_MIN = 30;
const TILE_SIZE_DEG = 0.012;
// limites del municipio (fuera de aqui no hay edificios: estado 3 = pendiente)
const BBOX = [40.30, -3.855, 40.56, -3.515];

const args = process.argv.slice(2);
const argVal = (name, def) => {
  const i = args.indexOf('--' + name);
  return i >= 0 && args[i + 1] ? Number(args[i + 1]) : def;
};
const BUDGET_S = argVal('budget', 320);
const THREADS = Math.max(1, Math.min(argVal('threads', Math.max(1, os.cpus().length - 1)), 12));
const FORCE = args.includes('--force');

const ymd = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Madrid', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
// Cache de zonas POR DIA: si cambia el dia, los estados cacheados ya no valen.
const ZONES_DIR = resolve(ROOT, 'scratch', 'shadows', ymd);

// ---- datos ----
const terrazas = JSON.parse(readFileSync(resolve(PUB, 'terrazas.min.json'), 'utf8'));
const huellas = JSON.parse(readFileSync(resolve(PUB, 'terrazas-huellas.json'), 'utf8'));

// solo terrazas con coordenadas validas dentro del municipio
const validas = terrazas.filter((t) => Number.isFinite(t.lat) && Number.isFinite(t.lng)
  && t.lat >= BBOX[0] && t.lat <= BBOX[2] && t.lng >= BBOX[1] && t.lng <= BBOX[3]);
const descartadas = terrazas.length - validas.length;

// ---- zonas (tile de 0,012° de la propia terraza) ----
const zonas = new Map();
for (const t of validas) {
  const key = `${Math.floor(t.lat / TILE_SIZE_DEG)}_${Math.floor(t.lng / TILE_SIZE_DEG)}`;
  if (!zonas.has(key)) zonas.set(key, []);
  zonas.get(key).push({ id: t.id, lat: t.lat, lng: t.lng });
}
mk_dir();
function mk_dir() { mkdirSync(ZONES_DIR, { recursive: true }); }

const pendientes = [...zonas.keys()].filter((k) => FORCE || !existsSync(join(ZONES_DIR, k + '.bin')));
const totalZonas = zonas.size;
console.log(`[matriz] terrazas=${terrazas.length} validas=${validas.length} descartadas=${descartadas}`);
console.log(`[matriz] zonas=${totalZonas} pendientes=${pendientes.length} hilos=${THREADS} dia=${ymd}`);

const t0 = Date.now();
const cola = [...pendientes];
let hechas = 0;
const errores = [];

function lanzar() {
  return new Promise((res) => {
    const key = cola.shift();
    if (!key) return res(null);
    const terraces = zonas.get(key);
    const w = new Worker(resolve(__dirname, 'lib', 'shadow-runner.mjs'), {
      workerData: { tilesDir: TILES_DIR, zoneKey: key, terraces, huellas, ymd, slotCount: SLOT_COUNT, stepMin: STEP_MIN }
    });
    w.on('message', (msg) => {
      const buf = Buffer.from(msg.states.buffer, msg.states.byteOffset, msg.states.byteLength);
      const idsBuf = Buffer.from(msg.ids.buffer, msg.ids.byteOffset, msg.ids.byteLength);
      writeFileSync(join(ZONES_DIR, key + '.bin'), Buffer.concat([idsBuf, buf]));
      hechas++;
      if (hechas % 10 === 0 || hechas === pendientes.length) {
        const mins = ((Date.now() - t0) / 60000).toFixed(1);
        console.log(`[matriz] ${hechas}/${pendientes.length} zonas en ${mins} min (${key}, ${msg.buildings} edificios)`);
      }
      res(key);
    });
    w.on('error', (err) => { errores.push([key, String(err).slice(0, 200)]); res(key); });
    w.on('exit', (code) => { if (code !== 0 && !errores.find((e) => e[0] === key)) { errores.push([key, 'exit ' + code]); res(key); } });
  });
}

async function correrHilos() {
  const activos = [];
  for (let i = 0; i < THREADS; i++) activos.push(lanzar());
  await Promise.all(activos);
}

while (cola.length && (Date.now() - t0) / 1000 < BUDGET_S) {
  await correrHilos();
}
if (errores.length) console.log(`[matriz] errores=${errores.length} ej=${JSON.stringify(errores.slice(0, 3))}`);

const restantes = [...zonas.keys()].filter((k) => !existsSync(join(ZONES_DIR, k + '.bin')));
if (restantes.length) {
  console.log(`[matriz] PARCIAL: faltan ${restantes.length} zonas de ${totalZonas}. Relanza para continuar.`);
  process.exit(3);
}

// ---- ensamblado final ----
const porId = new Set(validas.map((t) => t.id));
const idsOrdenados = validas.map((t) => t.id).sort((a, b) => a - b);
const estados = Buffer.alloc(idsOrdenados.length * (SLOT_COUNT / 4)); // 4 estados/byte
const idxPorId = new Map(idsOrdenados.map((id, i) => [id, i]));
let conDatos = 0;

for (const key of zonas.keys()) {
  const raw = readFileSync(join(ZONES_DIR, key + '.bin'));
  const n = raw.length / (4 + SLOT_COUNT);
  if (!Number.isInteger(n)) { console.error('[matriz] zona corrupta: ' + key); continue; }
  for (let i = 0; i < n; i++) {
    const id = raw.readInt32LE(i * 4);
    const dst = idxPorId.get(id);
    if (dst === undefined) continue;
    for (let s = 0; s < SLOT_COUNT; s++) {
      const v = raw[4 * n + i * SLOT_COUNT + s] & 3;
      const byte = dst * (SLOT_COUNT / 4) + (s >> 2);
      estados[byte] = (estados[byte] & ~(3 << ((s & 3) * 2))) | (v << ((s & 3) * 2));
    }
    conDatos++;
  }
}

const header = Buffer.alloc(16);
header.write('SMSH', 0, 'ascii');
header.writeUInt8(1, 4);            // version
header.writeUInt8(STEP_MIN, 5);     // minutos por franja
header.writeUInt16LE(SLOT_COUNT, 6);
header.writeUInt32LE(idsOrdenados.length, 8);
header.writeUInt32LE(Number(ymd.replace(/-/g, '')), 12); // fecha AAAAMMDD de la matriz
const idsBuf = Buffer.alloc(idsOrdenados.length * 4);
idsOrdenados.forEach((id, i) => idsBuf.writeUInt32LE(id, i * 4));
const out = Buffer.concat([header, idsBuf, estados]);
writeFileSync(resolve(PUB, 'solar-matrix.bin'), out);

// estadisticas + meta
const hist = [0, 0, 0, 0];
for (const b of estados) for (let k = 0; k < 4; k++) hist[(b >> (k * 2)) & 3]++;
const totalSlots = idsOrdenados.length * SLOT_COUNT;
writeFileSync(resolve(PUB, 'solar-matrix.meta.json'), JSON.stringify({
  version: 1, date: ymd, generatedAt: new Date().toISOString(), stepMinutes: STEP_MIN, slotCount: SLOT_COUNT,
  terraces: idsOrdenados.length, discarded: descartadas,
  tz: 'Europe/Madrid',
  stats: {
    shadePct: +(100 * hist[0] / totalSlots).toFixed(1),
    sunPct: +(100 * hist[1] / totalSlots).toFixed(1),
    nightPct: +(100 * hist[2] / totalSlots).toFixed(1),
    pendingPct: +(100 * hist[3] / totalSlots).toFixed(1)
  },
  buildingsTiles: readdirSync(TILES_DIR).filter((f) => f.endsWith('.bin')).length
}, null, 2));
console.log(`[matriz] OK ${idsOrdenados.length} terrazas x ${SLOT_COUNT} franjas = ${(out.length / 1024).toFixed(1)} KB -> public/solar-matrix.bin`);
console.log(`[matriz] reparto: sombra ${(100 * hist[0] / totalSlots).toFixed(1)}% · sol ${(100 * hist[1] / totalSlots).toFixed(1)}% · noche ${(100 * hist[2] / totalSlots).toFixed(1)}% · pendiente ${(100 * hist[3] / totalSlots).toFixed(1)}%`);
console.log(`[matriz] con datos=${conDatos}`);

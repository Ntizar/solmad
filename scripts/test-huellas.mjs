// Test de humo del motor v2 (huellas). Compila el worker con esbuild y lo
// ejecuta en Node con un edificio sintetico:
//   - Bloque de 20x10 m, 20 m de alto, centrado en (0,0) local.
//   - Sol del este (az=90) con alt=30 -> sombra hacia el oeste, largo ~34.6 m.
//   - Huella A: 10 m al ESTE del bloque -> sol.
//   - Huella B: 10 m al OESTE del bloque -> sombra.
import { build, context } from 'esbuild';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

const OUT = resolve(import.meta.dirname ?? '.', 'shadows.test-bundle.mjs');
await build({
  entryPoints: [resolve(import.meta.dirname ?? '.', '..', 'src', 'workers', 'shadows.worker.ts')],
  bundle: true,
  format: 'esm',
  outfile: OUT,
  platform: 'browser',
  absWorkingDir: resolve(import.meta.dirname ?? '.', '..'),
  alias: { comlink: resolve(import.meta.dirname ?? '.', 'comlink-shim.mjs') },
});

// Comlink.expose en Node: el modulo expone api directamente si lo interceptamos.
// En Node no hay MessagePort: proveemos un shim antes de importar el bundle.
if (typeof globalThis.addEventListener !== 'function') {
  globalThis.addEventListener = () => {};
  globalThis.removeEventListener = () => {};
  globalThis.postMessage = () => {};
}
const mod = await import(pathToFileURL(OUT).href);
const api = globalThis.__solmadTestAPI;
if (!api || typeof api.setBuildings !== 'function') {
  console.error('FALLO: el shim de comlink no capturo el api del worker. exports:', Object.keys(mod));
  process.exit(1);
}

const M_LAT = 111320;
const M_LNG = 83000; // aprox Madrid
const ORIGIN = { lat: 40.4168, lng: -3.7038 };
const toLL = (x, y) => [ORIGIN.lng + x / M_LNG, ORIGIN.lat + y / M_LAT];

// Edificio: anillo cuadrado 20x10 m centrado en origen, 20 m alto
const ringLL = [[-10, -5], [10, -5], [10, 5], [-10, 5], [-10, -5]].map(([x, y]) => toLL(x, y));
await api.setBuildings([{ ring: ringLL, height: 20 }], ORIGIN.lng, ORIGIN.lat);

// Huellas: A al este (x=+20), B al oeste (x=-20). Cuadrados de 4x4 m.
function huellaEn(x) {
  const r = [[x - 2, -2], [x + 2, -2], [x + 2, 2], [x - 2, 2]].map(([mx, my]) => toLL(mx, my));
  const s = [[x - 1, -1], [x - 1, 1], [x + 1, -1], [x + 1, 1]].map(([mx, my]) => toLL(mx, my));
  return { ring: r, samples: s };
}
await api.setHuellas({ 1: huellaEn(20), 2: huellaEn(-20) });

const terrazas = [
  { id: 1, lat: ORIGIN.lat, lng: toLL(20, 0)[0] },
  { id: 2, lat: ORIGIN.lat, lng: toLL(-20, 0)[0] },
];

// 21 de junio 2026, 09:00 UTC = 11:00 Madrid: sol al SE-E, alt media-alta
const when = '2026-06-21T07:30:00.000Z'; // 09:30 Madrid, sol del este
const quick = api.quickForHuellas(terrazas, when);
console.log('quickForHuellas (1=este, 2=oeste):', Array.from(quick));
// sol de manana (este): la terraza ESTE (1) debe tener sol (1), la OESTE (2) sombra (0)
const [q1, q2] = quick;
let ok = true;
if (q1 !== 1) { console.error('FALLO: terraza este deberia tener sol, obtuvo', q1); ok = false; }
if (q2 !== 0) { console.error('FALLO: terraza oeste deberia estar en sombra, obtuvo', q2); ok = false; }

// SunState completo
const states = api.computeForHuellas(terrazas, when);
console.log('states:', JSON.stringify(states, null, 1).slice(0, 400));
if (states[0].sunNowPct === undefined && states[0].sunNowPct !== 0) {
  console.error('FALLO: sunNowPct ausente');
  ok = false;
}

console.log(ok ? 'TEST OK' : 'TEST FALLO');
process.exit(ok ? 0 : 1);

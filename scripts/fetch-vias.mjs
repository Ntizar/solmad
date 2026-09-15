#!/usr/bin/env node
// Descarga el viario de Madrid desde Overpass -> data/vias-madrid.json
//
// Lo necesita `npm run prepare:huellas` (huellas de terraza orientadas al eje de
// la via). Es un fichero grande (~41 MB) y por eso NO esta versionado: se
// regenera cuando haga falta.
//
// Uso:
//   node scripts/fetch-vias.mjs                       # municipio completo -> data/vias-madrid.json
//   node scripts/fetch-vias.mjs --bbox 40.41,-3.71,40.42,-3.70 --out scratch/prueba.json
//
// Salida: JSON de Overpass (elements[] con geometry[{lat,lon}]), tal cual lo
// espera prepare-huellas.mjs.
import { writeFileSync, mkdirSync, renameSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const argVal = (n, def) => { const i = args.indexOf('--' + n); return i >= 0 && args[i + 1] ? args[i + 1] : def; };

// bbox WGS84 w,s,e,n -> municipio de Madrid con margen
const BBOX_DEF = '-3.8500,40.3000,-3.5200,40.5600';
const bboxWsen = argVal('bbox', BBOX_DEF);
const [w, s, e, n] = bboxWsen.split(',').map(Number);
if (![w, s, e, n].every(Number.isFinite)) { console.error('bbox invalido:', bboxWsen); process.exit(1); }
const OUT = resolve(ROOT, argVal('out', 'data/vias-madrid.json'));
const TIMEOUT = Number(argVal('timeout', 300));
// UA obligatorio: overpass-api.de responde 406 Not Acceptable sin el.
const UA = 'SolMAD/2.0 (+https://github.com/Ntizar/solmad)';
const ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass.osm.ch/api/interpreter'
];

// El orden de la bbox para Overpass es (s,w,n,e)
const query = `[out:json][timeout:${TIMEOUT}];(way["highway"](${s},${w},${n},${e}););out body geom;`;

console.log(`[vias] bbox=${bboxWsen} timeout=${TIMEOUT}s -> ${OUT}`);
let data = null;
for (const endpoint of ENDPOINTS) {
  // Overpass limita por IP: reintentamos con espera creciente antes de pasar al siguiente.
  for (let intento = 1; intento <= 3; intento++) {
    const t0 = Date.now();
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), (TIMEOUT + 30) * 1000);
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'User-Agent': UA,
          Accept: 'application/json'
        },
        body: 'data=' + encodeURIComponent(query),
        signal: ctrl.signal
      });
      clearTimeout(timer);
      if (res.status === 429) throw new Error('HTTP 429 (rate limit)');
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const json = await res.json();
      const n = json.elements?.length ?? 0;
      if (n > 0) {
        data = json;
        console.log(`[vias] ${endpoint} -> ${n} vias en ${((Date.now() - t0) / 1000).toFixed(0)}s`);
        break;
      }
      throw new Error('respuesta sin vias');
    } catch (err) {
      console.warn(`[vias] ${endpoint} intento ${intento}: ${String(err).slice(0, 90)}`);
      if (intento < 3) await new Promise((r) => setTimeout(r, 5000 * intento));
    }
  }
  if (data) break;
}
if (!data?.elements?.length) { console.error('[vias] sin datos, abortando (no se toca el fichero anterior)'); process.exit(1); }

const wayConGeom = data.elements.filter((el) => el.type === 'way' && el.geometry?.length);
if (!wayConGeom.length) { console.error('[vias] ninguna via con geometria, abortando'); process.exit(1); }

mkdirSync(dirname(OUT), { recursive: true });
// escritura atomica: no dejamos un fichero a medias si algo va mal
const tmp = OUT + '.tmp';
writeFileSync(tmp, JSON.stringify(data));
renameSync(tmp, OUT);
console.log(`[vias] ${wayConGeom.length} vias con geometria -> ${OUT} (${(JSON.stringify(data).length / 1048576).toFixed(1)} MB)${existsSync(OUT) ? '' : ' ⚠ no escrito'}`);

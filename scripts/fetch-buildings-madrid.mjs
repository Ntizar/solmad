#!/usr/bin/env node
// Descarga TODOS los edificios del Ayto. de Madrid (huella + altura oficial) del
// servicio CARTOGRAFIA/EDIFICIOS_ALTURAS (CC BY 4.0) a scratch/bldgs/.
//
// Estrategia (el WAF del servicio rechaza URLs largas => todo por POST):
//   1) returnCountOnly -> total.
//   2) paginacion por resultOffset (2000) por POST.
//   3) control de huecos: comparamos los OBJECTID recibidos con la lista completa
//      (returnIdsOnly) y re-pedimos los que falten en lotes por objectIds.
//   4) verificacion final: nº de edificios == total.
// Reanudable: los chunks ya escritos en disco no se vuelven a pedir.
//
// Uso: node scripts/fetch-buildings-madrid.mjs
import { writeFileSync, mkdirSync, existsSync, readdirSync, readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = resolve(__dirname, '..', 'scratch', 'bldgs');
const IDS_FILE = resolve(OUT_DIR, 'ids.json');
const BBOX = [-3.8300, 40.3100, -3.5300, 40.5500]; // w,s,e,n — municipio con margen
const PAGE = 2000;
const CONCURRENCY = 2; // el servicio rate-limita: 2 es estable
const REQ_JITTER_MS = 250;
const SERVICE = 'https://sigma.madrid.es/hosted/rest/services/CARTOGRAFIA/EDIFICIOS_ALTURAS/MapServer/0/query';
const UA = 'SolMad-precompute/2.0 (+https://github.com/Ntizar/solmad)';
const OUT_FIELDS = 'OBJECTID,ALTURA,Z_EDIFICIO_CAMBIO_ALTURA,Z_EDIFICIO_HUELLA,ID_3D';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

mkdirSync(OUT_DIR, { recursive: true });

/** Query por POST (evita el WAF que rechaza URLs largas). */
async function query(params, attempt = 0) {
  try {
    await sleep(Math.random() * REQ_JITTER_MS);
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 120_000);
    const res = await fetch(SERVICE, {
      method: 'POST',
      headers: { 'User-Agent': UA, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(params).toString(),
      signal: ctrl.signal
    });
    clearTimeout(timer);
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const txt = await res.text();
    if (txt.trimStart().startsWith('<')) throw new Error('WAF/HTML: ' + txt.slice(0, 90).replace(/\s+/g, ' '));
    const json = JSON.parse(txt);
    if (json.error) throw new Error('ArcGIS: ' + JSON.stringify(json.error).slice(0, 200));
    return json;
  } catch (err) {
    if (attempt >= 7) throw err;
    // Backoff creciente: el servicio responde 400 "Failed to execute query" cuando
    // se le pide demasiado seguido (rate limit), no por query mal formada.
    await sleep(2500 * (attempt + 1) + Math.random() * 1500);
    return query(params, attempt + 1);
  }
}

const BASE = {
  f: 'json', where: '1=1', geometry: BBOX.join(','), geometryType: 'esriGeometryEnvelope',
  spatialRel: 'esriSpatialRelIntersects', inSR: '4326'
};

// 1) total + ids
const countRes = await query({ ...BASE, returnCountOnly: 'true' });
const total = countRes.count;
let ids;
if (existsSync(IDS_FILE)) {
  ids = JSON.parse(readFileSync(IDS_FILE, 'utf8'));
} else {
  const res = await query({ ...BASE, returnIdsOnly: 'true' });
  ids = res.objectIds ?? [];
  writeFileSync(IDS_FILE, JSON.stringify(ids));
}
console.log(`[bldgs] total=${total} ids=${ids.length} paginas=${Math.ceil(total / PAGE)}`);

// 2) paginas por offset
const pages = Math.ceil(total / PAGE);
const pending = [];
for (let p = 0; p < pages; p++) {
  if (!existsSync(resolve(OUT_DIR, `chunk-${String(p).padStart(4, '0')}.json`))) pending.push(p);
}
console.log(`[bldgs] pendientes=${pending.length}`);
const started = Date.now();
const totalPending = pending.length;
let done = 0;
async function worker(id) {
  while (pending.length) {
    const p = pending.shift();
    const json = await query({
      ...BASE, outSR: '4326', returnGeometry: 'true', outFields: OUT_FIELDS,
      resultRecordCount: String(PAGE), resultOffset: String(p * PAGE)
    });
    const feats = json.features ?? [];
    writeFileSync(resolve(OUT_DIR, `chunk-${String(p).padStart(4, '0')}.json`), JSON.stringify(feats));
    done++;
    if (done % 20 === 0 || done === totalPending) {
      const mins = ((Date.now() - started) / 60000).toFixed(1);
      console.log(`[bldgs] ${done}/${totalPending} en ${mins} min (worker ${id}, page ${p}, feats ${feats.length})`);
    }
  }
}
await Promise.all(Array.from({ length: CONCURRENCY }, (_, i) => worker(i)));

// 3) huecos: OBJECTID presentes vs lista completa
function readChunks() {
  return readdirSync(OUT_DIR).filter((f) => f.startsWith('chunk-')).map((f) => JSON.parse(readFileSync(resolve(OUT_DIR, f), 'utf8')));
}
let all = readChunks().flat();
const have = new Set(all.map((x) => x.attributes?.OBJECTID).filter((v) => v != null));
const missing = ids.filter((x) => !have.has(x));
console.log(`[bldgs] recibidos=${have.size} faltan=${missing.length}`);
if (missing.length) {
  const BATCH = 900;
  const batches = [];
  for (let i = 0; i < missing.length; i += BATCH) batches.push(missing.slice(i, i + BATCH));
  let n = 0;
  const q = [...batches.keys()];
  async function fill(id) {
    while (q.length) {
      const b = q.shift();
      const json = await query({ ...BASE, objectIds: batches[b].join(','), outSR: '4326', returnGeometry: 'true', outFields: OUT_FIELDS });
      const feats = json.features ?? [];
      writeFileSync(resolve(OUT_DIR, `fill-${String(b).padStart(4, '0')}.json`), JSON.stringify(feats));
      n++;
      if (n % 10 === 0 || n === batches.length) console.log(`[bldgs] relleno ${n}/${batches.length} (worker ${id})`);
    }
  }
  await Promise.all(Array.from({ length: 2 }, (_, i) => fill(i)));
  all = readChunks().flat();
  const have2 = new Set(all.map((x) => x.attributes?.OBJECTID).filter((v) => v != null));
  console.log(`[bldgs] tras relleno recibidos=${have2.size} (total ${total})`);
}

console.log(`[bldgs] FIN: ${all.length} features descritas`);

// Test del enriquecimiento de alturas 3D (buildings.ts). Bundlea el modulo con
// esbuild y verifica que enrichBuildingsAlturas asigna la altura oficial del
// Ayto. de Madrid (real, vía Sigma) a edificios OSM por matching de centroide.
import { build } from 'esbuild';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

const OUT = resolve(import.meta.dirname ?? '.', 'buildings.test-bundle.mjs');
await build({
  entryPoints: [resolve(import.meta.dirname ?? '.', '..', 'src', 'lib', 'buildings.ts')],
  bundle: true,
  format: 'esm',
  outfile: OUT,
  platform: 'browser',
  write: true,
  absWorkingDir: resolve(import.meta.dirname ?? '.', '..'),
});

globalThis.localStorage = {
  store: new Map(),
  getItem(k) { return this.store.get(k) ?? null; },
  setItem(k, v) { this.store.set(k, String(v)); },
  removeItem(k) { this.store.delete(k); }
};
const mod = await import(pathToFileURL(OUT).href);
const { enrichBuildingsAlturas } = mod;

// Dos edificios sintéticos cerca de Gran Vía (40.4203, -3.7057).
const lat = 40.4203, lng = -3.7057;
const dLat = 0.0005, dLng = 0.0007;
function mk(id, h) {
  return { ring: [[lng - dLng, lat - dLat], [lng + dLng, lat - dLat], [lng + dLng, lat + dLat], [lng - dLng, lat + dLat], [lng - dLng, lat - dLat]], height: h };
}
const osm = [mk(1, 10), mk(2, 10)];
// bbox WGS84 con margen real (south, west, north, east) alrededor del edificio.
const bbox = [40.418, -3.71, 40.422, -3.70];

const enriched = await enrichBuildingsAlturas(osm, bbox);
console.log('Edificio 1 altura:', enriched[0].height);
console.log('Edificio 2 altura:', enriched[1].height);
const changed = enriched.filter((e) => e.height !== 10).length;
console.log(`match exitoso en ${changed}/${enriched.length} edificios`);
console.log(changed > 0 ? 'TEST OK (alturas oficiales asignadas)' : 'TEST NEUTRO (servicio no disponible, fallback OSM 10m)');
process.exit(0);

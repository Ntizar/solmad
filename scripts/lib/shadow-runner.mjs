// Cuerpo del hilo de precompute: carga los edificios de la zona (3x3 tiles),
// registra el motor real del worker y calcula los 48 slots de media hora para
// las terrazas de la zona. Devuelve estados empaquetados (Uint8Array n*48).
import { parentPort, workerData } from 'node:worker_threads';
import { resolve, join } from 'node:path';

process.env.TZ = 'Europe/Madrid';

const { tilesDir, zoneKey, terraces, huellas, ymd, slotCount, stepMin } = workerData;
const { loadEngine } = await import('./engine.mjs');
const { readTile } = await import('./tiles.mjs');

// las peticiones del worker usan la hora local del proceso => TZ Madrid fijada arriba
const api = await loadEngine({ skipBuild: true });

// tiles vecinos 3x3 (el rayo llega a 380 m y el tile mide ~1,3 km: sobra 1 anillo)
const [rowStr, colStr] = zoneKey.split('_');
const row = Number(rowStr), col = Number(colStr);
let buildings = [];
for (let dr = -1; dr <= 1; dr++) {
  for (let dc = -1; dc <= 1; dc++) {
    try {
      buildings = buildings.concat(readTile(join(tilesDir, `${row + dr}_${col + dc}.bin`)));
    } catch { /* tile inexistente: normal en los bordes */ }
  }
}

const originLng = col * 0.012 + 0.006;
const originLat = row * 0.012 + 0.006;
api.setHuellas(huellas);
api.setBuildings(buildings, originLng, originLat);

const n = terraces.length;
const states = new Uint8Array(n * slotCount);
const ids = new Int32Array(n);
// medianoche local del dia pedido
const dayStart = new Date(`${ymd}T00:00:00`);

for (let s = 0; s < slotCount; s++) {
  const when = new Date(dayStart.getTime() + s * stepMin * 60_000);
  const whenIso = when.toISOString();
  let chunk;
  try {
    chunk = api.quickForHuellas(terraces, whenIso);
  } catch (err) {
    // fallback al motor v1 si algo falla en el v2
    chunk = api.facadeQuickFor(terraces, whenIso);
  }
  for (let i = 0; i < n; i++) states[i * slotCount + s] = chunk[i];
}
for (let i = 0; i < n; i++) ids[i] = terraces[i].id;

parentPort.postMessage({ zoneKey, ids, states, buildings: buildings.length });

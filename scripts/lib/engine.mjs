// Motor de sombras en Node: compila el WORKER REAL con esbuild (con el shim de
// comlink) y devuelve el mismo `api` que usa el navegador. Una sola fuente de
// verdad: si cambia el motor del cliente, el precompute cambia igual.
import { build } from 'esbuild';
import { pathToFileURL } from 'node:url';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..', '..');
const SHIM = resolve(ROOT, 'scripts', 'comlink-shim.mjs');
const OUT = resolve(ROOT, 'scratch', 'shadow-engine.bundle.mjs');

export async function loadEngine({ force = false, skipBuild = false } = {}) {
  const exists = (() => { try { return !!readFileSync(OUT); } catch { return false; } })();
  if (!skipBuild || !exists || force) {
    await build({
      entryPoints: [resolve(ROOT, 'src', 'workers', 'shadows.worker.ts')],
      bundle: true,
      format: 'esm',
      outfile: OUT,
      platform: 'browser',
      absWorkingDir: ROOT,
      alias: { comlink: SHIM }
    });
  }
  // shim de entorno "worker" para Node
  if (typeof globalThis.addEventListener !== 'function') {
    globalThis.addEventListener = () => {};
    globalThis.removeEventListener = () => {};
    globalThis.postMessage = () => {};
  }
  const mod = await import(pathToFileURL(OUT).href + '?t=' + (force ? Date.now() : '0'));
  const api = globalThis.__solmadTestAPI;
  if (!api || typeof api.setBuildings !== 'function') {
    throw new Error('El shim de comlink no capturo el api del worker. exports: ' + Object.keys(mod).join(','));
  }
  return api;
}

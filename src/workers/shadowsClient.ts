import * as Comlink from 'comlink';
import type { ShadowAPI } from './shadows.worker';

let _api: Comlink.Remote<ShadowAPI> | null = null;

function spawn(): Comlink.Remote<ShadowAPI> {
  const worker = new Worker(new URL('./shadows.worker.ts', import.meta.url), { type: 'module' });
  return Comlink.wrap<ShadowAPI>(worker);
}

/** Worker principal: cálculos masivos (quick + bulk computeFor). */
export function shadowsApi(): Comlink.Remote<ShadowAPI> {
  if (!_api) _api = spawn();
  return _api;
}

// Shim de comlink para test en Node: captura el objeto expuesto por el worker.
export function expose(api) {
  globalThis.__solmadTestAPI = api;
}
export function wrap(x) { return x; }
export function proxy(x) { return x; }
export const transfer = () => {};
export const proxyMarker = Symbol('proxyMarker');

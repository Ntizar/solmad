import type { Huella } from './types';

/**
 * Carga las huellas de terrazas (fase 1). Archivo generado por
 * scripts/prepare-huellas.mjs -> public/terrazas-huellas.json.
 * Si falla, la app sigue funcionando con el motor de fachada v1.
 */
export async function loadHuellas(): Promise<Record<number, Huella> | null> {
  try {
    const res = await fetch('/terrazas-huellas.json');
    if (!res.ok) return null;
    const raw = (await res.json()) as Record<string, Huella>;
    const out: Record<number, Huella> = {};
    for (const [id, h] of Object.entries(raw)) {
      if (h?.ring?.length === 4 && h.samples?.length) out[Number(id)] = h;
    }
    return out;
  } catch {
    return null;
  }
}

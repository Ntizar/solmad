import type { Terraza } from './types';
import { assetUrl } from './assets';

export async function loadTerrazas(): Promise<Terraza[]> {
  const res = await fetch(assetUrl('terrazas.min.json'));
  if (!res.ok) throw new Error('No se pudo cargar terrazas.min.json. Ejecuta `npm run prepare:data`.');
  return (await res.json()) as Terraza[];
}

export function bbox(terrazas: Terraza[]) {
  let minLng = Infinity, maxLng = -Infinity, minLat = Infinity, maxLat = -Infinity;
  for (const t of terrazas) {
    if (t.lng < minLng) minLng = t.lng;
    if (t.lng > maxLng) maxLng = t.lng;
    if (t.lat < minLat) minLat = t.lat;
    if (t.lat > maxLat) maxLat = t.lat;
  }
  return { minLng, maxLng, minLat, maxLat };
}

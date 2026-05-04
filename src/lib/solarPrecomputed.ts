// Lee public/solar-day.json (precalculado por GitHub Action diaria) y expone helpers.
// Si no existe o falla, devuelve null y la app sigue funcionando con cálculos en vivo.

export interface SolarSample {
  /** "HH:MM" hora Madrid */
  t: string;
  /** Azimut desde norte (0..360, sentido horario) */
  az: number;
  /** Altitud sobre horizonte en grados */
  al: number;
}
export interface SolarDay {
  date: string;
  sunrise: string | null;
  sunset: string | null;
  samples: SolarSample[];
}
export interface SolarPrecomputed {
  version: string;
  tz: string;
  centerLat: number;
  centerLng: number;
  stepMinutes: number;
  days: SolarDay[];
}

let cache: SolarPrecomputed | null | undefined;
let inflight: Promise<SolarPrecomputed | null> | null = null;

export async function loadSolarDay(): Promise<SolarPrecomputed | null> {
  if (cache !== undefined) return cache;
  if (inflight) return inflight;
  inflight = (async () => {
    try {
      const res = await fetch('/solar-day.json', { cache: 'force-cache' });
      if (!res.ok) { cache = null; return null; }
      const data = (await res.json()) as SolarPrecomputed;
      if (!data?.days?.length) { cache = null; return null; }
      cache = data;
      return data;
    } catch {
      cache = null;
      return null;
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}

/** Devuelve la muestra más cercana al instante dado (hora Madrid). */
export function findSample(data: SolarPrecomputed, when: Date): SolarSample | null {
  const fmt = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Madrid', year: 'numeric', month: '2-digit', day: '2-digit' });
  const ymd = fmt.format(when);
  const day = data.days.find((d) => d.date === ymd) ?? data.days[0];
  if (!day) return null;
  const fmtHM = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Madrid', hour: '2-digit', minute: '2-digit', hour12: false });
  const hm = fmtHM.format(when);
  // Búsqueda binaria simple por string "HH:MM"
  let best = day.samples[0];
  let bestDiff = Infinity;
  for (const s of day.samples) {
    const diff = Math.abs(strHMtoMin(s.t) - strHMtoMin(hm));
    if (diff < bestDiff) { bestDiff = diff; best = s; }
  }
  return best;
}

function strHMtoMin(s: string): number {
  const [h, m] = s.split(':').map(Number);
  return h * 60 + m;
}

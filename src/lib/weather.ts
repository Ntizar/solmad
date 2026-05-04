// Cobertura nubosa actual sobre Madrid (Open-Meteo). Sin API key.
// Cache localStorage 30 min para no martillear el servicio.

const CACHE_KEY = 'solmad:weather:v1';
const TTL_MS = 30 * 60 * 1000;

export interface WeatherSnapshot {
  /** 0..100, % de cobertura nubosa actual */
  cloudCover: number;
  /** ISO del momento del dato */
  time: string;
  /** ms del fetch local */
  fetchedAt: number;
}

let inflight: Promise<WeatherSnapshot | null> | null = null;

export async function getMadridWeather(): Promise<WeatherSnapshot | null> {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (raw) {
      const cached = JSON.parse(raw) as WeatherSnapshot;
      if (Date.now() - cached.fetchedAt < TTL_MS) return cached;
    }
  } catch { /* ignore */ }
  if (inflight) return inflight;
  inflight = (async () => {
    try {
      const url = 'https://api.open-meteo.com/v1/forecast?latitude=40.4168&longitude=-3.7038&current=cloud_cover&timezone=Europe%2FMadrid';
      const res = await fetch(url, { cache: 'no-store' });
      if (!res.ok) return null;
      const data = await res.json();
      const cloudCover = Number(data?.current?.cloud_cover);
      const time = String(data?.current?.time ?? '');
      if (!Number.isFinite(cloudCover)) return null;
      const snap: WeatherSnapshot = { cloudCover, time, fetchedAt: Date.now() };
      try { localStorage.setItem(CACHE_KEY, JSON.stringify(snap)); } catch { /* ignore */ }
      return snap;
    } catch {
      return null;
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}

/** Devuelve un texto humano según cobertura nubosa, o null si no aporta nada. */
export function cloudHint(cover: number | null | undefined): string | null {
  if (cover == null) return null;
  if (cover >= 80) return 'Cielo muy nublado: el sol directo será débil.';
  if (cover >= 50) return 'Bastantes nubes: el sol entra a ratos.';
  if (cover >= 20) return 'Algunas nubes: sol con momentos cubiertos.';
  return null; // <20% no merece mensaje
}

/** Emoji según cobertura. */
export function cloudEmoji(cover: number | null | undefined): string {
  if (cover == null) return '';
  if (cover >= 80) return '☁';
  if (cover >= 50) return '🌥';
  if (cover >= 20) return '⛅';
  return '☀';
}

import * as Comlink from 'comlink';
import SunCalc from 'suncalc';
import type { BuildingPoly, SunState, Terraza } from '../lib/types';

const M_PER_DEG_LAT = 111_320;
const RAY_LEN_M = 380;
const STEP_MIN = 12;
const RIBBON_STEP_MIN = 30;

function mPerDegLng(lat: number) {
  return 111_320 * Math.cos((lat * Math.PI) / 180);
}

interface Seg { ax: number; ay: number; bx: number; by: number; h: number; tag: number; }

class SegIndex {
  cell = 60;
  grid = new Map<string, Seg[]>();
  originLng = 0; originLat = 0; mLng = 1;
  tagCounter = 0;
  visitToken = 0;

  build(buildings: BuildingPoly[], originLng: number, originLat: number) {
    this.originLng = originLng; this.originLat = originLat;
    this.mLng = mPerDegLng(originLat);
    for (const b of buildings) {
      const r = b.ring;
      for (let i = 0; i < r.length - 1; i++) {
        const [ax, ay] = this.toM(r[i][0], r[i][1]);
        const [bx, by] = this.toM(r[i + 1][0], r[i + 1][1]);
        this.indexSeg({ ax, ay, bx, by, h: b.height, tag: 0 });
      }
    }
  }
  toM(lng: number, lat: number): [number, number] {
    return [(lng - this.originLng) * this.mLng, (lat - this.originLat) * M_PER_DEG_LAT];
  }
  indexSeg(s: Seg) {
    const minX = Math.min(s.ax, s.bx), maxX = Math.max(s.ax, s.bx);
    const minY = Math.min(s.ay, s.by), maxY = Math.max(s.ay, s.by);
    const c = this.cell;
    for (let cx = Math.floor(minX / c); cx <= Math.floor(maxX / c); cx++) {
      for (let cy = Math.floor(minY / c); cy <= Math.floor(maxY / c); cy++) {
        const k = cx + ',' + cy;
        let arr = this.grid.get(k);
        if (!arr) { arr = []; this.grid.set(k, arr); }
        arr.push(s);
      }
    }
  }
  /** Itera segmentos a lo largo del rayo evitando Set: marcado con visitToken. */
  forEachAlongRay(ox: number, oy: number, dx: number, dy: number, len: number, fn: (s: Seg) => boolean | void) {
    const c = this.cell;
    const token = ++this.visitToken;
    const steps = Math.ceil(len / (c * 0.5));
    for (let i = 0; i <= steps; i++) {
      const t = (i * len) / steps;
      const x = ox + dx * t, y = oy + dy * t;
      const cx = Math.floor(x / c), cy = Math.floor(y / c);
      // 3x3 cells alrededor del paso
      for (let nx = cx - 1; nx <= cx + 1; nx++) {
        for (let ny = cy - 1; ny <= cy + 1; ny++) {
          const arr = this.grid.get(nx + ',' + ny);
          if (!arr) continue;
          for (const s of arr) {
            if (s.tag === token) continue;
            s.tag = token;
            if (fn(s) === true) return; // early exit (ej. blocker encontrado)
          }
        }
      }
    }
  }
}

let index: SegIndex | null = null;

function segIntersectRay(ox: number, oy: number, dx: number, dy: number, len: number, s: Seg): number | null {
  const r2x = s.bx - s.ax, r2y = s.by - s.ay;
  const denom = dx * r2y - dy * r2x;
  if (Math.abs(denom) < 1e-9) return null;
  const sx = s.ax - ox, sy = s.ay - oy;
  const t = (sx * r2y - sy * r2x) / denom;
  const u = (sx * dy - sy * dx) / denom;
  if (t < 0 || t > len || u < 0 || u > 1) return null;
  return t;
}

function isSunlit(originX: number, originY: number, azDeg: number, altDeg: number): boolean {
  if (altDeg <= 0) return false;
  if (!index || index.grid.size === 0) return true; // sin edificios: cielo abierto
  const a = (azDeg * Math.PI) / 180;
  const dx = Math.sin(a), dy = Math.cos(a);
  const tanAlt = Math.tan((altDeg * Math.PI) / 180);
  let blocked = false;
  index.forEachAlongRay(originX, originY, dx, dy, RAY_LEN_M, (s) => {
    const t = segIntersectRay(originX, originY, dx, dy, RAY_LEN_M, s);
    if (t === null) return;
    if (s.h > t * tanAlt + 0.5) {
      blocked = true;
      return true; // early exit
    }
  });
  return !blocked;
}

function sunPos(when: Date, lat: number, lng: number) {
  const p = SunCalc.getPosition(when, lat, lng);
  const az = (((p.azimuth * 180) / Math.PI) + 180 + 360) % 360;
  const al = (p.altitude * 180) / Math.PI;
  return { az, al };
}

const api = {
  setBuildings(buildings: BuildingPoly[], originLng: number, originLat: number) {
    index = new SegIndex();
    index.build(buildings, originLng, originLat);
    return { segments: [...index.grid.values()].reduce((a, b) => a + b.length, 0) };
  },

  /** Bulk: estado actual + minutos restantes hasta el ocaso (sin ribbon, lazy). */
  computeFor(terrazas: Terraza[], whenIso: string): SunState[] {
    const when = new Date(whenIso);
    const results: SunState[] = new Array(terrazas.length);

    const ref = terrazas[0];
    const times = ref ? SunCalc.getTimes(when, ref.lat, ref.lng) : null;
    const sunset = times?.sunset;

    const slots: Array<{ az: number; al: number }> = [];
    if (sunset && when < sunset && ref) {
      const end = sunset.getTime();
      for (let ts = when.getTime(); ts < end; ts += STEP_MIN * 60_000) {
        slots.push(sunPos(new Date(ts), ref.lat, ref.lng));
      }
    }

    const idx = index;
    for (let i = 0; i < terrazas.length; i++) {
      const t = terrazas[i];
      const [ox, oy] = idx ? idx.toM(t.lng, t.lat) : [0, 0];
      const { az: azNow, al: altNow } = sunPos(when, t.lat, t.lng);
      const sunNow = isSunlit(ox, oy, azNow, altNow);

      let minutesLeft = 0;
      let directMinutes = 0;
      let directOpen = sunNow;
      for (const s of slots) {
        const lit = s.al > 0 && isSunlit(ox, oy, s.az, s.al);
        if (lit) minutesLeft += STEP_MIN;
        if (directOpen && lit) directMinutes += STEP_MIN;
        else directOpen = false;
      }

      results[i] = { sunNow, altitudeDeg: altNow, azimuthDeg: azNow, minutesLeft, directMinutes };
    }
    return results;
  },

  /** Subset prioritario (visible/cercanos/seleccionada). */
  computeSubset(terrazas: Terraza[], whenIso: string): SunState[] {
    return api.computeFor(terrazas, whenIso);
  },

  /** Ribbon de 48 medias horas para una sola terraza. */
  ribbonFor(t: Terraza, whenIso: string): number[] {
    const when = new Date(whenIso);
    const idx = index;
    const [ox, oy] = idx ? idx.toM(t.lng, t.lat) : [0, 0];
    const ribbon: number[] = new Array(48);
    const day = new Date(when); day.setHours(0, 0, 0, 0);
    for (let k = 0; k < 48; k++) {
      const d = new Date(day.getTime() + k * RIBBON_STEP_MIN * 60_000);
      const { az, al } = sunPos(d, t.lat, t.lng);
      if (al <= 0) ribbon[k] = 2;
      else ribbon[k] = isSunlit(ox, oy, az, al) ? 1 : 0;
    }
    return ribbon;
  },

  /** Estado de un único punto arbitrario (p. ej. la ubicación del usuario). */
  pointAt(lat: number, lng: number, whenIso: string): { sunNow: boolean; altitudeDeg: number; azimuthDeg: number; directMinutes: number } {
    const when = new Date(whenIso);
    const idx = index;
    const [ox, oy] = idx ? idx.toM(lng, lat) : [0, 0];
    const { az, al } = sunPos(when, lat, lng);
    const sunNow = al > 0 && isSunlit(ox, oy, az, al);
    let directMinutes = 0;
    if (sunNow) {
      const times = SunCalc.getTimes(when, lat, lng);
      const sunset = times.sunset;
      if (sunset && when < sunset) {
        const end = sunset.getTime();
        for (let ts = when.getTime(); ts < end; ts += STEP_MIN * 60_000) {
          const s = sunPos(new Date(ts), lat, lng);
          if (s.al > 0 && isSunlit(ox, oy, s.az, s.al)) directMinutes += STEP_MIN;
          else break;
        }
      }
    }
    return { sunNow, altitudeDeg: al, azimuthDeg: az, directMinutes };
  },

  /** Quick: sólo sunNow. Funciona aunque aún no haya edificios cargados (cielo abierto). */
  quickFor(terrazas: Terraza[], whenIso: string): Uint8Array {
    const when = new Date(whenIso);
    const out = new Uint8Array(terrazas.length);
    const idx = index;
    for (let i = 0; i < terrazas.length; i++) {
      const t = terrazas[i];
      const [ox, oy] = idx ? idx.toM(t.lng, t.lat) : [0, 0];
      const { az, al } = sunPos(when, t.lat, t.lng);
      out[i] = al <= 0 ? 2 : isSunlit(ox, oy, az, al) ? 1 : 0;
    }
    return out;
  }
};

export type ShadowAPI = typeof api;
Comlink.expose(api);

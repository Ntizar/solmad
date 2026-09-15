// Matriz solar PRECALCULADA (public/solar-matrix.bin).
//
// El calculo de sol/sombra de las 6.200 terrazas para las 48 franjas del dia se
// hace UNA vez, por la noche (script + GitHub Action). El cliente solo lee el
// fichero (~97 KB, 12 bytes por terraza) y tiene el estado de todo Madrid al
// instante: sin raycasting, sin edificios, sin esperas.
//
// Formato SMSH v1 (little endian, ver scripts/precompute-shadows.mjs):
//   u32 magic 'SMSH' | u8 version | u8 stepMinutes | u16 slotCount | u32 count | u32 reservado
//   count x u32 ids (ascendente)
//   count x (slotCount/4) bytes -> 4 estados por byte, 2 bits cada uno
//     bits 0-1 = franja 0, bits 2-3 = franja 1, ...
//
// Estados: 0=sombra · 1=sol · 2=noche · 3=pendiente (sin datos de edificios)

export const MATRIX_URL = '/solar-matrix.bin';
export const MATRIX_META_URL = '/solar-matrix.meta.json';

export interface SolarMatrix {
  version: number;
  stepMinutes: number;
  slotCount: number;
  /** fecha de la matriz como AAAAMMDD (hora de Madrid) */
  dateInt: number;
  /** estado por (índice de terraza, franja) */
  raw: Uint8Array;
  /** id de terraza -> índice */
  index: Map<number, number>;
  bytesPerTerraza: number;
  count: number;
}

export interface SolarMatrixMeta {
  version: number;
  date: string;
  generatedAt: string;
  stepMinutes: number;
  slotCount: number;
  terraces: number;
  discarded?: number;
  tz: string;
  stats?: { shadePct: number; sunPct: number; nightPct: number; pendingPct: number };
  buildingsTiles?: number;
}

let matrixPromise: Promise<SolarMatrix | null> | null = null;
let matrixCache: SolarMatrix | null | undefined;

function parseMatrix(buf: ArrayBuffer): SolarMatrix | null {
  const dv = new DataView(buf);
  if (buf.byteLength < 16) return null;
  const magic = String.fromCharCode(dv.getUint8(0), dv.getUint8(1), dv.getUint8(2), dv.getUint8(3));
  if (magic !== 'SMSH') return null;
  const version = dv.getUint8(4);
  const stepMinutes = dv.getUint8(5);
  const slotCount = dv.getUint16(6, true);
  const count = dv.getUint32(8, true);
  const dateInt = dv.getUint32(12, true);
  const bytesPerTerraza = slotCount / 4;
  const expected = 16 + count * 4 + count * bytesPerTerraza;
  if (buf.byteLength < expected) return null;
  const index = new Map<number, number>();
  for (let i = 0; i < count; i++) index.set(dv.getUint32(16 + i * 4, true), i);
  return {
    version,
    stepMinutes,
    slotCount,
    dateInt,
    raw: new Uint8Array(buf, 16 + count * 4, count * bytesPerTerraza),
    index,
    bytesPerTerraza,
    count
  };
}

/** Carga (una sola vez) la matriz precalculada. Devuelve null si no hay fichero. */
export function loadSolarMatrix(): Promise<SolarMatrix | null> {
  if (matrixCache !== undefined) return Promise.resolve(matrixCache);
  if (matrixPromise) return matrixPromise;
  matrixPromise = (async () => {
    try {
      const res = await fetch(MATRIX_URL, { cache: 'force-cache' });
      if (!res.ok) { matrixCache = null; return null; }
      const parsed = parseMatrix(await res.arrayBuffer());
      matrixCache = parsed;
      return parsed;
    } catch {
      matrixCache = null;
      return null;
    } finally {
      matrixPromise = null;
    }
  })();
  return matrixPromise;
}

let metaPromise: Promise<SolarMatrixMeta | null> | null = null;
export function loadSolarMatrixMeta(): Promise<SolarMatrixMeta | null> {
  if (!metaPromise) {
    metaPromise = (async () => {
      try {
        const res = await fetch(MATRIX_META_URL, { cache: 'force-cache' });
        if (!res.ok) return null;
        return (await res.json()) as SolarMatrixMeta;
      } catch { return null; }
    })();
  }
  return metaPromise;
}

export function invalidateSolarMatrix() {
  matrixCache = undefined;
  matrixPromise = null;
  metaPromise = null;
}

const MADRID_TIME = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Europe/Madrid', hour: '2-digit', minute: '2-digit', hour12: false
});
const MADRID_YMD = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Europe/Madrid', year: 'numeric', month: '2-digit', day: '2-digit'
});

/** Minutos desde medianoche en hora de Madrid (no en la hora del visitante). */
export function madridMinutes(date: Date): number {
  const [h, m] = MADRID_TIME.format(date).split(':').map(Number);
  return h * 60 + m;
}

/** Fecha de Madrid como AAAAMMDD (para comparar con la fecha de la matriz). */
export function madridDateInt(date: Date): number {
  const ymd = MADRID_YMD.format(date); // YYYY-MM-DD
  return Number(ymd.replace(/-/g, ''));
}

/** ¿La matriz vale para ese instante? (mismo día natural de Madrid) */
export function matrixCoversDate(matrix: SolarMatrix, date: Date): boolean {
  return matrix.dateInt === madridDateInt(date);
}

/** Franja de la matriz para un instante dado. */
export function slotForDate(matrix: SolarMatrix, date: Date): number {
  const mins = madridMinutes(date);
  return Math.max(0, Math.min(matrix.slotCount - 1, Math.floor(mins / matrix.stepMinutes)));
}

/** Estado de una terraza en una franja. 0=sombra 1=sol 2=noche 3=pendiente, o 255 si no está. */
export function stateAt(matrix: SolarMatrix, terrazaId: number, slot: number): number {
  const idx = matrix.index.get(terrazaId);
  if (idx === undefined) return 255;
  const byte = matrix.raw[idx * matrix.bytesPerTerraza + (slot >> 2)];
  return (byte >> ((slot & 3) * 2)) & 3;
}

/**
 * Estados de todas las terrazas para la franja pedida, alineados con el array
 * que se le pasa (255 = la terraza no está en la matriz, o la matriz es de otro
 * día). O(1) por terraza.
 */
export function statesForTerrazas(matrix: SolarMatrix, terrazas: Array<{ id: number }>, date: Date, out?: Uint8Array): Uint8Array {
  const res = out && out.length === terrazas.length ? out : new Uint8Array(terrazas.length);
  if (!matrixCoversDate(matrix, date)) { res.fill(255); return res; }
  const slot = slotForDate(matrix, date);
  for (let i = 0; i < terrazas.length; i++) {
    const idx = matrix.index.get(terrazas[i].id);
    if (idx === undefined) { res[i] = 255; continue; }
    const byte = matrix.raw[idx * matrix.bytesPerTerraza + (slot >> 2)];
    res[i] = (byte >> ((slot & 3) * 2)) & 3;
  }
  return res;
}

/** Recuento por estado en una franja (para contadores tipo "X terrazas al sol"). */
export function countByState(matrix: SolarMatrix, slot: number): { sun: number; shade: number; night: number; pending: number; total: number } {
  let sun = 0, shade = 0, night = 0, pending = 0;
  for (let i = 0; i < matrix.count; i++) {
    const byte = matrix.raw[i * matrix.bytesPerTerraza + (slot >> 2)];
    const v = (byte >> ((slot & 3) * 2)) & 3;
    if (v === 1) sun++; else if (v === 0) shade++; else if (v === 2) night++; else pending++;
  }
  return { sun, shade, night, pending, total: matrix.count };
}

/** Mejores terrazas por minutos de sol restantes desde la franja actual (ranking instantáneo). */
export function sunMinutesFrom(matrix: SolarMatrix, terrazaId: number, slot: number): number {
  const idx = matrix.index.get(terrazaId);
  if (idx === undefined) return -1;
  let mins = 0;
  for (let s = slot; s < matrix.slotCount; s++) {
    const byte = matrix.raw[idx * matrix.bytesPerTerraza + (s >> 2)];
    const v = (byte >> ((s & 3) * 2)) & 3;
    if (v === 1) mins += matrix.stepMinutes;
    else if (v === 0) break;
    else break; // noche o pendiente cortan la racha
  }
  return mins;
}

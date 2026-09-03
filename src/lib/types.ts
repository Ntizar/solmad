export interface Terraza {
  id: number;
  localId: number;
  name: string;
  distrito: string;
  barrio: string;
  via: string;
  num: string;
  cp: number;
  lng: number;
  lat: number;
  ubicacion: string | null;
  horaIni: string | null;
  horaFin: string | null;
  mesas: number;
  sillas: number;
  superficie: number | null;
  sombrillas: number;
  periodo: string | null;
}

export interface SunState {
  sunNow: boolean;          // sol directo ahora (>=25% de la huella soleada)
  sunNowPct?: number;       // 0..100 % de la huella soleada ahora (motor v2)
  altitudeDeg: number;      // del sol en este momento
  azimuthDeg: number;       // 0 = N, 90 = E
  minutesLeft: number;      // minutos de sol restantes hoy en esta terraza
  directMinutes: number;    // minutos continuos de sol directo desde la hora elegida
  ribbon?: number[];        // 48 medias horas, 0=sombra,1=sol,2=noche (lazy)
}

/** Huella de terraza sobre la acera (fase 1). */
export interface Huella {
  ring: [number, number][];          // 4 esquinas WGS84
  samples: [number, number][];       // centros de cuadrantes (grid 2x2)
  orientacion?: number;              // grados del eje de la via
}

export interface BuildingPoly {
  // anillo exterior en lng/lat, ya en WGS84
  ring: [number, number][];
  height: number; // metros
}

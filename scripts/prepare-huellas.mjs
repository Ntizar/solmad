import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import proj4 from 'proj4';

// FASE 2 - Huellas de terrazas sobre la acera, con mimo.
// El punto del censo (coordenada_x_local/y, EPSG:25830) es la POSICIÓN REAL de
// la terraza (ya está en la acera). Lo usamos como centro. Solo las terrazas
// sin dato (0,0) se estiman desde la vía cercana. Dimensionamos con la
// superficie real y resolvemos colisiones para que no se pisen entre sí.
//
// Salida: public/terrazas-huellas.json (por terraza abierta).

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = resolve(ROOT, 'public', 'terrazas-huellas.json');

const BUSCAR_RADIO_M = 55;   // para terrazas sin GPS: vía más cercana
const RADIO_SEG_M = 35;      // radio para promediar la dirección de la acera
const ANCHO_ACERA_M = 2.0;   // ancho típico de terraza en una acera madrileña
const ANCHO_ACERA_MAX = 2.4; // techo visual, no invadir calzada
const LONG_MIN = 2.5;
const LONG_MAX = 45;
const RETROCESO_FACHADA_M = 0.3; // ligero empuje hacia fachada para no volar la acera
const GRID = 2;              // muestras por lado (2x2 = 4 por huella)
const COLISION_M = 0.5;      // margen mínimo entre huellas (m)

const M_LAT = 111320;
const ORIGIN = { lat: 40.4168, lng: -3.7038 };
const M_LNG = M_LAT * Math.cos(ORIGIN.lat * Math.PI / 180);
const r6 = (n) => Math.round(n * 1e6) / 1e6;

// ---- índice espacial de segmentos de vía (celdas de 100 m) ----
class ViaIndex {
  constructor() { this.cell = 100; this.grid = new Map(); }
  add(s) {
    const c = this.cell;
    const x0 = Math.floor(Math.min(s.ax, s.bx) / c), x1 = Math.floor(Math.max(s.ax, s.bx) / c);
    const y0 = Math.floor(Math.min(s.ay, s.by) / c), y1 = Math.floor(Math.max(s.ay, s.by) / c);
    for (let cx = x0; cx <= x1; cx++) for (let cy = y0; cy <= y1; cy++) {
      const k = cx + ',' + cy;
      let a = this.grid.get(k);
      if (!a) { a = []; this.grid.set(k, a); }
      a.push(s);
    }
  }
  near(x, y, r, fn) {
    const c = this.cell, n = Math.ceil(r / c);
    const cx0 = Math.floor(x / c), cy0 = Math.floor(y / c);
    for (let dx = -n; dx <= n; dx++) for (let dy = -n; dy <= n; dy++) {
      const a = this.grid.get((cx0 + dx) + ',' + (cy0 + dy));
      if (!a) continue;
      for (const s of a) if (fn(s) === true) return;
    }
  }
}

function distSeg(px, py, s) {
  const vx = s.bx - s.ax, vy = s.by - s.ay;
  const l2 = vx * vx + vy * vy;
  const t = l2 <= 1e-9 ? 0 : Math.max(0, Math.min(1, ((px - s.ax) * vx + (py - s.ay) * vy) / l2));
  const qx = s.ax + vx * t, qy = s.ay + vy * t;
  return { d: Math.hypot(px - qx, py - qy), qx, qy };
}

// ---- carga ----
const raw = JSON.parse(readFileSync(resolve(ROOT, 'data', 'terrazas.json'), 'utf8'));
const tr = (s) => (typeof s === 'string' ? s.trim() : s);
const abiertas = raw.filter((r) =>
  tr(r.desc_situacion_local) === 'Abierto' &&
  (!tr(r.desc_situacion_terraza) || tr(r.desc_situacion_terraza) === 'Abierta'));
console.log('[huellas] Terrazas abiertas: ' + abiertas.length);

const viaJson = JSON.parse(readFileSync(resolve(ROOT, 'data', 'vias-madrid.json'), 'utf8'));
const vias = (viaJson.elements || []).filter((el) => el.type === 'way' && el.geometry);
console.log('[huellas] Vias OSM: ' + vias.length);

const idx = new ViaIndex();
for (const w of vias) {
  const g = w.geometry;
  if (!g || g.length < 2) continue;
  for (let i = 0; i < g.length - 1; i++) {
    const p1 = g[i], p2 = g[i + 1];
    if (p1.lat == null || p2.lat == null) continue;
    idx.add({
      ax: (p1.lon - ORIGIN.lng) * M_LNG, ay: (p1.lat - ORIGIN.lat) * M_LAT,
      bx: (p2.lon - ORIGIN.lng) * M_LNG, by: (p2.lat - ORIGIN.lat) * M_LAT,
    });
  }
}

proj4.defs('EPSG:25830', '+proj=utm +zone=30 +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs');
const fwd = proj4('EPSG:25830', 'EPSG:4326');

/** Dirección media de la acera cerca de un punto (2*theta), en radianes (eje). */
function viaDir(px, py) {
  let ss = 0, cc = 0, n = 0;
  idx.near(px, py, RADIO_SEG_M, (s) => {
    const mx = (s.ax + s.bx) / 2, my = (s.ay + s.by) / 2;
    if (Math.hypot(mx - px, my - py) > RADIO_SEG_M) return;
    const a = Math.atan2(s.by - s.ay, s.bx - s.ax);
    ss += Math.sin(2 * a); cc += Math.cos(2 * a); n++;
  });
  if (n === 0) return null;
  return 0.5 * Math.atan2(ss, cc);
}

function huellaDe(t) {
  const x = Number(t.coordenada_x_local), y = Number(t.coordenada_y_local);
  const tieneGps = Number.isFinite(x) && Number.isFinite(y) && (x !== 0 || y !== 0);

  let realX = null, realY = null;
  if (tieneGps) {
    const [lng, lat] = fwd.forward([x, y]);
    if (lat < 39 || lat > 41 || lng < -4.5 || lng > -3) return null;
    realX = (lng - ORIGIN.lng) * M_LNG;
    realY = (lat - ORIGIN.lat) * M_LAT;
  }

  // ---- dirección de acera ----
  let ux, uy, nx, ny;
  if (realX != null) {
    const dir = viaDir(realX, realY) ?? 0;
    ux = Math.cos(dir); uy = Math.sin(dir);
    nx = -uy; ny = ux;
  } else {
    // sin GPS: buscar la vía más cercana al punto estimado
    let best = null;
    idx.near(x, y, BUSCAR_RADIO_M, (s) => {
      const r = distSeg(x, y, s);
      if (r.d <= BUSCAR_RADIO_M && (!best || r.d < best.d)) best = r;
    });
    if (!best) return null;
    const dir = viaDir(best.qx, best.qy) ?? 0;
    ux = Math.cos(dir); uy = Math.sin(dir);
    nx = -uy; ny = ux;
    // posicionar en el borde de la acera (1.5 m del eje, no 5 m)
    const sentido = ((best.px - best.qx) * nx + (best.py - best.qy) * ny) >= 0 ? 1 : -1;
    realX = best.qx + nx * 1.5 * sentido;
    realY = best.qy + ny * 1.5 * sentido;
  }

  // ---- dimensiones con superficie real ----
  const sup = Number(t.Superficie_ES || t.Superficie_RA || 0) || 0;
  let ancho = ANCHO_ACERA_M;
  let longitud = 4;
  if (sup > 0) {
    // las terrazas grandes reparten a lo largo de la fachada, ancho acotado a acera
    ancho = sup < 12 ? 1.6 : ANCHO_ACERA_M; // pequeña = más estrecha
    longitud = sup / ancho;
    if (longitud > LONG_MAX) longitud = LONG_MAX;
    if (longitud < LONG_MIN) longitud = LONG_MIN;
  }
  const hl = longitud / 2, ha = ancho / 2;

  // ------- posicionamiento -------
  // Con GPS real: el punto del censo ES la terraza; NO la movemos (ya está
  // bien colocada por el Ayto.). Solo encuadramos el rectángulo en el punto.
  let cx, cy;
  cx = realX; cy = realY;
  // ligero empuje a la fachada para no volar la calzada (muy pequeño)
  cx -= nx * RETROCESO_FACHADA_M;
  cy -= ny * RETROCESO_FACHADA_M;

  // Sin GPS: la terraza se colocó en el borde de acera de la vía más cercana.
  // Para que varias de la misma calle no se apilen, distribuimos a lo largo
  // del eje según un hash del id (variación determinista).
  if (!tieneGps) {
    const variacion = ((Number(t.id_terraza) % 40) - 20) * (hl * 1.1); // ±20 hl
    cx += ux * variacion;
    cy += uy * variacion;
  }

  const corner = (fu, fn) => {
    const mx = cx + ux * (fu * hl) + nx * (fn * ha);
    const my = cy + uy * (fu * hl) + ny * (fn * ha);
    return [r6(ORIGIN.lng + mx / M_LNG), r6(ORIGIN.lat + my / M_LAT)];
  };
  const ring = [corner(-1, -1), corner(-1, 1), corner(1, 1), corner(1, -1)];

  // muestras solares: centros de cuadrantes
  const samples = [];
  for (let i = 0; i < GRID; i++) for (let j = 0; j < GRID; j++) {
    samples.push(corner((i + 0.5) / GRID * 2 - 1, (j + 0.5) / GRID * 2 - 1));
  }

  const angDeg = Math.atan2(uy, ux) * 180 / Math.PI;
  return { ring, samples, orientacion: Math.round((((angDeg % 180) + 180) % 180)) };
}

// ---- main ----
const out = {};
let ok = 0, sinVia = 0;
for (const t of abiertas) {
  const h = huellaDe(t);
  if (!h) { sinVia++; continue; }
  out[t.id_terraza] = h;
  ok++;
}

// escritura
mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, JSON.stringify(out));
console.log('[huellas] ' + ok + ' huellas, ' + sinVia + ' sin vía cercana -> ' + OUT);

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import proj4 from 'proj4';

// FASE 1 - Huellas de terrazas sobre la acera.
// Lee data/terrazas.json (crudo Ayuntamiento, EPSG:25830) y data/vias-madrid.json
// (viario Overpass). Genera public/terrazas-huellas.json: por terraza abierta,
// huella rectangular orientada al eje de la via, en el lado de la acera del
// punto oficial, dimensionada con superficie/ancho. Incluye 4 muestras (grid 2x2)
// para el motor solar v2 (% de superficie soleada).

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = resolve(ROOT, 'public', 'terrazas-huellas.json');

const BUSCAR_RADIO_M = 60;   // radio de busqueda de la via mas cercana
const RADIO_SEG_M = 40;      // radio para promediar la direccion de la via
const ANCHO_DEF = 2.5;       // m, ancho tipico de terraza lineal (ordenacion Madrid)
const ANCHO_MAX = 4.0;       // m, techo visual del ancho
const RETROCESO_M = 0.5;     // m, entre borde de calzada y borde de terraza
const SEMIANCHO_CALZADA = 4.5; // m, mitad de calzada tipica
const GRID = 2;              // muestras por lado (2x2 = 4 por huella)

const M_LAT = 111320;
const ORIGIN = { lat: 40.4168, lng: -3.7038 };
const M_LNG = M_LAT * Math.cos(ORIGIN.lat * Math.PI / 180);
const r6 = (n) => Math.round(n * 1e6) / 1e6;

// ---- indice espacial de segmentos de via (celdas de 100 m) ----
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

function huellaDe(t) {
  const x = Number(t.coordenada_x_local), y = Number(t.coordenada_y_local);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  const [lng, lat] = fwd.forward([x, y]);
  if (lat < 39 || lat > 41 || lng < -4.5 || lng > -3) return null;
  const ox = (lng - ORIGIN.lng) * M_LNG, oy = (lat - ORIGIN.lat) * M_LAT;

  // via mas cercana
  let best = null;
  idx.near(ox, oy, BUSCAR_RADIO_M, (s) => {
    const r = distSeg(ox, oy, s);
    if (r.d <= BUSCAR_RADIO_M && (!best || r.d < best.d)) best = r;
  });
  if (!best) return null;

  // direccion media de la via cerca del cruce (angulo de eje, 2*theta)
  let ss = 0, cc = 0, n = 0;
  idx.near(best.qx, best.qy, RADIO_SEG_M, (s) => {
    const mx = (s.ax + s.bx) / 2, my = (s.ay + s.by) / 2;
    if (Math.hypot(mx - best.qx, my - best.qy) > RADIO_SEG_M) return;
    const a = Math.atan2(s.by - s.ay, s.bx - s.ax);
    ss += Math.sin(2 * a); cc += Math.cos(2 * a); n++;
  });
  if (n === 0) return null;
  const ang = 0.5 * Math.atan2(ss, cc);
  const ux = Math.cos(ang), uy = Math.sin(ang); // eje de la via
  const nx = -uy, ny = ux;                       // normal (lado +1)
  const lado = ((ox - best.qx) * nx + (oy - best.qy) * ny) >= 0 ? 1 : -1;

  // dimensiones: superficie / ancho => longitud (longitud razonable 3-30 m)
  const sup = Number(t.Superficie_ES || t.Superficie_RA || 0) || 0;
  let ancho = ANCHO_DEF;
  if (sup > 0) {
    const lonEst = sup / ANCHO_DEF;
    if (lonEst > 30) ancho = Math.min(ANCHO_MAX, sup / 30);
    else if (lonEst < 3) ancho = Math.max(1.5, Math.min(ANCHO_MAX, sup / 3));
  }
  const longitud = sup > 0 ? sup / ancho : 4;

  // offset desde el eje de la via hacia la acera
  const offset = SEMIANCHO_CALZADA + RETROCESO_M;
  const cx = best.qx + nx * offset * lado;
  const cy = best.qy + ny * offset * lado;
  const hl = longitud / 2, ha = ancho / 2;

  const corner = (fu, fn) => {
    const mx = cx + ux * (fu * hl) + nx * (fn * ha) * lado;
    const my = cy + uy * (fu * hl) + ny * (fn * ha) * lado;
    return [r6(ORIGIN.lng + mx / M_LNG), r6(ORIGIN.lat + my / M_LAT)];
  };
  const ring = [corner(-1, -1), corner(-1, 1), corner(1, 1), corner(1, -1)];

  // muestras solares: centros de cuadrantes
  const samples = [];
  for (let i = 0; i < GRID; i++) for (let j = 0; j < GRID; j++) {
    samples.push(corner((i + 0.5) / GRID * 2 - 1, (j + 0.5) / GRID * 2 - 1));
  }

  return { ring, samples, orientacion: Math.round(((ang * 180 / Math.PI) % 180 + 180) % 180) };
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

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, JSON.stringify(out));
console.log('[huellas] ' + ok + ' huellas, ' + sinVia + ' sin via cercana -> ' + OUT);

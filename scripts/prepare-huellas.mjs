import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import proj4 from 'proj4';
import { readTile } from './lib/tiles.mjs';

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
const FACADE_RETROCESO_M = 0.4; // m, separacion entre fachada y borde de la huella
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

  // Offset desde el eje de la via hacia la acera. El punto del censo esta en la
  // FACHADA, asi que su distancia al eje nos dice donde empieza el edificio:
  // ponemos la huella pegada a la fachada (retroceso 0,4 m) en lugar de a un
  // fijo de 5 m. En calles estrechas ese fijo metia la terraza DENTRO del
  // edificio y quedaba en sombra permanente (350 de 6.154 terrazas).
  const dCenso = Math.hypot(ox - best.qx, oy - best.qy);
  const offsetMax = SEMIANCHO_CALZADA + RETROCESO_M;
  const offset = Math.max(ancho / 2 + 0.2, Math.min(offsetMax, dCenso - ancho / 2 - FACADE_RETROCESO_M));
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

// ---- SEPARAR terrazas apiladas (dos o más en el mismo sitio) ----
// Si dos huellas se solapan, desplazamos la segunda a lo largo de su eje
// de la vía (norte-sur del segmento) hasta que no pisen. No cambiamos el
// offset a la acera ni el tamaño: solo separamos las que coinciden.
const keys = Object.keys(out);
function cenRing(ring) {
  const sx = ring.reduce((a, p) => a + p[0], 0), sy = ring.reduce((a, p) => a + p[1], 0);
  return [sx / ring.length, sy / ring.length];
}
function orientDeg(a) { // devuelve ux,uy en metros a partir del angulo de orientacion
  const rad = (Number(a) || 0) * Math.PI / 180;
  return [Math.cos(rad), Math.sin(rad)];
}
function overlapM(ringA, ringB) {
  // Solo tratamos como solape cuando los CENTROS están muy cerca (< 3.5 m):
  // eso es "una encima de otra". Las mesas contiguas a 3-6 m son legítimas.
  const a = metRing(ringA), b = metRing(ringB);
  const ca = [a.reduce((s, p) => s + p[0], 0) / a.length, a.reduce((s, p) => s + p[1], 0) / a.length];
  const cb = [b.reduce((s, p) => s + p[0], 0) / b.length, b.reduce((s, p) => s + p[1], 0) / b.length];
  const d = Math.hypot(ca[0] - cb[0], ca[1] - cb[1]);
  // Además, que realmente se intersecten los polígonos.
  const int = pointInPoly(a[0], b) || pointInPoly(a[1], b) || pointInPoly(a[2], b) || pointInPoly(b[0], a);
  return d < 3.5 && int;
}
function metRing(ring) {
  return ring.map((p) => [(p[0] - ORIGIN.lng) * M_LNG, (p[1] - ORIGIN.lat) * M_LAT]);
}
function pointInPoly(pt, poly) {
  let inside = false; const n = poly.length; let j = n - 1;
  for (let i = 0; i < n; i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if ((yi > pt[1]) !== (yj > pt[1]) && pt[0] < (xj - xi) * (pt[1] - yi) / (yj - yi) + xi) inside = !inside;
    j = i;
  }
  return inside;
}
let separadas = 0;
for (let pass = 0; pass < 12; pass++) {
  let movidos = 0;
  for (let i = 0; i < keys.length; i++) {
    for (let j = i + 1; j < keys.length; j++) {
      const a = out[keys[i]], b = out[keys[j]];
      if (!overlapM(a.ring, b.ring)) continue;
      const [ux, uy] = orientDeg(a.orientacion ?? 0);
      // desplazar b 1 m a lo largo del eje (dir. alterna)
      const dx = ux * 1.0 * ((i + j) % 2 ? 1 : -1);
      const dy = uy * 1.0 * ((i + j) % 2 ? 1 : -1);
      b.ring = b.ring.map((p) => [r6(p[0] + dx / M_LNG), r6(p[1] + dy / M_LAT)]);
      b.samples = b.samples.map((p) => [r6(p[0] + dx / M_LNG), r6(p[1] + dy / M_LAT)]);
      out[keys[j]] = b;
      movidos++; separadas++;
    }
  }
  if (movidos === 0) break;
}
// ---- RESCATE: huellas cuyas 4 muestras caen DENTRO de un edificio ----
// Con el offset adaptativo deberian ser pocas, pero quedan las de plazas y
// esquinas raras. Buscamos el desplazamiento minimo (16 direcciones, pasos de
// 0,5 m hasta 8 m) que saque las 4 muestras a la calle. Si no hay, se deja igual.
const TILE_DEG = 0.012;
const tilesBld = new Map();
function edificiosCerca(lat, lng) {
  const row = Math.floor(lat / TILE_DEG), col = Math.floor(lng / TILE_DEG);
  const acc = [];
  for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
    const k = `${row + dr}_${col + dc}`;
    if (!tilesBld.has(k)) {
      try { tilesBld.set(k, readTile(resolve(ROOT, 'public', 'buildings', k + '.bin'))); }
      catch { tilesBld.set(k, []); }
    }
    acc.push(...tilesBld.get(k));
  }
  return acc;
}
function dentroDeEdificio(lng, lat, blds) {
  for (const b of blds) {
    const ring = b.ring;
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const xi = ring[i][0], yi = ring[i][1], xj = ring[j][0], yj = ring[j][1];
      if ((yi > lat) !== (yj > lat) && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
    }
    if (inside) return true;
  }
  return false;
}
let rescatadas = 0, irrescatables = 0;
for (const k of keys) {
  const h = out[k];
  const [clng, clat] = cenRing(h.ring);
  const blds = edificiosCerca(clat, clng);
  if (!blds.length) continue;
  const todasDentro = h.samples.every(([lng, lat]) => dentroDeEdificio(lng, lat, blds));
  if (!todasDentro) continue;
  let elegido = null;
  for (let r = 0.5; r <= 8.001 && !elegido; r += 0.5) {
    for (let a = 0; a < 16; a++) {
      const ang = (a * Math.PI) / 8;
      const dx = Math.cos(ang) * r, dy = Math.sin(ang) * r;
      const ok2 = h.samples.every(([lng, lat]) => !dentroDeEdificio(lng + dx / M_LNG, lat + dy / M_LAT, blds));
      if (ok2) { elegido = { dx, dy }; break; }
    }
  }
  if (elegido) {
    h.ring = h.ring.map((p) => [r6(p[0] + elegido.dx / M_LNG), r6(p[1] + elegido.dy / M_LAT)]);
    h.samples = h.samples.map((p) => [r6(p[0] + elegido.dx / M_LNG), r6(p[1] + elegido.dy / M_LAT)]);
    out[k] = h;
    rescatadas++;
  } else {
    irrescatables++;
  }
}
console.log('[huellas] ' + ok + ' huellas, ' + sinVia + ' sin via cercana, ' + separadas + ' separadas de solape, ' + rescatadas + ' rescatadas de edificio, ' + irrescatables + ' sin salida -> ' + OUT);

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, JSON.stringify(out));
console.log('[huellas] Escrito -> ' + OUT);

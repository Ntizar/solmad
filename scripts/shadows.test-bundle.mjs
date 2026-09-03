var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __commonJS = (cb, mod) => function __require() {
  return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));

// node_modules/suncalc/suncalc.js
var require_suncalc = __commonJS({
  "node_modules/suncalc/suncalc.js"(exports, module) {
    (function() {
      "use strict";
      var PI = Math.PI, sin = Math.sin, cos = Math.cos, tan = Math.tan, asin = Math.asin, atan = Math.atan2, acos = Math.acos, rad = PI / 180;
      var dayMs = 1e3 * 60 * 60 * 24, J1970 = 2440588, J2000 = 2451545;
      function toJulian(date) {
        return date.valueOf() / dayMs - 0.5 + J1970;
      }
      function fromJulian(j) {
        return new Date((j + 0.5 - J1970) * dayMs);
      }
      function toDays(date) {
        return toJulian(date) - J2000;
      }
      var e = rad * 23.4397;
      function rightAscension(l, b) {
        return atan(sin(l) * cos(e) - tan(b) * sin(e), cos(l));
      }
      function declination(l, b) {
        return asin(sin(b) * cos(e) + cos(b) * sin(e) * sin(l));
      }
      function azimuth(H, phi, dec) {
        return atan(sin(H), cos(H) * sin(phi) - tan(dec) * cos(phi));
      }
      function altitude(H, phi, dec) {
        return asin(sin(phi) * sin(dec) + cos(phi) * cos(dec) * cos(H));
      }
      function siderealTime(d, lw) {
        return rad * (280.16 + 360.9856235 * d) - lw;
      }
      function astroRefraction(h) {
        if (h < 0)
          h = 0;
        return 2967e-7 / Math.tan(h + 312536e-8 / (h + 0.08901179));
      }
      function solarMeanAnomaly(d) {
        return rad * (357.5291 + 0.98560028 * d);
      }
      function eclipticLongitude(M) {
        var C = rad * (1.9148 * sin(M) + 0.02 * sin(2 * M) + 3e-4 * sin(3 * M)), P = rad * 102.9372;
        return M + C + P + PI;
      }
      function sunCoords(d) {
        var M = solarMeanAnomaly(d), L = eclipticLongitude(M);
        return {
          dec: declination(L, 0),
          ra: rightAscension(L, 0)
        };
      }
      var SunCalc2 = {};
      SunCalc2.getPosition = function(date, lat, lng) {
        var lw = rad * -lng, phi = rad * lat, d = toDays(date), c = sunCoords(d), H = siderealTime(d, lw) - c.ra;
        return {
          azimuth: azimuth(H, phi, c.dec),
          altitude: altitude(H, phi, c.dec)
        };
      };
      var times = SunCalc2.times = [
        [-0.833, "sunrise", "sunset"],
        [-0.3, "sunriseEnd", "sunsetStart"],
        [-6, "dawn", "dusk"],
        [-12, "nauticalDawn", "nauticalDusk"],
        [-18, "nightEnd", "night"],
        [6, "goldenHourEnd", "goldenHour"]
      ];
      SunCalc2.addTime = function(angle, riseName, setName) {
        times.push([angle, riseName, setName]);
      };
      var J0 = 9e-4;
      function julianCycle(d, lw) {
        return Math.round(d - J0 - lw / (2 * PI));
      }
      function approxTransit(Ht, lw, n) {
        return J0 + (Ht + lw) / (2 * PI) + n;
      }
      function solarTransitJ(ds, M, L) {
        return J2000 + ds + 53e-4 * sin(M) - 69e-4 * sin(2 * L);
      }
      function hourAngle(h, phi, d) {
        return acos((sin(h) - sin(phi) * sin(d)) / (cos(phi) * cos(d)));
      }
      function observerAngle(height) {
        return -2.076 * Math.sqrt(height) / 60;
      }
      function getSetJ(h, lw, phi, dec, n, M, L) {
        var w = hourAngle(h, phi, dec), a = approxTransit(w, lw, n);
        return solarTransitJ(a, M, L);
      }
      SunCalc2.getTimes = function(date, lat, lng, height) {
        height = height || 0;
        var lw = rad * -lng, phi = rad * lat, dh = observerAngle(height), d = toDays(date), n = julianCycle(d, lw), ds = approxTransit(0, lw, n), M = solarMeanAnomaly(ds), L = eclipticLongitude(M), dec = declination(L, 0), Jnoon = solarTransitJ(ds, M, L), i, len, time, h0, Jset, Jrise;
        var result = {
          solarNoon: fromJulian(Jnoon),
          nadir: fromJulian(Jnoon - 0.5)
        };
        for (i = 0, len = times.length; i < len; i += 1) {
          time = times[i];
          h0 = (time[0] + dh) * rad;
          Jset = getSetJ(h0, lw, phi, dec, n, M, L);
          Jrise = Jnoon - (Jset - Jnoon);
          result[time[1]] = fromJulian(Jrise);
          result[time[2]] = fromJulian(Jset);
        }
        return result;
      };
      function moonCoords(d) {
        var L = rad * (218.316 + 13.176396 * d), M = rad * (134.963 + 13.064993 * d), F = rad * (93.272 + 13.22935 * d), l = L + rad * 6.289 * sin(M), b = rad * 5.128 * sin(F), dt = 385001 - 20905 * cos(M);
        return {
          ra: rightAscension(l, b),
          dec: declination(l, b),
          dist: dt
        };
      }
      SunCalc2.getMoonPosition = function(date, lat, lng) {
        var lw = rad * -lng, phi = rad * lat, d = toDays(date), c = moonCoords(d), H = siderealTime(d, lw) - c.ra, h = altitude(H, phi, c.dec), pa = atan(sin(H), tan(phi) * cos(c.dec) - sin(c.dec) * cos(H));
        h = h + astroRefraction(h);
        return {
          azimuth: azimuth(H, phi, c.dec),
          altitude: h,
          distance: c.dist,
          parallacticAngle: pa
        };
      };
      SunCalc2.getMoonIllumination = function(date) {
        var d = toDays(date || /* @__PURE__ */ new Date()), s = sunCoords(d), m = moonCoords(d), sdist = 149598e3, phi = acos(sin(s.dec) * sin(m.dec) + cos(s.dec) * cos(m.dec) * cos(s.ra - m.ra)), inc = atan(sdist * sin(phi), m.dist - sdist * cos(phi)), angle = atan(cos(s.dec) * sin(s.ra - m.ra), sin(s.dec) * cos(m.dec) - cos(s.dec) * sin(m.dec) * cos(s.ra - m.ra));
        return {
          fraction: (1 + cos(inc)) / 2,
          phase: 0.5 + 0.5 * inc * (angle < 0 ? -1 : 1) / Math.PI,
          angle
        };
      };
      function hoursLater(date, h) {
        return new Date(date.valueOf() + h * dayMs / 24);
      }
      SunCalc2.getMoonTimes = function(date, lat, lng, inUTC) {
        var t = new Date(date);
        if (inUTC) t.setUTCHours(0, 0, 0, 0);
        else t.setHours(0, 0, 0, 0);
        var hc = 0.133 * rad, h0 = SunCalc2.getMoonPosition(t, lat, lng).altitude - hc, h1, h2, rise, set, a, b, xe, ye, d, roots, x1, x2, dx;
        for (var i = 1; i <= 24; i += 2) {
          h1 = SunCalc2.getMoonPosition(hoursLater(t, i), lat, lng).altitude - hc;
          h2 = SunCalc2.getMoonPosition(hoursLater(t, i + 1), lat, lng).altitude - hc;
          a = (h0 + h2) / 2 - h1;
          b = (h2 - h0) / 2;
          xe = -b / (2 * a);
          ye = (a * xe + b) * xe + h1;
          d = b * b - 4 * a * h1;
          roots = 0;
          if (d >= 0) {
            dx = Math.sqrt(d) / (Math.abs(a) * 2);
            x1 = xe - dx;
            x2 = xe + dx;
            if (Math.abs(x1) <= 1) roots++;
            if (Math.abs(x2) <= 1) roots++;
            if (x1 < -1) x1 = x2;
          }
          if (roots === 1) {
            if (h0 < 0) rise = i + x1;
            else set = i + x1;
          } else if (roots === 2) {
            rise = i + (ye < 0 ? x2 : x1);
            set = i + (ye < 0 ? x1 : x2);
          }
          if (rise && set) break;
          h0 = h2;
        }
        var result = {};
        if (rise) result.rise = hoursLater(t, rise);
        if (set) result.set = hoursLater(t, set);
        if (!rise && !set) result[ye > 0 ? "alwaysUp" : "alwaysDown"] = true;
        return result;
      };
      if (typeof exports === "object" && typeof module !== "undefined") module.exports = SunCalc2;
      else if (typeof define === "function" && define.amd) define(SunCalc2);
      else window.SunCalc = SunCalc2;
    })();
  }
});

// scripts/comlink-shim.mjs
function expose(api2) {
  globalThis.__solmadTestAPI = api2;
}
var proxyMarker = Symbol("proxyMarker");

// src/workers/shadows.worker.ts
var import_suncalc = __toESM(require_suncalc(), 1);
var M_PER_DEG_LAT = 111320;
var RAY_LEN_M = 380;
var STEP_MIN = 12;
var RIBBON_STEP_MIN = 30;
var FACADE_SEARCH_M = 95;
function mPerDegLng(lat) {
  return 111320 * Math.cos(lat * Math.PI / 180);
}
var SegIndex = class {
  cell = 60;
  grid = /* @__PURE__ */ new Map();
  originLng = 0;
  originLat = 0;
  mLng = 1;
  tagCounter = 0;
  visitToken = 0;
  minX = Infinity;
  maxX = -Infinity;
  minY = Infinity;
  maxY = -Infinity;
  build(buildings, originLng, originLat) {
    this.originLng = originLng;
    this.originLat = originLat;
    this.mLng = mPerDegLng(originLat);
    this.grid.clear();
    this.minX = Infinity;
    this.maxX = -Infinity;
    this.minY = Infinity;
    this.maxY = -Infinity;
    for (const b of buildings) {
      const r = b.ring;
      for (let i = 0; i < r.length - 1; i++) {
        const [ax, ay] = this.toM(r[i][0], r[i][1]);
        const [bx, by] = this.toM(r[i + 1][0], r[i + 1][1]);
        this.indexSeg({ ax, ay, bx, by, h: b.height, tag: 0 });
      }
    }
  }
  toM(lng, lat) {
    return [(lng - this.originLng) * this.mLng, (lat - this.originLat) * M_PER_DEG_LAT];
  }
  indexSeg(s) {
    const minX = Math.min(s.ax, s.bx), maxX = Math.max(s.ax, s.bx);
    const minY = Math.min(s.ay, s.by), maxY = Math.max(s.ay, s.by);
    this.minX = Math.min(this.minX, minX);
    this.maxX = Math.max(this.maxX, maxX);
    this.minY = Math.min(this.minY, minY);
    this.maxY = Math.max(this.maxY, maxY);
    const c = this.cell;
    for (let cx = Math.floor(minX / c); cx <= Math.floor(maxX / c); cx++) {
      for (let cy = Math.floor(minY / c); cy <= Math.floor(maxY / c); cy++) {
        const k = cx + "," + cy;
        let arr = this.grid.get(k);
        if (!arr) {
          arr = [];
          this.grid.set(k, arr);
        }
        arr.push(s);
      }
    }
  }
  /** Itera segmentos a lo largo del rayo evitando Set: marcado con visitToken. */
  forEachAlongRay(ox, oy, dx, dy, len, fn) {
    const c = this.cell;
    const token = ++this.visitToken;
    const steps = Math.ceil(len / (c * 0.5));
    for (let i = 0; i <= steps; i++) {
      const t = i * len / steps;
      const x = ox + dx * t, y = oy + dy * t;
      const cx = Math.floor(x / c), cy = Math.floor(y / c);
      for (let nx = cx - 1; nx <= cx + 1; nx++) {
        for (let ny = cy - 1; ny <= cy + 1; ny++) {
          const arr = this.grid.get(nx + "," + ny);
          if (!arr) continue;
          for (const s of arr) {
            if (s.tag === token) continue;
            s.tag = token;
            if (fn(s) === true) return;
          }
        }
      }
    }
  }
  nearestSegment(ox, oy, radius) {
    if (!this.hasCoverage(ox, oy, radius)) return null;
    const c = this.cell;
    const cells = Math.ceil(radius / c);
    const baseCx = Math.floor(ox / c), baseCy = Math.floor(oy / c);
    const token = ++this.visitToken;
    let best = null;
    for (let dx = -cells; dx <= cells; dx++) {
      for (let dy = -cells; dy <= cells; dy++) {
        const arr = this.grid.get(baseCx + dx + "," + (baseCy + dy));
        if (!arr) continue;
        for (const seg of arr) {
          if (seg.tag === token) continue;
          seg.tag = token;
          const p = closestPointOnSeg(ox, oy, seg);
          if (p.dist > radius) continue;
          if (!best || p.dist < best.dist) best = { seg, ...p };
        }
      }
    }
    return best;
  }
  hasCoverage(ox, oy, margin) {
    return Number.isFinite(this.minX) && ox >= this.minX - margin && ox <= this.maxX + margin && oy >= this.minY - margin && oy <= this.maxY + margin;
  }
};
var index = null;
var huellas = null;
function closestPointOnSeg(px, py, s) {
  const vx = s.bx - s.ax, vy = s.by - s.ay;
  const len2 = vx * vx + vy * vy;
  if (len2 <= 1e-9) {
    const d = Math.hypot(px - s.ax, py - s.ay);
    return { dist: d, px: s.ax, py: s.ay };
  }
  const raw = ((px - s.ax) * vx + (py - s.ay) * vy) / len2;
  const t = Math.max(0, Math.min(1, raw));
  const qx = s.ax + vx * t, qy = s.ay + vy * t;
  return { dist: Math.hypot(px - qx, py - qy), px: qx, py: qy };
}
function segIntersectRay(ox, oy, dx, dy, len, s) {
  const r2x = s.bx - s.ax, r2y = s.by - s.ay;
  const denom = dx * r2y - dy * r2x;
  if (Math.abs(denom) < 1e-9) return null;
  const sx = s.ax - ox, sy = s.ay - oy;
  const t = (sx * r2y - sy * r2x) / denom;
  const u = (sx * dy - sy * dx) / denom;
  if (t < 0 || t > len || u < 0 || u > 1) return null;
  return t;
}
function isSunlit(originX, originY, azDeg, altDeg) {
  if (altDeg <= 0) return false;
  if (!index || index.grid.size === 0) return false;
  const a = azDeg * Math.PI / 180;
  const dx = Math.sin(a), dy = Math.cos(a);
  const tanAlt = Math.tan(altDeg * Math.PI / 180);
  let blocked = false;
  index.forEachAlongRay(originX, originY, dx, dy, RAY_LEN_M, (s) => {
    const t = segIntersectRay(originX, originY, dx, dy, RAY_LEN_M, s);
    if (t === null) return;
    if (s.h > t * tanAlt + 0.5) {
      blocked = true;
      return true;
    }
  });
  return !blocked;
}
function sunPos(when, lat, lng) {
  const p = import_suncalc.default.getPosition(when, lat, lng);
  const az = (p.azimuth * 180 / Math.PI + 180 + 360) % 360;
  const al = p.altitude * 180 / Math.PI;
  return { az, al };
}
function facadeLitAt(ox, oy, azDeg, altDeg) {
  if (altDeg <= 0) return false;
  const idx = index;
  if (!idx || idx.grid.size === 0) return null;
  if (!idx.hasCoverage(ox, oy, FACADE_SEARCH_M)) return null;
  const nearest = idx.nearestSegment(ox, oy, FACADE_SEARCH_M);
  if (!nearest) return true;
  const a = azDeg * Math.PI / 180;
  const sunX = Math.sin(a), sunY = Math.cos(a);
  let faceX = ox - nearest.px;
  let faceY = oy - nearest.py;
  let faceLen = Math.hypot(faceX, faceY);
  if (faceLen < 0.75) {
    faceX = ox - (nearest.seg.ax + nearest.seg.bx) / 2;
    faceY = oy - (nearest.seg.ay + nearest.seg.by) / 2;
    faceLen = Math.hypot(faceX, faceY);
  }
  if (faceLen < 0.75) return null;
  faceX /= faceLen;
  faceY /= faceLen;
  const dot = faceX * sunX + faceY * sunY;
  const tanAlt = Math.tan(Math.max(altDeg, 1) * Math.PI / 180);
  const shadowLen = nearest.seg.h / tanAlt;
  if (dot > 0.08) return true;
  if (dot < -0.08) return nearest.dist > shadowLen + 4;
  if (altDeg < 35 && nearest.dist < shadowLen * 0.45) return false;
  return true;
}
function facadeStateForOne(t, when) {
  const { az: azNow, al: altNow } = sunPos(when, t.lat, t.lng);
  const idx = index;
  const [ox, oy] = idx ? idx.toM(t.lng, t.lat) : [0, 0];
  const nowLit = facadeLitAt(ox, oy, azNow, altNow);
  const sunNow = nowLit === true;
  let minutesLeft = 0;
  let directMinutes = 0;
  let directOpen = sunNow;
  const times = import_suncalc.default.getTimes(when, t.lat, t.lng);
  const sunset = times.sunset;
  if (sunset && when < sunset) {
    for (let ts = when.getTime(); ts < sunset.getTime(); ts += STEP_MIN * 6e4) {
      const s = sunPos(new Date(ts), t.lat, t.lng);
      const lit = facadeLitAt(ox, oy, s.az, s.al) === true;
      if (lit) minutesLeft += STEP_MIN;
      if (directOpen && lit) directMinutes += STEP_MIN;
      else directOpen = false;
    }
  }
  return { sunNow, altitudeDeg: altNow, azimuthDeg: azNow, minutesLeft, directMinutes };
}
var api = {
  setBuildings(buildings, originLng, originLat) {
    index = new SegIndex();
    index.build(buildings, originLng, originLat);
    return { segments: [...index.grid.values()].reduce((a, b) => a + b.length, 0) };
  },
  /** Registra las huellas (fase 1). Cada huella trae ring + samples grid 2x2. */
  setHuellas(data) {
    huellas = /* @__PURE__ */ new Map();
    for (const [id, h] of Object.entries(data)) {
      if (h?.samples?.length) huellas.set(Number(id), h);
    }
    return { count: huellas.size };
  },
  /**
   * MOTOR v2: como computeFor pero por huella. Para cada terraza evalúa sus
   * 4 muestras y devuelve sunNow como % de superficie soleada (sunNowPct
   * 0..100). sunNow sigue siendo booleano para compatibilidad: true si >=25%.
   */
  computeForHuellas(terrazas, whenIso) {
    const when = new Date(whenIso);
    const results = new Array(terrazas.length);
    const idx = index;
    const ref = terrazas[0];
    const times = ref ? import_suncalc.default.getTimes(when, ref.lat, ref.lng) : null;
    const sunset = times?.sunset;
    const slots = [];
    if (sunset && when < sunset && ref) {
      const end = sunset.getTime();
      for (let ts = when.getTime(); ts < end; ts += STEP_MIN * 6e4) {
        slots.push(sunPos(new Date(ts), ref.lat, ref.lng));
      }
    }
    for (let i = 0; i < terrazas.length; i++) {
      const t = terrazas[i];
      const h = huellas?.get(t.id);
      const pts = h ? h.samples.map((s) => idx ? idx.toM(s[0], s[1]) : [0, 0]) : [[0, 0]];
      const { az: azNow, al: altNow } = sunPos(when, t.lat, t.lng);
      let litNow = 0;
      if (altNow > 0) {
        if (!idx || idx.grid.size === 0) {
          litNow = 3;
        } else {
          for (const p of pts) if (isSunlit(p[0], p[1], azNow, altNow)) litNow++;
          litNow = Math.round(litNow / pts.length * 100);
        }
      }
      const sunNow = litNow === 3 ? false : litNow >= 25;
      let minutesLeft = 0;
      let directMinutes = 0;
      let directOpen = sunNow;
      for (const s of slots) {
        if (s.al <= 0) continue;
        let lit = 0;
        if (idx && idx.grid.size > 0) {
          for (const p of pts) if (isSunlit(p[0], p[1], s.az, s.al)) lit++;
          lit = Math.round(lit / pts.length * 100);
        }
        const soleada = lit >= 25;
        if (soleada) minutesLeft += STEP_MIN;
        if (directOpen && soleada) directMinutes += STEP_MIN;
        else directOpen = false;
      }
      results[i] = {
        sunNow,
        sunNowPct: litNow === 3 ? void 0 : litNow,
        altitudeDeg: altNow,
        azimuthDeg: azNow,
        minutesLeft,
        directMinutes
      };
    }
    return results;
  },
  /** Quick masivo por huella: solo el % ahora. Estados 0=sombra 1=sol 2=noche 3=pendiente. */
  quickForHuellas(terrazas, whenIso) {
    const when = new Date(whenIso);
    const out = new Uint8Array(terrazas.length);
    const idx = index;
    const noBuildings = !idx || idx.grid.size === 0;
    for (let i = 0; i < terrazas.length; i++) {
      const t = terrazas[i];
      const { az, al } = sunPos(when, t.lat, t.lng);
      if (al <= 0) {
        out[i] = 2;
        continue;
      }
      if (noBuildings) {
        out[i] = 3;
        continue;
      }
      const h = huellas?.get(t.id);
      if (!h) {
        out[i] = 3;
        continue;
      }
      let lit = 0;
      for (const s of h.samples) {
        const [ox, oy] = idx.toM(s[0], s[1]);
        if (isSunlit(ox, oy, az, al)) lit++;
      }
      out[i] = lit / h.samples.length >= 0.25 ? 1 : 0;
    }
    return out;
  },
  /** Bulk: estado actual + minutos restantes hasta el ocaso (sin ribbon, lazy). */
  computeFor(terrazas, whenIso) {
    const when = new Date(whenIso);
    const results = new Array(terrazas.length);
    const ref = terrazas[0];
    const times = ref ? import_suncalc.default.getTimes(when, ref.lat, ref.lng) : null;
    const sunset = times?.sunset;
    const slots = [];
    if (sunset && when < sunset && ref) {
      const end = sunset.getTime();
      for (let ts = when.getTime(); ts < end; ts += STEP_MIN * 6e4) {
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
  computeSubset(terrazas, whenIso) {
    return api.computeFor(terrazas, whenIso);
  },
  /** Estado rapido y estable: orientacion respecto al edificio mas cercano. */
  facadeStateFor(terrazas, whenIso) {
    const when = new Date(whenIso);
    return terrazas.map((t) => facadeStateForOne(t, when));
  },
  /** Ribbon de 48 medias horas para una sola terraza. */
  ribbonFor(t, whenIso) {
    const when = new Date(whenIso);
    const idx = index;
    const [ox, oy] = idx ? idx.toM(t.lng, t.lat) : [0, 0];
    const ribbon = new Array(48);
    const day = new Date(when);
    day.setHours(0, 0, 0, 0);
    for (let k = 0; k < 48; k++) {
      const d = new Date(day.getTime() + k * RIBBON_STEP_MIN * 6e4);
      const { az, al } = sunPos(d, t.lat, t.lng);
      if (al <= 0) ribbon[k] = 2;
      else {
        const lit = facadeLitAt(ox, oy, az, al);
        ribbon[k] = lit === true ? 1 : 0;
      }
    }
    return ribbon;
  },
  /** Estado de un único punto arbitrario (p. ej. la ubicación del usuario). */
  pointAt(lat, lng, whenIso) {
    const when = new Date(whenIso);
    const idx = index;
    const [ox, oy] = idx ? idx.toM(lng, lat) : [0, 0];
    const { az, al } = sunPos(when, lat, lng);
    const sunNow = facadeLitAt(ox, oy, az, al) === true;
    let directMinutes = 0;
    if (sunNow) {
      const times = import_suncalc.default.getTimes(when, lat, lng);
      const sunset = times.sunset;
      if (sunset && when < sunset) {
        const end = sunset.getTime();
        for (let ts = when.getTime(); ts < end; ts += STEP_MIN * 6e4) {
          const s = sunPos(new Date(ts), lat, lng);
          if (s.al > 0 && facadeLitAt(ox, oy, s.az, s.al) === true) directMinutes += STEP_MIN;
          else break;
        }
      }
    }
    return { sunNow, altitudeDeg: al, azimuthDeg: az, directMinutes };
  },
  /** Quick: sólo sunNow. Estados: 0=sombra, 1=sol, 2=noche, 3=pendiente (sin edificios). */
  quickFor(terrazas, whenIso) {
    const when = new Date(whenIso);
    const out = new Uint8Array(terrazas.length);
    const idx = index;
    const noBuildings = !idx || idx.grid.size === 0;
    for (let i = 0; i < terrazas.length; i++) {
      const t = terrazas[i];
      const { az, al } = sunPos(when, t.lat, t.lng);
      if (al <= 0) {
        out[i] = 2;
        continue;
      }
      if (noBuildings) {
        out[i] = 3;
        continue;
      }
      const [ox, oy] = idx.toM(t.lng, t.lat);
      out[i] = isSunlit(ox, oy, az, al) ? 1 : 0;
    }
    return out;
  },
  /** Quick principal: fachada del edificio mas cercano. Estados: 0=sombra, 1=sol, 2=noche, 3=pendiente. */
  facadeQuickFor(terrazas, whenIso) {
    const when = new Date(whenIso);
    const out = new Uint8Array(terrazas.length);
    const idx = index;
    const noBuildings = !idx || idx.grid.size === 0;
    for (let i = 0; i < terrazas.length; i++) {
      const t = terrazas[i];
      const { az, al } = sunPos(when, t.lat, t.lng);
      if (al <= 0) {
        out[i] = 2;
        continue;
      }
      if (noBuildings) {
        out[i] = 3;
        continue;
      }
      const [ox, oy] = idx.toM(t.lng, t.lat);
      const lit = facadeLitAt(ox, oy, az, al);
      out[i] = lit == null ? 3 : lit ? 1 : 0;
    }
    return out;
  },
  /** Heurística rápida basada en orientación y bbox de edificios cercanos.
   *  Para cada terraza estima sol/sombra mirando si hay edificios altos en el azimut del sol.
   *  Mucho más rápido que el rayo real, pero buena aproximación inicial. */
  heuristicFor(terrazas, whenIso) {
    return api.facadeQuickFor(terrazas, whenIso);
  }
};
expose(api);

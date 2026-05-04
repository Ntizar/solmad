#!/usr/bin/env node
// Precalcula la posición solar (azimut, altitud) en el centro de Madrid
// cada 15 min para HOY y MAÑANA. La diferencia angular en toda la ciudad es <0.1°,
// así que con una sola tabla todas las terrazas tienen su "calendario solar" listo
// y el cliente solo recalcula sombras (raycasting con edificios) cuando hace falta.
//
// Salida: public/solar-day.json
// {
//   "version": "2025-05-04",
//   "tz": "Europe/Madrid",
//   "centerLat": 40.4168,
//   "centerLng": -3.7038,
//   "stepMinutes": 15,
//   "days": [
//     { "date": "2025-05-04", "sunrise": "07:01", "sunset": "21:23",
//       "samples": [ { "t": "00:00", "az": -179.2, "al": -54.3 }, ... ] },
//     { "date": "2025-05-05", ... }
//   ]
// }
import SunCalc from 'suncalc';
import { writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_PATH = resolve(__dirname, '..', 'public', 'solar-day.json');
const CENTER_LAT = 40.4168;
const CENTER_LNG = -3.7038;
const STEP_MIN = 15;

function pad(n) { return String(n).padStart(2, '0'); }
function toMadridYMD(d) {
  // Devuelve YYYY-MM-DD según hora civil de Madrid
  const fmt = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Madrid', year: 'numeric', month: '2-digit', day: '2-digit' });
  return fmt.format(d);
}
function toMadridHM(d) {
  const fmt = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Madrid', hour: '2-digit', minute: '2-digit', hour12: false });
  return fmt.format(d);
}

/** Devuelve un Date que representa "ese YYYY-MM-DD a las 00:00 hora Madrid". */
function startOfMadridDay(ymd) {
  // Truco: probamos hora UTC mínima y avanzamos hasta que la representación Madrid del día coincida.
  // Suficiente para uso en una Action.
  const [y, m, d] = ymd.split('-').map(Number);
  // Madrid UTC offset varía por DST; arrancamos a las 22:00 UTC del día previo y buscamos.
  let probe = new Date(Date.UTC(y, m - 1, d - 1, 22, 0, 0));
  for (let i = 0; i < 6; i++) {
    if (toMadridYMD(probe) === ymd && toMadridHM(probe) === '00:00') return probe;
    probe = new Date(probe.getTime() + 60 * 60 * 1000);
  }
  // Fallback: medianoche local del runner (no ideal, pero defensivo)
  return new Date(Date.UTC(y, m - 1, d, 0, 0, 0));
}

function sampleDay(ymd) {
  const start = startOfMadridDay(ymd);
  const sun = SunCalc.getTimes(start, CENTER_LAT, CENTER_LNG);
  const samples = [];
  const slots = (24 * 60) / STEP_MIN;
  for (let i = 0; i < slots; i++) {
    const t = new Date(start.getTime() + i * STEP_MIN * 60 * 1000);
    const pos = SunCalc.getPosition(t, CENTER_LAT, CENTER_LNG);
    // SunCalc: azimuth medido desde sur, sentido horario, en radianes; convertimos a "azimut desde norte" (0..360)
    const azFromSouth = pos.azimuth * 180 / Math.PI;
    let az = (azFromSouth + 180) % 360;
    if (az < 0) az += 360;
    const al = pos.altitude * 180 / Math.PI;
    samples.push({
      t: toMadridHM(t),
      az: Math.round(az * 10) / 10,
      al: Math.round(al * 10) / 10,
    });
  }
  return {
    date: ymd,
    sunrise: sun.sunrise && !Number.isNaN(sun.sunrise.getTime()) ? toMadridHM(sun.sunrise) : null,
    sunset: sun.sunset && !Number.isNaN(sun.sunset.getTime()) ? toMadridHM(sun.sunset) : null,
    samples,
  };
}

function main() {
  const today = new Date();
  const ymd0 = toMadridYMD(today);
  // mañana en Madrid: sumamos 24h y recalculamos
  const ymd1 = toMadridYMD(new Date(today.getTime() + 26 * 60 * 60 * 1000));

  const payload = {
    version: ymd0,
    tz: 'Europe/Madrid',
    centerLat: CENTER_LAT,
    centerLng: CENTER_LNG,
    stepMinutes: STEP_MIN,
    days: [sampleDay(ymd0), sampleDay(ymd1)],
  };
  mkdirSync(dirname(OUT_PATH), { recursive: true });
  writeFileSync(OUT_PATH, JSON.stringify(payload));
  const size = (JSON.stringify(payload).length / 1024).toFixed(1);
  console.log(`[precompute-sun] ${ymd0} y ${ymd1} → ${OUT_PATH} (${size} KB, ${payload.days[0].samples.length} slots/día).`);
}

main();

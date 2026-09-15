// Lectura de los tiles estaticos de edificios (public/buildings/*.bin).
// Formato SMBD v1: ver scripts/build-buildings-tiles.mjs
import { readFileSync } from 'node:fs';

const M_LAT = 111320;
const mLngAt = (lat) => M_LAT * Math.cos((lat * Math.PI) / 180);

/** Lee un tile y devuelve edificios { ring: [[lng,lat]...], height }. */
export function readTile(path) {
  const buf = readFileSync(path);
  if (buf.toString('ascii', 0, 4) !== 'SMBD') throw new Error('Tile invalido: ' + path);
  let o = 4;
  const version = buf.readUInt8(o); o += 1;
  o += 1; // flags
  o += 2; // reservado
  const originLng = buf.readDoubleLE(o); o += 8;
  const originLat = buf.readDoubleLE(o); o += 8;
  const n = buf.readUInt32LE(o); o += 4;
  if (version !== 1) throw new Error('Version de tile no soportada: ' + version);
  const kx = mLngAt(originLat + 0.006); // misma latitud de escala que el encoder
  const out = [];
  for (let i = 0; i < n; i++) {
    const h = buf.readUInt8(o); o += 1;
    const npts = buf.readUInt8(o); o += 1;
    const ring = new Array(npts);
    for (let k = 0; k < npts; k++) {
      const x = buf.readUInt16LE(o); o += 2;
      const y = buf.readUInt16LE(o); o += 2;
      ring[k] = [originLng + (x / 10) / kx, originLat + (y / 10) / M_LAT];
    }
    out.push({ ring, height: h });
  }
  return out;
}

/** Clave de tile para unas coordenadas (misma rejilla que el encoder). */
export function tileKeyFor(lat, lng, size = 0.012) {
  return `${Math.floor(lat / size)}_${Math.floor(lng / size)}`;
}

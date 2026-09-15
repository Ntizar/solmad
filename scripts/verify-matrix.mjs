// Verificacion de public/solar-matrix.bin: empaquetado, curva diaria y
// comprobacion fisica con casos conocidos de Madrid.
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PUB = resolve(ROOT, 'public');

const buf = readFileSync(resolve(PUB, 'solar-matrix.bin'));
const meta = JSON.parse(readFileSync(resolve(PUB, 'solar-matrix.meta.json'), 'utf8'));
console.log('magic:', buf.toString('ascii', 0, 4), '| ver:', buf.readUInt8(4), '| step:', buf.readUInt8(5), '| slots:', buf.readUInt16LE(6), '| n:', buf.readUInt32LE(8), '| bytes:', buf.length);
const SLOT_COUNT = buf.readUInt16LE(6);
const STEP = buf.readUInt8(5);
const n = buf.readUInt32LE(8);
const ids = [];
for (let i = 0; i < n; i++) ids.push(buf.readUInt32LE(16 + i * 4));
const statesOff = 16 + n * 4;
const BYTES_PER = SLOT_COUNT / 4;
const stateOf = (idx, slot) => (buf[statesOff + idx * BYTES_PER + (slot >> 2)] >> ((slot & 3) * 2)) & 3;
console.log('ids ordenados:', ids[0], '...', ids[ids.length - 1], '| unicos:', new Set(ids).size, '| meta terrazas:', meta.terraces);

// curva diaria
const terrazas = JSON.parse(readFileSync(resolve(PUB, 'terrazas.min.json'), 'utf8'));
const byId = new Map(terrazas.map((t) => [t.id, t]));
console.log('\nslot  hora   sol%   sombra%  noche%');
for (let s = 0; s < SLOT_COUNT; s++) {
  let sol = 0, sombra = 0, noche = 0;
  for (let i = 0; i < n; i++) {
    const v = stateOf(i, s);
    if (v === 1) sol++; else if (v === 0) sombra++; else if (v === 2) noche++;
  }
  const hh = String(Math.floor((s * STEP) / 60)).padStart(2, '0') + ':' + String((s * STEP) % 60).padStart(2, '0');
  if (s % 2 === 0 || sol + sombra > 0) {
    const day = sol + sombra;
    console.log(`${String(s).padStart(4)}  ${hh}  ${(100 * sol / n).toFixed(1).padStart(5)}  ${(100 * sombra / n).toFixed(1).padStart(6)}  ${(100 * noche / n).toFixed(1).padStart(6)}`);
  }
}

// comprobacion de casos concretos
function ribbon(id) {
  const idx = ids.indexOf(id);
  if (idx < 0) return null;
  let out = '';
  for (let s = 0; s < SLOT_COUNT; s++) out += ['░', '█', '·', '?'][stateOf(idx, s)];
  return out;
}
const muestra = terrazas.filter((t) => t.ubicacion && /Plaza|peatonal|Parque/i.test(t.ubicacion)).slice(0, 3);
console.log('\nLeyenda: █ sol · ░ sombra · · noche');
for (const t of [...muestra, ...terrazas.slice(0, 2)]) {
  const r = ribbon(t.id);
  if (!r) continue;
  console.log(`${String(t.id).padStart(5)} ${(t.ubicacion || '-').padEnd(16).slice(0, 16)} ${(t.name || '').slice(0, 18).padEnd(18)} ${r}`);
}

// sol a mediodia solar (slot ~26 = 13:00) en plazas vs calles estrechas
const slotMediodia = Math.round((13 * 60) / STEP);
let plazasSol = 0, plazasTot = 0, callesSol = 0, callesTot = 0;
for (let i = 0; i < n; i++) {
  const t = byId.get(ids[i]);
  if (!t) continue;
  const v = stateOf(i, slotMediodia);
  if (/Plaza|peatonal|Parque|Paseo/i.test(t.ubicacion || '')) { plazasTot++; if (v === 1) plazasSol++; }
  else { callesTot++; if (v === 1) callesSol++; }
}
console.log(`\n13:00 -> plazas/peatonales con sol: ${(100 * plazasSol / Math.max(plazasTot, 1)).toFixed(1)}% (${plazasSol}/${plazasTot})`);
console.log(`13:00 -> resto (calles):        con sol: ${(100 * callesSol / Math.max(callesTot, 1)).toFixed(1)}% (${callesSol}/${callesTot})`);

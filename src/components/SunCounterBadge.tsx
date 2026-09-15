import { useEffect, useMemo, useState } from 'react';
import { useAppStore } from '../store/useAppStore';
import { countByState, loadSolarMatrix, loadSolarMatrixMeta, matrixCoversDate, slotForDate, type SolarMatrix, type SolarMatrixMeta } from '../lib/solarMatrix';

/**
 * Contador instantáneo de terrazas al sol, calculado con la MATRIZ PRECALCULADA.
 * No espera a edificios ni al worker: los números salen del fichero servido
 * (97 KB con las 6.200 terrazas x 48 franjas del día).
 */
export function SunCounterBadge() {
  const selectedDate = useAppStore((s) => s.selectedDate);
  const isLive = useAppStore((s) => s.isLive);
  const [matrix, setMatrix] = useState<SolarMatrix | null>(null);
  const [meta, setMeta] = useState<SolarMatrixMeta | null>(null);

  useEffect(() => {
    let cancel = false;
    loadSolarMatrix().then((m) => { if (!cancel) setMatrix(m); });
    loadSolarMatrixMeta().then((m) => { if (!cancel) setMeta(m); });
    return () => { cancel = true; };
  }, []);

  const counts = useMemo(() => {
    if (!matrix || !matrixCoversDate(matrix, selectedDate)) return null;
    return countByState(matrix, slotForDate(matrix, selectedDate));
  }, [matrix, selectedDate]);

  if (!matrix || !counts) return null;

  const mins = Math.round(matrix.stepMinutes * 1);
  const hora = new Intl.DateTimeFormat('es-ES', {
    timeZone: 'Europe/Madrid', hour: '2-digit', minute: '2-digit', hour12: false
  }).format(selectedDate);
  const dia = counts.sun + counts.shade;
  const esNoche = counts.sun === 0;
  const stale = meta ? meta.date !== madridYmd(new Date()) : false;

  return (
    <div
      className="fixed top-4 left-4 z-30 pointer-events-none select-none"
      title={`Calculado de antemano${meta ? ` (${meta.date})` : ''} · ${counts.total} terrazas · franja de ${mins} min`}
    >
      <div className="rounded-full bg-night-700/85 border border-white/10 backdrop-blur shadow-lg px-3 py-1.5 flex items-center gap-2">
        <span className="text-sun-300 text-sm leading-none">{esNoche ? '🌙' : '☀'}</span>
        {esNoche ? (
          <span className="text-[11px] sm:text-xs text-paper/85 font-display leading-none">
            Sin sol en Madrid · {hora}
          </span>
        ) : (
          <span className="text-[11px] sm:text-xs text-paper/90 font-display leading-none">
            <strong className="text-sun-200">{fmt(counts.sun)}</strong>
            <span className="text-paper/60"> de {fmt(dia)} terrazas al sol</span>
            <span className="text-paper/45"> · {hora}{isLive ? '' : ' ⏱'}</span>
          </span>
        )}
      </div>
      {stale && (
        <div className="mt-1 text-[9px] text-paper/45 pl-2 font-display leading-none">
          precalc {meta?.date}
        </div>
      )}
    </div>
  );
}

function fmt(n: number) {
  return new Intl.NumberFormat('es-ES').format(n);
}

function madridYmd(d: Date) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Madrid', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
}

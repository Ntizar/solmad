import { useEffect, useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useAppStore } from '../store/useAppStore';
import { flyToTerraza } from './MapView';

function fmtHM(min: number) {
  const h = Math.floor(min / 60), m = min % 60;
  if (!h) return `${m} min`;
  return `${h}h ${String(m).padStart(2, '0')}`;
}

function distMeters(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
  const R = 6371000;
  const dLat = (b.lat - a.lat) * Math.PI / 180;
  const dLng = (b.lng - a.lng) * Math.PI / 180;
  const lat1 = a.lat * Math.PI / 180, lat2 = b.lat * Math.PI / 180;
  const x = Math.sin(dLat/2)**2 + Math.cos(lat1)*Math.cos(lat2)*Math.sin(dLng/2)**2;
  return 2 * R * Math.asin(Math.sqrt(x));
}

export function SideList() {
  const terrazas = useAppStore((s) => s.terrazas);
  const sunStates = useAppStore((s) => s.sunStates);
  const filters = useAppStore((s) => s.filters);
  const setFilters = useAppStore((s) => s.setFilters);
  const setSelectedId = useAppStore((s) => s.setSelectedId);
  const userLocation = useAppStore((s) => s.userLocation);
  const vitaminaMode = useAppStore((s) => s.vitaminaMode);
  const setVitaminaMode = useAppStore((s) => s.setVitaminaMode);
  const [open, setOpen] = useState(false);

  // Cuando se activa vitaminaMode desde fuera, abrimos el panel automáticamente
  useEffect(() => {
    if (vitaminaMode) setOpen(true);
  }, [vitaminaMode]);

  const ready = sunStates.size > 0;

  const distritos = useMemo(() => {
    const set = new Set(terrazas.map((t) => t.distrito).filter(Boolean));
    return [...set].sort();
  }, [terrazas]);

  const filtered = useMemo(() => {
    const q = filters.query.trim().toLowerCase();
    return terrazas
      .map((t) => ({
        t,
        sun: sunStates.get(t.id),
        dist: userLocation ? distMeters(userLocation, { lat: t.lat, lng: t.lng }) : null,
      }))
      .filter(({ t, sun, dist }) => {
        if (vitaminaMode) {
          if (!sun || !sun.sunNow) return false;
          if (!sun.directMinutes || sun.directMinutes < 30) return false;
          if (dist != null && dist > 1500) return false; // 1.5 km
        }
        if (filters.distrito && t.distrito !== filters.distrito) return false;
        if (filters.minHours && (!sun || sun.minutesLeft < filters.minHours * 60)) return false;
        if (filters.onlyOpenNow && (!sun || !sun.sunNow)) return false;
        if (q && !t.name.toLowerCase().includes(q) && !t.via.toLowerCase().includes(q)) return false;
        return true;
      })
      .sort((a, b) => {
        if (vitaminaMode && userLocation) {
          // Orden: cerca primero entre los que ya tienen sol y ≥30min
          return (a.dist ?? Infinity) - (b.dist ?? Infinity);
        }
        const aw = (a.sun?.sunNow ? 1e6 : 0) + (a.sun?.sunNow ? a.sun.directMinutes : a.sun?.minutesLeft ?? 0);
        const bw = (b.sun?.sunNow ? 1e6 : 0) + (b.sun?.sunNow ? b.sun.directMinutes : b.sun?.minutesLeft ?? 0);
        return bw - aw;
      })
      .slice(0, 80);
  }, [terrazas, sunStates, filters, vitaminaMode, userLocation]);
  const pendingCount = Math.max(0, terrazas.length - sunStates.size);

  return (
    <>
      <button
        onClick={() => { if (vitaminaMode) setVitaminaMode(false); setOpen((v) => !v); }}
        className="fixed top-4 left-4 z-30 rounded-full bg-night-700/85 backdrop-blur border border-white/10 px-4 py-2 text-paper/90 hover:text-sun-300 transition shadow-xl flex items-center gap-2"
      >
        <span className="font-display text-sm sm:text-base">{open ? 'Cerrar' : 'Top sol ahora'}</span>
        {!open && ready && (
          <span className="text-[10px] uppercase tracking-widest text-sun-300">{filtered.length}</span>
        )}
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ x: -380, opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            exit={{ x: -380, opacity: 0 }}
            transition={{ type: 'spring', stiffness: 220, damping: 28 }}
            className="
              fixed z-30 top-0 left-0 h-full bg-night-700/95 backdrop-blur border-r border-white/10
              w-full sm:w-[360px] flex flex-col text-paper
            "
          >
            <div className="p-4 pt-5 border-b border-white/10 space-y-2">
              <div className="flex items-center justify-between">
                <h2 className="font-display text-2xl text-paper">
                  {vitaminaMode ? 'Vitamina D ya' : 'Top sol ahora'}
                </h2>
                <button
                  onClick={() => { setOpen(false); setVitaminaMode(false); }}
                  aria-label="Cerrar lista"
                  className="rounded-full w-10 h-10 grid place-items-center bg-white/10 hover:bg-white/20 text-paper text-xl leading-none"
                >×</button>
              </div>
              {vitaminaMode && (
                <div className="text-xs text-sun-300/90 italic">
                  Sol ahora · ≥30 min de sol restantes{userLocation ? ' · ordenado por distancia' : ''}.
                </div>
              )}
              <input
                value={filters.query}
                onChange={(e) => setFilters({ query: e.target.value })}
                placeholder="Buscar por local o calle…"
                className="w-full bg-white/5 rounded-xl px-4 py-3 text-paper placeholder-paper/40 outline-none focus:ring-2 focus:ring-sun-300"
              />
              <div className="flex gap-2">
                <select
                  value={filters.distrito ?? ''}
                  onChange={(e) => setFilters({ distrito: e.target.value || null })}
                  className="flex-1 bg-night-700 border border-white/10 rounded-xl px-3 py-2 text-paper/90 outline-none"
                >
                  <option value="">Todos los distritos</option>
                  {distritos.map((d) => <option key={d} value={d}>{d}</option>)}
                </select>
                <select
                  value={filters.minHours}
                  onChange={(e) => setFilters({ minHours: Number(e.target.value) })}
                  className="bg-night-700 border border-white/10 rounded-xl px-3 py-2 text-paper/90 outline-none"
                >
                  <option value={0}>Cualquier sol</option>
                  <option value={1}>≥ 1 h</option>
                  <option value={2}>≥ 2 h</option>
                  <option value={3}>≥ 3 h</option>
                </select>
              </div>
              <label className="flex items-center gap-2 text-sm text-paper/80">
                <input
                  type="checkbox"
                  checked={filters.onlyOpenNow}
                  onChange={(e) => setFilters({ onlyOpenNow: e.target.checked })}
                  className="accent-sun-300"
                />
                Sólo con sol ahora mismo
              </label>
              <p className="text-xs text-paper/60 italic">
                {ready ? `Calculado lo visible. El resto aparece al moverte por el mapa (${pendingCount} pendientes).` : 'Calculando terrazas visibles y cercanas…'}
              </p>
            </div>

            <ul className="flex-1 overflow-y-auto divide-y divide-white/5">
              {ready && filtered.length === 0 && (
                <li className="p-6 text-paper/60 text-sm">
                  {vitaminaMode
                    ? 'Aún no hay terrazas con ≥30 min de sol cerca. Mueve el mapa o prueba el modo normal.'
                    : 'Nada encaja con esos filtros. Prueba otra hora o distrito.'}
                </li>
              )}
              {filtered.map(({ t, sun, dist }) => {
                const sunny = sun?.sunNow;
                const min = sun ? (sunny ? sun.directMinutes : sun.minutesLeft) : 0;
                return (
                  <li key={t.id}>
                    <button
                      onClick={() => { setSelectedId(t.id); flyToTerraza(t); setOpen(false); setVitaminaMode(false); }}
                      className="w-full text-left p-4 hover:bg-white/5 transition flex items-center gap-3"
                    >
                      <div className="w-7 h-7 grid place-items-center shrink-0 text-base">
                        {sunny ? '☀' : sun ? '⛅' : '⏳'}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="font-display text-lg leading-tight truncate">{t.name}</div>
                        <div className="text-xs text-paper/60 truncate">
                          {t.via} {t.num} · {t.barrio}
                          {dist != null && (
                            <span className="text-paper/40"> · {dist < 1000 ? `${Math.round(dist)} m` : `${(dist/1000).toFixed(1)} km`}</span>
                          )}
                        </div>
                      </div>
                      <div className="text-right shrink-0">
                        {sun ? (
                          <>
                            <div className={`font-mono text-sm ${sunny ? 'text-sun-300' : 'text-paper/50'}`}>
                              {min > 0 ? fmtHM(min) : '—'}
                            </div>
                            <div className="text-[10px] text-paper/40 uppercase tracking-widest">
                              {sunny ? 'de sol' : 'restante hoy'}
                            </div>
                          </>
                        ) : (
                          <div className="text-[10px] text-paper/40">…</div>
                        )}
                      </div>
                    </button>
                  </li>
                );
              })}
            </ul>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}

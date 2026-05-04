import { motion } from 'framer-motion';
import { useAppStore } from '../store/useAppStore';
import { flyToTerraza } from './MapView';

function dist2(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
  const dx = a.lng - b.lng, dy = a.lat - b.lat;
  return dx * dx + dy * dy;
}

export function SurpriseButton() {
  const terrazas = useAppStore((s) => s.terrazas);
  const userLocation = useAppStore((s) => s.userLocation);
  const visibleIds = useAppStore((s) => s.visibleIds);
  const setSelectedId = useAppStore((s) => s.setSelectedId);

  async function surprise() {
    const visibleSet = new Set(visibleIds);
    let candidates = terrazas.filter((t) => visibleSet.has(t.id));
    if (candidates.length === 0) candidates = terrazas;
    if (candidates.length === 0) return;

    // No pedimos geolocalizacion desde Sorpresa: en iPhone puede bloquear permiso.
    const me = userLocation;

    let pick = candidates[0];
    if (me) {
      const sorted = [...candidates].sort((a, b) => dist2(a, me) - dist2(b, me));
      pick = sorted[Math.floor(Math.random() * Math.min(12, sorted.length))];
    } else {
      pick = candidates[Math.floor(Math.random() * candidates.length)];
    }

    setSelectedId(pick.id);
    flyToTerraza(pick);
  }

  return (
    <motion.button
      whileHover={{ scale: 1.03 }}
      whileTap={{ scale: 0.94 }}
      onClick={surprise}
      className="
        fixed top-4 right-4 z-30
        rounded-full bg-sun-300 text-night-900 font-display font-medium
        text-sm sm:text-base
        px-4 sm:px-5 py-2.5 sm:py-2.5
        shadow-glow hover:bg-sun-100 transition
      "
      aria-label="Sorpréndeme con una terraza al sol"
    >
      ☀ <span className="hidden xs:inline">Sorpréndeme</span><span className="xs:hidden">Sorpresa</span>
    </motion.button>
  );
}

import { useEffect, useRef, useState } from 'react';
import { useAppStore } from '../store/useAppStore';
import { ribbonApi } from '../workers/shadowsClient';
import { flyToUser } from './MapView';
import { getMadridWeather, cloudEmoji } from '../lib/weather';

interface PointState {
  sunNow: boolean;
  altitudeDeg: number;
  directMinutes: number;
}

function fmtHM(min: number) {
  if (min <= 0) return '';
  const h = Math.floor(min / 60), m = min % 60;
  if (!h) return `${m} min`;
  if (!m) return `${h} h`;
  return `${h} h ${String(m).padStart(2, '0')} min`;
}

export function MeNowBadge() {
  const userLocation = useAppStore((s) => s.userLocation);
  const buildingsLoaded = useAppStore((s) => s.buildingsLoaded);
  const selectedDate = useAppStore((s) => s.selectedDate);
  const [state, setState] = useState<PointState | null>(null);
  const [pending, setPending] = useState(false);
  const [cloudCover, setCloudCover] = useState<number | null>(null);
  const seqRef = useRef(0);
  const debRef = useRef<number | null>(null);

  // Cobertura nubosa (cache 30 min)
  useEffect(() => {
    let cancel = false;
    getMadridWeather().then((w) => { if (!cancel && w) setCloudCover(w.cloudCover); });
    return () => { cancel = true; };
  }, []);

  useEffect(() => {
    if (!userLocation || !buildingsLoaded) {
      setState(null);
      return;
    }
    const seq = ++seqRef.current;
    setPending(true);
    if (debRef.current) window.clearTimeout(debRef.current);
    debRef.current = window.setTimeout(async () => {
      try {
        const r = await ribbonApi().pointAt(userLocation.lat, userLocation.lng, selectedDate.toISOString());
        if (seq !== seqRef.current) return;
        setState({ sunNow: r.sunNow, altitudeDeg: r.altitudeDeg, directMinutes: r.directMinutes });
      } catch {
        // ignore
      } finally {
        if (seq === seqRef.current) setPending(false);
      }
    }, 120);
    return () => { if (debRef.current) window.clearTimeout(debRef.current); };
  }, [userLocation, buildingsLoaded, selectedDate]);

  if (!userLocation) return null;

  const onClick = () => flyToUser(userLocation.lat, userLocation.lng);

  let label = 'Tu sitio: calculando…';
  let cls = 'bg-night-700/90 text-paper border-white/10';
  let icon = '⌖';
  if (state) {
    if (state.altitudeDeg <= 0) {
      label = 'Tu sitio · sin sol (noche)';
      icon = '☾';
      cls = 'bg-night-700/95 text-paper border-white/10';
    } else if (state.sunNow) {
      const extra = state.directMinutes > 0 ? ` · ${fmtHM(state.directMinutes)}` : '';
      // Si nubes >=80% matizamos: técnicamente "te toca el rayo" pero apenas calienta
      if (cloudCover != null && cloudCover >= 80) {
        label = `Sol teórico · muy nublado${extra}`;
        icon = '☁';
        cls = 'bg-night-500/90 text-paper border-white/10';
      } else if (cloudCover != null && cloudCover >= 50) {
        label = `Te da el SOL · con nubes${extra}`;
        icon = cloudEmoji(cloudCover);
        cls = 'bg-sun-300/90 text-night-900 border-sun-300';
      } else {
        label = `Te da el SOL${extra}`;
        icon = '☀';
        cls = 'bg-sun-300 text-night-900 border-sun-300 shadow-glow';
      }
    } else {
      label = 'Estás en SOMBRA';
      icon = '⛅';
      cls = 'bg-night-500/90 text-paper border-white/10';
    }
  }

  return (
    <button
      onClick={onClick}
      className={`fixed left-1/2 -translate-x-1/2 bottom-[124px] sm:bottom-auto sm:top-16 sm:left-auto sm:right-4 sm:translate-x-0 z-30 rounded-full border backdrop-blur px-3.5 py-2 text-xs sm:text-sm font-medium transition active:scale-95 max-w-[74vw] sm:max-w-[260px] truncate ${cls} ${pending ? 'opacity-90' : ''}`}
      aria-label="Estado del sol en tu ubicación"
      title="Pulsa para centrar el mapa en tu ubicación"
    >
      <span className="mr-1.5">{icon}</span>{label}
    </button>
  );
}

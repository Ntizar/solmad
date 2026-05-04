import { useEffect, useRef, useState } from 'react';
import { useAppStore } from '../store/useAppStore';

const SHOW_AFTER_MS = 500;
const HIDE_AFTER_IDLE_MS = 800;

export function SolarProgressBadge() {
  const progress = useAppStore((s) => s.solarProgress);
  const [visible, setVisible] = useState(false);
  const showTimer = useRef<number | null>(null);
  const hideTimer = useRef<number | null>(null);

  const active = progress.phase !== 'idle' && progress.total > 0;
  const pct = active ? Math.max(0, Math.min(100, Math.round((progress.done / progress.total) * 100))) : 100;

  useEffect(() => {
    if (active) {
      if (hideTimer.current) { window.clearTimeout(hideTimer.current); hideTimer.current = null; }
      if (!visible && !showTimer.current) {
        showTimer.current = window.setTimeout(() => {
          setVisible(true);
          showTimer.current = null;
        }, SHOW_AFTER_MS);
      }
    } else {
      if (showTimer.current) { window.clearTimeout(showTimer.current); showTimer.current = null; }
      if (visible && !hideTimer.current) {
        hideTimer.current = window.setTimeout(() => {
          setVisible(false);
          hideTimer.current = null;
        }, HIDE_AFTER_IDLE_MS);
      }
    }
    return () => undefined;
  }, [active, visible]);

  useEffect(() => () => {
    if (showTimer.current) window.clearTimeout(showTimer.current);
    if (hideTimer.current) window.clearTimeout(hideTimer.current);
  }, []);

  if (!visible) return null;

  return (
    <div
      className="fixed bottom-[112px] right-3 z-30 pointer-events-none transition-opacity duration-300"
      style={{ opacity: active ? 1 : 0 }}
      aria-hidden={!active}
      title={active ? `Calculando sombras (${pct}%)` : 'Sombras al día'}
    >
      <div className="relative w-9 h-9 rounded-full bg-night-700/85 border border-white/10 backdrop-blur shadow-lg flex items-center justify-center">
        <svg viewBox="0 0 36 36" className="absolute inset-0 w-full h-full -rotate-90">
          <circle cx="18" cy="18" r="15" fill="none" stroke="rgba(255,255,255,0.10)" strokeWidth="3" />
          <circle
            cx="18" cy="18" r="15"
            fill="none"
            stroke="#FBBF24"
            strokeWidth="3"
            strokeLinecap="round"
            strokeDasharray={`${(pct / 100) * 94.25} 94.25`}
            style={{ transition: 'stroke-dasharray 200ms linear' }}
          />
        </svg>
        <span className="text-sun-300 text-base leading-none">☀</span>
      </div>
    </div>
  );
}

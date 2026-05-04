import { useAppStore } from '../store/useAppStore';

export function SolarProgressBadge() {
  const progress = useAppStore((s) => s.solarProgress);
  if (progress.phase === 'idle' || progress.total <= 0) return null;
  const pct = Math.max(0, Math.min(100, Math.round((progress.done / progress.total) * 100)));

  return (
    <div className="fixed left-1/2 -translate-x-1/2 top-[154px] sm:top-[104px] md:top-16 z-30 w-[min(82vw,340px)] rounded-2xl bg-night-700/88 border border-white/10 text-paper shadow-xl backdrop-blur px-3 py-2">
      <div className="flex items-center justify-between gap-3 text-xs">
        <span className="truncate">{progress.message}</span>
        <span className="font-mono text-sun-300">{pct}%</span>
      </div>
      <div className="mt-1.5 h-1.5 rounded-full bg-white/10 overflow-hidden">
        <div className="h-full bg-sun-300 transition-all" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

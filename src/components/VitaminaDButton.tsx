import { useAppStore } from '../store/useAppStore';

export function VitaminaDButton() {
  const vitaminaMode = useAppStore((s) => s.vitaminaMode);
  const setVitaminaMode = useAppStore((s) => s.setVitaminaMode);
  const userLocation = useAppStore((s) => s.userLocation);

  const active = vitaminaMode;
  const label = active ? 'Saliendo del modo' : 'Vitamina D ya';
  const sub = userLocation ? null : 'sin ubicación: usa el mapa';

  return (
    <button
      onClick={() => setVitaminaMode(!active)}
      className={`fixed top-28 left-4 z-30 rounded-full backdrop-blur px-3.5 py-2 text-xs sm:text-sm font-medium transition active:scale-95 max-w-[78vw] sm:max-w-[260px] truncate shadow-xl border ${
        active
          ? 'bg-sun-300 text-night-900 border-sun-300'
          : 'bg-paper/92 text-night-900 border-night-900/10 hover:bg-white'
      }`}
      title={sub ?? 'Filtra solo terrazas con ≥30 min de sol cerca'}
    >
      <span className="mr-1">☀</span>{label}
    </button>
  );
}

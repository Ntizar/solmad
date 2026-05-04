import { create } from 'zustand';
import type { BuildingPoly, SunState, Terraza } from '../lib/types';

interface Filters {
  distrito: string | null;
  query: string;
  minHours: number; // 0..6
  onlyOpenNow: boolean;
}

interface SolarProgress {
  phase: 'idle' | 'buildings' | 'solar' | 'selected';
  done: number;
  total: number;
  message: string;
}

interface State {
  terrazas: Terraza[];
  buildings: BuildingPoly[];
  // Mapa id->estado solar (full); y estado rápido por índice (sólo sunNow)
  sunStates: Map<number, SunState>;
  quickSun: Uint8Array | null;
  ribbonCache: Map<string, number[]>;
  visibleIds: number[];
  visibleBbox: [number, number, number, number] | null;
  sunStateCache: Map<string, SunState>;
  selectedPending: boolean;
  solarProgress: SolarProgress;
  selectedDate: Date;        // hora "ahora mismo" o la elegida en el slider
  isLive: boolean;           // true = sigue al reloj real
  selectedId: number | null;
  hoveredId: number | null;
  filters: Filters;
  vitaminaMode: boolean;
  introDone: boolean;
  buildingsLoaded: boolean;
  userLocation: { lat: number; lng: number } | null;
  geoStatus: 'idle' | 'asking' | 'granted' | 'denied' | 'unavailable';
  // setters
  setTerrazas: (t: Terraza[]) => void;
  setBuildings: (b: BuildingPoly[]) => void;
  setDate: (d: Date, live?: boolean) => void;
  setSelectedId: (id: number | null) => void;
  setHoveredId: (id: number | null) => void;
  setFilters: (p: Partial<Filters>) => void;
  setVitaminaMode: (v: boolean) => void;
  setIntroDone: (v: boolean) => void;
  setBuildingsLoaded: (v: boolean) => void;
  setSunStates: (m: Map<number, SunState>) => void;
  mergeSunStates: (entries: Array<[number, SunState]>) => void;
  updateSunState: (id: number, patch: Partial<SunState>) => void;
  setQuickSun: (u: Uint8Array | null) => void;
  setRibbonCache: (key: string, ribbon: number[]) => void;
  setVisibleIds: (ids: number[]) => void;
  setVisibleBbox: (bbox: [number, number, number, number] | null) => void;
  setSunStateCache: (key: string, state: SunState) => void;
  setSunStateCacheEntries: (entries: Array<[string, SunState]>) => void;
  setSelectedPending: (v: boolean) => void;
  setSolarProgress: (progress: SolarProgress) => void;
  resetSunStates: () => void;
  setUserLocation: (loc: { lat: number; lng: number } | null) => void;
  setGeoStatus: (s: 'idle' | 'asking' | 'granted' | 'denied' | 'unavailable') => void;
}

export const useAppStore = create<State>((set) => ({
  terrazas: [],
  buildings: [],
  sunStates: new Map(),
  quickSun: null,
  ribbonCache: new Map(),
  visibleIds: [],
  visibleBbox: null,
  sunStateCache: new Map(),
  selectedPending: false,
  solarProgress: { phase: 'idle', done: 0, total: 0, message: '' },
  selectedDate: new Date(),
  isLive: true,
  selectedId: null,
  hoveredId: null,
  filters: { distrito: null, query: '', minHours: 0, onlyOpenNow: true },
  vitaminaMode: false,
  introDone: false,
  buildingsLoaded: false,
  userLocation: null,
  geoStatus: 'idle',
  setTerrazas: (terrazas) => set({ terrazas }),
  setBuildings: (buildings) => set({ buildings }),
  setDate: (d, live = false) => set({ selectedDate: d, isLive: live }),
  setSelectedId: (id) => set({ selectedId: id }),
  setHoveredId: (id) => set({ hoveredId: id }),
  setFilters: (p) => set((s) => ({ filters: { ...s.filters, ...p } })),
  setVitaminaMode: (v) => set({ vitaminaMode: v }),
  setIntroDone: (v) => set({ introDone: v }),
  setBuildingsLoaded: (v) => set({ buildingsLoaded: v }),
  setSunStates: (m) => set({ sunStates: m }),
  mergeSunStates: (entries) => set((s) => {
    const next = new Map(s.sunStates);
    for (const [id, state] of entries) next.set(id, state);
    return { sunStates: next };
  }),
  updateSunState: (id, patch) => set((s) => {
    const cur = s.sunStates.get(id);
    if (!cur) return s;
    const next = new Map(s.sunStates);
    next.set(id, { ...cur, ...patch });
    return { sunStates: next };
  }),
  setQuickSun: (u) => set({ quickSun: u }),
  setRibbonCache: (key, ribbon) => set((s) => {
    const next = new Map(s.ribbonCache);
    next.set(key, ribbon);
    return { ribbonCache: next };
  }),
  setVisibleIds: (ids) => set({ visibleIds: ids }),
  setVisibleBbox: (bbox) => set({ visibleBbox: bbox }),
  setSunStateCache: (key, state) => set((s) => {
    const next = new Map(s.sunStateCache);
    next.set(key, state);
    return { sunStateCache: next };
  }),
  setSunStateCacheEntries: (entries) => set((s) => {
    const next = new Map(s.sunStateCache);
    for (const [key, state] of entries) next.set(key, state);
    return { sunStateCache: next };
  }),
  setSelectedPending: (v) => set({ selectedPending: v }),
  setSolarProgress: (progress) => set({ solarProgress: progress }),
  resetSunStates: () => set({ sunStates: new Map(), quickSun: null }),
  setUserLocation: (loc) => set({ userLocation: loc }),
  setGeoStatus: (s) => set({ geoStatus: s })
}));

import { AnimatePresence } from 'framer-motion';
import { useEffect, useRef, useState } from 'react';
import { Intro } from './components/Intro';
import { MapView } from './components/MapView';
import { TimeWheel } from './components/TimeWheel';
import { DetailPanel } from './components/DetailPanel';
import { SideList } from './components/SideList';
import { SurpriseButton } from './components/SurpriseButton';
import { FloatingTimeControl } from './components/FloatingTimeControl';
import { LocationButton } from './components/LocationButton';
import { MeNowBadge } from './components/MeNowBadge';
import { SolarProgressBadge } from './components/SolarProgressBadge';
import { useAppStore } from './store/useAppStore';
import { loadTerrazas } from './lib/terrazas';
import { fetchBuildings } from './lib/buildings';
import { shadowsApi, ribbonApi } from './workers/shadowsClient';
import type { Terraza } from './lib/types';
import { fetchRemoteSunCache, getLocalSunCache, saveRemoteSunCache, setLocalSunCache, type CachedSunState } from './lib/sunCache';

const GEO_CACHE_KEY = 'solmad:userLocation:v1';
const QUICK_LIMIT = 260;

function dist2(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
  const dx = a.lng - b.lng;
  const dy = a.lat - b.lat;
  return dx * dx + dy * dy;
}

function sunCacheKey(terrazaId: number, date: Date) {
  const d = new Date(date);
  const mins = d.getHours() * 60 + d.getMinutes();
  const rounded = Math.round(mins / 15) * 15;
  const day = Math.floor((Date.UTC(2000, d.getMonth(), d.getDate()) - Date.UTC(2000, 0, 0)) / 86_400_000);
  return `${terrazaId}|${day}|${rounded}`;
}

function toCachedSunState(id: number, key: string, state: CachedSunState | any): CachedSunState {
  return { id, key, ...state, updatedAt: new Date().toISOString() };
}

function uniqueById(items: Terraza[]) {
  const seen = new Set<number>();
  return items.filter((t) => {
    if (seen.has(t.id)) return false;
    seen.add(t.id);
    return true;
  });
}

export function App() {
  const introDone = useAppStore((s) => s.introDone);
  const terrazas = useAppStore((s) => s.terrazas);
  const buildingsLoaded = useAppStore((s) => s.buildingsLoaded);
  const setTerrazas = useAppStore((s) => s.setTerrazas);
  const setBuildings = useAppStore((s) => s.setBuildings);
  const setBuildingsLoaded = useAppStore((s) => s.setBuildingsLoaded);
  const mergeSunStates = useAppStore((s) => s.mergeSunStates);
  const setQuickSun = useAppStore((s) => s.setQuickSun);
  const resetSunStates = useAppStore((s) => s.resetSunStates);
  const visibleIds = useAppStore((s) => s.visibleIds);
  const visibleBbox = useAppStore((s) => s.visibleBbox);
  const selectedId = useAppStore((s) => s.selectedId);
  const userLocation = useAppStore((s) => s.userLocation);
  const sunStateCache = useAppStore((s) => s.sunStateCache);
  const setSunStateCacheEntries = useAppStore((s) => s.setSunStateCacheEntries);
  const setRibbonCache = useAppStore((s) => s.setRibbonCache);
  const setSelectedPending = useAppStore((s) => s.setSelectedPending);
  const setSolarProgress = useAppStore((s) => s.setSolarProgress);
  const setGeoStatus = useAppStore((s) => s.setGeoStatus);
  const selectedDate = useAppStore((s) => s.selectedDate);
  const [appStarted, setAppStarted] = useState(false);

  const fullDebRef = useRef<number | null>(null);
  const quickDebRef = useRef<number | null>(null);
  const fullSeqRef = useRef(0);
  const quickSeqRef = useRef(0);
  const selectedSeqRef = useRef(0);
  const buildingSeqRef = useRef(0);

  // Hidrata ubicación concedida/caché. La petición nueva queda solo en LocationButton.
  useEffect(() => {
    if (!introDone) return;
    setAppStarted(true);
    // 1) Restaura desde localStorage (sobrevive a reloads en Vercel mientras se concede el permiso)
    try {
      const cached = localStorage.getItem(GEO_CACHE_KEY);
      if (cached) {
        const parsed = JSON.parse(cached);
        if (parsed && typeof parsed.lat === 'number' && typeof parsed.lng === 'number' && Date.now() - (parsed.t ?? 0) < 7 * 24 * 60 * 60 * 1000) {
          useAppStore.getState().setUserLocation({ lat: parsed.lat, lng: parsed.lng });
        }
      }
    } catch { /* ignore */ }
    if (!window.isSecureContext || !('geolocation' in navigator)) { setGeoStatus('unavailable'); return; }
    if (!navigator.permissions?.query) return;

    navigator.permissions.query({ name: 'geolocation' as PermissionName }).then((permission) => {
      if (permission.state !== 'granted') {
        if (permission.state === 'denied') setGeoStatus('denied');
        return;
      }
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          const loc = { lat: pos.coords.latitude, lng: pos.coords.longitude };
          useAppStore.getState().setUserLocation(loc);
          setGeoStatus('granted');
          try { localStorage.setItem(GEO_CACHE_KEY, JSON.stringify({ ...loc, t: Date.now() })); } catch { /* ignore */ }
        },
        (err) => { setGeoStatus(err.code === err.PERMISSION_DENIED ? 'denied' : 'unavailable'); },
        { enableHighAccuracy: true, timeout: 8000, maximumAge: 60_000 }
      );
    }).catch(() => undefined);
  }, [introDone, setGeoStatus]);

  const startApp = () => {
    setAppStarted(true);
  };

  function targetBbox() {
    const selected = selectedId != null ? terrazas.find((t) => t.id === selectedId) : null;
    const center = selected ?? userLocation;
    if (center) {
      const pad = selected ? 0.006 : 0.012;
      return [center.lat - pad, center.lng - pad, center.lat + pad, center.lng + pad] as [number, number, number, number];
    }
    if (visibleBbox) return visibleBbox;
    return null;
  }

  // 1) Cargar terrazas. Los edificios se descargan por zona, no todo Madrid.
  useEffect(() => {
    (async () => {
      const ts = await loadTerrazas();
      setTerrazas(ts);
    })();
  }, [setTerrazas]);

  useEffect(() => {
    if (terrazas.length === 0) return;
    const bboxTarget = targetBbox();
    if (!bboxTarget) return;
    const seq = ++buildingSeqRef.current;
    const [southRaw, westRaw, northRaw, eastRaw] = bboxTarget;
    const south = Math.max(40.30, southRaw - 0.004);
    const north = Math.min(40.55, northRaw + 0.004);
    const west = Math.max(-3.85, westRaw - 0.004);
    const east = Math.min(-3.52, eastRaw + 0.004);
    const originLng = (west + east) / 2;
    const originLat = (south + north) / 2;
    setBuildingsLoaded(false);
    setSolarProgress({ phase: 'buildings', done: 1, total: 4, message: selectedId ? 'Preparando sombras de este bar' : 'Cargando sombras de la zona' });
    (async () => {
      const api = shadowsApi();
      try {
        const buildings = await fetchBuildings([south, west, north, east]);
        if (seq !== buildingSeqRef.current) return;
        setSolarProgress({ phase: 'buildings', done: 3, total: 4, message: 'Indexando edificios cercanos' });
        setBuildings(buildings);
        await api.setBuildings(buildings, originLng, originLat);
        await ribbonApi().setBuildings(buildings, originLng, originLat);
        if (seq !== buildingSeqRef.current) return;
        setBuildingsLoaded(true);
        setSolarProgress({ phase: 'solar', done: 0, total: 1, message: 'Calculando terrazas cercanas' });
      } catch (err) {
        console.warn('[solmad] Overpass falló, usando modo sin sombras:', err);
        if (seq !== buildingSeqRef.current) return;
        setBuildings([]);
        await api.setBuildings([], originLng, originLat);
        await ribbonApi().setBuildings([], originLng, originLat);
        setBuildingsLoaded(true);
        setSolarProgress({ phase: 'solar', done: 0, total: 1, message: 'Calculando sin edificios OSM' });
      }
    })();
  }, [terrazas, visibleBbox, selectedId, userLocation, setBuildings, setBuildingsLoaded, setSolarProgress]);

  const computeTargets = () => {
    const visibleSet = new Set(visibleIds);
    const visible = terrazas.filter((t) => visibleSet.has(t.id));
    const selected = selectedId != null ? terrazas.find((t) => t.id === selectedId) : null;
    const nearby = userLocation
      ? [...terrazas].sort((a, b) => dist2(a, userLocation) - dist2(b, userLocation)).slice(0, 10)
      : [];
    const fallback = visible.length ? visible : terrazas.slice(0, 120);
    return uniqueById([...(selected ? [selected] : []), ...nearby, ...fallback]).slice(0, QUICK_LIMIT);
  };

  // 2) Recálculo ligero: solo terrazas visibles, seleccionada y 10 cercanas.
  useEffect(() => {
    if (!buildingsLoaded || terrazas.length === 0) return;
    const targets = computeTargets();
    if (targets.length === 0) return;
    const seq = ++quickSeqRef.current;
    setQuickSun(null);
    if (quickDebRef.current) clearTimeout(quickDebRef.current);
    quickDebRef.current = window.setTimeout(async () => {
      const api = shadowsApi();
      const partial = await api.quickFor(targets, selectedDate.toISOString());
      if (seq !== quickSeqRef.current) return;
      const u = new Uint8Array(terrazas.length);
      u.fill(255);
      targets.forEach((t, index) => {
        const globalIndex = terrazas.findIndex((x) => x.id === t.id);
        if (globalIndex >= 0) u[globalIndex] = partial[index];
      });
      setQuickSun(u);
      setSolarProgress({ phase: 'solar', done: Math.min(targets.length, QUICK_LIMIT), total: Math.min(targets.length, QUICK_LIMIT), message: 'Terrazas cercanas listas' });
    }, 100);
    return () => { if (quickDebRef.current) clearTimeout(quickDebRef.current); };
  }, [selectedDate, terrazas, buildingsLoaded, visibleIds, selectedId, userLocation, setQuickSun]);

  // 3) Recálculo completo cacheado por franja de 15 min solo para objetivos prioritarios.
  useEffect(() => {
    if (!buildingsLoaded || terrazas.length === 0) return;
    const targets = computeTargets();
    if (targets.length === 0) return;
    const seq = ++fullSeqRef.current;
    if (fullDebRef.current) clearTimeout(fullDebRef.current);
    fullDebRef.current = window.setTimeout(async () => {
      const cachedEntries: Array<[number, CachedSunState]> = [];
      const missing: Terraza[] = [];
      for (const t of targets) {
        const key = sunCacheKey(t.id, selectedDate);
        const cached = sunStateCache.get(key) as CachedSunState | undefined || getLocalSunCache(key);
        if (cached) cachedEntries.push([t.id, cached]);
        else missing.push(t);
      }
      setSolarProgress({ phase: 'solar', done: cachedEntries.length, total: targets.length, message: 'Reusando cache solar' });
      if (cachedEntries.length) mergeSunStates(cachedEntries);
      if (missing.length) {
        const remoteRows = await fetchRemoteSunCache(missing.map((t) => sunCacheKey(t.id, selectedDate)));
        if (seq !== fullSeqRef.current) return;
        if (remoteRows.length) {
          const remoteIds = new Set(remoteRows.map((row) => row.id));
          remoteRows.forEach(setLocalSunCache);
          setSunStateCacheEntries(remoteRows.map((row) => [row.key, row]));
          mergeSunStates(remoteRows.map((row) => [row.id, row]));
          missing.splice(0, missing.length, ...missing.filter((t) => !remoteIds.has(t.id)));
        }
      }
      if (missing.length === 0) return;
      const api = shadowsApi();
      const states = await api.computeSubset(missing, selectedDate.toISOString());
      if (seq !== fullSeqRef.current) return;
      const entries: Array<[number, typeof states[number]]> = [];
      const cacheRows: CachedSunState[] = [];
      missing.forEach((t, i) => {
        const key = sunCacheKey(t.id, selectedDate);
        const row = toCachedSunState(t.id, key, states[i]);
        entries.push([t.id, states[i]]);
        cacheRows.push(row);
        setLocalSunCache(row);
      });
      setSunStateCacheEntries(cacheRows.map((row) => [row.key, row]));
      mergeSunStates(entries);
      saveRemoteSunCache(cacheRows.slice(0, 20));
      setSolarProgress({ phase: 'idle', done: targets.length, total: targets.length, message: '' });
    }, 260);
    return () => { if (fullDebRef.current) clearTimeout(fullDebRef.current); };
  }, [selectedDate, terrazas, buildingsLoaded, visibleIds, selectedId, userLocation, sunStateCache, mergeSunStates, setSunStateCacheEntries]);

  useEffect(() => {
    resetSunStates();
  }, [selectedDate, resetSunStates]);

  useEffect(() => {
    if (!buildingsLoaded || selectedId == null) return;
    const terraza = terrazas.find((t) => t.id === selectedId);
    if (!terraza) return;
    const seq = ++selectedSeqRef.current;
    const stateKey = sunCacheKey(terraza.id, selectedDate);
    const dayKey = `${terraza.id}|${selectedDate.toDateString()}`;
    const cached = sunStateCache.get(stateKey) || getLocalSunCache(stateKey);
    setSelectedPending(!cached);
    setSolarProgress({ phase: 'selected', done: cached ? 1 : 0, total: 1, message: cached ? 'Bar listo desde cache' : 'Calculando este bar' });
    if (cached) mergeSunStates([[terraza.id, cached]]);
    (async () => {
      try {
        if (!cached) {
          const [state] = await shadowsApi().computeSubset([terraza], selectedDate.toISOString());
          if (seq !== selectedSeqRef.current) return;
          const row = toCachedSunState(terraza.id, stateKey, state);
          setLocalSunCache(row);
          setSunStateCacheEntries([[stateKey, row]]);
          mergeSunStates([[terraza.id, row]]);
          saveRemoteSunCache([row]);
        }
        const ribbon = await ribbonApi().ribbonFor(terraza, selectedDate.toISOString());
        if (seq !== selectedSeqRef.current) return;
        setRibbonCache(dayKey, ribbon);
        useAppStore.getState().updateSunState(terraza.id, { ribbon });
      } finally {
        if (seq === selectedSeqRef.current) setSelectedPending(false);
        if (seq === selectedSeqRef.current) setSolarProgress({ phase: 'idle', done: 1, total: 1, message: '' });
      }
    })();
  }, [selectedId, buildingsLoaded, terrazas, selectedDate, sunStateCache, mergeSunStates, setSunStateCacheEntries, setRibbonCache, setSelectedPending]);

  return (
    <div className="relative h-full w-full overflow-hidden bg-night-700">
      {appStarted && (
        <>
          <MapView />

          {/* UI flotante */}
          <SurpriseButton />
          <LocationButton />
          <MeNowBadge />
          <SolarProgressBadge />
          <SideList />
          <FloatingTimeControl />
          <DetailPanel />

          <div className="fixed bottom-0 left-0 right-0 z-20 pb-safe pointer-events-none">
            <TimeWheel />
            {/* Créditos: hecho con amor por David Antizar — debajo de todo */}
            <div className="pointer-events-auto text-center pt-1.5 pb-1 px-2 bg-night-900/70 backdrop-blur-sm">
              <span className="text-[10px] text-paper/65 tracking-wide font-display">
                Hecho con ♥ por <strong className="text-paper/80">David Antizar</strong> · datos OSM + Madrid Abierto
              </span>
            </div>
          </div>
        </>
      )}

      <AnimatePresence>{!introDone && <Intro onDone={startApp} />}</AnimatePresence>
    </div>
  );
}

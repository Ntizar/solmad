import { useEffect, useMemo, useRef, useState } from 'react';
import L from 'leaflet';
import SunCalc from 'suncalc';
import 'leaflet/dist/leaflet.css';
import 'leaflet.markercluster';
import 'leaflet.markercluster/dist/MarkerCluster.css';
import 'leaflet.markercluster/dist/MarkerCluster.Default.css';
import { useAppStore } from '../store/useAppStore';
import type { BuildingPoly, Terraza } from '../lib/types';

const MADRID_CENTER: [number, number] = [40.4168, -3.7038];

const VOYAGER_TILES = 'https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png';
const CARTO_LIGHT_TILES = 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png';
const HOT_TILES = 'https://{s}.tile.openstreetmap.fr/hot/{z}/{x}/{y}.png';
const OSM_TILES = 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png';
const M_PER_DEG_LAT = 111_320;

function mPerDegLng(lat: number) {
  return 111_320 * Math.cos((lat * Math.PI) / 180);
}

function sunAt(date: Date, lat: number, lng: number) {
  const p = SunCalc.getPosition(date, lat, lng);
  return {
    az: (((p.azimuth * 180) / Math.PI) + 180 + 360) % 360,
    alt: (p.altitude * 180) / Math.PI
  };
}

function ringTouchesBounds(ring: BuildingPoly['ring'], bounds: L.LatLngBounds) {
  return ring.some(([lng, lat]) => bounds.contains([lat, lng]));
}

function shadowLatLngs(building: BuildingPoly, azDeg: number, altDeg: number): L.LatLngExpression[] | null {
  if (altDeg <= 1) return null;
  const ring = building.ring;
  if (ring.length < 3) return null;

  const meanLat = ring.reduce((sum, [, lat]) => sum + lat, 0) / ring.length;
  const az = (azDeg * Math.PI) / 180;
  const alt = (altDeg * Math.PI) / 180;
  const shadowLen = Math.min(180, Math.max(6, building.height / Math.tan(alt)));
  const eastM = -Math.sin(az) * shadowLen;
  const northM = -Math.cos(az) * shadowLen;
  const dLat = northM / M_PER_DEG_LAT;
  const dLng = eastM / mPerDegLng(meanLat);

  const base = ring.map(([lng, lat]) => [lat, lng] as L.LatLngExpression);
  const shifted = ring.map(([lng, lat]) => [lat + dLat, lng + dLng] as L.LatLngExpression).reverse();
  return [...base, ...shifted];
}

function makeSunIcon() {
  return L.divIcon({
    className: 'solmad-sun-marker',
    html: '<span>☀</span>',
    iconSize: [26, 26],
    iconAnchor: [13, 13]
  });
}

function makeShadowIcon() {
  return L.divIcon({
    className: 'solmad-shadow-marker',
    html: '<span></span>',
    iconSize: [14, 14],
    iconAnchor: [7, 7]
  });
}

function makePendingIcon() {
  return L.divIcon({
    className: 'solmad-pending-marker',
    html: '<span></span>',
    iconSize: [14, 14],
    iconAnchor: [7, 7]
  });
}

function makeUserIcon() {
  return L.divIcon({
    className: 'solmad-user-marker',
    html: '<span></span>',
    iconSize: [28, 28],
    iconAnchor: [14, 14]
  });
}

export function MapView() {
  const ref = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const shadowLayerRef = useRef<L.LayerGroup | null>(null);
  const terraceLayerRef = useRef<L.MarkerClusterGroup | null>(null);
  const userLayerRef = useRef<L.LayerGroup | null>(null);
  const terraceMarkersRef = useRef<Map<number, L.Marker>>(new Map());
  const markerStatesRef = useRef<Map<number, number>>(new Map());
  const tileFallbackStepRef = useRef(0);

  const terrazas = useAppStore((s) => s.terrazas);
  const buildings = useAppStore((s) => s.buildings);
  const quickSun = useAppStore((s) => s.quickSun);
  const selectedDate = useAppStore((s) => s.selectedDate);
  const setSelectedId = useAppStore((s) => s.setSelectedId);
  const setHoveredId = useAppStore((s) => s.setHoveredId);
  const setVisibleIds = useAppStore((s) => s.setVisibleIds);
  const setVisibleBbox = useAppStore((s) => s.setVisibleBbox);
  const userLocation = useAppStore((s) => s.userLocation);

  const [tilesLoaded, setTilesLoaded] = useState(false);
  const [mapError, setMapError] = useState<string | null>(null);

  const sunIcon = useMemo(() => makeSunIcon(), []);
  const shadowIcon = useMemo(() => makeShadowIcon(), []);
  const pendingIcon = useMemo(() => makePendingIcon(), []);
  const userIcon = useMemo(() => makeUserIcon(), []);

  useEffect(() => {
    if (!ref.current || mapRef.current) return;

    const map = L.map(ref.current, {
      center: MADRID_CENTER,
      zoom: 13,
      minZoom: 11,
      maxZoom: 19,
      preferCanvas: true,
      zoomControl: false,
      attributionControl: true
    });

    mapRef.current = map;
    (window as any).__solmad_map = map;

    map.createPane('solmad-building-shadows');
    const shadowPane = map.getPane('solmad-building-shadows');
    if (shadowPane) {
      shadowPane.style.zIndex = '430';
      // Forzar GPU compositing: alivia el "lag" al pan/zoom en móvil.
      shadowPane.style.willChange = 'transform';
    }

    L.control.zoom({ position: 'bottomright' }).addTo(map);

    const voyager = L.tileLayer(VOYAGER_TILES, {
      attribution: '© OpenStreetMap contributors · © CARTO',
      maxZoom: 20,
      subdomains: ['a', 'b', 'c', 'd'],
      detectRetina: true,
      crossOrigin: true
    });

    const cartoLight = L.tileLayer(CARTO_LIGHT_TILES, {
      attribution: '© OpenStreetMap contributors · © CARTO',
      maxZoom: 19,
      subdomains: ['a', 'b', 'c', 'd'],
      detectRetina: true,
      crossOrigin: true
    });

    const osm = L.tileLayer(OSM_TILES, {
      attribution: '© OpenStreetMap contributors',
      maxZoom: 19,
      subdomains: ['a', 'b', 'c'],
      crossOrigin: true
    });

    const hot = L.tileLayer(HOT_TILES, {
      attribution: '© OpenStreetMap contributors · Tiles courtesy of HOT',
      maxZoom: 20,
      subdomains: ['a', 'b', 'c'],
      crossOrigin: true
    });

    const tileLayers = [voyager, cartoLight, osm, hot];
    const onLoad = () => setTilesLoaded(true);
    tileLayers.forEach((layer) => layer.on('load tileload', onLoad));
    const fallback = () => {
      if (tileFallbackStepRef.current >= tileLayers.length - 1) {
        setMapError('No se han podido descargar las teselas del mapa.');
        return;
      }
      const current = tileLayers[tileFallbackStepRef.current];
      tileFallbackStepRef.current += 1;
      const next = tileLayers[tileFallbackStepRef.current];
      map.removeLayer(current);
      next.addTo(map);
    };
    voyager.on('tileerror', fallback);
    cartoLight.on('tileerror', fallback);
    osm.on('tileerror', fallback);
    hot.on('tileerror', () => setMapError('No se han podido descargar las teselas del mapa.'));
    voyager.addTo(map);

    shadowLayerRef.current = L.layerGroup().addTo(map);
    terraceLayerRef.current = L.markerClusterGroup({
      chunkedLoading: true,
      removeOutsideVisibleBounds: true,
      showCoverageOnHover: false,
      spiderfyOnMaxZoom: true,
      disableClusteringAtZoom: 19,
      maxClusterRadius: (zoom) => (zoom >= 17 ? 24 : 52),
      iconCreateFunction: (cluster) => {
        const children = cluster.getAllChildMarkers();
        const sunny = children.filter((marker) => (marker.options as any).sunny).length;
        const pending = children.filter((marker) => (marker.options as any).state === -1).length;
        const count = cluster.getChildCount();
        return L.divIcon({
          className: 'solmad-cluster-marker',
          html: `<span>${sunny ? '☀' : pending === count ? '…' : '·'}</span><strong>${count}</strong>`,
          iconSize: [38, 38],
          iconAnchor: [19, 19]
        });
      }
    }).addTo(map);
    userLayerRef.current = L.layerGroup().addTo(map);

    const resize = window.setTimeout(() => map.invalidateSize(), 250);

    return () => {
      window.clearTimeout(resize);
      map.remove();
      mapRef.current = null;
      shadowLayerRef.current = null;
      terraceLayerRef.current = null;
      userLayerRef.current = null;
      terraceMarkersRef.current.clear();
      markerStatesRef.current.clear();
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    const layer = shadowLayerRef.current;
    if (!map || !layer) return;

    const isMobile = typeof window !== 'undefined' && window.innerWidth < 768;
    const MAX_DRAW = isMobile ? 350 : 1400;
    const MIN_ZOOM_FOR_SHADOWS = isMobile ? 14 : 12;
    let rafId = 0;
    let pending = false;
    // Renderer canvas dedicado: mucho más fluido en móvil que SVG con cientos de polígonos
    const canvasRenderer = L.canvas({ pane: 'solmad-building-shadows', padding: 0.2 });

    const doRender = () => {
      pending = false;
      layer.clearLayers();
      if (buildings.length === 0) return;
      if (map.getZoom() < MIN_ZOOM_FOR_SHADOWS) return;
      const center = map.getCenter();
      const { az, alt } = sunAt(selectedDate, center.lat, center.lng);
      if (alt <= 1) return;

      const bounds = map.getBounds().pad(isMobile ? 0.10 : 0.30);
      const visibleBuildings = buildings.filter((building) => ringTouchesBounds(building.ring, bounds)).slice(0, MAX_DRAW);
      let drawn = 0;
      for (const building of visibleBuildings) {
        const poly = shadowLatLngs(building, az, alt);
        if (!poly) continue;
        L.polygon(poly, {
          renderer: canvasRenderer,
          pane: 'solmad-building-shadows',
          interactive: false,
          stroke: false,
          fillColor: '#223044',
          fillOpacity: Math.max(0.08, Math.min(0.22, 0.28 - alt / 180))
        }).addTo(layer);
        drawn += 1;
      }
    };

    const schedule = () => {
      if (pending) return;
      pending = true;
      rafId = window.requestAnimationFrame(doRender);
    };

    schedule();
    map.on('moveend zoomend', schedule);
    return () => {
      map.off('moveend zoomend', schedule);
      if (rafId) window.cancelAnimationFrame(rafId);
    };
  }, [buildings, selectedDate]);

  useEffect(() => {
    const layer = terraceLayerRef.current;
    if (!layer) return;
    layer.clearLayers();
    terraceMarkersRef.current.clear();
    markerStatesRef.current.clear();

    terrazas.forEach((terraza) => {
      const marker = L.marker([terraza.lat, terraza.lng], {
        icon: pendingIcon,
        title: terraza.name,
        riseOnHover: true
      } as L.MarkerOptions & { sunny?: boolean });
      (marker.options as any).sunny = false;
      (marker.options as any).state = -1;

      marker.on('click', () => setSelectedId(terraza.id));
      marker.on('mouseover', () => setHoveredId(terraza.id));
      marker.on('mouseout', () => setHoveredId(null));
      marker.addTo(layer);
      terraceMarkersRef.current.set(terraza.id, marker);
      markerStatesRef.current.set(terraza.id, -1);
    });
  }, [terrazas, setSelectedId, setHoveredId, pendingIcon]);

  useEffect(() => {
    const layer = terraceLayerRef.current;
    if (!layer || terrazas.length === 0) return;

    terrazas.forEach((terraza, index) => {
      const marker = terraceMarkersRef.current.get(terraza.id);
      if (!marker) return;
      const rawState = quickSun ? quickSun[index] : 255;
      // 0=sombra, 1=sol, 2=noche, 3=pendiente. 255=sin dato.
      const state = (rawState === 255 || rawState === 3) ? -1 : rawState;
      if (markerStatesRef.current.get(terraza.id) === state) return;
      markerStatesRef.current.set(terraza.id, state);
      (marker.options as any).sunny = state === 1;
      (marker.options as any).state = state;
      marker.setIcon(state === 1 ? sunIcon : state === -1 ? pendingIcon : shadowIcon);
    });
    layer.refreshClusters();
  }, [terrazas, quickSun, sunIcon, shadowIcon, pendingIcon]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || terrazas.length === 0) return;
    let rafId = 0;
    const publishVisible = () => {
      const bounds = map.getBounds().pad(0.08);
      const ids = terrazas
        .filter((t) => bounds.contains([t.lat, t.lng]))
        .slice(0, 300)
        .map((t) => t.id);
      setVisibleIds(ids);
      setVisibleBbox([bounds.getSouth(), bounds.getWest(), bounds.getNorth(), bounds.getEast()]);
    };
    const schedule = () => {
      if (rafId) window.cancelAnimationFrame(rafId);
      rafId = window.requestAnimationFrame(publishVisible);
    };
    schedule();
    map.on('moveend zoomend', schedule);
    return () => {
      map.off('moveend zoomend', schedule);
      if (rafId) window.cancelAnimationFrame(rafId);
    };
  }, [terrazas, setVisibleIds, setVisibleBbox]);

  useEffect(() => {
    const layer = userLayerRef.current;
    if (!layer) return;
    layer.clearLayers();
    if (!userLocation) return;

    L.circle([userLocation.lat, userLocation.lng], {
      radius: 45,
      color: '#3B82F6',
      weight: 1,
      fillColor: '#3B82F6',
      fillOpacity: 0.14
    }).addTo(layer);

    L.marker([userLocation.lat, userLocation.lng], { icon: userIcon, title: 'Tu ubicación' }).addTo(layer);
  }, [userLocation, userIcon]);

  return (
    <div className="absolute inset-0 bg-[#EDE6D6]">
      <div ref={ref} className="absolute inset-0 z-0" aria-label="Mapa de Madrid" />
      <div className="solmad-map-wash" aria-hidden="true" />
      {!tilesLoaded && !mapError && (
        <div className="absolute inset-0 z-[1] flex items-center justify-center pointer-events-none bg-[#EDE6D6]">
          <div className="text-night-700/70 font-display text-lg flex items-center gap-3">
            <span className="inline-block w-3 h-3 rounded-full bg-sun-300 animate-pulse" />
            Cargando mapa libre de Madrid…
          </div>
        </div>
      )}
      {mapError && (
        <div className="absolute inset-0 z-[1] flex items-center justify-center pointer-events-none bg-night-700/95">
          <div className="text-paper text-center px-6">
            <p className="font-display text-xl mb-2">No se pudo cargar el mapa</p>
            <p className="text-paper/60 text-sm">{mapError}</p>
          </div>
        </div>
      )}
    </div>
  );
}

export function flyToTerraza(t: Terraza) {
  const map = (window as any).__solmad_map as L.Map | undefined;
  if (map) map.flyTo([t.lat, t.lng], 18, { duration: 0.8 });
}

export function flyToUser(lat: number, lng: number) {
  const map = (window as any).__solmad_map as L.Map | undefined;
  if (map) map.flyTo([lat, lng], 16, { duration: 0.8 });
}

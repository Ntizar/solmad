import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  base: './',
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icon.svg'],
      manifest: {
        name: 'SolMAD · Sol y sombra en terrazas de Madrid',
        short_name: 'SolMAD',
        description: 'Encuentra al instante terrazas con sol o sombra en Madrid.',
        theme_color: '#0e0b08',
        background_color: '#0e0b08',
        display: 'standalone',
        orientation: 'portrait',
        scope: '/',
        start_url: '/',
        lang: 'es-ES',
        icons: [
          { src: 'icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any maskable' },
        ],
      },
      workbox: {
        // No precacheamos terrazas.min.json (puede ser grande); va a runtime cache.
        globPatterns: ['**/*.{js,css,html,svg,woff2,ico,png,webp}'],
        // Sólo cacheamos lo razonable y dejamos que el resto pase
        maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
        runtimeCaching: [
          {
            // Datos de la app: terrazas
            urlPattern: ({ url }) => url.pathname.endsWith('/terrazas.min.json'),
            handler: 'StaleWhileRevalidate',
            options: {
              cacheName: 'solmad-data',
              expiration: { maxEntries: 4, maxAgeSeconds: 60 * 60 * 24 * 7 },
            },
          },
          {
            // Tiles del mapa base (CARTO)
            urlPattern: ({ url }) => /basemaps\.cartocdn\.com$/.test(url.hostname),
            handler: 'CacheFirst',
            options: {
              cacheName: 'solmad-basemap',
              expiration: { maxEntries: 800, maxAgeSeconds: 60 * 60 * 24 * 30 },
            },
          },
          {
            // Overpass: edificios. Stale-while-revalidate para ahorrar viajes.
            urlPattern: ({ url }) => /overpass[-.]?api\.de/.test(url.hostname) || /overpass\.kumi\.systems/.test(url.hostname),
            handler: 'StaleWhileRevalidate',
            options: {
              cacheName: 'solmad-overpass',
              expiration: { maxEntries: 60, maxAgeSeconds: 60 * 60 * 24 * 3 },
            },
          },
          {
            // Open-Meteo: meteo
            urlPattern: ({ url }) => url.hostname.includes('open-meteo.com'),
            handler: 'NetworkFirst',
            options: {
              cacheName: 'solmad-weather',
              networkTimeoutSeconds: 4,
              expiration: { maxEntries: 4, maxAgeSeconds: 60 * 30 },
            },
          },
        ],
        // No interceptamos /api/* (necesitan estar siempre frescos)
        navigateFallbackDenylist: [/^\/api\//],
      },
    }),
  ],
  worker: { format: 'es' },
  server: { port: 5173, host: true },
});

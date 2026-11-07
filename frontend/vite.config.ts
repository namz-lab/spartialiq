/// <reference types="vitest/config" />
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { VitePWA } from 'vite-plugin-pwa'
import { fileURLToPath, URL } from 'node:url'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [
    vue(),
    // Progressive Web App: installable + offline. Designed for the field /
    // intermittent-connectivity use case in PRODUCT.md. The service worker
    // precaches the app shell and runtime-caches the map basemap (vector tiles
    // + Esri imagery) and fonts. It deliberately does NOT cache /api JSON,
    // which can carry PII — only public, non-sensitive spatial assets persist.
    VitePWA({
      // Set DISABLE_PWA=1 when the workstation OOMs during `vite build`.
      disable: process.env.DISABLE_PWA === '1',
      registerType: 'autoUpdate',
      injectRegister: 'auto',
      includeAssets: ['icon.svg'],
      manifest: {
        name: 'Vungu RDC Planning Portal',
        short_name: 'Vungu RDC',
        description:
          'Vungu Rural District Council — planning, spatial data, and development applications.',
        theme_color: '#1a73e8',
        background_color: '#f6f4ee',
        display: 'standalone',
        start_url: '/',
        scope: '/',
        icons: [
          { src: 'icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any maskable' },
        ],
      },
      workbox: {
        // Precache the shell (markup, styles, fonts, icons) so the app boots
        // offline; JS chunks are runtime-cached on first visit to keep the
        // initial download light for modest devices.
        globPatterns: ['**/*.{css,html,woff2,svg,ico,json}'],
        navigateFallback: '/index.html',
        navigateFallbackDenylist: [/^\/api/, /^\/qgis/],
        cleanupOutdatedCaches: true,
        runtimeCaching: [
          {
            // App JS chunks (same-origin /assets/*.js) — cache after first use.
            urlPattern: ({ url, sameOrigin }: any) => sameOrigin && url.pathname.startsWith('/assets/'),
            handler: 'StaleWhileRevalidate',
            options: {
              cacheName: 'vungu-app-assets',
              expiration: { maxEntries: 200, maxAgeSeconds: 60 * 60 * 24 * 30 },
            },
          },
          {
            // PostGIS vector tiles — keep the basemap available offline.
            urlPattern: ({ url }: any) =>
              url.pathname.startsWith('/api/tiles/') && url.pathname.endsWith('.pbf'),
            handler: 'StaleWhileRevalidate',
            options: {
              cacheName: 'vungu-vector-tiles',
              expiration: { maxEntries: 2000, maxAgeSeconds: 60 * 60 * 24 * 30 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          {
            // Esri satellite/aerial imagery (cross-origin, opaque responses).
            urlPattern: ({ url }: any) => url.hostname.endsWith('arcgisonline.com'),
            handler: 'CacheFirst',
            options: {
              cacheName: 'esri-imagery',
              expiration: { maxEntries: 1000, maxAgeSeconds: 60 * 60 * 24 * 30 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          {
            // Google Fonts stylesheet + font files.
            urlPattern: ({ url }: any) =>
              url.hostname.includes('fonts.googleapis.com') || url.hostname.includes('fonts.gstatic.com'),
            handler: 'StaleWhileRevalidate',
            options: {
              cacheName: 'google-fonts',
              expiration: { maxEntries: 40, maxAgeSeconds: 60 * 60 * 24 * 365 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
        ],
      },
      devOptions: { enabled: false },
    }),
  ],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url))
    }
  },
  // Vitest: only discover tests under src/. Excludes stale duplicated specs in
  // .claude/worktrees (agent worktrees) that otherwise break `npm test`.
  test: {
    include: ['src/**/*.{test,spec}.{ts,tsx,js,jsx}'],
    exclude: ['**/node_modules/**', '**/dist/**', '**/.claude/**', '**/.git/**'],
  },
  server: {
    host: true,
    port: 5174,
    // Dev tunnels (cloudflared) arrive with their own Host header, which Vite
    // rejects by default as a DNS-rebinding guard.
    allowedHosts: ['.trycloudflare.com', '.loca.lt', '.ngrok-free.app'],
    proxy: {
      '/api': {
        target: process.env.VITE_BACKEND_PROXY || 'http://localhost:3000',
        changeOrigin: true,
        secure: false
      },
      // Uploaded files (citizen documents, inspection photos) are served by
      // the backend at /uploads. Proxy them so document links / previews work
      // in dev without hard-coding the backend origin.
      '/uploads': {
        target: process.env.VITE_BACKEND_PROXY || 'http://localhost:3000',
        changeOrigin: true,
        secure: false
      },
      // Trailing slash matters: a bare '/qgis' prefix also matches the SPA
      // routes /qgis-map and /admin/qgis-plugin (Vite proxy matching is
      // prefix-based), sending page navigations into this proxy instead of
      // the Vue app. Direct QGIS Server passthrough always calls '/qgis/?...'
      // (see stores/spatial.ts), so anchor on the slash.
      '/qgis/': {
        target: process.env.VITE_QGIS_PROXY || 'http://localhost:8080',
        changeOrigin: true,
        secure: false,
        rewrite: (path) => path.replace(/^\/qgis\//, '/')
      }
    }
  },
  // Strip console + debugger from production bundles.
  // Auth/store/services contain console.logs that leak token prefixes,
  // user emails and response bodies — must not ship.
  esbuild: {
    drop: process.env.NODE_ENV === 'production' ? ['console', 'debugger'] : [],
  },
  build: {
    outDir: 'dist',
    // Hidden sourcemaps doubled peak RAM and OOM'd this repo on a 16 GB
    // Node heap. Production still minifies; stack traces go to the console.
    sourcemap: false,
    reportCompressedSize: false,
    chunkSizeWarningLimit: 2000,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules/maplibre-gl') || id.includes('@maplibre/maplibre-gl-geocoder')) return 'maplibre'
          if (id.includes('node_modules/gsap')) return 'gsap'
          if (id.includes('jspdf') || id.includes('svg2pdf') || id.includes('canvg') || id.includes('html2canvas')) return 'pdf'
          if (id.includes('@turf') || id.includes('/proj4') || id.includes('topojson-client')) return 'turf'
        },
      },
    },
  },
})

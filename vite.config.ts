/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

/**
 * Public base path.
 *
 * Vercel serves from a domain root, so this is '/' in every normal build. The
 * indirection is kept because one hardcoded '/' is exactly the mistake that
 * broke an earlier subpath deploy: assets 404 and the PWA refuses to install
 * because its start_url sits outside its scope. If this app is ever hosted under
 * a subpath, set BASE_PATH=/some/path/ rather than editing code.
 */
const BASE = process.env.BASE_PATH ?? '/';

export default defineConfig({
  base: BASE,
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg', 'icon-192.png', 'icon-512.png'],
      manifest: {
        // Must match scope or the app can be installed twice under different
        // identities on the same origin.
        id: BASE,
        // Plain ASCII punctuation: an em-dash here showed up mangled when the
        // manifest was read back, and there is nothing to gain from it.
        name: 'MalariaX - Malaria Risk & Community Reporting',
        short_name: 'MalariaX',
        description:
          'Check your malaria risk, learn prevention, and report cases to build community early-warning data.',
        lang: 'en',
        start_url: BASE,
        scope: BASE,
        display: 'standalone',
        orientation: 'portrait',
        background_color: '#F7F6F3',
        theme_color: '#0F766E',
        categories: ['health', 'medical', 'lifestyle'],
        icons: [
          // Base-aware. An absolute "/icon-192.png" 404s on a subpath host, and a
          // manifest whose icons do not resolve means the PWA silently refuses
          // to install — no error the user would ever see.
          { src: `${BASE}icon-192.png`, sizes: '192x192', type: 'image/png' },
          { src: `${BASE}icon-512.png`, sizes: '512x512', type: 'image/png' },
          { src: `${BASE}icon-512.png`, sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // Fonts are deliberately NOT precached. The Ethiopic face alone is
        // ~194KB, and precaching it makes every first visit pay for it —
        // including for the majority of users who never switch to Amharic. The
        // Latin faces arrive with the first render through the normal HTTP
        // cache, and the runtime rule below keeps whatever has been used
        // available offline afterwards.
        globPatterns: ['**/*.{js,css,html,svg,png,json}'],
        // Derived from BASE so a subpath host cannot serve the wrong document.
        navigateFallback: `${BASE}index.html`,
        // Rural first load has to survive a dropped connection, so a failed
        // navigation lands on an offline page that explains what still works
        // rather than on the browser's default dinosaur.
        navigateFallbackDenylist: [/^\/api\//],
        runtimeCaching: [
          {
            urlPattern: /\.(?:woff2?|ttf|otf)$/,
            handler: 'CacheFirst',
            options: {
              cacheName: 'malariax-fonts',
              expiration: { maxEntries: 12, maxAgeSeconds: 60 * 60 * 24 * 365 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          {
            urlPattern: /\/api\//,
            handler: 'NetworkFirst',
            options: {
              cacheName: 'malariax-api',
              networkTimeoutSeconds: 5,
              expiration: { maxEntries: 200, maxAgeSeconds: 60 * 60 * 24 },
            },
          },
        ],
      },
      devOptions: { enabled: false },
    }),
  ],
  build: {
    target: 'es2022',
    // Manual chunks are limited to the two vendors that must not be re-fetched on
    // every app update. Dexie and Supabase are deliberately NOT grouped: Supabase
    // is only reachable through a dynamic import in lib/offline.ts and
    // App.tsx's lazy DashboardScreen, so grouping them would defeat that and
    // pull ~90KB gzipped onto the critical path for users who only check
    // symptoms.
    rollupOptions: {
      output: {
        manualChunks: {
          react: ['react', 'react-dom'],
          i18n: ['i18next', 'react-i18next'],
        },
      },
    },
  },
  test: {
    // Two projects. Pure logic stays in Node — fast, no browser shims — while
    // render suites get jsdom. Keeping them apart means the safety-critical
    // maths suite cannot be slowed down or broken by DOM plumbing.
    projects: [
      {
        extends: true,
        test: {
          name: 'node',
          environment: 'node',
          include: ['src/**/*.test.ts'],
        },
      },
      {
        extends: true,
        test: {
          name: 'dom',
          environment: 'jsdom',
          include: ['src/**/*.test.tsx'],
          setupFiles: ['src/test/setup-dom.ts'],
        },
      },
    ],
  },
});
/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

/**
 * Public base path.
 *
 * Defaults to '/' for local dev and for a root-domain deploy (Vercel). Set
 * BASE_PATH=/MalariaX/ when building for GitHub Pages, which serves the repo
 * from a subpath. This has to be derived rather than hardcoded, otherwise the
 * built assets 404 and the PWA refuses to install because its start_url points
 * outside its scope.
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
        id: '/',
        name: 'MalariaX — Malaria Risk & Community Reporting',
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
          { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,woff2,json}'],
        // Must sit under BASE or the service worker serves the wrong document
        // for the app on GitHub Pages.
        navigateFallback: `${BASE}index.html`,
        // Rural first load has to survive a dropped connection, so a failed
        // navigation lands on an offline page that explains what still works
        // rather than on the browser's default dinosaur.
        navigateFallbackDenylist: [/^\/api\//],
        runtimeCaching: [
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
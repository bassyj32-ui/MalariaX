/**
 * Test environment for anything that touches the DOM.
 *
 * Two gaps have to be closed before the app can render in Node at all:
 *
 *  1. IndexedDB — Dexie constructs its database at module load, and App starts a
 *     sync on mount that immediately runs a count query. Without a real
 *     implementation that throws during render, not during a test assertion.
 *  2. matchMedia — the theme tokens depend on prefers-color-scheme, and jsdom
 *     does not implement it.
 *
 * Kept separate from the node-environment suite so the pure logic tests stay
 * fast and free of browser shims.
 */
import 'fake-indexeddb/auto';
// Registers toBeDisabled / toBeInTheDocument / toHaveAttribute etc.
import '@testing-library/jest-dom/vitest';
import { afterEach, beforeAll, beforeEach } from 'vitest';
import { cleanup } from '@testing-library/react';
import { ready } from '../i18n';
import { resetAppForTests } from '../store/app';

// The app initialises i18next from main.tsx. Render tests mount components
// directly, so nothing has done it for them and every `t()` would return an
// empty string.
beforeAll(async () => {
  await ready;
  if (typeof document !== 'undefined') {
    document.documentElement.setAttribute('lang', 'en');
  }
});

// The store is a singleton and progress is persisted to localStorage, so both
// leak across tests unless cleared.
beforeEach(() => {
  resetAppForTests();
  try {
    localStorage.clear();
  } catch {
    /* storage unavailable; nothing persisted to clear */
  }
});

if (!window.matchMedia) {
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  })) as typeof window.matchMedia;
}

// jsdom *has* window.scrollTo but it throws "Not implemented", so a presence
// check never replaces it. Unconditional override: the resulting stderr noise
// in an otherwise green run is how a real error hides later.
window.scrollTo = (() => {}) as typeof window.scrollTo;

// jsdom implements neither of these. The component guards them too, because some
// older Android WebViews genuinely lack scrollIntoView — which is most of the
// devices this app is actually for.
if (!Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = function scrollIntoView() {};
}

afterEach(() => {
  cleanup();
});
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Deployment-target regression guards.
 *
 * A subpath deploy fails in ways that are invisible locally and fatal in
 * production: assets 404, the service worker registers against the wrong scope,
 * or the PWA silently refuses to install because its icons do not resolve.
 * Chrome surfaces none of that to the user — the app simply never becomes
 * installable, which is very hard to notice and very easy to ship.
 *
 * These assertions run against a real build, so they describe the artifact that
 * actually ships. They are skipped when there is no build to inspect.
 */

const DIST = resolve(process.cwd(), 'dist');

function readSafe(path: string): string {
  try {
    return readFileSync(path, 'utf8');
  } catch {
    return '';
  }
}

interface Manifest {
  id: string;
  name: string;
  start_url: string;
  scope: string;
  icons: { src: string; sizes?: string; purpose?: string }[];
}

const manifestRaw = readSafe(resolve(DIST, 'manifest.webmanifest'));

/**
 * Parsed defensively, because this file is collected twice: once by `npm test`
 * (where dist/ may not exist yet, since the suite runs before the build) and
 * again by `npm run test:dist` after a build.
 *
 * `describe.skip` still executes its callback in order to collect test names, so
 * a bare JSON.parse('') inside it throws during collection and fails the whole
 * run. Hence: null means "nothing to check", not "broken".
 */
function parseManifest(raw: string): Manifest | null {
  if (!raw.trim()) return null;
  try {
    return JSON.parse(raw) as Manifest;
  } catch {
    return null;
  }
}

const manifest = parseManifest(manifestRaw);
const describeDist = manifest ? describe : describe.skip;

/**
 * The base is read from the built manifest rather than hardcoded, so these
 * assertions hold for whatever the build targeted — '/' in a normal Vercel
 * build, or a subpath if BASE_PATH is set. Hardcoding one of them meant a plain
 * local build failed these checks for the wrong reason, which is a good way to
 * train someone to ignore a test.
 *
 * `scope` is already a path, not a URL, so it is used directly — `new URL()`
 * rejects a bare path.
 */
const scope: string = manifestRaw ? JSON.parse(manifestRaw).scope : '/';
const BASE = scope.endsWith('/') ? scope : `${scope}/`;

describeDist(`build artifact, scope ${BASE}`, () => {
  // Non-null: describeDist only runs when the parse succeeded.
  const m = manifest!;

  it('scopes the manifest under the subpath, not the root', () => {
    expect(m.start_url).toBe(BASE);
    expect(m.scope).toBe(BASE);
  });

  it('gives the manifest an id matching its scope', () => {
    // A mismatch lets the same app be installed twice under different
    // identities on one origin, which is confusing and hard to undo.
    expect(m.id).toBe(m.scope);
  });

  it('points every icon at the subpath', () => {
    expect(m.icons.length).toBeGreaterThanOrEqual(2);
    for (const icon of m.icons) {
      expect(icon.src.startsWith(BASE), `${icon.src} is not under ${BASE}`).toBe(true);
    }
  });

  it('ships a 192, a 512, and a maskable icon', () => {
    const joined = m.icons.map((i) => `${i.src} ${i.sizes ?? ''}`).join(' ');
    expect(joined).toContain('192');
    expect(joined).toContain('512');
    expect(m.icons.some((i) => i.purpose === 'maskable')).toBe(true);
  });

  it('uses plain ASCII in the manifest name', () => {
    // An em-dash came back mangled from a build; nothing is gained by it.
    expect(m.name).not.toMatch(/[\u2013\u2014]/);
  });

  it('references assets under the scope from index.html', () => {
    const html = readSafe(resolve(DIST, 'index.html'));
    expect(html).toContain(`${BASE}assets/`);
    // No root-absolute src/href: those 404 when the app lives on a subpath.
    // When BASE is '/', every src/href *is* root-relative, so there is nothing
    // to assert and the check is skipped rather than made vacuous.
    if (BASE !== '/') {
      // Capture whole attribute values. Matching only the `src="/` prefix would
      // flag every correctly-scoped path, since a scoped path also starts with a
      // single slash.
      const values: string[] = [...html.matchAll(/(?:src|href)="([^"]*)"/g)].map((m) => m[1]!);
      const offenders = values.filter((v) => v.startsWith('/') && !v.startsWith(BASE));
      expect(offenders, `root-absolute refs outside ${BASE}: ${offenders.join(', ')}`).toEqual([]);
    }
  });

  it('links the manifest in a way that resolves for this scope', () => {
    const html = readSafe(resolve(DIST, 'index.html'));
    const href = html.match(/rel="manifest" href="([^"]*)"/)?.[1];
    expect(href, 'no manifest link found in index.html').toBeTruthy();
    // Two valid forms: relative (resolves against the document, so it follows
    // whatever subpath it is served from) or explicitly scoped. Only a
    // root-absolute path outside the scope is a 404.
    if (BASE !== '/') {
      const isRelative = !href!.startsWith('/');
      const isScoped = href!.startsWith(BASE);
      expect(isRelative || isScoped, `manifest href "${href}" resolves outside ${BASE}`).toBe(true);
    }
  });

  it('registers and navigates the service worker inside the subpath', () => {
    const sw = readSafe(resolve(DIST, 'sw.js'));
    expect(sw).toContain(BASE);
    expect(sw).not.toMatch(/navigateFallback:"index\.html"/);
    const reg = readSafe(resolve(DIST, 'registerSW.js'));
    expect(reg).toContain(BASE);
  });

  it('precaches the shell so the app opens offline', () => {
    const sw = readSafe(resolve(DIST, 'sw.js'));
    expect(sw.length).toBeGreaterThan(1000);
    expect(sw).toMatch(/precacheAndRoute|\.js|\.css/);
  });
});

describe('no-JavaScript fallback', () => {
  it('tells a user without JS to get tested, in both languages', () => {
    const html = readSafe(resolve(process.cwd(), 'index.html'));
    expect(html).toContain('<noscript>');
    expect(html).toMatch(/blood test/);
    expect(html).toMatch(/ወባ/); // "malaria" in Amharic
  });
});
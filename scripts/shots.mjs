/**
 * Visual QA script.
 *
 * Usage: node scripts/shots.mjs [baseUrl]
 *
 * Drives a real Chromium with proper mobile emulation — which headless Chrome's
 * `--window-size` does NOT do. That was the trap that produced a bogus
 * "content is cut off" reading earlier: `--window-size=390` left the layout
 * viewport at 485px and the screenshot simply cropped it.
 *
 * Emulating a device (viewport + deviceScaleFactor + isMobile + hasTouch) makes
 * the layout viewport actually 390px, which is the width that matters.
 */
import { chromium, devices } from 'playwright';
import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const BASE = process.argv[2] ?? 'http://localhost:5199';
const OUT = join(process.cwd(), 'shots');
if (!existsSync(OUT)) mkdirSync(OUT, { recursive: true });

// Prefer a browser already in the Playwright cache; fall back to whatever the
// library resolves. Downloads have been unreliable in this environment.
const CACHE = join(process.env.LOCALAPPDATA ?? '', 'ms-playwright');
const CANDIDATES = [
  join(CACHE, 'chromium-1223', 'chrome-win64', 'chrome.exe'),
  join(CACHE, 'chromium_headless_shell-1223', 'chrome-headless-shell-win64', 'chrome-headless-shell.exe'),
];
const executablePath = CANDIDATES.find((p) => existsSync(p));

/** iPhone 12-ish. 390px is the narrowest width worth checking for a phone. */
const PHONE = { ...devices['iPhone 12'] };
const NARROW = { viewport: { width: 320, height: 900 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true };

const problems = [];

/**
 * Wait for real content rather than a fixed delay.
 *
 * A fixed timeout produced a false alarm: on a real host the lazily-loaded Data
 * tab had not finished downloading after 1500ms, so the screenshot showed
 * Suspense skeletons and it looked like the map was broken when it was fine.
 * A QA script that cries wolf gets ignored, which is worse than none.
 */
async function waitFor(page, selector, label, timeoutMs = 30000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (await page.locator(selector).count()) return true;
    await page.waitForTimeout(250);
  }
  problems.push(`timed out waiting for ${label ?? selector}`);
  return false;
}

/**
 * `networkidle` never fires on a page with a service worker — the worker keeps
 * a connection alive — so it is not a usable readiness signal here.
 */
const READY = { waitUntil: 'load', timeout: 60000 };

async function shot(page, name) {
  await page.waitForTimeout(450);
  await page.screenshot({ path: join(OUT, `${name}.png`) });
  console.log(`  shot ${name}`);
}

/** Report any element wider than the viewport — the only real overflow check. */
async function checkOverflow(page, label) {
  const info = await page.evaluate(() => {
    const de = document.documentElement;
    const wide = [...document.querySelectorAll('body *')]
      .map((el) => ({ el, r: el.getBoundingClientRect() }))
      .filter(({ r }) => r.width > 0 && r.right > de.clientWidth + 1)
      .slice(0, 6)
      .map(({ el, r }) => `${el.tagName.toLowerCase()}.${(el.className || '-').toString().split(' ')[0]} right=${Math.round(r.right)}`);
    return { icw: de.clientWidth, scw: de.scrollWidth, wide };
  });
  const overflow = info.scw > info.icw + 1;
  console.log(`  [${label}] viewport=${info.icw} scrollWidth=${info.scw}${overflow ? ' OVERFLOW' : ' ok'}`);
  if (info.wide.length) console.log(`      wide: ${info.wide.join(', ')}`);
  if (overflow) problems.push(`${label}: scrollWidth ${info.scw} > clientWidth ${info.icw}`);
  return overflow;
}

const browser = await chromium.launch(executablePath ? { executablePath } : {});

try {
  const ctx = await browser.newContext({ ...PHONE, locale: 'en-GB' });
  const page = await ctx.newPage();
  page.on('console', (m) => {
    if (m.type() === 'error') problems.push(`console error: ${m.text().slice(0, 160)}`);
  });
  page.on('pageerror', (e) => problems.push(`page error: ${e.message.slice(0, 160)}`));

  console.log('\n— home —');
  await page.goto(BASE, READY);
  await shot(page, '01-home');
  await checkOverflow(page, 'home');

  console.log('— symptom check —');
  await page.getByRole('button', { name: /Check symptoms/i }).first().click();
  await shot(page, '02-symptom-check');
  await checkOverflow(page, 'symptom-check');
  await page.screenshot({ path: join(OUT, '02b-symptom-full.png'), fullPage: true });
  console.log('  shot 02b-symptom-full (full page)');

  console.log('— emergency result —');
  await page.getByRole('radio', { name: /^Vomiting: Mild$/i }).first().click();
  await page.getByRole('button', { name: /See my risk/i }).click();
  await page.waitForTimeout(600);
  await shot(page, '03-result-emergency');
  await page.screenshot({ path: join(OUT, '03b-result-emergency-full.png'), fullPage: true });
  console.log('  shot 03b (full page)');
  await checkOverflow(page, 'result');

  console.log('— care sheet —');
  await page.getByRole('button', { name: /Find a health center/i }).click();
  await shot(page, '04-care-sheet');
  await page.getByRole('button', { name: /Close/i }).first().click();
  await page.waitForTimeout(300);

  console.log('— report —');
  await page.getByRole('tab', { name: /Report/i }).click();
  await shot(page, '05-report');
  await checkOverflow(page, 'report');

  console.log('— dashboard / cartogram —');
  await page.getByRole('tab', { name: /Data/i }).click();
  await waitFor(page, '.map-cell', 'risk map');
  await shot(page, '06-dashboard');
  await page.screenshot({ path: join(OUT, '06b-dashboard-full.png'), fullPage: true });
  console.log('  shot 06b (full page)');
  await checkOverflow(page, 'dashboard');

  console.log('— region detail sheet —');
  const cell = page.locator('.map-cell').first();
  await cell.click();
  await page.waitForTimeout(500);
  await shot(page, '06c-region-detail');
  const sheetOpen = await page.locator('.sheet').count();
  if (!sheetOpen) problems.push('region detail sheet did not open on tap');
  await page.getByRole('button', { name: /Close/i }).first().click();
  await page.waitForTimeout(300);

  console.log('— Amharic —');
  // Reload so we start from the launcher. The previous pass left an emergency
  // result on screen, which is why this section originally failed to find the
  // "check symptoms" entry point. Language choice persists in localStorage.
  await page.reload(READY);
  await page.getByRole('radio', { name: /አማርኛ/ }).click();
  await page.waitForTimeout(600);
  await shot(page, '07-home-amharic');
  await page.getByRole('button', { name: /የምልክት ምልክቶችን ይፈትሱ/i }).first().click();
  await shot(page, '08-symptom-amharic');
  await page.screenshot({ path: join(OUT, '08b-symptom-amharic-full.png'), fullPage: true });
  console.log('  shot 08b (full page)');
  await checkOverflow(page, 'amharic-symptom');
  await page.screenshot({ path: join(OUT, '09-amharic-full.png'), fullPage: true });
  console.log('  shot 09 (full page)');

  console.log('— narrow 320px —');
  const ctx2 = await browser.newContext({ ...NARROW, locale: 'en-GB' });
  const p2 = await ctx2.newPage();
  await p2.goto(BASE, READY);
  await shot(p2, '10-home-320');
  await checkOverflow(p2, 'home-320');
  await p2.getByRole('button', { name: /Check symptoms/i }).first().click();
  await shot(p2, '11-symptom-320');
  await checkOverflow(p2, 'symptom-320');

  console.log('— dark mode —');
  const ctx3 = await browser.newContext({ ...PHONE, colorScheme: 'dark', locale: 'en-GB' });
  const p3 = await ctx3.newPage();
  await p3.goto(BASE, READY);
  await shot(p3, '12-home-dark');
  await p3.getByRole('button', { name: /Check symptoms/i }).first().click();
  await p3.getByRole('radio', { name: /^Vomiting: Mild$/i }).first().click();
  await p3.getByRole('button', { name: /See my risk/i }).click();
  await p3.waitForTimeout(600);
  await shot(p3, '13-result-dark');
  await ctx3.close();
  await ctx2.close();

  console.log(`\n${problems.length === 0 ? 'NO PROBLEMS FOUND' : `${problems.length} PROBLEM(S):`}`);
  for (const p of problems) console.log(`  - ${p}`);
} finally {
  await browser.close();
}
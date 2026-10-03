import { beforeEach, describe, expect, it, vi } from 'vitest';
import { REGIONS, findRegion } from './geo';
import type { RiskLevel } from './redflags';
import { enrichWithLiveClimate, estimateAllRegions, estimateRegion, rankByRisk } from './regionalRisk';

/**
 * The weather API is mocked for the whole file.
 *
 * These tests are about scheduling and failure handling, not about Open-Meteo.
 * Hitting the real network made them intermittently fail on a slow connection,
 * and a suite that fails at random stops being evidence of anything — which is
 * especially bad for the modules a health decision depends on.
 */
const liveClimate = vi.fn();
vi.mock('./climate', () => ({
  getClimate: (...args: unknown[]) => liveClimate(...args),
}));

const GA = findRegion('GA')!;

/** A plausible live observation for the lowlands. */
function live(lowland: boolean) {
  return {
    rainfallMm: lowland ? 200 : 20,
    rainfallNormMm: 150,
    tempAvgC: lowland ? 27 : 16,
    humidityPct: 75,
    caseRatePer100k: 0,
    live: true,
  };
}

const PEAK = new Date(2026, 9, 15); // October
const LOW = new Date(2026, 5, 15); // June

describe('estimateAllRegions', () => {
  it('returns a risk for every region, with no network at all', () => {
    const map = estimateAllRegions(PEAK);
    expect(map.size).toBe(REGIONS.length);
    for (const region of REGIONS) {
      expect(map.has(region.code), region.code).toBe(true);
    }
  });

  it('always produces a valid band and a 0..1 score', () => {
    for (const [, risk] of estimateAllRegions(PEAK)) {
      expect(['low', 'moderate', 'high', 'emergency']).toContain(risk.level);
      expect(risk.score).toBeGreaterThanOrEqual(0);
      expect(risk.score).toBeLessThanOrEqual(1);
    }
  });

  it('marks every calendar estimate as not live, so the UI never overstates it', () => {
    for (const [, risk] of estimateAllRegions(PEAK)) {
      expect(risk.live).toBe(false);
    }
  });

  it('reports no community case rate, because none has been observed', () => {
    // The point of the whole module: absent a backend, the community term must
    // not silently borrow a plausible-looking number.
    for (const [, risk] of estimateAllRegions(PEAK)) {
      expect(risk.caseRatePer100k).toBe(0);
    }
  });

  it('ranks the hot western lowlands above the cool highlands', () => {
    const map = estimateAllRegions(PEAK);
    const gambela = map.get('GA')!;
    const addis = map.get('AA')!;
    expect(gambela.score).toBeGreaterThan(addis.score);
  });

  it('rates every region higher in the main season than in the low season', () => {
    const peak = estimateAllRegions(PEAK);
    const low = estimateAllRegions(LOW);
    for (const region of REGIONS) {
      expect(peak.get(region.code)!.score, region.code).toBeGreaterThan(low.get(region.code)!.score);
    }
  });

  it('separates lowland from highland even in the quiet season', () => {
    const low = estimateAllRegions(LOW);
    expect(low.get('GA')!.score).toBeGreaterThan(low.get('AA')!.score);
  });

  it('does NOT render a flat, single-colour map', () => {
    // Regression guard. An arbitrary temperature divisor once put every region
    // inside the optimal band, so all 14 scored an identical temperature term
    // and the map came out one uniform colour — technically valid, useless to
    // anyone deciding where to sleep. The score must actually vary.
    const map = estimateAllRegions(PEAK);
    const scores = [...map.values()].map((r) => r.score);
    const spread = Math.max(...scores) - Math.min(...scores);
    expect(spread, `score spread was only ${spread.toFixed(3)}`).toBeGreaterThan(0.15);
  });

  it('varies the temperature term across elevation', () => {
    const map = estimateAllRegions(PEAK);
    const temps = new Set([...map.values()].map((r) => r.breakdown!.parts.temperature));
    expect(temps.size, 'temperature term was identical for every region').toBeGreaterThan(1);
  });

  it('derives temperature from the standard lapse rate, not a guess', () => {
    // ~6.5°C per 1000m from a ~30°C tropical baseline.
    const map = estimateAllRegions(PEAK);
    const addis = map.get('AA')!;
    const gambela = map.get('GA')!;
    expect(addis.breakdown!.parts.temperature).toBe(0); // ~15°C: too cool to transmit
    expect(gambela.breakdown!.parts.temperature).toBe(1); // ~27°C: optimal
  });

  it('puts the highland capital in a lower band than the hot lowlands', () => {
    const order: RiskLevel[] = ['low', 'moderate', 'high', 'emergency'];
    const map = estimateAllRegions(PEAK);
    expect(order.indexOf(map.get('AA')!.level)).toBeLessThan(order.indexOf(map.get('GA')!.level));
  });

  it('shows every region lower in the low season than the peak season', () => {
    const peak = estimateAllRegions(PEAK);
    const low = estimateAllRegions(LOW);
    for (const region of REGIONS) {
      expect(low.get(region.code)!.score, region.code).toBeLessThan(peak.get(region.code)!.score);
    }
  });

  it('exposes the component breakdown used for the band', () => {
    const risk = estimateAllRegions(PEAK).get('GA')!;
    expect(risk.breakdown).not.toBeNull();
    // Gambia sits in the lowlands, so the elevation term should be at maximum.
    expect(risk.breakdown!.parts.elevation).toBe(1);
  });

  it('is deterministic for a given date', () => {
    const a = estimateAllRegions(PEAK).get('OR')!;
    const b = estimateAllRegions(PEAK).get('OR')!;
    expect(a.score).toBe(b.score);
    expect(a.level).toBe(b.level);
  });
});

describe('estimateRegion', () => {
  it('works for a single known region', () => {
    const risk = estimateRegion('TI', PEAK);
    expect(risk?.code).toBe('TI');
    expect(risk?.breakdown).not.toBeNull();
  });

  it('returns null for an unknown code rather than throwing', () => {
    expect(estimateRegion('ZZ')).toBeNull();
    expect(estimateRegion('')).toBeNull();
  });
});

describe('rankByRisk', () => {
  it('orders descending and honours the limit', () => {
    const all = [...estimateAllRegions(PEAK).values()];
    const top = rankByRisk(all, 3);
    expect(top).toHaveLength(3);
    for (let i = 1; i < top.length; i++) {
      expect(top[i - 1]!.score).toBeGreaterThanOrEqual(top[i]!.score);
    }
  });

  it('handles a shorter list than the limit', () => {
    const all = [...estimateAllRegions(PEAK).values()].slice(0, 2);
    expect(rankByRisk(all, 5)).toHaveLength(2);
  });
});

describe('enrichWithLiveClimate', () => {
  const instant = estimateAllRegions(PEAK);

  beforeEach(() => {
    liveClimate.mockReset();
    liveClimate.mockImplementation(async (code: string) => live(code === 'GA'));
  });

  it('emits one update per region it successfully queried', async () => {
    const updates: string[] = [];
    await enrichWithLiveClimate(REGIONS, { onUpdate: (code) => updates.push(code) });
    expect(updates).toHaveLength(REGIONS.length);
    expect(new Set(updates)).toEqual(new Set(REGIONS.map((r) => r.code)));
  });

  it('marks an updated region as live so the UI stops calling it an estimate', async () => {
    let risk: { live: boolean; level: RiskLevel } | null = null;
    await enrichWithLiveClimate([GA], { onUpdate: (_c, r) => (risk = r) });
    expect(risk!.live).toBe(true);
  });

  it('keeps the calendar estimate for a region whose weather call fails', async () => {
    liveClimate.mockRejectedValue(new Error('offline'));
    const updates: string[] = [];
    // Must resolve rather than reject: callers treat failure as "keep estimate".
    await expect(enrichWithLiveClimate([GA], { onUpdate: (c) => updates.push(c) })).resolves.toBeUndefined();
    expect(updates).toEqual([]);
    expect(instant.get('GA')!.level).toBeTruthy();
  });

  it('does not blank out the estimate when one of many regions fails', async () => {
    liveClimate.mockImplementation(async (code: string) => {
      if (code === 'GA') throw new Error('boom');
      return live(false);
    });
    const updates: string[] = [];
    await enrichWithLiveClimate(REGIONS, { onUpdate: (c) => updates.push(c) });
    expect(updates).toHaveLength(REGIONS.length - 1);
    expect(updates).not.toContain('GA');
  });

  it('honours an abort signal and stops issuing work', async () => {
    const ctrl = new AbortController();
    ctrl.abort();
    const updates: string[] = [];
    await enrichWithLiveClimate(REGIONS, {
      signal: ctrl.signal,
      onUpdate: (code) => updates.push(code),
    });
    expect(updates).toEqual([]);
    expect(liveClimate).not.toHaveBeenCalled();
  });

  it('passes a supplied community case rate through to the weather lookup', async () => {
    await enrichWithLiveClimate([GA], {
      caseRateFor: (code) => (code === 'GA' ? 123 : 0),
      onUpdate: () => {},
    });
    expect(liveClimate).toHaveBeenCalledWith('GA', 123);
  });

  it('never exceeds the configured concurrency', async () => {
    let inFlight = 0;
    let peak = 0;
    liveClimate.mockImplementation(async () => {
      inFlight++;
      peak = Math.max(peak, inFlight);
      await new Promise((r) => setTimeout(r, 1));
      inFlight--;
      return live(false);
    });

    await enrichWithLiveClimate(REGIONS, { concurrency: 3, onUpdate: () => {} });
    // 14 regions at concurrency 3 must never exceed 3 in flight.
    expect(peak).toBeLessThanOrEqual(3);
    expect(peak).toBeGreaterThan(1);
  });

  it('resolves cleanly with no regions', async () => {
    const updates: string[] = [];
    await expect(enrichWithLiveClimate([], { onUpdate: (c) => updates.push(c) })).resolves.toBeUndefined();
    expect(updates).toEqual([]);
  });
});
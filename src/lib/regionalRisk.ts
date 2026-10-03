import { getClimate } from './climate';
import { REGIONS, findRegion, seasonForMonth } from './geo';
import { scoreEnvironment, type ClimateInput, type RegionMeta, type RiskBreakdown } from './risk';
import type { RiskLevel } from './redflags';

/**
 * Regional risk, computed entirely on the user's device.
 *
 * WHY THIS EXISTS
 * ---------------
 * The obvious design is "risk comes from a database of reported cases". But
 * that makes the most useful screen in the app useless until someone pays for a
 * backend, and it hides the fact that most of the signal is environmental
 * anyway. Risk is driven by temperature, rainfall, humidity and elevation —
 * all of which we can derive from a free weather API plus a static table.
 *
 * So this module separates the two things that were being conflated:
 *
 *   ENVIRONMENTAL RISK  — computable now, on-device, free, offline-capable.
 *                         This is what the map shows by default.
 *   COMMUNITY CASE RATE — observed reports from other people. Genuinely useful,
 *                         genuinely unavailable without a backend, and therefore
 *                         additive rather than load-bearing.
 *
 * The score for a region with no community data is a real, defensible estimate
 * of transmission suitability — not a placeholder. It is labelled as an estimate
 * in the UI, because a person deciding whether to sleep under a net deserves to
 * know which kind of number they are looking at.
 */

/** What the map needs to render, per region. */
export interface RegionRisk {
  readonly code: string;
  readonly level: RiskLevel;
  readonly score: number;
  /** True when backed by a live weather observation rather than the calendar. */
  readonly live: boolean;
  /** Observed case rate, only present once a backend supplies it. */
  readonly caseRatePer100k: number;
  readonly breakdown: RiskBreakdown | null;
}

/**
 * Deterministic stand-in for live weather, derived from the Ethiopian
 * transmission calendar and the region's elevation. Used for the very first
 * paint — it costs nothing, needs no network, and is good enough to act on.
 *
 * `caseRatePer100k` is passed through rather than invented. With no backend it
 * is 0, which means the community term simply does not contribute and the band
 * rests on climate and elevation alone. That is honest: we are estimating
 * whether conditions suit transmission, not counting cases.
 */
/**
 * Mean temperature for a region, from the standard atmospheric lapse rate.
 *
 * ~6.5°C lost per 1000m of elevation against a ~30°C tropical sea-level
 * baseline. This is the single most important number for Ethiopia: it puts
 * Addis Ababa (~2355m) at about 15°C and Gambela (~520m) at about 27°C, which is
 * the actual difference between a highland city where transmission barely
 * persists and a lowland where it does.
 *
 * The previous divisor of /260 produced ~21°C for Addis — warm enough to score a
 * perfect 1.0 on the temperature term — so every region saturated and the whole
 * map rendered one flat colour. Using the real lapse rate restores both accuracy
 * and the ability to tell regions apart.
 */
function calendarTemp(region: RegionMeta): number {
  return Math.max(12, 30 - (region.elevationM / 1000) * 6.5);
}

function calendarClimate(region: RegionMeta, now: Date, caseRatePer100k: number): ClimateInput {
  const month = now.getMonth() + 1;
  const season = seasonForMonth(month);

  const tempAvgC = calendarTemp(region);
  const norm = seasonalRain(region, month);

  return {
    rainfallMm: norm * season.intensity,
    rainfallNormMm: norm,
    tempAvgC,
    humidityPct: 40 + season.intensity * 40,
    caseRatePer100k,
  };
}

// Kept local so this module has no import cycle with geo.ts's rainfallNorm,
// which applies the same altitude scaling but is written for a single region.
function seasonalRain(region: RegionMeta, month: number): number {
  const LOWLAND = [15, 20, 45, 80, 90, 120, 165, 190, 150, 95, 30, 15];
  const base = LOWLAND[Math.min(11, Math.max(0, month - 1))]!;
  const scale = region.elevationM > 2000 ? 0.35 : region.elevationM > 1500 ? 0.6 : 1;
  return base * scale;
}

function toRegionRisk(region: RegionMeta, climate: ClimateInput, live: boolean): RegionRisk {
  const breakdown = scoreEnvironment(region, climate);
  return {
    code: region.code,
    level: breakdown.level,
    score: breakdown.total,
    live,
    caseRatePer100k: climate.caseRatePer100k,
    breakdown,
  };
}

/**
 * Every region's risk, instantly, with no network at all.
 *
 * This is what the map paints first. It is also the permanent fallback: if the
 * weather API is unreachable the user still gets a full map.
 */
export function estimateAllRegions(now: Date = new Date(), caseRatePer100k = 0): Map<string, RegionRisk> {
  const out = new Map<string, RegionRisk>();
  for (const region of REGIONS) {
    out.set(region.code, toRegionRisk(region, calendarClimate(region, now, caseRatePer100k), false));
  }
  return out;
}

/** One region's instant estimate, for the detail sheet before live data lands. */
export function estimateRegion(code: string, now: Date = new Date()): RegionRisk | null {
  const region = findRegion(code);
  if (!region) return null;
  return toRegionRisk(region, calendarClimate(region, now, 0), false);
}

/** How the dashboard should describe a number it is showing. */
export function provenanceOf(risk: RegionRisk, hasCommunityData: boolean): 'live' | 'estimated' {
  if (hasCommunityData) return 'live';
  return risk.live ? 'live' : 'estimated';
}

export interface EnrichOptions {
  caseRateFor?: (code: string) => number;
  onUpdate: (code: string, risk: RegionRisk) => void;
  /** Overridable for tests. */
  concurrency?: number;
  signal?: AbortSignal;
}

/**
 * Upgrade the calendar estimates with live observations, progressively.
 *
 * Deliberately NOT a `Promise.all` over all 14 regions. On the connections this
 * app targets, fourteen concurrent weather requests is a good way to burn a
 * user's data allowance and show fourteen spinners. Instead a small pool runs
 * them a few at a time and calls back per region, so the map fills in as
 * results land. A region that fails keeps its calendar estimate — a stale
 * seasonal figure is far better than a hole.
 */
export async function enrichWithLiveClimate(
  regions: readonly RegionMeta[] = REGIONS,
  { caseRateFor, onUpdate, concurrency = 4, signal }: EnrichOptions = { onUpdate: () => {} },
): Promise<void> {
  const queue = [...regions];
  const workers = Array.from({ length: Math.min(concurrency, queue.length) }, async () => {
    for (;;) {
      const region = queue.shift();
      if (!region) return;
      if (signal?.aborted) return;
      try {
        const caseRate = caseRateFor?.(region.code) ?? 0;
        const climate = await getClimate(region.code, caseRate);
        if (signal?.aborted) return;
        onUpdate(region.code, toRegionRisk(region, climate, climate.live));
      } catch {
        // Keep the calendar estimate. Never blank a region because one request
        // failed — a map with a hole is worse than a map that is a month coarse.
      }
    }
  });

  await Promise.all(workers);
}

/** Highest-risk regions first, for the "top regions" list. */
export function rankByRisk(risks: Iterable<RegionRisk>, limit = 5): RegionRisk[] {
  return [...risks].sort((a, b) => b.score - a.score).slice(0, limit);
}
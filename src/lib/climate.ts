import { LOWLAND_RAINFALL_NORM, REGION_CENTROIDS, findRegion, seasonForMonth } from './geo';
import type { ClimateInput } from './risk';

/**
 * Climate lookup from Open-Meteo (free, no API key, no signup).
 *
 * Malaria transmission is driven by standing water and temperature, so weather
 * is the one environmental signal we can get without a surveillance
 * partnership. It is also the signal most likely to be stale or unavailable on a
 * bad connection, which is why every function here has a deterministic
 * fallback built from the Ethiopian seasonal calendar instead of throwing.
 */

const ENDPOINT = 'https://api.open-meteo.com/v1/forecast';

export interface ClimateResult extends ClimateInput {
  /** True when the numbers came from the live API rather than the fallback. */
  live: boolean;
}

interface CachedClimate {
  at: number;
  data: ClimateInput;
}

const cache = new Map<string, CachedClimate>();
const TTL_MS = 3 * 60 * 60 * 1000; // 3 hours

/** Monthly rainfall norm for a region, in mm. */
export function rainfallNorm(regionCode: string, month: number): number {
  const region = findRegion(regionCode);
  const idx = Math.min(11, Math.max(0, month - 1));
  // The table above is lowland wet-season norms. The highlands get roughly
  // 35% of that, which is the single biggest reason transmission differs so
  // sharply between Gambela and Addis.
  const scale = region && region.elevationM > 2000 ? 0.35 : region && region.elevationM > 1500 ? 0.6 : 1;
  return LOWLAND_RAINFALL_NORM[idx]! * scale;
}

/**
 * Fallback used when the network is unavailable. Blends the regional
 * elevation prior with the seasonal calendar, so it still produces a sensible
 * ordering between regions and between months — just a coarser one.
 *
 * Uses the same standard lapse rate (~6.5°C per 1000m) as
 * lib/regionalRisk.ts, so an offline estimate and a live one stay comparable.
 */
function fallbackClimate(regionCode: string, now: Date, caseRatePer100k: number): ClimateInput {
  const month = now.getMonth() + 1;
  const season = seasonForMonth(month);
  const norm = rainfallNorm(regionCode, month);
  const region = findRegion(regionCode);
  const tempBase = region ? Math.max(12, 30 - (region.elevationM / 1000) * 6.5) : 24;

  return {
    rainfallMm: norm * season.intensity,
    rainfallNormMm: norm,
    tempAvgC: tempBase,
    humidityPct: 40 + season.intensity * 40,
    caseRatePer100k,
  };
}

/**
 * 28-day trailing climate for a region: the window the risk model expects,
 * because mosquito populations respond to weather over weeks, not days.
 *
 * `caseRatePer100k` is passed in rather than fetched here so this module stays
 * a pure climate source; the dashboard supplies the observed rate.
 */
export async function getClimate(regionCode: string, caseRatePer100k: number): Promise<ClimateResult> {
  const hit = cache.get(regionCode);
  if (hit && Date.now() - hit.at < TTL_MS) {
    return { ...hit.data, live: true };
  }

  const centroid = REGION_CENTROIDS[regionCode];
  if (!centroid) {
    return { ...fallbackClimate(regionCode, new Date(), caseRatePer100k), live: false };
  }

  const params = new URLSearchParams({
    latitude: String(centroid.lat),
    longitude: String(centroid.lon),
    daily: 'rain_sum,temperature_2m_mean,relative_humidity_2m_mean',
    timezone: 'Africa/Addis_Ababa',
    past_days: '28',
    forecast_days: '1',
  });

  try {
    // Abort rather than letting a slow link hold the UI hostage: the fallback is
    // good enough to give advice, and the user is waiting on their answer.
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 6000);
    const res = await fetch(`${ENDPOINT}?${params}`, { signal: ctrl.signal });
    clearTimeout(timer);

    if (!res.ok) throw new Error(`open-meteo ${res.status}`);
    const json = (await res.json()) as {
      daily?: {
        rain_sum?: (number | null)[];
        temperature_2m_mean?: (number | null)[];
        relative_humidity_2m_mean?: (number | null)[];
        time?: string[];
      };
    };

    const d = json.daily;
    const nums = (a?: (number | null)[]): number[] => (a ?? []).filter((v): v is number => typeof v === 'number');
    const rain = nums(d?.rain_sum);
    const temps = nums(d?.temperature_2m_mean);
    const hum = nums(d?.relative_humidity_2m_mean);
    if (!rain.length || !temps.length) throw new Error('open-meteo returned no usable daily series');

    const mean = (a: number[]): number => a.reduce((x, y) => x + y, 0) / a.length;
    const now = new Date();
    const data: ClimateInput = {
      rainfallMm: Number(mean(rain).toFixed(1)),
      rainfallNormMm: rainfallNorm(regionCode, now.getMonth() + 1),
      tempAvgC: Number(mean(temps).toFixed(1)),
      humidityPct: hum.length ? Number(mean(hum).toFixed(1)) : 65,
      caseRatePer100k,
    };

    cache.set(regionCode, { at: Date.now(), data });
    return { ...data, live: true };
  } catch {
    // Offline, blocked, or slow. Advice is still correct; only the precision
    // and the "why you are seeing this" explanation suffer.
    return { ...fallbackClimate(regionCode, new Date(), caseRatePer100k), live: false };
  }
}

/** National summary for the home screen and the dashboard header. */
export async function getNationalClimate(caseRatePer100k: number): Promise<ClimateResult> {
  return getClimate('AA', caseRatePer100k);
}

export const isClimateLive = (result: ClimateResult): boolean => result.live;
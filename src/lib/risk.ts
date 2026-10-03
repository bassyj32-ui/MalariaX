/**
 * Transparent environmental malaria risk model.
 *
 * Design constraint from the public-health literature: officials will not act on a
 * black box. So risk is a deterministic, inspectable weighted sum — the LLM is only
 * ever used to *explain* this number in plain language, never to produce it.
 *
 * Weights follow the emphasis in WHO / Frontiers (2026) precision-malaria reviews:
 * observed case rate dominates, climate modifies, elevation gates transmission.
 *
 * Every function here is pure and runs offline.
 */

import type { RiskLevel } from './redflags';
import { maxLevel } from './redflags';

export interface RegionMeta {
  readonly code: string;
  /** Translations live in i18n; these are English fallbacks / seed values. */
  readonly nameEn: string;
  readonly nameAm: string;
  /** Representative population-weighted elevation in metres. */
  readonly elevationM: number;
  /** National share of total cases, roughly 2019-2023 averages. Prior, not measurement. */
  readonly caseWeight: number;
}

export interface ClimateInput {
  /** Rainfall over the trailing window, mm. */
  readonly rainfallMm: number;
  /** Mean daily temperature over the window, °C. */
  readonly tempAvgC: number;
  /** Mean relative humidity, %. */
  readonly humidityPct: number;
  /** Long-run seasonal rainfall norm for this month/region, mm. */
  readonly rainfallNormMm: number;
  /** Trailing-window observed case rate, per 100k. */
  readonly caseRatePer100k: number;
}

export const WEIGHTS = {
  caseRate: 0.4,
  rainfallAnomaly: 0.25,
  temperature: 0.15,
  humidity: 0.1,
  elevation: 0.1,
} as const;

export const BANDS = {
  low: 0.25,
  moderate: 0.5,
  high: 0.75,
} as const;

const clamp01 = (n: number): number => (n < 0 ? 0 : n > 1 ? 1 : n);

/**
 * Case rate -> 0..1. Saturates at 400 per 100k per 28 days, which is a very high
 * transmission week. Above that we stop caring about the exact number.
 */
function normaliseCaseRate(ratePer100k: number): number {
  return clamp01(ratePer100k / 400);
}

/**
 * Rainfall anomaly -> 0..1. Standing water drives vector breeding, so *above* the
 * seasonal norm is what matters. At or below the norm scores 0; 2x the norm is 1.
 * Negative anomalies (drier than usual) still score a little, because residual
 * standing water from the previous wet period persists.
 */
function normaliseRainfallAnomaly(rainfallMm: number, normMm: number): number {
  if (normMm <= 0) return clamp01(rainfallMm / 200);
  const ratio = rainfallMm / normMm;
  if (ratio <= 1) return clamp01(ratio * 0.35);
  return clamp01(((ratio - 1) / 1 + 0.35));
}

/**
 * Temperature -> 0..1. P. falciparum completes its extrinsic incubation between
 * roughly 18C and 32C, peaking near 25-30C. Scores 0 outside 15-35C entirely.
 */
function normaliseTemperature(tempC: number): number {
  if (tempC < 15 || tempC > 35) return 0;
  if (tempC >= 20 && tempC <= 30) return 1;
  // Taper down toward the edges of the viable window.
  return tempC < 20 ? clamp01((tempC - 15) / 5) : clamp01((35 - tempC) / 5);
}

/** Humidity -> 0..1. Vector survival falls off sharply as humidity drops. */
function normaliseHumidity(humidityPct: number): number {
  return clamp01((humidityPct - 35) / 50);
}

/**
 * Elevation -> 0..1. Transmission in Ethiopia is overwhelmingly a lowland problem;
 * the highlands above ~2000m are largely too cool for sustained transmission.
 */
function normaliseElevation(elevationM: number): number {
  if (elevationM <= 1500) return 1;
  if (elevationM >= 2200) return 0;
  return clamp01((2200 - elevationM) / 700);
}

export interface RiskBreakdown {
  readonly total: number;
  readonly level: RiskLevel;
  readonly parts: Readonly<Record<keyof typeof WEIGHTS, number>>;
}

/** Environmental risk for a region given current climate + observed reports. */
export function scoreEnvironment(region: RegionMeta, climate: ClimateInput): RiskBreakdown {
  const parts = {
    caseRate: normaliseCaseRate(climate.caseRatePer100k),
    rainfallAnomaly: normaliseRainfallAnomaly(climate.rainfallMm, climate.rainfallNormMm),
    temperature: normaliseTemperature(climate.tempAvgC),
    humidity: normaliseHumidity(climate.humidityPct),
    elevation: normaliseElevation(region.elevationM),
  };

  const total =
    parts.caseRate * WEIGHTS.caseRate +
    parts.rainfallAnomaly * WEIGHTS.rainfallAnomaly +
    parts.temperature * WEIGHTS.temperature +
    parts.humidity * WEIGHTS.humidity +
    parts.elevation * WEIGHTS.elevation;

  return { total, level: bandFor(total), parts };
}

export function bandFor(score: number): RiskLevel {
  if (score < BANDS.low) return 'low';
  if (score < BANDS.moderate) return 'moderate';
  if (score < BANDS.high) return 'high';
  return 'emergency';
}

/**
 * Combine environmental risk with the individual's clinical presentation.
 *
 * Environmental risk RAISES urgency (living in a hot, wet, low-lying, high-burden
 * area while febrile is more worrying than the same fever in a cool highland city).
 * It must never *lower* an escalated clinical verdict — `maxLevel` guarantees that,
 * and clinical escalation always wins ties.
 */
export function combine(
  environmental: RiskLevel,
  clinical: RiskLevel,
): RiskLevel {
  return maxLevel(environmental, clinical);
}

export interface Input {
  readonly region: RegionMeta | null;
  readonly climate: ClimateInput;
  readonly clinical: RiskLevel;
  /** When clinical escalation came from a hard danger sign, we refuse to soften it. */
  readonly forcedEmergency?: boolean;
}

export interface Assessment {
  readonly level: RiskLevel;
  readonly environmental: RiskBreakdown | null;
  readonly forcedEmergency: boolean;
}

/**
 * The single entry point used by the app. Deliberately small and total so it can be
 * exhaustively unit-tested — see src/lib/risk.test.ts.
 */
export function assess(input: Input): Assessment {
  const environmental = input.region ? scoreEnvironment(input.region, input.climate) : null;
  if (!environmental) {
    return { level: input.clinical, environmental: null, forcedEmergency: input.forcedEmergency ?? false };
  }
  const level = input.forcedEmergency
    ? 'emergency'
    : combine(environmental.level, input.clinical);
  return { level, environmental, forcedEmergency: input.forcedEmergency ?? false };
}
/**
 * Ethiopian administrative + epidemiological reference data.
 *
 * PROVENANCE NOTE — READ BEFORE TRUSTING THE NUMBERS
 * ----------------------------------------------------
 * `caseWeight` values are coarse priors approximating each region's share of
 * national malaria burden. They are seed values for a cold-start dashboard,
 * NOT measurements. Once `risk_snapshots` is populated from real submitted
 * reports, `caseWeight` stops being used for scoring entirely (see
 * `caseRatePer100k` in risk.ts). They exist so the dashboard shows something
 * structurally plausible before any data arrives, and so cold-start regions
 * are not all scored identically.
 *
 * `elevationM` is a representative population-weighted elevation, sufficient
 * for the coarse elevation term. Ethiopia's transmission gradient is dominated
 * by the ~1500-2200m divide, which these values capture.
 *
 * ZONE/WOREDA DATA IS DELIBERATELY ABSENT. Administrative division lists in
 * Ethiopia have been repeatedly restructured (Central Ethiopia, South Ethiopia
 * and Southwest Ethiopia Peoples' Region were all created 2021-2023; Sidama
 * split off in 2020). Shipping a hand-typed zone list that has silently drifted
 * from reality would corrupt a public-health dataset, which is worse than being
 * coarser. MVP reports at region granularity only; the schema already carries
 * nullable zone/woreda columns for when a verified dataset is supplied.
 */

import type { RegionMeta } from './risk';

export const REGIONS: readonly RegionMeta[] = [
  { code: 'AA', nameEn: 'Addis Ababa',        nameAm: 'አዲስ አበባ',          elevationM: 2355, caseWeight: 0.005 },
  { code: 'AF', nameEn: 'Afar',               nameAm: 'አፋር',                elevationM: 900,  caseWeight: 0.055 },
  { code: 'AM', nameEn: 'Amhara',             nameAm: 'አማራ',                elevationM: 1900, caseWeight: 0.155 },
  { code: 'BG', nameEn: 'Benishangul-Gumuz',  nameAm: 'ቤንሻንጉል-ጉሙዝ',         elevationM: 1100, caseWeight: 0.075 },
  { code: 'CE', nameEn: 'Central Ethiopia',   nameAm: 'ማዕከላዊ ኢትዮጵያ',          elevationM: 2000, caseWeight: 0.030 },
  { code: 'DD', nameEn: 'Dire Dawa',          nameAm: 'ድሬዳዋ',               elevationM: 1180, caseWeight: 0.018 },
  { code: 'GA', nameEn: 'Gambela',            nameAm: 'ጋምቤላ',               elevationM: 520,  caseWeight: 0.115 },
  { code: 'HA', nameEn: 'Harari',             nameAm: 'ሐረሪ',                elevationM: 1900, caseWeight: 0.007 },
  { code: 'OR', nameEn: 'Oromia',             nameAm: 'ኦሮሚያ',               elevationM: 1700, caseWeight: 0.200 },
  { code: 'SI', nameEn: 'Sidama',             nameAm: 'ሲዳማ',                elevationM: 1900, caseWeight: 0.045 },
  { code: 'SO', nameEn: 'Somali',             nameAm: 'ሶማሌ',                elevationM: 900,  caseWeight: 0.065 },
  { code: 'SE', nameEn: 'South Ethiopia',     nameAm: 'ደቡብ ኢትዮጵያ',           elevationM: 1900, caseWeight: 0.058 },
  { code: 'SW', nameEn: 'Southwest Ethiopia', nameAm: 'ደቡብ-ምዕራብ ኢትዮጵያ',      elevationM: 1700, caseWeight: 0.097 },
  { code: 'TI', nameEn: 'Tigray',             nameAm: 'ትግራይ',               elevationM: 1450, caseWeight: 0.075 },
] as const;

export const REGION_BY_CODE: ReadonlyMap<string, RegionMeta> = new Map(
  REGIONS.map((r) => [r.code, r]),
);

export const findRegion = (code: string | null | undefined): RegionMeta | null =>
  code ? REGION_BY_CODE.get(code) ?? null : null;

/**
 * Approximate centroid per region, used to query Open-Meteo.
 * Deliberately approximate — climate varies within a region anyway, and a
 * centroid keeps the app from needing a GPS prompt it does not otherwise want.
 */
export const REGION_CENTROIDS: Readonly<Record<string, { lat: number; lon: number }>> = {
  AA: { lat: 9.03, lon: 38.74 },
  AF: { lat: 11.77, lon: 40.97 },
  AM: { lat: 11.59, lon: 37.95 },
  BG: { lat: 9.9, lon: 35.5 },
  CE: { lat: 8.5, lon: 39.27 },
  DD: { lat: 9.59, lon: 41.86 },
  GA: { lat: 8.25, lon: 34.58 },
  HA: { lat: 9.31, lon: 42.12 },
  OR: { lat: 7.9, lon: 39.0 },
  SI: { lat: 6.83, lon: 38.5 },
  SO: { lat: 6.85, lon: 47.5 },
  SE: { lat: 6.5, lon: 38.5 },
  SW: { lat: 7.0, lon: 36.5 },
  TI: { lat: 13.5, lon: 39.0 },
};

/**
 * Ethiopia transmission seasonality.
 *
 * Ethiopia's pattern is dominated by a single main transmission season that
 * FOLLOWS the main rains, because standing water must persist long enough for
 * mosquitoes to breed and for sporozoites to mature. Peak is roughly
 * September-December nationwide; a shorter secondary peak follows the spring
 * rains in much of the lowlands.
 *
 * `intensity` is a 0..1 multiplier on the seasonal component of the
 * environmental prior, used when climate data is unavailable (offline, or the
 * Open-Meteo call failed). It is intentionally coarse.
 */
export type SeasonKey = 'low' | 'building' | 'peak' | 'declining';

export interface SeasonInfo {
  readonly key: SeasonKey;
  readonly intensity: number;
}

export function seasonForMonth(month: number): SeasonInfo {
  // month is 1-12
  if (month >= 9 && month <= 12) return { key: 'peak', intensity: 1.0 };
  if (month === 8) return { key: 'building', intensity: 0.75 };
  if (month >= 1 && month <= 2) return { key: 'declining', intensity: 0.45 };
  if (month >= 3 && month <= 5) return { key: 'building', intensity: 0.5 };
  if (month >= 6 && month <= 7) return { key: 'low', intensity: 0.2 };
  return { key: 'low', intensity: 0.25 };
}

/**
 * Approximate grid placement for the dashboard cartogram, expressed as
 * (column, row) on a 6x5 grid. Chosen to preserve the two facts that matter
 * for transmission risk: the cool highland core (Addis, Amhara, Tigray) sits
 * centre-north, and the hot western lowlands (Gambela, Benishangul, South
 * Oromia) sit west and southwest.
 *
 * This positions TILES, not borders. It makes no claim about where any region
 * boundary actually runs.
 */
export const REGION_GRID_POSITION: Readonly<Record<string, { col: number; row: number }>> = {
  TI: { col: 4, row: 1 },
  BG: { col: 2, row: 2 },
  AM: { col: 3, row: 2 },
  AF: { col: 5, row: 2 },
  DD: { col: 6, row: 2 },
  SO: { col: 6, row: 3 },
  GA: { col: 2, row: 3 },
  OR: { col: 3, row: 3 },
  AA: { col: 4, row: 3 },
  HA: { col: 5, row: 3 },
  CE: { col: 4, row: 4 },
  SI: { col: 3, row: 4 },
  SW: { col: 2, row: 4 },
  SE: { col: 3, row: 5 },
};

/** Month normals (mm) for the wet lowlands; used when live climate is unavailable. */
export const LOWLAND_RAINFALL_NORM: readonly number[] = [
  15, 20, 45, 80, 90, 120, 165, 190, 150, 95, 30, 15,
];
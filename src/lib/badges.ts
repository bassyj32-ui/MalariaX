/**
 * Badges and streaks.
 *
 * Deliberately local-first: a reporter earns their badge the instant they press
 * send, on the device, whether or not the network is there. Server sync of
 * `user_stats` happens in the background and is a convenience, not a gate.
 *
 * All date maths uses local calendar days, not UTC, because a streak that resets
 * at 2am UTC would feel broken to someone in Addis Ababa (UTC+3).
 */

export const BADGE_IDS = [
  'first',
  'five',
  'streak3',
  'streak7',
  'localHero',
] as const;

export type BadgeId = (typeof BADGE_IDS)[number];

export const POINTS_PER_REPORT = 10;
export const POINTS_FIRST = 25;

export interface Progress {
  reportsCount: number;
  currentStreak: number;
  longestStreak: number;
  points: number;
  lastReportDate: string | null;
  badges: BadgeId[];
}

export const emptyProgress = (): Progress => ({
  reportsCount: 0,
  currentStreak: 0,
  longestStreak: 0,
  points: 0,
  lastReportDate: null,
  badges: [],
});

/** `YYYY-MM-DD` in the device's own timezone. */
export function localDateKey(d: Date = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** Whole days between two local date keys. */
export function daysBetween(a: string, b: string): number {
  const [ay, am, ad] = a.split('-').map(Number) as [number, number, number];
  const [by, bm, bd] = b.split('-').map(Number) as [number, number, number];
  const da = Date.UTC(ay, am - 1, ad);
  const db = Date.UTC(by, bm - 1, bd);
  return Math.round((db - da) / 86_400_000);
}

export interface BadgeAward {
  earned: BadgeId[];
  progress: Progress;
}

/**
 * Register a report and return the updated progress plus any newly earned
 * badges. Pure, so the whole streak/badge surface is unit-testable.
 *
 * Two reports on the same calendar day count once toward the streak but still
 * count toward the total and points — a user in the field should not be
 * penalised, or confused, by submitting twice.
 */
export function registerReport(previous: Progress, today: Date = new Date()): BadgeAward {
  const key = localDateKey(today);
  const prev = previous ?? emptyProgress();

  const gap = prev.lastReportDate ? daysBetween(prev.lastReportDate, key) : null;
  const reportsCount = prev.reportsCount + 1;

  let currentStreak: number;
  if (gap === null) {
    currentStreak = 1;
  } else if (gap === 0) {
    currentStreak = Math.max(1, prev.currentStreak);
  } else if (gap === 1) {
    currentStreak = prev.currentStreak + 1;
  } else {
    currentStreak = 1;
  }

  const longestStreak = Math.max(prev.longestStreak, currentStreak);

  // First report of the day grants points; repeats do not, so the counter cannot
  // be farmed by tapping send repeatedly.
  const isFirstToday = gap !== 0;
  const points = prev.points + (isFirstToday ? POINTS_PER_REPORT + (reportsCount === 1 ? POINTS_FIRST : 0) : 0);

  const badges = new Set<BadgeId>(prev.badges);
  const earned: BadgeId[] = [];

  const grant = (id: BadgeId): void => {
    if (!badges.has(id)) {
      badges.add(id);
      earned.push(id);
    }
  };

  if (reportsCount >= 1) grant('first');
  if (reportsCount >= 5) grant('five');
  if (currentStreak >= 3) grant('streak3');
  if (currentStreak >= 7) grant('streak7');
  if (currentStreak >= 14) grant('localHero');

  return {
    earned,
    progress: {
      reportsCount,
      currentStreak,
      longestStreak,
      points,
      lastReportDate: key,
      badges: [...badges],
    },
  };
}

export interface BadgeDef {
  readonly id: BadgeId;
  /** i18n key under `report.badges.` */
  readonly labelKey: string;
  /** What the user must do to earn it. */
  readonly criteria: 'reports' | 'streak';
  readonly threshold: number;
}

export const BADGE_DEFS: readonly BadgeDef[] = [
  { id: 'first', labelKey: 'report.badges.first', criteria: 'reports', threshold: 1 },
  { id: 'five', labelKey: 'report.badges.five', criteria: 'reports', threshold: 5 },
  { id: 'streak3', labelKey: 'report.badges.streak3', criteria: 'streak', threshold: 3 },
  { id: 'streak7', labelKey: 'report.badges.streak7', criteria: 'streak', threshold: 7 },
  { id: 'localHero', labelKey: 'report.badges.localHero', criteria: 'streak', threshold: 14 },
];

/** How many more reports (or days) until the next unearned badge. */
export function nextBadge(progress: Progress): { def: BadgeDef; remaining: number } | null {
  for (const def of BADGE_DEFS) {
    if (progress.badges.includes(def.id)) continue;
    const have = def.criteria === 'reports' ? progress.reportsCount : progress.currentStreak;
    return { def, remaining: Math.max(0, def.threshold - have) };
  }
  return null;
}

export function badgeProgress(progress: Progress, def: BadgeDef): number {
  const have = def.criteria === 'reports' ? progress.reportsCount : progress.currentStreak;
  return Math.min(1, have / def.threshold);
}
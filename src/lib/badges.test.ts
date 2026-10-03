import { describe, expect, it } from 'vitest';
import {
  BADGE_DEFS,
  badgeProgress,
  daysBetween,
  emptyProgress,
  localDateKey,
  nextBadge,
  POINTS_FIRST,
  registerReport,
  type Progress,
} from './badges';

const d = (iso: string): Date => new Date(iso);

describe('localDateKey', () => {
  it('uses local calendar components, not UTC', () => {
    // 23:30 local on the 3rd must key to the 3rd even though UTC may say the 4th.
    const late = new Date(2026, 8, 3, 23, 30, 0);
    expect(localDateKey(late)).toBe('2026-09-03');
    const early = new Date(2026, 8, 4, 0, 30, 0);
    expect(localDateKey(early)).toBe('2026-09-04');
  });
});

describe('daysBetween', () => {
  it('is zero for the same day and one across a month boundary', () => {
    expect(daysBetween('2026-09-03', '2026-09-03')).toBe(0);
    expect(daysBetween('2026-08-31', '2026-09-01')).toBe(1);
    expect(daysBetween('2026-09-01', '2026-08-31')).toBe(-1);
  });

  it('spans a leap day correctly', () => {
    expect(daysBetween('2028-02-28', '2028-03-01')).toBe(2);
  });
});

describe('registerReport — first report', () => {
  it('starts a streak and awards the first badge', () => {
    const { progress, earned } = registerReport(emptyProgress(), d('2026-09-01T09:00:00'));
    expect(progress.reportsCount).toBe(1);
    expect(progress.currentStreak).toBe(1);
    expect(progress.points).toBe(POINTS_FIRST + 10);
    expect(earned).toContain('first');
  });
});

describe('registerReport — streaks', () => {
  it('increments on consecutive days', () => {
    let p = emptyProgress();
    p = registerReport(p, d('2026-09-01T10:00:00')).progress;
    p = registerReport(p, d('2026-09-02T10:00:00')).progress;
    p = registerReport(p, d('2026-09-03T10:00:00')).progress;
    expect(p.currentStreak).toBe(3);
    expect(p.reportsCount).toBe(3);
  });

  it('resets the streak after a missed day but keeps the total', () => {
    let p = emptyProgress();
    p = registerReport(p, d('2026-09-01T10:00:00')).progress;
    p = registerReport(p, d('2026-09-02T10:00:00')).progress;
    // skip the 3rd
    p = registerReport(p, d('2026-09-04T10:00:00')).progress;
    expect(p.currentStreak).toBe(1);
    expect(p.reportsCount).toBe(3);
    expect(p.longestStreak).toBe(2);
  });

  it('remembers the longest streak even after a reset', () => {
    let p = emptyProgress();
    for (const day of ['01', '02', '03', '04', '05']) {
      p = registerReport(p, d(`2026-09-${day}T10:00:00`)).progress;
    }
    expect(p.longestStreak).toBe(5);
    p = registerReport(p, d('2026-09-20T10:00:00')).progress;
    expect(p.currentStreak).toBe(1);
    expect(p.longestStreak).toBe(5);
  });

  it('does not award streak points twice in one day', () => {
    let p = emptyProgress();
    p = registerReport(p, d('2026-09-01T09:00:00')).progress;
    const pointsAfterFirst = p.points;
    p = registerReport(p, d('2026-09-01T21:00:00')).progress;
    expect(p.points).toBe(pointsAfterFirst);
    expect(p.reportsCount).toBe(2);
    expect(p.currentStreak).toBe(1);
  });

  it('keeps a streak alive across a month boundary', () => {
    let p = emptyProgress();
    p = registerReport(p, d('2026-08-30T10:00:00')).progress;
    p = registerReport(p, d('2026-08-31T10:00:00')).progress;
    p = registerReport(p, d('2026-09-01T10:00:00')).progress;
    expect(p.currentStreak).toBe(3);
  });
});

describe('registerReport — badge awarding', () => {
  it('awards the five-report badge on the fifth report', () => {
    let p = emptyProgress();
    let lastEarned: string[] = [];
    for (let i = 1; i <= 5; i++) {
      const r = registerReport(p, d(`2026-09-${String(i).padStart(2, '0')}T10:00:00`));
      p = r.progress;
      lastEarned = r.earned;
    }
    expect(p.reportsCount).toBe(5);
    expect(p.badges).toContain('five');
    expect(lastEarned).toContain('five');
  });

  it('never awards the same badge twice', () => {
    let p = emptyProgress();
    for (let i = 1; i <= 8; i++) {
      const r = registerReport(p, d(`2026-09-${String(i).padStart(2, '0')}T10:00:00`));
      p = r.progress;
      if (i > 1) expect(r.earned).not.toContain('first');
    }
    expect(new Set(p.badges).size).toBe(p.badges.length);
  });

  it('reaches the local-hero badge on a 14-day streak', () => {
    let p = emptyProgress();
    const start = new Date(2026, 0, 1);
    for (let i = 0; i < 14; i++) {
      const day = new Date(start);
      day.setDate(start.getDate() + i);
      p = registerReport(p, day).progress;
    }
    expect(p.currentStreak).toBe(14);
    expect(p.badges).toContain('localHero');
  });
});

describe('registerReport — robustness', () => {
  it('never loses the total or the longest streak across many reports', () => {
    let p = emptyProgress();
    // Alternating gaps so the streak resets constantly.
    for (let i = 0; i < 20; i++) {
      const day = new Date(2026, 0, 1 + i * 2);
      p = registerReport(p, day).progress;
    }
    expect(p.reportsCount).toBe(20);
    expect(p.points).toBeGreaterThan(0);
    expect(p.longestStreak).toBe(1);
  });

  it('is a no-op on streaks but still counts reports when called twice a day', () => {
    let p: Progress = emptyProgress();
    p = registerReport(p, d('2026-09-01T08:00:00')).progress;
    const streak = p.currentStreak;
    p = registerReport(p, d('2026-09-01T19:00:00')).progress;
    expect(p.currentStreak).toBe(streak);
    expect(p.reportsCount).toBe(2);
  });

  it('handles a clock that jumps backwards without producing negative streaks', () => {
    let p = emptyProgress();
    p = registerReport(p, d('2026-09-10T10:00:00')).progress;
    // Device clock corrected backwards by a day.
    p = registerReport(p, d('2026-09-09T10:00:00')).progress;
    expect(p.currentStreak).toBeGreaterThanOrEqual(1);
    expect(p.reportsCount).toBe(2);
  });
});

describe('nextBadge', () => {
  it('returns the nearest unearned badge', () => {
    let p = emptyProgress();
    p = registerReport(p, d('2026-09-01T10:00:00')).progress;
    const next = nextBadge(p);
    expect(next?.def.id).toBe('five');
    expect(next?.remaining).toBe(4);
  });

  it('skips a badge already earned in favour of a nearer one', () => {
    const p: Progress = { ...emptyProgress(), reportsCount: 5, badges: ['first', 'five'] };
    expect(nextBadge(p)?.def.id).toBe('streak3');
  });

  it('returns null when everything is earned', () => {
    const p: Progress = {
      ...emptyProgress(),
      reportsCount: 40,
      currentStreak: 40,
      badges: [...BADGE_DEFS.map((x) => x.id)],
    };
    expect(nextBadge(p)).toBeNull();
  });
});

describe('badgeProgress', () => {
  it('clamps to 0..1', () => {
    const five = BADGE_DEFS.find((b) => b.id === 'five')!;
    expect(badgeProgress({ ...emptyProgress(), reportsCount: 0 }, five)).toBe(0);
    expect(badgeProgress({ ...emptyProgress(), reportsCount: 3 }, five)).toBeCloseTo(0.6);
    expect(badgeProgress({ ...emptyProgress(), reportsCount: 99 }, five)).toBe(1);
  });
});
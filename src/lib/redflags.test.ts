import { describe, expect, it } from 'vitest';
import {
  countPresent,
  evaluateRedFlags,
  isEmpty,
  maxLevel,
  type RiskLevel,
  type SymptomMap,
} from './redflags';

describe('evaluateRedFlags — hard danger signs', () => {
  it('forces EMERGENCY on vomiting, regardless of anything else', () => {
    const r = evaluateRedFlags({ vomiting: 'mild' });
    expect(r.level).toBe('emergency');
    expect(r.forcedEmergency).toBe(true);
    expect(r.presentFlags).toContain('vomiting');
  });

  it('forces EMERGENCY on severe weakness even with no fever', () => {
    const r = evaluateRedFlags({ weakness: 'severe' });
    expect(r.level).toBe('emergency');
    expect(r.forcedEmergency).toBe(true);
  });

  it('treats every non-none severity of a danger sign as emergency', () => {
    for (const sev of ['mild', 'moderate', 'severe'] as const) {
      expect(evaluateRedFlags({ vomiting: sev }).level).toBe('emergency');
    }
  });

  it('reports which danger signs are present', () => {
    const r = evaluateRedFlags({ vomiting: 'mild', weakness: 'severe' });
    expect([...r.presentFlags].sort()).toEqual(['vomiting', 'weakness']);
  });
});

describe('evaluateRedFlags — combination rules', () => {
  it('escalates pallor + severe chills to high', () => {
    expect(evaluateRedFlags({ paleEyes: 'moderate', chills: 'severe' }).level).toBe('high');
    expect(evaluateRedFlags({ paleEyes: 'moderate', sweating: 'severe' }).level).toBe('high');
  });

  it('escalates fever + headache (no danger sign) only to moderate', () => {
    expect(evaluateRedFlags({ fever: 'moderate', headache: 'moderate' }).level).toBe('moderate');
  });

  it('vomiting dominates every combination rule, so none can lower it to high', () => {
    // Regression guard: rules referencing a hard danger sign are unreachable,
    // because the override fires first. Assert the dominance explicitly.
    const extras: SymptomMap[] = [
      { fever: 'moderate' },
      { fever: 'moderate', headache: 'mild' },
      { fever: 'severe', paleEyes: 'severe', sweating: 'severe' },
      {},
    ];
    for (const extra of extras) {
      expect(evaluateRedFlags({ ...extra, vomiting: 'mild' }).level).toBe('emergency');
      expect(evaluateRedFlags({ ...extra, weakness: 'severe' }).level).toBe('emergency');
    }
  });

  it('treats fever + chills as moderate', () => {
    expect(evaluateRedFlags({ fever: 'moderate', chills: 'mild' }).level).toBe('moderate');
  });

  it('treats moderate fever alone as moderate', () => {
    expect(evaluateRedFlags({ fever: 'moderate' }).level).toBe('moderate');
  });

  it('treats only mild fever as low', () => {
    expect(evaluateRedFlags({ fever: 'mild' }).level).toBe('low');
  });

  it('falls back to low with no fever and no danger signs', () => {
    const r = evaluateRedFlags({ headache: 'severe', sweating: 'moderate' });
    expect(r.level).toBe('low');
    expect(r.firedRules).toContain('non_febrile');
  });

  it('returns low for a completely empty map', () => {
    expect(evaluateRedFlags({}).level).toBe('low');
  });
});

describe('evaluateRedFlags — monotonicity', () => {
  // Escalating any single symptom must never lower the verdict. This is the
  // property that makes the engine safe to reason about.
  const ladder = ['none', 'mild', 'moderate', 'severe'] as const;
  const rank: Record<RiskLevel, number> = { low: 0, moderate: 1, high: 2, emergency: 3 };

  it('never decreases risk when a symptom is escalated', () => {
    const ids = ['fever', 'chills', 'headache', 'sweating', 'paleEyes'] as const;
    for (const id of ids) {
      for (const start of ladder) {
        const base: SymptomMap = { [id]: start };
        const baseRank = rank[evaluateRedFlags(base).level];
        for (const worse of ladder) {
          if (ladder.indexOf(worse) <= ladder.indexOf(start)) continue;
          const escalated: SymptomMap = { [id]: worse };
          const nextRank = rank[evaluateRedFlags(escalated).level];
          expect(nextRank, `${id}: ${start} -> ${worse}`).toBeGreaterThanOrEqual(baseRank);
        }
      }
    }
  });

  it('escalating a danger sign always reaches emergency', () => {
    // 'none' is excluded: it means the symptom is absent, which is the whole
    // point of the `none` option in the UI.
    for (const id of ['vomiting', 'weakness'] as const) {
      for (const sev of ['mild', 'moderate', 'severe'] as const) {
        expect(evaluateRedFlags({ [id]: sev }).level, `${id}=${sev}`).toBe('emergency');
      }
    }
  });

  it('treats an explicitly-none danger sign as absent', () => {
    for (const id of ['vomiting', 'weakness'] as const) {
      const r = evaluateRedFlags({ [id]: 'none', fever: 'moderate' });
      expect(r.level, `${id}=none`).not.toBe('emergency');
      expect(r.forcedEmergency).toBe(false);
    }
  });
});

describe('maxLevel', () => {
  it('returns the more severe of two levels', () => {
    expect(maxLevel('low', 'emergency')).toBe('emergency');
    expect(maxLevel('high', 'moderate')).toBe('high');
    expect(maxLevel('moderate', 'moderate')).toBe('moderate');
  });
});

describe('helpers', () => {
  it('detects an empty submission', () => {
    expect(isEmpty({})).toBe(true);
    expect(isEmpty({ fever: 'none' })).toBe(true);
    expect(isEmpty({ fever: 'mild' })).toBe(false);
  });

  it('counts present symptoms regardless of severity', () => {
    expect(countPresent({ fever: 'mild', chills: 'severe' })).toBe(2);
    expect(countPresent({ fever: 'none', chills: 'none' })).toBe(0);
  });
});
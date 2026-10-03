import { describe, expect, it } from 'vitest';
import { findRegion, REGIONS, seasonForMonth } from './geo';
import {
  assess,
  BANDS,
  bandFor,
  combine,
  scoreEnvironment,
  WEIGHTS,
  type ClimateInput,
  type RegionMeta,
} from './risk';
import { evaluateRedFlags, type RiskLevel } from './redflags';

const GAMBELA = findRegion('GA')!;
const ADDIS = findRegion('AA')!;

const climate = (over: Partial<ClimateInput> = {}): ClimateInput => ({
  rainfallMm: 190,
  rainfallNormMm: 150,
  tempAvgC: 27,
  humidityPct: 75,
  caseRatePer100k: 300,
  ...over,
});

describe('region reference data', () => {
  it('has unique codes and weights summing to 1', () => {
    const codes = REGIONS.map((r) => r.code);
    expect(new Set(codes).size).toBe(codes.length);
    const sum = REGIONS.reduce((a, r) => a + r.caseWeight, 0);
    expect(sum).toBeCloseTo(1, 6);
  });

  it('returns null for unknown or missing codes', () => {
    expect(findRegion('ZZ')).toBeNull();
    expect(findRegion(null)).toBeNull();
    expect(findRegion(undefined)).toBeNull();
    expect(findRegion('')).toBeNull();
  });
});

describe('bandFor — band edges', () => {
  it('assigns the documented bands', () => {
    expect(bandFor(0)).toBe('low');
    expect(bandFor(0.2499)).toBe('low');
    expect(bandFor(BANDS.low)).toBe('moderate');
    expect(bandFor(BANDS.moderate)).toBe('high');
    expect(bandFor(BANDS.high)).toBe('emergency');
    expect(bandFor(1)).toBe('emergency');
  });

  it('clamps out-of-range scores rather than producing garbage bands', () => {
    expect(bandFor(-5)).toBe('low');
    expect(bandFor(99)).toBe('emergency');
  });
});

describe('scoreEnvironment — component behaviour', () => {
  it('scores a hot, wet, lowland, high-burden region as emergency', () => {
    const { total, level } = scoreEnvironment(GAMBELA, climate());
    expect(total).toBeGreaterThan(BANDS.high);
    expect(level).toBe('emergency');
  });

  it('scores the same climate in cold, dry, highland Addis as low', () => {
    const { total, level } = scoreEnvironment(
      ADDIS,
      climate({ rainfallMm: 5, rainfallNormMm: 60, tempAvgC: 16, humidityPct: 40, caseRatePer100k: 2 }),
    );
    expect(total).toBeLessThan(BANDS.low);
    expect(level).toBe('low');
  });

  it('elevation term separates lowland from highland under identical weather', () => {
    const lowland = scoreEnvironment(GAMBELA, climate({ caseRatePer100k: 100 }));
    const highland = scoreEnvironment(ADDIS, climate({ caseRatePer100k: 100 }));
    expect(lowland.parts.elevation).toBe(1);
    expect(highland.parts.elevation).toBe(0);
    expect(lowland.total).toBeGreaterThan(highland.total);
  });

  it('treats above-normal rainfall as riskier than below-normal', () => {
    const wet = scoreEnvironment(GAMBELA, climate({ rainfallMm: 300, rainfallNormMm: 100, caseRatePer100k: 100 }));
    const dry = scoreEnvironment(GAMBELA, climate({ rainfallMm: 20, rainfallNormMm: 100, caseRatePer100k: 100 }));
    expect(wet.parts.rainfallAnomaly).toBeGreaterThan(dry.parts.rainfallAnomaly);
  });

  it('gives zero temperature credit outside the viable window', () => {
    const cold = scoreEnvironment(GAMBELA, climate({ tempAvgC: 8, caseRatePer100k: 100 }));
    const hot = scoreEnvironment(GAMBELA, climate({ tempAvgC: 40, caseRatePer100k: 100 }));
    expect(cold.parts.temperature).toBe(0);
    expect(hot.parts.temperature).toBe(0);
  });

  it('gives full temperature credit in the optimal band', () => {
    const r = scoreEnvironment(GAMBELA, climate({ tempAvgC: 25, caseRatePer100k: 100 }));
    expect(r.parts.temperature).toBe(1);
  });

  it('saturates every component so total stays within 0..1', () => {
    const extreme = scoreEnvironment(
      GAMBELA,
      climate({ rainfallMm: 100000, tempAvgC: 26, humidityPct: 100, caseRatePer100k: 100000 }),
    );
    expect(extreme.total).toBeLessThanOrEqual(1);
    expect(extreme.total).toBeGreaterThanOrEqual(0);
    for (const v of Object.values(extreme.parts)) {
      expect(v).toBeLessThanOrEqual(1);
      expect(v).toBeGreaterThanOrEqual(0);
    }
  });

  it('weights sum to 1', () => {
    const total = Object.values(WEIGHTS).reduce((a, b) => a + b, 0);
    expect(total).toBeCloseTo(1, 6);
  });

  it('never throws on missing or zero rainfall norm', () => {
    expect(() => scoreEnvironment(GAMBELA, climate({ rainfallNormMm: 0 }))).not.toThrow();
  });
});

describe('combine — escalation only', () => {
  const rank: Record<RiskLevel, number> = { low: 0, moderate: 1, high: 2, emergency: 3 };
  const levels: RiskLevel[] = ['low', 'moderate', 'high', 'emergency'];

  it('takes the more severe of the two inputs', () => {
    for (const env of levels) {
      for (const clin of levels) {
        expect(rank[combine(env, clin)]).toBe(Math.max(rank[env], rank[clin]));
      }
    }
  });

  it('never lets a calm environment downgrade a severe clinical picture', () => {
    for (const clin of levels) {
      expect(combine('low', clin)).toBe(rank[clin] >= rank['low'] ? clin : 'low');
    }
  });
});

describe('assess — end-to-end escalation contract', () => {
  it('raises urgency when environment is risky and patient is febrile', () => {
    const symptoms = { fever: 'moderate', chills: 'mild' } as const;
    const clinical = evaluateRedFlags(symptoms).level;
    const calm = assess({ region: ADDIS, climate: climate({ caseRatePer100k: 0, rainfallMm: 0, rainfallNormMm: 200, tempAvgC: 10, humidityPct: 30 }), clinical });
    const risky = assess({ region: GAMBELA, climate: climate(), clinical });
    const order: RiskLevel[] = ['low', 'moderate', 'high', 'emergency'];
    expect(order.indexOf(risky.level)).toBeGreaterThan(order.indexOf(calm.level));
  });

  it('refuses to soften a forced emergency even in a calm environment', () => {
    const r = assess({
      region: ADDIS,
      climate: climate({ caseRatePer100k: 0, rainfallMm: 0, rainfallNormMm: 200, tempAvgC: 5, humidityPct: 20 }),
      clinical: 'emergency',
      forcedEmergency: true,
    });
    expect(r.level).toBe('emergency');
  });

  it('passes clinical through untouched when no region is known', () => {
    const r = assess({ region: null, climate: climate(), clinical: 'high' });
    expect(r.level).toBe('high');
    expect(r.environmental).toBeNull();
  });

  it('a danger sign plus the worst environment is still exactly emergency', () => {
    const red = evaluateRedFlags({ vomiting: 'mild' });
    const r = assess({
      region: GAMBELA,
      climate: climate({ rainfallMm: 10000, caseRatePer100k: 10000 }),
      clinical: red.level,
      forcedEmergency: red.forcedEmergency,
    });
    expect(r.level).toBe('emergency');
    expect(r.forcedEmergency).toBe(true);
  });
});

describe('seasonForMonth', () => {
  it('marks the main transmission season as peak', () => {
    for (const m of [9, 10, 11, 12]) {
      expect(seasonForMonth(m).key, `month ${m}`).toBe('peak');
    }
  });

  it('marks the dry pre-monsoon months as low', () => {
    expect(seasonForMonth(6).key).toBe('low');
    expect(seasonForMonth(7).key).toBe('low');
  });

  it('keeps intensity within 0..1 for every month', () => {
    for (let m = 1; m <= 12; m++) {
      const s = seasonForMonth(m);
      expect(s.intensity).toBeGreaterThanOrEqual(0);
      expect(s.intensity).toBeLessThanOrEqual(1);
    }
  });
});

describe('RegionMeta type contract', () => {
  it('accepts a minimal region object', () => {
    const r: RegionMeta = { code: 'XX', nameEn: 'Test', nameAm: 'ተራይ', elevationM: 1000, caseWeight: 0 };
    expect(() => scoreEnvironment(r, climate())).not.toThrow();
  });
});
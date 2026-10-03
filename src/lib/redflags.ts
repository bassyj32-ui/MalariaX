/**
 * Deterministic clinical red-flag detection.
 *
 * THIS MODULE IS A SAFETY NET, NOT A FEATURE.
 *
 * It runs BEFORE any LLM call and its verdict cannot be downgraded by the model.
 * Severe malaria can kill within 24h of first symptoms; a model that "helpfully"
 * talks someone out of urgent care is a lethal failure mode. So the rules here are
 * intentionally blunt: any severe red flag means EMERGENCY, full stop.
 *
 * References: WHO IMNCI (Integrated Management of Neonatal & Childhood Illness),
 * WHO Malaria guidelines, Ethiopian Ministry of Health national malaria protocol.
 */

export type Severity = 'none' | 'mild' | 'moderate' | 'severe';

export type RiskLevel = 'low' | 'moderate' | 'high' | 'emergency';

/** Symptoms the individual reports on. Ids are stable and used as DB keys. */
export const SYMPTOM_IDS = [
  'fever',
  'chills',
  'headache',
  'sweating',
  'nausea',
  'vomiting',
  'weakness',
  'paleEyes',
] as const;

export type SymptomId = (typeof SYMPTOM_IDS)[number];

/** symptom id -> severity selected by the user */
export type SymptomMap = Partial<Record<SymptomId, Severity>>;

/**
 * Severe danger signs. Presence at ANY severity means EMERGENCY.
 * These are the signs that distinguish uncomplicated malaria from severe malaria,
 * which requires IV artesunate and cannot wait.
 */
export const EMERGENCY_FLAGS: readonly SymptomId[] = [
  'vomiting',
  'weakness',
] as const;

/**
 * Combination rules — patterns that are dangerous even though no single
 * symptom is a red flag on its own. Ordered most-severe first.
 */
interface ComboRule {
  readonly id: string;
  readonly level: RiskLevel;
  readonly test: (s: SymptomMap) => boolean;
}

const has = (s: SymptomMap, id: SymptomId, level: Severity): boolean =>
  s[id] !== undefined && severityRank(s[id]!) >= severityRank(level);

const severityRank = (s: Severity): number =>
  s === 'severe' ? 3 : s === 'moderate' ? 2 : s === 'mild' ? 1 : 0;

/**
 * Rules escalate only. Each returns the highest level any rule justifies;
 * the caller takes the max against the environmental risk band.
 */
// NOTE: no rule here may test for `vomiting` or `weakness`. Those are hard danger
// signs handled by the override above, so any rule referencing them would be
// unreachable dead code — which is exactly what an earlier draft of this file
// contained. The monotonicity tests in redflags.test.ts guard against regressions.
const COMBO_RULES: readonly ComboRule[] = [
  {
    // Pancytopenia markers: pallor + profuse sweating/shivering = high parasitaemia.
    id: 'pallor_with_rigors',
    level: 'high',
    test: (s) => has(s, 'paleEyes', 'moderate') && (has(s, 'sweating', 'severe') || has(s, 'chills', 'severe')),
  },
  {
    // Fever plus chills is essentially a malaria signature.
    id: 'fever_plus_chills',
    level: 'moderate',
    test: (s) => has(s, 'fever', 'moderate') && has(s, 'chills', 'mild'),
  },
  {
    // Fever alone, at least moderate, is the minimum bar for further assessment.
    id: 'fever_alone',
    level: 'moderate',
    test: (s) => has(s, 'fever', 'moderate'),
  },
  {
    // Low-grade fever only — watch and wait, but not nothing.
    id: 'low_grade_fever',
    level: 'low',
    test: (s) => has(s, 'fever', 'mild'),
  },
  {
    // No fever at all: these still matter but are not a malaria presentation.
    id: 'non_febrile',
    level: 'low',
    test: () => true,
  },
];

const LEVEL_RANK: Record<RiskLevel, number> = {
  low: 0,
  moderate: 1,
  high: 2,
  emergency: 3,
};

export const maxLevel = (a: RiskLevel, b: RiskLevel): RiskLevel =>
  LEVEL_RANK[a] >= LEVEL_RANK[b] ? a : b;

export interface RedFlagResult {
  readonly level: RiskLevel;
  /** True when a hard danger sign forced EMERGENCY regardless of anything else. */
  readonly forcedEmergency: boolean;
  /** Human-readable rule ids that fired, for audit + tests. */
  readonly firedRules: readonly string[];
  /** Ids of danger signs actually present, for targeted advice rendering. */
  readonly presentFlags: readonly SymptomId[];
}

/**
 * Evaluate the symptom map. Pure, synchronous, total.
 * Runs offline. Never calls out to a model.
 */
export function evaluateRedFlags(symptoms: SymptomMap): RedFlagResult {
  const presentFlags = EMERGENCY_FLAGS.filter((id) => (symptoms[id] ?? 'none') !== 'none');

  // Hard override: danger signs present => EMERGENCY. No further reasoning.
  if (presentFlags.length > 0) {
    return {
      level: 'emergency',
      forcedEmergency: true,
      firedRules: ['severe_danger_sign'],
      presentFlags,
    };
  }

  const firedRules: string[] = [];
  let level: RiskLevel = 'low';

  for (const rule of COMBO_RULES) {
    if (rule.test(symptoms)) {
      firedRules.push(rule.id);
      level = maxLevel(level, rule.level);
      // `non_febrile` is the catch-all fallback; once it fires we are done.
      if (rule.id === 'non_febrile') break;
    }
  }

  return { level, forcedEmergency: false, firedRules, presentFlags: [] };
}

/** True when nothing at all was selected — used to block submission. */
export function isEmpty(symptoms: SymptomMap): boolean {
  return SYMPTOM_IDS.every((id) => (symptoms[id] ?? 'none') === 'none');
}

/** Number of symptoms the user marked as present (any severity). */
export function countPresent(symptoms: SymptomMap): number {
  return SYMPTOM_IDS.filter((id) => (symptoms[id] ?? 'none') !== 'none').length;
}
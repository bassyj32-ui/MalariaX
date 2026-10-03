/**
 * Thin client for the AI proxy.
 *
 * The browser never talks to DeepSeek directly. `VITE_*` variables are inlined
 * into the bundle, so a key placed there would be readable by every visitor.
 * The key lives only in the edge function's server environment.
 */

const ENDPOINT = '/api/ask';

export const isAiConfigured = Boolean(import.meta.env.VITE_AI_PROXY_URL ?? true);

/**
 * Offline fallback. Rather than showing an error when the model is
 * unreachable, answer from a small curated set. For a prevention question the
 * consensus advice is stable, so a pre-written answer is safer than nothing and
 * more honest than a guess.
 *
 * `// NEEDS CLINICIAN REVIEW` — these should be checked against Ethiopian
 * national malaria guidance before launch.
 */
const FALLBACK: { match: RegExp; answer: string }[] = [
  {
    match: /bed\s*net|net\b|መኝ\s*መረብ/i,
    answer:
      'Yes. A treated bed net is the single most effective thing you can do. It works by killing mosquitoes that land on it. Sleep under it every night — including during the day, because mosquitoes also bite in daylight. If it has a hole, patch it or replace it; nets are meant to last about three years.',
  },
  {
    match: /test|diagnos|blood|rdt|ምርመራ|ስም/i,
    answer:
      'Fever alone does not prove malaria — other illnesses look the same. Get a rapid diagnostic test or a blood test at a health center. It takes minutes, and it is the only way to be sure whether you need treatment or something else.',
  },
  {
    match: /child|baby|infant|ልጅ|ሕፃን/i,
    answer:
      'In children watch for fever, unusual sleepiness, fast breathing, refusing food or drink, and vomiting. Children who are drowsy or not drinking need care the same day, not tomorrow. Go to a health center and describe what you have noticed.',
  },
  {
    match: /spray|insecticide|indoor/i,
    answer:
      'Indoor residual spraying is safe when done by trained health workers. It leaves a residue on walls that kills mosquitoes resting there. Follow the instructions health workers give you, and tell them if anyone in the house is pregnant or has asthma.',
  },
  {
    match: /again|twice|recurr|repeat/i,
    answer:
      'Yes, you can get malaria more than once. Having it does not give you lasting protection. Each time, use a bed net and get tested if you get a fever — do not assume it is the same thing without a test.',
  },
];

export async function askQuestion(question: string, lang = 'en'): Promise<string> {
  try {
    const res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ question, lang }),
    });
    if (!res.ok) throw new Error(`proxy ${res.status}`);
    const data = (await res.json()) as { answer?: string };
    if (typeof data.answer !== 'string' || !data.answer.trim()) throw new Error('empty answer');
    return data.answer.trim();
  } catch {
    const hit = FALLBACK.find((f) => f.match.test(question));
    if (hit) return hit.answer;
    throw new Error('unavailable');
  }
}
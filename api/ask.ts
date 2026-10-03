/**
 * MalariaX — AI proxy edge function (Vercel).
 *
 * WHY THIS EXISTS
 * ---------------
 * The browser must never hold the model API key. `import.meta.env.VITE_*`
 * variables are inlined into the client bundle at build time, so a key placed
 * there is readable by every visitor with devtools — at which point it becomes
 * someone else's bill. The key lives only in this function's environment.
 *
 * The client posts to `/api/ask`; Vercel routes that to this file automatically
 * under the `/api` directory convention.
 *
 * SAFETY CONTRACT
 * ---------------
 * This endpoint answers PREVENTION questions only. It does not diagnose, does
 * not dose, and does not triage. A user asking "do I have malaria" is answered
 * with advice to get tested, never with a risk verdict — the deterministic
 * engine in src/lib/redflags.ts owns that, and it is auditable in a way a model
 * is not.
 */

export const config = { runtime: 'edge' };

const DEEPSEEK_URL = 'https://api.deepseek.com/chat/completions';
const MODEL = 'deepseek-chat';

const SYSTEM_EN = `You are a malaria prevention assistant for Ethiopia and neighbouring countries.

Rules you must follow:
- You give general health EDUCATION and PREVENTION advice only.
- You NEVER diagnose, never assess an individual's risk, and never name a treatment or dose.
- If someone describes symptoms, tell them to get a rapid diagnostic test or blood test at a health center. Fever alone cannot confirm malaria.
- If someone describes danger signs (vomiting, confusion, seizure, difficulty breathing, very dark urine, yellow eyes, extreme weakness), tell them to go to a health center immediately and not to wait.
- Be concrete and practical. Cover bed nets, indoor spraying, breeding-site clearance, seasonal timing, and protection for children and pregnancy.
- Keep it under 140 words. Plain language, short paragraphs, no markdown headings.
- End by reminding them this is general guidance, not a medical opinion.
- Answer in the same language the question was asked in.`;

const SYSTEM_AM = `የማሌጠራ ወቅ መከላከያ ረዳዳድ ነዎት — ለኢትዮጵያና ተጠባባዮቿ የሆን።

መመርድ ያስከትሉ ያለትዎት፦
- አጠቃላይ የጤና ትምህርትና መከላከያ መመሪያ ብቻ ይሰጣሉ።
- ምንም ዓለም ምርመራ ወይም የተለየ አደጋ አይሰጡም፤ መድኃኒት ወይም መጠን አይጥቀሱም።
- ምልክት ሲገለጹ በፈጣን ምርመራ ወይም በስም ምርመራ ወደ ጤና ማዕከል እንዲሄዱ ይከሉ። በፊት ብቻ የወባን መረጃ ማይሰጥ አይችልም።
- አደጋ ማስጠንቀቂያ ምልክቶች (ማስታወክ፣ ግልጽ አይደለም፣ የአንበሳ መገናኛ፣ ክብደት ያለው መተን፣ በጣም ጨለቛ የማሽን ርብጥ፣ ቢጫ ዓይን፣ እጅግ ድክምነት) ካሉ ወዲያውኑ ወደ ጤና ማዕከል እንዲሂዱ ይከሉ።
- ተግባራዊና ግልጽ ይሆኑ፦ መኝ መረብ፣ የውስጥ ማጠጣቀም፣ የመባባት ቦታ ማጽዳት፣ ወቅና ልጆች።
- ከ140 ቃላት በታች። ቀላል ቋንቋ፣ አጭር አረፍተማ፣ ርዕስ አርብዞች የለም።
- በመጨረሻ «ይህ አጠቃላይ መመሪያ ነው፣ የሕክምና ምክር አይደለም» ብለው ያጠናቅቁ።
- ጥያቄው የተጠየቀውን ቋንቋ በቋንቋው ይመልሱ።`;

interface ChatMessage {
  role: 'system' | 'user';
  content: string;
}

const MAX_QUESTION_CHARS = 500;

/** Crude per-IP token bucket. Public endpoint, real money behind it. */
const RATE_LIMIT = { windowMs: 60_000, max: 12 };
const hits = new Map<string, { count: number; resetAt: number }>();

function rateLimited(ip: string): boolean {
  const now = Date.now();
  const entry = hits.get(ip);
  if (!entry || now > entry.resetAt) {
    hits.set(ip, { count: 1, resetAt: now + RATE_LIMIT.windowMs });
    if (hits.size > 5000) hits.clear(); // bounded memory
    return false;
  }
  entry.count += 1;
  return entry.count > RATE_LIMIT.max;
}

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== 'POST') {
    return json({ error: 'method not allowed' }, 405);
  }

  const ip =
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    req.headers.get('x-real-ip') ||
    'unknown';

  if (rateLimited(ip)) {
    return json({ error: 'too many requests' }, 429);
  }

  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) {
    return json({ error: 'assistant not configured' }, 503);
  }

  let question = '';
  let lang = 'en';
  try {
    const body = (await req.json()) as { question?: unknown; lang?: unknown };
    question = typeof body.question === 'string' ? body.question.trim() : '';
    lang = body.lang === 'am' ? 'am' : 'en';
  } catch {
    return json({ error: 'invalid body' }, 400);
  }

  if (!question) return json({ error: 'question required' }, 400);
  if (question.length > MAX_QUESTION_CHARS) {
    return json({ error: 'question too long' }, 413);
  }

  const messages: ChatMessage[] = [
    { role: 'system', content: lang === 'am' ? SYSTEM_AM : SYSTEM_EN },
    { role: 'user', content: question },
  ];

  try {
    const upstream = await fetch(DEEPSEEK_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: MODEL,
        messages,
        temperature: 0.3, // low: this is health information, not creative copy
        max_tokens: 400,
        stream: false,
      }),
      signal: AbortSignal.timeout(20_000),
    });

    if (!upstream.ok) {
      // Deliberately not forwarding the upstream body: it can contain key or
      // account detail.
      return json({ error: 'assistant unavailable' }, 502);
    }

    const data = (await upstream.json()) as {
      choices?: { message?: { content?: string } }[];
    };
    const answer = data.choices?.[0]?.message?.content?.trim();
    if (!answer) return json({ error: 'empty answer' }, 502);

    return json({ answer });
  } catch {
    return json({ error: 'assistant unavailable' }, 502);
  }
}
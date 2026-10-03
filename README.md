# MalariaX

**Know your risk. Protect your community.**

A free, offline-capable Progressive Web App that helps people in Ethiopia and
other low-income countries assess malaria symptoms, learn prevention, and report
cases anonymously — producing the community early-warning data that regional
dashboards need.

Amharic and English. No account, no install store, no cost. Installable to a home
screen from a browser link.

---

## The one thing to understand first

**This app does not diagnose malaria, and the AI is not allowed to.**

Severe malaria can kill within 24 hours of the first symptoms. A language model
that confidently talks someone out of urgent care is a lethal failure mode, so
the escalation decision does not belong to a model. It belongs to a rule engine
that a reviewer can read, test, and argue with:

```
src/lib/redflags.ts   ← decides escalation. Pure, offline, 18 unit tests.
src/lib/risk.ts       ← decides the environmental band. Deterministic.
src/lib/ai.ts         ← answers PREVENTION questions only. Cannot triage.
```

`evaluateRedFlags()` runs **before** any network call. If a danger sign is
present the result is `EMERGENCY`, and no model output can lower it. The
escalation contract is enforced in code and covered by a monotonicity test: no
sequence of symptom escalations may ever lower the verdict.

The AI endpoint's system prompt is written the same way — it is instructed to
decline diagnosis and to redirect anyone describing symptoms to a blood test.

> **Before this app is used for real clinical decisions, the Amharic medical
> strings in `src/i18n/am.json` and the fallback answers in `src/lib/ai.ts` need
> review by an Ethiopian clinician.** They are marked in the source. See
> [Before launch](#before-launch).

---

## What it does

### Check — symptom assessment
Eight symptoms × four severities, plus who-it-is-about (adult or child), how
long, whether care was sought, and region. Produces a risk band with three
concrete actions and a list of danger signs to watch for.

**The verdict appears instantly and involves no network call.** It comes from the
rule engine alone. If you have selected a region, the environmental band then
refines it in the background — but the result you can act on is already on
screen. Making someone wait on a weather API to find out whether they need to
walk to a clinic is not acceptable on the connections this app targets.

On a high or emergency result, **Find a health center** is the first action, and
opens a sheet with the ambulance number, what to bring, and what to tell the
health worker. MalariaX has no verified dataset of Ethiopian health facilities,
so it does not pretend to show one.

Works fully offline: with no connection the same rule engine runs and returns
pre-written guidance, so a rural user with one bar of signal still gets correct
escalation advice.

### Report — anonymous case reporting
Contributes to community surveillance. Reports carry **no name, no phone number,
no device id, no coordinates** — only a hashed device token and a region.
Writes go to IndexedDB *first* and upload opportunistically, so a report taken
with no signal is never lost.

Badges and streaks are earned locally and immediately, independent of the
network.

### Data — public regional risk map
Regional risk for all 14 regions, colour-coded on a cartogram, plus a seasonal
notice and preparation steps. Fully public, no login.

**This works with no backend at all.** Risk is driven by temperature, rainfall,
humidity and elevation — all derivable from a free weather API (Open-Meteo, no
key, no account) plus a static table. The app paints the whole map instantly
from the Ethiopian transmission calendar and elevation, then refines each region
with live weather as it arrives.

A database is only needed for one thing: **case reports from other people.** That
is genuinely valuable and genuinely additive, so it is optional. Add a backend
later and community counts simply sharpen the estimates.

The distinction matters, so the UI states which kind of number you are looking
at — "estimated from weather and altitude, no case reports yet" versus "based on
current weather".

### Ask — prevention questions
Multilingual prevention Q&A through a server-side proxy, with a curated offline
fallback for the five most common questions.

---

## Honest limitations

Stated up front because a health tool that overstates itself is worse than no
tool at all.

| Limitation | Why it exists |
|---|---|
| **Not a diagnostic test** | Fever alone cannot confirm malaria. Only a rapid test or blood test at a health center can. The app says so on every result screen. |
| **The risk map is a cartogram, not a boundary map** | Ethiopia's regions have been restructured repeatedly (Sidama 2020; Central, South and Southwest Ethiopia 2021–2023). Drawing borders from a possibly-stale dataset onto a health dashboard would mislead. Each region is a tile positioned roughly geographically; no boundary is claimed. Swap in verified GeoJSON via `REGION_GRID_POSITION` in `src/lib/geo.ts`. |
| **Region granularity only** | Woreda + symptoms + age group is a small enough cell to identify people in a low-population district. The public view suppresses any cell with fewer than 5 reports. |
| **`caseWeight` values are priors, not measurements** | Seed values so a cold-start dashboard is not uniform. Once real reports arrive, observed case rate replaces them. |
| **No zone/woreda list** | Deliberate. See "Zone/woreda data is deliberately absent" in `src/lib/geo.ts`. |
| **Amharic medical copy is unreviewed** | Needs an Ethiopian clinician. Marked in source. |

---

## Privacy posture

This is health data, so the rules are strict and enforced in the database, not
just in intent.

- `reports` is **INSERT-only** from the client. There is no SELECT, UPDATE or
  DELETE policy for `anon`/`authenticated`, so RLS denies all three. Deletion
  goes through an edge function that verifies ownership of the hashed token.
- The public dashboard reads a **k-anonymity view**. Any region/week cell with
  fewer than 5 reports returns `NULL` and a `suppressed` flag, which the UI
  renders as "too few reports to show" — not as a zero.
- The device token is a SHA-256 hash of a random UUID held only in the
  reporter's browser. We never receive the UUID and it is not tied to an
  account, number or SIM.
- Every RLS policy is written assuming the anon key is public. It is; access
  control comes from the policies in `supabase/migrations/0002_rls_and_views.sql`.

Review the SQL before deploying. It is the actual security boundary.

---

## Running it without a backend

**You do not need to buy anything to run this.** With no Supabase project:

| Feature | Works? |
|---|---|
| Symptom check + instant verdict | Yes — pure rules, no network |
| Prevention Q&A | Yes — offline curated answers |
| Badges and streaks | Yes — localStorage |
| Reporting a case | Yes — queued in IndexedDB on the phone |
| **Regional risk map** | **Yes — computed on-device from weather + elevation** |
| Community case rates | No — needs a backend |

Reports taken without a backend are kept safely on the device. Add a backend
later and the queue syncs itself; nothing is lost either way.

When you are ready, see [Getting started](#getting-started). Supabase's free
tier needs no credit card, but it pauses inactive projects after about a week,
so budget $25/mo before this has real users.

---

## Getting started

```bash
npm install
cp .env.example .env      # add your Supabase URL and anon key
npm run dev
```

The app runs without Supabase configured — assessment, badges and offline
reporting all work, and the Data tab shows an offline notice.

### Database

Apply the migrations in order to a **new** Supabase project (use a separate
project from any other app; do not reuse credentials):

- `supabase/migrations/0001_core_schema.sql`
- `supabase/migrations/0002_rls_and_views.sql`

### AI endpoint

`/api/ask` is a Vercel Edge Function. Set the key server-side — never with a
`VITE_` prefix, which would inline it into the browser bundle:

```bash
vercel env add DEEPSEEK_API_KEY production
```

### Weather

Open-Meteo needs no key. Nothing to configure.

---

## Scripts

| Command | Purpose |
|---|---|
| `npm run dev` | Dev server |
| `npm run build` | Typecheck + production build |
| `npm run preview` | Serve the built output |
| `npm test` | Vitest suite |
| `npm run typecheck` | Types only |

---

## Testing

82 tests in two projects, weighted toward the safety-critical surface.

**Logic** (`src/**/*.test.ts`, Node — fast, no browser shims):

- **`redflags.test.ts`** — danger signs force EMERGENCY; combination rules fire;
  **monotonicity**: escalating any symptom never lowers the verdict.
- **`risk.test.ts`** — band edges, component normalisation, elevation separation
  of highland vs lowland, and the contract that a calm environment can never
  downgrade a severe clinical picture.
- **`badges.test.ts`** — streaks across month boundaries and leap days, same-day
  de-duplication, backwards clock jumps, badge-awarded-once.
- **`parity.test.ts`** — every key exists in both languages, placeholders match,
  no encoding corruption, and ≥70% of Amharic strings genuinely contain Ethiopic
  script (guards against a silent English fallback).

**Render** (`src/**/*.test.tsx`, jsdom):

- **`App.test.tsx`** — the shell mounts, tabs work, the launcher reaches the
  checker, submit stays disabled until something is selected, every result
  carries the not-a-diagnosis warning, and an emergency result surfaces both the
  danger signs and the care action while a low result shows neither.

This second layer is not decoration. It caught a real defect: the result screen
was awaiting a live weather API before it would render, so anyone on a slow
connection watched a spinner for six seconds to learn whether they needed to walk
to a clinic. The clinical verdict is now computed and painted instantly with no
network involvement, and the environmental band refines it afterwards if it
arrives. A unit test cannot have found that; a render test did.

Not yet covered, and worth adding before real use: the offline sync queue across
a reconnect, and an axe pass per screen.

---

## Tech

Vite 7 · React 19 · TypeScript · hand-written CSS design system · i18next ·
Zustand · Dexie (IndexedDB) · Supabase (Postgres + RLS) · DeepSeek via edge
function · Open-Meteo · vite-plugin-pwa

No CSS framework and no icon package: both were dropped deliberately to keep the
critical path small for 2G connections. The design system is
`src/styles/tokens.css`, and the nine icons in `src/components/ui.tsx` are
hand-rolled.

**Bundle:** ~142 KB gzipped on first paint. Supabase (~59 KB gzipped) is behind a
dynamic import and is not fetched unless the user opens the Data tab or a report
needs syncing.

---

## Before launch

- [ ] **Amharic medical review.** `src/i18n/am.json` (`result.*`, `assess.*`) and
      the `FALLBACK` answers in `src/lib/ai.ts`. Marked `NEEDS CLINICIAN REVIEW`.
- [ ] **Verify the RLS SQL against a live project.** Confirm anon-key REST calls
      to `/rest/v1/reports` return nothing, and that suppression behaves.
- [ ] **Seed `risk_snapshots`** or the Data tab will show "not enough reports".
      No client can write this table — it is written server-side.
- [ ] **Emergency number.** Copy references 991 (Ethiopia). Confirm and consider
      making it regional.
- [ ] **Test on a real Android handset**, offline, in Amharic.

---

## Licence

MIT. Public domain in practice — the intent is that Ethiopian health workers and
the Ministry of Health can read, fork and deploy this.

The underlying guidance should stay attributable to WHO and the Ethiopian
Ministry of Health. Cite them, do not restate their protocols as this app's own.
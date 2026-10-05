Creative Commons Attribution-ShareAlike 4.0 International (CC BY-SA 4.0)

Applies to the CLINICAL CONTENT of this repository, which is everything other
than the source code itself. The source code is licensed separately under MIT;
see LICENSE.

WHAT IS COVERED BY CC BY-SA 4.0
--------------------------------

  src/i18n/am.json          Amharic clinical strings
  src/i18n/en.json          English clinical strings
  src/lib/ai.ts             the FALLBACK prevention answers
  src/lib/risk.ts           the risk weights (caseWeight values)
  src/lib/regionalRisk.ts   the regional risk model and its priors
  src/lib/redflags.ts       the danger-sign rule set
  src/lib/geo.ts            region identifiers and grid positions
  supabase/migrations/*.sql the schema, RLS policies and k-anonymity views

WHY IT IS SEPARATE FROM THE CODE LICENCE
----------------------------------------

This is not a diagnostic tool and makes no diagnosis. The content above is a
reference aid compiled from WHO guidance, WHO IMNCI, and Ethiopian national
protocols. Two consequences follow:

  * ShareAlike exists so a clinic or the Ministry of Health can translate the
    Amharic strings, adapt the bands to a local formulary, or correct a dose
    without having to open-source their entire stack. Anyone who then
    distributes that adaptation has to keep it under the same terms, so the
    improvements cannot be quietly closed away.
  * Attribution matters because the underlying guidance belongs to WHO and the
    Ethiopian Ministry of Health. They must be cited, not restated as this
    app's own work.

WHAT THIS LICENCE DOES NOT DO
-----------------------------

It does not certify accuracy. The clinical content is unreviewed: the Amharic
medical strings have not been checked by a qualified clinician, and the risk
model's caseWeight values are seeded priors rather than measured case rates.
Licensing content does not verify it. See the "Honest limitations" table in
README.md, and the "Before launch" checklist, for what is still outstanding.

Full licence text: https://creativecommons.org/licenses/by-sa/4.0/legalcode
Human-readable summary: https://creativecommons.org/licenses/by-sa/4.0/

/**
 * Static checks on the Supabase migrations.
 *
 * These assert properties of the SQL that no amount of application testing
 * can reach, because the failure mode is not a thrown error. A view declared
 * `security_invoker` over a table with no SELECT policy still builds
 * successfully, still passes every app test, and still grants access. It just
 * returns zero rows forever, and nothing anywhere reports that.
 *
 * `reports` is INSERT-only for the browser by design. That deny is the
 * privacy guarantee, so any view that needs to aggregate it has to be
 * security_definer with a pinned search_path, and any view that does not
 * needs it has to stay security_invoker so it inherits the table's policies.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const MIGRATIONS = join(process.cwd(), 'supabase', 'migrations');

function read(name: string): string {
  return readFileSync(join(MIGRATIONS, name), 'utf8');
}

const rls = read('0002_rls_and_views.sql');
const schema = read('0001_core_schema.sql');

/** Extracts the `create or replace view <name> ... as` body. */
function viewBody(name: string): string {
  const start = rls.indexOf(`create or replace view public.${name}`);
  expect(start, `view ${name} not found in 0002`).toBeGreaterThan(-1);
  // Views are separated by a top-level comment banner or a grant block.
  const rest = rls.slice(start);
  const next = rest.slice(1).search(/\n(create or replace view|grant |revoke |comment on view)/);
  return next === -1 ? rest : rest.slice(0, next + 1);
}

/** Tables the given view body reads from. */
function readsFrom(body: string): string[] {
  return [...body.matchAll(/\bfrom\s+(?:public\.)?(\w+)/gi)].map((m) =>
    m[1]!.toLowerCase(),
  );
}

/** Which tables have an explicit SELECT policy for anon. */
function tablesSelectableByAnon(): Set<string> {
  const open = new Set<string>();
  const policy = /create policy\s+(\w+)\s+on\s+public\.(\w+)\s+for\s+select[\s\S]*?to\s+([^;]+);/gi;
  let m: RegExpExecArray | null;
  while ((m = policy.exec(rls)) !== null) {
    const [, , table, roles] = m;
    if (roles!.includes('anon')) open.add(table!.toLowerCase());
  }
  return open;
}

describe('reports is INSERT-only for the browser', () => {
  it('has RLS enabled', () => {
    expect(rls).toMatch(/alter table public\.reports\s+enable row level security/i);
  });

  it('grants an insert policy', () => {
    expect(rls).toMatch(/create policy\s+reports_insert[\s\S]*?for insert/i);
  });

  it('has no SELECT policy, which is what keeps raw reports private', () => {
    const open = tablesSelectableByAnon();
    expect(
      open.has('reports'),
      'reports must not be selectable by anon — that deny is the privacy guarantee',
    ).toBe(false);
  });

  it('has no UPDATE or DELETE policy either', () => {
    expect(rls).not.toMatch(
      /create policy\s+\w+\s+on\s+public\.reports\s+for\s+(update|delete)/i,
    );
  });
});

describe('every public view is reachable by the browser', () => {
  it('region_risk_public stays security_invoker, inheriting table policies', () => {
    // It reads risk_snapshots, which IS selectable, so invoker is correct and
    // the view grants no additional privilege.
    const body = viewBody('region_risk_public');
    expect(body).toMatch(/security_invoker\s*=\s*true/i);
    for (const table of readsFrom(body)) {
      expect(tablesSelectableByAnon().has(table)).toBe(true);
    }
  });

  it('region_trends_public is security_definer because reports denies select', () => {
    // The regression this guards: with security_invoker the query ran as anon,
    // hit the reports deny, and returned zero rows to every public caller.
    // The trend chart rendered empty and nothing reported it.
    const body = viewBody('region_trends_public');
    expect(readsFrom(body)).toContain('reports');
    expect(tablesSelectableByAnon().has('reports')).toBe(false);
    expect(body).toMatch(/security_definer\s*=\s*true/i);
  });

  it('pins search_path on the definer view', () => {
    // SECURITY DEFINER runs as the owner. An unpinned search_path lets a
    // caller who can create objects in a schema on the path shadow `count`
    // or `date_trunc` and hijack the aggregation.
    expect(viewBody('region_trends_public')).toMatch(
      /set\s+search_path\s*=\s*public\s*,\s*pg_temp/i,
    );
  });
});

describe('no dead code in the views', () => {
  it('region_risk_public has no unreferenced CTE', () => {
    // The `counts` CTE aggregated public.reports but nothing referenced it,
    // so its 90-day window applied to nothing. It also implied live reports
    // fed this view, which they must not: counts come from the server-written
    // snapshot.
    const body = viewBody('region_risk_public');
    expect(body).not.toMatch(/\bwith\s+\w+\s+as\s*\(/i);
    expect(readsFrom(body)).toContain('risk_snapshots');
    expect(readsFrom(body)).not.toContain('reports');
  });
});

describe('k-anonymity suppression', () => {
  const MIN_CELL = 5;

  it('applies the same threshold to both public views', () => {
    // Qualified names are allowed on the left of the comparison, e.g.
    // `case when s.report_count < 5 then null`.
    const operand = '[\\w.]+';
    for (const name of ['region_risk_public', 'region_trends_public']) {
      const body = viewBody(name);
      expect(body, `${name} must null out small cells`).toMatch(
        new RegExp(
          `when\\s+${operand}\\s*<\\s*${MIN_CELL}\\s+then\\s+null`,
          'i',
        ),
      );
      expect(body, `${name} must flag suppressed cells`).toMatch(
        new RegExp(`${operand}\\s*<\\s*${MIN_CELL}\\s*\\)\\s+as\\s+suppressed`, 'i'),
      );
    }
  });

  it('never exposes a raw report column', () => {
    // If a future edit widened either view to return symptoms, age_group or
    // client_hash, k-anonymity would no longer protect anyone.
    for (const name of ['region_risk_public', 'region_trends_public']) {
      const body = viewBody(name).toLowerCase();
      for (const forbidden of ['client_hash', 'symptoms', 'age_group', 'notes']) {
        expect(body, `${name} must not select ${forbidden}`).not.toContain(
          forbidden,
        );
      }
    }
  });
});

describe('grants', () => {
  it('grants SELECT on both views to anon', () => {
    for (const name of ['region_risk_public', 'region_trends_public']) {
      expect(rls).toMatch(
        new RegExp(`grant select on public\\.${name} to anon`, 'i'),
      );
    }
  });

  it('grants no write access to the views', () => {
    expect(rls).toMatch(
      /revoke insert, update, delete on public\.region_trends_public from anon/i,
    );
  });

  it('grants INSERT on reports but never SELECT', () => {
    expect(rls).toMatch(/grant insert on public\.reports to anon/i);
    expect(rls).not.toMatch(/grant\s+select[^;]*on\s+public\.reports/i);
  });
});

describe('risk_snapshots is the only server-written read path', () => {
  it('declares report_count on the snapshot table', () => {
    // The dashboard's counts come from here, written by the scheduled job.
    expect(schema).toMatch(
      /create table if not exists public\.risk_snapshots[\s\S]*?report_count\s+integer/i,
    );
  });

  it('grants no write access to anon', () => {
    expect(rls).not.toMatch(
      /grant\s+(insert|update|delete)[^;]*on\s+public\.risk_snapshots/i,
    );
  });
});

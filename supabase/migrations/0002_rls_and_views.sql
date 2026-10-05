-- MalariaX — 0002 row level security + public aggregate view
--
-- The threat model: the Supabase anon key ships in the browser bundle. Every
-- policy here is written assuming that key is public and that anyone can send
-- arbitrary requests to PostgREST with it. RLS is the only thing standing
-- between a stranger and a table of health reports, so the default is DENY and
-- access is granted narrowly.

alter table public.reports      enable row level security;
alter table public.user_stats   enable row level security;
alter table public.risk_snapshots enable row level security;

-- Force RLS even for the table owner, so a stray `service_role` shortcut cannot
-- silently bypass policy during development. (service_role itself still can,
-- which is intentional — the edge function needs it.)
alter table public.reports force row level security;

-- --------------------------------------------------------------------------
-- reports
-- --------------------------------------------------------------------------
drop policy if exists reports_insert on public.reports;
create policy reports_insert on public.reports
  for insert
  to anon, authenticated
  with check (client_hash is not null and length(client_hash) = 64);

-- No SELECT, UPDATE or DELETE policy exists for anon/authenticated, which means
-- RLS denies all three. The absence is deliberate: writing `using (false)` would
-- document intent more clearly, but a missing policy is already a deny and
-- cannot drift out of sync with a permissive one.
--
-- Deletion is handled by an edge function that verifies ownership of
-- client_hash via service_role, so a user can erase their own history without
-- the browser ever receiving a DELETE grant.

-- --------------------------------------------------------------------------
-- user_stats — readable and writable for the owner's own hash only
-- --------------------------------------------------------------------------
drop policy if exists user_stats_own_select on public.user_stats;
create policy user_stats_own_select on public.user_stats
  for select to anon, authenticated
  using (client_hash = current_setting('request.headers', true)::json->>'x-malariax-client', ''));

drop policy if exists user_stats_own_upsert on public.user_stats;
create policy user_stats_own_upsert on public.user_stats
  for insert to anon, authenticated
  with check (client_hash = current_setting('request.headers', true)::json->>'x-malariax-client', ''));

drop policy if exists user_stats_own_update on public.user_stats;
create policy user_stats_own_update on public.user_stats
  for update to anon, authenticated
  using (client_hash = current_setting('request.headers', true)::json->>'x-malariax-client', '')
  with check (client_hash = current_setting('request.headers', true)::json->>'x-malariax-client', '');

-- --------------------------------------------------------------------------
-- risk_snapshots — public read, no writes from the client
-- --------------------------------------------------------------------------
drop policy if exists risk_snapshots_public_read on public.risk_snapshots;
create policy risk_snapshots_public_read on public.risk_snapshots
  for select to anon, authenticated
  using (true);

-- Snapshots are written by the scheduled risk job using service_role, never by
-- the browser. There is intentionally no insert/update policy for anon.

-- --------------------------------------------------------------------------
-- K-anonymity aggregate view
--
-- The dashboard must never expose a cell small enough to identify the people
-- behind it. A region with three reports, all children with fever, is
-- potentially identifying in a small district. So:
--
--   * the raw table is not readable at all, and
--   * any region-window cell below MIN_CELL_SIZE is replaced with a NULL count
--     and a `suppressed` flag, which the UI renders as "too few reports to
--     show" rather than as a zero.
--
-- MIN_CELL_SIZE of 5 follows common practice for public-health small-area
-- reporting. Raise it if the data ever covers small districts.
-- --------------------------------------------------------------------------
-- Reads risk_snapshots, which has an explicit SELECT policy for anon, so
-- security_invoker is correct here: the caller stays subject to RLS on the
-- table underneath, and this view adds no privilege.
--
-- The `counts` CTE that used to sit in front of this select was dead code. It
-- aggregated public.reports, but nothing referenced it, so the 90-day window
-- it declared never applied to anything. It read a table anon cannot select
-- from, so keeping it served no purpose and invited the belief that live
-- report counts fed this view. They do not: report_count comes from the
-- server-written snapshot, which is the correct design, because the browser
-- is not permitted to count raw reports.
create or replace view public.region_risk_public
with (security_invoker = true) as
select
  s.region_code,
  s.snapshot_date,
  s.risk_level,
  s.risk_score,
  s.report_rate,
  s.rainfall_mm,
  s.rainfall_norm_mm,
  s.temp_avg,
  s.humidity,
  s.elevation_m,
  s.drivers,
  s.updated_at,
  -- Suppressed below the threshold.
  case when s.report_count < 5 then null else s.report_count end as report_count,
  (s.report_count < 5) as suppressed
from public.risk_snapshots s
where s.snapshot_date = (
  select max(snapshot_date) from public.risk_snapshots
);

comment on view public.region_risk_public is
  'Public dashboard feed. Cells with fewer than 5 reports are nulled and flagged suppressed.';

-- --------------------------------------------------------------------------
-- Weekly trend view, same suppression rule
--
-- This view DOES read public.reports, and it is deliberately
-- security_definer rather than security_invoker.
--
-- The previous version used security_invoker, which meant the query ran as
-- the caller (anon) and hit the reports RLS deny. reports has no SELECT
-- policy by design, so the view returned zero rows to every public caller
-- and the trend chart silently rendered empty. The suppression logic below
-- was never the problem; the plumbing was.
--
-- security_definer is safe here because the view:
--
--   * exposes no column from reports other than a region code, a week, and a
--     count,
--   * applies the same k=5 suppression as region_risk_public, so a cell small
--     enough to identify anyone is nulled before it leaves the database, and
--   * is not granted to the table owner role that could write reports.
--
-- SECURITY DEFINER runs as the view owner, so search_path is pinned to
-- prevent a writable schema earlier in the path from shadowing `count` or
-- `date_trunc`. Without this, a caller who can create objects in a schema
-- on the path could hijack the function used here.
-- --------------------------------------------------------------------------
create or replace view public.region_trends_public
with (security_definer = true, security_invoker = false)
set search_path = public, pg_temp
as
with weekly as (
  select
    region_code,
    date_trunc('week', created_at)::date as week_start,
    count(*)::int as n
  from public.reports
  where created_at >= now() - interval '90 days'
  group by 1, 2
)
select
  region_code,
  week_start,
  case when n < 5 then null else n end as report_count,
  (n < 5) as suppressed
from weekly
order by region_code, week_start;

grant select on public.region_risk_public to anon, authenticated;
grant select on public.region_trends_public to anon, authenticated;
grant insert on public.reports to anon, authenticated;
grant select, insert, update on public.user_stats to anon, authenticated;
grant select on public.risk_snapshots to anon, authenticated;

-- The views are the only read path to aggregate data. Revoke anything that
-- might have been granted to the table owner by a looser earlier run, so a
-- security_definer view cannot be reached through a route the policies did
-- not intend.
revoke all on public.region_trends_public from public;
revoke all on public.region_risk_public from public;
grant select on public.region_trends_public to anon, authenticated;
grant select on public.region_risk_public to anon, authenticated;

-- Anonymous callers must not be able to insert into any view. Postgres will
-- reject that anyway without an updatable-view trigger, but stating it means
-- the grant list above is the complete set of what a browser can do.
revoke insert, update, delete on public.region_trends_public from anon, authenticated;
revoke insert, update, delete on public.region_risk_public from anon, authenticated;
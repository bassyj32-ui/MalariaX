-- MalariaX — 0001 core schema
--
-- Privacy posture, stated once so every later migration can be checked against it:
--
--   * A report carries NO name, NO phone number, NO device id, NO coordinates.
--     The only quasi-identifier is `client_hash`, a SHA-256 of a random UUID that
--     lives in the reporter's own browser. It is not linkable to a person by us,
--     and we never receive the UUID itself.
--   * `reports` is INSERT-only from the client. It is not readable by the public.
--     The dashboard reads only the aggregate view built in 0002.
--   * Region granularity is deliberate. Woreda + symptom + age group is a small
--     enough cell in a low-population district to be identifying, which is why
--     the aggregate view enforces a minimum cell size.
--
-- This is health data. Treat every column accordingly.

create extension if not exists "pgcrypto";

-- --------------------------------------------------------------------------
-- reports: one row per submitted case report
-- --------------------------------------------------------------------------
create table if not exists public.reports (
  id            uuid        primary key default gen_random_uuid(),
  client_hash   text        not null,
  region_code   text        not null,
  zone_name     text,
  age_group     text        not null check (age_group in ('adult', 'child')),
  symptoms      jsonb       not null default '{}'::jsonb,
  duration_days int         check (duration_days is null or duration_days between 0 and 60),
  sought_care   text        check (sought_care in ('yes', 'no', 'pending')),
  risk_level    text        check (risk_level in ('low', 'moderate', 'high', 'emergency')),
  notes         text        check (notes is null or length(notes) <= 280),
  created_at    timestamptz not null default now()
);

comment on table public.reports is
  'Anonymous malaria case reports. INSERT-only from the client; no public reads.';

-- Dashboard aggregates by region over a time window.
create index if not exists reports_region_created_idx
  on public.reports (region_code, created_at desc);

-- --------------------------------------------------------------------------
-- user_stats: per-device streaks and badges. No cross-device linkage.
-- --------------------------------------------------------------------------
create table if not exists public.user_stats (
  client_hash      text        primary key,
  reports_count    integer     not null default 0,
  current_streak   integer     not null default 0,
  longest_streak   integer     not null default 0,
  points           integer     not null default 0,
  last_report_date date,
  badges           jsonb       not null default '[]'::jsonb,
  updated_at       timestamptz not null default now()
);

-- --------------------------------------------------------------------------
-- risk_snapshots: precomputed regional risk. This is the ONLY table the public
-- dashboard reads, and it contains aggregate numbers rather than submissions.
-- --------------------------------------------------------------------------
create table if not exists public.risk_snapshots (
  region_code      text        not null,
  snapshot_date    date        not null default current_date,
  report_count     integer     not null default 0,
  report_rate      numeric(8, 3) not null default 0,   -- per 100k, 28-day window
  rainfall_mm      numeric(8, 1),
  rainfall_norm_mm numeric(8, 1),
  temp_avg         numeric(5, 1),
  humidity         numeric(5, 1),
  elevation_m      integer,
  risk_score       numeric(6, 4) not null default 0,
  risk_level       text        not null check (risk_level in ('low', 'moderate', 'high', 'emergency')),
  drivers          jsonb       not null default '[]'::jsonb,
  updated_at       timestamptz not null default now(),
  primary key (region_code, snapshot_date)
);

comment on column public.risk_snapshots.drivers is
  'Machine-readable reasons behind the score, so the UI can explain rather than assert.';

create index if not exists risk_snapshots_date_idx
  on public.risk_snapshots (snapshot_date desc);
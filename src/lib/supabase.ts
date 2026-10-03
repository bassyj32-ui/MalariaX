import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { CLIENT_HASH_HEADER, getClientHash } from './identity';

/**
 * Supabase client.
 *
 * The anon key is designed to be public — every policy in migration 0002 is
 * written on the assumption that anyone has it. Access control comes from RLS,
 * not from hiding this key.
 *
 * The service-role key must never appear in this file or anywhere else that is
 * bundled for the browser. It belongs only in the edge function's environment.
 */

const url = import.meta.env.VITE_SUPABASE_URL;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const isSupabaseConfigured = Boolean(url && anonKey);

export interface ReportRow {
  client_hash: string;
  region_code: string;
  zone_name?: string | null;
  age_group: 'adult' | 'child';
  symptoms: Record<string, string>;
  duration_days?: number | null;
  sought_care?: 'yes' | 'no' | 'pending' | null;
  risk_level?: 'low' | 'moderate' | 'high' | 'emergency' | null;
  notes?: string | null;
}

export interface RegionRiskRow {
  region_code: string;
  snapshot_date: string;
  risk_level: 'low' | 'moderate' | 'high' | 'emergency';
  risk_score: number;
  report_rate: number | null;
  rainfall_mm: number | null;
  rainfall_norm_mm: number | null;
  temp_avg: number | null;
  humidity: number | null;
  elevation_m: number | null;
  drivers: string[];
  updated_at: string;
  report_count: number | null;
  suppressed: boolean;
}

export interface TrendRow {
  region_code: string;
  week_start: string;
  report_count: number | null;
  suppressed: boolean;
}

/**
 * Wraps fetch so every request carries the device hash header the RLS policies
 * check. Async because the hash is an async digest; the value is cached after
 * the first call, so this costs one microtask per request.
 */
async function authedFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const hash = await getClientHash();
  const headers = new Headers(init?.headers);
  headers.set(CLIENT_HASH_HEADER, hash);
  return fetch(input, { ...init, headers });
}

export const supabase: SupabaseClient = createClient(url ?? 'http://localhost', anonKey ?? 'public-anon-key', {
  global: { fetch: authedFetch },
  auth: { persistSession: false, autoRefreshToken: false },
  db: { schema: 'public' },
});

/** Thrown when the backend is absent so callers can degrade to offline mode. */
export class NotConfiguredError extends Error {
  constructor() {
    super('Supabase is not configured. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.');
    this.name = 'NotConfiguredError';
  }
}

/**
 * Insert a report. Returns false rather than throwing so the offline queue can
 * take over without the UI having to distinguish "network failed" from
 * "constraint failed" — both mean the report did not land.
 */
export async function submitReport(row: ReportRow): Promise<boolean> {
  if (!isSupabaseConfigured) throw new NotConfiguredError();
  const { error } = await supabase.from('reports').insert(row);
  return !error;
}

export async function fetchRegionRisk(): Promise<RegionRiskRow[]> {
  if (!isSupabaseConfigured) throw new NotConfiguredError();
  const { data, error } = await supabase
    .from('region_risk_public')
    .select('*')
    .order('region_code');
  if (error) throw error;
  return (data ?? []) as RegionRiskRow[];
}

export async function fetchTrends(): Promise<TrendRow[]> {
  if (!isSupabaseConfigured) throw new NotConfiguredError();
  const { data, error } = await supabase
    .from('region_trends_public')
    .select('*')
    .order('week_start');
  if (error) throw error;
  return (data ?? []) as TrendRow[];
}

export interface StatsRow {
  client_hash: string;
  reports_count: number;
  current_streak: number;
  longest_streak: number;
  points: number;
  last_report_date: string | null;
  badges: string[];
}

export async function fetchStats(): Promise<StatsRow | null> {
  if (!isSupabaseConfigured) throw new NotConfiguredError();
  const { data, error } = await supabase.from('user_stats').select('*').maybeSingle();
  if (error) throw error;
  return (data as StatsRow | null) ?? null;
}

export async function saveStats(row: Omit<StatsRow, 'client_hash' | 'updated_at'>): Promise<void> {
  if (!isSupabaseConfigured) throw new NotConfiguredError();
  const client_hash = await getClientHash();
  const { error } = await supabase.from('user_stats').upsert({ ...row, client_hash });
  if (error) throw error;
}
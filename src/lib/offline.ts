import Dexie, { type Table } from 'dexie';

/**
 * Offline report queue.
 *
 * This is the difference between an app that works in rural Ethiopia and one
 * that does not. A health worker closing a report while standing in a woreda
 * with one bar of signal must not lose it, so writes go to IndexedDB first and
 * are pushed to Supabase opportunistically. The user-visible promise is that a
 * report is never lost and never silently fails — the UI says "saved" the moment
 * it is durable locally.
 *
 * NOTE ON IMPORTS: `./supabase` is loaded with a dynamic import inside the
 * functions that need it, never at the top of this module. The Supabase client
 * and its realtime machinery are ~90KB gzipped, and most sessions only ever
 * check symptoms, so there is no reason to pay for it before the first sync
 * attempt actually needs it.
 */

import type { ReportRow } from './supabase';

export type { ReportRow };

/**
 * Mirrors `isSupabaseConfigured` without importing the client, so a queue check
 * stays synchronous and cheap.
 */
function configured(): boolean {
  return Boolean(import.meta.env.VITE_SUPABASE_URL && import.meta.env.VITE_SUPABASE_ANON_KEY);
}

export interface QueuedReport extends ReportRow {
  /** Local autoincrement key; also the id we reconcile on. */
  queueId?: number;
  created_at: string;
  synced: 0 | 1;
  attempts: number;
  last_error?: string | null;
}

class MalariaXDatabase extends Dexie {
  queue!: Table<QueuedReport, number>;

  constructor() {
    super('malariax');
    this.version(1).stores({
      queue: '++queueId, synced, created_at',
    });
  }
}

export const db = new MalariaXDatabase();

/** Queue a report durably. Resolves once it is safe to tell the user "saved". */
export async function enqueueReport(row: ReportRow): Promise<number> {
  const entry: QueuedReport = {
    ...row,
    created_at: new Date().toISOString(),
    synced: 0,
    attempts: 0,
  };
  return db.queue.add(entry);
}

export async function pendingCount(): Promise<number> {
  return db.queue.where('synced').equals(0).count();
}

export async function allQueued(): Promise<QueuedReport[]> {
  return db.queue.orderBy('created_at').toArray();
}

export interface SyncResult {
  sent: number;
  failed: number;
}

/**
 * Push everything pending. Safe to call often — it is a no-op when the queue is
 * empty, and it never deletes a row it could not deliver.
 *
 * Rows that repeatedly fail are kept, not dropped: silently discarding a health
 * report because the network was down for a week would be worse than retrying.
 */
export async function syncQueue(onResult?: (r: SyncResult) => void): Promise<SyncResult> {
  if (!configured()) {
    const pending = await pendingCount();
    onResult?.({ sent: 0, failed: pending });
    return { sent: 0, failed: pending };
  }

  // Loaded only when we actually need to talk to the server.
  const { submitReport } = await import('./supabase');

  const pending = await db.queue.where('synced').equals(0).toArray();
  let sent = 0;
  let failed = 0;

  for (const row of pending) {
    try {
      const ok = await submitReport({
        client_hash: row.client_hash,
        region_code: row.region_code,
        zone_name: row.zone_name,
        age_group: row.age_group,
        symptoms: row.symptoms,
        duration_days: row.duration_days,
        sought_care: row.sought_care,
        risk_level: row.risk_level,
        notes: row.notes,
      });
      if (ok) {
        // Only delete once the server has confirmed the insert.
        await db.queue.delete(row.queueId!);
        sent++;
      } else {
        await db.queue.update(row.queueId!, { attempts: row.attempts + 1, last_error: 'insert rejected' });
        failed++;
      }
    } catch (err) {
      await db.queue.update(row.queueId!, {
        attempts: row.attempts + 1,
        last_error: err instanceof Error ? err.message : 'network error',
      });
      failed++;
    }
  }

  const result = { sent, failed };
  onResult?.(result);
  return result;
}

/** Stop trying to sync while offline, so we do not hammer a dead connection. */
let listening = false;
export function startAutoSync(): () => void {
  if (listening || typeof window === 'undefined') return () => {};
  listening = true;

  const onOnline = () => void syncQueue();
  window.addEventListener('online', onOnline);

  // Also try shortly after load and then periodically, because a page opened
  // while offline never fires an `online` event once the tab is backgrounded.
  const kick = () => void syncQueue();
  const boot = window.setTimeout(kick, 2500);
  const interval = window.setInterval(kick, 60_000);

  return () => {
    window.removeEventListener('online', onOnline);
    window.clearTimeout(boot);
    window.clearInterval(interval);
    listening = false;
  };
}

/** Wipe queued reports. Used by "delete all my data". */
export async function clearQueue(): Promise<void> {
  await db.queue.clear();
}
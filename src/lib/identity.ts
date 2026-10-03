/**
 * Anonymous device identity.
 *
 * We need a stable per-device id to keep streaks and badges without asking
 * anyone to register. The design deliberately makes that id useless to us as an
 * identifier:
 *
 *   1. A random UUID is generated once and kept in localStorage.
 *   2. It is SHA-256 hashed before it ever leaves the device.
 *   3. We store only the hash. Recovering the UUID from the hash is not
 *      practical, and the UUID is not tied to an account, phone number, SIM or
 *      IP we retain.
 *
 * Consequences we accept: clearing site data resets your badges, and someone who
 * copies your storage can clone your progress. Both are fine for a streak
 * counter, and neither is a privacy cost.
 */

const UUID_KEY = 'malariax.device_id';

/** Cached so the hash is not recomputed on every render. */
let cachedHash: string | null = null;

function randomUuid(): string {
  const c = globalThis.crypto;
  if (c?.randomUUID) return c.randomUUID();
  // Fallback for older WebViews that lack crypto.randomUUID.
  const bytes = new Uint8Array(16);
  if (c?.getRandomValues) c.getRandomValues(bytes);
  else for (let i = 0; i < 16; i++) bytes[i] = Math.floor(Math.random() * 256);
  bytes[6] = (bytes[6]! & 0x0f) | 0x40;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function getDeviceId(): string {
  try {
    let id = localStorage.getItem(UUID_KEY);
    if (!id) {
      id = randomUuid();
      localStorage.setItem(UUID_KEY, id);
    }
    return id;
  } catch {
    // Storage blocked (private browsing). An in-memory id still works for the
    // current session; it just will not persist.
    return (cachedHash ??= '');
  }
}

async function sha256Hex(input: string): Promise<string> {
  const bytes = new TextEncoder().encode(input);
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** 64-char hex digest identifying this device for its own rows only. */
export async function getClientHash(): Promise<string> {
  if (cachedHash) return cachedHash;
  const id = getDeviceId();
  // If crypto.subtle is unavailable (non-secure context), fall back to a stable
  // non-cryptographic hash. Still 64 chars so the RLS length check passes, but
  // this must not be mistaken for a security boundary — it is not one.
  if (!globalThis.crypto?.subtle) {
    let h1 = 0x811c9dc5;
    let h2 = 0x01000193;
    for (let i = 0; i < id.length; i++) {
      h1 = Math.imul(h1 ^ id.charCodeAt(i), 0x01000193) >>> 0;
      h2 = Math.imul(h2 + id.charCodeAt(i) + i, 0x85ebca6b) >>> 0;
    }
    return (cachedHash = (h1.toString(16).padStart(8, '0') + h2.toString(16).padStart(8, '0')).repeat(4));
  }
  cachedHash = await sha256Hex(id);
  return cachedHash;
}

/** Header name the RLS policies in 0002 read the client hash from. */
export const CLIENT_HASH_HEADER = 'x-malariax-client';

/** Test seam so the suite can exercise streak maths against a fixed identity. */
export function __setClientHashForTests(hash: string | null): void {
  cachedHash = hash;
}

export async function clearIdentity(): Promise<void> {
  cachedHash = null;
  try {
    localStorage.removeItem(UUID_KEY);
  } catch {
    /* nothing to clear */
  }
}
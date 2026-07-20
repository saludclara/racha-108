type CacheEntry<T> = { value: T; expiresAt: number };

const store = new Map<string, CacheEntry<unknown>>();

/** Simple in-memory TTL cache (per serverless instance / long-lived node). */
export function cachedGet<T>(key: string): T | null {
  const hit = store.get(key);
  if (!hit) return null;
  if (Date.now() > hit.expiresAt) {
    store.delete(key);
    return null;
  }
  return hit.value as T;
}

export function cachedSet<T>(key: string, value: T, ttlMs: number): void {
  store.set(key, { value, expiresAt: Date.now() + ttlMs });
}

export async function withCache<T>(
  key: string,
  ttlMs: number,
  loader: () => Promise<T>,
): Promise<T> {
  const hit = cachedGet<T>(key);
  if (hit != null) return hit;
  const value = await loader();
  cachedSet(key, value, ttlMs);
  return value;
}

/**
 * Budget-aware TTLs (Motor EV v2):
 * - live boards short (scores/minute)
 * - book odds 2–5 min
 * - AF long (free ~100 req/day)
 * - standings reserved for S2b
 */
export const CACHE_TTL = {
  /** Scoreboard / live — keep minute+score fresh */
  espn: 45_000,
  /** Free plan ~100 req/day — one window key */
  apiFootball: 30 * 60_000,
  /** Book prices — 12 min (free-tier credit safe; grind band is stable) */
  oddsApi: 12 * 60_000,
  pandascore: 2 * 60_000,
} as const;

/**
 * Caché TTL en memoria para búsquedas CJ / trends / status.
 * No persiste secretos. Multi-instance → Redis en API.
 */

type Entry<T> = { value: T; expiresAt: number };

const store = new Map<string, Entry<unknown>>();

export function cacheGet<T>(key: string, now = Date.now()): T | undefined {
  const e = store.get(key);
  if (!e) return undefined;
  if (e.expiresAt <= now) {
    store.delete(key);
    return undefined;
  }
  return e.value as T;
}

export function cacheSet<T>(key: string, value: T, ttlMs: number, now = Date.now()): void {
  store.set(key, { value, expiresAt: now + Math.max(0, ttlMs) });
}

export function cacheDel(key: string): void {
  store.delete(key);
}

export function cacheClear(): void {
  store.clear();
}

export async function cacheWrap<T>(
  key: string,
  ttlMs: number,
  fn: () => Promise<T>,
): Promise<{ value: T; hit: boolean }> {
  const hit = cacheGet<T>(key);
  if (hit !== undefined) return { value: hit, hit: true };
  const value = await fn();
  cacheSet(key, value, ttlMs);
  return { value, hit: false };
}

export const CACHE_TTL = {
  cjSearchMs: 5 * 60_000,
  cjVariantsMs: 10 * 60_000,
  shopifyStatusMs: 60_000,
  trendsMs: 15 * 60_000,
} as const;

export function cjSearchCacheKey(keyword: string, page = 1): string {
  return `cj:search:${keyword.trim().toLowerCase()}:p${page}`;
}

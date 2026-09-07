/**
 * Rate limiter en memoria (token bucket simplificado) para colas / conectores.
 * Para multi-proceso, la API debe usar Redis; esta lógica es el contrato unitario.
 */

export type RateLimitConfig = {
  key: string;
  /** Max requests per window */
  max: number;
  /** Window ms */
  windowMs: number;
};

type Bucket = { count: number; windowStart: number };

const buckets = new Map<string, Bucket>();

export function resetRateLimitStore(): void {
  buckets.clear();
}

export function takeToken(
  cfg: RateLimitConfig,
  now = Date.now(),
): { ok: boolean; remaining: number; retryAfterMs: number } {
  const b = buckets.get(cfg.key);
  if (!b || now - b.windowStart >= cfg.windowMs) {
    buckets.set(cfg.key, { count: 1, windowStart: now });
    return { ok: true, remaining: cfg.max - 1, retryAfterMs: 0 };
  }
  if (b.count >= cfg.max) {
    const retryAfterMs = Math.max(0, cfg.windowStart + cfg.windowMs - now);
    return { ok: false, remaining: 0, retryAfterMs };
  }
  b.count += 1;
  return { ok: true, remaining: cfg.max - b.count, retryAfterMs: 0 };
}

/** Defaults alineados a CJ ~1 rps y caps genéricos */
export const RATE_PRESETS = {
  cj: { key: 'cj', max: 1, windowMs: 1100 } satisfies RateLimitConfig,
  shopify: { key: 'shopify', max: 4, windowMs: 1000 } satisfies RateLimitConfig,
  serper: { key: 'serper', max: 5, windowMs: 1000 } satisfies RateLimitConfig,
  discovery: { key: 'discovery', max: 1, windowMs: 5000 } satisfies RateLimitConfig,
};

export async function withRateLimit<T>(
  cfg: RateLimitConfig,
  fn: () => Promise<T>,
  opts?: { maxWaitMs?: number },
): Promise<T> {
  const maxWait = opts?.maxWaitMs ?? 15_000;
  const start = Date.now();
  for (;;) {
    const t = takeToken(cfg);
    if (t.ok) return fn();
    if (Date.now() - start + t.retryAfterMs > maxWait) {
      throw new Error(`rate_limit_timeout:${cfg.key}`);
    }
    await new Promise((r) => setTimeout(r, Math.min(t.retryAfterMs || 50, 2000)));
  }
}

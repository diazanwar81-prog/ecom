/**
 * Fallbacks multi-capa — degradación controlada sin inventar datos.
 * Orden: primary → secondary → local/template → fail_closed
 */

export type FallbackLayer = 'primary' | 'secondary' | 'local' | 'fail_closed';

export type FallbackAttempt = {
  layer: FallbackLayer;
  provider: string;
  ok: boolean;
  error?: string;
  durationMs?: number;
};

export type FallbackResult<T> = {
  ok: boolean;
  value?: T;
  layer: FallbackLayer;
  provider: string;
  attempts: FallbackAttempt[];
  degraded: boolean;
};

export type FallbackStep<T> = {
  layer: FallbackLayer;
  provider: string;
  run: () => Promise<T>;
  /** If true, empty/null result counts as failure and continues chain */
  acceptEmpty?: boolean;
};

/**
 * Ejecuta pasos en orden hasta el primero que resuelve.
 * No rellena datos inventados: si todos fallan → ok:false fail_closed.
 */
export async function runFallbackChain<T>(
  steps: FallbackStep<T>[],
): Promise<FallbackResult<T>> {
  const attempts: FallbackAttempt[] = [];
  for (const step of steps) {
    const t0 = Date.now();
    try {
      const value = await step.run();
      const empty =
        value === null ||
        value === undefined ||
        (typeof value === 'string' && value.trim() === '') ||
        (Array.isArray(value) && value.length === 0);
      if (empty && !step.acceptEmpty) {
        attempts.push({
          layer: step.layer,
          provider: step.provider,
          ok: false,
          error: 'empty_result',
          durationMs: Date.now() - t0,
        });
        continue;
      }
      attempts.push({
        layer: step.layer,
        provider: step.provider,
        ok: true,
        durationMs: Date.now() - t0,
      });
      return {
        ok: true,
        value: value as T,
        layer: step.layer,
        provider: step.provider,
        attempts,
        degraded: step.layer !== 'primary',
      };
    } catch (e: any) {
      attempts.push({
        layer: step.layer,
        provider: step.provider,
        ok: false,
        error: e?.message || String(e),
        durationMs: Date.now() - t0,
      });
    }
  }
  return {
    ok: false,
    layer: 'fail_closed',
    provider: 'none',
    attempts,
    degraded: true,
  };
}

/** Presets documentados para ECOM */
export const FALLBACK_PRESETS = {
  aiCopy: ['gemini', 'hf_free', 'template_local'] as const,
  supplierFulfill: ['cj_primary', 'cj_retry', 'manual_queue'] as const,
  productImages: ['cj_cdn', 'shopify_existing', 'placeholder_blocked'] as const,
  trends: ['serper', 'cached_trends', 'empty'] as const,
} as const;

export type ServiceHealth = {
  service: string;
  up: boolean;
  latencyMs?: number;
  error?: string;
};

/**
 * Decide modo degradado global a partir de salud de servicios.
 */
export function resolveDegradationMode(services: ServiceHealth[]): {
  mode: 'full' | 'degraded' | 'read_only' | 'halt';
  reasons: string[];
} {
  const down = services.filter((s) => !s.up);
  const reasons = down.map((s) => `${s.service}:${s.error || 'down'}`);
  const names = new Set(down.map((s) => s.service));

  if (names.has('postgres') || names.has('db')) {
    return { mode: 'halt', reasons };
  }
  if (names.has('shopify') && names.has('cj')) {
    return { mode: 'read_only', reasons };
  }
  if (names.has('redis')) {
    return { mode: 'degraded', reasons: [...reasons, 'queues_in_memory_fallback'] };
  }
  if (down.length > 0) {
    return { mode: 'degraded', reasons };
  }
  return { mode: 'full', reasons: [] };
}

/** Supplier switch: solo propone backup, no cambia sin aprobación si requireApproval */
export function planSupplierFallback(input: {
  primarySupplierId: string;
  primaryOk: boolean;
  backups: Array<{ id: string; available: boolean; score?: number }>;
  requireApproval: boolean;
}): {
  action: 'keep_primary' | 'propose_switch' | 'pause_product' | 'queue_manual';
  targetSupplierId?: string;
  needsApproval: boolean;
  reason: string;
} {
  if (input.primaryOk) {
    return { action: 'keep_primary', needsApproval: false, reason: 'primary_ok' };
  }
  const sorted = [...input.backups]
    .filter((b) => b.available)
    .sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
  if (!sorted.length) {
    return { action: 'pause_product', needsApproval: false, reason: 'no_backup' };
  }
  const best = sorted[0];
  if (input.requireApproval) {
    return {
      action: 'propose_switch',
      targetSupplierId: best.id,
      needsApproval: true,
      reason: 'backup_available_needs_approval',
    };
  }
  return {
    action: 'propose_switch',
    targetSupplierId: best.id,
    needsApproval: false,
    reason: 'backup_auto',
  };
}

/**
 * ECOM Jobs 24/7 — catálogo estable de intervalos y nombres
 * La API registra timers/workers; este módulo evita jobs huérfanos y caps.
 */

export type StableJobId =
  | 'discovery'
  | 'inventory_delist'
  | 'tracking_poll'
  | 'daily_digest'
  | 'pipeline'
  | 'autopilot_tick';

export type StableJobDef = {
  id: StableJobId;
  description: string;
  /** Default interval minutes */
  intervalMinutes: number;
  envIntervalKey?: string;
  enabledByDefault: boolean;
  requires: Array<'redis' | 'shopify' | 'cj' | 'telegram'>;
};

export const STABLE_JOB_CATALOG: StableJobDef[] = [
  {
    id: 'discovery',
    description: 'Discovery / trends → candidatos',
    intervalMinutes: 30,
    envIntervalKey: 'ECOM_DISCOVERY_INTERVAL_MINUTES',
    enabledByDefault: true,
    requires: ['redis'],
  },
  {
    id: 'inventory_delist',
    description: 'PUBLISHED: stock local + isProductListed CJ → pause',
    intervalMinutes: 20,
    envIntervalKey: 'ECOM_INVENTORY_INTERVAL_MINUTES',
    enabledByDefault: true,
    requires: ['cj'],
  },
  {
    id: 'tracking_poll',
    description: 'Orders fulfilled sin tracking → getOrderDetail',
    intervalMinutes: 30,
    envIntervalKey: 'ECOM_TRACKING_INTERVAL_MINUTES',
    enabledByDefault: true,
    requires: ['cj', 'shopify'],
  },
  {
    id: 'daily_digest',
    description: 'Resumen 09:00 America/Bogota',
    intervalMinutes: 1440,
    enabledByDefault: true,
    requires: ['telegram'],
  },
  {
    id: 'pipeline',
    description: 'Pipeline producto bajo demanda (cola)',
    intervalMinutes: 0,
    enabledByDefault: true,
    requires: ['redis'],
  },
  {
    id: 'autopilot_tick',
    description: 'Evalúa constraints y cola de auto-approve/publish',
    intervalMinutes: 15,
    envIntervalKey: 'ECOM_AUTOPILOT_INTERVAL_MINUTES',
    enabledByDefault: false,
    requires: ['redis'],
  },
];

export function resolveIntervalMinutes(def: StableJobDef): number {
  if (def.envIntervalKey) {
    const n = Number(process.env[def.envIntervalKey]);
    if (Number.isFinite(n) && n > 0) return Math.min(n, 24 * 60);
  }
  return def.intervalMinutes;
}

export type JobRunRecord = {
  id: StableJobId;
  startedAt: string;
  finishedAt?: string;
  ok: boolean;
  error?: string;
  itemsProcessed?: number;
};

/** In-memory last-run map for health (API can mirror to Redis/DB). */
const lastRuns = new Map<StableJobId, JobRunRecord>();

export function markJobStart(id: StableJobId): JobRunRecord {
  const rec: JobRunRecord = { id, startedAt: new Date().toISOString(), ok: false };
  lastRuns.set(id, rec);
  return rec;
}

export function markJobEnd(
  id: StableJobId,
  result: { ok: boolean; error?: string; itemsProcessed?: number },
): JobRunRecord {
  const prev = lastRuns.get(id) || markJobStart(id);
  const rec: JobRunRecord = {
    ...prev,
    finishedAt: new Date().toISOString(),
    ok: result.ok,
    error: result.error,
    itemsProcessed: result.itemsProcessed,
  };
  lastRuns.set(id, rec);
  return rec;
}

export function getJobHealth(): {
  jobs: Array<StableJobDef & { intervalResolved: number; lastRun?: JobRunRecord }>;
  killSwitch: boolean;
} {
  const kill =
    String(process.env.ECOM_KILL_SWITCH || '').toLowerCase() === 'true' ||
    String(process.env.ECOM_PAUSE_ALL || '').toLowerCase() === 'true';
  return {
    killSwitch: kill,
    jobs: STABLE_JOB_CATALOG.map((d) => ({
      ...d,
      intervalResolved: resolveIntervalMinutes(d),
      lastRun: lastRuns.get(d.id),
    })),
  };
}

export function shouldRunJob(id: StableJobId): { ok: boolean; reason?: string } {
  if (
    String(process.env.ECOM_KILL_SWITCH || '').toLowerCase() === 'true' ||
    String(process.env.ECOM_PAUSE_ALL || '').toLowerCase() === 'true'
  ) {
    return { ok: false, reason: 'kill_switch' };
  }
  const def = STABLE_JOB_CATALOG.find((j) => j.id === id);
  if (!def) return { ok: false, reason: 'unknown_job' };
  if (id === 'autopilot_tick' && String(process.env.ECOM_AUTOPILOT || '').toLowerCase() !== 'true') {
    return { ok: false, reason: 'ECOM_AUTOPILOT off' };
  }
  return { ok: true };
}

/**
 * FASE F2 — Ops 24/7: health unificado + política de reintento / alertas
 */
import { phase2CanRun, phase2Health, phase2GatePublish } from '@ecom/runtime';
import type { StableJobId } from '@ecom/jobs';

export const FINAL_F2 = {
  id: 'F2',
  name: 'Ops 24/7 estable',
  jobs: ['inventory_delist', 'tracking_poll', 'daily_digest', 'discovery'] as StableJobId[],
} as const;

export type JobRunResult = {
  jobId: string;
  ran: boolean;
  reason?: string;
  ok?: boolean;
  error?: string;
  itemsProcessed?: number;
};

export function ops247Snapshot() {
  const health = phase2Health();
  const gates = FINAL_F2.jobs.map((id) => {
    const g = phase2CanRun(id);
    return { id, ...g };
  });
  return {
    at: new Date().toISOString(),
    killSwitch: health.killSwitch,
    gates,
    health,
    stable: !health.killSwitch && gates.every((g) => g.ok || g.reason === 'disabled'),
  };
}

/** Política: si job falla N veces → alerta (contrato para API) */
export function shouldAlertJobFailure(input: {
  consecutiveFailures: number;
  threshold?: number;
}): { alert: boolean; severity: 'warn' | 'critical' } {
  const t = input.threshold ?? 3;
  if (input.consecutiveFailures >= t * 2) return { alert: true, severity: 'critical' };
  if (input.consecutiveFailures >= t) return { alert: true, severity: 'warn' };
  return { alert: false, severity: 'warn' };
}

export function ops247PublishAllowed(publishesToday: number) {
  return phase2GatePublish({ publishes: publishesToday });
}

/**
 * FASE 2 — Ops 24/7
 * Catálogo de jobs + gate kill-switch + registro de corridas.
 */
import {
  STABLE_JOB_CATALOG,
  shouldRunJob,
  markJobStart,
  markJobEnd,
  getJobHealth,
  type StableJobId,
} from '@ecom/jobs';
import { gateAction, isKillSwitchOn, formatAlertMessage } from '@ecom/ops-p2';

export const PHASE2 = {
  id: 2,
  name: 'Ops 24/7',
  jobs: STABLE_JOB_CATALOG.map((j) => j.id),
} as const;

export function phase2CanRun(jobId: StableJobId) {
  if (isKillSwitchOn()) return { ok: false as const, reason: 'kill_switch' };
  return shouldRunJob(jobId);
}

export function phase2Start(jobId: StableJobId) {
  return markJobStart(jobId);
}

export function phase2End(
  jobId: StableJobId,
  result: { ok: boolean; error?: string; itemsProcessed?: number },
) {
  return markJobEnd(jobId, result);
}

export function phase2Health() {
  return getJobHealth();
}

/** Antes de publish/fulfill en job: budget + kill */
export function phase2GatePublish(usage: {
  publishes: number;
  newProducts?: number;
  fulfills?: number;
  aiCalls?: number;
  spendUsd?: number;
}) {
  return gateAction({
    action: 'publishes',
    usage: {
      newProducts: usage.newProducts ?? 0,
      publishes: usage.publishes,
      fulfills: usage.fulfills ?? 0,
      aiCalls: usage.aiCalls ?? 0,
      spendUsd: usage.spendUsd ?? 0,
    },
  });
}

export function phase2AlertText(code: string, message: string) {
  return formatAlertMessage({
    id: `job-${Date.now()}`,
    severity: 'warn',
    code,
    message,
    at: new Date().toISOString(),
  });
}

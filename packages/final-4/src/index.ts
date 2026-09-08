export * from './e2e-order';
export * from './ops247';
export * from './autopilot-tick';
export * from './production';

import { e2eSelfTest } from './e2e-order';
import { ops247Snapshot } from './ops247';
import { productionBlock } from './production';
import { phase4Constraints } from '@ecom/runtime';

export function runFinal4SelfCheck(env: Record<string, string | undefined> = process.env) {
  const e2e = e2eSelfTest();
  const ops = ops247Snapshot();
  const prod = productionBlock(env);
  const constraints = phase4Constraints();
  return {
    at: new Date().toISOString(),
    f1_e2e: { ok: e2e.ok, ...e2e },
    f2_ops247: { ok: ops.stable, ...ops },
    f3_autopilot: {
      ok: true,
      enabled: constraints.enabled,
      mode: constraints.approvalMode,
      note: constraints.enabled ? 'tick disponible' : 'MANUAL — activar ECOM_AUTOPILOT=true',
    },
    f4_prod: { ok: prod.readiness.ok, score: prod.readiness.score, ...prod },
    allOk: e2e.ok && ops.stable && prod.readiness.ok,
  };
}

export const FINAL_4_META = {
  block: 'FINAL_4',
  phases: ['E2E_order', 'Ops_24_7', 'Autopilot', 'Production'],
};

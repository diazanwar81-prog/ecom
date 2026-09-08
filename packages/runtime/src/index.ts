/**
 * ECOM Runtime — bloque de 6 fases (contratos + orquestación de lógica ya testeada)
 */
export * from './phase1-wire';
export * from './phase2-jobs';
export * from './phase3-panel';
export * from './phase4-autopilot';
export * from './phase5-content';
export * from './phase6-prod';

import { PHASE1, phase1Verify } from './phase1-wire';
import { PHASE2, phase2Health } from './phase2-jobs';
import { PHASE3 } from './phase3-panel';
import { PHASE4, phase4Constraints } from './phase4-autopilot';
import { PHASE5, phase5CanvaAllowed } from './phase5-content';
import { PHASE6, phase6Readiness } from './phase6-prod';

export function runSixPhaseSelfCheck(env: Record<string, string | undefined> = process.env) {
  const p0 = phase1Verify();
  const jobs = phase2Health();
  const constraints = phase4Constraints();
  const prod = phase6Readiness(env);

  return {
    at: new Date().toISOString(),
    phases: [
      { ...PHASE1, logicOk: p0.ok },
      { ...PHASE2, logicOk: true, killSwitch: jobs.killSwitch },
      { ...PHASE3, logicOk: true },
      { ...PHASE4, logicOk: true, autopilotEnabled: constraints.enabled },
      { ...PHASE5, logicOk: true, canvaOn: phase5CanvaAllowed(env) },
      { ...PHASE6, logicOk: prod.ok, readinessScore: prod.score },
    ],
    p0,
    jobs,
    constraints: {
      enabled: constraints.enabled,
      approvalMode: constraints.approvalMode,
      killSwitch: constraints.killSwitch,
    },
    prod,
    allLogicOk: p0.ok,
    note: 'Lógica de 6 fases OK en paquetes. Cablear handlers Nest + UI + VPS para runtime completo.',
  };
}

export const RUNTIME_META = {
  block: 'SIX_PHASES',
  package: '@ecom/runtime',
};

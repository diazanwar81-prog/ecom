/**
 * FASE 4 — Autopilot acotado
 */
import {
  loadConstraintsFromEnv,
  evaluateAutopilotAction,
  type AutopilotAction,
  type UsageCounters,
} from '@ecom/autonomy/constraints';
import { scoreCandidate } from '@ecom/ops-p2';

export const PHASE4 = {
  id: 4,
  name: 'Autopilot acotado',
  envFlags: ['ECOM_AUTOPILOT', 'ECOM_AUTO_GO_LIVE', 'ECOM_APPROVAL_MODE'],
} as const;

export function phase4Constraints() {
  return loadConstraintsFromEnv();
}

export function phase4Allow(
  action: AutopilotAction,
  usage: UsageCounters,
  context?: { marginPct?: number; shippingPct?: number; isFirstPublish?: boolean },
) {
  const c = loadConstraintsFromEnv();
  return evaluateAutopilotAction(action, c, usage, context);
}

/**
 * Tick de autopilot: evalúa candidato ya descubierto.
 * No publica solo: devuelve decisión para que la API ejecute o encole approval.
 */
export function phase4EvaluateCandidate(input: {
  title: string;
  marginPercent?: number;
  demandScore?: number;
  supplierVerified?: boolean;
  stock?: number | null;
  shipsToCountry?: boolean;
  salePrice?: number;
  shippingCost?: number;
  usage: UsageCounters;
  isFirstPublish?: boolean;
}) {
  const scored = scoreCandidate({
    title: input.title,
    marginPercent: input.marginPercent,
    demandScore: input.demandScore,
    supplierVerified: input.supplierVerified,
    stock: input.stock ?? undefined,
    shipsToCountry: input.shipsToCountry,
    salePrice: input.salePrice,
    shippingCost: input.shippingCost,
  });

  if (scored.decision === 'REJECT') {
    return { next: 'reject' as const, scored, autopilot: null };
  }

  const approve = phase4Allow('auto_approve', input.usage, {
    marginPct: input.marginPercent,
  });
  if (!approve.allowed) {
    return {
      next: 'queue_approval' as const,
      scored,
      autopilot: approve,
    };
  }

  const publish = phase4Allow('auto_publish', input.usage, {
    marginPct: input.marginPercent,
    isFirstPublish: input.isFirstPublish,
  });
  if (!publish.allowed) {
    return {
      next: 'approved_wait_publish' as const,
      scored,
      autopilot: publish,
    };
  }

  return { next: 'auto_publish' as const, scored, autopilot: publish };
}

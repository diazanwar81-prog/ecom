/**
 * FASE F3 — Autopilot acotado: un tick evalúa candidatos en cola (sin publicar a ciegas)
 */
import { phase4EvaluateCandidate, phase4Constraints } from '@ecom/runtime';

export const FINAL_F3 = {
  id: 'F3',
  name: 'Autopilot acotado',
  defaultMode: 'MANUAL',
} as const;

export type QueueCandidate = {
  id: string;
  title: string;
  marginPercent?: number;
  demandScore?: number;
  supplierVerified?: boolean;
  stock?: number | null;
  shipsToCountry?: boolean;
  salePrice?: number;
  shippingCost?: number;
  isFirstPublish?: boolean;
};

export function autopilotTick(input: {
  candidates: QueueCandidate[];
  usage: {
    newProductsToday: number;
    publishesToday: number;
    fulfillsToday: number;
    aiCallsToday: number;
    autoApprovesToday: number;
  };
  maxPerTick?: number;
}) {
  const constraints = phase4Constraints();
  const max = input.maxPerTick ?? 5;
  const decisions: Array<{
    id: string;
    title: string;
    next: string;
    reason?: string;
  }> = [];

  if (!constraints.enabled) {
    return {
      enabled: false,
      approvalMode: constraints.approvalMode,
      decisions: input.candidates.slice(0, max).map((c) => ({
        id: c.id,
        title: c.title,
        next: 'skipped_autopilot_off',
      })),
      note: 'ECOM_AUTOPILOT no activo — solo MANUAL',
    };
  }

  for (const c of input.candidates.slice(0, max)) {
    const r = phase4EvaluateCandidate({
      title: c.title,
      marginPercent: c.marginPercent,
      demandScore: c.demandScore,
      supplierVerified: c.supplierVerified,
      stock: c.stock,
      shipsToCountry: c.shipsToCountry,
      salePrice: c.salePrice,
      shippingCost: c.shippingCost,
      usage: input.usage,
      isFirstPublish: c.isFirstPublish,
    });
    decisions.push({
      id: c.id,
      title: c.title,
      next: r.next,
      reason: r.autopilot && !r.autopilot.allowed ? r.autopilot.reasons?.join(',') : undefined,
    });
  }

  return {
    enabled: true,
    approvalMode: constraints.approvalMode,
    decisions,
    note: 'API debe ejecutar approve/publish solo si next=auto_publish y caps OK',
  };
}

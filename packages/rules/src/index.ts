/**
 * ECOM Rules Engine — MOCK-safe, deterministic business rules.
 * Margin ideal 40%, operational minimum 35%, pause <30% or stock=0.
 * Max 2 automatic price changes per product per day. Max ±10% per change.
 */

export type MarginBand = 'IDEAL' | 'OPERATIONAL' | 'ALERT' | 'PAUSE';

export interface CostBreakdown {
  productCost: number;
  shippingCost: number;
  paymentFee?: number;
  platformFee?: number;
  taxEstimate?: number;
  returnReserve?: number;
  otherDirect?: number;
}

export interface MarginInput {
  salePrice: number;
  costs: CostBreakdown;
}

export interface MarginResult {
  totalCost: number;
  profit: number;
  marginPercent: number;
  band: MarginBand;
  canPublish: boolean;
  shouldPause: boolean;
  shouldAlert: boolean;
  reason: string;
}

export interface PriceChangeDecision {
  allowed: boolean;
  proposedPrice: number;
  variationPercent: number;
  reason: string;
  requiresApproval: boolean;
}

export interface StockDecision {
  shouldPause: boolean;
  reason: string;
}

export const RULES = {
  MARGIN_IDEAL: 40,
  MARGIN_MIN: 35,
  MARGIN_ALERT_LOW: 30,
  MAX_PRICE_CHANGE_PER_DAY: 2,
  MAX_PRICE_VARIATION_PERCENT: 10,
  MIN_OPPORTUNITY_SCORE: 55,
  AUTO_PUBLISH_CONFIDENCE: 95,
} as const;

export function sumCosts(costs: CostBreakdown): number {
  return (
    (costs.productCost || 0) +
    (costs.shippingCost || 0) +
    (costs.paymentFee || 0) +
    (costs.platformFee || 0) +
    (costs.taxEstimate || 0) +
    (costs.returnReserve || 0) +
    (costs.otherDirect || 0)
  );
}

export function calculateMargin(input: MarginInput): MarginResult {
  const { salePrice, costs } = input;
  if (!Number.isFinite(salePrice) || salePrice <= 0) {
    return {
      totalCost: sumCosts(costs),
      profit: 0,
      marginPercent: 0,
      band: 'PAUSE',
      canPublish: false,
      shouldPause: true,
      shouldAlert: true,
      reason: 'Precio de venta inválido o cero',
    };
  }

  const totalCost = sumCosts(costs);
  const profit = salePrice - totalCost;
  const marginPercent = Number((((profit / salePrice) * 100).toFixed(2)));

  if (marginPercent >= RULES.MARGIN_IDEAL) {
    return {
      totalCost,
      profit,
      marginPercent,
      band: 'IDEAL',
      canPublish: true,
      shouldPause: false,
      shouldAlert: false,
      reason: `Margen ideal ≥ ${RULES.MARGIN_IDEAL}%`,
    };
  }
  if (marginPercent >= RULES.MARGIN_MIN) {
    return {
      totalCost,
      profit,
      marginPercent,
      band: 'OPERATIONAL',
      canPublish: true,
      shouldPause: false,
      shouldAlert: false,
      reason: `Margen operativo ≥ ${RULES.MARGIN_MIN}%`,
    };
  }
  if (marginPercent >= RULES.MARGIN_ALERT_LOW) {
    return {
      totalCost,
      profit,
      marginPercent,
      band: 'ALERT',
      canPublish: false,
      shouldPause: false,
      shouldAlert: true,
      reason: `Margen en alerta (${RULES.MARGIN_ALERT_LOW}–${RULES.MARGIN_MIN - 0.01}%)`,
    };
  }
  return {
    totalCost,
    profit,
    marginPercent,
    band: 'PAUSE',
    canPublish: false,
    shouldPause: true,
    shouldAlert: true,
    reason: `Margen < ${RULES.MARGIN_ALERT_LOW}% → pausa automática`,
  };
}

export function decideStock(stock: number | null | undefined): StockDecision {
  if (stock === null || stock === undefined) {
    return { shouldPause: false, reason: 'Stock desconocido — no pausar automáticamente' };
  }
  if (stock <= 0) {
    return { shouldPause: true, reason: 'Stock = 0 → pausa automática' };
  }
  return { shouldPause: false, reason: 'Stock disponible' };
}

export function decidePriceChange(params: {
  currentPrice: number;
  proposedPrice: number;
  changesToday: number;
  costs: CostBreakdown;
}): PriceChangeDecision {
  const { currentPrice, proposedPrice, changesToday, costs } = params;

  if (changesToday >= RULES.MAX_PRICE_CHANGE_PER_DAY) {
    return {
      allowed: false,
      proposedPrice,
      variationPercent: 0,
      reason: `Máximo ${RULES.MAX_PRICE_CHANGE_PER_DAY} cambios automáticos de precio por día`,
      requiresApproval: true,
    };
  }

  if (!Number.isFinite(currentPrice) || currentPrice <= 0 || !Number.isFinite(proposedPrice) || proposedPrice <= 0) {
    return {
      allowed: false,
      proposedPrice,
      variationPercent: 0,
      reason: 'Precios inválidos',
      requiresApproval: true,
    };
  }

  const variationPercent = Number(
    (Math.abs((proposedPrice - currentPrice) / currentPrice) * 100).toFixed(2),
  );

  if (variationPercent > RULES.MAX_PRICE_VARIATION_PERCENT) {
    return {
      allowed: false,
      proposedPrice,
      variationPercent,
      reason: `Variación ${variationPercent}% supera el máximo automático de ±${RULES.MAX_PRICE_VARIATION_PERCENT}%`,
      requiresApproval: true,
    };
  }

  const margin = calculateMargin({ salePrice: proposedPrice, costs });
  if (!margin.canPublish && margin.shouldPause) {
    return {
      allowed: false,
      proposedPrice,
      variationPercent,
      reason: `Nuevo precio deja margen en ${margin.marginPercent}% (pausa)`,
      requiresApproval: true,
    };
  }

  return {
    allowed: true,
    proposedPrice,
    variationPercent,
    reason: `Cambio automático permitido (${variationPercent}%, margen ${margin.marginPercent}%)`,
    requiresApproval: false,
  };
}

export function requiresHumanApproval(action: string): boolean {
  const always = [
    'FIRST_PUBLICATION',
    'NEW_SUPPLIER',
    'CHANGE_PRIMARY_SUPPLIER',
    'DELETE_PRODUCT',
    'PERMANENT_REMOVE',
    'CRITICAL_SHOPIFY_CONFIG',
    'EXCEPTIONAL_REFUND',
    'MARKET_CHANGE',
    'POLICY_CHANGE',
    'USE_PAID_AI',
  ];
  return always.includes(action.toUpperCase());
}

export function canAutoPublish(params: {
  marginPercent: number;
  opportunityScore: number | null;
  confidence: number;
  hasVerifiedSupplier: boolean;
  hasCriticalUnknownCost: boolean;
  isFirstPublication: boolean;
}): { ok: boolean; reason: string } {
  if (params.isFirstPublication) {
    return { ok: false, reason: 'Primera publicación requiere aprobación humana' };
  }
  if (params.hasCriticalUnknownCost) {
    return { ok: false, reason: 'Costo crítico desconocido' };
  }
  if (!params.hasVerifiedSupplier) {
    return { ok: false, reason: 'Sin proveedor verificado' };
  }
  if (params.marginPercent < RULES.MARGIN_MIN) {
    return { ok: false, reason: `Margen ${params.marginPercent}% < ${RULES.MARGIN_MIN}%` };
  }
  if (params.opportunityScore !== null && params.opportunityScore < RULES.MIN_OPPORTUNITY_SCORE) {
    return { ok: false, reason: `Opportunity score ${params.opportunityScore} < ${RULES.MIN_OPPORTUNITY_SCORE}` };
  }
  if (params.confidence < RULES.AUTO_PUBLISH_CONFIDENCE) {
    return { ok: false, reason: `Confianza ${params.confidence}% < ${RULES.AUTO_PUBLISH_CONFIDENCE}%` };
  }
  return { ok: true, reason: 'Cumple reglas de publicación automática' };
}

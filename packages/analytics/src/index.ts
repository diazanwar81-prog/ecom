/**
 * ECOM Analytics — block 33
 * Post-sale margin helpers, underperformance pause, price change limits.
 */

import {
  calculateMargin,
  decidePriceChange,
  RULES,
  type CostBreakdown,
} from '../../rules/src/index';

export type ProductPerf = {
  productId: string;
  title: string;
  status: string;
  marginPercent?: number | null;
  opportunityScore?: number | null;
  ordersCount: number;
  revenue: number;
  daysSincePublish?: number;
};

export function realizedMargin(input: {
  saleTotal: number;
  productCost: number;
  shippingCost: number;
  feesPct?: number;
}): { marginPercent: number; band: string; net: number } {
  const fees = (input.feesPct ?? 0.03) * input.saleTotal;
  const costs: CostBreakdown = {
    productCost: input.productCost,
    shippingCost: input.shippingCost,
    platformFee: fees,
  };
  const m = calculateMargin({ salePrice: input.saleTotal, costs });
  const net = input.saleTotal - m.totalCost;
  return {
    marginPercent: m.marginPercent,
    band: m.band,
    net: Math.round(net * 100) / 100,
  };
}

export function underperformanceDecision(
  p: ProductPerf,
  opts: { minDays?: number; minOrders?: number } = {},
): { shouldPause: boolean; reason: string } {
  const minDays = opts.minDays ?? 14;
  const minOrders = opts.minOrders ?? 1;
  if (p.status !== 'PUBLISHED') {
    return { shouldPause: false, reason: 'not_published' };
  }
  if ((p.daysSincePublish ?? 0) < minDays) {
    return { shouldPause: false, reason: 'window_not_elapsed' };
  }
  if (p.ordersCount >= minOrders) {
    return { shouldPause: false, reason: 'has_orders' };
  }
  if ((p.opportunityScore ?? 100) >= 70 && p.ordersCount === 0) {
    return { shouldPause: false, reason: 'high_score_keep_testing' };
  }
  return { shouldPause: true, reason: `no_orders_after_${minDays}d` };
}

export function proposePriceChange(input: {
  currentPrice: number;
  newPrice: number;
  changesToday: number;
  productCost: number;
  shippingCost: number;
}): {
  allowed: boolean;
  reason: string;
  projectedMargin?: number;
  decision: ReturnType<typeof decidePriceChange>;
} {
  const costs: CostBreakdown = {
    productCost: input.productCost,
    shippingCost: input.shippingCost,
  };
  const decision = decidePriceChange({
    currentPrice: input.currentPrice,
    proposedPrice: input.newPrice,
    changesToday: input.changesToday,
    costs,
  });
  const m = calculateMargin({ salePrice: input.newPrice, costs });
  if (!decision.allowed) {
    return {
      allowed: false,
      reason: decision.reason,
      decision,
      projectedMargin: m.marginPercent,
    };
  }
  if (m.band === 'PAUSE' || m.marginPercent < RULES.MARGIN_MIN) {
    return {
      allowed: false,
      reason: `projected_margin_${m.marginPercent}_below_min`,
      decision,
      projectedMargin: m.marginPercent,
    };
  }
  return {
    allowed: true,
    reason: 'ok',
    decision,
    projectedMargin: m.marginPercent,
  };
}

export const ANALYTICS_META = {
  block: 33,
  underperformanceDaysDefault: 14,
  maxPriceChangesPerDay: RULES.MAX_PRICE_CHANGE_PER_DAY,
  maxPriceVariationPercent: RULES.MAX_PRICE_VARIATION_PERCENT,
};

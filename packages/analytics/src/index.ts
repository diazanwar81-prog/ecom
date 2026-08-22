/**
 * ECOM Analytics — block 33
 * Post-sale margin helpers, underperformance pause, price change limits.
 */

import {
  calculateMargin,
  decidePriceChange,
  RULES,
} from '../../rules/src/index';

export type OrderLineLike = {
  price: number;
  quantity?: number;
  title?: string;
};

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
  feesPct?: number; // e.g. 0.03 Shopify-ish
}): { marginPercent: number; band: string; net: number } {
  const fees = (input.feesPct ?? 0.03) * input.saleTotal;
  const cost = input.productCost + input.shippingCost + fees;
  const net = input.saleTotal - cost;
  const m = calculateMargin({
    salePrice: input.saleTotal,
    productCost: input.productCost,
    shippingCost: input.shippingCost + fees,
  });
  return {
    marginPercent: m.marginPercent,
    band: m.band,
    net: Math.round(net * 100) / 100,
  };
}

/** Underperformance: no orders after window + low score → suggest pause */
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
    return {
      shouldPause: false,
      reason: 'high_score_keep_testing',
    };
  }
  return {
    shouldPause: true,
    reason: `no_orders_after_${minDays}d`,
  };
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
  const decision = decidePriceChange({
    currentPrice: input.currentPrice,
    newPrice: input.newPrice,
    changesToday: input.changesToday,
  });
  const m = calculateMargin({
    salePrice: input.newPrice,
    productCost: input.productCost,
    shippingCost: input.shippingCost,
  });
  if (!decision.ok) {
    return { allowed: false, reason: decision.reason, decision, projectedMargin: m.marginPercent };
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

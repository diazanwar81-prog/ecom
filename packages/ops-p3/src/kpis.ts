/**
 * Dashboard KPIs — métricas puras a partir de contadores (API/DB alimenta el input).
 * No inventa ventas ni márgenes: solo agrega lo que recibe.
 */

export type KpiInput = {
  mode: string;
  /** Products */
  productsDetected: number;
  productsPendingApproval: number;
  productsDraft: number;
  productsPublished: number;
  productsPaused: number;
  productsRejected: number;
  /** Orders */
  ordersPaid: number;
  ordersFulfilling: number;
  ordersFulfilled: number;
  ordersCancelled: number;
  /** Ops */
  jobsFailed24h: number;
  stockRisks: number;
  killSwitch: boolean;
  /** Optional money (only if real data provided; else null) */
  revenueToday?: number | null;
  costToday?: number | null;
  currency?: string;
  /** Integrations */
  shopifyConnected: boolean;
  cjConnected: boolean;
  telegramConnected: boolean;
  /** Caps usage today */
  publishesToday: number;
  publishCap: number;
  fulfillsToday: number;
  fulfillCap: number;
};

export type KpiCard = {
  id: string;
  label: string;
  value: number | string;
  unit?: string;
  severity: 'ok' | 'warn' | 'critical' | 'neutral';
  hint?: string;
};

export type DashboardKpis = {
  generatedAt: string;
  mode: string;
  health: 'healthy' | 'degraded' | 'critical';
  cards: KpiCard[];
  funnel: {
    detected: number;
    pending: number;
    draft: number;
    published: number;
    paused: number;
  };
  orders: {
    paid: number;
    fulfilling: number;
    fulfilled: number;
    cancelled: number;
  };
  marginToday: {
    revenue: number | null;
    cost: number | null;
    gross: number | null;
    currency: string;
    verified: boolean;
  };
  capacity: {
    publishesUsed: number;
    publishCap: number;
    fulfillsUsed: number;
    fulfillCap: number;
  };
  integrations: {
    shopify: boolean;
    cj: boolean;
    telegram: boolean;
  };
};

function severityFromHealth(input: KpiInput): DashboardKpis['health'] {
  if (input.killSwitch) return 'critical';
  if (!input.shopifyConnected || !input.cjConnected) return 'degraded';
  if (input.jobsFailed24h > 5 || input.stockRisks > 10) return 'critical';
  if (input.jobsFailed24h > 0 || input.stockRisks > 0) return 'degraded';
  return 'healthy';
}

export function buildDashboardKpis(input: KpiInput): DashboardKpis {
  const health = severityFromHealth(input);
  const currency = input.currency || 'COP';
  const hasMoney =
    input.revenueToday != null &&
    input.costToday != null &&
    Number.isFinite(input.revenueToday) &&
    Number.isFinite(input.costToday);
  const revenue = hasMoney ? Number(input.revenueToday) : null;
  const cost = hasMoney ? Number(input.costToday) : null;
  const gross = hasMoney && revenue != null && cost != null ? revenue - cost : null;

  const cards: KpiCard[] = [
    {
      id: 'published',
      label: 'Publicados',
      value: input.productsPublished,
      severity: 'neutral',
    },
    {
      id: 'pending',
      label: 'Pend. aprobación',
      value: input.productsPendingApproval,
      severity: input.productsPendingApproval > 10 ? 'warn' : 'neutral',
    },
    {
      id: 'paused',
      label: 'Pausados',
      value: input.productsPaused,
      severity: input.productsPaused > 0 ? 'warn' : 'ok',
    },
    {
      id: 'orders_paid',
      label: 'Pedidos PAID',
      value: input.ordersPaid,
      severity: 'neutral',
    },
    {
      id: 'orders_fulfilled',
      label: 'Fulfilled',
      value: input.ordersFulfilled,
      severity: 'ok',
    },
    {
      id: 'jobs_failed',
      label: 'Jobs fallidos 24h',
      value: input.jobsFailed24h,
      severity: input.jobsFailed24h > 5 ? 'critical' : input.jobsFailed24h > 0 ? 'warn' : 'ok',
    },
    {
      id: 'stock_risks',
      label: 'Riesgos stock',
      value: input.stockRisks,
      severity: input.stockRisks > 0 ? 'warn' : 'ok',
    },
    {
      id: 'kill_switch',
      label: 'Kill switch',
      value: input.killSwitch ? 'ON' : 'OFF',
      severity: input.killSwitch ? 'critical' : 'ok',
    },
    {
      id: 'publish_cap',
      label: 'Publish hoy',
      value: `${input.publishesToday}/${input.publishCap}`,
      severity: input.publishesToday >= input.publishCap ? 'warn' : 'neutral',
    },
    {
      id: 'gross_today',
      label: 'Margen bruto hoy',
      value: gross != null ? gross : 'UNVERIFIED',
      unit: gross != null ? currency : undefined,
      severity: gross == null ? 'neutral' : gross < 0 ? 'critical' : 'ok',
      hint: gross == null ? 'Sin revenue/cost verificados' : undefined,
    },
  ];

  return {
    generatedAt: new Date().toISOString(),
    mode: input.mode,
    health,
    cards,
    funnel: {
      detected: input.productsDetected,
      pending: input.productsPendingApproval,
      draft: input.productsDraft,
      published: input.productsPublished,
      paused: input.productsPaused,
    },
    orders: {
      paid: input.ordersPaid,
      fulfilling: input.ordersFulfilling,
      fulfilled: input.ordersFulfilled,
      cancelled: input.ordersCancelled,
    },
    marginToday: {
      revenue,
      cost,
      gross,
      currency,
      verified: hasMoney,
    },
    capacity: {
      publishesUsed: input.publishesToday,
      publishCap: input.publishCap,
      fulfillsUsed: input.fulfillsToday,
      fulfillCap: input.fulfillCap,
    },
    integrations: {
      shopify: input.shopifyConnected,
      cj: input.cjConnected,
      telegram: input.telegramConnected,
    },
  };
}

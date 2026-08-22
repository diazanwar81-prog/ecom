/**
 * ECOM Ops helpers — block 27
 * Inventory sync loop, tracking poll, daily digest payload, Shopify webhook HMAC.
 */

import { createHmac, timingSafeEqual } from 'crypto';

export function verifyShopifyHmac(
  rawBody: string | Buffer,
  hmacHeader: string | undefined,
  secret: string | undefined,
): boolean {
  if (!secret || !hmacHeader) return false;
  const digest = createHmac('sha256', secret).update(rawBody).digest('base64');
  try {
    const a = Buffer.from(digest);
    const b = Buffer.from(hmacHeader);
    if (a.length !== b.length) return false;
    return timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

export type InventoryTarget = {
  productId: string;
  title: string;
  externalId?: string | null;
  cjSku?: string | null;
  cjVariantId?: string | null;
  ecomStock?: number | null;
};

export type InventorySyncResult = {
  productId: string;
  ok: boolean;
  available?: number;
  paused?: boolean;
  error?: string;
};

/** Decide pause when supplier stock is 0 */
export function stockPauseDecision(available: number | null | undefined): {
  shouldPause: boolean;
  reason: string;
} {
  if (available == null) return { shouldPause: false, reason: 'stock_unknown' };
  if (available <= 0) return { shouldPause: true, reason: 'stock_zero' };
  return { shouldPause: false, reason: 'stock_ok' };
}

export type TrackingPollItem = {
  orderId: string;
  supplierOrderId?: string | null;
  externalId?: string | null;
  status: string;
  fulfillmentNote?: string | null;
};

export function parseSupplierOrderId(note?: string | null): string | null {
  if (!note) return null;
  const m = String(note).match(/CJ\s+(?:LIVE|MOCK)\s+·\s+([^·\s]+)/i);
  return m?.[1] || null;
}

export function buildDailyDigest(input: {
  mode: string;
  published: number;
  pendingApprovals: number;
  paidOrders: number;
  fulfilledOrders: number;
  pausedProducts: number;
  stockRisks: number;
  jobsFailed: number;
  date: string;
}): { title: string; body: string; severity: 'info' | 'warn' } {
  const lines = [
    `Resumen ECOM ${input.date}`,
    `Modo: ${input.mode}`,
    `Publicados: ${input.published}`,
    `Aprobaciones PENDING: ${input.pendingApprovals}`,
    `Pedidos PAID: ${input.paidOrders} · FULFILLED: ${input.fulfilledOrders}`,
    `Pausados: ${input.pausedProducts} · Riesgos stock: ${input.stockRisks}`,
    `Jobs fallidos (ventana): ${input.jobsFailed}`,
  ];
  const severity =
    input.stockRisks > 0 || input.jobsFailed > 0 || input.pendingApprovals > 5
      ? 'warn'
      : 'info';
  return {
    title: `ECOM digest ${input.date}`,
    body: lines.join('\n'),
    severity,
  };
}

export function realModeChecklist(env: Record<string, string | undefined>): {
  ok: boolean;
  items: { key: string; ok: boolean; note: string }[];
} {
  const items = [
    {
      key: 'SHOPIFY_ACCESS_TOKEN',
      ok: Boolean(env.SHOPIFY_ACCESS_TOKEN || env.SHOPIFY_ADMIN_TOKEN),
      note: 'Token Admin API',
    },
    {
      key: 'SHOPIFY_SHOP_DOMAIN',
      ok: Boolean(env.SHOPIFY_SHOP_DOMAIN || env.SHOPIFY_SHOP),
      note: 'Dominio *.myshopify.com',
    },
    {
      key: 'SHOPIFY_WEBHOOK_SECRET',
      ok: Boolean(env.SHOPIFY_WEBHOOK_SECRET),
      note: 'Firma webhooks',
    },
    {
      key: 'CJ_API_KEY',
      ok: Boolean(env.CJ_API_KEY),
      note: 'API key CJ',
    },
    {
      key: 'ECOM_ALLOW_PAID_AI',
      ok: env.ECOM_ALLOW_PAID_AI !== 'true',
      note: 'Debe ser false (presupuesto $0)',
    },
    {
      key: 'TELEGRAM_BOT_TOKEN',
      ok: Boolean(env.TELEGRAM_BOT_TOKEN),
      note: 'Alertas (recomendado)',
    },
    {
      key: 'SESSION_SECRET',
      ok: Boolean(env.SESSION_SECRET && env.SESSION_SECRET.length >= 16),
      note: 'Sesión panel ≥16 chars',
    },
  ];
  return { ok: items.every((i) => i.ok), items };
}

export const OPS_META = {
  block: 27,
  features: ['webhook_hmac', 'inventory_job', 'tracking_poll', 'daily_digest', 'real_checklist'],
};

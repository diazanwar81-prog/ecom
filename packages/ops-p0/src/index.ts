/**
 * ECOM Ops P0 — bloque único
 * 1) Webhook Shopify (HMAC + idempotencia + path canónico)
 * 2) Tracking post-fulfill (poll CJ getOrderDetail)
 * 3) Checklist E2E (sin inventar datos live)
 * 4) Inventario / delist continuo (stock_zero + isProductListed)
 */

import { createHmac, timingSafeEqual } from 'crypto';

// ─── 1) WEBHOOK ───────────────────────────────────────────────────────────────

export const SHOPIFY_ORDERS_WEBHOOK_PATH = '/shopify/webhooks/orders';
export const SHOPIFY_ORDERS_PAID_TOPIC = 'orders/paid';

export function buildOrdersWebhookAddress(publicBaseUrl: string): string {
  const base = String(publicBaseUrl || '').replace(/\/+$/, '');
  return `${base}${SHOPIFY_ORDERS_WEBHOOK_PATH}`;
}

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

export type ShopifyPaidOrderPayload = {
  id?: number | string;
  name?: string;
  email?: string;
  total_price?: string;
  currency?: string;
  financial_status?: string;
  line_items?: Array<{ title?: string; quantity?: number; price?: string; sku?: string }>;
  shipping_address?: {
    name?: string;
    address1?: string;
    city?: string;
    country?: string;
    country_code?: string;
    zip?: string;
    phone?: string;
  };
};

export type WebhookIngestDecision =
  | { action: 'reject'; reason: 'missing_hmac' | 'invalid_hmac' | 'invalid_json' }
  | { action: 'ignore'; reason: 'not_paid' | 'missing_id' }
  | { action: 'duplicate'; externalId: string }
  | {
      action: 'create';
      externalId: string;
      orderNumber: string;
      email: string;
      total: number;
      currency: string;
      lineItems: Array<{ title: string; quantity: number; price: number; sku?: string }>;
      shipping?: {
        name?: string;
        address?: string;
        city?: string;
        country?: string;
        zip?: string;
        phone?: string;
      };
    };

/** Pure decision after HMAC already verified (or MOCK test). Idempotent by externalId. */
export function decideWebhookIngest(
  payload: ShopifyPaidOrderPayload | null,
  existingExternalIds: Set<string> | string[],
): WebhookIngestDecision {
  if (!payload || typeof payload !== 'object') {
    return { action: 'reject', reason: 'invalid_json' };
  }
  const externalId = payload.id != null ? String(payload.id) : '';
  if (!externalId) return { action: 'ignore', reason: 'missing_id' };

  const set =
    existingExternalIds instanceof Set
      ? existingExternalIds
      : new Set(existingExternalIds.map(String));
  if (set.has(externalId)) return { action: 'duplicate', externalId };

  const fin = String(payload.financial_status || '').toLowerCase();
  // orders/paid topic usually paid; still guard
  if (fin && fin !== 'paid' && fin !== 'partially_paid') {
    return { action: 'ignore', reason: 'not_paid' };
  }

  const lines = (payload.line_items || []).map((li) => ({
    title: String(li.title || 'Item'),
    quantity: Math.max(1, Number(li.quantity) || 1),
    price: Number(li.price) || 0,
    sku: li.sku ? String(li.sku) : undefined,
  }));

  const ship = payload.shipping_address;
  return {
    action: 'create',
    externalId,
    orderNumber: String(payload.name || `#${externalId}`),
    email: String(payload.email || ''),
    total: Number(payload.total_price) || 0,
    currency: String(payload.currency || 'COP'),
    lineItems: lines,
    shipping: ship
      ? {
          name: ship.name,
          address: ship.address1,
          city: ship.city,
          country: ship.country_code || ship.country,
          zip: ship.zip,
          phone: ship.phone,
        }
      : undefined,
  };
}

export function processShopifyWebhookRequest(input: {
  rawBody: string | Buffer;
  hmacHeader?: string;
  secret?: string;
  existingExternalIds: Set<string> | string[];
  /** When true, skip HMAC (only for local MOCK tests — never in REAL). */
  skipHmac?: boolean;
}): { ok: boolean; statusCode: number; decision: WebhookIngestDecision; error?: string } {
  if (!input.skipHmac) {
    if (!input.hmacHeader || !input.secret) {
      return {
        ok: false,
        statusCode: 401,
        decision: { action: 'reject', reason: 'missing_hmac' },
        error: 'missing_hmac',
      };
    }
    if (!verifyShopifyHmac(input.rawBody, input.hmacHeader, input.secret)) {
      return {
        ok: false,
        statusCode: 401,
        decision: { action: 'reject', reason: 'invalid_hmac' },
        error: 'invalid_hmac',
      };
    }
  }

  let payload: ShopifyPaidOrderPayload | null = null;
  try {
    const text = typeof input.rawBody === 'string' ? input.rawBody : input.rawBody.toString('utf8');
    payload = JSON.parse(text) as ShopifyPaidOrderPayload;
  } catch {
    return {
      ok: false,
      statusCode: 400,
      decision: { action: 'reject', reason: 'invalid_json' },
      error: 'invalid_json',
    };
  }

  const decision = decideWebhookIngest(payload, input.existingExternalIds);
  if (decision.action === 'reject') {
    return { ok: false, statusCode: 400, decision };
  }
  if (decision.action === 'duplicate') {
    return { ok: true, statusCode: 200, decision }; // idempotent OK
  }
  if (decision.action === 'ignore') {
    return { ok: true, statusCode: 200, decision };
  }
  return { ok: true, statusCode: 200, decision };
}

// ─── 2) TRACKING POST-FULFILL ─────────────────────────────────────────────────

export type TrackingSnapshot = {
  supplierOrderId: string;
  trackingNumber: string | null;
  carrier: string | null;
  trackingUrl: string | null;
  orderStatus: string | null;
  isPlaceholder: boolean;
  source: 'cj' | 'mock' | 'note_parse';
};

const PLACEHOLDER = /^(n\/?a|na|null|undefined|pending|tbd|-|—|–)$/i;

export function isPlaceholderTracking(value?: string | null): boolean {
  if (!value) return true;
  return PLACEHOLDER.test(String(value).trim());
}

export function parseTrackingFromNote(note?: string | null): {
  supplierOrderId: string | null;
  trackingNumber: string | null;
  carrier: string | null;
} {
  const raw = String(note || '').trim();
  if (!raw) return { supplierOrderId: null, trackingNumber: null, carrier: null };
  const supplier =
    raw.match(/\b(cj[-_][a-z0-9]+|mock-cj[-_][a-z0-9]+)\b/i)?.[1] ||
    raw.match(/CJ\s+(?:LIVE|MOCK)\s*[·|]\s*([^·|\s]+)/i)?.[1] ||
    null;
  let tracking =
    raw.match(/tracking\s*[:=]?\s*([A-Z0-9-]{6,})/i)?.[1] ||
    raw.match(/\b([A-Z]{2}\d{9,}[A-Z]{0,2})\b/)?.[1] ||
    null;
  if (tracking && PLACEHOLDER.test(tracking)) tracking = null;
  const carrier =
    raw.match(/\b(CJPacket(?:\s+Ordinary)?|YunExpress|China Post|MOCK-Logistics)\b/i)?.[1] || null;
  return { supplierOrderId: supplier, trackingNumber: tracking, carrier };
}

/** Normalize CJ getOrderDetail-like payload into tracking snapshot (no invented numbers). */
export function normalizeCjOrderTracking(
  supplierOrderId: string,
  data: any,
): TrackingSnapshot {
  const d = data?.data ?? data ?? {};
  const trackingNumber = d.trackingNumber || d.trackNumber || d.trackingNo || null;
  const carrier = d.trackingProvider || d.logisticName || d.logisticsName || d.carrier || null;
  const trackingUrl = d.trackingUrl || d.trackUrl || null;
  const orderStatus = d.orderStatus || d.status || null;
  const num = trackingNumber ? String(trackingNumber) : null;
  return {
    supplierOrderId,
    trackingNumber: num && !isPlaceholderTracking(num) ? num : null,
    carrier: carrier ? String(carrier) : null,
    trackingUrl: trackingUrl ? String(trackingUrl) : null,
    orderStatus: orderStatus ? String(orderStatus) : null,
    isPlaceholder: !num || isPlaceholderTracking(num),
    source: 'cj',
  };
}

export type TrackingPollDecision =
  | { action: 'skip'; reason: 'no_supplier_order' | 'already_has_tracking' | 'not_fulfilled' }
  | { action: 'poll'; supplierOrderId: string }
  | { action: 'update'; snapshot: TrackingSnapshot };

export function decideTrackingPoll(order: {
  status: string;
  supplierOrderId?: string | null;
  fulfillmentNote?: string | null;
  trackingNumber?: string | null;
}): TrackingPollDecision {
  const st = String(order.status || '').toUpperCase();
  if (st !== 'FULFILLED' && st !== 'PAID' && st !== 'PROCESSING') {
    // still allow FULFILLED primarily
  }
  if (!['FULFILLED', 'PAID', 'PROCESSING', 'SHIPPED'].includes(st) && st) {
    if (st === 'CANCELLED' || st === 'REFUNDED') {
      return { action: 'skip', reason: 'not_fulfilled' };
    }
  }

  if (order.trackingNumber && !isPlaceholderTracking(order.trackingNumber)) {
    return { action: 'skip', reason: 'already_has_tracking' };
  }

  const fromNote = parseTrackingFromNote(order.fulfillmentNote);
  if (fromNote.trackingNumber && !isPlaceholderTracking(fromNote.trackingNumber)) {
    return {
      action: 'update',
      snapshot: {
        supplierOrderId: fromNote.supplierOrderId || order.supplierOrderId || '',
        trackingNumber: fromNote.trackingNumber,
        carrier: fromNote.carrier,
        trackingUrl: null,
        orderStatus: null,
        isPlaceholder: false,
        source: 'note_parse',
      },
    };
  }

  const sid = order.supplierOrderId || fromNote.supplierOrderId;
  if (!sid) return { action: 'skip', reason: 'no_supplier_order' };
  return { action: 'poll', supplierOrderId: String(sid) };
}

export function shouldRetryTracking(snapshot: TrackingSnapshot, attempts: number, maxAttempts = 48): boolean {
  if (attempts >= maxAttempts) return false;
  return snapshot.isPlaceholder || !snapshot.trackingNumber;
}

// ─── 3) E2E CHECKLIST (determinista, sin llamadas live obligatorias) ──────────

export type E2ECheck = {
  id: string;
  critical: boolean;
  ok: boolean;
  message: string;
};

export function runE2ELogicChecklist(input: {
  webhookPathOk: boolean;
  hmacVerified: boolean;
  idempotentDuplicateOk: boolean;
  trackingNormalizeOk: boolean;
  delistPauseOk: boolean;
  stockZeroPauseOk: boolean;
  registerAddressIncludesShopifyPath: boolean;
}): { ok: boolean; criticalFailed: number; score: number; checks: E2ECheck[] } {
  const checks: E2ECheck[] = [
    {
      id: 'webhook_path',
      critical: true,
      ok: input.webhookPathOk && input.registerAddressIncludesShopifyPath,
      message: 'Path canónico /shopify/webhooks/orders',
    },
    {
      id: 'hmac',
      critical: true,
      ok: input.hmacVerified,
      message: 'HMAC Shopify verificado',
    },
    {
      id: 'idempotency',
      critical: true,
      ok: input.idempotentDuplicateOk,
      message: 'Pedido duplicado no crea segunda Order',
    },
    {
      id: 'tracking_normalize',
      critical: true,
      ok: input.trackingNormalizeOk,
      message: 'Normalización tracking CJ sin inventar números',
    },
    {
      id: 'delist_pause',
      critical: true,
      ok: input.delistPauseOk,
      message: 'Delist CJ → pause',
    },
    {
      id: 'stock_zero_pause',
      critical: true,
      ok: input.stockZeroPauseOk,
      message: 'Stock 0 local → pause',
    },
  ];
  const criticalFailed = checks.filter((c) => c.critical && !c.ok).length;
  const score = Math.round((checks.filter((c) => c.ok).length / checks.length) * 100);
  return { ok: criticalFailed === 0, criticalFailed, score, checks };
}

/** Self-test of pure logic (call in unit tests or /ops/p0/verify). */
export function selfTestP0(): { ok: boolean; report: ReturnType<typeof runE2ELogicChecklist>; details: Record<string, unknown> } {
  const secret = 'test_secret_ecom_p0';
  const body = JSON.stringify({
    id: 999001,
    name: '#1001',
    email: 't@test.com',
    total_price: '10.00',
    currency: 'COP',
    financial_status: 'paid',
    line_items: [{ title: 'Prod', quantity: 1, price: '10.00', sku: 'SKU1' }],
  });
  const hmac = createHmac('sha256', secret).update(body).digest('base64');

  const first = processShopifyWebhookRequest({
    rawBody: body,
    hmacHeader: hmac,
    secret,
    existingExternalIds: [],
  });
  const dup = processShopifyWebhookRequest({
    rawBody: body,
    hmacHeader: hmac,
    secret,
    existingExternalIds: ['999001'],
  });
  const badHmac = processShopifyWebhookRequest({
    rawBody: body,
    hmacHeader: 'bad',
    secret,
    existingExternalIds: [],
  });

  const snap = normalizeCjOrderTracking('cj-1', {
    data: { trackingNumber: 'n/a', trackingProvider: 'CJPacket' },
  });
  const snapOk = normalizeCjOrderTracking('cj-2', {
    data: { trackingNumber: 'CJ123456789CN', trackingProvider: 'YunExpress', trackingUrl: 'https://example.com/t' },
  });

  const addr = buildOrdersWebhookAddress('https://ecom.example.com');
  const delist = inventoryDelistDecision({ listed: false, ecomStock: 5 });
  const zero = inventoryDelistDecision({ listed: true, ecomStock: 0 });

  const report = runE2ELogicChecklist({
    webhookPathOk: SHOPIFY_ORDERS_WEBHOOK_PATH === '/shopify/webhooks/orders',
    hmacVerified: first.ok && !badHmac.ok,
    idempotentDuplicateOk: dup.decision.action === 'duplicate',
    trackingNormalizeOk: snap.isPlaceholder === true && snapOk.isPlaceholder === false,
    delistPauseOk: delist.shouldPause && delist.reason === 'cj_delisted',
    stockZeroPauseOk: zero.shouldPause && zero.reason === 'stock_zero',
    registerAddressIncludesShopifyPath: addr.endsWith('/shopify/webhooks/orders'),
  });

  return {
    ok: report.ok,
    report,
    details: {
      firstAction: first.decision.action,
      dupAction: dup.decision.action,
      badHmacStatus: badHmac.statusCode,
      addr,
      snapPlaceholder: snap.isPlaceholder,
      snapOkTracking: snapOk.trackingNumber,
    },
  };
}

// ─── 4) INVENTARIO / DELIST CONTINUO ──────────────────────────────────────────

export type InventoryTarget = {
  productId: string;
  title: string;
  externalId?: string | null;
  cjSku?: string | null;
  cjVariantId?: string | null;
  ecomStock?: number | null;
  status?: string;
};

export function inventoryDelistDecision(input: {
  listed?: boolean | null;
  ecomStock?: number | null;
  listCheckOk?: boolean;
}): { shouldPause: boolean; reason: string } {
  if (input.ecomStock != null && input.ecomStock <= 0) {
    return { shouldPause: true, reason: 'stock_zero' };
  }
  if (input.listCheckOk === false) {
    return { shouldPause: false, reason: 'list_check_failed' };
  }
  if (input.listed === false) {
    return { shouldPause: true, reason: 'cj_delisted' };
  }
  return { shouldPause: false, reason: 'ok' };
}

export function planInventoryPass(targets: InventoryTarget[]): {
  toCheck: InventoryTarget[];
  skipped: number;
} {
  const toCheck = targets.filter((t) => {
    const st = String(t.status || 'PUBLISHED').toUpperCase();
    return st === 'PUBLISHED' && Boolean(t.cjSku || t.cjVariantId);
  });
  return { toCheck, skipped: targets.length - toCheck.length };
}

export type InventoryPassResultItem = {
  productId: string;
  ok: boolean;
  paused: boolean;
  reason: string;
  listed?: boolean;
  error?: string;
};

/**
 * Pure reducer after external isProductListed + local stock are known.
 * Wire in API:
 *   for each planInventoryPass().toCheck → isProductListed(sku) → applyInventoryDecision
 */
export function applyInventoryDecision(
  target: InventoryTarget,
  listedResult: { ok: boolean; listed: boolean; error?: string },
): InventoryPassResultItem {
  if (!listedResult.ok) {
    const local = inventoryDelistDecision({
      ecomStock: target.ecomStock,
      listCheckOk: false,
    });
    return {
      productId: target.productId,
      ok: false,
      paused: local.shouldPause,
      reason: local.reason,
      error: listedResult.error || 'list_check_failed',
    };
  }
  const d = inventoryDelistDecision({
    listed: listedResult.listed,
    ecomStock: target.ecomStock,
    listCheckOk: true,
  });
  return {
    productId: target.productId,
    ok: true,
    paused: d.shouldPause,
    reason: d.reason,
    listed: listedResult.listed,
  };
}

export const OPS_P0_META = {
  block: 'P0',
  features: [
    'webhook_hmac_idempotent',
    'webhook_path_shopify_orders',
    'tracking_poll_normalize',
    'inventory_delist_loop',
    'e2e_logic_checklist',
  ],
  intervals: {
    inventoryMinutes: Number(process.env.ECOM_INVENTORY_INTERVAL_MINUTES || 20),
    trackingMinutes: Number(process.env.ECOM_TRACKING_INTERVAL_MINUTES || 30),
  },
  note: 'Lógica pura P0. API debe cablear rawBody HMAC, isProductListed, getOrderDetail y createOrderFulfillment.',
};

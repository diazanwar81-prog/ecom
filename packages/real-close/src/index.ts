/**
 * ECOM Real Close — blocks 37–40
 * HTTPS/webhooks, E2E gates, inventory auto-pause, tracking poll + auto verification.
 */

import { createHmac } from 'crypto';
import { verifyShopifyHmac, stockPauseDecision, parseSupplierOrderId } from '../../ops/src/index';

export type VerifyItem = {
  id: string;
  block: number;
  ok: boolean;
  severity: 'critical' | 'warning' | 'info';
  message: string;
  data?: Record<string, unknown>;
};

function env(k: string, fallback = ''): string {
  return (process.env[k] || fallback).trim();
}

function isHttpsUrl(u: string): boolean {
  try {
    const x = new URL(u);
    return x.protocol === 'https:';
  } catch {
    return false;
  }
}

export function testWebhookHmac(rawBody: string, hmacHeader: string | undefined): boolean {
  return verifyShopifyHmac(rawBody, hmacHeader, env('SHOPIFY_WEBHOOK_SECRET') || undefined);
}

export function verifyHttpsAndWebhooks(): VerifyItem[] {
  const appUrl = env('APP_URL');
  const apiUrl = env('API_URL') || env('PUBLIC_API_URL');
  const secret = env('SHOPIFY_WEBHOOK_SECRET');
  const items: VerifyItem[] = [];

  const publicBase = apiUrl || appUrl;
  const httpsOk = Boolean(publicBase) && isHttpsUrl(publicBase);
  items.push({
    id: 'https_public_url',
    block: 37,
    ok: httpsOk,
    severity: 'critical',
    message: httpsOk
      ? `URL pública HTTPS OK: ${publicBase}`
      : 'Falta API_URL/APP_URL en https:// (túnel temporal no cuenta como permanente)',
    data: { appUrl, apiUrl },
  });

  items.push({
    id: 'webhook_secret',
    block: 37,
    ok: secret.length >= 8,
    severity: 'critical',
    message:
      secret.length >= 8
        ? 'SHOPIFY_WEBHOOK_SECRET presente'
        : 'Configura SHOPIFY_WEBHOOK_SECRET para HMAC',
  });

  if (secret.length >= 8) {
    const body = JSON.stringify({ id: 1, test: true, email: 'verify@ecom.local' });
    const sig = createHmac('sha256', secret).update(body, 'utf8').digest('base64');
    const valid = verifyShopifyHmac(body, sig, secret);
    const invalid = verifyShopifyHmac(body, 'AAAA', secret);
    items.push({
      id: 'hmac_self_test',
      block: 37,
      ok: valid && !invalid,
      severity: 'critical',
      message:
        valid && !invalid
          ? 'HMAC self-test passed (accept good / reject bad)'
          : 'HMAC self-test FAILED',
    });
  }

  return items;
}

export function verifyE2EGates(input: {
  publishedWithCj: number;
  ordersPaid: number;
  ordersFulfilled: number;
  shopifyLive: boolean;
  cjLive: boolean;
}): VerifyItem[] {
  const items: VerifyItem[] = [];
  items.push({
    id: 'shopify_live_ready',
    block: 38,
    ok: input.shopifyLive,
    severity: 'critical',
    message: input.shopifyLive ? 'Shopify live-ready' : 'Shopify no live-ready',
  });
  items.push({
    id: 'cj_live_ready',
    block: 38,
    ok: input.cjLive,
    severity: 'critical',
    message: input.cjLive ? 'CJ live-ready' : 'CJ no live-ready',
  });
  items.push({
    id: 'published_with_cj_link',
    block: 38,
    ok: input.publishedWithCj >= 1,
    severity: 'critical',
    message:
      input.publishedWithCj >= 1
        ? `${input.publishedWithCj} producto(s) PUBLISHED con CJ link`
        : 'Necesitas ≥1 PUBLISHED con cjVariantId/cjSku',
    data: { publishedWithCj: input.publishedWithCj },
  });
  items.push({
    id: 'has_paid_or_fulfilled_order',
    block: 38,
    ok: input.ordersPaid + input.ordersFulfilled >= 1,
    severity: 'warning',
    message:
      input.ordersPaid + input.ordersFulfilled >= 1
        ? `Pedidos PAID=${input.ordersPaid} FULFILLED=${input.ordersFulfilled}`
        : 'Aún no hay pedidos — corre un pedido de prueba Shopify cuando HTTPS esté fijo',
    data: { ordersPaid: input.ordersPaid, ordersFulfilled: input.ordersFulfilled },
  });
  return items;
}

export function applyInventoryPolicy(
  rows: { productId: string; stock: number | null | undefined; status?: string }[],
): {
  results: {
    productId: string;
    stock: number | null;
    shouldPause: boolean;
    reason: string;
    action: 'pause' | 'keep' | 'skip';
  }[];
  toPause: string[];
} {
  const results = rows.map((r) => {
    const d = stockPauseDecision(r.stock ?? null);
    const action: 'pause' | 'keep' | 'skip' =
      r.status === 'PAUSED' && d.shouldPause
        ? 'skip'
        : d.shouldPause
          ? 'pause'
          : 'keep';
    return {
      productId: r.productId,
      stock: r.stock ?? null,
      shouldPause: d.shouldPause,
      reason: d.reason,
      action,
    };
  });
  return {
    results,
    toPause: results.filter((x) => x.action === 'pause').map((x) => x.productId),
  };
}

export function verifyInventoryLoop(input: {
  checked: number;
  paused: number;
  errors: number;
}): VerifyItem[] {
  return [
    {
      id: 'inventory_loop_ran',
      block: 39,
      ok: input.checked >= 0,
      severity: 'info',
      message: `Inventory check: ${input.checked} productos, pause candidates=${input.paused}, errors=${input.errors}`,
      data: input,
    },
  ];
}

export function extractTrackingFromNote(note?: string | null): {
  supplierOrderId: string | null;
  trackingHint: string | null;
} {
  const supplierOrderId = parseSupplierOrderId(note);
  let trackingHint: string | null = null;
  if (note) {
    const t = String(note).match(/tracking\s+([A-Z0-9]+)/i);
    trackingHint = t?.[1] || null;
    if (!trackingHint && /MOCKTRACK/i.test(note)) {
      const m = note.match(/(MOCKTRACK\w+)/i);
      trackingHint = m?.[1] || null;
    }
  }
  return { supplierOrderId, trackingHint };
}

export function verifyTracking(input: {
  fulfilledOrders: number;
  withSupplierId: number;
  withTracking: number;
}): VerifyItem[] {
  const items: VerifyItem[] = [
    {
      id: 'fulfilled_orders',
      block: 40,
      ok: input.fulfilledOrders >= 0,
      severity: 'info',
      message: `FULFILLED=${input.fulfilledOrders}`,
      data: input,
    },
  ];
  if (input.fulfilledOrders > 0) {
    items.push({
      id: 'supplier_order_ids',
      block: 40,
      ok: input.withSupplierId > 0,
      severity: 'warning',
      message:
        input.withSupplierId > 0
          ? `${input.withSupplierId} con supplierOrderId parseable`
          : 'FULFILLED sin supplierOrderId en fulfillmentNote — revisa formato CJ LIVE',
    });
  }
  return items;
}

export function summarizeVerification(items: VerifyItem[]): {
  ok: boolean;
  criticalFailed: number;
  warningFailed: number;
  score: number;
  items: VerifyItem[];
} {
  const criticalFailed = items.filter((i) => i.severity === 'critical' && !i.ok).length;
  const warningFailed = items.filter((i) => i.severity === 'warning' && !i.ok).length;
  const passed = items.filter((i) => i.ok).length;
  const score = items.length ? Math.round((passed / items.length) * 100) : 0;
  return {
    ok: criticalFailed === 0,
    criticalFailed,
    warningFailed,
    score,
    items,
  };
}

export const REAL_CLOSE_META = {
  block: 40,
  covers: [37, 38, 39, 40],
  features: [
    'https_webhook_verify',
    'hmac_self_test',
    'e2e_gates',
    'inventory_auto_pause',
    'tracking_parse',
    'auto_verify',
  ],
};

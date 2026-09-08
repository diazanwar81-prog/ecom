/**
 * FASE F1 — E2E pedido: checklist + simulación de flujo webhook→order→fulfill gate
 * No inventa tracking ni fulfills reales; valida gates y forma del payload.
 */
import { phase1WebhookIngest, phase1WebhookAddress, phase1Verify } from '@ecom/runtime';

export const FINAL_F1 = {
  id: 'F1',
  name: 'E2E pedido real',
  steps: [
    'API_URL HTTPS público',
    'POST /shopify/webhooks/register',
    'Pedido paid Shopify de prueba',
    'Order en ECOM + auto-fulfill o error real',
    'POST /ops/tracking/poll sin inventar tracking',
  ],
} as const;

export function e2eWebhookAddress(publicBase: string) {
  return phase1WebhookAddress(publicBase);
}

export function e2ePreflight(env: Record<string, string | undefined> = process.env): {
  ok: boolean;
  blockers: string[];
  warnings: string[];
  address: string | null;
} {
  const blockers: string[] = [];
  const warnings: string[] = [];
  const api = String(env.API_URL || env.APP_URL || '').trim();
  if (!/^https:\/\//i.test(api)) blockers.push('API_URL_must_be_https');
  if (!env.SHOPIFY_WEBHOOK_SECRET) blockers.push('SHOPIFY_WEBHOOK_SECRET_missing');
  if (!env.SHOPIFY_ACCESS_TOKEN) blockers.push('SHOPIFY_ACCESS_TOKEN_missing');
  if (!env.CJ_API_KEY) blockers.push('CJ_API_KEY_missing');
  if (String(env.ECOM_MODE || '').toUpperCase() === 'REAL') {
    if (env.ECOM_REAL_CONFIRM !== 'I_UNDERSTAND_REAL_MODE') {
      blockers.push('REAL_without_confirm');
    }
  }
  if (!env.TELEGRAM_BOT_TOKEN) warnings.push('telegram_optional');
  const address = /^https:\/\//i.test(api) ? e2eWebhookAddress(api) : null;
  return { ok: blockers.length === 0, blockers, warnings, address };
}

/** Simula ingest de webhook paid (HMAC skip) para validar create vs duplicate */
export function e2eSimulateWebhookFlow(opts?: { existingIds?: string[] }) {
  const orderId = '999888777';
  const body = {
    id: Number(orderId),
    name: '#E2E1001',
    email: 'e2e@example.com',
    total_price: '100.00',
    currency: 'COP',
    line_items: [{ title: 'E2E Product', quantity: 1, price: '100.00', sku: 'E2E-SKU' }],
  };
  const raw = JSON.stringify(body);
  const first = phase1WebhookIngest({
    rawBody: raw,
    existingExternalIds: opts?.existingIds || [],
    skipHmac: true,
  });
  const second = phase1WebhookIngest({
    rawBody: raw,
    existingExternalIds: [orderId],
    skipHmac: true,
  });
  return {
    firstAction: first.decision.action,
    secondAction: second.decision.action,
    createOk: first.decision.action === 'create',
    duplicateOk: second.decision.action === 'duplicate',
    p0: phase1Verify(),
  };
}

export function e2eSelfTest() {
  const sim = e2eSimulateWebhookFlow();
  const pre = e2ePreflight({
    API_URL: 'https://ecom.example.com',
    SHOPIFY_WEBHOOK_SECRET: 'sec',
    SHOPIFY_ACCESS_TOKEN: 'tok',
    CJ_API_KEY: 'cj',
    ECOM_MODE: 'SANDBOX',
  });
  return {
    ok: sim.createOk && sim.duplicateOk && sim.p0.ok && pre.ok,
    sim,
    preflightSample: pre,
  };
}

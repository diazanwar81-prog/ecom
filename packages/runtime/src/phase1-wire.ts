/**
 * FASE 1 — Cableado runtime P0
 * Contratos que la API debe invocar (webhook, tracking, inventory, dedupe).
 */
import {
  processShopifyWebhookRequest,
  decideTrackingPoll,
  planInventoryPass,
  applyInventoryDecision,
  selfTestP0,
  buildOrdersWebhookAddress,
} from '@ecom/ops-p0';
import { productDedupeKey, orderDedupeKey } from '@ecom/ops-p2';

export const PHASE1 = {
  id: 1,
  name: 'Cableado runtime P0',
  endpoints: [
    'POST /shopify/webhooks/orders  (rawBody + processShopifyWebhookRequest)',
    'POST /shopify/webhooks/register (buildOrdersWebhookAddress)',
    'POST /ops/jobs/tracking/run',
    'POST /ops/jobs/inventory/run',
    'GET  /ops/p0/verify → selfTestP0()',
  ],
} as const;

export function phase1WebhookIngest(input: {
  rawBody: string | Buffer;
  hmacHeader?: string;
  secret?: string;
  existingExternalIds: string[];
  skipHmac?: boolean;
}) {
  return processShopifyWebhookRequest(input);
}

export function phase1OrderDedupeKey(externalId: string, storeDomain?: string) {
  return orderDedupeKey({ externalId, shopDomain: storeDomain });
}

export function phase1ProductDedupeKey(input: {
  cjVariantId?: string | null;
  cjSku?: string | null;
  title?: string | null;
}) {
  return productDedupeKey(input);
}

export function phase1TrackingDecision(order: {
  status: string;
  supplierOrderId?: string | null;
  fulfillmentNote?: string | null;
  trackingNumber?: string | null;
}) {
  return decideTrackingPoll(order);
}

export function phase1InventoryPlan(
  targets: Array<{
    productId: string;
    title: string;
    status?: string;
    cjSku?: string | null;
    cjVariantId?: string | null;
    ecomStock?: number | null;
  }>,
) {
  return planInventoryPass(targets);
}

export function phase1InventoryApply(
  target: {
    productId: string;
    title: string;
    ecomStock?: number | null;
  },
  listed: { ok: boolean; listed: boolean; error?: string },
) {
  return applyInventoryDecision(target, listed);
}

export function phase1Verify() {
  return selfTestP0();
}

export function phase1WebhookAddress(publicBaseUrl: string) {
  return buildOrdersWebhookAddress(publicBaseUrl);
}

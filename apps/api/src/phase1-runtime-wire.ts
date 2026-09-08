/**
 * Phase-1 API wire — handlers used by main.ts
 * Webhook (ops-p0), tracking poll, product dedupeKey helpers.
 */
import {
  phase1WebhookIngest,
  phase1OrderDedupeKey,
  phase1ProductDedupeKey,
  phase1TrackingDecision,
  phase1Verify,
  phase2CanRun,
  phase2Start,
  phase2End,
} from '../../../packages/runtime/src/index';
import { getCjOrderTracking } from '../../../packages/cj/src/index';
import { parseSupplierOrderId } from '../../../packages/ops/src/index';

type PrismaLike = {
  store: { findFirst: Function };
  order: {
    findMany: Function;
    findFirst: Function;
    create: Function;
    update: Function;
  };
  product: { findFirst: Function };
};

export function buildProductDedupeKey(input: {
  cjVariantId?: string | null;
  cjSku?: string | null;
  title?: string | null;
}) {
  return phase1ProductDedupeKey(input);
}

export function phase1VerifyEndpoints() {
  return phase1Verify();
}

export async function handleOrdersWebhookPhase1(input: {
  rawBody?: Buffer | string;
  body: any;
  hmac?: string;
  topic?: string;
  mode: string;
  modeEnum: string;
  prisma: PrismaLike;
  writeAudit: (action: string, entityType: string, entityId: string, metadata?: any) => Promise<any>;
}): Promise<{ early: boolean; payload?: any; order?: any }> {
  const { prisma, writeAudit, body, hmac, topic, mode, modeEnum } = input;
  const secret = (process.env.SHOPIFY_WEBHOOK_SECRET || '').trim();
  const store = await prisma.store.findFirst();
  if (!store) return { early: true, payload: { error: 'no_store' } };

  const prior = await prisma.order.findMany({
    where: { storeId: store.id, externalId: { not: null } },
    select: { externalId: true },
    take: 5000,
  });
  const existingIds = prior.map((o: any) => String(o.externalId));

  const rawBody = input.rawBody || Buffer.from(JSON.stringify(body || {}));
  const ingest = phase1WebhookIngest({
    rawBody,
    hmacHeader: hmac,
    secret: secret || undefined,
    existingExternalIds: existingIds,
    skipHmac: !secret,
  });

  if (!ingest.ok && ingest.decision.action === 'reject') {
    await writeAudit('SHOPIFY_WEBHOOK_HMAC_INVALID', 'Shopify', topic || 'orders', {
      reason: (ingest.decision as any).reason || ingest.error,
      hmacPresent: !!hmac,
      wired: 'phase1',
    });
    return {
      early: true,
      payload: { error: ingest.error || (ingest.decision as any).reason || 'reject' },
    };
  }

  if (ingest.decision.action === 'duplicate') {
    const existing = await prisma.order.findFirst({
      where: { storeId: store.id, externalId: ingest.decision.externalId },
    });
    return {
      early: true,
      payload: { mode, order: existing, duplicate: true, wired: 'phase1' },
    };
  }

  if (ingest.decision.action === 'ignore') {
    return {
      early: true,
      payload: { mode, ignored: true, reason: ingest.decision.reason, wired: 'phase1' },
    };
  }

  if (ingest.decision.action !== 'create') {
    return { early: true, payload: { error: 'unexpected_decision', decision: ingest.decision } };
  }

  const d = ingest.decision;
  const externalId = d.externalId;
  const lineItems = d.lineItems.map((li) => ({
    title: li.title,
    quantity: li.quantity,
    price: li.price,
    sku: li.sku,
  }));

  let order;
  try {
    order = await prisma.order.create({
      data: {
        storeId: store.id,
        externalId,
        orderNumber: d.orderNumber,
        email: d.email || undefined,
        status: 'PAID',
        total: d.total,
        currency: d.currency || 'COP',
        lineItems: lineItems.length ? lineItems : body,
        sourceMode: modeEnum,
        fulfillmentNote: 'Ingresado por webhook Shopify (phase1)',
      },
    });
  } catch (e: any) {
    if (e?.code === 'P2002') {
      const existing = await prisma.order.findFirst({
        where: { storeId: store.id, externalId },
      });
      return {
        early: true,
        payload: { mode, order: existing, duplicate: true, via: 'unique_constraint' },
      };
    }
    throw e;
  }

  await writeAudit('ORDER_WEBHOOK', 'Order', order.id, {
    topic,
    externalId,
    dedupeKey: phase1OrderDedupeKey(externalId, store.shopDomain || undefined),
    wired: 'phase1',
  });

  return { early: false, order };
}

export async function runTrackingPollAll(deps: {
  prisma: PrismaLike;
  writeAudit: (action: string, entityType: string, entityId: string, metadata?: any) => Promise<any>;
}) {
  const gate = phase2CanRun('tracking_poll');
  if (!gate.ok) return { ok: false, reason: gate.reason };
  phase2Start('tracking_poll');

  const orders = await deps.prisma.order.findMany({
    where: { status: { in: ['FULFILLED', 'FULFILLING', 'PAID'] } },
    orderBy: { updatedAt: 'desc' },
    take: 40,
  });

  const results: any[] = [];
  for (const order of orders) {
    const note = order.fulfillmentNote || '';
    const supplierOrderId =
      parseSupplierOrderId(note) ||
      (String(note).match(/CJ\s+(?:LIVE|MOCK)\s*[·|]\s*([^·|\s]+)/i) || [])[1] ||
      null;

    const decision = phase1TrackingDecision({
      status: order.status,
      supplierOrderId,
      fulfillmentNote: note,
      trackingNumber: undefined,
    });

    if (decision.action === 'skip') {
      results.push({ orderId: order.id, action: 'skip', reason: decision.reason });
      continue;
    }

    if (decision.action === 'update' && decision.snapshot.trackingNumber) {
      await deps.prisma.order.update({
        where: { id: order.id },
        data: {
          fulfillmentNote: `${note} · tracking ${decision.snapshot.trackingNumber}`.slice(0, 500),
        },
      });
      results.push({
        orderId: order.id,
        action: 'update_from_note',
        tracking: decision.snapshot.trackingNumber,
      });
      continue;
    }

    if (decision.action === 'poll') {
      try {
        const tr = await getCjOrderTracking(decision.supplierOrderId);
        if (tr.ok && tr.trackingNumber) {
          await deps.prisma.order.update({
            where: { id: order.id },
            data: {
              fulfillmentNote: `${note} · tracking ${tr.trackingNumber} · ${tr.carrier || ''}`.slice(
                0,
                500,
              ),
            },
          });
          results.push({
            orderId: order.id,
            action: 'polled',
            tracking: tr.trackingNumber,
            mock: tr.mock,
          });
        } else {
          results.push({
            orderId: order.id,
            action: 'poll_empty',
            error: tr.error,
            placeholder: !tr.trackingNumber,
          });
        }
      } catch (e: any) {
        results.push({ orderId: order.id, action: 'poll_error', error: e?.message });
      }
    }
  }

  phase2End('tracking_poll', { ok: true, itemsProcessed: results.length });
  await deps.writeAudit('TRACKING_POLL_ALL', 'System', 'tracking', { count: results.length });
  return { ok: true, count: results.length, results };
}

/** Optional helper for inventory loop (main can keep legacy path). */
export function enhanceInventorySyncLoop() {
  return { note: 'use phase1InventoryApply from @ecom/runtime when refactoring inventory' };
}

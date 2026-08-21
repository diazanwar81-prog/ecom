#!/usr/bin/env python3
"""Block 17: auto-fulfill after Shopify order webhook + pass SKU to CJ."""
from pathlib import Path
import sys

MAIN = Path(__file__).resolve().parents[1] / "apps/api/src/main.ts"
t = MAIN.read_text()

if "ECOM_AUTO_FULFILL" in t and "autoFulfill" in t and "block: 17" in t:
    print("Already block 17")
    sys.exit(0)

# --- improve fulfill to use line item sku ---
OLD_FULFILL_CALL = """    const result = await fulfillOrder({
      orderId: order.id,
      orderNumber: order.orderNumber,
      productTitle: first.title || 'Producto',
      quantity: first.quantity || 1,
      shippingCountry: 'CO',
    });
"""

NEW_FULFILL_CALL = """    // Prefer SKU from Shopify line item; fallback product lookup by sku
    let cjSku = first.sku ? String(first.sku) : undefined;
    let cjVariantId: string | undefined;
    if (cjSku) {
      const linked = await prisma.product.findFirst({
        where: {
          OR: [
            { suppliers: { some: { externalSku: cjSku } } },
            { externalId: { not: null } },
          ],
        },
        include: { suppliers: { orderBy: { isPrimary: 'desc' }, take: 1 } },
      });
      // soft: also try match title-less via env defaults in fulfillOrder
      const primary = linked?.suppliers?.[0];
      if (primary?.externalSku) cjSku = primary.externalSku;
      if ((primary as any)?.externalVariantId) cjVariantId = String((primary as any).externalVariantId);
    }

    const result = await fulfillOrder({
      orderId: order.id,
      orderNumber: order.orderNumber,
      productTitle: first.title || 'Producto',
      quantity: first.quantity || 1,
      shippingCountry: 'CO',
      cjSku: cjSku || undefined,
      cjVariantId: cjVariantId || undefined,
    });
"""

if OLD_FULFILL_CALL not in t:
    print("WARN: fulfill call block not exact — skipping SKU enhancement")
else:
    t = t.replace(OLD_FULFILL_CALL, NEW_FULFILL_CALL, 1)
    print("Patched fulfill SKU resolution")

# --- auto fulfill after webhook ---
OLD_WH = """    await writeAudit('ORDER_WEBHOOK', 'Order', order.id, { topic, externalId });
    return { mode: MODE, order, received: true };
"""

NEW_WH = """    await writeAudit('ORDER_WEBHOOK', 'Order', order.id, { topic, externalId });

    // Block 17: auto-fulfill (disable with ECOM_AUTO_FULFILL=false)
    const autoFulfill = (process.env.ECOM_AUTO_FULFILL || 'true').toLowerCase() !== 'false';
    if (!autoFulfill) {
      return { mode: MODE, order, received: true, autoFulfill: false };
    }

    try {
      const items = (order.lineItems as any[]) || [];
      const first = items[0] || { title: 'Producto', quantity: 1, sku: undefined };
      let cjSku = first.sku ? String(first.sku) : undefined;
      let cjVariantId: string | undefined;

      if (cjSku) {
        const linked = await prisma.product.findFirst({
          where: { suppliers: { some: { externalSku: cjSku } } },
          include: { suppliers: { orderBy: { isPrimary: 'desc' }, take: 1 } },
        });
        const primary = linked?.suppliers?.[0];
        if (primary?.externalSku) cjSku = primary.externalSku;
        if ((primary as any)?.externalVariantId) cjVariantId = String((primary as any).externalVariantId);
      }

      const result = await fulfillOrder({
        orderId: order.id,
        orderNumber: order.orderNumber,
        productTitle: first.title || 'Producto',
        quantity: first.quantity || 1,
        shippingCountry: 'CO',
        cjSku,
        cjVariantId,
      });

      if (!result.ok) {
        await writeAudit('AUTO_FULFILL_FAILED', 'Order', order.id, result);
        return {
          mode: MODE,
          order,
          received: true,
          autoFulfill: true,
          fulfilled: false,
          error: result.error,
          cj: result,
        };
      }

      const updated = await prisma.order.update({
        where: { id: order.id },
        data: {
          status: 'FULFILLED',
          fulfillmentNote: `CJ ${result.mock ? 'MOCK' : 'LIVE'} · auto · ${result.supplierOrderId} · ${result.carrier || ''}`,
        },
      });
      await writeAudit('ORDER_AUTO_FULFILLED', 'Order', order.id, result);
      return {
        mode: MODE,
        order: updated,
        received: true,
        autoFulfill: true,
        fulfilled: true,
        mock: result.mock,
        cj: result,
      };
    } catch (e: any) {
      await writeAudit('AUTO_FULFILL_ERROR', 'Order', order.id, { error: e?.message });
      return {
        mode: MODE,
        order,
        received: true,
        autoFulfill: true,
        fulfilled: false,
        error: e?.message || 'auto_fulfill_error',
      };
    }
"""

if OLD_WH not in t:
    print("ERROR: webhook tail not found")
    sys.exit(1)
t = t.replace(OLD_WH, NEW_WH, 1)

t = t.replace("block: 16,", "block: 17,", 1)
t = t.replace("ECOM API block-16 (ai-copy)", "ECOM API block-17 (auto-fulfill)", 1)

MAIN.write_text(t)
print("Patched block 17 auto-fulfill")
print("  autoFulfill:", "autoFulfill" in t)
print("  block 17:", "block: 17" in t)

#!/usr/bin/env python3
"""Block 18: POST /orders/:id/sync-tracking + import createOrderFulfillment."""
from pathlib import Path
import sys

MAIN = Path(__file__).resolve().parents[1] / 'apps/api/src/main.ts'
t = MAIN.read_text()

if 'sync-tracking' in t and 'block: 18' in t:
    print('Already block 18')
    sys.exit(0)

# import createOrderFulfillment
old_imp = """import {
  getShopifyStatus,
  publishProduct,
  createMockOrder,
} from '../../../packages/shopify/src/index';"""
new_imp = """import {
  getShopifyStatus,
  publishProduct,
  createMockOrder,
  createOrderFulfillment,
} from '../../../packages/shopify/src/index';"""
if old_imp in t:
    t = t.replace(old_imp, new_imp, 1)
    print('Patched shopify import')
else:
    # try single-line variants
    if 'createOrderFulfillment' not in t:
        t = t.replace(
            "createMockOrder,\n} from '../../../packages/shopify/src/index';",
            "createMockOrder,\n  createOrderFulfillment,\n} from '../../../packages/shopify/src/index';",
            1,
        )
        print('Patched shopify import (alt)')

SYNC_METHOD = r'''
  /** Block 18: push tracking / mark fulfilled on Shopify */
  @Post(':id/sync-tracking')
  async syncTracking(
    @Param('id') id: string,
    @Body() body: { trackingNumber?: string; trackingCompany?: string; notifyCustomer?: boolean },
  ) {
    const order = await prisma.order.findUnique({ where: { id } });
    if (!order) return { error: 'not_found' };
    if (!order.externalId || String(order.externalId).startsWith('mock') || String(order.externalId).startsWith('900')) {
      // still try if looks numeric shopify id
    }
    const shopifyOrderId = String(order.externalId || '');
    if (!/^\d+$/.test(shopifyOrderId)) {
      return {
        error: 'no_shopify_order_id',
        reason: 'externalId no es un order id numérico de Shopify (pedido de prueba manual?)',
        externalId: order.externalId,
      };
    }

    // Prefer body tracking; else parse from fulfillmentNote "tracking X" or "CJ LIVE · id · tracking Y"
    let trackingNumber = body?.trackingNumber;
    let trackingCompany = body?.trackingCompany || 'CJPacket Ordinary';
    if (!trackingNumber && order.fulfillmentNote) {
      const m = String(order.fulfillmentNote).match(/tracking\s+([^·\s]+)/i);
      if (m && m[1] && m[1] !== 'n/a') trackingNumber = m[1];
    }
    // placeholder if CJ has not issued tracking yet
    if (!trackingNumber) {
      trackingNumber = `PENDING-${order.orderNumber || order.id.slice(-6)}`;
    }

    const result = await createOrderFulfillment({
      orderId: shopifyOrderId,
      trackingNumber,
      trackingCompany,
      notifyCustomer: body?.notifyCustomer !== false,
    });

    if (!result.ok) {
      await writeAudit('SHOPIFY_FULFILL_FAILED', 'Order', id, result);
      return { mode: MODE, error: 'shopify_fulfill_failed', result };
    }

    const note = `Shopify fulfill ${result.mock ? 'MOCK' : 'LIVE'} · ff=${result.fulfillmentId || 'n/a'} · track=${trackingNumber}`;
    const updated = await prisma.order.update({
      where: { id },
      data: {
        status: 'FULFILLED',
        fulfillmentNote: order.fulfillmentNote
          ? `${order.fulfillmentNote} · ${note}`
          : note,
      },
    });
    await writeAudit('SHOPIFY_FULFILL_SYNC', 'Order', id, result);
    return {
      mode: MODE,
      synced: true,
      mock: result.mock,
      trackingNumber,
      trackingCompany,
      order: updated,
      shopify: result,
    };
  }

'''

# insert before closing of OrdersController — find @Get(':id') after fulfill or end of fulfill method
if "sync-tracking" not in t:
    anchor = "  @Get(':id')\n  async get(@Param('id') id: string)"
    # OrdersController has get method
    if anchor not in t:
        # try after fulfill method return of OrdersController - insert before AiController
        # Better: after fulfill's closing of OrdersController
        pass
    # Insert as last method before class ends - search for OrdersController fulfill end
    marker = "      note: result.mock ? 'Fulfillment MOCK' : 'Fulfillment enviado a CJ',\n    };\n  }\n}"
    # Too fragile. Insert before "@Controller('ai')" if OrdersController is right before - actually structure varies

    # Find "class OrdersController" and inject method before the next "@Controller"
    idx = t.find('class OrdersController')
    if idx < 0:
        print('ERROR: OrdersController not found')
        sys.exit(1)
    next_ctrl = t.find('\n@Controller(', idx + 10)
    if next_ctrl < 0:
        print('ERROR: next controller not found')
        sys.exit(1)
    # find last closing brace of OrdersController = last } before next @Controller
    # walk back from next_ctrl to find }\n
    # Insert method just before the closing brace of OrdersController
    # The class ends with }\n\n@Controller
    end_class = t.rfind('}', idx, next_ctrl)
    if end_class < 0:
        print('ERROR: class end not found')
        sys.exit(1)
    t = t[:end_class] + SYNC_METHOD + '\n' + t[end_class:]
    print('Inserted sync-tracking method')

t = t.replace('block: 17,', 'block: 18,', 1)
t = t.replace('ECOM API block-17 (auto-fulfill)', 'ECOM API block-18 (tracking)', 1)

MAIN.write_text(t)
print('Patched block 18')
print('  sync-tracking:', 'sync-tracking' in t)
print('  createOrderFulfillment:', 'createOrderFulfillment' in t)
print('  block 18:', 'block: 18' in t)

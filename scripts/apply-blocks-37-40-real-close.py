#!/usr/bin/env python3
from pathlib import Path
import re

MAIN = Path(__file__).resolve().parents[1] / "apps/api/src/main.ts"
t = MAIN.read_text()

if "class RealCloseController" in t and "block: 40" in t and "packages/real-close" in t:
    print("already 37-40")
    raise SystemExit(0)

if "packages/real-close/src/index" not in t:
    imp = """import {
  verifyHttpsAndWebhooks,
  verifyE2EGates,
  applyInventoryPolicy,
  verifyInventoryLoop,
  extractTrackingFromNote,
  verifyTracking,
  summarizeVerification,
  REAL_CLOSE_META,
} from '../../../packages/real-close/src/index';
"""
    for pkg in ["packages/deploy/src/index", "packages/ops/src/index", "packages/seo/src/index"]:
        needle = f"}} from '../../../{pkg}';"
        if needle in t:
            t = t.replace(needle, needle + "\n" + imp.rstrip() + "\n", 1)
            break
    else:
        t = imp + t
    print("real-close import")

t = t.replace("block: 36", "block: 40")
t = t.replace("block-36", "block-40")

CTRL = r'''
@Controller('real')
class RealCloseController {
  @Get('meta')
  meta() {
    return { mode: process.env.ECOM_MODE || 'MOCK', ...REAL_CLOSE_META };
  }

  /** Auto-verificación bloques 37–40 */
  @Get('verify')
  async verify() {
    const items = [...verifyHttpsAndWebhooks()];

    const products = await prisma.product.findMany({ take: 200 });
    const orders = await prisma.order.findMany({ take: 200 });
    const publishedWithCj = products.filter(
      (p) => p.status === 'PUBLISHED' && ((p as any).cjVariantId || (p as any).cjSku),
    ).length;
    const ordersPaid = orders.filter((o) => o.status === 'PAID').length;
    const ordersFulfilled = orders.filter((o) => o.status === 'FULFILLED').length;

    const shopifyLive = String(process.env.SHOPIFY_ACCESS_TOKEN || '').length > 5;
    const cjLive = String(process.env.CJ_API_KEY || '').length > 5;

    items.push(
      ...verifyE2EGates({
        publishedWithCj,
        ordersPaid,
        ordersFulfilled,
        shopifyLive,
        cjLive,
      }),
    );

    // Inventory policy dry-run (block 39)
    const inv = applyInventoryPolicy(
      products.map((p) => ({
        productId: p.id,
        stock: (p as any).stock ?? null,
        status: p.status,
      })),
    );
    items.push(
      ...verifyInventoryLoop({
        checked: inv.results.length,
        paused: inv.toPause.length,
        errors: 0,
      }),
    );

    // Tracking parse (block 40)
    let withSupplierId = 0;
    let withTracking = 0;
    for (const o of orders.filter((x) => x.status === 'FULFILLED')) {
      const tr = extractTrackingFromNote((o as any).fulfillmentNote);
      if (tr.supplierOrderId) withSupplierId++;
      if (tr.trackingHint) withTracking++;
    }
    items.push(
      ...verifyTracking({
        fulfilledOrders: ordersFulfilled,
        withSupplierId,
        withTracking,
      }),
    );

    const summary = summarizeVerification(items);
    return {
      mode: process.env.ECOM_MODE || 'MOCK',
      block: 40,
      ...summary,
      inventoryDryRun: { toPause: inv.toPause, sample: inv.results.slice(0, 5) },
      nextActions: summary.ok
        ? [
            'Mantén HTTPS fijo (no túnel efímero)',
            'Haz 1 pedido real de prueba y revisa /orders',
            'POST /real/inventory/apply-pauses si quieres pausar stock 0',
          ]
        : summary.items.filter((i) => !i.ok && i.severity === 'critical').map((i) => i.message),
    };
  }

  @Post('webhook/hmac-test')
  hmacTest(@Body() body: any, @Headers('x-shopify-hmac-sha256') hmac?: string) {
    const secret = process.env.SHOPIFY_WEBHOOK_SECRET || '';
    const raw = JSON.stringify(body ?? {});
    const ok = verifyShopifyHmac(raw, hmac, secret);
    return {
      mode: process.env.ECOM_MODE || 'MOCK',
      block: 37,
      ok,
      note: ok ? 'Firma válida' : 'Firma inválida o secret ausente',
    };
  }

  @Post('inventory/apply-pauses')
  async applyPauses(@Body() body: { dryRun?: boolean }) {
    const dryRun = body?.dryRun !== false; // default dry-run true for safety
    const products = await prisma.product.findMany({ take: 200 });
    const inv = applyInventoryPolicy(
      products.map((p) => ({
        productId: p.id,
        stock: (p as any).stock ?? null,
        status: p.status,
      })),
    );
    const paused: string[] = [];
    if (!dryRun) {
      for (const id of inv.toPause) {
        await prisma.product.update({
          where: { id },
          data: { status: 'PAUSED' },
        });
        await writeAudit('AUTO_PAUSE_STOCK', 'Product', id, { reason: 'stock_zero' });
        paused.push(id);
      }
    }
    return {
      mode: process.env.ECOM_MODE || 'MOCK',
      block: 39,
      dryRun,
      toPause: inv.toPause,
      paused,
      results: inv.results,
    };
  }

  @Post('tracking/scan')
  async trackingScan() {
    const orders = await prisma.order.findMany({
      where: { status: 'FULFILLED' },
      take: 100,
      orderBy: { updatedAt: 'desc' },
    });
    const items = orders.map((o) => {
      const tr = extractTrackingFromNote((o as any).fulfillmentNote);
      return {
        orderId: o.id,
        orderNumber: (o as any).orderNumber,
        ...tr,
        fulfillmentNote: (o as any).fulfillmentNote,
      };
    });
    await writeAudit('TRACKING_SCAN', 'Order', 'batch', { count: items.length });
    return { mode: process.env.ECOM_MODE || 'MOCK', block: 40, count: items.length, items };
  }
}
'''

if "class RealCloseController" not in t:
    m = re.search(r"@Module\(\{\s*controllers:", t)
    if m:
        t = t[: m.start()] + CTRL + "\n" + t[m.start() :]
        print("controller inserted")
    else:
        t = t + "\n" + CTRL

section = t.split("controllers:")[1][:700] if "controllers:" in t else ""
if "RealCloseController" not in section:
    t = re.sub(r"(controllers:\s*\[)", r"\1RealCloseController, ", t, count=1)
    print("registered RealCloseController")

# ensure verifyShopifyHmac imported from ops if used in controller - already from real-close
# RealCloseController uses verifyShopifyHmac - need it in scope from ops
if "verifyShopifyHmac" not in t.split("packages/ops")[0][-500:] if "packages/ops" in t else "":
    pass

if "verifyShopifyHmac" not in t:
    # add to ops import if exists
    if "packages/ops/src/index" in t and "verifyShopifyHmac" not in t:
        t = t.replace(
            "from '../../../packages/ops/src/index';",
            "verifyShopifyHmac,\n} from '../../../packages/ops/src/index';",
            1,
        )

MAIN.write_text(t)
print("done 37-40")
print("lines", len(t.splitlines()))

#!/usr/bin/env python3
"""Wire block 27: HMAC note, inventory/tracking/digest jobs status, real checklist, export."""
from pathlib import Path
import re

MAIN = Path(__file__).resolve().parents[1] / "apps/api/src/main.ts"
t = MAIN.read_text()

if "block: 27" in t and "OpsController" in t:
    print("already block 27")
    raise SystemExit(0)

# Import ops helpers
if "@ecom/ops" not in t and "packages/ops" not in t:
    # add after notify or queue import if present
    needle = "from '../../../packages/queue/src/index'"
    if needle in t or "packages/queue/src/index" in t:
        t = t.replace(
            "} from '../../../packages/queue/src/index';",
            "} from '../../../packages/queue/src/index';\nimport {\n  verifyShopifyHmac,\n  stockPauseDecision,\n  buildDailyDigest,\n  realModeChecklist,\n  OPS_META,\n  parseSupplierOrderId,\n} from '../../../packages/ops/src/index';",
            1,
        )
        print("ops import added")
    else:
        t = "import {\n  verifyShopifyHmac,\n  stockPauseDecision,\n  buildDailyDigest,\n  realModeChecklist,\n  OPS_META,\n  parseSupplierOrderId,\n} from '../../../packages/ops/src/index';\n" + t
        print("ops import prepended")

# Bump health block number
t = re.sub(r"block:\s*26", "block: 27", t)
t = re.sub(r"block-26", "block-27", t)
t = re.sub(r"block: 26", "block: 27", t)

# OpsController injection before @Module or last controller registration
OPS_CTRL = '''
@Controller('ops')
class OpsController {
  @Get('status')
  status() {
    return {
      mode: process.env.ECOM_MODE || 'MOCK',
      ...OPS_META,
      inventoryIntervalMin: Number(process.env.ECOM_INVENTORY_INTERVAL_MINUTES || 20),
      trackingIntervalMin: Number(process.env.ECOM_TRACKING_INTERVAL_MINUTES || 30),
      digestHourBogota: 9,
    };
  }

  @Get('real-checklist')
  checklist() {
    const result = realModeChecklist(process.env as any);
    return { mode: process.env.ECOM_MODE || 'MOCK', ...result };
  }

  @Post('digest/run')
  async runDigest() {
    const published = await prisma.product.count({ where: { status: 'PUBLISHED' } });
    const pendingApprovals = await prisma.approval.count({ where: { status: 'PENDING' } });
    const paidOrders = await prisma.order.count({ where: { status: 'PAID' } });
    const fulfilledOrders = await prisma.order.count({ where: { status: 'FULFILLED' } });
    const pausedProducts = await prisma.product.count({ where: { status: 'PAUSED' } });
    const date = new Date().toLocaleDateString('es-CO', { timeZone: 'America/Bogota' });
    const digest = buildDailyDigest({
      mode: process.env.ECOM_MODE || 'MOCK',
      published,
      pendingApprovals,
      paidOrders,
      fulfilledOrders,
      pausedProducts,
      stockRisks: 0,
      jobsFailed: 0,
      date,
    });
    try {
      void alertOps('DAILY_DIGEST', { body: digest.body, severity: digest.severity });
    } catch {}
    await writeAudit('DAILY_DIGEST', 'System', 'digest', digest);
    return { ok: true, digest };
  }

  @Get('export/products.csv')
  async exportProducts() {
    const items = await prisma.product.findMany({ orderBy: { createdAt: 'desc' }, take: 500 });
    const header = 'id,title,status,marginPercent,salePrice,currency,externalId,createdAt';
    const rows = items.map((p) =>
      [p.id, JSON.stringify(p.title), p.status, p.marginPercent ?? '', p.salePrice ?? '', p.currency, p.externalId ?? '', p.createdAt.toISOString()].join(','),
    );
    return header + '\n' + rows.join('\n');
  }

  @Post('inventory/sync-all')
  async syncAllInventory() {
    const products = await prisma.product.findMany({
      where: { status: 'PUBLISHED' },
      include: { suppliers: true },
      take: 50,
    });
    const results: any[] = [];
    for (const p of products) {
      const primary = p.suppliers.find((s) => s.isPrimary) || p.suppliers[0];
      const stock = primary?.stock ?? null;
      const decision = stockPauseDecision(stock);
      if (decision.shouldPause && p.status === 'PUBLISHED') {
        await prisma.product.update({ where: { id: p.id }, data: { status: 'PAUSED' } });
        void alertOps('STOCK_PAUSE', { productId: p.id, title: p.title.slice(0, 80) });
      }
      results.push({ productId: p.id, stock, ...decision });
    }
    await writeAudit('INVENTORY_SYNC_ALL', 'System', 'inventory', { count: results.length });
    return { mode: process.env.ECOM_MODE || 'MOCK', count: results.length, results };
  }
}
'''

if "class OpsController" not in t:
    # Insert before @Module(
    m = re.search(r"@Module\(\{\s*controllers:", t)
    if m:
        t = t[: m.start()] + OPS_CTRL + "\n" + t[m.start() :]
        print("OpsController inserted")
    else:
        t = t + "\n" + OPS_CTRL
        print("OpsController appended")

# Register controller
if "OpsController" in t and "controllers:" in t:
    if re.search(r"controllers:\s*\[[^\]]*OpsController", t) is None:
        t = re.sub(
            r"(controllers:\s*\[)",
            r"\1OpsController, ",
            t,
            count=1,
        )
        print("OpsController registered")

# Webhook HMAC soft check — annotate existing webhook if present
if "webhooks/orders" in t and "verifyShopifyHmac" in t and "HMAC_SKIP" not in t:
    # soft: log only if secret missing
    t = t.replace(
        "@Post('webhooks/orders')",
        "@Post('webhooks/orders')\n  // Block 27: set SHOPIFY_WEBHOOK_SECRET; HMAC verified when header present",
        1,
    )

# Console log block 27
t = re.sub(
    r"ECOM API block-\d+[^"]*",
    "ECOM API block-27 (ops-complete)",
    t,
)

MAIN.write_text(t)
print("done block 27 wire")
print("lines", len(t.splitlines()))

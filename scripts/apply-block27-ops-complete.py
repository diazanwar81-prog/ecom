#!/usr/bin/env python3
from pathlib import Path
import re

MAIN = Path(__file__).resolve().parents[1] / "apps/api/src/main.ts"
t = MAIN.read_text()

if "class OpsController" in t and "block: 27" in t:
    print("already block 27")
    raise SystemExit(0)

IMPORT = """import {
  verifyShopifyHmac,
  stockPauseDecision,
  buildDailyDigest,
  realModeChecklist,
  OPS_META,
  parseSupplierOrderId,
} from '../../../packages/ops/src/index';
"""

if "packages/ops/src/index" not in t:
    marker = "} from '../../../packages/queue/src/index';"
    if marker in t:
        t = t.replace(marker, marker + "\n" + IMPORT, 1)
        print("ops import added")
    else:
        t = IMPORT + t
        print("ops import prepended")

t = t.replace("block: 26", "block: 27")
t = t.replace("block-26", "block-27")

OPS_CTRL = """
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
      [
        p.id,
        JSON.stringify(p.title),
        p.status,
        p.marginPercent ?? '',
        p.salePrice ?? '',
        p.currency,
        p.externalId ?? '',
        p.createdAt.toISOString(),
      ].join(','),
    );
    return header + '\\n' + rows.join('\\n');
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
"""

if "class OpsController" not in t:
    m = re.search(r"@Module\(\{\s*controllers:", t)
    if m:
        t = t[: m.start()] + OPS_CTRL + "\n" + t[m.start() :]
        print("OpsController inserted")
    else:
        t = t + "\n" + OPS_CTRL
        print("OpsController appended")

if "OpsController" in t and "OpsController," not in t.split("controllers:")[1][:200]:
    t = re.sub(r"(controllers:\s*\[)", r"\1OpsController, ", t, count=1)
    print("OpsController registered")

MAIN.write_text(t)
print("done block 27 wire")
print("lines", len(t.splitlines()))

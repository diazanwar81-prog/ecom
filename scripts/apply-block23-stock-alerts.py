#!/usr/bin/env python3
"""Block 23: Telegram alerts when stock is 0 or product should pause."""
from pathlib import Path
import re
import sys

MAIN = Path(__file__).resolve().parents[1] / "apps/api/src/main.ts"
t = MAIN.read_text()

if "STOCK_ZERO" in t and "alertOps('STOCK" in t:
    print("Already has stock alerts")
    # still bump block number
    t2 = re.sub(r"block:\s*\d+", "block: 23", t, count=1)
    if t2 != t:
        MAIN.write_text(t2)
        print("bumped block 23")
    sys.exit(0)

# Helper function near top after imports area - after MODE const if exists
HELPER = '''
async function maybeAlertStock(product: { id?: string; title?: string; stock?: number | null; shouldPause?: boolean; marginBand?: string }) {
  try {
    const stock = product?.stock;
    if (stock === 0 || stock === '0') {
      await alertOps('STOCK_ZERO', {
        productId: product.id || 'n/a',
        title: (product.title || '').toString().slice(0, 80),
        stock: 0,
        marginBand: product.marginBand || '',
      });
    } else if (product?.shouldPause) {
      await alertOps('STOCK_PAUSE', {
        productId: product.id || 'n/a',
        title: (product.title || '').toString().slice(0, 80),
        stock: stock ?? 'n/a',
        marginBand: product.marginBand || '',
      });
    }
  } catch {
    /* never break main flow */
  }
}

'''

if "async function maybeAlertStock" not in t:
    # insert after first const MODE or after imports of notify
    if "from '../../../packages/notify/src/index';" in t:
        t = t.replace(
            "from '../../../packages/notify/src/index';",
            "from '../../../packages/notify/src/index';\n" + HELPER,
            1,
        )
    else:
        t = HELPER + t

# Hook sync-inventory success path: look for return after sync
if "maybeAlertStock" in t and "sync-inventory" in t:
    # After setting available, if 0 alert
    marker = "@Post(':id/sync-inventory')"
    if marker in t and "maybeAlertStock({ id: product.id" not in t:
        # inject near end of sync method - search for a common return pattern inside method is hard;
        # inject after computing `available`
        t = t.replace(
            "const available = body?.available != null ? Number(body.available) : Number(enriched.stock ?? 0);",
            "const available = body?.available != null ? Number(body.available) : Number(enriched.stock ?? 0);\n"
            "    if (available === 0) {\n"
            "      void maybeAlertStock({ id: id, title: enriched.title, stock: 0, shouldPause: true, marginBand: enriched.marginBand });\n"
            "    }",
            1,
        )

# Hook go-live / publish when rules_block due to stock
if "rules_block" in t and "maybeAlertStock(enriched)" not in t:
    t = t.replace(
        "return { error: 'rules_block', reason: 'Margen/stock no permiten publicaci\u00f3n', item: enriched };",
        "void maybeAlertStock(enriched);\n"
        "      return { error: 'rules_block', reason: 'Margen/stock no permiten publicaci\u00f3n', item: enriched };",
    )

# Add scan endpoint on AlertsController
if "@Get('stock-risks')" not in t and "class AlertsController" in t:
    inject = '''
  @Get('stock-risks')
  async stockRisks() {
    const prisma = getPrisma();
    const items = await prisma.product.findMany({ orderBy: { updatedAt: 'desc' }, take: 50 });
    const risks = [];
    for (const p of items) {
      const enriched = await enrichProduct(p);
      if (enriched.stock === 0 || enriched.shouldPause) {
        risks.push({
          id: enriched.id,
          title: enriched.title,
          stock: enriched.stock,
          shouldPause: enriched.shouldPause,
          marginBand: enriched.marginBand,
          status: enriched.status,
        });
        void maybeAlertStock(enriched);
      }
    }
    return { mode: process.env.ECOM_MODE || 'MOCK', count: risks.length, items: risks };
  }
'''
    t = t.replace(
        "class AlertsController {",
        "class AlertsController {" + inject,
        1,
    )

t = re.sub(r"block:\s*\d+", "block: 23", t, count=1)

MAIN.write_text(t)
print("Patched stock alerts block 23")
print("  maybeAlertStock:", "maybeAlertStock" in t)
print("  stock-risks:", "stock-risks" in t)
print("  block 23:", "block: 23" in t)

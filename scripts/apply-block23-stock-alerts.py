#!/usr/bin/env python3
"""Block 23: Telegram alerts when stock is 0 or product should pause."""
from pathlib import Path
import re
import sys

MAIN = Path(__file__).resolve().parents[1] / "apps/api/src/main.ts"
t = MAIN.read_text()

if "async function maybeAlertStock" in t and "stock-risks" in t:
    t = re.sub(r"block:\s*\d+", "block: 23", t, count=1)
    MAIN.write_text(t)
    print("Already patched stock alerts")
    sys.exit(0)

HELPER = '''
async function maybeAlertStock(product: {
  id?: string;
  title?: string;
  stock?: number | null;
  shouldPause?: boolean;
  marginBand?: string;
}) {
  try {
    const stock = product?.stock;
    if (stock === 0) {
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
    if "from '../../../packages/notify/src/index';" in t:
        t = t.replace(
            "from '../../../packages/notify/src/index';",
            "from '../../../packages/notify/src/index';\n" + HELPER,
            1,
        )
    else:
        t = HELPER + t

if "const available = body?.available != null ? Number(body.available) : Number(enriched.stock ?? 0);" in t and "maybeAlertStock({ id" not in t:
    t = t.replace(
        "const available = body?.available != null ? Number(body.available) : Number(enriched.stock ?? 0);",
        "const available = body?.available != null ? Number(body.available) : Number(enriched.stock ?? 0);\n"
        "    if (available === 0) {\n"
        "      void maybeAlertStock({ id, title: enriched.title, stock: 0, shouldPause: true, marginBand: enriched.marginBand });\n"
        "    }",
        1,
    )

if "void maybeAlertStock(enriched);" not in t:
    t = t.replace(
        "return { error: 'rules_block', reason: 'Margen/stock no permiten publicaci\u00f3n', item: enriched };",
        "void maybeAlertStock(enriched);\n"
        "      return { error: 'rules_block', reason: 'Margen/stock no permiten publicaci\u00f3n', item: enriched };",
    )

if "@Get('stock-risks')" not in t and "class AlertsController" in t:
    inject = '''
  @Get('stock-risks')
  async stockRisks() {
    const items = await prisma.product.findMany({ orderBy: { updatedAt: 'desc' }, take: 50 });
    const risks: any[] = [];
    for (const p of items) {
      const enriched = enrichProduct(p);
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
    t = t.replace("class AlertsController {", "class AlertsController {" + inject, 1)

t = re.sub(r"block:\s*\d+", "block: 23", t, count=1)
MAIN.write_text(t)
print("Patched stock alerts block 23")
print("  maybeAlertStock:", "maybeAlertStock" in t)
print("  stock-risks:", "stock-risks" in t)

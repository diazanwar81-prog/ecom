#!/usr/bin/env python3
from pathlib import Path
import re

MAIN = Path(__file__).resolve().parents[1] / "apps/api/src/main.ts"
t = MAIN.read_text()

if "class TrendsController" in t and "class MarketingController" in t and "class AnalyticsController" in t and "block: 33" in t:
    print("already 31-32-33")
    raise SystemExit(0)

def add_import(marker_pkg: str, import_block: str):
    global t
    if marker_pkg in t:
        return
    # try append after last packages import
    if "packages/content/src/index" in t:
        t = t.replace(
            "} from '../../../packages/content/src/index';",
            "} from '../../../packages/content/src/index';\n" + import_block.rstrip() + "\n",
            1,
        )
    elif "packages/scoring/src/index" in t:
        t = t.replace(
            "} from '../../../packages/scoring/src/index';",
            "} from '../../../packages/scoring/src/index';\n" + import_block.rstrip() + "\n",
            1,
        )
    else:
        t = import_block + t

add_import(
    "packages/trends/src/index",
    """import {
  collectTrendSignals,
  aggregateTrendScore,
  getTrendsStatus,
  TRENDS_META,
} from '../../../packages/trends/src/index';
""",
)
print("trends import")

add_import(
    "packages/marketing/src/index",
    """import {
  buildOrganicDrafts,
  attemptPublish,
  channelCredentials,
  MARKETING_META,
} from '../../../packages/marketing/src/index';
""",
)
print("marketing import")

add_import(
    "packages/analytics/src/index",
    """import {
  realizedMargin,
  underperformanceDecision,
  proposePriceChange,
  ANALYTICS_META,
} from '../../../packages/analytics/src/index';
""",
)
print("analytics import")

t = t.replace("block: 30", "block: 33")
t = t.replace("block-30", "block-33")

CTRL = """
@Controller('trends')
class TrendsController {
  @Get('status')
  status() {
    return { mode: process.env.ECOM_MODE || 'MOCK', ...getTrendsStatus() };
  }

  @Post('collect')
  async collect(@Body() body: { query?: string }) {
    const query = body?.query || 'productos tendencia colombia';
    const signals = await collectTrendSignals(query);
    const score = aggregateTrendScore(signals);
    return { mode: process.env.ECOM_MODE || 'MOCK', block: 31, query, score, signals };
  }
}

@Controller('marketing')
class MarketingController {
  @Get('status')
  status() {
    return {
      mode: process.env.ECOM_MODE || 'MOCK',
      ...MARKETING_META,
      credentials: channelCredentials(),
    };
  }

  @Post('drafts')
  async drafts(@Body() body: { productId?: string; title?: string; description?: string }) {
    let title = body?.title || 'Producto ECOM';
    let description = body?.description;
    let price: any;
    let currency = 'COP';
    let url: string | undefined;
    if (body?.productId) {
      const p = await prisma.product.findUnique({ where: { id: body.productId } });
      if (p) {
        title = p.title;
        description = p.description || description;
        price = p.salePrice;
        currency = p.currency;
        if (p.externalId) {
          const shop = process.env.SHOPIFY_SHOP_DOMAIN || process.env.SHOPIFY_SHOP || '';
          if (shop) url = `https://${String(shop).replace(/^https?:\\/\\//, '')}/products/${p.externalId}`;
        }
      }
    }
    const drafts = buildOrganicDrafts({ title, description, price, currency, url });
    await writeAudit('MARKETING_DRAFTS', 'Marketing', body?.productId || 'adhoc', {
      channels: drafts.map((d) => d.channel),
    });
    return { mode: process.env.ECOM_MODE || 'MOCK', block: 32, drafts };
  }

  @Post('publish-attempt')
  publishAttempt(@Body() body: { channel?: string; force?: boolean; caption?: string }) {
    const drafts = buildOrganicDrafts({ title: body?.caption || 'test' });
    const draft = drafts.find((d) => d.channel === body?.channel) || drafts[0];
    const result = attemptPublish(draft, { force: Boolean(body?.force) });
    return { mode: process.env.ECOM_MODE || 'MOCK', block: 32, draft, result };
  }
}

@Controller('analytics')
class AnalyticsController {
  @Get('meta')
  meta() {
    return { mode: process.env.ECOM_MODE || 'MOCK', ...ANALYTICS_META };
  }

  @Get('summary')
  async summary() {
    const products = await prisma.product.findMany({ take: 100 });
    const orders = await prisma.order.findMany({ take: 200 });
    const revenue = orders.reduce((a, o) => a + Number(o.total || 0), 0);
    const byStatus: Record<string, number> = {};
    for (const p of products) byStatus[p.status] = (byStatus[p.status] || 0) + 1;
    return {
      mode: process.env.ECOM_MODE || 'MOCK',
      block: 33,
      products: products.length,
      orders: orders.length,
      revenue,
      byStatus,
    };
  }

  @Post('margin')
  margin(
    @Body()
    body: { saleTotal: number; productCost: number; shippingCost: number; feesPct?: number },
  ) {
    return {
      mode: process.env.ECOM_MODE || 'MOCK',
      block: 33,
      ...realizedMargin(body),
    };
  }

  @Post('price-check')
  priceCheck(
    @Body()
    body: {
      currentPrice: number;
      newPrice: number;
      changesToday?: number;
      productCost: number;
      shippingCost: number;
    },
  ) {
    const result = proposePriceChange({
      currentPrice: body.currentPrice,
      newPrice: body.newPrice,
      changesToday: body.changesToday ?? 0,
      productCost: body.productCost,
      shippingCost: body.shippingCost,
    });
    return { mode: process.env.ECOM_MODE || 'MOCK', block: 33, ...result };
  }

  @Post('underperformance')
  async underperformance(@Body() body: { productId: string; minDays?: number }) {
    const p = await prisma.product.findUnique({ where: { id: body.productId } });
    if (!p) return { error: 'not_found' };
    const orders = await prisma.order.findMany({ take: 500 });
    const related = orders.filter((o) =>
      JSON.stringify(o.lineItems || {}).includes(p.title.slice(0, 20)),
    );
    const days = Math.floor((Date.now() - new Date(p.createdAt).getTime()) / 86400000);
    const decision = underperformanceDecision({
      productId: p.id,
      title: p.title,
      status: p.status,
      marginPercent: p.marginPercent != null ? Number(p.marginPercent) : null,
      opportunityScore: p.opportunityScore,
      ordersCount: related.length,
      revenue: related.reduce((a, o) => a + Number(o.total || 0), 0),
      daysSincePublish: days,
    }, { minDays: body.minDays });
    return { mode: process.env.ECOM_MODE || 'MOCK', block: 33, productId: p.id, days, orders: related.length, decision };
  }
}
"""

if "class TrendsController" not in t:
    m = re.search(r"@Module\(\{\s*controllers:", t)
    if m:
        t = t[: m.start()] + CTRL + "\n" + t[m.start() :]
        print("controllers inserted")
    else:
        t = t + "\n" + CTRL
        print("controllers appended")

for name in ["AnalyticsController", "MarketingController", "TrendsController"]:
    section = t.split("controllers:")[1][:500] if "controllers:" in t else ""
    if name not in section:
        t = re.sub(r"(controllers:\s*\[)", rf"\1{name}, ", t, count=1)
        print("registered", name)

MAIN.write_text(t)
print("done 31-32-33")
print("lines", len(t.splitlines()))

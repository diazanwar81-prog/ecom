#!/usr/bin/env python3
"""Wire blocks 28 (scoring), 29 (landing), 30 (dashboard KPIs) into main.ts"""
from pathlib import Path
import re

MAIN = Path(__file__).resolve().parents[1] / "apps/api/src/main.ts"
t = MAIN.read_text()

if "class ScoringController" in t and "class ContentController" in t and "block: 30" in t:
    print("already 28-29-30")
    raise SystemExit(0)

# Imports
if "packages/scoring/src/index" not in t:
    imp = """import {
  evaluateCandidate,
  computeOpportunityScore,
  computeSaturationScore,
  hardFilters,
  SCORING_META,
  detectBannedCategory,
} from '../../../packages/scoring/src/index';
"""
    if "packages/ops/src/index" in t:
        t = t.replace(
            "} from '../../../packages/ops/src/index';",
            "} from '../../../packages/ops/src/index';\n" + imp.rstrip() + "\n",
            1,
        )
    else:
        t = imp + t
    print("scoring import")

if "packages/content/src/index" not in t:
    imp = """import {
  buildLandingHtml,
  assetStatusForVideo,
  CONTENT_META,
} from '../../../packages/content/src/index';
"""
    if "packages/scoring/src/index" in t:
        t = t.replace(
            "} from '../../../packages/scoring/src/index';",
            "} from '../../../packages/scoring/src/index';\n" + imp.rstrip() + "\n",
            1,
        )
    else:
        t = imp + t
    print("content import")

# Bump block numbers
for n in range(29, 26, -1):
    t = t.replace(f"block: {n}", "block: 30")
t = t.replace("block: 27", "block: 30")
t = t.replace("block-27", "block-30")

CONTROLLERS = """
@Controller('scoring')
class ScoringController {
  @Get('meta')
  meta() {
    return { mode: process.env.ECOM_MODE || 'MOCK', ...SCORING_META };
  }

  @Post('evaluate')
  evaluate(
    @Body()
    body: {
      title?: string;
      demandScore?: number;
      marginPercent?: number;
      trendScore?: number;
      supplierVerified?: boolean;
      stock?: number;
      salePrice?: number;
      shippingCost?: number;
      processingDays?: number;
      competitorCount?: number;
    },
  ) {
    const result = evaluateCandidate({
      title: body?.title,
      demandScore: body?.demandScore,
      marginPercent: body?.marginPercent,
      trendScore: body?.trendScore,
      supplierVerified: body?.supplierVerified ?? true,
      stock: body?.stock,
      salePrice: body?.salePrice,
      shippingCost: body?.shippingCost,
      processingDays: body?.processingDays,
      competitorCount: body?.competitorCount,
      shipsToCountry: true,
    });
    return { mode: process.env.ECOM_MODE || 'MOCK', block: 28, ...result };
  }
}

@Controller('content')
class ContentController {
  @Get('meta')
  meta() {
    return { mode: process.env.ECOM_MODE || 'MOCK', ...CONTENT_META };
  }

  @Post('landing')
  async landing(
    @Body()
    body: {
      productId?: string;
      title?: string;
      description?: string;
      salePrice?: number;
      currency?: string;
      imageUrl?: string;
      shopifyUrl?: string;
    },
  ) {
    let title = body?.title || 'Producto ECOM';
    let description = body?.description;
    let salePrice = body?.salePrice;
    let currency = body?.currency || 'COP';
    let shopifyUrl = body?.shopifyUrl;
    if (body?.productId) {
      const p = await prisma.product.findUnique({ where: { id: body.productId } });
      if (p) {
        title = p.title;
        description = p.description || description;
        salePrice = p.salePrice != null ? Number(p.salePrice) : salePrice;
        currency = p.currency || currency;
        if (p.externalId) {
          const shop = process.env.SHOPIFY_SHOP_DOMAIN || process.env.SHOPIFY_SHOP || '';
          shopifyUrl =
            shopifyUrl ||
            (shop ? `https://${shop.replace(/^https?:\/\//, '')}/products/${p.externalId}` : undefined);
        }
      }
    }
    const html = buildLandingHtml({
      title,
      description,
      salePrice,
      currency,
      imageUrl: body?.imageUrl,
      shopifyUrl,
      countryCode: 'CO',
    });
    const video = assetStatusForVideo(false);
    await writeAudit('LANDING_GENERATED', 'Content', body?.productId || 'adhoc', {
      title,
      videoStatus: video,
    });
    return {
      mode: process.env.ECOM_MODE || 'MOCK',
      block: 29,
      html,
      assets: { image: body?.imageUrl ? 'READY' : 'ASSET_PENDING', video },
    };
  }
}

@Controller('dashboard')
class DashboardController {
  @Get()
  async summary() {
    const [
      published,
      pending,
      paused,
      detected,
      paid,
      fulfilled,
      approvalsPending,
      agentRuns,
    ] = await Promise.all([
      prisma.product.count({ where: { status: 'PUBLISHED' } }),
      prisma.product.count({ where: { status: 'PENDING_APPROVAL' } }),
      prisma.product.count({ where: { status: 'PAUSED' } }),
      prisma.product.count({ where: { status: 'DETECTED' } }),
      prisma.order.count({ where: { status: 'PAID' } }),
      prisma.order.count({ where: { status: 'FULFILLED' } }),
      prisma.approval.count({ where: { status: 'PENDING' } }),
      prisma.agentRun.count(),
    ]);
    const checklist = [
      { id: 'health', label: 'API health OK', done: true },
      { id: 'approvals', label: 'Revisar aprobaciones PENDING', done: approvalsPending === 0 },
      { id: 'paid', label: 'Pedidos PAID por cumplir', done: paid === 0 },
      { id: 'paused', label: 'Revisar productos pausados', done: paused === 0 },
      { id: 'digest', label: 'Correr digest diario', done: false },
    ];
    return {
      mode: process.env.ECOM_MODE || 'MOCK',
      block: 30,
      kpis: {
        published,
        pendingApproval: pending,
        paused,
        detected,
        ordersPaid: paid,
        ordersFulfilled: fulfilled,
        approvalsPending,
        agentRuns,
      },
      dailyChecklist: checklist,
      scoring: SCORING_META,
      content: CONTENT_META,
    };
  }
}
"""

if "class ScoringController" not in t:
    m = re.search(r"@Module\(\{\s*controllers:", t)
    if m:
        t = t[: m.start()] + CONTROLLERS + "\n" + t[m.start() :]
        print("controllers 28-30 inserted")
    else:
        t = t + "\n" + CONTROLLERS
        print("controllers appended")

# Register in controllers array
for name in ["DashboardController", "ContentController", "ScoringController"]:
    ctrl_section = t.split("controllers:")[1][:400] if "controllers:" in t else ""
    if name not in ctrl_section:
        t = re.sub(r"(controllers:\s*\[)", rf"\1{name}, ", t, count=1)
        print(f"registered {name}")

MAIN.write_text(t)
print("done blocks 28-29-30")
print("lines", len(t.splitlines()))

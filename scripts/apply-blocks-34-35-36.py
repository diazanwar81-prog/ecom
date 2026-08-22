#!/usr/bin/env python3
from pathlib import Path
import re

MAIN = Path(__file__).resolve().parents[1] / "apps/api/src/main.ts"
t = MAIN.read_text()

if "class SeoController" in t and "class AdsController" in t and "class DeployController" in t and "block: 36" in t:
    print("already 34-35-36")
    raise SystemExit(0)

def add_import(marker: str, block: str):
    global t
    if marker in t:
        return
    for pkg in [
        "packages/analytics/src/index",
        "packages/trends/src/index",
        "packages/content/src/index",
        "packages/ops/src/index",
    ]:
        needle = f"}} from '../../../{pkg}';"
        if needle in t:
            t = t.replace(needle, needle + "\n" + block.rstrip() + "\n", 1)
            return
    t = block + t

add_import(
    "packages/seo/src/index",
    """import {
  buildMetaTags,
  buildProductJsonLd,
  buildRobotsTxt,
  buildSitemapXml,
  seoScore,
  SEO_META,
} from '../../../packages/seo/src/index';
""",
)
print("seo import")

add_import(
    "packages/ads/src/index",
    """import {
  getAdsStatus,
  buildCampaignDraft,
  attemptActivateCampaign,
  ADS_META,
} from '../../../packages/ads/src/index';
""",
)
print("ads import")

add_import(
    "packages/deploy/src/index",
    """import {
  productionReadiness,
  ciPipelineHint,
  DEPLOY_META,
} from '../../../packages/deploy/src/index';
""",
)
print("deploy import")

t = t.replace("block: 33", "block: 36")
t = t.replace("block-33", "block-36")

CTRL = """
@Controller('seo')
class SeoController {
  @Get('meta')
  meta() {
    return { mode: process.env.ECOM_MODE || 'MOCK', ...SEO_META };
  }

  @Post('product')
  async product(@Body() body: { productId?: string; title?: string; description?: string; url?: string }) {
    let title = body?.title || 'Producto';
    let description = body?.description;
    let salePrice: any;
    let currency = 'COP';
    let sku: string | undefined;
    let url = body?.url;
    if (body?.productId) {
      const p = await prisma.product.findUnique({ where: { id: body.productId } });
      if (p) {
        title = p.title;
        description = p.description || description;
        salePrice = p.salePrice;
        currency = p.currency;
        sku = (p as any).cjSku || undefined;
        if (p.externalId) {
          const shop = process.env.SHOPIFY_SHOP_DOMAIN || '';
          if (shop) url = url || `https://${String(shop).replace(/^https?:\\/\\//, '')}/products/${p.externalId}`;
        }
      }
    }
    const input = { title, description, salePrice, currency, url, sku };
    const tags = buildMetaTags(input);
    const jsonLd = buildProductJsonLd(input);
    const score = seoScore({
      hasTitle: Boolean(title),
      hasDescription: Boolean(description),
      hasImage: false,
      hasJsonLd: true,
      titleLen: title.length,
      descLen: (description || '').length,
    });
    return { mode: process.env.ECOM_MODE || 'MOCK', block: 34, tags, jsonLd, score };
  }

  @Get('robots.txt')
  robots() {
    const app = process.env.APP_URL || 'http://localhost:3000';
    return buildRobotsTxt({ sitemapUrl: `${app}/seo/sitemap.xml` });
  }

  @Get('sitemap.xml')
  async sitemap() {
    const shop = process.env.SHOPIFY_SHOP_DOMAIN || process.env.APP_URL || 'http://localhost:3000';
    const products = await prisma.product.findMany({
      where: { status: 'PUBLISHED' },
      take: 200,
      orderBy: { updatedAt: 'desc' },
    });
    const urls = products
      .filter((p) => p.externalId)
      .map((p) => ({
        loc: `https://${String(shop).replace(/^https?:\\/\\//, '')}/products/${p.externalId}`,
        lastmod: p.updatedAt.toISOString().slice(0, 10),
        changefreq: 'weekly',
        priority: 0.8,
      }));
    return buildSitemapXml(urls);
  }
}

@Controller('ads')
class AdsController {
  @Get('status')
  status() {
    return { mode: process.env.ECOM_MODE || 'MOCK', ...getAdsStatus(), ...ADS_META };
  }

  @Post('draft')
  draft(
    @Body()
    body: { productTitle?: string; platform?: 'meta' | 'google' | 'tiktok'; dailyBudgetUsd?: number },
  ) {
    const draft = buildCampaignDraft({
      productTitle: body?.productTitle || 'Producto ECOM',
      platform: body?.platform,
      dailyBudgetUsd: body?.dailyBudgetUsd ?? 0,
    });
    return { mode: process.env.ECOM_MODE || 'MOCK', block: 35, draft };
  }

  @Post('activate-attempt')
  activate(
    @Body()
    body: {
      productTitle?: string;
      dailyBudgetUsd?: number;
      force?: boolean;
      humanApproved?: boolean;
    },
  ) {
    const draft = buildCampaignDraft({
      productTitle: body?.productTitle || 'test',
      dailyBudgetUsd: body?.dailyBudgetUsd ?? 0,
    });
    const result = attemptActivateCampaign(draft, {
      force: Boolean(body?.force),
      humanApproved: Boolean(body?.humanApproved),
    });
    return { mode: process.env.ECOM_MODE || 'MOCK', block: 35, ...result };
  }
}

@Controller('deploy')
class DeployController {
  @Get('status')
  status() {
    return { mode: process.env.ECOM_MODE || 'MOCK', ...DEPLOY_META };
  }

  @Get('readiness')
  readiness() {
    const result = productionReadiness(process.env as any);
    return { mode: process.env.ECOM_MODE || 'MOCK', block: 36, ...result };
  }

  @Get('ci-hints')
  ci() {
    return { mode: process.env.ECOM_MODE || 'MOCK', block: 36, steps: ciPipelineHint() };
  }
}
"""

if "class SeoController" not in t:
    m = re.search(r"@Module\(\{\s*controllers:", t)
    if m:
        t = t[: m.start()] + CTRL + "\n" + t[m.start() :]
        print("controllers inserted")
    else:
        t = t + "\n" + CTRL

for name in ["DeployController", "AdsController", "SeoController"]:
    section = t.split("controllers:")[1][:600] if "controllers:" in t else ""
    if name not in section:
        t = re.sub(r"(controllers:\s*\[)", rf"\1{name}, ", t, count=1)
        print("registered", name)

MAIN.write_text(t)
print("done 34-35-36")
print("lines", len(t.splitlines()))

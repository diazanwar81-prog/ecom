#!/usr/bin/env python3
"""Wire blocks 62-65 media endpoints into apps/api/src/main.ts"""
from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[1]
MAIN = ROOT / "apps/api/src/main.ts"
text = MAIN.read_text()

IMPORT = """import {
  generateImageAssets,
  generateVideoAssets,
  buildLandingPack,
  preSaleChecklist,
  MEDIA_META,
} from '../../../packages/media/src/index';
"""

if "packages/media/src/index" not in text:
    anchor = "from '../../../packages/content/src/index';"
    idx = text.rfind(anchor)
    if idx < 0:
        raise SystemExit("content import not found")
    end = idx + len(anchor)
    text = text[:end] + "\n\n" + IMPORT + text[end:]

# Bump first health block: 61 -> 65
text, n_health = re.subn(
    r"(async health\(\)[\s\S]*?block:\s*)61(,")",
    r"\g<1>65\2",
    text,
    count=1,
)
if n_health == 0:
    text, n_health = re.subn(
        r"block:\s*61,(\s*\n\s*aiRouter:)",
        r"block: 65,\1",
        text,
        count=1,
    )

EXTRA_METHODS = '''
  @Get('media-meta')
  mediaMeta() {
    return { mode: process.env.ECOM_MODE || 'MOCK', ...MEDIA_META };
  }

  /** Block 62: image assets from brief mediaPlan or explicit plan */
  @Post('images')
  async images(
    @Body()
    body: {
      productId?: string;
      mediaPlan?: any;
      forceLive?: boolean;
      forceMock?: boolean;
    },
  ) {
    let plan = body?.mediaPlan;
    let title = 'Producto';
    if (!plan && body?.productId) {
      const p = await prisma.product.findUnique({ where: { id: body.productId } });
      if (!p) return { error: 'not_found' };
      title = p.title;
      const brief = await generateCreativeBrief({
        rawTitle: p.title,
        forceMock: true,
      });
      plan = brief.brief.mediaPlan;
    }
    if (!plan) {
      const brief = await generateCreativeBrief({
        rawTitle: title,
        forceMock: true,
      });
      plan = brief.brief.mediaPlan;
    }
    const result = generateImageAssets(plan, {
      forceLive: body?.forceLive === true && body?.forceMock !== true,
      productTitle: title,
    });
    await writeAudit('MEDIA_IMAGES', 'Media', body?.productId || 'adhoc', {
      count: result.assets.length,
      mock: result.mock,
    });
    return {
      mode: process.env.ECOM_MODE || 'MOCK',
      block: 62,
      ...result,
    };
  }

  /** Block 63: video asset slots */
  @Post('videos')
  async videos(
    @Body()
    body: { productId?: string; mediaPlan?: any; forceLive?: boolean },
  ) {
    let plan = body?.mediaPlan;
    if (!plan && body?.productId) {
      const p = await prisma.product.findUnique({ where: { id: body.productId } });
      if (!p) return { error: 'not_found' };
      const brief = await generateCreativeBrief({
        rawTitle: p.title,
        forceMock: true,
      });
      plan = brief.brief.mediaPlan;
    }
    if (!plan) {
      const brief = await generateCreativeBrief({
        rawTitle: 'Producto',
        forceMock: true,
      });
      plan = brief.brief.mediaPlan;
    }
    const result = generateVideoAssets(plan, { forceLive: Boolean(body?.forceLive) });
    await writeAudit('MEDIA_VIDEOS', 'Media', body?.productId || 'adhoc', {
      count: result.assets.length,
    });
    return {
      mode: process.env.ECOM_MODE || 'MOCK',
      block: 63,
      ...result,
    };
  }

  /** Block 64: landing HTML + image pack */
  @Post('pack')
  async pack(
    @Body()
    body: {
      productId?: string;
      forceMock?: boolean;
    },
  ) {
    if (!body?.productId) return { error: 'productId_required' };
    const p = await prisma.product.findUnique({ where: { id: body.productId } });
    if (!p) return { error: 'not_found' };
    const brief = await generateCreativeBrief({
      rawTitle: p.title,
      forceMock: body?.forceMock !== false,
      salePrice: p.salePrice != null ? Number(p.salePrice) : undefined,
      currency: p.currency || 'COP',
    });
    const images = generateImageAssets(brief.brief.mediaPlan, {
      productTitle: brief.brief.productName,
    });
    const videos = generateVideoAssets(brief.brief.mediaPlan);
    let shopifyUrl: string | undefined;
    if (p.externalId) {
      const shop = process.env.SHOPIFY_SHOP_DOMAIN || process.env.SHOPIFY_SHOP || '';
      if (shop) {
        shopifyUrl = `https://${String(shop).replace(/^https?:\\/\\//, '')}/products/${p.externalId}`;
      }
    }
    const pack = buildLandingPack({
      title: brief.brief.title,
      description: brief.brief.description,
      salePrice: p.salePrice != null ? Number(p.salePrice) : undefined,
      currency: p.currency || 'COP',
      imageAssets: images.assets,
      videoAssets: videos.assets,
      shopifyUrl,
      countryCode: 'CO',
    });
    await writeAudit('MEDIA_PACK', 'Product', p.id, {
      imageCount: pack.imageCount,
      videoPending: pack.videoPending,
    });
    return {
      mode: process.env.ECOM_MODE || 'MOCK',
      block: 64,
      productId: p.id,
      brief: {
        productName: brief.brief.productName,
        title: brief.brief.title,
        niche: brief.brief.niche,
      },
      images: images.assets,
      videos: videos.assets,
      landing: pack,
    };
  }

  /** Block 65: pre-sale checklist */
  @Get('pre-sale')
  async preSale() {
    const products = await prisma.product.findMany({
      take: 300,
      include: { suppliers: true },
    });
    const publishedWithCj = products.filter(
      (p) =>
        p.status === 'PUBLISHED' &&
        (p.suppliers || []).some((s: any) => s.cjVariantId || s.cjSku),
    ).length;
    const pendingApprovals = products.filter((p) => p.status === 'PENDING_APPROVAL').length;
    const apiUrl = process.env.API_URL || process.env.APP_URL || '';
    const checklist = preSaleChecklist({
      mode: process.env.ECOM_MODE || 'MOCK',
      shopifyLive: String(process.env.SHOPIFY_ACCESS_TOKEN || '').length > 5,
      cjLive: String(process.env.CJ_API_KEY || '').length > 5,
      httpsPublic: /^https:\\/\\//i.test(apiUrl),
      webhookSecret: String(process.env.SHOPIFY_WEBHOOK_SECRET || '').length > 3,
      publishedWithCj,
      pendingApprovals,
      hasMediaPlan: true,
      hasImageMocks: true,
      killSwitch:
        process.env.ECOM_KILL_SWITCH === 'true' || process.env.ECOM_PAUSE_ALL === 'true',
    });
    return {
      mode: process.env.ECOM_MODE || 'MOCK',
      block: 65,
      ...MEDIA_META,
      ...checklist,
      next:
        checklist.canAttemptFirstSale
          ? [
              '1) Elige producto PUBLISHED con CJ',
              '2) Verifica webhook HTTPS',
              '3) Pedido de prueba real en Shopify',
              '4) Confirma fulfill + tracking',
            ]
          : checklist.items.filter((i) => !i.ok).map((i) => i.message),
    };
  }

'''

# Fix accidental double-escaped regex in template (shopify URL + https test)
EXTRA_METHODS = EXTRA_METHODS.replace(
    "replace(/^https?:\\\\/\\\\//, '')",
    "replace(/^https?:\\/\\//, '')",
)
EXTRA_METHODS = EXTRA_METHODS.replace(
    "/^https:\\\\/\\\\//i.test(apiUrl)",
    "/^https:\\/\\//i.test(apiUrl)",
)

if "@Post('images')" not in text and "Block 62: image assets" not in text:
    marker = "  @Post('landing-preview')"
    if marker not in text:
        raise SystemExit("landing-preview not found in CreativeController")
    text = text.replace(marker, EXTRA_METHODS + marker, 1)

# Bootstrap log
text = re.sub(
    r"ECOM API block-\d+[^"]*",
    "ECOM API block-65 (media 62-65)",
    text,
    count=1,
)
text = re.sub(
    r"void alertOps\('BOOT', \{ service: 'ecom-api', block: \d+ \}\);",
    "void alertOps('BOOT', { service: 'ecom-api', block: 65 });",
    text,
    count=1,
)

MAIN.write_text(text)
print("Patched", MAIN)
print("  media import:", "packages/media" in MAIN.read_text())
print("  images route:", "@Post('images')" in MAIN.read_text() or "Block 62" in MAIN.read_text())
print("  pre-sale:", "pre-sale" in MAIN.read_text() or "preSale" in MAIN.read_text())
print("  block 65:", "block: 65" in MAIN.read_text())

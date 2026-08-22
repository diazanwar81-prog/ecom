#!/usr/bin/env python3
"""Wire block 61 CreativeController into apps/api/src/main.ts"""
from pathlib import Path
import re

MAIN = Path(__file__).resolve().parents[1] / "apps/api/src/main.ts"
t = MAIN.read_text()

if "class CreativeController" in t and "generateCreativeBrief" in t:
    print("already 61")
    raise SystemExit(0)

if "generateCreativeBrief" not in t:
    imp = """import {
  CONTENT_META,
  generateCreativeBrief,
  validateBrief,
  buildLandingHtml,
  defaultMediaPlan,
} from '../../../packages/content/src/index';
"""
    for pkg in [
        "packages/release/src/index",
        "packages/hardening/src/index",
        "packages/content/src/index",
    ]:
        needle = f"}} from '../../../{pkg}';"
        if needle in t and "generateCreativeBrief" not in t:
            t = t.replace(needle, needle + "\n" + imp.rstrip() + "\n", 1)
            print("content import after", pkg)
            break
    else:
        if "generateCreativeBrief" not in t:
            t = imp + t
            print("content import at top")

t = t.replace("block: 60", "block: 61")
t = t.replace("block-60", "block-61")

CTRL = r'''
@Controller('creative')
class CreativeController {
  @Get('meta')
  meta() {
    return { mode: process.env.ECOM_MODE || 'MOCK', ...CONTENT_META };
  }

  @Post('brief')
  async brief(
    @Body()
    body: {
      title?: string;
      productId?: string;
      facts?: string;
      category?: string;
      forceMock?: boolean;
      persist?: boolean;
    },
  ) {
    let rawTitle = body?.title || '';
    let facts = body?.facts || '';
    let product: any = null;

    if (body?.productId) {
      product = await prisma.product.findUnique({
        where: { id: body.productId },
        include: { suppliers: true },
      });
      if (!product) return { error: 'not_found' };
      rawTitle = product.title;
      facts =
        facts ||
        `precio=${product.salePrice} ${product.currency || 'COP'}; costo=${product.productCost}; envio=${product.shippingCost}; stock=${product.stock}; margen=${product.marginPercent}`;
    }

    if (!rawTitle) return { error: 'title_or_productId_required' };

    const result = await generateCreativeBrief({
      rawTitle,
      facts,
      category: body?.category,
      countryCode: 'CO',
      currency: product?.currency || 'COP',
      salePrice: product?.salePrice != null ? Number(product.salePrice) : undefined,
      forceMock: body?.forceMock === true,
    });

    const validation = validateBrief(result.brief);

    if (body?.persist && product) {
      await prisma.product.update({
        where: { id: product.id },
        data: {
          title: result.brief.title,
          description: result.brief.description,
        },
      });
      await writeAudit('CREATIVE_BRIEF', 'Product', product.id, {
        source: result.brief.source,
        provider: result.brief.provider,
      });
    }

    return {
      mode: process.env.ECOM_MODE || 'MOCK',
      block: 61,
      productId: product?.id || null,
      validation,
      brief: result.brief,
      aiMeta: result.ai
        ? {
            provider: result.ai.provider,
            model: result.ai.model,
            mock: result.ai.mock,
            latencyMs: result.ai.latencyMs,
            error: result.ai.error,
          }
        : null,
    };
  }

  @Post('landing-preview')
  async landingPreview(
    @Body() body: { productId?: string; title?: string; description?: string; imageUrl?: string },
  ) {
    let title = body?.title || 'Producto';
    let description = body?.description || '';
    let salePrice: any = null;
    let currency = 'COP';
    let imageUrl = body?.imageUrl || null;

    if (body?.productId) {
      const p = await prisma.product.findUnique({ where: { id: body.productId } });
      if (!p) return { error: 'not_found' };
      title = p.title;
      description = p.description || description;
      salePrice = p.salePrice;
      currency = p.currency || 'COP';
    }

    const html = buildLandingHtml({
      title,
      description,
      salePrice,
      currency,
      imageUrl,
      countryCode: 'CO',
    });

    return {
      mode: process.env.ECOM_MODE || 'MOCK',
      block: 61,
      html,
      bytes: html.length,
    };
  }
}
'''

if "class CreativeController" not in t:
    m = re.search(r"@Module\(\{\s*controllers:", t)
    if m:
        t = t[: m.start()] + CTRL + "\n" + t[m.start() :]
        print("CreativeController inserted")
    else:
        t = t + "\n" + CTRL
        print("CreativeController appended")

section = t.split("controllers:")[1][:1000] if "controllers:" in t else ""
if "CreativeController" not in section:
    t = re.sub(r"(controllers:\s*\[)", r"\1CreativeController, ", t, count=1)
    print("registered CreativeController")

MAIN.write_text(t)
print("done 61")
print("lines", len(t.splitlines()))

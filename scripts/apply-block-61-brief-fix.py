#!/usr/bin/env python3
"""Harden CreativeController.brief against 500s."""
from pathlib import Path
import re

MAIN = Path(__file__).resolve().parents[1] / "apps/api/src/main.ts"
t = MAIN.read_text()

old = '''  @Post('brief')
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
  }'''

new = '''  @Post('brief')
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
    try {
      let rawTitle = body?.title || '';
      let facts = body?.facts || '';
      let product: any = null;
      let salePrice: number | undefined;
      let currency = 'COP';

      if (body?.productId) {
        product = await prisma.product.findUnique({
          where: { id: body.productId },
          include: { suppliers: { orderBy: { isPrimary: 'desc' }, take: 1 } },
        });
        if (!product) return { error: 'not_found' };
        rawTitle = product.title;
        const primary = product.suppliers?.[0];
        const productCost = primary?.productCost != null ? Number(primary.productCost) : null;
        const shippingCost = primary?.shippingCost != null ? Number(primary.shippingCost) : null;
        const stock = primary?.stock ?? null;
        salePrice = product.salePrice != null ? Number(product.salePrice) : undefined;
        currency = product.currency || 'COP';
        facts =
          facts ||
          `precio=${salePrice ?? 'n/a'} ${currency}; costo=${productCost ?? 'n/a'}; envio=${shippingCost ?? 'n/a'}; stock=${stock ?? 'n/a'}; margen=${product.marginPercent ?? 'n/a'}`;
      }

      if (!rawTitle) return { error: 'title_or_productId_required' };

      const result = await generateCreativeBrief({
        rawTitle,
        facts,
        category: body?.category,
        countryCode: 'CO',
        currency,
        salePrice,
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
          niche: result.brief.niche,
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
    } catch (e: any) {
      console.error('[creative/brief]', e?.message || e);
      return {
        mode: process.env.ECOM_MODE || 'MOCK',
        block: 61,
        error: 'brief_failed',
        message: e?.message || String(e),
      };
    }
  }'''

if old not in t:
    print('brief method pattern not found exactly — check manually')
    # still try softer replace of facts line
    if 'product.productCost' in t:
        t = t.replace(
            '`precio=${product.salePrice} ${product.currency || \'COP\'}; costo=${product.productCost}; envio=${product.shippingCost}; stock=${product.stock}; margen=${product.marginPercent}`',
            '`precio=${product.salePrice} ${product.currency || \'COP\'}; margen=${product.marginPercent}`',
        )
        MAIN.write_text(t)
        print('soft facts fix applied')
    raise SystemExit(1)

t = t.replace(old, new)
MAIN.write_text(t)
print('CreativeController.brief hardened')

#!/usr/bin/env python3
"""Block 16: clean title + AI description before Shopify go-live."""
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
MAIN = ROOT / "apps/api/src/main.ts"

HELPER = r'''
function cleanProductTitle(raw: string): string {
  return String(raw || '')
    .replace(/\[(?:MOCK|SERPER\+CJ|SERPER|CJ)\]\s*/gi, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120) || 'Producto ECOM';
}

'''

OLD_PUBLISH = r'''    const sku = enriched.cjSku || `ECOM-${id.slice(-8)}`;
    const result = await publishProduct({
      title: enriched.title,
      description: enriched.description,
      price: enriched.salePrice,
      currency: enriched.currency,
      sku,
      inventory: enriched.stock,
    });
    if (!result.ok) {
      await writeAudit('GO_LIVE_FAILED', 'Product', id, result);
      return { mode: MODE, error: 'publish_failed', approval, result };
    }

    const updated = await prisma.product.update({
      where: { id },
      data: {
        status: 'PUBLISHED',
        externalId: result.externalId,
        isFirstPublication: false,
        sourceMode: result.mock ? 'MOCK' : MODE_ENUM,
      },
    });
    await writeAudit('PRODUCT_GO_LIVE', 'Product', id, {
      shopify: result.externalId,
      cjVariantId: enriched.cjVariantId,
      cjSku: enriched.cjSku,
      mock: result.mock,
    });

    return {
      mode: MODE,
      published: true,
      mock: result.mock,
      product: updated,
      approval,
      shopify: result,
      cj: { variantId: enriched.cjVariantId, sku: enriched.cjSku },
      note: 'Publicado tras aprobación humana (go-live). Vínculo CJ conservado en ProductSupplier.',
    };
'''

NEW_PUBLISH = r'''    // Block 16: clean title + optional AI copy (skip with body.skipAiCopy=true)
    const skipAi = Boolean((body as any)?.skipAiCopy);
    let liveTitle = cleanProductTitle(enriched.title);
    let liveDescription = enriched.description || '';
    let copyMeta: Record<string, unknown> = { skipped: skipAi };

    if (!skipAi) {
      try {
        const copy = await generateProductCopy({
          title: liveTitle,
          facts: `precio ${enriched.salePrice} ${enriched.currency}, costo ${enriched.productCost}, stock ${enriched.stock}, proveedor CJ, sku ${enriched.cjSku || 'n/a'}`,
          language: 'es-CO',
        });
        copyMeta = {
          ok: copy.ok,
          provider: copy.provider,
          model: copy.model,
          mock: copy.mock,
        };
        if (copy.ok && copy.text) {
          liveDescription = copy.text.slice(0, 4000);
          // First non-empty line as optional short title if original was noisy
          const firstLine = liveDescription.split('\n').map((s) => s.trim()).find(Boolean);
          if (firstLine && firstLine.length >= 12 && firstLine.length <= 90 && /\[/.test(enriched.title)) {
            liveTitle = firstLine.replace(/^#+\s*/, '').slice(0, 120);
          }
        }
      } catch (e: any) {
        copyMeta = { ok: false, error: e?.message || 'copy_failed' };
      }
    }

    if (liveDescription || liveTitle !== enriched.title) {
      await prisma.product.update({
        where: { id },
        data: {
          title: liveTitle,
          description: liveDescription || null,
        },
      });
    }

    const sku = enriched.cjSku || `ECOM-${id.slice(-8)}`;
    const result = await publishProduct({
      title: liveTitle,
      description: liveDescription || liveTitle,
      price: enriched.salePrice,
      currency: enriched.currency,
      sku,
      inventory: enriched.stock,
    });
    if (!result.ok) {
      await writeAudit('GO_LIVE_FAILED', 'Product', id, result);
      return { mode: MODE, error: 'publish_failed', approval, result, copy: copyMeta };
    }

    const updated = await prisma.product.update({
      where: { id },
      data: {
        status: 'PUBLISHED',
        externalId: result.externalId,
        isFirstPublication: false,
        sourceMode: result.mock ? 'MOCK' : MODE_ENUM,
        title: liveTitle,
        description: liveDescription || null,
      },
    });
    await writeAudit('PRODUCT_GO_LIVE', 'Product', id, {
      shopify: result.externalId,
      cjVariantId: enriched.cjVariantId,
      cjSku: enriched.cjSku,
      mock: result.mock,
      copy: copyMeta,
      title: liveTitle,
    });

    return {
      mode: MODE,
      published: true,
      mock: result.mock,
      product: updated,
      approval,
      shopify: result,
      copy: copyMeta,
      cj: { variantId: enriched.cjVariantId, sku: enriched.cjSku },
      note: 'Go-live con copy IA (bloque 16). Título limpio + descripción es-CO. CJ conservado.',
    };
'''

def main():
    t = MAIN.read_text()
    if "cleanProductTitle" in t and "block: 16" in t and "Block 16: clean title" in t:
        print("Already block 16")
        return

    if "function cleanProductTitle" not in t:
        # insert after enrichProduct function end is hard; put before class ProductsController
        marker = "class ProductsController"
        if marker not in t:
            print("ERROR: ProductsController not found")
            sys.exit(1)
        t = t.replace(marker, HELPER + marker, 1)

    if OLD_PUBLISH not in t:
        print("ERROR: go-live publish block not found (main may have drifted)")
        sys.exit(1)
    t = t.replace(OLD_PUBLISH, NEW_PUBLISH, 1)

    t = t.replace("block: 15,", "block: 16,", 1)
    t = t.replace(
        "ECOM API block-15 (go-live)",
        "ECOM API block-16 (ai-copy)",
        1,
    )
    # body type for goLive
    t = t.replace(
        "async goLive(@Param('id') id: string, @Body() body: { note?: string })",
        "async goLive(@Param('id') id: string, @Body() body: { note?: string; skipAiCopy?: boolean })",
        1,
    )

    MAIN.write_text(t)
    print("Patched block 16 AI copy on go-live")
    print("  cleanProductTitle:", "cleanProductTitle" in t)
    print("  block 16:", "block: 16" in t)

if __name__ == "__main__":
    main()

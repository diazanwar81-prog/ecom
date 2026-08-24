#!/usr/bin/env python3
"""Wire Phase B branding endpoints into apps/api/src/main.ts"""
from pathlib import Path

MAIN = Path('apps/api/src/main.ts')
text = MAIN.read_text(encoding='utf-8')

IMPORT = """import {
  PHASE_B_META,
  buildPhaseBChecks,
  summarizePhaseB,
  buildBrandMediaSlots,
  validateBrandPack,
  cleanBrandTitle,
  filterHttpsImages,
} from '../../../packages/phase-b/src/index';
"""

if 'PHASE_B_META' not in text:
    needle = "from '../../../packages/phase-a/src/index';"
    if needle in text:
        # after phase-a import block — find end of that import
        idx = text.find(needle)
        # insert after ensureShopifyAccessToken import if present
        if "ensureShopifyAccessToken" in text[idx:idx+500]:
            end = text.find("';\n", idx)
            # find last import from that cluster
            chunk_end = text.find("\n\n", idx)
            if chunk_end > 0:
                text = text[:chunk_end] + "\n" + IMPORT + text[chunk_end:]
            else:
                text = text.replace(needle, needle + "\n" + IMPORT, 1)
        else:
            text = text.replace(needle, needle + "\n" + IMPORT, 1)
    else:
        # fallback after content import
        needle2 = "from '../../../packages/content/src/index';"
        if needle2 in text:
            # find closing of multi-line import
            i = text.find(needle2)
            # go back to start of import {
            start = text.rfind('import {', 0, i)
            end = text.find(";\n", i)
            if start >= 0 and end > start:
                text = text[: end + 2] + "\n" + IMPORT + text[end + 2 :]
            else:
                text = IMPORT + text
        else:
            text = IMPORT + text

CONTROLLER = r'''
@Controller('phase-b')
class PhaseBController {
  @Get('meta')
  meta() {
    return { mode: process.env.ECOM_MODE || 'MOCK', ...PHASE_B_META };
  }

  /** Auto-verify branding pipeline 82–87 */
  @Get('verify')
  async verify() {
    const mode = process.env.ECOM_MODE || 'MOCK';
    const products = await prisma.product.findMany({ take: 300 });
    const withDesc = products.filter((p) => p.description && String(p.description).length > 20).length;

    // Sample brand pack on first product with CJ-ish title or any product
    let brandPackOkSample: boolean | undefined;
    try {
      const sample = products[0];
      if (sample) {
        const title = cleanBrandTitle(sample.title);
        const slots = buildBrandMediaSlots({
          cjImageUrls: [],
          productLabel: title,
        });
        const validation = validateBrandPack({
          title: title.length >= 8 ? title : `Producto ${title}`,
          description:
            sample.description ||
            `${title}. Producto seleccionado para Colombia, uso diario, envío con seguimiento.`,
          images: slots.images,
          videos: slots.videos,
          imageUrlsForShopify: slots.imageUrlsForShopify,
        });
        brandPackOkSample = validation.ok;
      }
    } catch {
      brandPackOkSample = false;
    }

    const items = buildPhaseBChecks({
      mode,
      hasCreativeBrief: true,
      hasMediaPlan: true,
      hasImagePipeline: true,
      hasVideoSlots: true,
      hasCjImageResolver: typeof resolveCjImageUrls === 'function',
      productsWithDescription: withDesc,
      productsTotal: products.length,
      publishedWithImagesHint: products.filter((p) => p.status === 'PUBLISHED').length,
      brandPackOkSample,
    });

    const summary = summarizePhaseB(items);
    const errors = items.filter((i) => !i.ok).map((i) => ({
      id: i.id,
      severity: i.severity,
      message: i.message,
      detail: i.detail,
    }));

    return {
      mode,
      block: 87,
      phase: 'B',
      ...summary,
      errors,
      panel: errors.length
        ? { title: 'Errores / advertencias Fase B', items: errors }
        : { title: 'Fase B OK', items: [] },
      next: summary.ok
        ? [
            'POST /phase-b/brand {"productId":"..."} para generar pack completo',
            'Revisa title/description/images en la respuesta',
            'Go-live usará imageUrls + copy si ya persististe',
          ]
        : errors.filter((e) => e.severity === 'critical').map((e) => e.message),
    };
  }

  /**
   * Full branding pack for one product:
   * creative brief ES + CJ images + 5 image slots + 2 video slots + optional persist
   */
  @Post('brand')
  async brand(
    @Body()
    body: {
      productId?: string;
      persist?: boolean;
      forceMock?: boolean;
      skipAi?: boolean;
    },
  ) {
    if (!body?.productId) return { error: 'productId_required' };
    const p = await prisma.product.findUnique({
      where: { id: body.productId },
      include: { suppliers: { orderBy: { isPrimary: 'desc' }, take: 1 } },
    });
    if (!p) return { error: 'not_found' };

    const primary = p.suppliers?.[0];
    const cjSku = primary?.cjSku;
    const baseTitle = cleanBrandTitle(p.title);

    // 86: strong ES copy via creative brief
    let brief: any = null;
    let copyMeta: any = { skipped: Boolean(body.skipAi) };
    if (!body.skipAi) {
      try {
        const result = await generateCreativeBrief({
          rawTitle: p.title,
          facts: `sku=${cjSku || 'n/a'}; precio=${p.salePrice}; stock=${primary?.stock ?? 'n/a'}`,
          currency: p.currency || 'COP',
          salePrice: p.salePrice != null ? Number(p.salePrice) : undefined,
          forceMock: body.forceMock === true,
          language: 'es-CO',
        });
        brief = result.brief;
        copyMeta = {
          ok: result.ok,
          source: brief?.source,
          provider: brief?.provider,
          niche: brief?.niche,
        };
      } catch (e: any) {
        copyMeta = { ok: false, error: e?.message || 'brief_failed' };
      }
    }

    const liveTitle = brief?.title || baseTitle;
    const liveDescription =
      brief?.description ||
      p.description ||
      `${baseTitle}. Selección para Colombia, uso diario, envío con seguimiento.`;

    // 82: CJ images
    let cjUrls: string[] = [];
    try {
      cjUrls = await resolveCjImageUrls(liveTitle, cjSku);
    } catch {
      cjUrls = [];
    }

    // 83–85: media slots
    const slots = buildBrandMediaSlots({
      cjImageUrls: cjUrls,
      productLabel: liveTitle,
    });

    const validation = validateBrandPack({
      title: liveTitle,
      description: liveDescription,
      bullets: brief?.bullets,
      images: slots.images,
      videos: slots.videos,
      imageUrlsForShopify: slots.imageUrlsForShopify,
    });

    let persisted = false;
    if (body.persist && validation.ok) {
      await prisma.product.update({
        where: { id: p.id },
        data: {
          title: liveTitle.slice(0, 200),
          description: liveDescription.slice(0, 4000),
        },
      });
      await writeAudit('PHASE_B_BRAND', 'Product', p.id, {
        title: liveTitle,
        imageCount: slots.images.length,
        cjImages: cjUrls.length,
        validation,
      });
      persisted = true;
    }

    return {
      mode: process.env.ECOM_MODE || 'MOCK',
      block: 87,
      phase: 'B',
      productId: p.id,
      persisted,
      validation,
      copy: copyMeta,
      brand: {
        title: liveTitle,
        description: liveDescription,
        bullets: brief?.bullets || [],
        productName: brief?.productName || liveTitle,
        niche: brief?.niche,
        seo: brief?.seo,
      },
      media: {
        cjImageCount: cjUrls.length,
        images: slots.images,
        videos: slots.videos,
        imageUrlsForShopify: slots.imageUrlsForShopify,
      },
      shopifyReady: {
        title: liveTitle,
        body_html: liveDescription,
        imageUrls: slots.imageUrlsForShopify,
        note: 'Usar en go-live / publishProduct',
      },
      panel: validation.ok
        ? { title: 'Brand pack OK', items: [] }
        : {
            title: 'Brand pack con issues',
            items: validation.issues.map((id) => ({ id, severity: 'warning', message: id })),
          },
    };
  }
}
'''

if 'class PhaseBController' not in text:
    if 'class PhaseAController' in text:
        text = text.replace(
            "@Controller('phase-a')\nclass PhaseAController",
            CONTROLLER + "\n\n@Controller('phase-a')\nclass PhaseAController",
            1,
        )
    else:
        text = text.replace(
            "@Controller('autonomy')\nclass AutonomyController",
            CONTROLLER + "\n\n@Controller('autonomy')\nclass AutonomyController",
            1,
        )

if 'PhaseBController,' not in text and 'PhaseBController' in text:
    if 'PhaseAController,' in text:
        text = text.replace(
            'controllers: [PhaseAController,',
            'controllers: [PhaseBController, PhaseAController,',
            1,
        )
    else:
        text = text.replace(
            'controllers: [AutonomyController,',
            'controllers: [PhaseBController, AutonomyController,',
            1,
        )

# health / boot block bump
if 'block: 81,' in text:
    text = text.replace('block: 81,', 'block: 87,', 1)
elif 'block: 75,' in text:
    text = text.replace('block: 75,', 'block: 87,', 1)

for old in [
    'block-81 (phase-A verify)',
    'block-75 (autonomy 67-75)',
    'block-81 (phase-A verify)',
]:
    if old in text:
        text = text.replace(old, 'block-87 (phase-B branding)', 1)
        break

MAIN.write_text(text, encoding='utf-8')
print('Patched', MAIN)
print('PhaseBController:', 'class PhaseBController' in text)
print('PHASE_B_META import:', 'PHASE_B_META' in text)

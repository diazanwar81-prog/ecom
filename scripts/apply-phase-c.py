#!/usr/bin/env python3
"""Wire Phase C: landings + MP4 render + verify into apps/api/src/main.ts"""
from pathlib import Path

MAIN = Path('apps/api/src/main.ts')
text = MAIN.read_text(encoding='utf-8')

IMPORT = """import {
  PHASE_C_META,
  buildPhaseCChecks,
  summarizePhaseC,
  buildProductLanding,
  renderSlideshowMp4,
  ffmpegAvailable,
} from '../../../packages/phase-c/src/index';
"""

if 'PHASE_C_META' not in text:
    if "from '../../../packages/phase-b/src/index'" in text:
        i = text.find("from '../../../packages/phase-b/src/index'")
        end = text.find(';\n', i)
        text = text[: end + 2] + '\n' + IMPORT + text[end + 2 :]
    elif "from '../../../packages/phase-a/src/index'" in text:
        i = text.find("from '../../../packages/phase-a/src/index'")
        end = text.find(';\n', i)
        text = text[: end + 2] + '\n' + IMPORT + text[end + 2 :]
    else:
        text = IMPORT + text

CONTROLLER = r'''
@Controller('phase-c')
class PhaseCController {
  @Get('meta')
  meta() {
    return {
      mode: process.env.ECOM_MODE || 'MOCK',
      ...PHASE_C_META,
      ffmpeg: ffmpegAvailable(),
    };
  }

  @Get('verify')
  async verify() {
    const mode = process.env.ECOM_MODE || 'MOCK';
    const published = await prisma.product.count({ where: { status: 'PUBLISHED' } });
    const total = await prisma.product.count();
    const items = buildPhaseCChecks({
      mode,
      hasLandingBuilder: true,
      hasFfmpeg: ffmpegAvailable(),
      landingsGenerated: total,
      publishedCount: published,
    });
    const summary = summarizePhaseC(items);
    const errors = items.filter((i) => !i.ok).map((i) => ({
      id: i.id,
      severity: i.severity,
      message: i.message,
      detail: i.detail,
    }));
    // also surface ffmpeg as panel item even if severity warning with ok:true
    const warnPanel = items
      .filter((i) => i.severity === 'warning')
      .map((i) => ({
        id: i.id,
        severity: i.severity,
        message: i.message,
        detail: i.detail,
        ok: i.ok,
      }));

    return {
      mode,
      block: 92,
      phase: 'C',
      ...summary,
      ffmpeg: ffmpegAvailable(),
      errors,
      panel: errors.length
        ? { title: 'Errores / advertencias Fase C', items: errors }
        : warnPanel.some((w) => w.id === 'ffmpeg' && !ffmpegAvailable())
          ? {
              title: 'Fase C OK con avisos',
              items: warnPanel.filter((w) => w.id === 'ffmpeg'),
            }
          : { title: 'Fase C OK', items: [] },
      next: [
        'GET /phase-c/landing/:productId',
        'POST /phase-c/render-video {"productId":"..."} o {"frames":["https://..."]}',
        'Instalar ffmpeg en Docker si quieres MP4 real en el API',
      ],
    };
  }

  @Get('landing/:id')
  async landingGet(@Param('id') id: string) {
    const p = await prisma.product.findUnique({
      where: { id },
      include: { suppliers: { orderBy: { isPrimary: 'desc' }, take: 1 } },
    });
    if (!p) return { error: 'not_found' };

    let imageUrls: string[] = [];
    try {
      const primary = p.suppliers?.[0];
      imageUrls = await resolveCjImageUrls(p.title, primary?.cjSku);
    } catch {
      imageUrls = [];
    }

    const landing = buildProductLanding({
      title: p.title,
      description: p.description,
      salePrice: p.salePrice != null ? Number(p.salePrice) : null,
      currency: p.currency || 'COP',
      imageUrls,
      productId: p.id,
      shopifyUrl: p.externalId
        ? `https://${process.env.SHOPIFY_SHOP_DOMAIN || process.env.SHOPIFY_SHOP || 'shop'}.myshopify.com/products/...`
        : null,
    });

    return {
      mode: process.env.ECOM_MODE || 'MOCK',
      block: 90,
      phase: 'C',
      productId: p.id,
      landing,
      validation: {
        ok: landing.imageCount > 0 && landing.html.length > 200,
        issues: landing.imageCount ? [] : ['no_images'],
      },
      panel:
        landing.imageCount > 0
          ? { title: 'Landing OK', items: [] }
          : {
              title: 'Landing sin imágenes',
              items: [{ id: 'no_images', severity: 'warning', message: 'Sin URLs CJ' }],
            },
    };
  }

  @Post('landing')
  async landingPost(@Body() body: { productId?: string }) {
    if (!body?.productId) return { error: 'productId_required' };
    // reuse GET logic
    const ctrl = this as any;
    return this.landingGet(body.productId);
  }

  /**
   * Render slideshow MP4 from product frames or explicit frame URLs.
   */
  @Post('render-video')
  async renderVideo(
    @Body()
    body: {
      productId?: string;
      frames?: string[];
      secondsPerFrame?: number;
      role?: string;
    },
  ) {
    let frames = (body?.frames || []).filter((u) => typeof u === 'string');

    if (!frames.length && body?.productId) {
      const p = await prisma.product.findUnique({
        where: { id: body.productId },
        include: { suppliers: { orderBy: { isPrimary: 'desc' }, take: 1 } },
      });
      if (!p) return { error: 'not_found' };
      try {
        frames = await resolveCjImageUrls(p.title, p.suppliers?.[0]?.cjSku);
      } catch {
        frames = [];
      }
    }

    const result = await renderSlideshowMp4({
      frames,
      secondsPerFrame: body?.secondsPerFrame ?? 3,
      outName: `ecom-${body?.role || 'clip'}-${Date.now()}.mp4`,
    });

    const panelItems: any[] = [];
    if (result.status === 'SKIPPED_NO_FFMPEG') {
      panelItems.push({
        id: 'ffmpeg_missing',
        severity: 'warning',
        message: result.note || 'FFmpeg no instalado',
      });
    }
    if (result.status === 'FAILED') {
      panelItems.push({
        id: 'render_failed',
        severity: 'critical',
        message: result.error || 'render failed',
      });
    }
    if (result.status === 'SKIPPED_NO_FRAMES') {
      panelItems.push({
        id: 'no_frames',
        severity: 'warning',
        message: 'Sin frames para el video',
      });
    }

    return {
      mode: process.env.ECOM_MODE || 'MOCK',
      block: 92,
      phase: 'C',
      productId: body?.productId || null,
      role: body?.role || 'slideshow',
      framesRequested: frames.length,
      result,
      panel: panelItems.length
        ? { title: 'Render con avisos / errores', items: panelItems }
        : { title: 'Render MP4 OK', items: [] },
    };
  }
}
'''

if 'class PhaseCController' not in text:
    if 'class PhaseBController' in text:
        text = text.replace(
            "@Controller('phase-b')\nclass PhaseBController",
            CONTROLLER + "\n\n@Controller('phase-b')\nclass PhaseBController",
            1,
        )
    elif 'class PhaseAController' in text:
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

if 'PhaseCController,' not in text and 'PhaseCController' in text:
    if 'PhaseBController,' in text:
        text = text.replace(
            'controllers: [PhaseBController,',
            'controllers: [PhaseCController, PhaseBController,',
            1,
        )
    elif 'PhaseAController,' in text:
        text = text.replace(
            'controllers: [PhaseAController,',
            'controllers: [PhaseCController, PhaseAController,',
            1,
        )
    else:
        text = text.replace(
            'controllers: [AutonomyController,',
            'controllers: [PhaseCController, AutonomyController,',
            1,
        )

if 'block: 87,' in text:
    text = text.replace('block: 87,', 'block: 92,', 1)
elif 'block: 81,' in text:
    text = text.replace('block: 81,', 'block: 92,', 1)

for old in ['block-87 (phase-B branding)', 'block-81 (phase-A verify)', 'block-87 (phase-B branding)']:
    if old in text:
        text = text.replace(old, 'block-92 (phase-C landings+mp4)', 1)
        break

MAIN.write_text(text, encoding='utf-8')
print('Patched', MAIN)
print('PhaseCController:', 'class PhaseCController' in text)
print('PHASE_C_META:', 'PHASE_C_META' in text)

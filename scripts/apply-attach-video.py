#!/usr/bin/env python3
"""Wire POST /phase-c/attach-video — render + upload + attach to Shopify product."""
from pathlib import Path

MAIN = Path('apps/api/src/main.ts')
text = MAIN.read_text(encoding='utf-8')

IMP = "import { attachMediaToProduct } from '../../../packages/shopify/src/product-media';\n"

if 'attachMediaToProduct' not in text:
    if 'uploadLocalFileToShopify' in text:
        i = text.find("from '../../../packages/shopify/src/files'")
        end = text.find(';\n', i)
        text = text[: end + 2] + IMP + text[end + 2 :]
    elif "from '../../../packages/shopify/src/index'" in text:
        i = text.find("from '../../../packages/shopify/src/index'")
        end = text.find(';\n', i)
        text = text[: end + 2] + IMP + text[end + 2 :]

METHOD = r'''
  /**
   * Full path: frames → MP4 → Shopify Files → attach to product media.
   * Body: { productId, shopifyProductId?, frames?, role? }
   * If shopifyProductId omitted, uses Product.externalId from DB.
   */
  @Post('attach-video')
  async attachVideo(
    @Body()
    body: {
      productId?: string;
      shopifyProductId?: string;
      frames?: string[];
      role?: string;
      secondsPerFrame?: number;
      originalSource?: string;
    },
  ) {
    const panelItems: any[] = [];
    if (!body?.productId && !body?.shopifyProductId) {
      return { error: 'productId_or_shopifyProductId_required' };
    }

    let shopifyProductId = body.shopifyProductId;
    let frames = (body.frames || []).filter((u) => typeof u === 'string');
    let title = 'ECOM';

    if (body.productId) {
      const p = await prisma.product.findUnique({
        where: { id: body.productId },
        include: { suppliers: { orderBy: { isPrimary: 'desc' }, take: 1 } },
      });
      if (!p) return { error: 'not_found' };
      title = p.title;
      if (!shopifyProductId) shopifyProductId = p.externalId || undefined;
      if (!frames.length) {
        try {
          frames = await resolveCjImageUrls(p.title, p.suppliers?.[0]?.cjSku);
        } catch {
          frames = [];
        }
      }
    }

    if (!shopifyProductId) {
      panelItems.push({
        id: 'no_shopify_product',
        severity: 'critical',
        message: 'Producto sin externalId — publica/go-live primero',
      });
      return {
        mode: process.env.ECOM_MODE || 'MOCK',
        block: 94,
        panel: { title: 'Attach bloqueado', items: panelItems },
      };
    }

    let originalSource = body.originalSource;
    let render: any = null;
    let upload: any = null;

    if (!originalSource) {
      render = await renderSlideshowMp4({
        frames,
        secondsPerFrame: body.secondsPerFrame ?? 3,
        outName: `ecom-${body.role || 'clip'}-${Date.now()}.mp4`,
      });
      if (render.status !== 'READY' || !render.filePath) {
        panelItems.push({
          id: 'render_failed',
          severity: 'critical',
          message: render.error || render.status,
        });
        return {
          mode: process.env.ECOM_MODE || 'MOCK',
          block: 94,
          render,
          panel: { title: 'Attach bloqueado', items: panelItems },
        };
      }

      upload = await uploadLocalFileToShopify({
        filePath: render.filePath,
        filename: render.fileName,
        mimeType: 'video/mp4',
        resource: 'FILE',
      });
      if (!upload.ok) {
        panelItems.push({
          id: 'upload_failed',
          severity: 'critical',
          message: upload.error || 'upload failed',
        });
        return {
          mode: process.env.ECOM_MODE || 'MOCK',
          block: 94,
          render,
          upload,
          panel: { title: 'Attach bloqueado', items: panelItems },
        };
      }
      // Prefer resourceUrl from staged upload for productCreateMedia
      originalSource =
        (upload.raw as any)?.resourceUrl || upload.url || undefined;
    }

    if (!originalSource) {
      panelItems.push({
        id: 'no_source',
        severity: 'critical',
        message: 'Sin URL de video para adjuntar',
      });
      return {
        mode: process.env.ECOM_MODE || 'MOCK',
        block: 94,
        panel: { title: 'Attach bloqueado', items: panelItems },
      };
    }

    const attach = await attachMediaToProduct({
      productId: shopifyProductId,
      originalSource,
      mediaContentType: 'VIDEO',
      alt: title.slice(0, 100),
    });

    if (!attach.ok) {
      // Retry as IMAGE if VIDEO not accepted for this source type
      const attach2 = await attachMediaToProduct({
        productId: shopifyProductId,
        originalSource,
        mediaContentType: 'IMAGE',
        alt: title.slice(0, 100),
      });
      if (!attach2.ok) {
        panelItems.push({
          id: 'attach_failed',
          severity: 'critical',
          message: attach.error || attach2.error || 'attach failed',
        });
        return {
          mode: process.env.ECOM_MODE || 'MOCK',
          block: 94,
          render,
          upload,
          attach,
          attachRetry: attach2,
          panel: { title: 'Attach con errores', items: panelItems },
        };
      }
      return {
        mode: process.env.ECOM_MODE || 'MOCK',
        block: 94,
        phase: 'C',
        productId: body.productId || null,
        shopifyProductId,
        render,
        upload,
        attach: attach2,
        note: 'Adjuntado como IMAGE (fallback)',
        panel: { title: 'Video/media adjunto al producto', items: [] },
      };
    }

    return {
      mode: process.env.ECOM_MODE || 'MOCK',
      block: 94,
      phase: 'C',
      productId: body.productId || null,
      shopifyProductId,
      render,
      upload,
      attach,
      panel: { title: 'Video adjunto al producto', items: [] },
    };
  }
'''

if "@Post('attach-video')" not in text:
    marker = 'class PhaseCController {'
    if marker not in text:
        print('ERROR: PhaseCController missing')
        raise SystemExit(1)
    idx = text.find(marker)
    inserted = False
    for close in [
        "\n}\n\n@Controller('phase-b')",
        "\n}\n\n@Controller('phase-a')",
        "\n}\n\n@Controller('autonomy')",
    ]:
        pos = text.find(close, idx)
        if pos > 0:
            text = text[:pos] + '\n' + METHOD + text[pos:]
            inserted = True
            break
    if not inserted:
        text = text.replace(marker, marker + '\n' + METHOD, 1)

if 'block: 93,' in text:
    text = text.replace('block: 93,', 'block: 94,', 1)

MAIN.write_text(text, encoding='utf-8')
print('Patched', MAIN)
print('attach-video:', "@Post('attach-video')" in text)
print('attachMediaToProduct:', 'attachMediaToProduct' in text)

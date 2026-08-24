#!/usr/bin/env python3
"""Add POST /phase-c/upload-video: render MP4 if needed + upload to Shopify Files CDN."""
from pathlib import Path

MAIN = Path('apps/api/src/main.ts')
text = MAIN.read_text(encoding='utf-8')

IMP = "import { uploadLocalFileToShopify } from '../../../packages/shopify/src/files';\n"

if 'uploadLocalFileToShopify' not in text:
    if "from '../../../packages/shopify/src/index'" in text:
        i = text.find("from '../../../packages/shopify/src/index'")
        end = text.find(';\n', i)
        text = text[: end + 2] + IMP + text[end + 2 :]
    elif "from '../../../packages/phase-c/src/index'" in text:
        i = text.find("from '../../../packages/phase-c/src/index'")
        end = text.find(';\n', i)
        text = text[: end + 2] + IMP + text[end + 2 :]

METHOD = r'''
  /**
   * Render (optional) + upload MP4 to Shopify Files CDN.
   * Body: { productId?, frames?, filePath?, role?, secondsPerFrame? }
   */
  @Post('upload-video')
  async uploadVideo(
    @Body()
    body: {
      productId?: string;
      frames?: string[];
      filePath?: string;
      role?: string;
      secondsPerFrame?: number;
      filename?: string;
    },
  ) {
    const panelItems: any[] = [];
    let filePath = body?.filePath;
    let render: any = null;

    if (!filePath) {
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
      render = await renderSlideshowMp4({
        frames,
        secondsPerFrame: body?.secondsPerFrame ?? 3,
        outName: `ecom-${body?.role || 'clip'}-${Date.now()}.mp4`,
      });
      if (render.status !== 'READY' || !render.filePath) {
        if (render.status === 'SKIPPED_NO_FFMPEG') {
          panelItems.push({
            id: 'ffmpeg_missing',
            severity: 'warning',
            message: render.note || 'FFmpeg ausente',
          });
        } else {
          panelItems.push({
            id: 'render_failed',
            severity: 'critical',
            message: render.error || render.status,
          });
        }
        return {
          mode: process.env.ECOM_MODE || 'MOCK',
          block: 93,
          phase: 'C',
          render,
          upload: null,
          panel: { title: 'Upload bloqueado', items: panelItems },
        };
      }
      filePath = render.filePath;
    }

    const upload = await uploadLocalFileToShopify({
      filePath,
      filename: body?.filename || (render?.fileName as string) || undefined,
      mimeType: 'video/mp4',
      resource: 'FILE',
    });

    if (!upload.ok) {
      panelItems.push({
        id: 'shopify_upload_failed',
        severity: 'critical',
        message: upload.error || 'upload failed',
        detail: 'Asegura scope write_files en la app Shopify y reautoriza el token',
      });
    }

    return {
      mode: process.env.ECOM_MODE || 'MOCK',
      block: 93,
      phase: 'C',
      productId: body?.productId || null,
      role: body?.role || 'ugc_hook',
      render,
      upload,
      cdnUrl: upload.url || null,
      panel: panelItems.length
        ? { title: 'Upload con errores', items: panelItems }
        : { title: 'Video en Shopify Files / CDN', items: [] },
    };
  }
'''

if "@Post('upload-video')" not in text:
    # insert before closing of PhaseCController — find renderVideo method end is hard;
    # insert right after "class PhaseCController {"
    marker = 'class PhaseCController {'
    if marker not in text:
        print('ERROR: PhaseCController not found')
        raise SystemExit(1)
    # Prefer insert after first method meta() block — append before last }
    # of PhaseCController by finding "@Post('render-video')" and inserting after that whole method
    if "@Post('render-video')" in text:
        # Find the method and insert after its closing - use unique string near end of renderVideo return
        anchor = "panel: panelItems.length\n        ? { title: 'Render con avisos / errores', items: panelItems }\n        : { title: 'Render MP4 OK', items: [] },\n    };\n  }\n}"
        # PhaseCController might close after renderVideo - insert method before final }
 of controller
        idx = text.find("@Post('render-video')")
        if idx < 0:
            print('no render-video')
            raise SystemExit(1)
        # find end of renderVideo: next "\n  @" or "\n}" at class level after idx
        # Simple approach: insert METHOD before "\n}\n\n@Controller('phase-b')" or similar
        for close in [
            "\n}\n\n@Controller('phase-b')",
            "\n}\n\n@Controller('phase-a')",
            "\n}\n\n@Controller('autonomy')",
            "\n}\n\n@Controller('health')",
        ]:
            # only the PhaseC controller close - search from idx
            pos = text.find(close, idx)
            if pos > 0:
                text = text[:pos] + '\n' + METHOD + text[pos:]
                break
        else:
            # fallback: after class PhaseCController {
            text = text.replace(marker, marker + '\n' + METHOD, 1)
    else:
        text = text.replace(marker, marker + '\n' + METHOD, 1)

if 'block: 92,' in text:
    text = text.replace('block: 92,', 'block: 93,', 1)

MAIN.write_text(text, encoding='utf-8')
print('Patched', MAIN)
print('upload-video:', "@Post('upload-video')" in text)
print('uploadLocalFileToShopify:', 'uploadLocalFileToShopify' in text)

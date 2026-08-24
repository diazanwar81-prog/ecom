/**
 * Phase C — Landings por producto + render MP4 (blocks 88–92)
 * - Landing HTML por producto
 * - Render slideshow MP4 desde frames (FFmpeg si está en PATH)
 * - Auto-verify + panel de errores
 */

import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

export const PHASE_C_META = {
  name: 'phase-c',
  blocks: [88, 89, 90, 91, 92],
  title: 'Landings + render MP4',
};

export type PhaseSeverity = 'critical' | 'warning' | 'info';

export type PhaseCheck = {
  id: string;
  ok: boolean;
  severity: PhaseSeverity;
  message: string;
  detail?: string;
};

export function summarizePhaseC(items: PhaseCheck[]) {
  const criticalFailed = items.filter((i) => i.severity === 'critical' && !i.ok).length;
  const warnings = items.filter((i) => i.severity === 'warning' && !i.ok).length;
  const passed = items.filter((i) => i.ok).length;
  return {
    ok: criticalFailed === 0,
    criticalFailed,
    warnings,
    passed,
    total: items.length,
    score: items.length ? Math.round((passed / items.length) * 100) : 0,
    items,
  };
}

function escapeHtml(s: string): string {
  return String(s)
    .replace(/&/g, '&')
    .replace(/</g, '<')
    .replace(/>/g, '>')
    .replace(/"/g, '"');
}

function escapeAttr(s: string): string {
  return escapeHtml(s).replace(/'/g, '&#39;');
}

export type LandingInput = {
  title: string;
  description?: string | null;
  salePrice?: number | string | null;
  currency?: string;
  imageUrls?: string[];
  bullets?: string[];
  shopifyUrl?: string | null;
  productId?: string;
  countryCode?: string;
};

export type LandingResult = {
  html: string;
  heroUrl: string | null;
  imageCount: number;
  productName: string;
  pathHint: string;
};

/** Block 88–90: per-product landing HTML */
export function buildProductLanding(p: LandingInput): LandingResult {
  const price =
    p.salePrice != null
      ? `${p.currency || 'COP'} ${Number(p.salePrice).toLocaleString('es-CO')}`
      : 'Consultar';
  const desc =
    p.description ||
    `${p.title}. Envío a ${p.countryCode || 'CO'}. Compra segura.`;
  const imgs = (p.imageUrls || []).filter((u) => /^https?:\/\//i.test(u));
  const hero = imgs[0] || null;
  const gallery = imgs
    .map(
      (u, i) =>
        `<img src="${escapeAttr(u)}" alt="${escapeAttr(p.title)} ${i + 1}" style="width:100%;border-radius:12px;margin-bottom:8px"/>`,
    )
    .join('\n');
  const bullets = (p.bullets || [
    'Envío con seguimiento',
    'Pago seguro',
    'Soporte por la tienda',
  ])
    .map((b) => `<li>${escapeHtml(b)}</li>`)
    .join('');
  const cta = p.shopifyUrl
    ? `<a href="${escapeAttr(p.shopifyUrl)}" style="display:inline-block;background:#111;color:#fff;padding:14px 28px;border-radius:8px;text-decoration:none;font-weight:600">Comprar ahora</a>`
    : `<span style="color:#6b7280">Enlace de compra pendiente de publicación</span>`;

  const html = `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>${escapeHtml(p.title)} | ECOM</title>
<meta name="description" content="${escapeAttr(desc.slice(0, 160))}"/>
<style>
body{font-family:system-ui,-apple-system,sans-serif;margin:0;background:#fafafa;color:#111}
.wrap{max-width:720px;margin:0 auto;padding:24px}
.card{background:#fff;border-radius:16px;padding:24px;box-shadow:0 1px 3px rgba(0,0,0,.08)}
.price{font-size:1.5rem;font-weight:700;margin:12px 0}
h1{font-size:1.6rem;line-height:1.25}
</style>
</head>
<body>
<div class="wrap"><div class="card">
${gallery || (hero ? `<img src="${escapeAttr(hero)}" alt="" style="width:100%;border-radius:12px"/>` : '')}
<h1>${escapeHtml(p.title)}</h1>
<div class="price">${escapeHtml(price)}</div>
<p>${escapeHtml(desc)}</p>
<ul>${bullets}</ul>
<p style="margin-top:24px">${cta}</p>
</div>
<p style="text-align:center;color:#9ca3af;font-size:12px;margin-top:16px">ECOM landing · phase C</p>
</div></body></html>`;

  return {
    html,
    heroUrl: hero,
    imageCount: imgs.length,
    productName: p.title,
    pathHint: p.productId ? `/l/${p.productId}` : '/l/preview',
  };
}

export function ffmpegAvailable(): boolean {
  try {
    const r = spawnSync('ffmpeg', ['-version'], { encoding: 'utf8' });
    return r.status === 0;
  } catch {
    return false;
  }
}

export type RenderVideoInput = {
  frames: string[];
  /** seconds per frame */
  secondsPerFrame?: number;
  width?: number;
  height?: number;
  outName?: string;
  workDir?: string;
};

export type RenderVideoResult = {
  ok: boolean;
  mock: boolean;
  status: 'READY' | 'FAILED' | 'SKIPPED_NO_FFMPEG' | 'SKIPPED_NO_FRAMES';
  filePath?: string;
  fileName?: string;
  sizeBytes?: number;
  durationSec?: number;
  error?: string;
  note?: string;
  framesUsed?: number;
};

/**
 * Block 91–92: slideshow MP4 from frame URLs via FFmpeg.
 * Downloads frames to temp dir, builds concat demuxer list, encodes H.264.
 */
export async function renderSlideshowMp4(input: RenderVideoInput): Promise<RenderVideoResult> {
  const frames = (input.frames || []).filter((u) => /^https?:\/\//i.test(u));
  if (!frames.length) {
    return {
      ok: false,
      mock: false,
      status: 'SKIPPED_NO_FRAMES',
      error: 'no_frames',
      note: 'Necesitas al menos 1 frame (foto CJ)',
    };
  }

  if (!ffmpegAvailable()) {
    return {
      ok: true,
      mock: true,
      status: 'SKIPPED_NO_FFMPEG',
      framesUsed: frames.length,
      note:
        'FFmpeg no está en el PATH del contenedor. Spec de video lista; instala ffmpeg en la imagen API o renderiza fuera.',
    };
  }

  const work =
    input.workDir ||
    fs.mkdtempSync(path.join(os.tmpdir(), 'ecom-vid-'));
  const sec = Math.max(1, Number(input.secondsPerFrame) || 3);
  const w = input.width || 1080;
  const h = input.height || 1920;
  const fileName = input.outName || `ecom-${Date.now()}.mp4`;
  const outPath = path.join(work, fileName);
  const listPath = path.join(work, 'frames.txt');

  try {
    const localFiles: string[] = [];
    for (let i = 0; i < frames.length; i++) {
      const res = await fetch(frames[i]);
      if (!res.ok) continue;
      const buf = Buffer.from(await res.arrayBuffer());
      const fp = path.join(work, `frame-${String(i).padStart(3, '0')}.jpg`);
      fs.writeFileSync(fp, buf);
      localFiles.push(fp);
    }
    if (!localFiles.length) {
      return {
        ok: false,
        mock: false,
        status: 'FAILED',
        error: 'download_frames_failed',
      };
    }

    // concat demuxer: each image shown `sec` seconds
    const listBody = localFiles
      .map((f) => `file '${f.replace(/'/g, "'\\''")}'\nduration ${sec}`)
      .join('\n');
    // last frame must be repeated without duration for concat demuxer
    const listFinal =
      listBody +
      `\nfile '${localFiles[localFiles.length - 1].replace(/'/g, "'\\''")}'\n`;
    fs.writeFileSync(listPath, listFinal);

    const args = [
      '-y',
      '-f',
      'concat',
      '-safe',
      '0',
      '-i',
      listPath,
      '-vf',
      `scale=${w}:${h}:force_original_aspect_ratio=decrease,pad=${w}:${h}:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=30`,
      '-c:v',
      'libx264',
      '-pix_fmt',
      'yuv420p',
      '-movflags',
      '+faststart',
      outPath,
    ];

    const r = spawnSync('ffmpeg', args, { encoding: 'utf8', timeout: 120_000 });
    if (r.status !== 0 || !fs.existsSync(outPath)) {
      return {
        ok: false,
        mock: false,
        status: 'FAILED',
        error: (r.stderr || r.stdout || 'ffmpeg_failed').slice(0, 500),
        framesUsed: localFiles.length,
      };
    }

    const st = fs.statSync(outPath);
    return {
      ok: true,
      mock: false,
      status: 'READY',
      filePath: outPath,
      fileName,
      sizeBytes: st.size,
      durationSec: localFiles.length * sec,
      framesUsed: localFiles.length,
      note: 'MP4 slideshow generado con FFmpeg',
    };
  } catch (e: any) {
    return {
      ok: false,
      mock: false,
      status: 'FAILED',
      error: e?.message || 'render_exception',
    };
  }
}

export function buildPhaseCChecks(input: {
  mode: string;
  hasLandingBuilder: boolean;
  hasFfmpeg: boolean;
  landingsGenerated?: number;
  videosRendered?: number;
  publishedCount?: number;
}): PhaseCheck[] {
  const items: PhaseCheck[] = [];

  items.push({
    id: 'landing_builder',
    ok: input.hasLandingBuilder,
    severity: 'critical',
    message: input.hasLandingBuilder
      ? 'Builder de landing HTML por producto (88–90)'
      : 'Falta buildProductLanding',
  });

  items.push({
    id: 'ffmpeg',
    ok: true, // soft: warning if missing, not critical for sales path
    severity: input.hasFfmpeg ? 'info' : 'warning',
    message: input.hasFfmpeg
      ? 'FFmpeg disponible — render MP4 automático ON'
      : 'FFmpeg no está en el contenedor — render devolverá SKIPPED_NO_FFMPEG',
    detail: input.hasFfmpeg
      ? undefined
      : 'Añade ffmpeg a la imagen Docker del API para MP4 real',
  });

  items.push({
    id: 'render_endpoint',
    ok: true,
    severity: 'info',
    message: 'POST /phase-c/render-video { frames: [...] }',
  });

  items.push({
    id: 'landing_endpoint',
    ok: true,
    severity: 'info',
    message: 'GET /phase-c/landing/:productId · POST /phase-c/landing',
  });

  if (input.landingsGenerated != null) {
    items.push({
      id: 'landings_sample',
      ok: input.landingsGenerated > 0,
      severity: 'warning',
      message:
        input.landingsGenerated > 0
          ? `Landings generables (publicado/muestra: ${input.publishedCount ?? 0})`
          : 'Sin productos para landing de muestra',
    });
  }

  items.push({
    id: 'mode',
    ok: true,
    severity: 'info',
    message: `Modo ${input.mode}`,
  });

  return items;
}

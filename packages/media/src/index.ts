/**
 * ECOM Media — blocks 62–65
 * 62: image assets from mediaPlan.promptGen (MOCK by default)
 * 63: video assets plan + MOCK placeholders
 * 64: landing pack (HTML + asset refs)
 * 65: pre-sale / autonomy readiness checklist
 */

export type AssetRole =
  | 'hero_main'
  | 'lifestyle'
  | 'detail_closeup'
  | 'packshot_angle'
  | 'infographic'
  | 'ugc_hook'
  | 'descriptive'
  | string;

export type AssetKind = 'image' | 'video';

export type GeneratedAsset = {
  role: AssetRole;
  kind: AssetKind;
  status: 'READY' | 'ASSET_PENDING' | 'FAILED' | 'MOCK';
  url: string | null;
  aspectRatio?: string;
  promptGen?: string;
  negativePrompt?: string;
  durationHintSec?: number;
  provider: string;
  mock: boolean;
  note?: string;
};

export type MediaImageInput = {
  role: string;
  prompt?: string;
  promptGen?: string;
  aspectRatio?: string;
  negativePrompt?: string;
};

export type MediaVideoInput = {
  role: string;
  prompt?: string;
  promptGen?: string;
  aspectRatio?: string;
  negativePrompt?: string;
  durationHintSec?: number;
};

export type MediaPlanInput = {
  images?: MediaImageInput[];
  videos?: MediaVideoInput[];
  productSubjectEn?: string;
};

const PLACEHOLDER_IMG =
  'https://placehold.co/{w}x{h}/f3f4f6/111111/png?text={label}';

function dims(aspect: string | undefined): { w: number; h: number } {
  const a = aspect || '1:1';
  if (a === '4:5') return { w: 1080, h: 1350 };
  if (a === '9:16') return { w: 1080, h: 1920 };
  if (a === '16:9') return { w: 1920, h: 1080 };
  return { w: 1024, h: 1024 };
}

function mockImageUrl(role: string, aspect?: string): string {
  const { w, h } = dims(aspect);
  const label = encodeURIComponent(`ECOM+${role}`);
  return PLACEHOLDER_IMG.replace('{w}', String(w))
    .replace('{h}', String(h))
    .replace('{label}', label);
}

/** Block 62: generate image assets (MOCK in SANDBOX; live needs provider + flag). */
export function generateImageAssets(
  plan: MediaPlanInput,
  opts?: { forceLive?: boolean; productTitle?: string },
): { ok: boolean; mock: boolean; assets: GeneratedAsset[]; note: string } {
  const images = plan.images?.length
    ? plan.images
    : [
        { role: 'hero_main', aspectRatio: '1:1', promptGen: 'product hero' },
        { role: 'lifestyle', aspectRatio: '4:5', promptGen: 'lifestyle' },
        { role: 'detail_closeup', aspectRatio: '1:1', promptGen: 'detail' },
        { role: 'packshot_angle', aspectRatio: '1:1', promptGen: 'packshot' },
        { role: 'infographic', aspectRatio: '1:1', promptGen: 'infographic' },
      ];

  const liveRequested = Boolean(opts?.forceLive);
  const hasProvider = Boolean(
    process.env.ECOM_IMAGE_PROVIDER && process.env.ECOM_IMAGE_API_KEY,
  );

  // Never call paid providers from this package without explicit env + forceLive
  const useMock = !liveRequested || !hasProvider;

  const assets: GeneratedAsset[] = images.map((img) => ({
    role: img.role,
    kind: 'image' as const,
    status: useMock ? ('MOCK' as const) : ('ASSET_PENDING' as const),
    url: useMock ? mockImageUrl(img.role, img.aspectRatio) : null,
    aspectRatio: img.aspectRatio || '1:1',
    promptGen: img.promptGen || img.prompt,
    negativePrompt: img.negativePrompt,
    provider: useMock ? 'placeholder' : String(process.env.ECOM_IMAGE_PROVIDER),
    mock: useMock,
    note: useMock
      ? 'Placeholder SANDBOX — sin coste. Conecta ECOM_IMAGE_PROVIDER + forceLive para live.'
      : 'Provider configurado pero generación live diferida (bloque 62 seguro).',
  }));

  return {
    ok: true,
    mock: useMock,
    assets,
    note: useMock
      ? `Block 62 MOCK: ${assets.length} imágenes placeholder`
      : `Block 62: ${assets.length} slots listos (live gated)`,
  };
}

/** Block 63: video assets (MOCK placeholders; real gen later). */
export function generateVideoAssets(
  plan: MediaPlanInput,
  opts?: { forceLive?: boolean },
): { ok: boolean; mock: boolean; assets: GeneratedAsset[]; note: string } {
  const videos = plan.videos?.length
    ? plan.videos
    : [
        {
          role: 'ugc_hook',
          aspectRatio: '9:16',
          durationHintSec: 15,
          promptGen: 'ugc hook',
        },
        {
          role: 'descriptive',
          aspectRatio: '9:16',
          durationHintSec: 30,
          promptGen: 'product demo',
        },
      ];

  const useMock = true; // always mock until dedicated video provider block
  void opts;

  const assets: GeneratedAsset[] = videos.map((v) => ({
    role: v.role,
    kind: 'video' as const,
    status: 'ASSET_PENDING' as const,
    url: null,
    aspectRatio: v.aspectRatio || '9:16',
    promptGen: v.promptGen || v.prompt,
    negativePrompt: v.negativePrompt,
    durationHintSec: v.durationHintSec ?? 15,
    provider: 'none',
    mock: useMock,
    note: 'Video pending — script/prompt listo; render en bloque posterior o proveedor externo.',
  }));

  return {
    ok: true,
    mock: true,
    assets,
    note: `Block 63: ${assets.length} videos planificados (ASSET_PENDING)`,
  };
}

export type LandingPack = {
  html: string;
  heroUrl: string | null;
  imageCount: number;
  videoPending: number;
  productName: string;
};

/** Block 64: attach assets into a simple landing HTML pack. */
export function buildLandingPack(input: {
  title: string;
  description?: string;
  salePrice?: number | string | null;
  currency?: string;
  imageAssets?: GeneratedAsset[];
  videoAssets?: GeneratedAsset[];
  shopifyUrl?: string | null;
  countryCode?: string;
}): LandingPack {
  const hero =
    input.imageAssets?.find((a) => a.role === 'hero_main' && a.url)?.url ||
    input.imageAssets?.find((a) => a.url)?.url ||
    null;
  const gallery = (input.imageAssets || [])
    .filter((a) => a.url)
    .map(
      (a) =>
        `<figure style="margin:0"><img src="${escapeAttr(a.url!)}" alt="${escapeAttr(String(a.role))}" style="width:100%;border-radius:12px"/><figcaption style="font-size:12px;color:#6b7280">${escapeHtml(String(a.role))}</figcaption></figure>`,
    )
    .join('\n');
  const price =
    input.salePrice != null
      ? `${input.currency || 'COP'} ${Number(input.salePrice).toLocaleString('es-CO')}`
      : 'Consultar';
  const desc = input.description || input.title;
  const cta = input.shopifyUrl
    ? `<a href="${escapeAttr(input.shopifyUrl)}" style="display:inline-block;background:#111;color:#fff;padding:14px 28px;border-radius:8px;text-decoration:none;font-weight:600">Comprar ahora</a>`
    : `<span style="color:#6b7280">Enlace de compra pendiente</span>`;
  const videoNote =
    (input.videoAssets || []).filter((v) => v.status !== 'READY').length > 0
      ? `<p style="color:#9ca3af;font-size:13px">Videos: pendientes de render (bloque 63+)</p>`
      : '';

  const html = `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>${escapeHtml(input.title)} | ECOM</title>
<style>
body{font-family:system-ui,sans-serif;margin:0;background:#fafafa;color:#111}
.wrap{max-width:800px;margin:0 auto;padding:24px}
.grid{display:grid;gap:12px;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));margin:16px 0}
.price{font-size:1.5rem;font-weight:700}
.card{background:#fff;border-radius:16px;padding:24px;box-shadow:0 1px 3px rgba(0,0,0,.08)}
</style>
</head>
<body>
<div class="wrap"><div class="card">
${hero ? `<img src="${escapeAttr(hero)}" alt="" style="width:100%;border-radius:12px"/>` : ''}
<h1>${escapeHtml(input.title)}</h1>
<div class="price">${escapeHtml(price)}</div>
<p>${escapeHtml(desc)}</p>
<div class="grid">${gallery}</div>
${videoNote}
<p style="margin-top:24px">${cta}</p>
</div>
<p style="text-align:center;color:#9ca3af;font-size:12px;margin-top:16px">ECOM media pack · blocks 62–64</p>
</div></body></html>`;

  return {
    html,
    heroUrl: hero,
    imageCount: (input.imageAssets || []).filter((a) => a.url).length,
    videoPending: (input.videoAssets || []).filter((v) => v.status !== 'READY').length,
    productName: input.title,
  };
}

function escapeHtml(s: string): string {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function escapeAttr(s: string): string {
  return escapeHtml(s).replace(/'/g, '&#39;');
}

export type CheckItem = {
  id: string;
  ok: boolean;
  severity: 'critical' | 'warn' | 'info';
  message: string;
};

/** Block 65: pre-sale readiness (first real sale path). */
export function preSaleChecklist(input: {
  mode: string;
  shopifyLive: boolean;
  cjLive: boolean;
  httpsPublic: boolean;
  webhookSecret: boolean;
  publishedWithCj: number;
  pendingApprovals: number;
  hasMediaPlan?: boolean;
  hasImageMocks?: boolean;
  killSwitch?: boolean;
}): { ok: boolean; score: number; items: CheckItem[]; canAttemptFirstSale: boolean } {
  const items: CheckItem[] = [
    {
      id: 'shopify',
      ok: input.shopifyLive,
      severity: 'critical',
      message: input.shopifyLive ? 'Shopify live-ready' : 'Falta SHOPIFY_ACCESS_TOKEN / shop',
    },
    {
      id: 'cj',
      ok: input.cjLive,
      severity: 'critical',
      message: input.cjLive ? 'CJ live-ready' : 'Falta CJ_API_KEY / token',
    },
    {
      id: 'https',
      ok: input.httpsPublic,
      severity: 'critical',
      message: input.httpsPublic
        ? 'API_URL/APP_URL en HTTPS'
        : 'HTTPS público requerido para webhooks estables (no solo localhost)',
    },
    {
      id: 'webhook_secret',
      ok: input.webhookSecret,
      severity: 'warn',
      message: input.webhookSecret
        ? 'SHOPIFY_WEBHOOK_SECRET presente'
        : 'Configura SHOPIFY_WEBHOOK_SECRET para validar HMAC',
    },
    {
      id: 'catalog',
      ok: input.publishedWithCj > 0,
      severity: 'critical',
      message:
        input.publishedWithCj > 0
          ? `${input.publishedWithCj} publicado(s) con vínculo CJ`
          : 'Publica al menos 1 producto con cjVariantId/cjSku (go-live)',
    },
    {
      id: 'approvals',
      ok: input.pendingApprovals < 20,
      severity: 'warn',
      message: `PENDING_APPROVAL: ${input.pendingApprovals}`,
    },
    {
      id: 'media_plan',
      ok: input.hasMediaPlan !== false,
      severity: 'info',
      message: 'Media plan (bloque 61) disponible vía /creative/brief',
    },
    {
      id: 'images',
      ok: input.hasImageMocks !== false,
      severity: 'info',
      message: 'Imágenes MOCK ok para prueba; live image provider opcional',
    },
    {
      id: 'kill_switch',
      ok: !input.killSwitch,
      severity: 'critical',
      message: input.killSwitch ? 'Kill switch ACTIVO' : 'Kill switch off',
    },
    {
      id: 'mode',
      ok: true,
      severity: 'info',
      message: `Modo actual: ${input.mode} (REAL solo con ECOM_REAL_CONFIRM)`,
    },
  ];

  const criticalFailed = items.filter((i) => i.severity === 'critical' && !i.ok).length;
  const passed = items.filter((i) => i.ok).length;
  const score = Math.round((passed / items.length) * 100);
  const canAttemptFirstSale =
    criticalFailed === 0 && input.publishedWithCj > 0 && input.shopifyLive && input.cjLive;

  return {
    ok: criticalFailed === 0,
    score,
    items,
    canAttemptFirstSale,
  };
}

export const MEDIA_META = {
  block: 65,
  range: '62-65',
  features: [
    'image_assets_mock',
    'video_assets_pending',
    'landing_pack',
    'pre_sale_checklist',
  ],
  note: '62 imágenes MOCK · 63 videos PENDING · 64 landing pack · 65 checklist primera venta',
};

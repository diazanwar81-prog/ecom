/**
 * Phase B — Branding completo (blocks 82–87)
 * 82 CJ image normalize
 * 83 4 product photos
 * 84 1 descriptive/lifestyle
 * 85 2 video slots
 * 86 strong ES copy
 * 87 media ready for Shopify go-live
 */

export const PHASE_B_META = {
  name: 'phase-b',
  blocks: [82, 83, 84, 85, 86, 87],
  title: 'Branding completo · media + copy ES',
};

export type PhaseSeverity = 'critical' | 'warning' | 'info';

export type PhaseCheck = {
  id: string;
  ok: boolean;
  severity: PhaseSeverity;
  message: string;
  detail?: string;
};

export function summarizePhaseB(items: PhaseCheck[]) {
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

/** Normalize supplier title into commercial ES-friendly short label (UI helper). */
export function cleanBrandTitle(raw?: string | null): string {
  if (!raw) return 'Producto';
  let t = String(raw)
    .replace(/^\[(SERPER\+CJ|SERPER|CJ|MOCK)\]\s*/i, '')
    .replace(
      /\b(Cross-Border|Dropshipping|Hot-Selling|Oem And|Fashion|Elegant|Light Luxury|Versatile|Decorative|High-End|European And American Style)\b/gi,
      '',
    )
    .replace(/\s+/g, ' ')
    .trim();
  if (t.length > 80) t = t.slice(0, 77).trim() + '…';
  return t || 'Producto';
}

export function filterHttpsImages(urls: string[], max = 5): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const u of urls || []) {
    if (typeof u !== 'string') continue;
    const s = u.trim();
    if (!/^https?:\/\//i.test(s)) continue;
    if (seen.has(s)) continue;
    seen.add(s);
    out.push(s);
    if (out.length >= max) break;
  }
  return out;
}

export type BrandMediaSlot = {
  role: string;
  kind: 'image' | 'video';
  status: 'READY' | 'MOCK' | 'ASSET_PENDING' | 'FAILED';
  url: string | null;
  aspectRatio?: string;
  note?: string;
};

/**
 * Build branding media slots from CJ URLs + plan.
 * Uses real CJ images when available; fills remaining with labeled placeholders.
 */
export function buildBrandMediaSlots(input: {
  cjImageUrls?: string[];
  productLabel?: string;
}): { images: BrandMediaSlot[]; videos: BrandMediaSlot[]; imageUrlsForShopify: string[] } {
  const cj = filterHttpsImages(input.cjImageUrls || [], 5);
  const label = encodeURIComponent((input.productLabel || 'ECOM').slice(0, 24));

  const roles = ['hero_main', 'lifestyle', 'detail_closeup', 'packshot_angle', 'descriptive'] as const;
  const images: BrandMediaSlot[] = roles.map((role, i) => {
    const url =
      cj[i] ||
      `https://placehold.co/1024x1024/f3f4f6/111111/png?text=${label}+${role}`;
    const fromCj = Boolean(cj[i]);
    return {
      role,
      kind: 'image' as const,
      status: fromCj ? ('READY' as const) : ('MOCK' as const),
      url,
      aspectRatio: role === 'lifestyle' ? '4:5' : '1:1',
      note: fromCj ? 'CJ catalog image' : 'Placeholder hasta imagen CJ o provider',
    };
  });

  const videos: BrandMediaSlot[] = [
    {
      role: 'ugc_hook',
      kind: 'video',
      status: 'ASSET_PENDING',
      url: null,
      aspectRatio: '9:16',
      note: 'Slot video 15s — render externo pendiente',
    },
    {
      role: 'descriptive',
      kind: 'video',
      status: 'ASSET_PENDING',
      url: null,
      aspectRatio: '9:16',
      note: 'Slot video 30s — render externo pendiente',
    },
  ];

  // Shopify prefers real product images first
  const imageUrlsForShopify = [
    ...cj,
    ...images.filter((a) => a.status === 'MOCK' && a.url).map((a) => a.url!),
  ].slice(0, 5);

  return { images, videos, imageUrlsForShopify: filterHttpsImages(imageUrlsForShopify, 5) };
}

export function validateBrandPack(input: {
  title?: string;
  description?: string;
  bullets?: string[];
  images?: BrandMediaSlot[];
  videos?: BrandMediaSlot[];
  imageUrlsForShopify?: string[];
}): { ok: boolean; issues: string[] } {
  const issues: string[] = [];
  if (!input.title || input.title.length < 8) issues.push('title_too_short');
  if (!input.description || input.description.length < 40) issues.push('description_too_short');
  if (/\[(CJ|MOCK|SERPER)/i.test(input.title || '')) issues.push('title_has_supplier_prefix');
  if (/cross-border|dropshipping/i.test(input.title || '')) issues.push('title_has_supplier_jargon');
  const readyImgs = (input.images || []).filter((i) => i.url).length;
  if (readyImgs < 4) issues.push('images_lt_4');
  if ((input.videos || []).length < 2) issues.push('videos_slots_lt_2');
  if (!(input.imageUrlsForShopify || []).length) issues.push('no_shopify_image_urls');
  const hard = issues.filter((i) => !['title_has_supplier_jargon'].includes(i));
  return { ok: hard.length === 0, issues };
}

export function buildPhaseBChecks(input: {
  mode: string;
  hasCreativeBrief: boolean;
  hasMediaPlan: boolean;
  hasImagePipeline: boolean;
  hasVideoSlots: boolean;
  hasCjImageResolver: boolean;
  productsWithDescription: number;
  productsTotal: number;
  publishedWithImagesHint: number;
  brandPackOkSample?: boolean;
}): PhaseCheck[] {
  const items: PhaseCheck[] = [];

  items.push({
    id: 'cj_image_pipeline',
    ok: input.hasCjImageResolver,
    severity: 'critical',
    message: input.hasCjImageResolver
      ? 'Resolver de imágenes CJ disponible (bloque 82)'
      : 'Falta resolveCjImageUrls / pipeline CJ images',
  });

  items.push({
    id: 'image_assets',
    ok: input.hasImagePipeline,
    severity: 'critical',
    message: input.hasImagePipeline
      ? 'Pipeline 4+ fotos de producto (hero/lifestyle/detail/packshot)'
      : 'Falta generateImageAssets / brand media slots',
  });

  items.push({
    id: 'descriptive_image',
    ok: input.hasImagePipeline,
    severity: 'warning',
    message: 'Slot imagen descriptiva / lifestyle incluido en plan de 5',
  });

  items.push({
    id: 'video_slots',
    ok: input.hasVideoSlots,
    severity: 'warning',
    message: input.hasVideoSlots
      ? '2 slots de video (ugc_hook + descriptive) planificados'
      : 'Faltan slots de video',
    detail: 'Render real de video sigue ASSET_PENDING (sin proveedor de video)',
  });

  items.push({
    id: 'creative_brief',
    ok: input.hasCreativeBrief,
    severity: 'critical',
    message: input.hasCreativeBrief
      ? 'Copy branding ES (creative brief) disponible'
      : 'Falta generateCreativeBrief',
  });

  items.push({
    id: 'media_plan',
    ok: input.hasMediaPlan,
    severity: 'critical',
    message: input.hasMediaPlan
      ? 'Media plan 5 img + 2 vid con promptGen'
      : 'Falta defaultMediaPlan',
  });

  items.push({
    id: 'descriptions_in_db',
    ok: input.productsWithDescription > 0 || input.productsTotal === 0,
    severity: 'warning',
    message:
      input.productsWithDescription > 0
        ? `${input.productsWithDescription}/${input.productsTotal} productos con description`
        : 'Ningún producto con description — corre /phase-b/brand o Copy IA',
  });

  items.push({
    id: 'shopify_media_path',
    ok: true,
    severity: 'info',
    message: 'Go-live acepta imageUrls → Shopify Admin API',
  });

  if (input.brandPackOkSample != null) {
    items.push({
      id: 'sample_brand_pack',
      ok: input.brandPackOkSample,
      severity: 'warning',
      message: input.brandPackOkSample
        ? 'Sample brand pack validó OK'
        : 'Sample brand pack con issues (revisar /phase-b/brand)',
    });
  }

  items.push({
    id: 'mode',
    ok: true,
    severity: 'info',
    message: `Modo ${input.mode} — imágenes MOCK/CJ sin coste de image provider`,
  });

  return items;
}

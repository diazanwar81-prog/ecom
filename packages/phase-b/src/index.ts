/**
 * Phase B — Branding completo (blocks 82–87) + harden post-brand
 * - Clean ES copy (strip supplier title leaks)
 * - Never send placehold.co to Shopify
 * - Video slots with storyboard text (render still external)
 */

export const PHASE_B_META = {
  name: 'phase-b',
  blocks: [82, 83, 84, 85, 86, 87],
  title: 'Branding completo · media + copy ES',
  polish: 'b2-copy-shopify-filter-video-storyboard',
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

/** Normalize supplier title into commercial ES-friendly short label. */
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

/** True if URL is a placeholder (must never go to live Shopify). */
export function isPlaceholderImageUrl(url: string): boolean {
  const u = String(url || '').toLowerCase();
  return (
    u.includes('placehold.co') ||
    u.includes('placeholder.com') ||
    u.includes('via.placeholder') ||
    u.includes('dummyimage.com') ||
    u.includes('picsum.photos')
  );
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

/** Only real catalog/CDN images for Shopify publish. */
export function filterShopifyOnlyImages(urls: string[], max = 5): string[] {
  return filterHttpsImages(urls, max * 2)
    .filter((u) => !isPlaceholderImageUrl(u))
    .slice(0, max);
}

/**
 * Second-pass copy: drop supplier title echoes, duplicate phrases, English leaks.
 */
export function polishBrandDescription(input: {
  description?: string | null;
  productName?: string | null;
  title?: string | null;
  rawSupplierTitle?: string | null;
}): string {
  let d = String(input.description || '').trim();
  const supplier = cleanBrandTitle(input.rawSupplierTitle || '');
  const productName = String(input.productName || '').trim();
  const title = String(input.title || '').trim();

  // Remove repeated supplier title chunks (e.g. "Enrollador De Reloj,Enrollador De Reloj…")
  if (supplier && supplier.length >= 8) {
    const esc = supplier.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    d = d.replace(new RegExp(esc, 'gi'), '');
    // first 3 meaningful words of supplier title
    const head = supplier
      .split(/[\s,]+/)
      .filter((w) => w.length > 3)
      .slice(0, 3)
      .join(' ');
    if (head.length >= 6) {
      d = d.replace(new RegExp(head.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'), '');
    }
  }

  d = d
    .replace(/\b(cross-border|dropshipping|hot-selling|oem and)\b/gi, '')
    .replace(/,{2,}/g, ',')
    .replace(/\.{2,}/g, '.')
    .replace(/\s{2,}/g, ' ')
    .replace(/^[,\.\s…]+/, '')
    .replace(/\s+([,\.])/g, '$1')
    .trim();

  // If still too short or starts with leftover junk, rebuild
  if (d.length < 60 || /^(para quien|listo cuando)/i.test(d)) {
    const name = productName || title || 'Este producto';
    d =
      `${name} pensado para uso diario en Colombia. ` +
      `Fácil de usar, con presencia cuidada y listo para regalar. ` +
      `Envío con seguimiento. Revisa medidas y material en la ficha antes de comprar.`;
  }

  // Avoid starting with ellipsis / comma fragments
  d = d.replace(/^[…,\.\s]+/, '').trim();
  if (d.length > 0) {
    d = d.charAt(0).toUpperCase() + d.slice(1);
  }
  return d.slice(0, 2000);
}

export type BrandMediaSlot = {
  role: string;
  kind: 'image' | 'video';
  status: 'READY' | 'MOCK' | 'ASSET_PENDING' | 'FAILED';
  url: string | null;
  aspectRatio?: string;
  note?: string;
  storyboard?: string[];
  durationHintSec?: number;
};

/**
 * Build branding media slots from CJ URLs + plan.
 * imageUrlsForShopify = only real (non-placeholder) URLs.
 */
export function buildBrandMediaSlots(input: {
  cjImageUrls?: string[];
  productLabel?: string;
  includePlaceholders?: boolean;
}): {
  images: BrandMediaSlot[];
  videos: BrandMediaSlot[];
  imageUrlsForShopify: string[];
  placeholderCount: number;
  realImageCount: number;
} {
  const cj = filterShopifyOnlyImages(input.cjImageUrls || [], 5);
  const label = encodeURIComponent((input.productLabel || 'ECOM').slice(0, 24));
  const allowPh = input.includePlaceholders !== false;

  const roles = ['hero_main', 'lifestyle', 'detail_closeup', 'packshot_angle', 'descriptive'] as const;
  const images: BrandMediaSlot[] = roles.map((role, i) => {
    if (cj[i]) {
      return {
        role,
        kind: 'image' as const,
        status: 'READY' as const,
        url: cj[i],
        aspectRatio: role === 'lifestyle' ? '4:5' : '1:1',
        note: 'CJ catalog image',
      };
    }
    if (!allowPh) {
      return {
        role,
        kind: 'image' as const,
        status: 'ASSET_PENDING' as const,
        url: null,
        aspectRatio: role === 'lifestyle' ? '4:5' : '1:1',
        note: 'Sin imagen CJ — no se usa placeholder en publish live',
      };
    }
    return {
      role,
      kind: 'image' as const,
      status: 'MOCK' as const,
      url: `https://placehold.co/1024x1024/f3f4f6/111111/png?text=${label}+${role}`,
      aspectRatio: role === 'lifestyle' ? '4:5' : '1:1',
      note: 'Placeholder solo UI/preview — excluido de Shopify',
    };
  });

  const name = (input.productLabel || 'producto').slice(0, 40);
  const videos: BrandMediaSlot[] = [
    {
      role: 'ugc_hook',
      kind: 'video',
      status: 'ASSET_PENDING',
      url: null,
      aspectRatio: '9:16',
      durationHintSec: 15,
      note: 'Render externo pendiente — storyboard listo',
      storyboard: [
        `0-3s: Close-up del ${name} en uso (gancho visual)`,
        `3-8s: Manos / producto completo, luz natural`,
        `8-12s: Beneficio clave en texto ES (subtítulo)`,
        `12-15s: CTA "Disponible ahora" + producto centrado`,
      ],
    },
    {
      role: 'descriptive',
      kind: 'video',
      status: 'ASSET_PENDING',
      url: null,
      aspectRatio: '9:16',
      durationHintSec: 30,
      note: 'Render externo pendiente — storyboard listo',
      storyboard: [
        `0-5s: Hero del ${name} sobre fondo limpio`,
        `5-15s: 2-3 detalles (ángulo, textura, uso)`,
        `15-25s: Contexto real (escritorio / regalo / mesa)`,
        `25-30s: CTA + recordatorio envío con seguimiento`,
      ],
    },
  ];

  const imageUrlsForShopify = filterShopifyOnlyImages(cj, 5);
  const placeholderCount = images.filter((a) => a.status === 'MOCK').length;
  const realImageCount = images.filter((a) => a.status === 'READY').length;

  return { images, videos, imageUrlsForShopify, placeholderCount, realImageCount };
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
  // Supplier title echo in description (e.g. repeated "Enrollador De Reloj")
  if (/([A-Za-zÁÉÍÓÚáéíóúñÑ]{4,})(?:\s*[,…]\s*|\s+)\1/i.test(input.description || '')) {
    issues.push('description_supplier_echo');
  }
  const shopifyImgs = input.imageUrlsForShopify || [];
  if (shopifyImgs.some(isPlaceholderImageUrl)) issues.push('shopify_has_placeholder');
  const readyImgs = (input.images || []).filter((i) => i.status === 'READY' && i.url).length;
  if (readyImgs < 1 && shopifyImgs.length < 1) issues.push('no_real_images');
  if ((input.videos || []).length < 2) issues.push('videos_slots_lt_2');
  // Soft: placeholders OK for preview; hard fail only if shopify gets them
  const hard = issues.filter(
    (i) => !['title_has_supplier_jargon', 'description_supplier_echo'].includes(i),
  );
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
  shopifyFiltersPlaceholders?: boolean;
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
    id: 'shopify_no_placeholder',
    ok: input.shopifyFiltersPlaceholders !== false,
    severity: 'critical',
    message: 'Shopify solo recibe URLs reales (sin placehold.co)',
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
      ? '2 slots de video con storyboard (render externo pendiente)'
      : 'Faltan slots de video',
    detail: 'No bloquea go-live; storyboard listo para CapCut/editor',
  });

  items.push({
    id: 'creative_brief',
    ok: input.hasCreativeBrief,
    severity: 'critical',
    message: input.hasCreativeBrief
      ? 'Copy branding ES + polishBrandDescription'
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
    message: 'Go-live acepta imageUrls filtradas → Shopify Admin API',
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
    message: `Modo ${input.mode} — placeholders solo preview, nunca Shopify`,
  });

  return items;
}

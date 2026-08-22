/**
 * ECOM Content
 * - Block 29: landing HTML
 * - Block 61: creative product brief (nombre, título, descripción, bullets, SEO, plan media)
 */

import { complete, type AiResponse } from '../../ai-router/src/index';

export type AssetStatus = 'READY' | 'ASSET_PENDING' | 'FAILED' | 'REUSED';

export type ProductLandingInput = {
  title: string;
  description?: string | null;
  salePrice?: number | string | null;
  currency?: string;
  imageUrl?: string | null;
  shopifyUrl?: string | null;
  benefits?: string[];
  countryCode?: string;
};

export function buildLandingHtml(p: ProductLandingInput): string {
  const price =
    p.salePrice != null
      ? `${p.currency || 'COP'} ${Number(p.salePrice).toLocaleString('es-CO')}`
      : 'Consultar';
  const desc =
    p.description ||
    `${p.title}. Envío a ${p.countryCode || 'CO'}. Compra segura vía Shopify.`;
  const benefits = (p.benefits || [
    'Envío con seguimiento',
    'Pago seguro',
    'Soporte por la tienda',
  ])
    .map((b) => `<li>${escapeHtml(b)}</li>`)
    .join('');
  const img = p.imageUrl
    ? `<img src="${escapeAttr(p.imageUrl)}" alt="${escapeAttr(p.title)}" style="max-width:100%;border-radius:12px"/>`
    : `<div style="padding:48px;background:#f3f4f6;border-radius:12px;text-align:center;color:#6b7280">Imagen pendiente</div>`;
  const cta = p.shopifyUrl
    ? `<a href="${escapeAttr(p.shopifyUrl)}" style="display:inline-block;background:#111;color:#fff;padding:14px 28px;border-radius:8px;text-decoration:none;font-weight:600">Comprar ahora</a>`
    : `<span style="color:#6b7280">Enlace de compra pendiente</span>`;

  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1"/>
  <title>${escapeHtml(p.title)} | ECOM</title>
  <meta name="description" content="${escapeAttr(desc.slice(0, 160))}"/>
  <style>
    body{font-family:system-ui,-apple-system,sans-serif;margin:0;background:#fafafa;color:#111}
    .wrap{max-width:720px;margin:0 auto;padding:24px}
    h1{font-size:1.75rem;line-height:1.25;margin:16px 0}
    .price{font-size:1.5rem;font-weight:700;margin:12px 0}
    .card{background:#fff;border-radius:16px;padding:24px;box-shadow:0 1px 3px rgba(0,0,0,.08)}
  </style>
</head>
<body>
  <div class="wrap">
    <div class="card">
      ${img}
      <h1>${escapeHtml(p.title)}</h1>
      <div class="price">${escapeHtml(price)}</div>
      <p>${escapeHtml(desc)}</p>
      <ul>${benefits}</ul>
      <p style="margin-top:24px">${cta}</p>
    </div>
    <p style="text-align:center;color:#9ca3af;font-size:12px;margin-top:24px">Generado por ECOM · content</p>
  </div>
</body>
</html>`;
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

export function assetStatusForVideo(hasProvider: boolean): AssetStatus {
  return hasProvider ? 'READY' : 'ASSET_PENDING';
}

// ─── Block 61: Creative brief ───────────────────────────────────────────────

export type CreativeBriefInput = {
  rawTitle: string;
  facts?: string;
  category?: string;
  countryCode?: string;
  currency?: string;
  salePrice?: number;
  language?: string;
  /** If true, skip live AI and use deterministic mock brief */
  forceMock?: boolean;
};

export type MediaPlan = {
  images: { role: string; prompt: string }[];
  videos: { role: string; prompt: string; durationHintSec: number }[];
};

export type CreativeBrief = {
  productName: string;
  title: string;
  description: string;
  bullets: string[];
  importantInfo: string[];
  seo: { metaTitle: string; metaDescription: string; tags: string[] };
  mediaPlan: MediaPlan;
  language: string;
  source: 'ai' | 'mock';
  provider?: string;
  model?: string;
  rawText?: string;
};

function cleanTitle(raw: string): string {
  return String(raw || '')
    .replace(/\[.*?\]/g, '')
    .replace(/\b(SERPER\+?CJ|MOCK|CJ)\b/gi, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120);
}

function mockBrief(input: CreativeBriefInput): CreativeBrief {
  const base = cleanTitle(input.rawTitle) || 'Producto ECOM';
  const short = base.length > 60 ? base.slice(0, 57) + '…' : base;
  const bullets = [
    'Diseño práctico para uso diario',
    'Materiales seleccionados para durabilidad',
    'Fácil de integrar en tu rutina',
    `Envío con seguimiento a ${input.countryCode || 'CO'}`,
  ];
  return {
    productName: short,
    title: short,
    description:
      `${short} pensado para quienes buscan calidad y practicidad. ` +
      `Ideal como regalo o uso personal. ` +
      (input.facts ? `Detalles: ${input.facts.slice(0, 180)}. ` : '') +
      `Compra segura y envío con seguimiento.`,
    bullets,
    importantInfo: [
      'Verificar medidas/colores en la ficha antes de comprar',
      'Tiempos de envío internacional pueden variar',
      'No se hacen afirmaciones médicas ni de resultados garantizados',
    ],
    seo: {
      metaTitle: `${short} | Tienda ECOM`,
      metaDescription: `${short}. Envío a ${input.countryCode || 'CO'}. Compra segura.`,
      tags: ['ecom', 'dropshipping', (input.category || 'general').toLowerCase()],
    },
    mediaPlan: defaultMediaPlan(short),
    language: input.language || 'es-CO',
    source: 'mock',
  };
}

export function defaultMediaPlan(productName: string): MediaPlan {
  const n = productName.slice(0, 80);
  return {
    images: [
      {
        role: 'hero_main',
        prompt: `Foto de producto profesional de ${n}, fondo limpio, iluminación de estudio, centrado, e-commerce`,
      },
      {
        role: 'lifestyle',
        prompt: `Persona usando ${n} en contexto realista cotidiano, luz natural, estilo UGC premium`,
      },
      {
        role: 'detail_closeup',
        prompt: `Primer plano de textura y detalles de ${n}, macro, nitidez alta`,
      },
      {
        role: 'packshot_angle',
        prompt: `Ángulo alterno de ${n} sobre superficie neutra, sombra suave`,
      },
      {
        role: 'infographic',
        prompt: `Infografía limpia de beneficios de ${n}, iconos simples, texto legible en español, fondo blanco`,
      },
    ],
    videos: [
      {
        role: 'ugc_hook',
        prompt: `Video corto vertical 9:16 de ${n}, hook en 3s, demostración rápida, subtítulos ES`,
        durationHintSec: 15,
      },
      {
        role: 'descriptive',
        prompt: `Video descriptivo de ${n}: características, uso y CTA final, 9:16, subtítulos ES`,
        durationHintSec: 30,
      },
    ],
  };
}

function tryParseJsonBrief(text: string): Partial<CreativeBrief> | null {
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) return null;
  try {
    return JSON.parse(m[0]);
  } catch {
    return null;
  }
}

export async function generateCreativeBrief(input: CreativeBriefInput): Promise<{
  ok: boolean;
  brief: CreativeBrief;
  ai?: AiResponse;
}> {
  if (input.forceMock || process.env.ECOM_MODE === 'MOCK') {
    return { ok: true, brief: mockBrief(input) };
  }

  const lang = input.language || 'es-CO';
  const system =
    'Eres director creativo de e-commerce para Colombia (es-CO). ' +
    'Responde SOLO con JSON válido, sin markdown. Esquema: ' +
    '{
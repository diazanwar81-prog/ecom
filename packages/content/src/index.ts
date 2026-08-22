/**
 * ECOM Content
 * - Block 29: landing HTML
 * - Block 61: creative product brief
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
  const benefits = (p.benefits || ['Envío con seguimiento', 'Pago seguro', 'Soporte por la tienda'])
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

export type CreativeBriefInput = {
  rawTitle: string;
  facts?: string;
  category?: string;
  countryCode?: string;
  currency?: string;
  salePrice?: number;
  language?: string;
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

export function defaultMediaPlan(productName: string): MediaPlan {
  const n = productName.slice(0, 80);
  return {
    images: [
      {
        role: 'hero_main',
        prompt: `Foto de producto profesional de ${n}, fondo limpio, iluminacion de estudio, centrado, e-commerce`,
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
        prompt: `Angulo alterno de ${n} sobre superficie neutra, sombra suave`,
      },
      {
        role: 'infographic',
        prompt: `Infografia limpia de beneficios de ${n}, iconos simples, texto legible en espanol, fondo blanco`,
      },
    ],
    videos: [
      {
        role: 'ugc_hook',
        prompt: `Video corto vertical 9:16 de ${n}, hook en 3s, demostracion rapida, subtitulos ES`,
        durationHintSec: 15,
      },
      {
        role: 'descriptive',
        prompt: `Video descriptivo de ${n}: caracteristicas, uso y CTA final, 9:16, subtitulos ES`,
        durationHintSec: 30,
      },
    ],
  };
}

function mockBrief(input: CreativeBriefInput): CreativeBrief {
  const base = cleanTitle(input.rawTitle) || 'Producto ECOM';
  const short = base.length > 60 ? base.slice(0, 57) + '...' : base;
  const bullets = [
    'Diseno practico para uso diario',
    'Materiales seleccionados para durabilidad',
    'Facil de integrar en tu rutina',
    `Envio con seguimiento a ${input.countryCode || 'CO'}`,
  ];
  return {
    productName: short,
    title: short,
    description:
      `${short} pensado para quienes buscan calidad y practicidad. ` +
      `Ideal como regalo o uso personal. ` +
      (input.facts ? `Detalles: ${input.facts.slice(0, 180)}. ` : '') +
      `Compra segura y envio con seguimiento.`,
    bullets,
    importantInfo: [
      'Verificar medidas/colores en la ficha antes de comprar',
      'Tiempos de envio internacional pueden variar',
      'No se hacen afirmaciones medicas ni de resultados garantizados',
    ],
    seo: {
      metaTitle: `${short} | Tienda ECOM`,
      metaDescription: `${short}. Envio a ${input.countryCode || 'CO'}. Compra segura.`,
      tags: ['ecom', 'dropshipping', (input.category || 'general').toLowerCase()],
    },
    mediaPlan: defaultMediaPlan(short),
    language: input.language || 'es-CO',
    source: 'mock',
  };
}

function tryParseJsonBrief(text: string): any | null {
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
  if (input.forceMock) {
    return { ok: true, brief: mockBrief(input) };
  }

  const lang = input.language || 'es-CO';
  const system =
    'Eres director creativo de e-commerce para Colombia (es-CO). ' +
    'Responde SOLO con JSON valido, sin markdown. Campos: ' +
    'productName, title, description, bullets (array 4), importantInfo (array 3), ' +
    'seo: {metaTitle, metaDescription, tags}. Sin promesas medicas.';

  const user =
    `Producto crudo: ${input.rawTitle}\n` +
    `Categoria: ${input.category || 'general'}\n` +
    `Pais: ${input.countryCode || 'CO'}\n` +
    `Precio: ${input.salePrice != null ? input.salePrice + ' ' + (input.currency || 'COP') : 'n/a'}\n` +
    `Hechos: ${input.facts || 'n/a'}\n` +
    `Idioma: ${lang}`;

  const ai = await complete({
    task: 'copy',
    temperature: 0.5,
    maxTokens: 900,
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
  });

  const parsed = ai.ok ? tryParseJsonBrief(ai.text) : null;
  if (!parsed || !parsed.title) {
    const fallback = mockBrief(input);
    return {
      ok: true,
      brief: {
        ...fallback,
        source: ai.mock ? 'mock' : 'mock',
        provider: ai.provider,
        model: ai.model,
        rawText: ai.text,
      },
      ai,
    };
  }

  const productName = String(parsed.productName || parsed.title || cleanTitle(input.rawTitle)).slice(0, 80);
  const title = String(parsed.title || productName).slice(0, 120);
  const description = String(parsed.description || '').slice(0, 2000);
  const bullets = Array.isArray(parsed.bullets)
    ? parsed.bullets.map(String).slice(0, 6)
    : mockBrief(input).bullets;
  const importantInfo = Array.isArray(parsed.importantInfo)
    ? parsed.importantInfo.map(String).slice(0, 5)
    : mockBrief(input).importantInfo;
  const seo = parsed.seo || {};

  const brief: CreativeBrief = {
    productName,
    title,
    description: description || mockBrief(input).description,
    bullets,
    importantInfo,
    seo: {
      metaTitle: String(seo.metaTitle || `${title} | ECOM`).slice(0, 70),
      metaDescription: String(seo.metaDescription || description.slice(0, 155)).slice(0, 160),
      tags: Array.isArray(seo.tags) ? seo.tags.map(String).slice(0, 10) : ['ecom'],
    },
    mediaPlan: defaultMediaPlan(productName),
    language: lang,
    source: ai.mock ? 'mock' : 'ai',
    provider: ai.provider,
    model: ai.model,
    rawText: ai.text,
  };

  return { ok: true, brief, ai };
}

export function validateBrief(brief: CreativeBrief): {
  ok: boolean;
  issues: string[];
} {
  const issues: string[] = [];
  if (!brief.title || brief.title.length < 8) issues.push('title_too_short');
  if (!brief.description || brief.description.length < 40) issues.push('description_too_short');
  if (!brief.bullets || brief.bullets.length < 3) issues.push('bullets_lt_3');
  if (!brief.mediaPlan?.images || brief.mediaPlan.images.length < 5) issues.push('images_plan_lt_5');
  if (!brief.mediaPlan?.videos || brief.mediaPlan.videos.length < 2) issues.push('videos_plan_lt_2');
  return { ok: issues.length === 0, issues };
}

export const CONTENT_META = {
  block: 61,
  features: ['landing_html', 'creative_brief', 'media_plan_5img_2vid', 'seo_basic'],
  note: 'Block 61: brief creativo. Imagenes/videos reales = bloques 62-63.',
};

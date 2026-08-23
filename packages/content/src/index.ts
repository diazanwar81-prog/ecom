/**
 * ECOM Content
 * - Block 29: landing HTML
 * - Block 61: creative product brief (copy llamativo por nicho)
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
  niche: string;
  source: 'ai' | 'mock' | 'ai_partial';
  provider?: string;
  model?: string;
  rawText?: string;
};

function cleanTitle(raw: string): string {
  return String(raw || '')
    .replace(/\[.*?\]/g, '')
    .replace(/\b(SERPER\+?CJ|MOCK|CJ|Cross-Border|Dropshipping|Hot-Selling)\b/gi, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120);
}

/** Detecta nicho comercial a partir del título / categoría */
export function detectNiche(rawTitle: string, category?: string): string {
  const t = `${rawTitle} ${category || ''}`.toLowerCase();
  if (/collar|necklace|earring|arete|joya|jewelry|rhinestone|crystal|cristal|clav[ií]cula|pendant/.test(t))
    return 'joyeria';
  if (/organiza|cocina|kitchen|storage|cable|escritorio|hogar|home|decor/.test(t)) return 'hogar';
  if (/beauty|skin|makeup|maquill|cuidado|facial|hair|cabello/.test(t)) return 'belleza';
  if (/phone|celular|soporte|magnet|led|gadget|usb|cargador|tech/.test(t)) return 'tech';
  if (/fitness|deporte|botella|gym|yoga|sport/.test(t)) return 'fitness';
  if (/kid|niñ|juguete|toy|baby|bebé/.test(t)) return 'kids';
  if (/moda|fashion|ropa|dress|jacket|shoe|zapat/.test(t)) return 'moda';
  return (category || 'general').toLowerCase();
}

const NICHE_VOICE: Record<
  string,
  { tone: string; titleHints: string[]; bulletSeeds: string[]; cta: string }
> = {
  joyeria: {
    tone: 'elegante, aspiracional, regalo, brillo, ocasiones',
    titleHints: ['Eleva tu look', 'Brilla en cada salida', 'Toque de lujo accesible'],
    bulletSeeds: [
      'Acabado brillante que resalta con luz natural y artificial',
      'Ideal para outfits de día o noche',
      'Pieza versátil: solitario o en capas',
      'Detalle premium a precio accesible',
    ],
    cta: 'Completa tu look hoy',
  },
  hogar: {
    tone: 'practico, orden, alivio diario, espacio',
    titleHints: ['Orden sin esfuerzo', 'Tu espacio, más liviano', 'Solucion que se nota'],
    bulletSeeds: [
      'Ahorra espacio y reduce el desorden en minutos',
      'Uso diario simple, sin herramientas complicadas',
      'Diseno que combina con la mayoria de ambientes',
      'Resultado visible desde el primer dia',
    ],
    cta: 'Ordena tu espacio hoy',
  },
  belleza: {
    tone: 'cuidado, ritual, resultado visible, confianza',
    titleHints: ['Tu ritual diario', 'Piel que se nota', 'Cuidado que enamora'],
    bulletSeeds: [
      'Se integra facil a tu rutina de manana o noche',
      'Textura agradable y aplicacion sencilla',
      'Pensado para resultados de aspecto natural',
      'Ideal para llevar en el bolso',
    ],
    cta: 'Empieza tu ritual',
  },
  tech: {
    tone: 'utilidad, modernidad, resolucion de friccion',
    titleHints: ['Mas practico cada dia', 'Listo cuando tu lo estas', 'Gadget que se nota'],
    bulletSeeds: [
      'Instalacion o uso en segundos',
      'Compatible con el uso diario real',
      'Diseno compacto y resistente',
      'Resuelve un problema concreto sin complicaciones',
    ],
    cta: 'Haz tu dia mas facil',
  },
  fitness: {
    tone: 'energia, constancia, estilo activo',
    titleHints: ['Entrena con estilo', 'Constancia con gusto', 'Listo para moverte'],
    bulletSeeds: [
      'Acompanante ideal en gym, casa o calle',
      'Comodo para sesiones largas',
      'Diseno que motiva a no saltarse el dia',
      'Facil de limpiar y llevar',
    ],
    cta: 'Suma a tu rutina',
  },
  moda: {
    tone: 'estilo, tendencia, confianza al vestir',
    titleHints: ['Define tu estilo', 'Look de impacto', 'Tendencia que se nota'],
    bulletSeeds: [
      'Combina con looks casuales y formales',
      'Corte y detalle pensados para destacar',
      'Pieza comoda para todo el dia',
      'Eleva un outfit basico en segundos',
    ],
    cta: 'Renueva tu look',
  },
  general: {
    tone: 'beneficio claro, uso real, compra segura',
    titleHints: ['La eleccion practica', 'Calidad que se siente', 'Para el dia a dia'],
    bulletSeeds: [
      'Pensado para uso frecuente',
      'Buena relacion calidad-precio',
      'Facil de usar desde el primer momento',
      'Envio con seguimiento a Colombia',
    ],
    cta: 'Llevalo a casa',
  },
};

export function defaultMediaPlan(productName: string, niche = 'general'): MediaPlan {
  const n = productName.slice(0, 80);
  const voice = NICHE_VOICE[niche] || NICHE_VOICE.general;
  return {
    images: [
      {
        role: 'hero_main',
        prompt: `Foto de producto profesional e-commerce de ${n}, fondo limpio, iluminacion de estudio, centrado, estilo ${niche}`,
      },
      {
        role: 'lifestyle',
        prompt: `Persona usando ${n} en contexto realista, tono ${voice.tone}, luz natural, UGC premium`,
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
        prompt: `Infografia de beneficios de ${n} (${niche}), iconos simples, texto en espanol, fondo blanco`,
      },
    ],
    videos: [
      {
        role: 'ugc_hook',
        prompt: `Video vertical 9:16 de ${n}, hook 3s, tono ${voice.tone}, subtitulos ES`,
        durationHintSec: 15,
      },
      {
        role: 'descriptive',
        prompt: `Video descriptivo de ${n}: caracteristicas, uso y CTA "${voice.cta}", 9:16, subtitulos ES`,
        durationHintSec: 30,
      },
    ],
  };
}

function mockBrief(input: CreativeBriefInput): CreativeBrief {
  const niche = detectNiche(input.rawTitle, input.category);
  const voice = NICHE_VOICE[niche] || NICHE_VOICE.general;
  const base = cleanTitle(input.rawTitle) || 'Producto destacado';
  const productName = base.length > 48 ? base.slice(0, 45).trim() + '…' : base;
  const hook = voice.titleHints[Math.floor(Math.abs(hash(base)) % voice.titleHints.length)];
  const title = `${hook}: ${productName}`.slice(0, 100);
  const description =
    `${productName} pensado para quien busca ${voice.tone.split(',')[0].trim()}. ` +
    `${hook}. ` +
    `Disenado para el dia a dia en Colombia: practico, con buena presencia y listo para regalar o usar. ` +
    (input.facts ? `Datos de ficha: ${input.facts.slice(0, 120)}. ` : '') +
    `${voice.cta}. Envio con seguimiento.`;

  return {
    productName,
    title,
    description,
    bullets: voice.bulletSeeds.slice(0, 4),
    importantInfo: [
      'Revisa medidas, color y material en la ficha antes de comprar',
      'Tiempos de envio internacional pueden variar segun destinacion',
      'Sin afirmaciones medicas ni resultados garantizados',
    ],
    seo: {
      metaTitle: `${title}`.slice(0, 65),
      metaDescription: `${description}`.slice(0, 155),
      tags: ['ecom', niche, 'colombia', ...(input.category ? [input.category.toLowerCase()] : [])],
    },
    mediaPlan: defaultMediaPlan(productName, niche),
    language: input.language || 'es-CO',
    niche,
    source: 'mock',
  };
}

function hash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return h;
}

/** Extrae "key": "value" sin regex frágil (soporta JSON truncado). */
function extractField(text: string, key: string): string | null {
  const needle = `"${key}"`;
  const idx = text.indexOf(needle);
  if (idx < 0) return null;
  let i = idx + needle.length;
  while (i < text.length && (text[i] === ' ' || text[i] === '\t' || text[i] === '\n' || text[i] === '\r')) i++;
  if (text[i] !== ':') return null;
  i++;
  while (i < text.length && (text[i] === ' ' || text[i] === '\t' || text[i] === '\n' || text[i] === '\r')) i++;
  if (text[i] !== '"') return null;
  i++;
  let out = '';
  while (i < text.length) {
    const ch = text[i];
    if (ch === '\\' && i + 1 < text.length) {
      out += text[i + 1];
      i += 2;
      continue;
    }
    if (ch === '"') break;
    out += ch;
    i++;
  }
  return out || null;
}

function extractArray(text: string, key: string): string[] | null {
  const needle = `"${key}"`;
  const idx = text.indexOf(needle);
  if (idx < 0) return null;
  let i = idx + needle.length;
  while (i < text.length && text[i] !== '[') i++;
  if (text[i] !== '[') return null;
  i++;
  const items: string[] = [];
  while (i < text.length && text[i] !== ']') {
    while (i < text.length && text[i] !== '"' && text[i] !== ']') i++;
    if (text[i] === ']') break;
    i++;
    let s = '';
    while (i < text.length) {
      const ch = text[i];
      if (ch === '\\' && i + 1 < text.length) {
        s += text[i + 1];
        i += 2;
        continue;
      }
      if (ch === '"') {
        i++;
        break;
      }
      s += ch;
      i++;
    }
    if (s) items.push(s);
  }
  return items.length ? items : null;
}

function tryParseJsonBrief(text: string): any | null {
  const m = text.match(/\{[\s\S]*\}/);
  if (m) {
    try {
      return JSON.parse(m[0]);
    } catch {
      /* partial */
    }
  }
  try {
    const title = extractField(text, 'title');
    const productName = extractField(text, 'productName');
    const description = extractField(text, 'description');
    if (!title && !productName && !description) return null;
    return {
      productName: productName || title,
      title: title || productName,
      description,
      bullets: extractArray(text, 'bullets'),
      importantInfo: extractArray(text, 'importantInfo'),
      seo: {
        metaTitle: extractField(text, 'metaTitle'),
        metaDescription: extractField(text, 'metaDescription'),
      },
      _partial: true,
    };
  } catch {
    return null;
  }
}

export async function generateCreativeBrief(input: CreativeBriefInput): Promise<{
  ok: boolean;
  brief: CreativeBrief;
  ai?: AiResponse;
}> {
  const niche = detectNiche(input.rawTitle, input.category);
  const voice = NICHE_VOICE[niche] || NICHE_VOICE.general;

  if (input.forceMock) {
    return { ok: true, brief: mockBrief(input) };
  }

  const lang = input.language || 'es-CO';
  const system =
    `Eres copywriter senior de e-commerce para Colombia (${lang}). ` +
    `Nicho detectado: ${niche}. Tono: ${voice.tone}. ` +
    `Escribe titulos y descripciones LLAMATIVOS, orientados a conversion, sin sonar genericos. ` +
    `Evita relleno tipo "calidad y practicidad". Usa beneficios concretos del producto. ` +
    `Prohibido: promesas medicas, garantias absolutas, ingles tecnico de proveedor, palabras Cross-Border/Dropshipping. ` +
    `Responde SOLO JSON valido (sin markdown). Esquema exacto:\n` +
    `{"productName":"nombre corto comercial max 50","title":"titulo venta max 90 con gancho","description":"120-220 palabras persuasivas en espanol","bullets":["4 bullets de beneficio"],"importantInfo":["3 avisos honestos"],"seo":{"metaTitle":"max 60","metaDescription":"max 150","tags":["tag1","tag2"]}}`;

  const user =
    `Producto crudo del proveedor: ${input.rawTitle}\n` +
    `Nicho: ${niche}\n` +
    `Categoria: ${input.category || 'n/a'}\n` +
    `Pais destino: ${input.countryCode || 'CO'}\n` +
    `Precio sugerido: ${input.salePrice != null ? input.salePrice + ' ' + (input.currency || 'COP') : 'n/a'}\n` +
    `Hechos / costos: ${input.facts || 'n/a'}\n` +
    `Ganchos de referencia del nicho: ${voice.titleHints.join(' | ')}\n` +
    `CTA natural: ${voice.cta}\n` +
    `Genera el JSON de venta ahora.`;

  const ai = await complete({
    task: 'copy',
    temperature: 0.7,
    maxTokens: 1400,
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
  });

  const fallback = mockBrief(input);
  let parsed: any = null;
  try {
    parsed = ai.ok ? tryParseJsonBrief(ai.text) : null;
  } catch {
    parsed = null;
  }

  if (!parsed || (!parsed.title && !parsed.productName)) {
    return {
      ok: true,
      brief: {
        ...fallback,
        provider: ai.provider,
        model: ai.model,
        rawText: ai.text,
      },
      ai,
    };
  }

  const productName = String(parsed.productName || parsed.title || fallback.productName).slice(0, 60);
  const title = String(parsed.title || productName).slice(0, 100);
  const description = String(parsed.description || fallback.description).slice(0, 2500);
  const bullets =
    Array.isArray(parsed.bullets) && parsed.bullets.length >= 3
      ? parsed.bullets.map(String).slice(0, 6)
      : fallback.bullets;
  const importantInfo =
    Array.isArray(parsed.importantInfo) && parsed.importantInfo.length >= 2
      ? parsed.importantInfo.map(String).slice(0, 5)
      : fallback.importantInfo;
  const seo = parsed.seo || {};

  const brief: CreativeBrief = {
    productName,
    title,
    description,
    bullets,
    importantInfo,
    seo: {
      metaTitle: String(seo.metaTitle || title).slice(0, 65),
      metaDescription: String(seo.metaDescription || description).slice(0, 155),
      tags: Array.isArray(seo.tags)
        ? seo.tags.map(String).slice(0, 10)
        : ['ecom', niche, 'colombia'],
    },
    mediaPlan: defaultMediaPlan(productName, niche),
    language: lang,
    niche,
    source: parsed._partial ? 'ai_partial' : ai.mock ? 'mock' : 'ai',
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
  if (/calidad y practicidad/i.test(brief.description || '')) issues.push('generic_copy');
  return { ok: issues.filter((i) => i !== 'generic_copy').length === 0, issues };
}

export const CONTENT_META = {
  block: 61,
  features: [
    'landing_html',
    'creative_brief',
    'niche_detection',
    'sales_copy',
    'media_plan_5img_2vid',
    'seo_basic',
  ],
  note: 'Copy por nicho (joyeria, hogar, tech...). Imagenes/videos = bloques 62-63.',
};

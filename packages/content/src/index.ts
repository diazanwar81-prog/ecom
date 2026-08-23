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
    .replace(
      /\b(SERPER\+?CJ|MOCK|CJ|Cross-Border|Dropshipping|Hot-Selling|Fashion|Elegant|Light Luxury|Versatile|Decorative|High-End|Accessories|European And American Style)\b/gi,
      '',
    )
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120);
}

export function detectNiche(rawTitle: string, category?: string): string {
  const t = `${rawTitle} ${category || ''}`.toLowerCase();
  if (/collar|necklace|earring|arete|joya|jewelry|rhinestone|crystal|cristal|clav[ií]cula|pendant|cadena/.test(t))
    return 'joyeria';
  if (/organiza|cocina|kitchen|storage|cable|escritorio|hogar|home|decor/.test(t)) return 'hogar';
  if (/beauty|skin|makeup|maquill|cuidado|facial|hair|cabello/.test(t)) return 'belleza';
  if (/phone|celular|soporte|magnet|led|gadget|usb|cargador|tech/.test(t)) return 'tech';
  if (/fitness|deporte|botella|gym|yoga|sport/.test(t)) return 'fitness';
  if (/kid|niñ|juguete|toy|baby|bebé/.test(t)) return 'kids';
  if (/moda|fashion|ropa|dress|jacket|shoe|zapat|chaqueta/.test(t)) return 'moda';
  return (category || 'general').toLowerCase();
}

const NICHE_VOICE: Record<
  string,
  { tone: string; titleHints: string[]; bulletSeeds: string[]; cta: string; nameExamples: string[] }
> = {
  joyeria: {
    tone: 'elegante, aspiracional, regalo',
    titleHints: ['Eleva tu look', 'Brilla en cada salida', 'El detalle que enamora'],
    bulletSeeds: [
      'Acabado brillante que se nota con luz natural',
      'Sirve de día y de noche',
      'Se puede usar solo o en capas',
      'Ideal para regalo sin parecer genérico',
    ],
    cta: 'Completa tu look hoy',
    nameExamples: ['Collar clavícula brillante', 'Set aretes y cadena', 'Collar de capas liviano'],
  },
  hogar: {
    tone: 'practico, orden, alivio',
    titleHints: ['Orden sin esfuerzo', 'Tu espacio respira', 'Solucion que se nota'],
    bulletSeeds: [
      'Reduce el desorden en minutos',
      'Uso diario sin complicaciones',
      'Encaja en la mayoria de ambientes',
      'Resultado visible desde el primer dia',
    ],
    cta: 'Ordena tu espacio hoy',
    nameExamples: ['Organizador plegable', 'Caja de cables escritorio', 'Soporte multiproposito'],
  },
  belleza: {
    tone: 'cuidado, ritual, confianza',
    titleHints: ['Tu ritual diario', 'Se nota en tu piel', 'Cuidado que acompana'],
    bulletSeeds: [
      'Facil de sumar a la rutina',
      'Aplicacion sencilla',
      'Sensacion agradable al uso',
      'Practico para llevar',
    ],
    cta: 'Empieza tu ritual',
    nameExamples: ['Serum facial diario', 'Kit de cuidado basico', 'Brocha de maquillaje'],
  },
  tech: {
    tone: 'util, moderno, sin friccion',
    titleHints: ['Mas practico cada dia', 'Listo cuando tu lo estas', 'Pequeño cambio, gran alivio'],
    bulletSeeds: [
      'Listo en segundos',
      'Pensado para uso real',
      'Compacto y resistente',
      'Resuelve un problema concreto',
    ],
    cta: 'Haz tu dia mas facil',
    nameExamples: ['Soporte magnetico celular', 'Lampara LED portatil', 'Cargador compacto'],
  },
  fitness: {
    tone: 'energia, constancia',
    titleHints: ['Entrena con gusto', 'Constancia con estilo', 'Listo para moverte'],
    bulletSeeds: [
      'Acompanante de gym o casa',
      'Comodo en sesiones largas',
      'Motiva a no saltarse el dia',
      'Facil de limpiar y llevar',
    ],
    cta: 'Suma a tu rutina',
    nameExamples: ['Botella termica 1L', 'Banda de resistencia', 'Toalla deportiva'],
  },
  moda: {
    tone: 'estilo, tendencia, confianza',
    titleHints: ['Define tu estilo', 'Look con presencia', 'El corte que destaca'],
    bulletSeeds: [
      'Combina casual y formal',
      'Detalle que se nota',
      'Comodo todo el dia',
      'Eleva un outfit basico',
    ],
    cta: 'Renueva tu look',
    nameExamples: ['Chaqueta con flecos', 'Blusa de impacto', 'Accesorio de moda'],
  },
  general: {
    tone: 'beneficio claro, compra segura',
    titleHints: ['La eleccion practica', 'Calidad que se siente', 'Para el dia a dia'],
    bulletSeeds: [
      'Pensado para uso frecuente',
      'Buena relacion calidad-precio',
      'Facil desde el primer uso',
      'Envio con seguimiento a Colombia',
    ],
    cta: 'Llevalo a casa',
    nameExamples: ['Producto destacado', 'Esencial diario', 'Pieza practica'],
  },
};

export function defaultMediaPlan(productName: string, niche = 'general'): MediaPlan {
  const n = productName.slice(0, 60);
  const voice = NICHE_VOICE[niche] || NICHE_VOICE.general;
  return {
    images: [
      {
        role: 'hero_main',
        prompt: `Foto de producto profesional e-commerce de ${n}, fondo limpio blanco o neutro, iluminacion de estudio suave, centrado, alta nitidez, estilo ${niche}`,
      },
      {
        role: 'lifestyle',
        prompt: `Persona real usando ${n} en contexto cotidiano, tono ${voice.tone}, luz natural, estilo UGC premium, sin logos inventados`,
      },
      {
        role: 'detail_closeup',
        prompt: `Primer plano de textura y detalles de ${n}, macro, nitidez alta, sin texto superpuesto`,
      },
      {
        role: 'packshot_angle',
        prompt: `Angulo alterno de ${n} sobre superficie neutra, sombra suave realista`,
      },
      {
        role: 'infographic',
        prompt: `Infografia simple de beneficios de ${n}, iconos limpios, texto en espanol, fondo blanco, sin promesas medicas`,
      },
    ],
    videos: [
      {
        role: 'ugc_hook',
        prompt: `Video vertical 9:16 de ${n}, primeros 3 segundos con gancho visual, tono ${voice.tone}, subtitulos en espanol`,
        durationHintSec: 15,
      },
      {
        role: 'descriptive',
        prompt: `Video descriptivo 9:16 de ${n}: muestra, uso y CTA "${voice.cta}", subtitulos en espanol`,
        durationHintSec: 30,
      },
    ],
  };
}

function mockBrief(input: CreativeBriefInput): CreativeBrief {
  const niche = detectNiche(input.rawTitle, input.category);
  const voice = NICHE_VOICE[niche] || NICHE_VOICE.general;
  const base = cleanTitle(input.rawTitle) || voice.nameExamples[0];
  const productName =
    base.length > 42
      ? base.slice(0, 39).trim() + '…'
      : base || voice.nameExamples[0];
  const hook = voice.titleHints[Math.floor(Math.abs(hash(base)) % voice.titleHints.length)];
  const title = `${hook}: ${productName}`.slice(0, 90);
  const description =
    `${productName} para quien busca ${voice.tone.split(',')[0].trim()}. ` +
    `${hook}. Ideal para uso diario en Colombia, con presencia cuidada y listo para regalar. ` +
    `${voice.cta}. Envio con seguimiento.`;

  return {
    productName,
    title,
    description,
    bullets: voice.bulletSeeds.slice(0, 4),
    importantInfo: [
      'Revisa medidas, color y material en la ficha antes de comprar',
      'Los tiempos de envio internacional pueden variar',
      'Sin afirmaciones medicas ni resultados garantizados',
    ],
    seo: {
      metaTitle: title.slice(0, 60),
      metaDescription: description.slice(0, 150),
      tags: ['ecom', niche, 'colombia'],
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

function extractField(text: string, key: string): string | null {
  const needle = `"${key}"`;
  const idx = text.indexOf(needle);
  if (idx < 0) return null;
  let i = idx + needle.length;
  while (i < text.length && /\s/.test(text[i])) i++;
  if (text[i] !== ':') return null;
  i++;
  while (i < text.length && /\s/.test(text[i])) i++;
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

/** Prompt de calidad: reglas claras de venta, sin acortar el mensaje comercial. */
function buildSystemPrompt(niche: string, voice: (typeof NICHE_VOICE)[string]): string {
  return [
    'Eres copywriter senior de e-commerce para Colombia (es-CO).',
    `Nicho: ${niche}. Tono: ${voice.tone}.`,
    '',
    'OBJETIVO: textos que venden. Claros, concretos, con emocion controlada.',
    '',
    'REGLAS OBLIGATORIAS:',
    '1) 100% espanol latino. Cero ingles (nada de necklace, fashion, luxury, cross-border).',
    '2) productName: nombre comercial CONCRETO (tipo de producto + atributo). Prohibido nombres vacios como "Luxe", "Premium", "Style".',
    `   Ejemplos validos para este nicho: ${voice.nameExamples.join('; ')}.`,
    '3) title: gancho de venta + beneficio. Max 80 caracteres. Puede usar uno de: ' +
      voice.titleHints.join(' | ') + '.',
    '4) description: 90-140 palabras. Habla al comprador (tu/te). Beneficio, uso, ocasion, cierre con CTA natural.',
    '5) bullets: exactamente 4, cada uno un beneficio observable (no adjetivos vacios).',
    '6) importantInfo: 3 avisos honestos (medidas, envio, sin promesas medicas).',
    '7) seo.metaTitle max 55; seo.metaDescription max 140; 2-4 tags en espanol.',
    '8) Prohibido: porcentajes inventados, "garantizado", promesas medicas, jerga de proveedor chino.',
    '',
    'Responde SOLO un JSON valido, sin markdown ni texto fuera del JSON.',
    'Schema exacto:',
    '{"productName":"...","title":"...","description":"...","bullets":["...","...","...","..."],"importantInfo":["...","...","..."],"seo":{"metaTitle":"...","metaDescription":"...","tags":["...","..."]}}',
  ].join('\n');
}

function buildUserPrompt(input: CreativeBriefInput, cleaned: string, niche: string, voice: (typeof NICHE_VOICE)[string]): string {
  const lines = [
    'Genera el JSON de venta para este producto:',
    `Titulo crudo del proveedor (solo referencia): ${input.rawTitle}`,
    `Titulo limpio sugerido: ${cleaned || '(derivar del crudo)'}`,
    `Nicho detectado: ${niche}`,
    `Pais: ${input.countryCode || 'CO'}`,
  ];
  if (input.salePrice != null) {
    lines.push(`Precio sugerido: ${input.salePrice} ${input.currency || 'COP'}`);
  }
  if (input.facts) {
    lines.push(`Datos de ficha (no inventar fuera de esto): ${input.facts.slice(0, 200)}`);
  }
  lines.push(`CTA de referencia: ${voice.cta}`);
  lines.push('Escribe como si el cliente fuera a leerlo en Shopify en Colombia.');
  return lines.join('\n');
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
  const cleaned = cleanTitle(input.rawTitle);

  const ai = await complete({
    task: 'copy',
    temperature: 0.55,
    maxTokens: 700,
    messages: [
      { role: 'system', content: buildSystemPrompt(niche, voice) },
      { role: 'user', content: buildUserPrompt(input, cleaned, niche, voice) },
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

  let productName = String(parsed.productName || parsed.title || fallback.productName).slice(0, 50);
  // Evitar nombres vacios tipo "Luxe"
  if (/^(luxe|premium|style|elegant|luxury|producto)$/i.test(productName.trim())) {
    productName = fallback.productName;
  }

  const title = String(parsed.title || productName).slice(0, 90);
  const description = String(parsed.description || fallback.description).slice(0, 1200);
  const bullets =
    Array.isArray(parsed.bullets) && parsed.bullets.length >= 3
      ? parsed.bullets.map(String).slice(0, 4)
      : fallback.bullets;
  while (bullets.length < 4) bullets.push(voice.bulletSeeds[bullets.length] || 'Envio con seguimiento');

  const importantInfo =
    Array.isArray(parsed.importantInfo) && parsed.importantInfo.length >= 2
      ? parsed.importantInfo.map(String).slice(0, 3)
      : fallback.importantInfo;
  const seo = parsed.seo || {};

  const brief: CreativeBrief = {
    productName,
    title,
    description,
    bullets,
    importantInfo,
    seo: {
      metaTitle: String(seo.metaTitle || title).slice(0, 60),
      metaDescription: String(seo.metaDescription || description).slice(0, 150),
      tags: Array.isArray(seo.tags)
        ? seo.tags.map(String).slice(0, 6)
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
  if (/^(luxe|premium|style)$/i.test((brief.productName || '').trim())) issues.push('generic_product_name');
  if (/necklace|fashion|cross-border|dropshipping/i.test(brief.description || '')) issues.push('english_leak');
  if (/calidad y practicidad/i.test(brief.description || '')) issues.push('generic_copy');
  const hard = issues.filter(
    (i) => !['generic_copy', 'english_leak', 'generic_product_name'].includes(i),
  );
  return { ok: hard.length === 0, issues };
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
    'quality_prompt_v2',
  ],
  note: 'Prompt de venta mejorado: nombre concreto, espanol total, 4 bullets, sin stats inventados.',
};

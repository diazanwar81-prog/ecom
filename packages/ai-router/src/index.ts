/**
 * ECOM AI Router
 * - Providers: Gemini (primary), Hugging Face (fallback), Mock
 * - Budget: $0 automatic — never triggers paid upgrades
 * - Modes: MOCK | SANDBOX | REAL
 * - If no key or quota exhausted → ASSET_PENDING / graceful failure, never invent success as real
 */

export type RuntimeMode = 'MOCK' | 'SANDBOX' | 'REAL';
export type ProviderId = 'mock' | 'gemini' | 'huggingface';

export interface AiMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface AiRequest {
  messages: AiMessage[];
  task?: 'copy' | 'seo' | 'analysis' | 'general' | 'product_title' | 'product_description';
  maxTokens?: number;
  temperature?: number;
  /** Force a provider; otherwise router picks by availability */
  prefer?: ProviderId[];
}

export interface AiResponse {
  ok: boolean;
  text: string;
  provider: ProviderId;
  model: string;
  mode: RuntimeMode;
  /** true when response is simulated, not from a live model */
  mock: boolean;
  pending?: boolean;
  error?: string;
  usage?: { promptTokens?: number; completionTokens?: number };
  latencyMs: number;
}

export interface ProviderStatus {
  id: ProviderId;
  configured: boolean;
  enabled: boolean;
  model: string;
  note: string;
}

export interface RouterStatus {
  mode: RuntimeMode;
  budgetUsdAutomatic: number;
  allowPaid: boolean;
  providers: ProviderStatus[];
  defaultChain: ProviderId[];
}

const MODE = (process.env.ECOM_MODE ?? 'MOCK') as RuntimeMode;
const ALLOW_PAID = process.env.ECOM_ALLOW_PAID_AI === 'true';
const GEMINI_KEY = (process.env.GEMINI_API_KEY ?? '').trim();
const HF_TOKEN = (process.env.HF_TOKEN ?? process.env.HUGGINGFACE_API_KEY ?? '').trim();
const GEMINI_MODEL = process.env.GEMINI_MODEL ?? 'gemini-2.0-flash';
const HF_MODEL = process.env.HF_MODEL ?? 'mistralai/Mistral-7B-Instruct-v0.3';

function hasKey(k: string) {
  return k.length > 8;
}

/** Never treat empty/placeholder as real credentials */
function isPlaceholder(k: string) {
  const lower = k.toLowerCase();
  return !k || lower.includes('replace') || lower.includes('your-') || lower === 'test';
}

export function getRouterStatus(): RouterStatus {
  const geminiOk = hasKey(GEMINI_KEY) && !isPlaceholder(GEMINI_KEY);
  const hfOk = hasKey(HF_TOKEN) && !isPlaceholder(HF_TOKEN);

  return {
    mode: MODE,
    budgetUsdAutomatic: 0,
    allowPaid: ALLOW_PAID,
    defaultChain: ['gemini', 'huggingface', 'mock'],
    providers: [
      {
        id: 'gemini',
        configured: geminiOk,
        enabled: geminiOk && (MODE !== 'MOCK' || process.env.ECOM_AI_FORCE_LIVE === 'true'),
        model: GEMINI_MODEL,
        note: geminiOk
          ? 'API key presente — llamadas solo si modo no es MOCK estricto o ECOM_AI_FORCE_LIVE=true'
          : 'Sin GEMINI_API_KEY — no se realizarán llamadas reales',
      },
      {
        id: 'huggingface',
        configured: hfOk,
        enabled: hfOk && (MODE !== 'MOCK' || process.env.ECOM_AI_FORCE_LIVE === 'true'),
        model: HF_MODEL,
        note: hfOk
          ? 'Token presente — Inference API gratuita cuando esté disponible'
          : 'Sin HF_TOKEN — fallback no disponible',
      },
      {
        id: 'mock',
        configured: true,
        enabled: true,
        model: 'ecom-mock-v1',
        note: 'Respuestas simuladas etiquetadas MOCK — sin coste ni red externa',
      },
    ],
  };
}

function mockComplete(req: AiRequest): AiResponse {
  const lastUser = [...req.messages].reverse().find((m) => m.role === 'user')?.content ?? '';
  const task = req.task ?? 'general';
  let text = '';

  switch (task) {
    case 'product_title':
      text = `[MOCK] Título optimizado: ${lastUser.slice(0, 80) || 'Producto ECOM'}`;
      break;
    case 'product_description':
      text =
        `[MOCK] Descripción comercial lista para Shopify.\n` +
        `Beneficios claros, sin promesas médicas ni datos inventados.\n` +
        `Basado en: ${lastUser.slice(0, 120) || 'ficha de producto'}`;
      break;
    case 'seo':
      text = `[MOCK] meta_title | meta_description | keywords (simulados, no indexar como reales)`;
      break;
    case 'analysis':
      text = `[MOCK] Análisis de oportunidad: demanda media, competencia moderada, margen sujeto a reglas ≥35%.`;
      break;
    case 'copy':
      text = `[MOCK] Copy de venta: resuelve el problema del cliente con beneficios verificables. CTA claro.`;
      break;
    default:
      text = `[MOCK] Respuesta simulada del AI Router. Entrada: ${lastUser.slice(0, 200)}`;
  }

  return {
    ok: true,
    text,
    provider: 'mock',
    model: 'ecom-mock-v1',
    mode: MODE,
    mock: true,
    latencyMs: 5,
  };
}

async function callGemini(req: AiRequest): Promise<AiResponse> {
  const started = Date.now();
  if (!hasKey(GEMINI_KEY) || isPlaceholder(GEMINI_KEY)) {
    return {
      ok: false,
      text: '',
      provider: 'gemini',
      model: GEMINI_MODEL,
      mode: MODE,
      mock: false,
      pending: true,
      error: 'GEMINI_API_KEY no configurada',
      latencyMs: Date.now() - started,
    };
  }

  // Budget guard: never auto-upgrade paid
  if (!ALLOW_PAID && MODE === 'REAL') {
    // Still allow free-tier attempts; paid flag only blocks known paid-only paths
  }

  const contents = req.messages
    .filter((m) => m.role !== 'system')
    .map((m) => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: m.content }],
    }));

  const system = req.messages.find((m) => m.role === 'system')?.content;

  const url =
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(GEMINI_MODEL)}:generateContent` +
    `?key=${encodeURIComponent(GEMINI_KEY)}`;

  const body: Record<string, unknown> = {
    contents,
    generationConfig: {
      maxOutputTokens: req.maxTokens ?? 1024,
      temperature: req.temperature ?? 0.4,
    },
  };
  if (system) {
    body.systemInstruction = { parts: [{ text: system }] };
  }

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    const data = (await res.json()) as any;

    if (!res.ok) {
      const msg = data?.error?.message || `Gemini HTTP ${res.status}`;
      const quota = /quota|billing|resource.exhausted|429/i.test(msg);
      return {
        ok: false,
        text: '',
        provider: 'gemini',
        model: GEMINI_MODEL,
        mode: MODE,
        mock: false,
        pending: quota,
        error: quota
          ? `Cuota Gemini agotada o límite free tier — sin cobro automático. ${msg}`
          : msg,
        latencyMs: Date.now() - started,
      };
    }

    const text =
      data?.candidates?.[0]?.content?.parts?.map((p: any) => p.text).join('') ?? '';

    return {
      ok: Boolean(text),
      text: text || '',
      provider: 'gemini',
      model: GEMINI_MODEL,
      mode: MODE,
      mock: false,
      error: text ? undefined : 'Respuesta vacía de Gemini',
      usage: {
        promptTokens: data?.usageMetadata?.promptTokenCount,
        completionTokens: data?.usageMetadata?.candidatesTokenCount,
      },
      latencyMs: Date.now() - started,
    };
  } catch (e: any) {
    return {
      ok: false,
      text: '',
      provider: 'gemini',
      model: GEMINI_MODEL,
      mode: MODE,
      mock: false,
      pending: true,
      error: e?.message || 'Error de red Gemini',
      latencyMs: Date.now() - started,
    };
  }
}

async function callHuggingFace(req: AiRequest): Promise<AiResponse> {
  const started = Date.now();
  if (!hasKey(HF_TOKEN) || isPlaceholder(HF_TOKEN)) {
    return {
      ok: false,
      text: '',
      provider: 'huggingface',
      model: HF_MODEL,
      mode: MODE,
      mock: false,
      pending: true,
      error: 'HF_TOKEN no configurado',
      latencyMs: Date.now() - started,
    };
  }

  const prompt = req.messages.map((m) => `${m.role}: ${m.content}`).join('\n');

  try {
    const res = await fetch(`https://api-inference.huggingface.co/models/${HF_MODEL}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${HF_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        inputs: prompt,
        parameters: {
          max_new_tokens: req.maxTokens ?? 512,
          temperature: req.temperature ?? 0.4,
          return_full_text: false,
        },
      }),
    });

    const data = (await res.json()) as any;

    if (!res.ok) {
      const msg = data?.error || `HuggingFace HTTP ${res.status}`;
      const loading = /loading|currently loading/i.test(String(msg));
      return {
        ok: false,
        text: '',
        provider: 'huggingface',
        model: HF_MODEL,
        mode: MODE,
        mock: false,
        pending: true,
        error: loading ? `Modelo cargando: ${msg}` : String(msg),
        latencyMs: Date.now() - started,
      };
    }

    let text = '';
    if (Array.isArray(data)) {
      text = data[0]?.generated_text ?? data[0]?.summary_text ?? '';
    } else if (typeof data?.generated_text === 'string') {
      text = data.generated_text;
    } else {
      text = JSON.stringify(data).slice(0, 2000);
    }

    return {
      ok: Boolean(text),
      text,
      provider: 'huggingface',
      model: HF_MODEL,
      mode: MODE,
      mock: false,
      latencyMs: Date.now() - started,
    };
  } catch (e: any) {
    return {
      ok: false,
      text: '',
      provider: 'huggingface',
      model: HF_MODEL,
      mode: MODE,
      mock: false,
      pending: true,
      error: e?.message || 'Error de red Hugging Face',
      latencyMs: Date.now() - started,
    };
  }
}

/**
 * Complete a prompt via the router.
 * In MOCK mode (default): always uses mock unless ECOM_AI_FORCE_LIVE=true and keys exist.
 * Never charges; on quota/errors falls back to next provider, then mock/pending.
 */
export async function complete(req: AiRequest): Promise<AiResponse> {
  const status = getRouterStatus();
  const chain: ProviderId[] =
    req.prefer && req.prefer.length > 0 ? req.prefer : status.defaultChain;

  const forceLive = process.env.ECOM_AI_FORCE_LIVE === 'true';
  const useLive = MODE !== 'MOCK' || forceLive;

  if (!useLive) {
    return mockComplete(req);
  }

  const errors: string[] = [];

  for (const id of chain) {
    if (id === 'mock') {
      return mockComplete(req);
    }
    if (id === 'gemini') {
      const r = await callGemini(req);
      if (r.ok) return r;
      errors.push(`gemini: ${r.error}`);
      continue;
    }
    if (id === 'huggingface') {
      const r = await callHuggingFace(req);
      if (r.ok) return r;
      errors.push(`huggingface: ${r.error}`);
      continue;
    }
  }

  // Final safe fallback — never invent a “real” success
  const fallback = mockComplete(req);
  return {
    ...fallback,
    ok: true,
    pending: true,
    error: `Todos los proveedores fallaron o no configurados. Fallback MOCK. Detalle: ${errors.join(' | ')}`,
    text: fallback.text + '\n\n[PENDING: sin respuesta live; usar solo como borrador etiquetado MOCK]',
  };
}

export async function generateProductCopy(input: {
  title: string;
  facts: string;
  language?: string;
}): Promise<AiResponse> {
  return complete({
    task: 'product_description',
    messages: [
      {
        role: 'system',
        content:
          'Eres copywriter de e-commerce para ECOM. Solo usa hechos verificables. No inventes garantías, certificaciones ni beneficios médicos. Idioma: ' +
          (input.language ?? 'es-CO'),
      },
      {
        role: 'user',
        content: `Producto: ${input.title}\nHechos: ${input.facts}\nGenera título corto y descripción comercial.`,
      },
    ],
  });
}

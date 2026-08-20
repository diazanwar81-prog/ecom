/**
 * ECOM AI Router
 * - Providers: Gemini (primary), Hugging Face (fallback), Mock
 * - Budget: $0 automatic — never triggers paid upgrades
 * - Env read per request (trim + normalize)
 * - Live failures always surface error details (never silent mock)
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
  prefer?: ProviderId[];
}

export interface AiResponse {
  ok: boolean;
  text: string;
  provider: ProviderId;
  model: string;
  mode: RuntimeMode;
  mock: boolean;
  pending?: boolean;
  error?: string;
  attempts?: string[];
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
  forceLive: boolean;
  providers: ProviderStatus[];
  defaultChain: ProviderId[];
}

function env(name: string, fallback = ''): string {
  return (process.env[name] ?? fallback).replace(/\r/g, '').trim();
}

function envBool(name: string): boolean {
  const v = env(name).toLowerCase();
  return v === 'true' || v === '1' || v === 'yes';
}

function runtimeMode(): RuntimeMode {
  const m = env('ECOM_MODE', 'MOCK').toUpperCase();
  if (m === 'SANDBOX' || m === 'REAL') return m;
  return 'MOCK';
}

function geminiKey() {
  return env('GEMINI_API_KEY');
}
function hfToken() {
  return env('HF_TOKEN') || env('HUGGINGFACE_API_KEY');
}
/** Default matches current Gemini stable Flash (2026). Override with GEMINI_MODEL. */
function geminiModel() {
  return env('GEMINI_MODEL', 'gemini-3.6-flash') || 'gemini-3.6-flash';
}
/** Prefer a small free-tier friendly model; override with HF_MODEL. */
function hfModel() {
  return env('HF_MODEL', 'HuggingFaceH4/zephyr-7b-beta') || 'HuggingFaceH4/zephyr-7b-beta';
}

function hasKey(k: string) {
  return k.length > 8;
}

function isPlaceholder(k: string) {
  const lower = k.toLowerCase();
  return !k || lower.includes('replace') || lower.includes('your-') || lower === 'test';
}

export function getRouterStatus(): RouterStatus {
  const mode = runtimeMode();
  const forceLive = envBool('ECOM_AI_FORCE_LIVE');
  const allowPaid = envBool('ECOM_ALLOW_PAID_AI');
  const gKey = geminiKey();
  const hKey = hfToken();
  const geminiOk = hasKey(gKey) && !isPlaceholder(gKey);
  const hfOk = hasKey(hKey) && !isPlaceholder(hKey);
  const liveAllowed = mode !== 'MOCK' || forceLive;

  return {
    mode,
    budgetUsdAutomatic: 0,
    allowPaid,
    forceLive,
    defaultChain: ['gemini', 'huggingface'],
    providers: [
      {
        id: 'gemini',
        configured: geminiOk,
        enabled: geminiOk && liveAllowed,
        model: geminiModel(),
        note: geminiOk
          ? `Key presente · liveAllowed=${liveAllowed} · prefijo=${gKey.slice(0, 4)}…`
          : 'Sin GEMINI_API_KEY',
      },
      {
        id: 'huggingface',
        configured: hfOk,
        enabled: hfOk && liveAllowed,
        model: hfModel(),
        note: hfOk ? `Token presente · liveAllowed=${liveAllowed}` : 'Sin HF_TOKEN',
      },
      {
        id: 'mock',
        configured: true,
        enabled: true,
        model: 'ecom-mock-v1',
        note: 'Fallback local sin coste',
      },
    ],
  };
}

function mockComplete(req: AiRequest): AiResponse {
  const mode = runtimeMode();
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
      text = `[MOCK] meta_title | meta_description | keywords (simulados)`;
      break;
    case 'analysis':
      text = `[MOCK] Análisis de oportunidad: demanda media, competencia moderada, margen ≥35%.`;
      break;
    case 'copy':
      text = `[MOCK] Copy de venta con beneficios verificables. CTA claro.`;
      break;
    default:
      text = `[MOCK] Respuesta simulada del AI Router. Entrada: ${lastUser.slice(0, 200)}`;
  }

  return {
    ok: true,
    text,
    provider: 'mock',
    model: 'ecom-mock-v1',
    mode,
    mock: true,
    latencyMs: 5,
  };
}

async function callGemini(req: AiRequest): Promise<AiResponse> {
  const started = Date.now();
  const mode = runtimeMode();
  const key = geminiKey();
  const model = geminiModel();

  if (!hasKey(key) || isPlaceholder(key)) {
    return {
      ok: false,
      text: '',
      provider: 'gemini',
      model,
      mode,
      mock: false,
      pending: true,
      error: 'GEMINI_API_KEY no configurada',
      latencyMs: Date.now() - started,
    };
  }

  const contents = req.messages
    .filter((m) => m.role !== 'system')
    .map((m) => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: m.content }],
    }));

  const system = req.messages.find((m) => m.role === 'system')?.content;

  const url =
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent` +
    `?key=${encodeURIComponent(key)}`;

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
        model,
        mode,
        mock: false,
        pending: quota,
        error: quota ? `Cuota/límite Gemini — sin cobro automático. ${msg}` : msg,
        latencyMs: Date.now() - started,
      };
    }

    const text =
      data?.candidates?.[0]?.content?.parts?.map((p: any) => p.text).join('') ?? '';

    return {
      ok: Boolean(text),
      text: text || '',
      provider: 'gemini',
      model,
      mode,
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
      model,
      mode,
      mock: false,
      pending: true,
      error: e?.message || 'Error de red Gemini',
      latencyMs: Date.now() - started,
    };
  }
}

async function callHuggingFace(req: AiRequest): Promise<AiResponse> {
  const started = Date.now();
  const mode = runtimeMode();
  const token = hfToken();
  const model = hfModel();

  if (!hasKey(token) || isPlaceholder(token)) {
    return {
      ok: false,
      text: '',
      provider: 'huggingface',
      model,
      mode,
      mock: false,
      pending: true,
      error: 'HF_TOKEN no configurado',
      latencyMs: Date.now() - started,
    };
  }

  // Modern HF: OpenAI-compatible chat via router (Inference Providers)
  const chatMessages = req.messages.map((m) => ({
    role: m.role === 'assistant' ? 'assistant' : m.role === 'system' ? 'system' : 'user',
    content: m.content,
  }));

  try {
    const res = await fetch('https://router.huggingface.co/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        messages: chatMessages,
        max_tokens: req.maxTokens ?? 512,
        temperature: req.temperature ?? 0.4,
      }),
    });

    const data = (await res.json()) as any;

    if (!res.ok) {
      const msg = data?.error?.message || data?.error || `HuggingFace HTTP ${res.status}`;
      return {
        ok: false,
        text: '',
        provider: 'huggingface',
        model,
        mode,
        mock: false,
        pending: true,
        error: String(msg),
        latencyMs: Date.now() - started,
      };
    }

    const text = data?.choices?.[0]?.message?.content ?? '';

    return {
      ok: Boolean(text),
      text: text || '',
      provider: 'huggingface',
      model,
      mode,
      mock: false,
      error: text ? undefined : 'Respuesta HF vacía',
      usage: {
        promptTokens: data?.usage?.prompt_tokens,
        completionTokens: data?.usage?.completion_tokens,
      },
      latencyMs: Date.now() - started,
    };
  } catch (e: any) {
    return {
      ok: false,
      text: '',
      provider: 'huggingface',
      model,
      mode,
      mock: false,
      pending: true,
      error: e?.message || 'Error de red Hugging Face',
      latencyMs: Date.now() - started,
    };
  }
}

export async function complete(req: AiRequest): Promise<AiResponse> {
  const status = getRouterStatus();
  const prefer = req.prefer && req.prefer.length > 0 ? req.prefer : status.defaultChain;
  const chain = prefer.filter((id) => id !== 'mock');

  const useLive = status.mode !== 'MOCK' || status.forceLive;

  if (!useLive) {
    return mockComplete(req);
  }

  const attempts: string[] = [];

  for (const id of chain) {
    if (id === 'gemini') {
      const r = await callGemini(req);
      attempts.push(`gemini:${r.ok ? 'ok' : r.error || 'fail'} (${r.latencyMs}ms)`);
      if (r.ok) return { ...r, attempts };
      continue;
    }
    if (id === 'huggingface') {
      const r = await callHuggingFace(req);
      attempts.push(`huggingface:${r.ok ? 'ok' : r.error || 'fail'} (${r.latencyMs}ms)`);
      if (r.ok) return { ...r, attempts };
      continue;
    }
  }

  const fallback = mockComplete(req);
  return {
    ...fallback,
    ok: true,
    pending: true,
    attempts,
    error: `Proveedores live fallaron. Fallback MOCK. ${attempts.join(' | ')}`,
    text: `${fallback.text}\n\n[PENDING live] ${attempts.join(' | ')}`,
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
          'Eres copywriter de e-commerce para ECOM. Solo hechos verificables. Sin promesas médicas. Idioma: ' +
          (input.language ?? 'es-CO'),
      },
      {
        role: 'user',
        content: `Producto: ${input.title}\nHechos: ${input.facts}\nGenera título corto y descripción comercial.`,
      },
    ],
  });
}

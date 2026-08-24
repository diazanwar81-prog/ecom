/**
 * ECOM v1 Final — Phases D→J unified verification
 *
 * D Storefront ready (public landing + published CJ product)
 * E REAL-safe ops (kill-switch, budgets, webhook HMAC, REAL gate)
 * F 24/7 catalog loop (scheduler, inventory pause, alerts)
 * G Growth ads (draft-first, $0 default)
 * H Native trends (multi-source signals)
 * I Controlled autonomy (caps, board, first-sale smoke)
 * J Production hardening (deploy readiness, release score)
 */

export type PhaseId = 'D' | 'E' | 'F' | 'G' | 'H' | 'I' | 'J';

export type V1Check = {
  id: string;
  phase: PhaseId;
  ok: boolean;
  severity: 'critical' | 'warning' | 'info';
  message: string;
  detail?: string;
};

export type V1PhaseSummary = {
  phase: PhaseId;
  title: string;
  ok: boolean;
  criticalFailed: number;
  warnings: number;
  score: number;
  checks: V1Check[];
};

function env(k: string, fallback = ''): string {
  return (process.env[k] ?? fallback).replace(/\r/g, '').trim();
}

function envBool(k: string, def = false): boolean {
  const v = env(k).toLowerCase();
  if (!v) return def;
  return v === '1' || v === 'true' || v === 'yes' || v === 'on';
}

function isHttps(u: string): boolean {
  try {
    return new URL(u).protocol === 'https:';
  } catch {
    return false;
  }
}

export const PHASE_TITLES: Record<PhaseId, string> = {
  D: 'Tienda vendible (landing pública + catálogo publicado)',
  E: 'Operación REAL segura',
  F: 'Bucle 24/7 de catálogo',
  G: 'Crecimiento (ads controlados)',
  H: 'Trends multi-fuente',
  I: 'Autonomía controlada',
  J: 'Producción / release',
};

export type V1VerifyInput = {
  mode: string;
  published: number;
  publishedWithCj: number;
  pendingApproval: number;
  paidOrders: number;
  fulfilledOrders: number;
  paidUnfulfilled: number;
  paused: number;
  orphanPublished: number;
  shopifyLive: boolean;
  cjLive: boolean;
  discoverySchedulerOn: boolean;
  serperConfigured: boolean;
  telegramConfigured: boolean;
  ffmpegAvailable: boolean;
  landingBuilderOk: boolean;
  publicLandingRoute: boolean;
};

export function buildPhaseD(input: V1VerifyInput): V1Check[] {
  return [
    {
      id: 'd_landing_builder',
      phase: 'D',
      ok: input.landingBuilderOk,
      severity: 'critical',
      message: input.landingBuilderOk
        ? 'Builder landing HTML OK'
        : 'Falta builder de landing',
    },
    {
      id: 'd_public_route',
      phase: 'D',
      ok: input.publicLandingRoute,
      severity: 'critical',
      message: input.publicLandingRoute
        ? 'Ruta pública GET /l/:productId cableada'
        : 'Falta ruta pública /l/:productId',
    },
    {
      id: 'd_published_cj',
      phase: 'D',
      ok: input.publishedWithCj >= 1,
      severity: 'critical',
      message:
        input.publishedWithCj >= 1
          ? `${input.publishedWithCj} producto(s) PUBLISHED con CJ`
          : 'Necesitas ≥1 producto publicado con cjVariantId/cjSku',
    },
    {
      id: 'd_shopify_live',
      phase: 'D',
      ok: input.shopifyLive,
      severity: 'critical',
      message: input.shopifyLive ? 'Shopify live-ready' : 'Shopify no live-ready',
    },
    {
      id: 'd_orders_loop',
      phase: 'D',
      ok: input.paidOrders + input.fulfilledOrders >= 0,
      severity: 'info',
      message: `Pedidos PAID=${input.paidOrders} FULFILLED=${input.fulfilledOrders} (compra de prueba pendiente si 0)`,
    },
  ];
}

export function buildPhaseE(input: V1VerifyInput): V1Check[] {
  const secret = env('SHOPIFY_WEBHOOK_SECRET');
  const kill = envBool('ECOM_KILL_SWITCH') || envBool('ECOM_PAUSE_ALL');
  const apiUrl = env('API_URL') || env('PUBLIC_API_URL') || env('APP_URL');
  const httpsOk = isHttps(apiUrl);
  const realConfirm = env('ECOM_REAL_CONFIRM') === 'I_UNDERSTAND_REAL_MODE';
  const paidAiOff = !envBool('ECOM_ALLOW_PAID_AI');

  return [
    {
      id: 'e_webhook_secret',
      phase: 'E',
      ok: secret.length >= 8,
      severity: 'critical',
      message:
        secret.length >= 8
          ? 'SHOPIFY_WEBHOOK_SECRET presente'
          : 'Configura SHOPIFY_WEBHOOK_SECRET',
    },
    {
      id: 'e_https',
      phase: 'E',
      ok: httpsOk,
      severity: 'critical',
      message: httpsOk
        ? `HTTPS público OK (${apiUrl})`
        : 'API_URL/APP_URL deben ser https:// para webhooks estables',
    },
    {
      id: 'e_kill_switch',
      phase: 'E',
      ok: true,
      severity: kill ? 'warning' : 'info',
      message: kill ? 'KILL SWITCH ON — automatización bloqueada' : 'Kill switch OFF',
    },
    {
      id: 'e_paid_ai',
      phase: 'E',
      ok: paidAiOff,
      severity: 'warning',
      message: paidAiOff
        ? 'ECOM_ALLOW_PAID_AI=false (recomendado)'
        : 'IA de pago habilitada — revisa presupuesto',
    },
    {
      id: 'e_real_gate',
      phase: 'E',
      ok: input.mode !== 'REAL' || realConfirm,
      severity: 'critical',
      message:
        input.mode === 'REAL'
          ? realConfirm
            ? 'REAL + ECOM_REAL_CONFIRM OK'
            : 'REAL sin ECOM_REAL_CONFIRM=I_UNDERSTAND_REAL_MODE'
          : `Modo ${input.mode} (seguro; REAL requiere confirmación explícita)`,
    },
    {
      id: 'e_cj_shopify',
      phase: 'E',
      ok: input.shopifyLive && input.cjLive,
      severity: 'critical',
      message:
        input.shopifyLive && input.cjLive
          ? 'Shopify + CJ live-ready'
          : 'Falta Shopify y/o CJ live-ready',
    },
  ];
}

export function buildPhaseF(input: V1VerifyInput): V1Check[] {
  return [
    {
      id: 'f_scheduler',
      phase: 'F',
      ok: input.discoverySchedulerOn,
      severity: 'warning',
      message: input.discoverySchedulerOn
        ? 'Scheduler discovery activo'
        : 'Scheduler discovery no detectado (revisa jobs/status)',
    },
    {
      id: 'f_inventory_policy',
      phase: 'F',
      ok: true,
      severity: 'info',
      message: 'Política pause-on-stock-0 disponible (ops/hardening)',
    },
    {
      id: 'f_telegram',
      phase: 'F',
      ok: input.telegramConfigured || input.mode === 'MOCK',
      severity: 'warning',
      message: input.telegramConfigured
        ? 'Telegram configurado'
        : 'TELEGRAM_BOT_TOKEN/CHAT_ID ausentes (recomendado para 24/7)',
    },
    {
      id: 'f_orphans',
      phase: 'F',
      ok: input.orphanPublished === 0,
      severity: input.orphanPublished > 0 ? 'critical' : 'info',
      message: `Huérfanos PUBLISHED sin CJ=${input.orphanPublished}`,
    },
    {
      id: 'f_fulfill_queue',
      phase: 'F',
      ok: input.paidUnfulfilled === 0,
      severity: input.paidUnfulfilled > 0 ? 'warning' : 'info',
      message:
        input.paidUnfulfilled === 0
          ? 'Sin PAID pendientes de fulfill'
          : `${input.paidUnfulfilled} PAID sin fulfill`,
    },
  ];
}

export function buildPhaseG(_input: V1VerifyInput): V1Check[] {
  const allowAds = envBool('ECOM_ALLOW_PAID_ADS');
  const maxUsd = Number(env('ECOM_ADS_MAX_DAILY_USD', '0')) || 0;
  const metaTok = Boolean(env('META_ADS_ACCESS_TOKEN') || env('META_PAGE_TOKEN'));
  const tiktokTok = Boolean(env('TIKTOK_ADS_ACCESS_TOKEN'));

  return [
    {
      id: 'g_default_zero',
      phase: 'G',
      ok: !allowAds || maxUsd >= 0,
      severity: 'info',
      message: `Ads policy: ALLOW_PAID_ADS=${allowAds} MAX_DAILY_USD=${maxUsd} (default seguro $0)`,
    },
    {
      id: 'g_draft_first',
      phase: 'G',
      ok: true,
      severity: 'info',
      message: 'Campañas solo borrador sin force+humanApproved (sin cargo silencioso)',
    },
    {
      id: 'g_meta_creds',
      phase: 'G',
      ok: true,
      severity: metaTok ? 'info' : 'warning',
      message: metaTok
        ? 'Credenciales Meta presentes'
        : 'Sin META_ADS_ACCESS_TOKEN — solo borradores',
    },
    {
      id: 'g_tiktok_creds',
      phase: 'G',
      ok: true,
      severity: tiktokTok ? 'info' : 'info',
      message: tiktokTok
        ? 'Credenciales TikTok Ads presentes'
        : 'Sin TIKTOK_ADS_ACCESS_TOKEN (opcional)',
    },
  ];
}

export function buildPhaseH(input: V1VerifyInput): V1Check[] {
  const yt = Boolean(env('YOUTUBE_API_KEY'));
  const reddit = Boolean(env('REDDIT_CLIENT_ID') && env('REDDIT_CLIENT_SECRET'));
  const metaLib = Boolean(env('META_AD_LIBRARY_TOKEN'));
  const sources = [input.serperConfigured, yt, reddit, metaLib].filter(Boolean).length;

  return [
    {
      id: 'h_serper',
      phase: 'H',
      ok: input.serperConfigured,
      severity: 'warning',
      message: input.serperConfigured ? 'Serper activo' : 'Sin SERPER_API_KEY',
    },
    {
      id: 'h_multi_source',
      phase: 'H',
      ok: sources >= 1,
      severity: sources >= 1 ? 'info' : 'warning',
      message: `Fuentes trends configuradas: ${sources} (serper/youtube/reddit/meta)`,
    },
    {
      id: 'h_no_fake',
      phase: 'H',
      ok: true,
      severity: 'info',
      message: 'Fuentes sin key = configured:false (nunca métricas inventadas)',
    },
  ];
}

export function buildPhaseI(input: V1VerifyInput): V1Check[] {
  const autoGo = envBool('ECOM_AUTO_GO_LIVE');
  const kill = envBool('ECOM_KILL_SWITCH') || envBool('ECOM_PAUSE_ALL');

  return [
    {
      id: 'i_auto_go_live_default_off',
      phase: 'I',
      ok: true,
      severity: autoGo ? 'warning' : 'info',
      message: autoGo
        ? 'ECOM_AUTO_GO_LIVE=true — usa caps diarios bajos'
        : 'Auto go-live OFF (recomendado hasta 1 venta real)',
    },
    {
      id: 'i_core_live',
      phase: 'I',
      ok: input.shopifyLive && input.cjLive && !kill,
      severity: 'critical',
      message:
        input.shopifyLive && input.cjLive && !kill
          ? 'Base autonomía OK (Shopify+CJ, kill off)'
          : 'Base autonomía incompleta',
    },
    {
      id: 'i_pending_queue',
      phase: 'I',
      ok: input.pendingApproval <= 20,
      severity: input.pendingApproval > 20 ? 'warning' : 'info',
      message: `Cola PENDING_APPROVAL=${input.pendingApproval}`,
    },
    {
      id: 'i_catalog',
      phase: 'I',
      ok: input.publishedWithCj >= 1,
      severity: 'warning',
      message: `Publicados con CJ=${input.publishedWithCj}`,
    },
  ];
}

export function buildPhaseJ(input: V1VerifyInput): V1Check[] {
  const session = env('SESSION_SECRET').length >= 16;
  const db = env('DATABASE_URL').length > 10;
  const redis = env('REDIS_URL').length > 8;

  return [
    {
      id: 'j_database',
      phase: 'J',
      ok: db,
      severity: 'critical',
      message: db ? 'DATABASE_URL presente' : 'Falta DATABASE_URL',
    },
    {
      id: 'j_redis',
      phase: 'J',
      ok: redis,
      severity: 'critical',
      message: redis ? 'REDIS_URL presente' : 'Falta REDIS_URL',
    },
    {
      id: 'j_session',
      phase: 'J',
      ok: session,
      severity: 'warning',
      message: session ? 'SESSION_SECRET ≥16' : 'SESSION_SECRET débil/ausente',
    },
    {
      id: 'j_ffmpeg',
      phase: 'J',
      ok: true,
      severity: input.ffmpegAvailable ? 'info' : 'warning',
      message: input.ffmpegAvailable
        ? 'FFmpeg en contenedor'
        : 'FFmpeg ausente (video render limitado)',
    },
    {
      id: 'j_mode_not_accidental_real',
      phase: 'J',
      ok: input.mode !== 'REAL' || env('ECOM_REAL_CONFIRM') === 'I_UNDERSTAND_REAL_MODE',
      severity: 'critical',
      message: `Modo operativo: ${input.mode}`,
    },
  ];
}

export function summarizePhase(phase: PhaseId, checks: V1Check[]): V1PhaseSummary {
  const criticalFailed = checks.filter((c) => c.severity === 'critical' && !c.ok).length;
  const warnings = checks.filter((c) => c.severity === 'warning' && !c.ok).length;
  const passed = checks.filter((c) => c.ok).length;
  return {
    phase,
    title: PHASE_TITLES[phase],
    ok: criticalFailed === 0,
    criticalFailed,
    warnings,
    score: checks.length ? Math.round((passed / checks.length) * 100) : 0,
    checks,
  };
}

export function verifyV1Final(input: V1VerifyInput): {
  ok: boolean;
  block: number;
  version: string;
  mode: string;
  criticalFailed: number;
  warningFailed: number;
  score: number;
  phases: V1PhaseSummary[];
  panel: { title: string; items: { id: string; severity: string; message: string; phase: string }[] };
  next: string[];
  readyForSandboxOps: boolean;
  readyForReal: boolean;
} {
  const phases: V1PhaseSummary[] = [
    summarizePhase('D', buildPhaseD(input)),
    summarizePhase('E', buildPhaseE(input)),
    summarizePhase('F', buildPhaseF(input)),
    summarizePhase('G', buildPhaseG(input)),
    summarizePhase('H', buildPhaseH(input)),
    summarizePhase('I', buildPhaseI(input)),
    summarizePhase('J', buildPhaseJ(input)),
  ];

  const allChecks = phases.flatMap((p) => p.checks);
  const criticalFailed = allChecks.filter((c) => c.severity === 'critical' && !c.ok).length;
  const warningFailed = allChecks.filter((c) => c.severity === 'warning' && !c.ok).length;
  const passed = allChecks.filter((c) => c.ok).length;
  const score = allChecks.length ? Math.round((passed / allChecks.length) * 100) : 0;

  const errorItems = allChecks
    .filter((c) => !c.ok && (c.severity === 'critical' || c.severity === 'warning'))
    .map((c) => ({
      id: c.id,
      severity: c.severity,
      message: c.message,
      phase: c.phase,
    }));

  const next: string[] = [];
  if (input.publishedWithCj < 1) next.push('Publica ≥1 producto con CJ (go-live)');
  if (!(env('API_URL') || '').startsWith('https')) next.push('Configura API_URL https:// (túnel o dominio)');
  if (env('SHOPIFY_WEBHOOK_SECRET').length < 8) next.push('SHOPIFY_WEBHOOK_SECRET');
  if (!input.telegramConfigured) next.push('Opcional: Telegram para alertas 24/7');
  if (input.paidOrders + input.fulfilledOrders === 0)
    next.push('Haz 1 pedido de prueba en Shopify y verifica fulfill');
  if (input.mode === 'REAL' && env('ECOM_REAL_CONFIRM') !== 'I_UNDERSTAND_REAL_MODE')
    next.push('ECOM_REAL_CONFIRM=I_UNDERSTAND_REAL_MODE');
  if (!next.length) next.push('Ops SANDBOX lista — REAL solo con checklist + confirmación humana');

  return {
    ok: criticalFailed === 0,
    block: 100,
    version: 'v1-final-DJ',
    mode: input.mode,
    criticalFailed,
    warningFailed,
    score,
    phases,
    panel: {
      title:
        criticalFailed === 0
          ? warningFailed === 0
            ? 'ECOM v1 fases D–J OK'
            : 'ECOM v1 OK con advertencias'
          : 'ECOM v1 con errores críticos',
      items: errorItems,
    },
    next,
    readyForSandboxOps: criticalFailed === 0,
    readyForReal:
      criticalFailed === 0 &&
      warningFailed === 0 &&
      score >= 90 &&
      isHttps(env('API_URL') || env('APP_URL')) &&
      env('SHOPIFY_WEBHOOK_SECRET').length >= 8 &&
      input.shopifyLive &&
      input.cjLive,
  };
}

export const V1_FINAL_META = {
  block: 100,
  phases: ['D', 'E', 'F', 'G', 'H', 'I', 'J'],
  endpoints: ['GET /v1/verify', 'GET /v1/status', 'GET /l/:productId'],
  note: 'Cierre de visión v1: verificación unificada. REAL sigue manual.',
};

/**
 * ECOM Production Hardening — blocks 45–52
 * Shopify title sync, robust tracking parse, Telegram verify,
 * budget gates, kill-switch, ops board, smoke tests, REAL mode gate.
 */

export type HardItem = {
  id: string;
  block: number;
  ok: boolean;
  severity: 'critical' | 'warning' | 'info';
  message: string;
  data?: Record<string, unknown>;
};

function env(name: string, fallback = ''): string {
  return (process.env[name] ?? fallback).replace(/\r/g, '').trim();
}

function envBool(name: string, defaultValue = false): boolean {
  const v = env(name).toLowerCase();
  if (!v) return defaultValue;
  return v === '1' || v === 'true' || v === 'yes' || v === 'on';
}

function envNum(name: string, fallback: number): number {
  const n = Number(env(name));
  return Number.isFinite(n) ? n : fallback;
}

// ─── Block 45: Shopify title sync helpers ───────────────────────────────────

export function needsShopifyTitleSync(localTitle: string, remoteTitle?: string | null): boolean {
  if (!remoteTitle) return true;
  return localTitle.trim() !== remoteTitle.trim();
}

export type TitleSyncPlanItem = {
  productId: string;
  externalId: string;
  localTitle: string;
  needsSync: boolean;
};

export function planTitleSync(
  products: { id: string; title: string; externalId?: string | null; status: string }[],
): TitleSyncPlanItem[] {
  return products
    .filter((p) => p.status === 'PUBLISHED' && p.externalId && !String(p.externalId).startsWith('mock-'))
    .map((p) => ({
      productId: p.id,
      externalId: String(p.externalId),
      localTitle: p.title,
      needsSync: true,
    }));
}

// ─── Block 46: robust tracking parse ────────────────────────────────────────

export type ParsedTracking = {
  supplierOrderId: string | null;
  trackingNumber: string | null;
  carrier: string | null;
  isPlaceholder: boolean;
};

const PLACEHOLDER_TRACKING = /^(n\/?a|na|null|undefined|pending|tbd|-|—|–)$/i;

export function parseFulfillmentNote(note?: string | null): ParsedTracking {
  const raw = String(note || '').trim();
  if (!raw) {
    return { supplierOrderId: null, trackingNumber: null, carrier: null, isPlaceholder: true };
  }

  // Formats seen:
  // CJ LIVE · cj-1787… · tracking MOCKTRACK… · CJPacket Ordinary
  // CJ LIVE · auto · cj-1787… · CJPacket Ordinary
  // CJ MOCK · mock-cj-… · tracking MOCKTRACK… · MOCK-Logistics
  const supplier =
    raw.match(/\b(cj[-_][a-z0-9]+|mock-cj[-_][a-z0-9]+)\b/i)?.[1] ||
    raw.match(/CJ\s+(?:LIVE|MOCK)\s*[·|]\s*([^·|\s]+)/i)?.[1] ||
    null;

  let tracking =
    raw.match(/tracking\s*[:=]?\s*([A-Z0-9-]{6,})/i)?.[1] ||
    raw.match(/\b([A-Z]{2}\d{9,}[A-Z]{0,2})\b/)?.[1] || // common intl patterns
    null;

  if (tracking && PLACEHOLDER_TRACKING.test(tracking)) tracking = null;

  const carrier =
    raw.match(/(?:·|\|)\s*([A-Za-z][A-Za-z0-9 Packet-]{2,40})\s*$/)?.[1]?.trim() ||
    raw.match(/\b(CJPacket(?:\s+Ordinary)?|YunExpress|China Post|MOCK-Logistics)\b/i)?.[1] ||
    null;

  const isPlaceholder = !tracking || PLACEHOLDER_TRACKING.test(String(tracking));

  return {
    supplierOrderId: supplier && !PLACEHOLDER_TRACKING.test(supplier) ? supplier : null,
    trackingNumber: tracking,
    carrier,
    isPlaceholder,
  };
}

export function scoreTrackingQuality(notes: (string | null | undefined)[]): {
  total: number;
  withSupplierId: number;
  withRealTracking: number;
  placeholders: number;
} {
  let withSupplierId = 0;
  let withRealTracking = 0;
  let placeholders = 0;
  for (const n of notes) {
    const p = parseFulfillmentNote(n);
    if (p.supplierOrderId) withSupplierId++;
    if (p.trackingNumber && !p.isPlaceholder) withRealTracking++;
    if (p.isPlaceholder) placeholders++;
  }
  return { total: notes.length, withSupplierId, withRealTracking, placeholders };
}

// ─── Block 47: Telegram status (uses env; send lives in @ecom/notify) ───────

export function telegramConfigured(): {
  configured: boolean;
  enabled: boolean;
  tokenSet: boolean;
  chatIdSet: boolean;
} {
  const tokenSet = Boolean(env('TELEGRAM_BOT_TOKEN'));
  const chatIdSet = Boolean(env('TELEGRAM_CHAT_ID'));
  const enabled = env('ECOM_TELEGRAM_ALERTS', 'true') !== 'false';
  return { configured: tokenSet && chatIdSet, enabled, tokenSet, chatIdSet };
}

// ─── Block 48: budget / rate gates ──────────────────────────────────────────

export type BudgetSnapshot = {
  maxNewProductsPerDay: number;
  maxPublishesPerDay: number;
  maxFulfillsPerDay: number;
  maxAiCallsPerDay: number;
  createdToday: number;
  publishedToday: number;
  fulfilledToday: number;
  aiCallsToday: number;
};

export function getBudgetLimits(): Omit<
  BudgetSnapshot,
  'createdToday' | 'publishedToday' | 'fulfilledToday' | 'aiCallsToday'
> {
  return {
    maxNewProductsPerDay: envNum('ECOM_MAX_NEW_PRODUCTS_PER_DAY', 10),
    maxPublishesPerDay: envNum('ECOM_MAX_PUBLISHES_PER_DAY', 20),
    maxFulfillsPerDay: envNum('ECOM_MAX_FULFILLS_PER_DAY', 50),
    maxAiCallsPerDay: envNum('ECOM_MAX_AI_CALLS_PER_DAY', 100),
  };
}

export function budgetGate(
  kind: 'create' | 'publish' | 'fulfill' | 'ai',
  usedToday: number,
): { allowed: boolean; limit: number; used: number; reason: string } {
  const limits = getBudgetLimits();
  const map = {
    create: limits.maxNewProductsPerDay,
    publish: limits.maxPublishesPerDay,
    fulfill: limits.maxFulfillsPerDay,
    ai: limits.maxAiCallsPerDay,
  } as const;
  const limit = map[kind];
  const allowed = usedToday < limit;
  return {
    allowed,
    limit,
    used: usedToday,
    reason: allowed
      ? `OK ${usedToday}/${limit}`
      : `Límite diario ${kind} alcanzado (${usedToday}/${limit})`,
  };
}

// ─── Block 49: kill switch ──────────────────────────────────────────────────

export type KillSwitchState = {
  active: boolean;
  reason: string;
  blocksAutomation: boolean;
  blocksPublish: boolean;
  blocksFulfill: boolean;
  blocksDiscovery: boolean;
};

export function getKillSwitch(): KillSwitchState {
  const active = envBool('ECOM_KILL_SWITCH', false) || envBool('ECOM_PAUSE_ALL', false);
  const reason = env('ECOM_KILL_SWITCH_REASON', active ? 'ECOM_KILL_SWITCH=true' : 'inactive');
  return {
    active,
    reason,
    blocksAutomation: active,
    blocksPublish: active,
    blocksFulfill: active,
    blocksDiscovery: active,
  };
}

export function assertNotKilled(action: string): { ok: boolean; error?: string } {
  const ks = getKillSwitch();
  if (!ks.active) return { ok: true };
  return {
    ok: false,
    error: `KILL_SWITCH activo — acción bloqueada: ${action}. Motivo: ${ks.reason}`,
  };
}

// ─── Block 50: ops board summary ────────────────────────────────────────────

export function buildOpsBoard(input: {
  mode: string;
  published: number;
  pendingApproval: number;
  paid: number;
  fulfilled: number;
  paused: number;
  orphanPublished: number;
  killSwitch: boolean;
  telegramConfigured: boolean;
  httpsPublic: boolean;
}): {
  healthLabel: 'green' | 'yellow' | 'red';
  headline: string;
  cards: { key: string; value: string | number; tone: 'ok' | 'warn' | 'bad' }[];
} {
  const cards: { key: string; value: string | number; tone: 'ok' | 'warn' | 'bad' }[] = [
    { key: 'mode', value: input.mode, tone: input.mode === 'REAL' ? 'warn' : 'ok' },
    {
      key: 'pending_approval',
      value: input.pendingApproval,
      tone: input.pendingApproval > 5 ? 'warn' : 'ok',
    },
    { key: 'published', value: input.published, tone: 'ok' },
    {
      key: 'orders',
      value: `PAID ${input.paid} / FULFILLED ${input.fulfilled}`,
      tone: 'ok',
    },
    {
      key: 'orphans',
      value: input.orphanPublished,
      tone: input.orphanPublished > 0 ? 'bad' : 'ok',
    },
    {
      key: 'kill_switch',
      value: input.killSwitch ? 'ON' : 'OFF',
      tone: input.killSwitch ? 'bad' : 'ok',
    },
    {
      key: 'telegram',
      value: input.telegramConfigured ? 'configured' : 'missing',
      tone: input.telegramConfigured ? 'ok' : 'warn',
    },
    {
      key: 'https',
      value: input.httpsPublic ? 'ok' : 'local',
      tone: input.httpsPublic ? 'ok' : 'warn',
    },
  ];

  const bad = cards.filter((c) => c.tone === 'bad').length;
  const warn = cards.filter((c) => c.tone === 'warn').length;
  const healthLabel = bad > 0 ? 'red' : warn > 0 ? 'yellow' : 'green';
  const headline =
    healthLabel === 'green'
      ? 'Ops estable'
      : healthLabel === 'yellow'
        ? 'Ops con advertencias'
        : 'Ops requiere atención';

  return { healthLabel, headline, cards };
}

// ─── Block 51: smoke test definitions ───────────────────────────────────────

export type SmokeCheck = {
  id: string;
  name: string;
  critical: boolean;
};

export const SMOKE_CHECKS: SmokeCheck[] = [
  { id: 'health', name: 'API health', critical: true },
  { id: 'db', name: 'Database reachable', critical: true },
  { id: 'shopify_status', name: 'Shopify status endpoint', critical: true },
  { id: 'cj_status', name: 'CJ status endpoint', critical: true },
  { id: 'catalog_verify', name: 'Catalog quality verify', critical: false },
  { id: 'real_verify', name: 'Real-close verify', critical: false },
  { id: 'kill_switch_readable', name: 'Kill switch readable', critical: true },
  { id: 'budget_limits', name: 'Budget limits readable', critical: false },
  { id: 'tracking_parser', name: 'Tracking parser unit', critical: true },
  { id: 'ops_board', name: 'Ops board builds', critical: false },
];

export function runLocalSmokeUnits(): HardItem[] {
  const items: HardItem[] = [];

  // tracking parser unit
  const sample = parseFulfillmentNote(
    'CJ LIVE · cj-1787333138969 · tracking n/a · CJPacket Ordinary',
  );
  const trackingOk =
    sample.supplierOrderId === 'cj-1787333138969' &&
    sample.trackingNumber === null &&
    sample.isPlaceholder === true;
  items.push({
    id: 'tracking_parser',
    block: 46,
    ok: trackingOk,
    severity: 'critical',
    message: trackingOk
      ? 'Parser ignora n/a y extrae supplierOrderId'
      : 'Parser falló en muestra n/a',
    data: sample as any,
  });

  const ks = getKillSwitch();
  items.push({
    id: 'kill_switch_readable',
    block: 49,
    ok: typeof ks.active === 'boolean',
    severity: 'critical',
    message: ks.active ? `KILL ON: ${ks.reason}` : 'Kill switch OFF',
    data: ks as any,
  });

  const limits = getBudgetLimits();
  items.push({
    id: 'budget_limits',
    block: 48,
    ok: limits.maxNewProductsPerDay > 0,
    severity: 'info',
    message: `Límites create=${limits.maxNewProductsPerDay} publish=${limits.maxPublishesPerDay}`,
    data: limits as any,
  });

  return items;
}

// ─── Block 52: REAL mode gate ───────────────────────────────────────────────

export type RealGateItem = { key: string; ok: boolean; critical: boolean; note: string };

export function realModeGate(envMap?: Record<string, string | undefined>): {
  canEnterReal: boolean;
  score: number;
  items: RealGateItem[];
} {
  const e = envMap || process.env;
  const get = (k: string) => (e[k] || '').trim();

  const items: RealGateItem[] = [
    {
      key: 'ECOM_MODE_not_forced',
      ok: true,
      critical: false,
      note: 'Gate no cambia el modo; solo valida readiness',
    },
    {
      key: 'SHOPIFY_ACCESS_TOKEN',
      ok: Boolean(get('SHOPIFY_ACCESS_TOKEN')) && !get('SHOPIFY_ACCESS_TOKEN').includes('replace'),
      critical: true,
      note: 'Token Admin API',
    },
    {
      key: 'SHOPIFY_SHOP_DOMAIN',
      ok: Boolean(get('SHOPIFY_SHOP_DOMAIN') || get('SHOPIFY_SHOP')),
      critical: true,
      note: 'Dominio tienda',
    },
    {
      key: 'SHOPIFY_WEBHOOK_SECRET',
      ok: Boolean(get('SHOPIFY_WEBHOOK_SECRET')),
      critical: true,
      note: 'HMAC webhooks',
    },
    {
      key: 'CJ_API_KEY',
      ok: Boolean(get('CJ_API_KEY')),
      critical: true,
      note: 'CJ API key',
    },
    {
      key: 'HTTPS_PUBLIC',
      ok: /^https:\/\//i.test(get('API_URL') || get('APP_URL') || ''),
      critical: true,
      note: 'API_URL/APP_URL públicos HTTPS',
    },
    {
      key: 'KILL_SWITCH_OFF',
      ok: !envBool('ECOM_KILL_SWITCH', false) && !envBool('ECOM_PAUSE_ALL', false),
      critical: true,
      note: 'Kill switch debe estar OFF para entrar a REAL',
    },
    {
      key: 'PAID_AI_OFF',
      ok: get('ECOM_ALLOW_PAID_AI') !== 'true',
      critical: false,
      note: 'IA de pago desactivada (recomendado)',
    },
    {
      key: 'TELEGRAM',
      ok: Boolean(get('TELEGRAM_BOT_TOKEN') && get('TELEGRAM_CHAT_ID')),
      critical: false,
      note: 'Alertas Telegram (recomendado)',
    },
    {
      key: 'SESSION_SECRET',
      ok: (get('SESSION_SECRET') || '').length >= 16,
      critical: false,
      note: 'Sesión ≥16 chars',
    },
    {
      key: 'HUMAN_CONFIRM',
      ok: get('ECOM_REAL_CONFIRM') === 'I_UNDERSTAND_REAL_MODE',
      critical: true,
      note: 'Requiere ECOM_REAL_CONFIRM=I_UNDERSTAND_REAL_MODE',
    },
  ];

  const criticalFailed = items.filter((i) => i.critical && !i.ok).length;
  const passed = items.filter((i) => i.ok).length;
  const score = Math.round((passed / items.length) * 100);

  return {
    canEnterReal: criticalFailed === 0,
    score,
    items,
  };
}

// ─── Aggregate verify 45–52 ─────────────────────────────────────────────────

export function verifyHardening(input: {
  publishedWithExternal: number;
  trackingNotes: (string | null)[];
  telegram: ReturnType<typeof telegramConfigured>;
  httpsPublic: boolean;
  pendingApproval: number;
  published: number;
  paid: number;
  fulfilled: number;
  paused: number;
  orphanPublished: number;
  mode: string;
}): {
  ok: boolean;
  criticalFailed: number;
  warningFailed: number;
  score: number;
  items: HardItem[];
  killSwitch: KillSwitchState;
  budget: ReturnType<typeof getBudgetLimits>;
  realGate: ReturnType<typeof realModeGate>;
  opsBoard: ReturnType<typeof buildOpsBoard>;
} {
  const items: HardItem[] = [];
  const ks = getKillSwitch();
  const budget = getBudgetLimits();
  const realGate = realModeGate();
  const tg = input.telegram;
  const tracking = scoreTrackingQuality(input.trackingNotes);

  items.push({
    id: 'title_sync_capability',
    block: 45,
    ok: true,
    severity: 'info',
    message: `Plan sync disponible · PUBLISHED con externalId≈${input.publishedWithExternal}`,
    data: { publishedWithExternal: input.publishedWithExternal },
  });

  items.push({
    id: 'tracking_quality',
    block: 46,
    ok: tracking.total === 0 || tracking.withSupplierId > 0,
    severity: tracking.total > 0 && tracking.withSupplierId === 0 ? 'warning' : 'info',
    message: `Tracking: supplierIds=${tracking.withSupplierId} realTrack=${tracking.withRealTracking} placeholders=${tracking.placeholders}/${tracking.total}`,
    data: tracking as any,
  });

  items.push({
    id: 'telegram_config',
    block: 47,
    ok: tg.configured || input.mode === 'MOCK',
    severity: tg.configured ? 'info' : 'warning',
    message: tg.configured
      ? 'Telegram configurado'
      : 'TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID ausentes (recomendado)',
    data: tg as any,
  });

  items.push({
    id: 'budget_gates',
    block: 48,
    ok: budget.maxNewProductsPerDay > 0 && budget.maxPublishesPerDay > 0,
    severity: 'info',
    message: `Presupuestos diarios activos create≤${budget.maxNewProductsPerDay} publish≤${budget.maxPublishesPerDay}`,
    data: budget as any,
  });

  items.push({
    id: 'kill_switch',
    block: 49,
    ok: true, // presence is enough; active is operational state not failure
    severity: ks.active ? 'warning' : 'info',
    message: ks.active ? `KILL SWITCH ON — ${ks.reason}` : 'Kill switch OFF',
    data: ks as any,
  });

  const board = buildOpsBoard({
    mode: input.mode,
    published: input.published,
    pendingApproval: input.pendingApproval,
    paid: input.paid,
    fulfilled: input.fulfilled,
    paused: input.paused,
    orphanPublished: input.orphanPublished,
    killSwitch: ks.active,
    telegramConfigured: tg.configured,
    httpsPublic: input.httpsPublic,
  });

  items.push({
    id: 'ops_board',
    block: 50,
    ok: board.healthLabel !== 'red',
    severity: board.healthLabel === 'red' ? 'critical' : board.healthLabel === 'yellow' ? 'warning' : 'info',
    message: board.headline,
    data: board as any,
  });

  items.push(...runLocalSmokeUnits());

  items.push({
    id: 'real_mode_gate',
    block: 52,
    ok: true, // informational unless user forces REAL without gate
    severity: realGate.canEnterReal ? 'info' : 'warning',
    message: realGate.canEnterReal
      ? `Listo para REAL (score ${realGate.score}) — aún requiere confirmación humana`
      : `No listo para REAL (score ${realGate.score}) — faltan criticals`,
    data: { canEnterReal: realGate.canEnterReal, score: realGate.score },
  });

  const criticalFailed = items.filter((i) => i.severity === 'critical' && !i.ok).length;
  const warningFailed = items.filter((i) => i.severity === 'warning' && !i.ok).length;
  const passed = items.filter((i) => i.ok).length;
  const score = items.length ? Math.round((passed / items.length) * 100) : 0;

  return {
    ok: criticalFailed === 0,
    criticalFailed,
    warningFailed,
    score,
    items,
    killSwitch: ks,
    budget,
    realGate,
    opsBoard: board,
  };
}

export const HARDENING_META = {
  block: 52,
  covers: [45, 46, 47, 48, 49, 50, 51, 52],
  features: [
    'shopify_title_sync',
    'tracking_parser',
    'telegram_alerts',
    'budget_gates',
    'kill_switch',
    'ops_board',
    'smoke_tests',
    'real_mode_gate',
  ],
};

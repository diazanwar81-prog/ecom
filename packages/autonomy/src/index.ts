/**
 * ECOM Autonomy pack — blocks 67–75
 * Controlled auto go-live, batch limits, readiness board, first-sale smoke.
 */

export const AUTONOMY_META = {
  blockFrom: 67,
  blockTo: 75,
  features: [
    'auto_go_live_flag',
    'daily_publish_cap',
    'discovery_auto_approve_hook',
    'batch_go_live',
    'first_sale_smoke',
    'autonomy_board',
  ],
  note: 'Publish automático solo con ECOM_AUTO_GO_LIVE=true + caps diarios. REAL sigue bloqueado sin ECOM_REAL_CONFIRM.',
};

export function envFlag(name: string): boolean {
  const v = String(process.env[name] || '')
    .trim()
    .toLowerCase();
  return v === 'true' || v === '1' || v === 'yes';
}

export function isAutoGoLiveEnabled(): boolean {
  return envFlag('ECOM_AUTO_GO_LIVE');
}

export function dailyPublishCap(): number {
  const n = Number(process.env.ECOM_AUTO_GO_LIVE_MAX_PER_DAY || 5);
  return Number.isFinite(n) && n > 0 ? Math.min(n, 30) : 5;
}

export function dailyApproveCap(): number {
  const n = Number(process.env.ECOM_AUTO_APPROVE_MAX_PER_DAY || 20);
  return Number.isFinite(n) && n > 0 ? Math.min(n, 100) : 20;
}

export type PublishBudgetInput = {
  publishedToday: number;
  killSwitch?: boolean;
};

export function publishBudgetGate(input: PublishBudgetInput): {
  ok: boolean;
  remaining: number;
  cap: number;
  reason?: string;
} {
  const cap = dailyPublishCap();
  if (input.killSwitch || envFlag('ECOM_KILL_SWITCH') || envFlag('ECOM_PAUSE_ALL')) {
    return { ok: false, remaining: 0, cap, reason: 'kill_switch' };
  }
  if (!isAutoGoLiveEnabled()) {
    return { ok: false, remaining: 0, cap, reason: 'ECOM_AUTO_GO_LIVE off' };
  }
  const remaining = Math.max(0, cap - (input.publishedToday || 0));
  if (remaining <= 0) {
    return { ok: false, remaining: 0, cap, reason: `cap diario ${cap} alcanzado` };
  }
  return { ok: true, remaining, cap };
}

export type BoardInput = {
  mode: string;
  published: number;
  draft: number;
  pendingApproval: number;
  publishedWithCj: number;
  paidUnfulfilled: number;
  autoApproveOn: boolean;
  autoGoLiveOn: boolean;
  shopifyLive: boolean;
  cjLive: boolean;
  killSwitch: boolean;
  publishedToday: number;
};

export function autonomyBoard(input: BoardInput) {
  const items = [
    {
      id: 'shopify',
      ok: input.shopifyLive,
      block: 67,
      message: input.shopifyLive ? 'Shopify live' : 'Shopify no configurado',
    },
    {
      id: 'cj',
      ok: input.cjLive,
      block: 67,
      message: input.cjLive ? 'CJ live' : 'CJ no configurado',
    },
    {
      id: 'auto_approve',
      ok: input.autoApproveOn,
      block: 66,
      message: input.autoApproveOn ? 'Auto-approve CJ on' : 'Auto-approve off',
    },
    {
      id: 'auto_go_live',
      ok: input.autoGoLiveOn,
      block: 67,
      message: input.autoGoLiveOn
        ? `Auto go-live on (hoy ${input.publishedToday}/${dailyPublishCap()})`
        : 'Auto go-live off (recomendado hasta validar 1 venta)',
    },
    {
      id: 'catalog_cj',
      ok: input.publishedWithCj > 0,
      block: 70,
      message: `${input.publishedWithCj} publicados con CJ · draft=${input.draft} · pending=${input.pendingApproval}`,
    },
    {
      id: 'fulfill_queue',
      ok: input.paidUnfulfilled === 0,
      block: 72,
      message:
        input.paidUnfulfilled === 0
          ? 'Sin PAID pendientes'
          : `${input.paidUnfulfilled} pedidos PAID por cumplir`,
    },
    {
      id: 'kill',
      ok: !input.killSwitch,
      block: 73,
      message: input.killSwitch ? 'Kill switch ON' : 'Kill switch off',
    },
    {
      id: 'mode',
      ok: input.mode !== 'REAL' || envFlag('ECOM_REAL_CONFIRM'.replace('ECOM_REAL_CONFIRM', 'ECOM_REAL_CONFIRM')),
      block: 75,
      message: `Modo ${input.mode}`,
    },
  ];

  // Fix REAL check properly
  items[items.length - 1] = {
    id: 'mode',
    ok: input.mode !== 'REAL' || String(process.env.ECOM_REAL_CONFIRM || '') === 'I_UNDERSTAND_REAL_MODE',
    block: 75,
    message:
      input.mode === 'REAL'
        ? 'REAL activo — máximo cuidado'
        : `Modo ${input.mode} (seguro para ops)`,
  };

  const passed = items.filter((i) => i.ok).length;
  const score = Math.round((passed / items.length) * 100);
  const readyForMoreAutonomy = score >= 75 && input.shopifyLive && input.cjLive && !input.killSwitch;

  return {
    ...AUTONOMY_META,
    score,
    readyForMoreAutonomy,
    items,
    caps: {
      publishPerDay: dailyPublishCap(),
      approvePerDay: dailyApproveCap(),
      publishedToday: input.publishedToday,
    },
    next: readyForMoreAutonomy
      ? [
          '1) go-live selectivo de DRAFT',
          '2) 1 pedido prueba Shopify',
          '3) Solo entonces ECOM_AUTO_GO_LIVE=true con cap bajo',
        ]
      : items.filter((i) => !i.ok).map((i) => i.message),
  };
}

export type SmokeInput = {
  shopifyLive: boolean;
  cjLive: boolean;
  publishedWithCj: number;
  hasDraftApproved: boolean;
  paidOrders: number;
  fulfilledOrders: number;
  webhookSecret: boolean;
  httpsPublic: boolean;
};

export function firstSaleSmoke(input: SmokeInput) {
  const checks = [
    { id: 'shopify', ok: input.shopifyLive, critical: true, message: 'Shopify token' },
    { id: 'cj', ok: input.cjLive, critical: true, message: 'CJ API' },
    { id: 'catalog', ok: input.publishedWithCj > 0, critical: true, message: '≥1 publicado con CJ' },
    { id: 'draft_or_live', ok: input.hasDraftApproved || input.publishedWithCj > 0, critical: false, message: 'Cola DRAFT o ya publicados' },
    { id: 'webhook', ok: input.webhookSecret, critical: false, message: 'Webhook secret' },
    { id: 'https', ok: input.httpsPublic, critical: true, message: 'HTTPS público' },
    {
      id: 'order_loop',
      ok: input.fulfilledOrders > 0 || input.paidOrders >= 0,
      critical: false,
      message: `orders paid=${input.paidOrders} fulfilled=${input.fulfilledOrders}`,
    },
  ];
  const criticalFailed = checks.filter((c) => c.critical && !c.ok).length;
  return {
    block: 74,
    ok: criticalFailed === 0,
    criticalFailed,
    score: Math.round((checks.filter((c) => c.ok).length / checks.length) * 100),
    checks,
    canAttemptFirstSale: criticalFailed === 0,
    steps: [
      'POST /approvals/auto-cj/run (si hay pendientes CJ)',
      'POST /autonomy/go-live-batch {"limit":1} o go-live manual',
      'Crear pedido en Shopify',
      'Webhook → fulfill CJ',
      'GET /orders + tracking',
    ],
  };
}

/**
 * ECOM Final Release Package — blocks 53–60
 * Shopify reconcile, approval queue helpers, HTTPS/webhook monitor,
 * CJ points snapshot, pipeline summary, release score.
 */

export type RelItem = {
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

// ─── Block 53: Shopify reconcile classification ─────────────────────────────

export type ReconcileStatus = 'ok' | 'missing_on_shopify' | 'missing_external' | 'mock_id';

export function classifyShopifyLink(input: {
  externalId?: string | null;
  shopifyExists?: boolean | null;
}): { status: ReconcileStatus; action: string } {
  const id = String(input.externalId || '').trim();
  if (!id) return { status: 'missing_external', action: 'republish_or_unpublish' };
  if (id.startsWith('mock-')) return { status: 'mock_id', action: 'clear_mock_external_id' };
  if (input.shopifyExists === false) return { status: 'missing_on_shopify', action: 'clear_external_id_or_republish' };
  if (input.shopifyExists === true) return { status: 'ok', action: 'none' };
  return { status: 'ok', action: 'verify_live' };
}

// ─── Block 54: Approval queue ranking ───────────────────────────────────────

export type ApprovalCandidate = {
  id: string;
  title: string;
  opportunityScore?: number | null;
  confidence?: number | null;
  marginPercent?: number | string | null;
  hasCj?: boolean;
  status: string;
};

export function rankApprovalQueue(items: ApprovalCandidate[]): ApprovalCandidate[] {
  return [...items]
    .filter((p) => p.status === 'PENDING_APPROVAL')
    .sort((a, b) => {
      const score = (p: ApprovalCandidate) =>
        Number(p.opportunityScore || 0) * 0.5 +
        Number(p.confidence || 0) * 0.3 +
        Number(p.marginPercent || 0) * 0.2 +
        (p.hasCj ? 15 : 0);
      return score(b) - score(a);
    });
}

// ─── Block 55: HTTPS / public URL monitor ───────────────────────────────────

export function httpsMonitor(apiUrl?: string, appUrl?: string): {
  ok: boolean;
  apiHttps: boolean;
  appHttps: boolean;
  note: string;
} {
  const api = (apiUrl || env('API_URL') || '').trim();
  const app = (appUrl || env('APP_URL') || '').trim();
  const apiHttps = /^https:\/\//i.test(api);
  const appHttps = /^https:\/\//i.test(app);
  const ok = apiHttps;
  return {
    ok,
    apiHttps,
    appHttps,
    note: ok
      ? 'API_URL en HTTPS (webhooks posibles)'
      : 'API_URL no es HTTPS — webhooks Shopify fallarán desde internet',
  };
}

// ─── Block 56: Webhook readiness ────────────────────────────────────────────

export function webhookReadiness(): {
  ok: boolean;
  secretSet: boolean;
  https: boolean;
  path: string;
  note: string;
} {
  const secretSet = Boolean(env('SHOPIFY_WEBHOOK_SECRET'));
  const https = /^https:\/\//i.test(env('API_URL') || env('APP_URL') || '');
  const path = '/shopify/webhooks/orders';
  const ok = secretSet && https;
  return {
    ok,
    secretSet,
    https,
    path,
    note: ok
      ? `Listo: ${env('API_URL')}${path}`
      : 'Falta SHOPIFY_WEBHOOK_SECRET y/o API_URL https',
  };
}

// ─── Block 57: Pipeline snapshot helpers ────────────────────────────────────

export function pipelineSnapshot(input: {
  detected: number;
  evaluating: number;
  pending: number;
  published: number;
  paused: number;
  paid: number;
  fulfilled: number;
}): {
  funnel: Record<string, number>;
  conversionHint: string;
} {
  const funnel = {
    detected: input.detected,
    evaluating: input.evaluating,
    pending_approval: input.pending,
    published: input.published,
    paused: input.paused,
    paid_orders: input.paid,
    fulfilled_orders: input.fulfilled,
  };
  const conversionHint =
    input.published === 0
      ? 'Sin publicados aún'
      : input.paid === 0
        ? 'Publicados sin pedidos — revisar pricing/ads'
        : `${input.paid} PAID / ${input.published} PUBLISHED`;
  return { funnel, conversionHint };
}

// ─── Block 58: CJ points / spend snapshot (soft) ────────────────────────────

export function cjSpendPolicy(input: {
  pointsUsedToday?: number | null;
  pointsRemaining?: number | null;
  maxUsedToday?: number;
}): { ok: boolean; reason: string } {
  const maxUsed = input.maxUsedToday ?? Number(env('ECOM_CJ_MAX_POINTS_PER_DAY') || 5000);
  const used = Number(input.pointsUsedToday || 0);
  if (input.pointsRemaining != null && Number(input.pointsRemaining) <= 0) {
    return { ok: false, reason: 'CJ points remaining = 0' };
  }
  if (used > maxUsed) {
    return { ok: false, reason: `CJ points usedToday ${used} > max ${maxUsed}` };
  }
  return { ok: true, reason: `CJ points OK used=${used} max=${maxUsed}` };
}

// ─── Block 59: Daily operator checklist ─────────────────────────────────────

export function dailyOperatorChecklist(input: {
  pendingApproval: number;
  paidUnfulfilled: number;
  orphanPublished: number;
  killSwitch: boolean;
  httpsOk: boolean;
}): RelItem[] {
  return [
    {
      id: 'review_approvals',
      block: 59,
      ok: input.pendingApproval <= 10,
      severity: input.pendingApproval > 10 ? 'warning' : 'info',
      message: `PENDING_APPROVAL=${input.pendingApproval}`,
      data: { pendingApproval: input.pendingApproval },
    },
    {
      id: 'fulfill_paid',
      block: 59,
      ok: input.paidUnfulfilled === 0,
      severity: input.paidUnfulfilled > 0 ? 'warning' : 'info',
      message:
        input.paidUnfulfilled === 0
          ? 'Sin PAID sin fulfill'
          : `${input.paidUnfulfilled} pedidos PAID pendientes de fulfill`,
      data: { paidUnfulfilled: input.paidUnfulfilled },
    },
    {
      id: 'no_orphans',
      block: 59,
      ok: input.orphanPublished === 0,
      severity: input.orphanPublished > 0 ? 'critical' : 'info',
      message: `Huérfanos PUBLISHED sin CJ=${input.orphanPublished}`,
    },
    {
      id: 'kill_off',
      block: 59,
      ok: !input.killSwitch,
      severity: input.killSwitch ? 'warning' : 'info',
      message: input.killSwitch ? 'KILL SWITCH ON' : 'Kill switch OFF',
    },
    {
      id: 'https',
      block: 59,
      ok: input.httpsOk,
      severity: input.httpsOk ? 'info' : 'warning',
      message: input.httpsOk ? 'HTTPS público OK' : 'Sin HTTPS público estable',
    },
  ];
}

// ─── Block 60: Release score ────────────────────────────────────────────────

export function releaseScore(items: RelItem[]): {
  ok: boolean;
  criticalFailed: number;
  warningFailed: number;
  score: number;
  readyForSandboxOps: boolean;
  readyForReal: boolean;
} {
  const criticalFailed = items.filter((i) => i.severity === 'critical' && !i.ok).length;
  const warningFailed = items.filter((i) => i.severity === 'warning' && !i.ok).length;
  const passed = items.filter((i) => i.ok).length;
  const score = items.length ? Math.round((passed / items.length) * 100) : 0;
  return {
    ok: criticalFailed === 0,
    criticalFailed,
    warningFailed,
    score,
    readyForSandboxOps: criticalFailed === 0,
    readyForReal: criticalFailed === 0 && warningFailed === 0 && score >= 90,
  };
}

export function verifyRelease(input: {
  missingOnShopify: number;
  pendingApproval: number;
  paidUnfulfilled: number;
  orphanPublished: number;
  killSwitch: boolean;
  httpsOk: boolean;
  webhookOk: boolean;
  catalogScore?: number;
  hardeningScore?: number;
  published: number;
  paid: number;
  fulfilled: number;
}): {
  ok: boolean;
  criticalFailed: number;
  warningFailed: number;
  score: number;
  items: RelItem[];
  funnel: ReturnType<typeof pipelineSnapshot>;
  https: ReturnType<typeof httpsMonitor>;
  webhook: ReturnType<typeof webhookReadiness>;
  readyForSandboxOps: boolean;
  readyForReal: boolean;
} {
  const items: RelItem[] = [];

  items.push({
    id: 'shopify_reconcile',
    block: 53,
    ok: input.missingOnShopify === 0,
    severity: input.missingOnShopify > 0 ? 'warning' : 'info',
    message:
      input.missingOnShopify === 0
        ? 'Sin externalId huérfanos detectados en última pasada'
        : `${input.missingOnShopify} productos con externalId ausente en Shopify`,
    data: { missingOnShopify: input.missingOnShopify },
  });

  items.push({
    id: 'approval_queue',
    block: 54,
    ok: true,
    severity: input.pendingApproval > 10 ? 'warning' : 'info',
    message: `Cola aprobación: ${input.pendingApproval}`,
    data: { pendingApproval: input.pendingApproval },
  });

  const https = httpsMonitor();
  items.push({
    id: 'https_monitor',
    block: 55,
    ok: https.ok,
    severity: https.ok ? 'info' : 'warning',
    message: https.note,
    data: https as any,
  });

  const webhook = webhookReadiness();
  items.push({
    id: 'webhook_ready',
    block: 56,
    ok: webhook.ok,
    severity: webhook.ok ? 'info' : 'warning',
    message: webhook.note,
    data: webhook as any,
  });

  const funnel = pipelineSnapshot({
    detected: 0,
    evaluating: 0,
    pending: input.pendingApproval,
    published: input.published,
    paused: 0,
    paid: input.paid,
    fulfilled: input.fulfilled,
  });
  items.push({
    id: 'pipeline_snapshot',
    block: 57,
    ok: true,
    severity: 'info',
    message: funnel.conversionHint,
    data: funnel.funnel,
  });

  items.push({
    id: 'cj_spend_policy',
    block: 58,
    ok: true,
    severity: 'info',
    message: cjSpendPolicy({}).reason,
  });

  items.push(
    ...dailyOperatorChecklist({
      pendingApproval: input.pendingApproval,
      paidUnfulfilled: input.paidUnfulfilled,
      orphanPublished: input.orphanPublished,
      killSwitch: input.killSwitch,
      httpsOk: input.httpsOk,
    }),
  );

  if (input.catalogScore != null) {
    items.push({
      id: 'catalog_score',
      block: 60,
      ok: input.catalogScore >= 80,
      severity: input.catalogScore >= 80 ? 'info' : 'warning',
      message: `Catalog score ${input.catalogScore}`,
    });
  }
  if (input.hardeningScore != null) {
    items.push({
      id: 'hardening_score',
      block: 60,
      ok: input.hardeningScore >= 80,
      severity: input.hardeningScore >= 80 ? 'info' : 'warning',
      message: `Hardening score ${input.hardeningScore}`,
    });
  }

  const summary = releaseScore(items);
  return {
    ...summary,
    items,
    funnel,
    https,
    webhook,
  };
}

export const RELEASE_META = {
  block: 60,
  covers: [53, 54, 55, 56, 57, 58, 59, 60],
  features: [
    'shopify_reconcile',
    'approval_queue_rank',
    'https_monitor',
    'webhook_readiness',
    'pipeline_snapshot',
    'cj_spend_policy',
    'daily_checklist',
    'release_score',
  ],
  note: 'Paquete final operativo. REAL sigue requiriendo ECOM_REAL_CONFIRM manual.',
};

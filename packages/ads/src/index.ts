/**
 * ECOM Ads — block 35
 * Controlled paid ads. Default budget $0. Never auto-spend without explicit approval.
 */

export type AdPlatform = 'meta' | 'google' | 'tiktok';

export type AdCampaignDraft = {
  platform: AdPlatform;
  name: string;
  dailyBudgetUsd: number;
  status: 'DRAFT' | 'PENDING_APPROVAL' | 'ACTIVE' | 'PAUSED' | 'BLOCKED';
  canGoLive: boolean;
  reason: string;
  objective: string;
  targetingHint: string;
};

function env(k: string): string | undefined {
  return process.env[k]?.trim() || undefined;
}

function allowPaidAds(): boolean {
  return String(process.env.ECOM_ALLOW_PAID_ADS || 'false').toLowerCase() === 'true';
}

function maxDailyBudgetUsd(): number {
  const n = Number(process.env.ECOM_ADS_MAX_DAILY_USD || 0);
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

export function getAdsStatus() {
  const max = maxDailyBudgetUsd();
  const allow = allowPaidAds();
  return {
    block: 35,
    allowPaidAds: allow,
    maxDailyBudgetUsd: max,
    defaultBudgetUsd: 0,
    platforms: {
      meta: Boolean(env('META_ADS_ACCESS_TOKEN') || env('META_PAGE_TOKEN')),
      google: Boolean(env('GOOGLE_ADS_DEVELOPER_TOKEN')),
      tiktok: Boolean(env('TIKTOK_ADS_ACCESS_TOKEN')),
    },
    policy:
      'Presupuesto por defecto $0. Ninguna campaña se activa sin ECOM_ALLOW_PAID_ADS=true + aprobación humana + budget > 0.',
  };
}

export function buildCampaignDraft(input: {
  platform?: AdPlatform;
  productTitle: string;
  dailyBudgetUsd?: number;
  objective?: string;
}): AdCampaignDraft {
  const platform = input.platform || 'meta';
  const requested = Number(input.dailyBudgetUsd ?? 0);
  const max = maxDailyBudgetUsd();
  const allow = allowPaidAds();
  const creds = getAdsStatus().platforms[platform];

  let status: AdCampaignDraft['status'] = 'DRAFT';
  let canGoLive = false;
  let reason = 'Borrador seguro — sin gasto';

  if (!allow) {
    status = 'BLOCKED';
    reason = 'ECOM_ALLOW_PAID_ADS=false (por defecto). Ads de pago deshabilitados.';
  } else if (max <= 0) {
    status = 'BLOCKED';
    reason = 'ECOM_ADS_MAX_DAILY_USD=0 — techo diario en cero.';
  } else if (requested <= 0) {
    status = 'DRAFT';
    reason = 'Budget solicitado $0 — solo borrador.';
  } else if (requested > max) {
    status = 'BLOCKED';
    reason = `Budget ${requested} USD supera techo diario ${max} USD.`;
  } else if (!creds) {
    status = 'DRAFT';
    reason = `Sin credenciales ${platform} — no se puede ir live.`;
  } else {
    status = 'PENDING_APPROVAL';
    canGoLive = false;
    reason = 'Requiere aprobación humana explícita antes de activar gasto.';
  }

  return {
    platform,
    name: `ECOM · ${(input.productTitle || 'producto').slice(0, 40)}`,
    dailyBudgetUsd: requested,
    status,
    canGoLive,
    reason,
    objective: input.objective || 'CONVERSIONS',
    targetingHint: 'CO · intereses retail / home · excluir low quality',
  };
}

/** Never activates spend without force + allow + budget + approval flag */
export function attemptActivateCampaign(
  draft: AdCampaignDraft,
  opts: { force?: boolean; humanApproved?: boolean } = {},
): { ok: boolean; message: string; draft: AdCampaignDraft } {
  if (!allowPaidAds()) {
    return { ok: false, message: 'Paid ads disabled by env', draft };
  }
  if (draft.dailyBudgetUsd <= 0 || draft.dailyBudgetUsd > maxDailyBudgetUsd()) {
    return { ok: false, message: 'Budget out of policy range', draft };
  }
  if (!opts.humanApproved) {
    return {
      ok: false,
      message: 'Falta humanApproved=true',
      draft: { ...draft, status: 'PENDING_APPROVAL' },
    };
  }
  if (!opts.force) {
    return { ok: false, message: 'Requiere force=true para activar', draft };
  }
  // Live adapter not fully wired — refuse silent success
  return {
    ok: false,
    message:
      'Adapter de ads live aún no implementado; campaña permanece en borrador (sin cargo real).',
    draft: { ...draft, status: 'DRAFT' },
  };
}

export const ADS_META = {
  block: 35,
  defaultBudgetUsd: 0,
  requireHumanApproval: true,
};

/**
 * ECOM Auto-approval for CJ-linked products (block 66)
 * Never bypasses margin/stock gates. Opt-in via ECOM_AUTO_APPROVE_CJ=true.
 */

export type AutoApproveCandidate = {
  id: string;
  title: string;
  status: string;
  isFirstPublication?: boolean;
  marginPercent?: number | null;
  marginBand?: string | null;
  canPublish?: boolean;
  shouldPause?: boolean;
  verified?: boolean;
  cjVariantId?: string | null;
  cjSku?: string | null;
  opportunityScore?: number | null;
  confidence?: number | null;
};

export type AutoApproveDecision = {
  productId: string;
  ok: boolean;
  action: 'APPROVE' | 'SKIP' | 'BLOCK';
  reasons: string[];
};

export const AUTO_APPROVE_META = {
  block: 66,
  feature: 'auto_approve_cj',
  note: 'Solo productos con cjVariantId/cjSku, margen publicable, stock ok. Requiere ECOM_AUTO_APPROVE_CJ=true.',
};

export function isAutoApproveEnabled(): boolean {
  const v = String(process.env.ECOM_AUTO_APPROVE_CJ || '')
    .trim()
    .toLowerCase();
  return v === 'true' || v === '1' || v === 'yes';
}

export function minConfidenceForAuto(): number {
  const n = Number(process.env.ECOM_AUTO_APPROVE_MIN_CONFIDENCE || 80);
  return Number.isFinite(n) ? n : 80;
}

export function minOpportunityForAuto(): number {
  const n = Number(process.env.ECOM_AUTO_APPROVE_MIN_OPP || 55);
  return Number.isFinite(n) ? n : 55;
}

/** Decide if a single product may be auto-approved (not published). */
export function decideAutoApprove(p: AutoApproveCandidate): AutoApproveDecision {
  const reasons: string[] = [];

  if (!isAutoApproveEnabled()) {
    return {
      productId: p.id,
      ok: false,
      action: 'SKIP',
      reasons: ['ECOM_AUTO_APPROVE_CJ no activo'],
    };
  }

  if (p.status === 'PUBLISHED' || p.status === 'REJECTED' || p.status === 'PAUSED') {
    return {
      productId: p.id,
      ok: false,
      action: 'SKIP',
      reasons: [`status=${p.status}`],
    };
  }

  const hasCj = Boolean(p.cjVariantId || p.cjSku);
  if (!hasCj) {
    reasons.push('Sin cjVariantId/cjSku');
  }
  if (p.verified === false) {
    reasons.push('Proveedor no verificado');
  }
  if (p.shouldPause) {
    reasons.push('shouldPause=true (margen o stock)');
  }
  if (p.canPublish === false) {
    reasons.push('canPublish=false');
  }
  const band = String(p.marginBand || '').toUpperCase();
  if (band === 'PAUSE' || band === 'ALERT') {
    reasons.push(`marginBand=${band}`);
  }
  const conf = p.confidence ?? 0;
  if (conf < minConfidenceForAuto()) {
    reasons.push(`confianza ${conf} < ${minConfidenceForAuto()}`);
  }
  const opp = p.opportunityScore ?? 0;
  if (opp < minOpportunityForAuto()) {
    reasons.push(`opportunity ${opp} < ${minOpportunityForAuto()}`);
  }

  if (reasons.length) {
    return { productId: p.id, ok: false, action: 'BLOCK', reasons };
  }

  return {
    productId: p.id,
    ok: true,
    action: 'APPROVE',
    reasons: ['CJ link + reglas OK'],
  };
}

export function filterAutoApprovable(
  items: AutoApproveCandidate[],
): { approve: AutoApproveCandidate[]; blocked: AutoApproveDecision[]; skipped: AutoApproveDecision[] } {
  const approve: AutoApproveCandidate[] = [];
  const blocked: AutoApproveDecision[] = [];
  const skipped: AutoApproveDecision[] = [];
  for (const p of items) {
    const d = decideAutoApprove(p);
    if (d.action === 'APPROVE') approve.push(p);
    else if (d.action === 'BLOCK') blocked.push(d);
    else skipped.push(d);
  }
  return { approve, blocked, skipped };
}

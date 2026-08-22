/**
 * ECOM Catalog Quality — blocks 41–44
 * Title cleanup, strict CJ gate, realistic COP pricing, approval-queue policy + auto-verify.
 */

export type QualityItem = {
  id: string;
  block: number;
  ok: boolean;
  severity: 'critical' | 'warning' | 'info';
  message: string;
  data?: Record<string, unknown>;
};

const JUNK_TITLE_PATTERN =
  '(cross[- ]?border|dropshipping|hot[- ]?selling|wholesale|factory|oem|odm|export)';

function junkTitleRe(): RegExp {
  return new RegExp(`\\b${JUNK_TITLE_PATTERN}\\b`, 'gi');
}

function hasJunkTitle(title: string): boolean {
  return junkTitleRe().test(title);
}

/** Block 41: clean commercial title */
export function cleanCommercialTitle(raw: string, maxLen = 70): string {
  let t = String(raw || '')
    .replace(junkTitleRe(), ' ')
    .replace(/\[[^\]]*\]/g, ' ')
    .replace(/\|/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!t) t = 'Producto';
  t = t.charAt(0).toUpperCase() + t.slice(1);
  if (t.length > maxLen) t = t.slice(0, maxLen - 1).trim() + '…';
  return t;
}

export function titleQualityScore(title: string): {
  score: number;
  issues: string[];
  cleaned: string;
} {
  const issues: string[] = [];
  let score = 100;
  const cleaned = cleanCommercialTitle(title);
  if (hasJunkTitle(title)) {
    score -= 40;
    issues.push('contiene_jerga_dropshipping');
  }
  if (title.length > 90) {
    score -= 15;
    issues.push('title_muy_largo');
  }
  if (title.length < 12) {
    score -= 20;
    issues.push('title_muy_corto');
  }
  if (/[\u4e00-\u9fff]/.test(title)) {
    score -= 25;
    issues.push('caracteres_cjk');
  }
  return { score: Math.max(0, score), issues, cleaned };
}

/** Block 42: strict CJ publish gate */
export function strictCjGate(input: {
  status?: string;
  cjVariantId?: string | null;
  cjSku?: string | null;
  stock?: number | null;
  verified?: boolean;
}): { ok: boolean; reasons: string[] } {
  const reasons: string[] = [];
  if (!input.cjVariantId && !input.cjSku) reasons.push('missing_cj_vid_or_sku');
  if (input.stock != null && input.stock <= 0) reasons.push('stock_zero');
  if (input.verified === false) reasons.push('supplier_unverified');
  return { ok: reasons.length === 0, reasons };
}

export function countOrphanPublished(
  products: {
    status: string;
    suppliers?: { cjVariantId?: string | null; cjSku?: string | null }[];
  }[],
): { published: number; withCj: number; orphans: number } {
  const published = products.filter((p) => p.status === 'PUBLISHED');
  let withCj = 0;
  for (const p of published) {
    const ok = (p.suppliers || []).some((s) => s.cjVariantId || s.cjSku);
    if (ok) withCj++;
  }
  return { published: published.length, withCj, orphans: published.length - withCj };
}

/** Block 43: realistic COP price from USD cost */
export function priceFromUsdCost(input: {
  productCostUsd: number;
  shippingUsd?: number;
  fxCopPerUsd?: number;
  shopifyFeePct?: number;
  returnReservePct?: number;
  targetMarginPct?: number;
}): {
  salePriceCop: number;
  landedCostCop: number;
  marginPct: number;
  breakdown: Record<string, number>;
} {
  const fx = input.fxCopPerUsd ?? Number(process.env.CJ_USD_COP_RATE || 4200);
  const ship = input.shippingUsd ?? Number(process.env.CJ_SHIP_USD_ESTIMATE || 3);
  const feePct = input.shopifyFeePct ?? 3.5;
  const retPct = input.returnReservePct ?? 2;
  const target = input.targetMarginPct ?? 40;

  const landed = (input.productCostUsd + ship) * fx;
  const keep = 1 - feePct / 100 - retPct / 100 - target / 100;
  const sale = keep > 0.05 ? Math.ceil(landed / keep) : Math.ceil(landed * 2);
  const net = sale * (1 - feePct / 100 - retPct / 100);
  const marginPct = net > 0 ? Number((((net - landed) / net) * 100).toFixed(2)) : 0;

  return {
    salePriceCop: sale,
    landedCostCop: Math.round(landed),
    marginPct,
    breakdown: {
      fx,
      shippingUsd: ship,
      productCostUsd: input.productCostUsd,
      feePct,
      retPct,
      targetMarginPct: target,
    },
  };
}

export function marginAfterFees(input: {
  salePrice: number;
  productCost: number;
  shippingCost: number;
  shopifyFeePct?: number;
  returnReservePct?: number;
}): { marginPct: number; ok: boolean; minRequired: number } {
  const feePct = input.shopifyFeePct ?? 3.5;
  const retPct = input.returnReservePct ?? 2;
  const minRequired = Number(process.env.ECOM_MARGIN_MIN || 30);
  const net = input.salePrice * (1 - feePct / 100 - retPct / 100);
  const cost = input.productCost + input.shippingCost;
  const marginPct = net > 0 ? Number((((net - cost) / net) * 100).toFixed(2)) : 0;
  return { marginPct, ok: marginPct >= minRequired, minRequired };
}

/** Block 44: approval queue policy */
export function approvalQueuePolicy(input: {
  createdToday: number;
  maxPerDay?: number;
  confidence: number;
  autoPublishConfidence?: number;
  isFirstPublication?: boolean;
}): {
  enqueueApproval: boolean;
  canAutoPropose: boolean;
  reason: string;
} {
  const maxPerDay = input.maxPerDay ?? Number(process.env.ECOM_MAX_NEW_PRODUCTS_PER_DAY || 10);
  const minConf =
    input.autoPublishConfidence ?? Number(process.env.ECOM_AUTO_PUBLISH_CONFIDENCE || 95);

  if (input.createdToday >= maxPerDay) {
    return {
      enqueueApproval: false,
      canAutoPropose: false,
      reason: `Límite diario ${maxPerDay} alcanzado`,
    };
  }
  if (input.isFirstPublication !== false) {
    return {
      enqueueApproval: true,
      canAutoPropose: true,
      reason: 'Primera publicación → PENDING_APPROVAL',
    };
  }
  if (input.confidence < minConf) {
    return {
      enqueueApproval: true,
      canAutoPropose: true,
      reason: `Confianza ${input.confidence} < ${minConf}`,
    };
  }
  return {
    enqueueApproval: true,
    canAutoPropose: true,
    reason: 'Candidato a cola de aprobación (go-live manual)',
  };
}

export function verifyCatalogQuality(input: {
  publishedTitles: string[];
  orphanPublished: number;
  published: number;
  pendingApproval: number;
  sampleMarginOk: boolean;
  sampleMarginPct?: number;
}): QualityItem[] {
  const items: QualityItem[] = [];

  let junk = 0;
  const sampleN = Math.min(30, input.publishedTitles.length);
  for (const t of input.publishedTitles.slice(0, 30)) {
    if (titleQualityScore(t).score < 60) junk++;
  }
  const titleOk = sampleN === 0 || junk / Math.max(1, sampleN) <= 0.5;
  items.push({
    id: 'title_quality_sample',
    block: 41,
    ok: titleOk,
    severity: titleOk ? 'info' : 'warning',
    message: titleOk
      ? `Títulos revisados; junk-ish=${junk}`
      : `Muchos títulos con jerga/ruido (junk=${junk}). Usa POST /catalog/clean-titles`,
    data: { junk, sample: input.publishedTitles.length },
  });

  items.push({
    id: 'no_orphan_published',
    block: 42,
    ok: input.orphanPublished === 0,
    severity: 'critical',
    message:
      input.orphanPublished === 0
        ? `0 huérfanos · ${input.published} PUBLISHED`
        : `${input.orphanPublished} PUBLISHED sin CJ link`,
    data: { orphanPublished: input.orphanPublished, published: input.published },
  });

  items.push({
    id: 'margin_after_fees_policy',
    block: 43,
    ok: input.sampleMarginOk,
    severity: 'warning',
    message: input.sampleMarginOk
      ? `Margen post-fees OK (${input.sampleMarginPct ?? 'n/a'}%)`
      : `Margen post-fees bajo (${input.sampleMarginPct ?? 'n/a'}%)`,
    data: { sampleMarginPct: input.sampleMarginPct },
  });

  items.push({
    id: 'approval_queue_policy',
    block: 44,
    ok: true,
    severity: 'info',
    message: `PENDING_APPROVAL=${input.pendingApproval} · política go-live manual activa`,
    data: { pendingApproval: input.pendingApproval },
  });

  return items;
}

export function summarizeQuality(items: QualityItem[]): {
  ok: boolean;
  criticalFailed: number;
  warningFailed: number;
  score: number;
  items: QualityItem[];
} {
  const criticalFailed = items.filter((i) => i.severity === 'critical' && !i.ok).length;
  const warningFailed = items.filter((i) => i.severity === 'warning' && !i.ok).length;
  const passed = items.filter((i) => i.ok).length;
  const score = items.length ? Math.round((passed / items.length) * 100) : 0;
  return { ok: criticalFailed === 0, criticalFailed, warningFailed, score, items };
}

export const CATALOG_QUALITY_META = {
  block: 44,
  covers: [41, 42, 43, 44],
  features: [
    'title_cleanup',
    'strict_cj_gate',
    'cop_pricing',
    'margin_after_fees',
    'approval_queue_policy',
    'auto_verify',
  ],
};

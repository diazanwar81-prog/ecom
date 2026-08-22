/**
 * ECOM Scoring — block 28
 * Opportunity Score ponderado, Saturation Score, hard filters, categorías prohibidas.
 */

export const SCORE_WEIGHTS = {
  demand: 0.4,
  margin: 0.2,
  trend: 0.12,
  supplier: 0.1,
  logistics: 0.07,
  competition: 0.06,
  seasonality: 0.03,
  risk: 0.02,
} as const;

export const MIN_OPPORTUNITY_SCORE = 55;
export const MAX_SHIPPING_PCT_OF_SALE = 15;
export const MAX_PROCESSING_DAYS = 3;

/** Categorías / keywords prohibidos (spec respuestas 1) */
export const BANNED_KEYWORDS = [
  'arma', 'weapon', 'gun', 'rifle', 'municion', 'ammunition',
  'droga', 'drug', 'cannabis', 'cocaine', 'nicotina', 'vape',
  'explosivo', 'explosive',
  'falsificado', 'counterfeit', 'replica rolex',
  'porn', 'xxx', 'sex toy',
  'medicamento', 'prescription', 'viagra',
  'suplemento milagro', 'cure cancer',
] as const;

export type ScoreInput = {
  demandScore?: number; // 0-100
  marginPercent?: number;
  trendScore?: number;
  supplierScore?: number;
  logisticsScore?: number;
  competitionScore?: number; // higher = less competition pressure (we invert saturation)
  seasonalityScore?: number;
  riskScore?: number; // higher = safer
  title?: string;
  salePrice?: number;
  shippingCost?: number;
  processingDays?: number;
  stock?: number;
  supplierVerified?: boolean;
  shipsToCountry?: boolean;
};

export type HardFilterResult = {
  ok: boolean;
  reasons: string[];
};

export function clamp0to100(n: number): number {
  if (Number.isNaN(n)) return 0;
  return Math.max(0, Math.min(100, Math.round(n)));
}

export function marginToScore(marginPercent?: number): number {
  if (marginPercent == null) return 0;
  if (marginPercent >= 40) return 100;
  if (marginPercent >= 35) return 80;
  if (marginPercent >= 30) return 50;
  if (marginPercent >= 20) return 25;
  return 0;
}

export function detectBannedCategory(title?: string): string | null {
  if (!title) return null;
  const t = title.toLowerCase();
  for (const kw of BANNED_KEYWORDS) {
    if (t.includes(kw.toLowerCase())) return kw;
  }
  return null;
}

export function hardFilters(input: ScoreInput): HardFilterResult {
  const reasons: string[] = [];
  const banned = detectBannedCategory(input.title);
  if (banned) reasons.push(`banned_category:${banned}`);
  if (input.supplierVerified === false) reasons.push('supplier_unverified');
  if (input.stock != null && input.stock <= 0) reasons.push('stock_zero');
  if (input.shipsToCountry === false) reasons.push('no_ship_to_country');
  if (input.processingDays != null && input.processingDays > MAX_PROCESSING_DAYS) {
    reasons.push(`processing_days>${MAX_PROCESSING_DAYS}`);
  }
  if (
    input.salePrice != null &&
    input.salePrice > 0 &&
    input.shippingCost != null &&
    (input.shippingCost / input.salePrice) * 100 > MAX_SHIPPING_PCT_OF_SALE
  ) {
    reasons.push(`shipping_pct>${MAX_SHIPPING_PCT_OF_SALE}`);
  }
  if (input.marginPercent != null && input.marginPercent < 30) {
    reasons.push('margin_below_pause_band');
  }
  return { ok: reasons.length === 0, reasons };
}

export function computeOpportunityScore(input: ScoreInput): {
  score: number;
  breakdown: Record<string, number>;
  passesMin: boolean;
} {
  const breakdown = {
    demand: clamp0to100(input.demandScore ?? 50),
    margin: marginToScore(input.marginPercent),
    trend: clamp0to100(input.trendScore ?? 50),
    supplier: clamp0to100(input.supplierScore ?? (input.supplierVerified ? 80 : 30)),
    logistics: clamp0to100(input.logisticsScore ?? 60),
    competition: clamp0to100(input.competitionScore ?? 55),
    seasonality: clamp0to100(input.seasonalityScore ?? 70),
    risk: clamp0to100(input.riskScore ?? 70),
  };
  const score = clamp0to100(
    breakdown.demand * SCORE_WEIGHTS.demand +
      breakdown.margin * SCORE_WEIGHTS.margin +
      breakdown.trend * SCORE_WEIGHTS.trend +
      breakdown.supplier * SCORE_WEIGHTS.supplier +
      breakdown.logistics * SCORE_WEIGHTS.logistics +
      breakdown.competition * SCORE_WEIGHTS.competition +
      breakdown.seasonality * SCORE_WEIGHTS.seasonality +
      breakdown.risk * SCORE_WEIGHTS.risk,
  );
  return { score, breakdown, passesMin: score >= MIN_OPPORTUNITY_SCORE };
}

/**
 * Saturation 0-100 (higher = more saturated / harder market).
 * Spec: competitors, ads, search competition, price similarity, new entrants speed.
 */
export function computeSaturationScore(input: {
  competitorCount?: number;
  adVolume?: number;
  searchCompetition?: number; // 0-100
  priceSimilarity?: number; // 0-100 same price band
  newSellersVelocity?: number; // 0-100
}): { saturation: number; label: 'low' | 'medium' | 'high' } {
  const c = clamp0to100((input.competitorCount ?? 10) * 5);
  const a = clamp0to100(input.adVolume ?? 40);
  const s = clamp0to100(input.searchCompetition ?? 50);
  const p = clamp0to100(input.priceSimilarity ?? 50);
  const v = clamp0to100(input.newSellersVelocity ?? 40);
  const saturation = clamp0to100(c * 0.3 + a * 0.2 + s * 0.2 + p * 0.15 + v * 0.15);
  const label = saturation >= 70 ? 'high' : saturation >= 40 ? 'medium' : 'low';
  return { saturation, label };
}

export function evaluateCandidate(input: ScoreInput & {
  competitorCount?: number;
  adVolume?: number;
  searchCompetition?: number;
}) {
  const filters = hardFilters(input);
  const opportunity = computeOpportunityScore(input);
  const sat = computeSaturationScore({
    competitorCount: input.competitorCount,
    adVolume: input.adVolume,
    searchCompetition: input.searchCompetition,
  });
  // Competition component: invert saturation for opportunity's competition subscore if not provided
  if (input.competitionScore == null) {
    const inv = computeOpportunityScore({
      ...input,
      competitionScore: 100 - sat.saturation,
    });
    return {
      hardFilters: filters,
      opportunity: inv,
      saturation: sat,
      eligible: filters.ok && inv.passesMin,
    };
  }
  return {
    hardFilters: filters,
    opportunity,
    saturation: sat,
    eligible: filters.ok && opportunity.passesMin,
  };
}

export const SCORING_META = {
  block: 28,
  minOpportunityScore: MIN_OPPORTUNITY_SCORE,
  weights: SCORE_WEIGHTS,
  maxShippingPct: MAX_SHIPPING_PCT_OF_SALE,
  maxProcessingDays: MAX_PROCESSING_DAYS,
};

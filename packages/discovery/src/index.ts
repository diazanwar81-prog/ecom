/**
 * ECOM Product Discovery (block 10)
 * - MOCK: candidates clearly labeled [MOCK]
 * - Future: Serper / Trends / CJ catalog when keys + permissions allow
 * - Never invents profitability; only proposes candidates for orchestrator
 */

import { RULES } from '../../rules/src/index';

export interface DiscoveredCandidate {
  title: string;
  source: string;
  sourceMode: 'MOCK' | 'SANDBOX' | 'REAL';
  opportunityScore: number;
  confidence: number;
  salePrice: number;
  productCost: number;
  shippingCost: number;
  stock: number;
  currency: string;
  countryCode: string;
  supplierName: string;
  supplierVerified: boolean;
  cjVariantId?: string;
  cjSku?: string;
  signals: string[];
}

function env(name: string, fallback = '') {
  return (process.env[name] ?? fallback).replace(/\r/g, '').trim();
}

function mode(): 'MOCK' | 'SANDBOX' | 'REAL' {
  const m = env('ECOM_MODE', 'MOCK').toUpperCase();
  if (m === 'SANDBOX' || m === 'REAL') return m;
  return 'MOCK';
}

/** Built-in MOCK catalog — realistic COP prices for CO market */
const MOCK_POOL: Omit<DiscoveredCandidate, 'sourceMode'>[] = [
  {
    title: '[MOCK] Soporte celular magnético auto',
    source: 'mock-catalog',
    opportunityScore: 78,
    confidence: 85,
    salePrice: 45900,
    productCost: 12000,
    shippingCost: 8000,
    stock: 200,
    currency: 'COP',
    countryCode: 'CO',
    supplierName: 'CJ Mock Supplier',
    supplierVerified: true,
    signals: ['search_growth', 'social_mentions', 'manageable_competition'],
  },
  {
    title: '[MOCK] Botella térmica 1L deporte',
    source: 'mock-catalog',
    opportunityScore: 71,
    confidence: 82,
    salePrice: 69900,
    productCost: 22000,
    shippingCost: 12000,
    stock: 90,
    currency: 'COP',
    countryCode: 'CO',
    supplierName: 'CJ Mock Supplier',
    supplierVerified: true,
    signals: ['seasonal_fitness', 'repeat_purchase_potential'],
  },
  {
    title: '[MOCK] Organizador cables escritorio',
    source: 'mock-catalog',
    opportunityScore: 68,
    confidence: 80,
    salePrice: 32900,
    productCost: 9000,
    shippingCost: 7000,
    stock: 150,
    currency: 'COP',
    countryCode: 'CO',
    supplierName: 'AliExpress Mock',
    supplierVerified: true,
    signals: ['home_office', 'low_weight'],
  },
  {
    title: '[MOCK] Mascarilla LED facial (riesgo claims)',
    source: 'mock-catalog',
    opportunityScore: 60,
    confidence: 55,
    salePrice: 120000,
    productCost: 45000,
    shippingCost: 15000,
    stock: 30,
    currency: 'COP',
    countryCode: 'CO',
    supplierName: 'Unverified Mock',
    supplierVerified: false,
    signals: ['trending_beauty', 'regulatory_risk'],
  },
  {
    title: '[MOCK] Producto saturado sin margen',
    source: 'mock-catalog',
    opportunityScore: 42,
    confidence: 70,
    salePrice: 25000,
    productCost: 18000,
    shippingCost: 6000,
    stock: 5,
    currency: 'COP',
    countryCode: 'CO',
    supplierName: 'Unverified Mock',
    supplierVerified: false,
    signals: ['high_competition', 'thin_margin'],
  },
];

export function getDiscoveryStatus() {
  return {
    mode: mode(),
    block: 10,
    sources: {
      mockCatalog: true,
      serper: Boolean(env('SERPER_API_KEY')),
      cjCatalog: Boolean(env('CJ_API_KEY')),
    },
    minOpportunityScore: RULES.MIN_OPPORTUNITY_SCORE,
    note: 'V1 usa catálogo MOCK etiquetado. Fuentes reales se activan con API keys y permisos.',
  };
}

export interface DiscoverOptions {
  limit?: number;
  minScore?: number;
  /** Include low-score candidates for testing filters */
  includeWeak?: boolean;
}

/**
 * Discover product candidates.
 * Always labels MOCK items. Does not call paid APIs unless configured later.
 */
export async function discoverCandidates(opts: DiscoverOptions = {}): Promise<{
  mode: string;
  count: number;
  items: DiscoveredCandidate[];
}> {
  const limit = Math.min(Math.max(opts.limit ?? 5, 1), 20);
  const minScore = opts.minScore ?? RULES.MIN_OPPORTUNITY_SCORE;
  const m = mode();

  let pool = MOCK_POOL.map((c) => ({ ...c, sourceMode: 'MOCK' as const }));

  // Optional: if CJ key present, we still do not auto-fetch live catalog in V1
  // to avoid unexpected network/cost — explicit block later.

  if (!opts.includeWeak) {
    pool = pool.filter((c) => c.opportunityScore >= minScore);
  }

  // Prefer verified + higher score
  pool.sort((a, b) => {
    if (a.supplierVerified !== b.supplierVerified) return a.supplierVerified ? -1 : 1;
    return b.opportunityScore - a.opportunityScore;
  });

  const items = pool.slice(0, limit);
  return { mode: m, count: items.length, items };
}

export function candidatePassesHardFilters(c: DiscoveredCandidate): {
  ok: boolean;
  reasons: string[];
} {
  const reasons: string[] = [];
  if (c.opportunityScore < RULES.MIN_OPPORTUNITY_SCORE) {
    reasons.push(`opportunity ${c.opportunityScore} < ${RULES.MIN_OPPORTUNITY_SCORE}`);
  }
  if (!c.supplierVerified) reasons.push('supplier_unverified');
  if (c.stock <= 0) reasons.push('stock_zero');
  if (c.signals.includes('regulatory_risk')) reasons.push('regulatory_risk');
  return { ok: reasons.length === 0, reasons };
}

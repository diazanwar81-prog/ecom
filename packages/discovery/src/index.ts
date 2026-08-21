/**
 * ECOM Product Discovery
 * - MOCK catalog
 * - Serper (optional)
 * - CJ catalog + match Serper keywords → vid/sku (block 14)
 */

import { RULES } from '../../rules/src/index';
import { matchCjByKeyword, searchCjProducts, getCjStatus } from '../../cj/src/index';

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
  externalHint?: string;
}

function env(name: string, fallback = '') {
  return (process.env[name] ?? fallback).replace(/\r/g, '').trim();
}

function mode(): 'MOCK' | 'SANDBOX' | 'REAL' {
  const m = env('ECOM_MODE', 'MOCK').toUpperCase();
  if (m === 'SANDBOX' || m === 'REAL') return m;
  return 'MOCK';
}

function usdToCop(usd: number) {
  const rate = Number(env('CJ_USD_COP_RATE', '4200')) || 4200;
  return Math.round(usd * rate);
}

/** Cost → retail with ~50%+ margin target (orchestrator recalculates). */
function priceFromCost(productCost: number, shippingCost: number) {
  const total = productCost + shippingCost;
  return Math.max(total * 2.2, total + 15000);
}

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
  const serper = Boolean(env('SERPER_API_KEY'));
  const cj = getCjStatus();
  return {
    mode: mode(),
    block: 14,
    sources: {
      mockCatalog: true,
      serper,
      cjCatalog: cj.configured,
    },
    minOpportunityScore: RULES.MIN_OPPORTUNITY_SCORE,
    note: cj.configured
      ? 'CJ match activo: tendencias Serper se intentan vincular a vid/sku CJ.'
      : serper
        ? 'Serper activo sin match CJ (falta CJ_API_KEY).'
        : 'Solo catálogo MOCK.',
  };
}

export interface DiscoverOptions {
  limit?: number;
  minScore?: number;
  includeWeak?: boolean;
  query?: string;
}

async function fetchSerperHints(query: string): Promise<DiscoveredCandidate[]> {
  const key = env('SERPER_API_KEY');
  if (!key) return [];

  try {
    const res = await fetch('https://google.serper.dev/search', {
      method: 'POST',
      headers: {
        'X-API-KEY': key,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        q: query,
        gl: 'co',
        hl: 'es',
        num: 5,
      }),
    });
    const data = (await res.json()) as any;
    if (!res.ok) {
      console.warn('Serper error', data?.message || res.status);
      return [];
    }

    const organic = (data.organic || []).slice(0, 5);
    return organic.map((row: any, i: number) => {
      const title = String(row.title || `Tendencia ${i + 1}`).slice(0, 120);
      return {
        title: `[SERPER] ${title}`,
        source: 'serper',
        sourceMode: 'SANDBOX' as const,
        opportunityScore: Math.max(55, 75 - i * 3),
        confidence: 60,
        salePrice: 79900,
        productCost: 28000,
        shippingCost: 12000,
        stock: 50,
        currency: 'COP',
        countryCode: 'CO',
        supplierName: 'Pending verification',
        supplierVerified: false,
        signals: ['serper_search', 'needs_supplier_verification'],
        externalHint: row.link,
      };
    });
  } catch (e: any) {
    console.warn('Serper fetch failed', e?.message);
    return [];
  }
}

async function fetchCjCatalogCandidates(limit: number): Promise<DiscoveredCandidate[]> {
  if (!getCjStatus().configured) return [];

  const keyword =
    env('ECOM_CJ_DISCOVERY_KEYWORD') ||
    env('ECOM_DISCOVERY_QUERY', 'home organizer').split(/\s+/).slice(0, 3).join(' ');

  const found = await searchCjProducts({ keyword, pageSize: Math.min(limit, 8) });
  if (!found.ok || !found.items.length) {
    console.warn('CJ catalog empty', found.error);
    return [];
  }

  const out: DiscoveredCandidate[] = [];
  for (let i = 0; i < found.items.length; i++) {
    const p = found.items[i];
    const match = await matchCjByKeyword(p.productNameEn);
    const variant = match.variant;
    const usd = variant?.sellPriceUsd || p.sellPriceUsd || 5;
    const productCost = usdToCop(usd);
    const shippingCost = usdToCop(Number(env('CJ_SHIP_USD_ESTIMATE', '3')) || 3);
    const salePrice = Math.round(priceFromCost(productCost, shippingCost));

    out.push({
      title: `[CJ] ${p.productNameEn}`.slice(0, 160),
      source: 'cj-catalog',
      sourceMode: mode() === 'REAL' ? 'REAL' : 'SANDBOX',
      opportunityScore: Math.max(58, 80 - i * 2),
      confidence: variant ? 82 : 70,
      salePrice,
      productCost,
      shippingCost,
      stock: 80,
      currency: 'COP',
      countryCode: 'CO',
      supplierName: 'CJ Dropshipping',
      supplierVerified: Boolean(variant?.vid || variant?.variantSku || p.pid),
      cjVariantId: variant?.vid,
      cjSku: variant?.variantSku || p.productSku,
      signals: ['cj_catalog', variant ? 'cj_variant_linked' : 'cj_product_only'],
      externalHint: p.productImage,
    });
  }
  return out;
}

/** Try to attach CJ vid/sku to Serper candidates. */
async function enrichSerperWithCj(items: DiscoveredCandidate[]): Promise<DiscoveredCandidate[]> {
  if (!getCjStatus().configured) return items;

  const enriched: DiscoveredCandidate[] = [];
  for (const c of items) {
    if (c.source !== 'serper') {
      enriched.push(c);
      continue;
    }
    try {
      const match = await matchCjByKeyword(c.title);
      if (match.ok && match.variant && (match.variant.vid || match.variant.variantSku)) {
        const usd = match.variant.sellPriceUsd || match.product?.sellPriceUsd || 5;
        const productCost = usdToCop(usd);
        const shippingCost = usdToCop(Number(env('CJ_SHIP_USD_ESTIMATE', '3')) || 3);
        enriched.push({
          ...c,
          title: `[SERPER+CJ] ${match.product?.productNameEn || c.title.replace(/^\[SERPER\]\s*/, '')}`.slice(
            0,
            160,
          ),
          supplierName: 'CJ Dropshipping',
          supplierVerified: true,
          cjVariantId: match.variant.vid,
          cjSku: match.variant.variantSku,
          productCost,
          shippingCost,
          salePrice: Math.round(priceFromCost(productCost, shippingCost)),
          confidence: Math.max(c.confidence, 78),
          signals: c.signals
            .filter((s) => s !== 'needs_supplier_verification')
            .concat(['cj_matched', 'serper_search']),
        });
      } else {
        enriched.push(c);
      }
    } catch {
      enriched.push(c);
    }
  }
  return enriched;
}

export async function discoverCandidates(opts: DiscoverOptions = {}): Promise<{
  mode: string;
  count: number;
  items: DiscoveredCandidate[];
  serperUsed: boolean;
  cjUsed: boolean;
}> {
  const limit = Math.min(Math.max(opts.limit ?? 5, 1), 20);
  const minScore = opts.minScore ?? RULES.MIN_OPPORTUNITY_SCORE;
  const m = mode();

  let pool: DiscoveredCandidate[] = MOCK_POOL.map((c) => ({ ...c, sourceMode: 'MOCK' as const }));

  const query =
    opts.query ||
    env('ECOM_DISCOVERY_QUERY', 'productos más vendidos dropshipping Colombia 2026');

  let serperItems = await fetchSerperHints(query);
  const serperUsed = serperItems.length > 0;
  if (serperUsed) {
    serperItems = await enrichSerperWithCj(serperItems);
    pool = [...serperItems, ...pool];
  }

  const cjItems = await fetchCjCatalogCandidates(Math.min(5, limit));
  const cjUsed = cjItems.length > 0;
  if (cjUsed) {
    pool = [...cjItems, ...pool];
  }

  if (!opts.includeWeak) {
    pool = pool.filter((c) => c.opportunityScore >= minScore);
  }

  pool.sort((a, b) => {
    if (a.supplierVerified !== b.supplierVerified) return a.supplierVerified ? -1 : 1;
    return b.opportunityScore - a.opportunityScore;
  });

  // de-dupe by title
  const seen = new Set<string>();
  const unique: DiscoveredCandidate[] = [];
  for (const c of pool) {
    const key = c.title.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(c);
  }

  const items = unique.slice(0, limit);
  return { mode: m, count: items.length, items, serperUsed, cjUsed };
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
  if (c.signals.includes('needs_supplier_verification')) reasons.push('needs_supplier_verification');
  return { ok: reasons.length === 0, reasons };
}

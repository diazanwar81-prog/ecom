/**
 * ECOM Ops P2 — scoring unificado, safety, rate limit, cache, dedupe
 */
export * from './scoring-unify';
export * from './safety';
export * from './rate-limit';
export * from './cache';
export * from './dedupe';

export const OPS_P2_META = {
  block: 'P2',
  features: [
    'scoreCandidate_unified',
    'alerts_killswitch_budget',
    'rate_limit_token_bucket',
    'ttl_cache',
    'product_order_dedupe',
  ],
};

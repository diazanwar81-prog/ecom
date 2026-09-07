import { describe, it, expect, beforeEach } from 'vitest';
import { scoreCandidate } from './scoring-unify';
import { gateAction, isKillSwitchOn, checkBudget } from './safety';
import { takeToken, resetRateLimitStore, RATE_PRESETS } from './rate-limit';
import { cacheSet, cacheGet, cacheClear, cacheWrap } from './cache';
import {
  productDedupeKey,
  orderDedupeKey,
  createDedupeStore,
  claimKey,
  isDuplicateOrder,
} from './dedupe';

describe('P2 scoring unify', () => {
  it('rejects banned category', () => {
    const r = scoreCandidate({ title: 'replica rolex watch', marginPercent: 50, demandScore: 80 });
    expect(r.decision).toBe('REJECT');
    expect(r.hardFilters.ok).toBe(false);
  });

  it('accepts strong candidate', () => {
    const r = scoreCandidate({
      title: 'Magnetic cable organizer',
      marginPercent: 42,
      demandScore: 70,
      trendScore: 65,
      supplierVerified: true,
      stock: 10,
      shipsToCountry: true,
      salePrice: 100,
      shippingCost: 10,
      processingDays: 2,
    });
    expect(r.hardFilters.ok).toBe(true);
    expect(r.decision).toBe('ACCEPT');
    expect(r.opportunity.score).toBeGreaterThanOrEqual(55);
  });
});

describe('P2 safety', () => {
  it('blocks on kill switch', () => {
    const g = gateAction({
      action: 'publishes',
      usage: { newProducts: 0, publishes: 0, fulfills: 0, aiCalls: 0, spendUsd: 0 },
      env: { ECOM_KILL_SWITCH: 'true' },
    });
    expect(g.allowed).toBe(false);
    expect(g.reason).toBe('kill_switch');
  });

  it('blocks over budget', () => {
    const b = checkBudget(
      'publishes',
      { newProducts: 0, publishes: 20, fulfills: 0, aiCalls: 0, spendUsd: 0 },
      {
        maxNewProducts: 10,
        maxPublishes: 20,
        maxFulfills: 50,
        maxAiCalls: 100,
        maxSpendUsd: 0,
      },
    );
    expect(b.ok).toBe(false);
  });

  it('detects kill flag', () => {
    expect(isKillSwitchOn({ ECOM_PAUSE_ALL: 'true' })).toBe(true);
  });
});

describe('P2 rate limit', () => {
  beforeEach(() => resetRateLimitStore());

  it('allows first cj token and blocks second in window', () => {
    const a = takeToken(RATE_PRESETS.cj);
    const b = takeToken(RATE_PRESETS.cj);
    expect(a.ok).toBe(true);
    expect(b.ok).toBe(false);
  });
});

describe('P2 cache', () => {
  beforeEach(() => cacheClear());

  it('hit after set', async () => {
    cacheSet('k', { x: 1 }, 60_000);
    expect(cacheGet<{ x: number }>('k')?.x).toBe(1);
    const w = await cacheWrap('k2', 60_000, async () => 42);
    expect(w.hit).toBe(false);
    const w2 = await cacheWrap('k2', 60_000, async () => 99);
    expect(w2.hit).toBe(true);
    expect(w2.value).toBe(42);
  });
});

describe('P2 dedupe', () => {
  it('same cj vid same key', () => {
    const a = productDedupeKey({ cjVariantId: 'VID1', title: 'Other' });
    const b = productDedupeKey({ cjVariantId: 'VID1', title: 'Different' });
    expect(a).toBe(b);
  });

  it('order external id dedupe', () => {
    const store = createDedupeStore();
    const key = orderDedupeKey({ externalId: '998877' });
    expect(claimKey(store, key).isNew).toBe(true);
    expect(isDuplicateOrder(store, { externalId: '998877' })).toBe(true);
  });
});

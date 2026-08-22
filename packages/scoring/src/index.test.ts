import { describe, it, expect } from 'vitest';
import {
  computeOpportunityScore,
  computeSaturationScore,
  hardFilters,
  detectBannedCategory,
  evaluateCandidate,
  MIN_OPPORTUNITY_SCORE,
} from './index';

describe('scoring block 28', () => {
  it('detects banned keywords', () => {
    expect(detectBannedCategory('Soft Air Gun Rifle')).toBeTruthy();
    expect(detectBannedCategory('Kitchen organizer')).toBeNull();
  });

  it('hard filter blocks low margin and banned', () => {
    const r = hardFilters({ title: 'vape kit', marginPercent: 10, stock: 0 });
    expect(r.ok).toBe(false);
    expect(r.reasons.length).toBeGreaterThan(0);
  });

  it('opportunity score respects weights and min 55', () => {
    const good = computeOpportunityScore({
      demandScore: 80,
      marginPercent: 45,
      trendScore: 70,
      supplierVerified: true,
      logisticsScore: 70,
      competitionScore: 60,
    });
    expect(good.score).toBeGreaterThanOrEqual(MIN_OPPORTUNITY_SCORE);
    expect(good.passesMin).toBe(true);
  });

  it('saturation labels high markets', () => {
    const s = computeSaturationScore({
      competitorCount: 40,
      adVolume: 90,
      searchCompetition: 90,
      priceSimilarity: 90,
      newSellersVelocity: 80,
    });
    expect(s.label).toBe('high');
  });

  it('evaluateCandidate combines filters + scores', () => {
    const e = evaluateCandidate({
      title: 'Organizador cocina',
      demandScore: 75,
      marginPercent: 40,
      supplierVerified: true,
      stock: 50,
      salePrice: 90000,
      shippingCost: 10000,
    });
    expect(e.eligible).toBe(true);
    expect(e.hardFilters.ok).toBe(true);
  });
});

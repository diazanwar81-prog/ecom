import { describe, expect, it } from 'vitest';
import { discoverCandidates, candidatePassesHardFilters, getDiscoveryStatus } from './index';

describe('discovery', () => {
  it('returns status with mock source', () => {
    const s = getDiscoveryStatus();
    expect(s.block).toBe(10);
    expect(s.sources.mockCatalog).toBe(true);
  });

  it('discovers labeled MOCK candidates above min score', async () => {
    const r = await discoverCandidates({ limit: 5, includeWeak: false });
    expect(r.count).toBeGreaterThan(0);
    for (const item of r.items) {
      expect(item.title).toMatch(/\[MOCK\]/);
      expect(item.opportunityScore).toBeGreaterThanOrEqual(55);
    }
  });

  it('hard-filters unverified / regulatory', async () => {
    const r = await discoverCandidates({ includeWeak: true, limit: 10 });
    const risky = r.items.find((i) => i.signals.includes('regulatory_risk'));
    if (risky) {
      const f = candidatePassesHardFilters(risky);
      expect(f.ok).toBe(false);
    }
  });
});

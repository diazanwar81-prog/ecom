import { describe, it, expect } from 'vitest';
import { buildDashboardKpis } from './kpis';
import {
  runFallbackChain,
  resolveDegradationMode,
  planSupplierFallback,
} from './fallbacks';

const baseKpi = {
  mode: 'MOCK',
  productsDetected: 10,
  productsPendingApproval: 2,
  productsDraft: 3,
  productsPublished: 5,
  productsPaused: 1,
  productsRejected: 0,
  ordersPaid: 1,
  ordersFulfilling: 0,
  ordersFulfilled: 1,
  ordersCancelled: 0,
  jobsFailed24h: 0,
  stockRisks: 0,
  killSwitch: false,
  shopifyConnected: true,
  cjConnected: true,
  telegramConnected: false,
  publishesToday: 1,
  publishCap: 20,
  fulfillsToday: 1,
  fulfillCap: 50,
};

describe('P3 KPIs', () => {
  it('builds healthy dashboard', () => {
    const d = buildDashboardKpis(baseKpi);
    expect(d.health).toBe('healthy');
    expect(d.funnel.published).toBe(5);
    expect(d.marginToday.verified).toBe(false);
    expect(d.cards.find((c) => c.id === 'gross_today')?.value).toBe('UNVERIFIED');
  });

  it('kill switch is critical', () => {
    const d = buildDashboardKpis({ ...baseKpi, killSwitch: true });
    expect(d.health).toBe('critical');
  });

  it('verified margin when numbers provided', () => {
    const d = buildDashboardKpis({
      ...baseKpi,
      revenueToday: 100,
      costToday: 40,
      currency: 'COP',
    });
    expect(d.marginToday.verified).toBe(true);
    expect(d.marginToday.gross).toBe(60);
  });
});

describe('P3 Fallbacks', () => {
  it('uses secondary when primary fails', async () => {
    const r = await runFallbackChain([
      {
        layer: 'primary',
        provider: 'a',
        run: async () => {
          throw new Error('down');
        },
      },
      { layer: 'secondary', provider: 'b', run: async () => 'ok-b' },
    ]);
    expect(r.ok).toBe(true);
    expect(r.provider).toBe('b');
    expect(r.degraded).toBe(true);
  });

  it('fail_closed when all fail', async () => {
    const r = await runFallbackChain([
      {
        layer: 'primary',
        provider: 'a',
        run: async () => {
          throw new Error('x');
        },
      },
    ]);
    expect(r.ok).toBe(false);
    expect(r.layer).toBe('fail_closed');
  });

  it('halts when db down', () => {
    const m = resolveDegradationMode([
      { service: 'postgres', up: false, error: 'conn' },
      { service: 'shopify', up: true },
    ]);
    expect(m.mode).toBe('halt');
  });

  it('supplier propose switch with approval', () => {
    const p = planSupplierFallback({
      primarySupplierId: 'cj',
      primaryOk: false,
      backups: [{ id: 'dropi', available: true, score: 70 }],
      requireApproval: true,
    });
    expect(p.action).toBe('propose_switch');
    expect(p.needsApproval).toBe(true);
    expect(p.targetSupplierId).toBe('dropi');
  });
});

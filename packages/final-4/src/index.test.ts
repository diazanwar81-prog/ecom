import { describe, it, expect } from 'vitest';
import { e2eSelfTest, e2ePreflight } from './e2e-order';
import { ops247Snapshot, shouldAlertJobFailure } from './ops247';
import { autopilotTick } from './autopilot-tick';
import { productionBlock } from './production';
import { runFinal4SelfCheck } from './index';

describe('final-4', () => {
  it('e2e self test passes', () => {
    expect(e2eSelfTest().ok).toBe(true);
  });

  it('e2e preflight blocks non-https', () => {
    const p = e2ePreflight({ API_URL: 'http://localhost' });
    expect(p.ok).toBe(false);
  });

  it('ops247 snapshot runs', () => {
    const s = ops247Snapshot();
    expect(s.gates.length).toBeGreaterThan(0);
  });

  it('job failure alert threshold', () => {
    expect(shouldAlertJobFailure({ consecutiveFailures: 3 }).alert).toBe(true);
    expect(shouldAlertJobFailure({ consecutiveFailures: 1 }).alert).toBe(false);
  });

  it('autopilot off skips', () => {
    const r = autopilotTick({
      candidates: [{ id: '1', title: 'Cable organizer', marginPercent: 40 }],
      usage: {
        newProductsToday: 0,
        publishesToday: 0,
        fulfillsToday: 0,
        aiCallsToday: 0,
        autoApprovesToday: 0,
      },
    });
    expect(r.enabled).toBe(false);
    expect(r.decisions[0].next).toBe('skipped_autopilot_off');
  });

  it('production block structure', () => {
    const p = productionBlock({
      API_URL: 'https://x.com',
      SESSION_SECRET: '1234567890123456',
      SHOPIFY_SHOP_DOMAIN: 'x.myshopify.com',
      SHOPIFY_ACCESS_TOKEN: 't',
      SHOPIFY_WEBHOOK_SECRET: 's',
      CJ_API_KEY: 'c',
      ECOM_ALLOW_PAID_AI: 'false',
      ECOM_MODE: 'MOCK',
    });
    expect(p.readiness.ok).toBe(true);
  });

  it('final4 self check', () => {
    const r = runFinal4SelfCheck({
      API_URL: 'https://x.com',
      SESSION_SECRET: '1234567890123456',
      SHOPIFY_SHOP_DOMAIN: 'x.myshopify.com',
      SHOPIFY_ACCESS_TOKEN: 't',
      SHOPIFY_WEBHOOK_SECRET: 's',
      CJ_API_KEY: 'c',
      ECOM_ALLOW_PAID_AI: 'false',
      ECOM_MODE: 'MOCK',
    });
    expect(r.f1_e2e.ok).toBe(true);
  });
});

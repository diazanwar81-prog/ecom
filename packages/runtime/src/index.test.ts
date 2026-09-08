import { describe, it, expect } from 'vitest';
import { runSixPhaseSelfCheck, phase1Verify, phase1WebhookAddress } from './index';
import { phase5ValidateImages, phase5ContentPlan } from './phase5-content';
import { phase6Readiness } from './phase6-prod';
import { phase4EvaluateCandidate } from './phase4-autopilot';

describe('six-phase runtime', () => {
  it('phase1 self test passes', () => {
    expect(phase1Verify().ok).toBe(true);
  });

  it('webhook address path', () => {
    expect(phase1WebhookAddress('https://x.com')).toContain('/shopify/webhooks/orders');
  });

  it('phase5 rejects placeholders', () => {
    const v = phase5ValidateImages(['https://placehold.co/1.png', 'https://cdn.example.com/a.jpg']);
    expect(v.usable).toEqual(['https://cdn.example.com/a.jpg']);
  });

  it('phase5 canva off by default', () => {
    const p = phase5ContentPlan({ title: 'T', imageUrls: ['https://cdn.example.com/a.jpg'] });
    expect(p.canva.action).toBe('skip');
  });

  it('phase6 readiness fails without https in REAL-ish env', () => {
    const r = phase6Readiness({
      API_URL: 'http://localhost:4000',
      SESSION_SECRET: 'x',
      ECOM_ALLOW_PAID_AI: 'false',
    });
    expect(r.checks.find((c) => c.id === 'https_url')?.ok).toBe(false);
  });

  it('phase4 rejects banned without autopilot', () => {
    const r = phase4EvaluateCandidate({
      title: 'replica rolex gold',
      marginPercent: 50,
      usage: {
        newProductsToday: 0,
        publishesToday: 0,
        fulfillsToday: 0,
        aiCallsToday: 0,
        autoApprovesToday: 0,
      },
    });
    expect(r.next).toBe('reject');
  });

  it('six phase self check runs', () => {
    const s = runSixPhaseSelfCheck({
      API_URL: 'https://ecom.example.com',
      SESSION_SECRET: '1234567890123456',
      SHOPIFY_SHOP_DOMAIN: 'x.myshopify.com',
      SHOPIFY_ACCESS_TOKEN: 'shpat_test',
      SHOPIFY_WEBHOOK_SECRET: 'sec',
      CJ_API_KEY: 'cjkey',
      ECOM_ALLOW_PAID_AI: 'false',
      ECOM_MODE: 'MOCK',
    });
    expect(s.allLogicOk).toBe(true);
    expect(s.phases).toHaveLength(6);
  });
});

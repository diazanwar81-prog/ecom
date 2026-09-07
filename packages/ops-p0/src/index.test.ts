import { describe, it, expect } from 'vitest';
import {
  selfTestP0,
  processShopifyWebhookRequest,
  decideTrackingPoll,
  normalizeCjOrderTracking,
  planInventoryPass,
  applyInventoryDecision,
  buildOrdersWebhookAddress,
} from './index';
import { createHmac } from 'crypto';

describe('ops-p0 block', () => {
  it('selfTestP0 passes', () => {
    const r = selfTestP0();
    expect(r.ok).toBe(true);
    expect(r.report.criticalFailed).toBe(0);
  });

  it('rejects invalid hmac', () => {
    const body = '{"id":1}';
    const r = processShopifyWebhookRequest({
      rawBody: body,
      hmacHeader: 'nope',
      secret: 'secret',
      existingExternalIds: [],
    });
    expect(r.statusCode).toBe(401);
  });

  it('accepts valid hmac and creates', () => {
    const secret = 's';
    const body = JSON.stringify({
      id: 42,
      financial_status: 'paid',
      name: '#42',
      total_price: '1',
      currency: 'COP',
      line_items: [],
    });
    const hmac = createHmac('sha256', secret).update(body).digest('base64');
    const r = processShopifyWebhookRequest({
      rawBody: body,
      hmacHeader: hmac,
      secret,
      existingExternalIds: [],
    });
    expect(r.ok).toBe(true);
    expect(r.decision.action).toBe('create');
  });

  it('tracking poll skips without supplier id', () => {
    const d = decideTrackingPoll({ status: 'FULFILLED' });
    expect(d.action).toBe('skip');
  });

  it('does not invent tracking from n/a', () => {
    const s = normalizeCjOrderTracking('x', { data: { trackingNumber: 'n/a' } });
    expect(s.trackingNumber).toBeNull();
    expect(s.isPlaceholder).toBe(true);
  });

  it('inventory plans only PUBLISHED with cj id', () => {
    const { toCheck } = planInventoryPass([
      { productId: '1', title: 'a', status: 'PUBLISHED', cjSku: 'SKU' },
      { productId: '2', title: 'b', status: 'DRAFT', cjSku: 'SKU' },
    ]);
    expect(toCheck).toHaveLength(1);
  });

  it('delist applies pause', () => {
    const r = applyInventoryDecision(
      { productId: '1', title: 't', ecomStock: 3 },
      { ok: true, listed: false },
    );
    expect(r.paused).toBe(true);
    expect(r.reason).toBe('cj_delisted');
  });

  it('webhook address uses correct path', () => {
    expect(buildOrdersWebhookAddress('https://x.com/')).toBe('https://x.com/shopify/webhooks/orders');
  });
});

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  getIntegrationSnapshot,
  listIntegrationSnapshots,
  testIntegrationConfig,
  canUseIntegration,
  INTEGRATION_CATALOG,
} from './index';

const keys = [
  'SHOPIFY_SHOP_DOMAIN',
  'SHOPIFY_ACCESS_TOKEN',
  'SHOPIFY_WEBHOOK_SECRET',
  'CJ_API_KEY',
  'ECOM_ALLOW_PAID_AI',
  'ECOM_ALLOW_CANVA',
  'GEMINI_API_KEY',
  'CANVA_CLIENT_ID',
  'CANVA_CLIENT_SECRET',
];

describe('integrations hub', () => {
  const prev: Record<string, string | undefined> = {};
  beforeEach(() => {
    for (const k of keys) prev[k] = process.env[k];
  });
  afterEach(() => {
    for (const k of keys) {
      if (prev[k] === undefined) delete process.env[k];
      else process.env[k] = prev[k];
    }
  });

  it('catalog has core providers', () => {
    const ids = INTEGRATION_CATALOG.map((c) => c.id);
    expect(ids).toContain('shopify');
    expect(ids).toContain('cj');
    expect(ids).toContain('canva');
  });

  it('canva disabled without allow flag', () => {
    process.env.ECOM_ALLOW_CANVA = 'false';
    process.env.CANVA_CLIENT_ID = 'x';
    process.env.CANVA_CLIENT_SECRET = 'y';
    const s = getIntegrationSnapshot('canva');
    expect(s.status).toBe('DISABLED');
    expect(canUseIntegration('canva').allowed).toBe(false);
  });

  it('shopify connected when env present', () => {
    process.env.SHOPIFY_SHOP_DOMAIN = 'x.myshopify.com';
    process.env.SHOPIFY_ACCESS_TOKEN = 'shpat_test_token_value';
    process.env.SHOPIFY_WEBHOOK_SECRET = 'whsec';
    const t = testIntegrationConfig('shopify');
    expect(t.ok).toBe(true);
    expect(t.status).toBe('CONNECTED');
  });

  it('lists all snapshots', () => {
    const list = listIntegrationSnapshots();
    expect(list.length).toBe(INTEGRATION_CATALOG.length);
  });
});

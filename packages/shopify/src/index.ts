/**
 * ECOM Shopify adapter
 * - MOCK: simulates product publish + orders (no network)
 * - SANDBOX/REAL: Admin API when shop + token configured
 * - Never charges; never publishes without explicit call
 * API version target: 2026-07
 */

export type RuntimeMode = 'MOCK' | 'SANDBOX' | 'REAL';

export interface ShopifyStatus {
  mode: RuntimeMode;
  configured: boolean;
  shopDomain: string | null;
  apiVersion: string;
  note: string;
  canPublishLive: boolean;
}

export interface PublishInput {
  title: string;
  description?: string | null;
  price: number;
  currency: string;
  sku?: string;
  inventory?: number | null;
}

export interface PublishResult {
  ok: boolean;
  mock: boolean;
  externalId: string;
  adminUrl?: string;
  error?: string;
  raw?: unknown;
}

export interface MockOrder {
  id: string;
  orderNumber: string;
  email: string;
  total: number;
  currency: string;
  lineItems: Array<{ title: string; quantity: number; price: number; sku?: string }>;
  createdAt: string;
}

const API_VERSION = process.env.SHOPIFY_API_VERSION || '2026-07';

function env(name: string, fallback = '') {
  return (process.env[name] ?? fallback).replace(/\r/g, '').trim();
}

function mode(): RuntimeMode {
  const m = env('ECOM_MODE', 'MOCK').toUpperCase();
  if (m === 'SANDBOX' || m === 'REAL') return m;
  return 'MOCK';
}

function shopDomain() {
  return env('SHOPIFY_SHOP_DOMAIN') || env('SHOPIFY_SHOP') || null;
}

function accessToken() {
  return env('SHOPIFY_ACCESS_TOKEN');
}

function hasCreds() {
  const shop = shopDomain();
  const token = accessToken();
  return Boolean(shop && token && token.length > 10 && !token.includes('replace'));
}

export function getShopifyStatus(): ShopifyStatus {
  const m = mode();
  const configured = hasCreds();
  const forceLive = env('ECOM_SHOPIFY_FORCE_LIVE').toLowerCase() === 'true';
  const canPublishLive = configured && (m !== 'MOCK' || forceLive);

  return {
    mode: m,
    configured,
    shopDomain: shopDomain(),
    apiVersion: API_VERSION,
    canPublishLive,
    note: canPublishLive
      ? 'Credenciales presentes — publish usará Admin API'
      : 'Sin shop/token o modo MOCK — publish simulado (MOCK)',
  };
}

export async function publishProduct(input: PublishInput): Promise<PublishResult> {
  const status = getShopifyStatus();

  if (!status.canPublishLive) {
    const externalId = `mock-shopify-${Date.now()}`;
    return {
      ok: true,
      mock: true,
      externalId,
      adminUrl: `https://admin.shopify.com/store/mock/products/${externalId}`,
      raw: {
        simulated: true,
        title: input.title,
        price: input.price,
        currency: input.currency,
      },
    };
  }

  const shop = shopDomain()!;
  const token = accessToken();
  const host = shop.includes('.') ? shop : `${shop}.myshopify.com`;

  const body = {
    product: {
      title: input.title,
      body_html: input.description || input.title,
      status: 'active',
      variants: [
        {
          price: String(input.price),
          sku: input.sku || undefined,
          inventory_management: input.inventory != null ? 'shopify' : undefined,
        },
      ],
    },
  };

  try {
    const res = await fetch(`https://${host}/admin/api/${API_VERSION}/products.json`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Shopify-Access-Token': token,
      },
      body: JSON.stringify(body),
    });

    const data = (await res.json()) as any;

    if (!res.ok) {
      return {
        ok: false,
        mock: false,
        externalId: '',
        error: data?.errors ? JSON.stringify(data.errors) : `Shopify HTTP ${res.status}`,
        raw: data,
      };
    }

    const id = String(data?.product?.id ?? '');
    return {
      ok: Boolean(id),
      mock: false,
      externalId: id,
      adminUrl: id ? `https://${host}/admin/products/${id}` : undefined,
      raw: data,
    };
  } catch (e: any) {
    return {
      ok: false,
      mock: false,
      externalId: '',
      error: e?.message || 'Error de red Shopify',
    };
  }
}

/** Simulate a test order for first-sale dry run in MOCK */
export function createMockOrder(productTitle: string, price: number, currency = 'COP'): MockOrder {
  return {
    id: `mock-order-${Date.now()}`,
    orderNumber: `#MOCK-${Math.floor(Math.random() * 9000 + 1000)}`,
    email: 'cliente.prueba@ecom.local',
    total: price,
    currency,
    lineItems: [{ title: productTitle, quantity: 1, price }],
    createdAt: new Date().toISOString(),
  };
}

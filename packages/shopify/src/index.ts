/**
 * ECOM Shopify adapter
 * - MOCK / SANDBOX / REAL
 * - publish products (with images) + create fulfillments with tracking
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
  /** Public image URLs (e.g. CJ CDN) */
  imageUrls?: string[];
}

export interface PublishResult {
  ok: boolean;
  mock: boolean;
  externalId: string;
  adminUrl?: string;
  error?: string;
  raw?: unknown;
}

export interface FulfillmentInput {
  orderId: string;
  trackingNumber?: string;
  trackingCompany?: string;
  trackingUrl?: string;
  notifyCustomer?: boolean;
}

export interface FulfillmentResult {
  ok: boolean;
  mock: boolean;
  fulfillmentId?: string;
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

function shopHost() {
  const shop = shopDomain()!;
  return shop.includes('.') ? shop : `${shop}.myshopify.com`;
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
      ? 'Credenciales presentes — publish/fulfill usará Admin API'
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
        imageUrls: input.imageUrls,
      },
    };
  }

  const token = accessToken();
  const host = shopHost();
  const images = (input.imageUrls || [])
    .filter((u) => typeof u === 'string' && /^https?:\/\//i.test(u))
    .slice(0, 5)
    .map((src) => ({ src }));

  const body: any = {
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
      images: images.length ? images : undefined,
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

export async function createOrderFulfillment(input: FulfillmentInput): Promise<FulfillmentResult> {
  const status = getShopifyStatus();
  if (!input.orderId) {
    return { ok: false, mock: false, error: 'orderId required' };
  }

  if (!status.canPublishLive) {
    return {
      ok: true,
      mock: true,
      fulfillmentId: `mock-ff-${Date.now()}`,
      raw: { simulated: true, ...input },
    };
  }

  const token = accessToken();
  const host = shopHost();
  const orderId = String(input.orderId).replace(/\D/g, '') || input.orderId;

  try {
    const foRes = await fetch(
      `https://${host}/admin/api/${API_VERSION}/orders/${orderId}/fulfillment_orders.json`,
      { headers: { 'X-Shopify-Access-Token': token! } },
    );
    const foData = (await foRes.json()) as any;

    if (foRes.ok && Array.isArray(foData?.fulfillment_orders) && foData.fulfillment_orders.length) {
      const open = foData.fulfillment_orders.filter(
        (f: any) => f.status === 'open' || f.status === 'in_progress',
      );
      const targets = open.length ? open : foData.fulfillment_orders;
      const lineItemsByFulfillmentOrder = targets.map((fo: any) => ({
        fulfillment_order_id: fo.id,
        fulfillment_order_line_items: (fo.line_items || []).map((li: any) => ({
          id: li.id,
          quantity: li.quantity,
        })),
      }));

      const body: any = {
        fulfillment: {
          line_items_by_fulfillment_order: lineItemsByFulfillmentOrder,
          notify_customer: input.notifyCustomer !== false,
          tracking_info: {
            number: input.trackingNumber || undefined,
            company: input.trackingCompany || undefined,
            url: input.trackingUrl || undefined,
          },
        },
      };

      const res = await fetch(`https://${host}/admin/api/${API_VERSION}/fulfillments.json`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Shopify-Access-Token': token!,
        },
        body: JSON.stringify(body),
      });
      const data = (await res.json()) as any;
      if (!res.ok) {
        return {
          ok: false,
          mock: false,
          error: data?.errors ? JSON.stringify(data.errors) : `Shopify fulfill HTTP ${res.status}`,
          raw: data,
        };
      }
      return {
        ok: true,
        mock: false,
        fulfillmentId: String(data?.fulfillment?.id || ''),
        raw: data,
      };
    }

    const legacyBody = {
      fulfillment: {
        tracking_number: input.trackingNumber,
        tracking_company: input.trackingCompany,
        tracking_url: input.trackingUrl,
        notify_customer: input.notifyCustomer !== false,
      },
    };
    const res = await fetch(
      `https://${host}/admin/api/${API_VERSION}/orders/${orderId}/fulfillments.json`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Shopify-Access-Token': token!,
        },
        body: JSON.stringify(legacyBody),
      },
    );
    const data = (await res.json()) as any;
    if (!res.ok) {
      return {
        ok: false,
        mock: false,
        error: data?.errors ? JSON.stringify(data.errors) : `Shopify legacy fulfill HTTP ${res.status}`,
        raw: data,
      };
    }
    return {
      ok: true,
      mock: false,
      fulfillmentId: String(data?.fulfillment?.id || ''),
      raw: data,
    };
  } catch (e: any) {
    return { ok: false, mock: false, error: e?.message || 'Error de red Shopify fulfill' };
  }
}

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


export interface InventorySetInput {
  inventoryItemId: string;
  available: number;
  locationId?: string;
}

export interface InventorySetResult {
  ok: boolean;
  mock: boolean;
  available?: number;
  locationId?: string;
  error?: string;
  raw?: unknown;
}

export async function getPrimaryLocationId(): Promise<{ ok: boolean; locationId?: string; error?: string; mock?: boolean }> {
  const status = getShopifyStatus();
  if (!status.canPublishLive) {
    return { ok: true, locationId: 'mock-location', mock: true };
  }
  const token = accessToken();
  const host = shopHost();
  try {
    const res = await fetch(`https://${host}/admin/api/${API_VERSION}/locations.json`, {
      headers: { 'X-Shopify-Access-Token': token! },
    });
    const data = (await res.json()) as any;
    if (!res.ok) {
      return { ok: false, error: data?.errors ? JSON.stringify(data.errors) : `locations HTTP ${res.status}` };
    }
    const locs = data?.locations || [];
    const active = locs.find((l: any) => l.active && l.legacy === false) || locs.find((l: any) => l.active) || locs[0];
    if (!active?.id) return { ok: false, error: 'no_location' };
    return { ok: true, locationId: String(active.id) };
  } catch (e: any) {
    return { ok: false, error: e?.message || 'locations network error' };
  }
}

export async function setInventoryLevel(input: InventorySetInput): Promise<InventorySetResult> {
  const status = getShopifyStatus();
  const available = Math.max(0, Math.floor(Number(input.available) || 0));
  if (!input.inventoryItemId) {
    return { ok: false, mock: false, error: 'inventoryItemId required' };
  }

  if (!status.canPublishLive) {
    return {
      ok: true,
      mock: true,
      available,
      locationId: input.locationId || 'mock-location',
      raw: { simulated: true },
    };
  }

  const token = accessToken();
  const host = shopHost();
  let locationId = input.locationId;
  if (!locationId) {
    const loc = await getPrimaryLocationId();
    if (!loc.ok || !loc.locationId) {
      return { ok: false, mock: false, error: loc.error || 'no location' };
    }
    locationId = loc.locationId;
  }

  try {
    const res = await fetch(`https://${host}/admin/api/${API_VERSION}/inventory_levels/set.json`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Shopify-Access-Token': token!,
      },
      body: JSON.stringify({
        location_id: Number(locationId),
        inventory_item_id: Number(input.inventoryItemId),
        available,
      }),
    });
    const data = (await res.json()) as any;
    if (!res.ok) {
      return {
        ok: false,
        mock: false,
        error: data?.errors ? JSON.stringify(data.errors) : `inventory set HTTP ${res.status}`,
        raw: data,
      };
    }
    return {
      ok: true,
      mock: false,
      available: data?.inventory_level?.available ?? available,
      locationId,
      raw: data,
    };
  } catch (e: any) {
    return { ok: false, mock: false, error: e?.message || 'inventory network error' };
  }
}

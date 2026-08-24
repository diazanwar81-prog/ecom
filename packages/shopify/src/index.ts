/**
 * ECOM Shopify adapter
 * Phase A: client-credentials token refresh + inventory after publish
 * Phase B2: strip placeholder image URLs before Admin API
 */

export type RuntimeMode = 'MOCK' | 'SANDBOX' | 'REAL';

export interface ShopifyStatus {
  mode: RuntimeMode;
  configured: boolean;
  shopDomain: string | null;
  apiVersion: string;
  note: string;
  canPublishLive: boolean;
  tokenRefreshReady?: boolean;
}

export interface PublishInput {
  title: string;
  description?: string | null;
  price: number;
  currency: string;
  sku?: string;
  inventory?: number | null;
  weightGrams?: number | null;
  imageUrls?: string[];
}

export interface PublishResult {
  ok: boolean;
  mock: boolean;
  externalId: string;
  adminUrl?: string;
  error?: string;
  raw?: unknown;
  inventorySync?: InventorySetResult | null;
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

const API_VERSION = process.env.SHOPIFY_API_VERSION || '2026-07';

let memoryToken: string | null = null;
let memoryTokenExpiresAt = 0;

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

function staticAccessToken() {
  return env('SHOPIFY_ACCESS_TOKEN');
}

function hasClientCreds() {
  const id = env('SHOPIFY_CLIENT_ID');
  const secret = env('SHOPIFY_CLIENT_SECRET');
  return Boolean(id && secret && id.length > 8 && secret.length > 8);
}

function shopHost() {
  const shop = shopDomain()!;
  return shop.includes('.') ? shop : `${shop}.myshopify.com`;
}

function isPlaceholderUrl(u: string): boolean {
  const s = String(u || '').toLowerCase();
  return (
    s.includes('placehold.co') ||
    s.includes('placeholder.com') ||
    s.includes('via.placeholder') ||
    s.includes('dummyimage.com') ||
    s.includes('picsum.photos')
  );
}

/** Refresh via client_credentials when SHOPIFY_CLIENT_ID/SECRET present. */
export async function ensureShopifyAccessToken(): Promise<{
  ok: boolean;
  token?: string;
  refreshed?: boolean;
  error?: string;
  expiresIn?: number;
}> {
  const staticTok = staticAccessToken();
  if (memoryToken && Date.now() < memoryTokenExpiresAt - 60_000) {
    return { ok: true, token: memoryToken, refreshed: false };
  }
  if (!hasClientCreds()) {
    if (staticTok && staticTok.length > 10 && !staticTok.includes('replace')) {
      return { ok: true, token: staticTok, refreshed: false };
    }
    return { ok: false, error: 'missing_token_and_client_creds' };
  }
  const host = shopDomain() ? shopHost() : null;
  if (!host) return { ok: false, error: 'missing_shop_domain' };
  try {
    const res = await fetch(`https://${host}/admin/oauth/access_token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: env('SHOPIFY_CLIENT_ID'),
        client_secret: env('SHOPIFY_CLIENT_SECRET'),
      }).toString(),
    });
    const data = (await res.json()) as any;
    if (!res.ok || !data?.access_token) {
      if (staticTok && staticTok.length > 10) {
        return { ok: true, token: staticTok, refreshed: false, error: data?.error || `refresh_http_${res.status}` };
      }
      return {
        ok: false,
        error: data?.error_description || data?.error || `refresh_http_${res.status}`,
      };
    }
    memoryToken = String(data.access_token);
    const expiresIn = Number(data.expires_in || 86399);
    memoryTokenExpiresAt = Date.now() + expiresIn * 1000;
    process.env.SHOPIFY_ACCESS_TOKEN = memoryToken;
    return { ok: true, token: memoryToken, refreshed: true, expiresIn };
  } catch (e: any) {
    if (staticTok && staticTok.length > 10) {
      return { ok: true, token: staticTok, refreshed: false, error: e?.message };
    }
    return { ok: false, error: e?.message || 'refresh_network_error' };
  }
}

function hasCreds() {
  const shop = shopDomain();
  const token = staticAccessToken() || memoryToken;
  return Boolean(shop && token && String(token).length > 10 && !String(token).includes('replace'));
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
    tokenRefreshReady: hasClientCreds(),
    note: canPublishLive
      ? hasClientCreds()
        ? 'Credenciales + client_id/secret — publish live + refresh listo'
        : 'Token estático — publish live (renueva token si expira)'
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
      inventorySync: {
        ok: true,
        mock: true,
        available: Math.max(0, Math.floor(Number(input.inventory) || 0)),
      },
      raw: {
        simulated: true,
        title: input.title,
        price: input.price,
        inventory: input.inventory,
        imageUrls: input.imageUrls,
      },
    };
  }

  const tokenRes = await ensureShopifyAccessToken();
  if (!tokenRes.ok || !tokenRes.token) {
    return { ok: false, mock: false, externalId: '', error: tokenRes.error || 'no_token' };
  }
  const token = tokenRes.token;
  const host = shopHost();
  // Never send placehold.co / dummy URLs to Shopify
  const images = (input.imageUrls || [])
    .filter((u) => typeof u === 'string' && /^https?:\/\//i.test(u) && !isPlaceholderUrl(u))
    .slice(0, 5)
    .map((src) => ({ src }));

  const invQty = input.inventory != null ? Math.max(0, Math.floor(Number(input.inventory))) : null;
  const grams = input.weightGrams != null ? Math.max(0, Math.floor(Number(input.weightGrams))) : 0;

  const body: any = {
    product: {
      title: input.title,
      body_html: input.description || input.title,
      status: 'active',
      variants: [
        {
          price: String(input.price),
          sku: input.sku || undefined,
          inventory_management: 'shopify',
          inventory_policy: 'deny',
          grams,
          weight: grams / 1000,
          weight_unit: 'kg',
          requires_shipping: true,
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
    const invItemId = data?.product?.variants?.[0]?.inventory_item_id;
    let inventorySync: InventorySetResult | null = null;
    if (invItemId != null && invQty != null) {
      inventorySync = await setInventoryLevel({
        inventoryItemId: String(invItemId),
        available: invQty,
      });
    }

    return {
      ok: Boolean(id),
      mock: false,
      externalId: id,
      adminUrl: id ? `https://${host}/admin/products/${id}` : undefined,
      raw: data,
      inventorySync,
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

  const tokenRes = await ensureShopifyAccessToken();
  const token = tokenRes.token || '';
  const host = shopHost();
  const orderId = String(input.orderId).replace(/\D/g, '') || input.orderId;

  try {
    const foRes = await fetch(
      `https://${host}/admin/api/${API_VERSION}/orders/${orderId}/fulfillment_orders.json`,
      { headers: { 'X-Shopify-Access-Token': token } },
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
          'X-Shopify-Access-Token': token,
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
          'X-Shopify-Access-Token': token,
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

export async function getPrimaryLocationId(): Promise<{
  ok: boolean;
  locationId?: string;
  error?: string;
  mock?: boolean;
}> {
  const status = getShopifyStatus();
  if (!status.canPublishLive) {
    return { ok: true, locationId: 'mock-location', mock: true };
  }
  const tokenRes = await ensureShopifyAccessToken();
  const token = tokenRes.token || '';
  const host = shopHost();
  try {
    const res = await fetch(`https://${host}/admin/api/${API_VERSION}/locations.json`, {
      headers: { 'X-Shopify-Access-Token': token },
    });
    const data = (await res.json()) as any;
    if (!res.ok) {
      return {
        ok: false,
        error: data?.errors ? JSON.stringify(data.errors) : `locations HTTP ${res.status}`,
      };
    }
    const locs = data?.locations || [];
    const active =
      locs.find((l: any) => l.active && l.legacy === false) ||
      locs.find((l: any) => l.active) ||
      locs[0];
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

  const tokenRes = await ensureShopifyAccessToken();
  const token = tokenRes.token || '';
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
        'X-Shopify-Access-Token': token,
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

/**
 * ECOM CJDropshipping adapter
 * - MOCK / SANDBOX / REAL
 * - auth, createOrder, product list, variants
 */

export type RuntimeMode = 'MOCK' | 'SANDBOX' | 'REAL';

export interface CjStatus {
  mode: RuntimeMode;
  configured: boolean;
  canFulfillLive: boolean;
  note: string;
  defaultVid?: string;
}

export interface FulfillInput {
  orderId: string;
  orderNumber?: string | null;
  productTitle: string;
  quantity: number;
  shippingName?: string;
  shippingAddress?: string;
  shippingCity?: string;
  shippingCountry?: string;
  shippingZip?: string;
  phone?: string;
  cjVariantId?: string;
  cjSku?: string;
  logisticName?: string;
}

export interface FulfillResult {
  ok: boolean;
  mock: boolean;
  supplierOrderId: string;
  trackingNumber?: string;
  carrier?: string;
  error?: string;
  raw?: unknown;
}

export interface CjProductHit {
  pid: string;
  productNameEn: string;
  productSku?: string;
  sellPriceUsd: number;
  productImage?: string;
}

export interface CjVariantHit {
  vid: string;
  variantSku: string;
  variantNameEn?: string;
  sellPriceUsd: number;
  weightG?: number;
}

function env(name: string, fallback = '') {
  return (process.env[name] ?? fallback).replace(/\r/g, '').trim();
}

function mode(): RuntimeMode {
  const m = env('ECOM_MODE', 'MOCK').toUpperCase();
  if (m === 'SANDBOX' || m === 'REAL') return m;
  return 'MOCK';
}

function apiKey() {
  return env('CJ_API_KEY');
}

function hasKey() {
  const k = apiKey();
  return k.length > 8 && !k.toLowerCase().includes('replace');
}

let cachedToken: { token: string; expiresAt: number } | null = null;

export function getCjStatus(): CjStatus {
  const m = mode();
  const configured = hasKey();
  const forceLive = env('ECOM_CJ_FORCE_LIVE').toLowerCase() === 'true';
  const canFulfillLive = configured && (m !== 'MOCK' || forceLive);
  const defaultVid = env('CJ_DEFAULT_VID') || undefined;

  return {
    mode: m,
    configured,
    canFulfillLive,
    defaultVid,
    note: canFulfillLive
      ? `CJ listo · defaultVid=${defaultVid || 'ninguno'}`
      : 'Sin CJ_API_KEY o modo MOCK — fulfillment simulado',
  };
}

export async function getCjAccessToken(): Promise<{
  ok: boolean;
  accessToken?: string;
  error?: string;
  raw?: unknown;
}> {
  if (!hasKey()) return { ok: false, error: 'CJ_API_KEY vacía' };

  if (cachedToken && Date.now() < cachedToken.expiresAt - 60_000) {
    return { ok: true, accessToken: cachedToken.token };
  }

  try {
    const res = await fetch(
      'https://developers.cjdropshipping.com/api2.0/v1/authentication/getAccessToken',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ apiKey: apiKey() }),
      },
    );
    const data = (await res.json()) as any;

    if (!res.ok || data?.result === false || !data?.data?.accessToken) {
      return {
        ok: false,
        error: data?.message || `CJ auth HTTP ${res.status}`,
        raw: data,
      };
    }

    const accessToken = String(data.data.accessToken);
    cachedToken = { token: accessToken, expiresAt: Date.now() + 24 * 60 * 60 * 1000 };
    return { ok: true, accessToken, raw: data };
  } catch (e: any) {
    return { ok: false, error: e?.message || 'Error de red al autenticar CJ' };
  }
}

/** Product list (GET). Optional keyword. */
export async function searchCjProducts(opts: {
  keyword?: string;
  pageNum?: number;
  pageSize?: number;
}): Promise<{ ok: boolean; items: CjProductHit[]; error?: string; raw?: unknown }> {
  const auth = await getCjAccessToken();
  if (!auth.ok || !auth.accessToken) {
    return { ok: false, items: [], error: auth.error || 'no token' };
  }

  const pageNum = opts.pageNum ?? 1;
  const pageSize = Math.min(opts.pageSize ?? 10, 20);
  const params = new URLSearchParams({
    pageNum: String(pageNum),
    pageSize: String(pageSize),
  });
  if (opts.keyword) params.set('productNameEn', opts.keyword);

  try {
    const res = await fetch(
      `https://developers.cjdropshipping.com/api2.0/v1/product/list?${params}`,
      {
        method: 'GET',
        headers: { 'CJ-Access-Token': auth.accessToken },
      },
    );
    const data = (await res.json()) as any;
    if (!res.ok || data?.result === false) {
      return {
        ok: false,
        items: [],
        error: data?.message || `CJ list HTTP ${res.status}`,
        raw: data,
      };
    }

    const list = data?.data?.list || data?.data || [];
    const rows = Array.isArray(list) ? list : [];
    const items: CjProductHit[] = rows.slice(0, pageSize).map((row: any) => ({
      pid: String(row.pid || row.productId || ''),
      productNameEn: String(row.productNameEn || row.productName || 'CJ product').slice(0, 160),
      productSku: row.productSku ? String(row.productSku) : undefined,
      sellPriceUsd: Number(row.sellPrice || row.nowPrice || 0) || 0,
      productImage: row.productImage,
    }));

    return { ok: true, items, raw: { count: items.length } };
  } catch (e: any) {
    return { ok: false, items: [], error: e?.message || 'CJ list network error' };
  }
}

/** Variants for a product id (GET). */
export async function getCjVariants(
  pid: string,
): Promise<{ ok: boolean; items: CjVariantHit[]; error?: string }> {
  if (!pid) return { ok: false, items: [], error: 'pid required' };
  const auth = await getCjAccessToken();
  if (!auth.ok || !auth.accessToken) {
    return { ok: false, items: [], error: auth.error || 'no token' };
  }

  try {
    const res = await fetch(
      `https://developers.cjdropshipping.com/api2.0/v1/product/variant/query?pid=${encodeURIComponent(pid)}`,
      {
        method: 'GET',
        headers: { 'CJ-Access-Token': auth.accessToken },
      },
    );
    const data = (await res.json()) as any;
    if (!res.ok || data?.result === false) {
      return { ok: false, items: [], error: data?.message || `variant HTTP ${res.status}` };
    }

    const list = Array.isArray(data?.data) ? data.data : data?.data?.list || [];
    const items: CjVariantHit[] = list.slice(0, 10).map((row: any) => ({
      vid: String(row.vid || ''),
      variantSku: String(row.variantSku || row.sku || ''),
      variantNameEn: row.variantNameEn || row.variantName,
      sellPriceUsd: Number(row.variantSellPrice || row.sellPrice || 0) || 0,
      weightG: row.variantWeight != null ? Number(row.variantWeight) : undefined,
    }));

    return { ok: true, items: items.filter((v) => v.vid || v.variantSku) };
  } catch (e: any) {
    return { ok: false, items: [], error: e?.message || 'variant network error' };
  }
}

/** Best effort: first product + first variant for a keyword. */
export async function matchCjByKeyword(keyword: string): Promise<{
  ok: boolean;
  product?: CjProductHit;
  variant?: CjVariantHit;
  error?: string;
}> {
  const cleaned = keyword
    .replace(/\[SERPER\]/gi, '')
    .replace(/[^a-zA-Z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 3)
    .slice(0, 4)
    .join(' ');
  if (!cleaned) return { ok: false, error: 'empty keyword' };

  const found = await searchCjProducts({ keyword: cleaned, pageSize: 5 });
  if (!found.ok || !found.items.length) {
    return { ok: false, error: found.error || 'no products' };
  }

  const product = found.items[0];
  const vars = await getCjVariants(product.pid);
  const variant = vars.items[0];
  return { ok: true, product, variant };
}

export async function fulfillOrder(input: FulfillInput): Promise<FulfillResult> {
  const status = getCjStatus();

  if (!status.canFulfillLive) {
    const supplierOrderId = `mock-cj-${Date.now()}`;
    const trackingNumber = `MOCKTRACK${Math.floor(Math.random() * 1e8)}`;
    return {
      ok: true,
      mock: true,
      supplierOrderId,
      trackingNumber,
      carrier: 'MOCK-Logistics',
      raw: {
        simulated: true,
        productTitle: input.productTitle,
        quantity: input.quantity,
        orderId: input.orderId,
      },
    };
  }

  const auth = await getCjAccessToken();
  if (!auth.ok || !auth.accessToken) {
    return {
      ok: false,
      mock: false,
      supplierOrderId: '',
      error: auth.error || 'No se pudo obtener CJ accessToken',
      raw: auth.raw,
    };
  }

  const vid = input.cjVariantId || env('CJ_DEFAULT_VID');
  const sku = input.cjSku || env('CJ_DEFAULT_SKU');

  if (!vid && !sku) {
    return {
      ok: false,
      mock: false,
      supplierOrderId: '',
      error: 'Falta vid/variantSku. Define CJ_DEFAULT_VID o vincula el producto a un variant CJ.',
    };
  }

  try {
    const productLine: Record<string, unknown> = {
      quantity: input.quantity || 1,
    };
    if (vid) productLine.vid = vid;
    if (sku) productLine.variantSku = sku;

    const fromCountryCode = env('CJ_FROM_COUNTRY', 'CN');
    const toCountryCode =
      !input.shippingCountry || input.shippingCountry === 'CO' || input.shippingCountry === 'Colombia'
        ? 'CO'
        : input.shippingCountry.length === 2
          ? input.shippingCountry.toUpperCase()
          : 'CO';

    const logisticName = input.logisticName || env('CJ_LOGISTIC_NAME', 'CJPacket Ordinary');

    const body: Record<string, unknown> = {
      orderNumber: input.orderNumber || input.orderId,
      fromCountryCode,
      logisticName,
      shippingCountryCode: toCountryCode,
      shippingCustomerName: input.shippingName || 'Customer Test',
      shippingAddress: input.shippingAddress || 'Calle 1 #1-1',
      shippingCity: input.shippingCity || 'Bogota',
      shippingProvince: input.shippingCity || 'Bogota',
      shippingCountry: input.shippingCountry || 'Colombia',
      shippingZip: input.shippingZip || '110111',
      shippingPhone: input.phone || '3000000000',
      products: [productLine],
    };

    const res = await fetch(
      'https://developers.cjdropshipping.com/api2.0/v1/shopping/order/createOrder',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'CJ-Access-Token': auth.accessToken,
        },
        body: JSON.stringify(body),
      },
    );

    const data = (await res.json()) as any;

    if (!res.ok || data?.result === false || (data?.code && data.code !== 200)) {
      return {
        ok: false,
        mock: false,
        supplierOrderId: '',
        error: data?.message || data?.errorCode || `CJ HTTP ${res.status}`,
        raw: data,
      };
    }

    const supplierOrderId = String(
      data?.data?.orderId || data?.data?.orderNum || data?.data?.orderNumber || `cj-${Date.now()}`,
    );
    return {
      ok: true,
      mock: false,
      supplierOrderId,
      trackingNumber: data?.data?.trackingNumber,
      carrier: data?.data?.logisticName || data?.data?.logisticsName || logisticName,
      raw: data,
    };
  } catch (e: any) {
    return {
      ok: false,
      mock: false,
      supplierOrderId: '',
      error: e?.message || 'Error de red CJ',
    };
  }
}

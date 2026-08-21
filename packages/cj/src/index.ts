/**
 * ECOM CJDropshipping adapter
 * - MOCK / SANDBOX / REAL
 * - apiKey → accessToken → createOrder
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

export async function getCjAccessToken(): Promise<{ ok: boolean; accessToken?: string; error?: string; raw?: unknown }> {
  if (!hasKey()) return { ok: false, error: 'CJ_API_KEY vacía' };

  if (cachedToken && Date.now() < cachedToken.expiresAt - 60_000) {
    return { ok: true, accessToken: cachedToken.token };
  }

  try {
    const res = await fetch('https://developers.cjdropshipping.com/api2.0/v1/authentication/getAccessToken', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ apiKey: apiKey() }),
    });
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
      raw: { simulated: true, productTitle: input.productTitle, quantity: input.quantity, orderId: input.orderId },
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

    const res = await fetch('https://developers.cjdropshipping.com/api2.0/v1/shopping/order/createOrder', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'CJ-Access-Token': auth.accessToken,
      },
      body: JSON.stringify(body),
    });

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

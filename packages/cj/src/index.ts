/**
 * ECOM CJDropshipping adapter
 * - MOCK: simulates supplier order + tracking
 * - SANDBOX/REAL: uses CJ_API_KEY when present and mode allows
 * - Budget: no automatic paid upgrades
 */

export type RuntimeMode = 'MOCK' | 'SANDBOX' | 'REAL';

export interface CjStatus {
  mode: RuntimeMode;
  configured: boolean;
  canFulfillLive: boolean;
  note: string;
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

export function getCjStatus(): CjStatus {
  const m = mode();
  const configured = hasKey();
  const forceLive = env('ECOM_CJ_FORCE_LIVE').toLowerCase() === 'true';
  const canFulfillLive = configured && (m !== 'MOCK' || forceLive);

  return {
    mode: m,
    configured,
    canFulfillLive,
    note: canFulfillLive
      ? 'CJ_API_KEY presente — fulfillment puede ser live'
      : 'Sin CJ_API_KEY o modo MOCK — fulfillment simulado',
  };
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

  // Live path: CJ Open API (structure ready; endpoint may require token exchange)
  // Docs vary by CJ version — keep call isolated and fail soft
  try {
    const res = await fetch('https://developers.cjdropshipping.com/api2.0/v1/shopping/order/createOrder', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'CJ-Access-Token': apiKey(),
      },
      body: JSON.stringify({
        orderNumber: input.orderNumber || input.orderId,
        products: [{ productName: input.productTitle, quantity: input.quantity }],
        consignee: input.shippingName || 'Customer',
        address: input.shippingAddress || '',
        city: input.shippingCity || '',
        country: input.shippingCountry || 'CO',
        zip: input.shippingZip || '',
        phone: input.phone || '',
      }),
    });

    const data = (await res.json()) as any;

    if (!res.ok || data?.result === false) {
      return {
        ok: false,
        mock: false,
        supplierOrderId: '',
        error: data?.message || data?.errorCode || `CJ HTTP ${res.status}`,
        raw: data,
      };
    }

    const supplierOrderId = String(data?.data?.orderId || data?.data?.orderNumber || `cj-${Date.now()}`);
    return {
      ok: true,
      mock: false,
      supplierOrderId,
      trackingNumber: data?.data?.trackingNumber,
      carrier: data?.data?.logisticName,
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

/**
 * CJ order tracking — documented getOrderDetail
 * GET https://developers.cjdropshipping.com/api2.0/v1/shopping/order/getOrderDetail?orderId=
 * Does NOT invent tracking numbers; returns null fields when absent.
 */

import { getCjAccessToken, getCjStatus } from './index';

// Re-import throttle by duplicating minimal fetch pace via getCjAccessToken side effects;
// use direct fetch with 1.1s guard locally to avoid circular exports issues.

let lastCall = 0;
async function pacedFetch(url: string, init?: RequestInit): Promise<Response> {
  const wait = 1100 - (Date.now() - lastCall);
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastCall = Date.now();
  return fetch(url, init);
}

export type CjTrackingResult = {
  ok: boolean;
  mock: boolean;
  supplierOrderId: string;
  trackingNumber: string | null;
  carrier: string | null;
  trackingUrl: string | null;
  orderStatus: string | null;
  error?: string;
  raw?: unknown;
};

export async function getCjOrderTracking(supplierOrderId: string): Promise<CjTrackingResult> {
  const id = String(supplierOrderId || '').trim();
  if (!id) {
    return {
      ok: false,
      mock: false,
      supplierOrderId: '',
      trackingNumber: null,
      carrier: null,
      trackingUrl: null,
      orderStatus: null,
      error: 'supplierOrderId required',
    };
  }

  const status = getCjStatus();
  if (!status.canFulfillLive) {
    // MOCK: no inventamos tracking realista “falso-real”; devolvemos explícitamente mock sin número
    return {
      ok: true,
      mock: true,
      supplierOrderId: id,
      trackingNumber: null,
      carrier: null,
      trackingUrl: null,
      orderStatus: 'MOCK_PENDING_TRACKING',
      raw: { simulated: true },
    };
  }

  const auth = await getCjAccessToken();
  if (!auth.ok || !auth.accessToken) {
    return {
      ok: false,
      mock: false,
      supplierOrderId: id,
      trackingNumber: null,
      carrier: null,
      trackingUrl: null,
      orderStatus: null,
      error: auth.error || 'no token',
    };
  }

  try {
    const url = `https://developers.cjdropshipping.com/api2.0/v1/shopping/order/getOrderDetail?orderId=${encodeURIComponent(id)}`;
    const res = await pacedFetch(url, {
      method: 'GET',
      headers: { 'CJ-Access-Token': auth.accessToken },
    });
    const data = (await res.json()) as any;
    if (!res.ok || data?.result === false) {
      return {
        ok: false,
        mock: false,
        supplierOrderId: id,
        trackingNumber: null,
        carrier: null,
        trackingUrl: null,
        orderStatus: null,
        error: data?.message || `CJ getOrderDetail HTTP ${res.status}`,
        raw: data,
      };
    }

    const d = data?.data ?? {};
    const rawTrack = d.trackingNumber || d.trackNumber || d.trackingNo || null;
    const trackingNumber =
      rawTrack && !/^(n\/?a|na|null|pending|tbd|-)$/i.test(String(rawTrack).trim())
        ? String(rawTrack)
        : null;

    return {
      ok: true,
      mock: false,
      supplierOrderId: id,
      trackingNumber,
      carrier: d.trackingProvider || d.logisticName || d.logisticsName || null,
      trackingUrl: d.trackingUrl || d.trackUrl || null,
      orderStatus: d.orderStatus || d.status || null,
      raw: { orderId: d.orderId, orderNum: d.orderNum },
    };
  } catch (e: any) {
    return {
      ok: false,
      mock: false,
      supplierOrderId: id,
      trackingNumber: null,
      carrier: null,
      trackingUrl: null,
      orderStatus: null,
      error: e?.message || 'CJ tracking network error',
    };
  }
}

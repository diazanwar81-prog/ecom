/**
 * CJ product images resolution (Phase 1)
 */
import { getCjAccessToken, searchCjProducts, type CjVariantHit } from './index';

/** Variant detail by vid — includes variantImage when available. */
export async function getCjVariantByVid(
  vid: string,
): Promise<{
  ok: boolean;
  item?: CjVariantHit & { variantImage?: string; pid?: string };
  error?: string;
  raw?: unknown;
}> {
  if (!vid) return { ok: false, error: 'vid required' };
  const auth = await getCjAccessToken();
  if (!auth.ok || !auth.accessToken) {
    return { ok: false, error: auth.error || 'no token' };
  }
  try {
    const res = await fetch(
      `https://developers.cjdropshipping.com/api2.0/v1/product/variant/query?vid=${encodeURIComponent(vid)}`,
      { method: 'GET', headers: { 'CJ-Access-Token': auth.accessToken } },
    );
    const data = (await res.json()) as any;
    if (!res.ok || data?.result === false) {
      return { ok: false, error: data?.message || `variant vid HTTP ${res.status}`, raw: data };
    }
    const list = Array.isArray(data?.data) ? data.data : data?.data ? [data.data] : [];
    const row = list[0];
    if (!row) return { ok: false, error: 'empty variant', raw: data };
    return {
      ok: true,
      item: {
        vid: String(row.vid || vid),
        variantSku: String(row.variantSku || row.sku || ''),
        variantNameEn: row.variantNameEn || row.variantName,
        sellPriceUsd: Number(row.variantSellPrice || row.sellPrice || 0) || 0,
        weightG: row.variantWeight != null ? Number(row.variantWeight) : undefined,
        variantImage: row.variantImage || row.variantImageEn || row.productImage || undefined,
        pid: row.pid ? String(row.pid) : undefined,
      },
      raw: data,
    };
  } catch (e: any) {
    return { ok: false, error: e?.message || 'variant vid network error' };
  }
}

/** Resolve HTTPS product images from CJ by vid, sku and/or title keyword. */
export async function resolveCjProductImages(input: {
  vid?: string | null;
  sku?: string | null;
  title?: string | null;
  limit?: number;
}): Promise<{ ok: boolean; urls: string[]; source?: string; error?: string }> {
  const limit = Math.min(input.limit ?? 6, 10);
  const urls: string[] = [];
  const push = (u: unknown) => {
    const s = String(u || '').trim();
    if (s && /^https?:\/\//i.test(s) && !urls.includes(s) && urls.length < limit) urls.push(s);
  };

  if (input.vid) {
    const v = await getCjVariantByVid(String(input.vid));
    if (v.ok && v.item) {
      push((v.item as any).variantImage);
      if (v.item.variantSku && urls.length < 1) {
        const bySku = await searchCjProducts({ keyword: v.item.variantSku, pageSize: 5 });
        for (const it of bySku.items || []) push(it.productImage);
      }
      if (urls.length) return { ok: true, urls, source: 'vid' };
    }
  }

  if (input.sku) {
    const bySku = await searchCjProducts({ keyword: String(input.sku).trim(), pageSize: 8 });
    for (const it of bySku.items || []) push(it.productImage);
    if (urls.length) return { ok: true, urls, source: 'sku' };
  }

  const cleaned = String(input.title || '')
    .replace(/\[(?:MOCK|SERPER\+CJ|SERPER|CJ)\]\s*/gi, '')
    .replace(/Cross-Border|Dropshipping/gi, ' ')
    .replace(/[^a-zA-Z0-9\u00C0-\u024F\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 3)
    .slice(0, 5)
    .join(' ')
    .trim();
  if (cleaned) {
    const found = await searchCjProducts({ keyword: cleaned, pageSize: 8 });
    for (const it of found.items || []) push(it.productImage);
    if (urls.length) return { ok: true, urls, source: 'title' };
  }

  return {
    ok: false,
    urls: [],
    error: 'No se encontraron imágenes CJ para vid/sku/title',
  };
}

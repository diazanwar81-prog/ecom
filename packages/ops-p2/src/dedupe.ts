/**
 * Deduplicación fuerte productos / pedidos.
 * Claves estables para DB unique + checks en memoria.
 */

export function normalizeSku(sku?: string | null): string {
  return String(sku || '')
    .trim()
    .toUpperCase()
    .replace(/\s+/g, '');
}

export function normalizeTitle(title?: string | null): string {
  return String(title || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

/** Product identity: prefer CJ ids, else sku, else title hash fingerprint */
export function productDedupeKey(input: {
  cjVariantId?: string | null;
  cjSku?: string | null;
  sku?: string | null;
  title?: string | null;
  supplier?: string | null;
}): string {
  const vid = String(input.cjVariantId || '').trim();
  if (vid) return `cj:vid:${vid}`;
  const cjSku = normalizeSku(input.cjSku);
  if (cjSku) return `cj:sku:${cjSku}`;
  const sku = normalizeSku(input.sku);
  if (sku) return `sku:${sku}`;
  const sup = String(input.supplier || 'unknown').toLowerCase();
  const t = normalizeTitle(input.title);
  return `title:${sup}:${t}`;
}

/** Shopify / external order id is canonical */
export function orderDedupeKey(input: {
  externalId?: string | null;
  shopifyOrderId?: string | null;
  orderNumber?: string | null;
  shopDomain?: string | null;
}): string {
  const ext = String(input.externalId || input.shopifyOrderId || '').trim();
  if (ext) return `shopify:order:${ext}`;
  const num = String(input.orderNumber || '').trim();
  const shop = String(input.shopDomain || 'default').toLowerCase();
  if (num) return `shopify:name:${shop}:${num}`;
  return `unknown:${shop}:${Date.now()}`;
}

export type DedupeStore = Set<string>;

export function createDedupeStore(seed: string[] = []): DedupeStore {
  return new Set(seed);
}

export function claimKey(store: DedupeStore, key: string): { isNew: boolean } {
  if (store.has(key)) return { isNew: false };
  store.add(key);
  return { isNew: true };
}

export function isDuplicateProduct(
  store: DedupeStore,
  input: Parameters<typeof productDedupeKey>[0],
): boolean {
  return store.has(productDedupeKey(input));
}

export function isDuplicateOrder(
  store: DedupeStore,
  input: Parameters<typeof orderDedupeKey>[0],
): boolean {
  return store.has(orderDedupeKey(input));
}

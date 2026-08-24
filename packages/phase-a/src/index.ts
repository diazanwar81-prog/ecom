/**
 * Phase A — verification & validation (blocks 77–81 combined)
 */

export const PHASE_A_META = {
  name: 'phase-a',
  blocks: [77, 78, 79, 80, 81],
  title: 'Verificación y validación comercial',
};

export type CheckSeverity = 'critical' | 'warning' | 'info';

export interface PhaseCheck {
  id: string;
  ok: boolean;
  severity: CheckSeverity;
  message: string;
  detail?: string;
}

export function summarizePhaseA(items: PhaseCheck[]) {
  const criticalFailed = items.filter((i) => i.severity === 'critical' && !i.ok).length;
  const warnings = items.filter((i) => i.severity === 'warning' && !i.ok).length;
  const passed = items.filter((i) => i.ok).length;
  return {
    ok: criticalFailed === 0,
    criticalFailed,
    warnings,
    passed,
    total: items.length,
    score: items.length ? Math.round((passed / items.length) * 100) : 0,
    items,
  };
}

export function buildPhaseAChecks(input: {
  mode: string;
  shopifyConfigured: boolean;
  tokenRefreshReady: boolean;
  tokenOk?: boolean;
  tokenError?: string;
  cjConfigured: boolean;
  webhookSecret: boolean;
  httpsPublic: boolean;
  publishedWithCj: number;
  productsWithDescription: number;
  productsTotal: number;
  paidOrders: number;
  fulfilledOrders: number;
  inventorySyncSupported: boolean;
}): PhaseCheck[] {
  const items: PhaseCheck[] = [];

  items.push({
    id: 'token_static_or_refresh',
    ok: input.shopifyConfigured,
    severity: 'critical',
    message: input.shopifyConfigured
      ? 'Shopify token/shop configurados'
      : 'Falta SHOPIFY_ACCESS_TOKEN o SHOPIFY_SHOP',
  });

  items.push({
    id: 'token_refresh',
    ok: input.tokenRefreshReady || input.tokenOk === true,
    severity: 'warning',
    message: input.tokenRefreshReady
      ? 'Client credentials listos para refresh automático'
      : 'Sin SHOPIFY_CLIENT_ID/SECRET — renueva token a mano si expira',
    detail: input.tokenError,
  });

  if (input.tokenOk === false) {
    items.push({
      id: 'token_live_probe',
      ok: false,
      severity: 'critical',
      message: 'Refresh/token falló',
      detail: input.tokenError,
    });
  } else if (input.tokenOk === true) {
    items.push({
      id: 'token_live_probe',
      ok: true,
      severity: 'info',
      message: 'Token usable (estático o refrescado)',
    });
  }

  items.push({
    id: 'inventory_on_publish',
    ok: input.inventorySyncSupported,
    severity: 'critical',
    message: input.inventorySyncSupported
      ? 'Publish soporta inventory_management + set inventory'
      : 'Falta path de inventario post-publish',
  });

  items.push({
    id: 'descriptions',
    ok: input.productsWithDescription > 0 || input.productsTotal === 0,
    severity: 'warning',
    message:
      input.productsWithDescription > 0
        ? `${input.productsWithDescription}/${input.productsTotal} productos con description`
        : 'Ningún producto tiene description — usa Copy IA en los que vayas a publicar',
  });

  items.push({
    id: 'webhook_secret',
    ok: input.webhookSecret,
    severity: 'warning',
    message: input.webhookSecret
      ? 'SHOPIFY_WEBHOOK_SECRET presente'
      : 'Sin SHOPIFY_WEBHOOK_SECRET — HMAC no se valida en producción',
  });

  items.push({
    id: 'https_public',
    ok: input.httpsPublic || input.mode === 'MOCK',
    severity: input.mode === 'REAL' ? 'critical' : 'warning',
    message: input.httpsPublic
      ? 'API_URL/APP_URL en HTTPS (webhooks Shopify)'
      : 'Sin HTTPS público (túnel o dominio fijo requerido para webhooks reales)',
  });

  items.push({
    id: 'cj',
    ok: input.cjConfigured,
    severity: 'critical',
    message: input.cjConfigured ? 'CJ_API_KEY presente' : 'Falta CJ_API_KEY',
  });

  items.push({
    id: 'catalog_cj_published',
    ok: input.publishedWithCj > 0,
    severity: 'warning',
    message:
      input.publishedWithCj > 0
        ? `${input.publishedWithCj} publicados con vínculo CJ`
        : 'Ningún PUBLISHED con cjSku/vid — haz un go-live de prueba',
  });

  items.push({
    id: 'orders_loop',
    ok: input.fulfilledOrders > 0 || input.paidOrders === 0,
    severity: 'info',
    message: `Pedidos PAID=${input.paidOrders} FULFILLED=${input.fulfilledOrders}`,
  });

  return items;
}

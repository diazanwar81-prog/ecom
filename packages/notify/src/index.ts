/** Lightweight Telegram notifier for ECOM ops alerts (mensajes en español). */

function env(name: string, fallback = ''): string {
  return (process.env[name] || fallback).trim();
}

export function getNotifyStatus() {
  const token = env('TELEGRAM_BOT_TOKEN');
  const chatId = env('TELEGRAM_CHAT_ID');
  const enabled = env('ECOM_TELEGRAM_ALERTS', 'true') !== 'false';
  return {
    provider: 'telegram',
    configured: Boolean(token && chatId),
    enabled,
    chatIdSet: Boolean(chatId),
    tokenSet: Boolean(token),
  };
}

export async function sendTelegram(text: string): Promise<{ ok: boolean; skipped?: boolean; error?: string; raw?: any }> {
  const status = getNotifyStatus();
  if (!status.enabled) return { ok: true, skipped: true, error: 'alerts disabled' };
  if (!status.configured) return { ok: false, skipped: true, error: 'TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID missing' };

  const token = env('TELEGRAM_BOT_TOKEN');
  const chatId = env('TELEGRAM_CHAT_ID');
  const url = `https://api.telegram.org/bot${token}/sendMessage`;

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text: text.slice(0, 3900),
        disable_web_page_preview: true,
      }),
    });
    const raw = await res.json().catch(() => ({}));
    if (!res.ok || raw?.ok === false) {
      return { ok: false, error: raw?.description || `HTTP ${res.status}`, raw };
    }
    return { ok: true, raw };
  } catch (e: any) {
    return { ok: false, error: e?.message || String(e) };
  }
}

const EVENT_ES: Record<string, string> = {
  BOOT: 'Arranque del sistema',
  STOCK_ZERO: 'Stock en cero',
  STOCK_PAUSE: 'Producto en pausa',
  FULFILL_FAILED: 'Fulfillment fallido',
  FULFILL_OK: 'Pedido enviado a CJ',
  GO_LIVE: 'Producto publicado',
  PUBLISH_FAILED: 'Publicación fallida',
  DISCOVERY_ERROR: 'Error en discovery',
  JOB_ERROR: 'Error en job',
};

const FIELD_ES: Record<string, string> = {
  mode: 'modo',
  service: 'servicio',
  block: 'bloque',
  productId: 'producto',
  title: 'título',
  stock: 'stock',
  marginBand: 'banda de margen',
  orderId: 'pedido',
  orderNumber: 'número de pedido',
  error: 'error',
  reason: 'motivo',
  externalId: 'id externo',
  sku: 'SKU',
  supplierOrderId: 'orden proveedor',
};

export async function alertOps(event: string, details: Record<string, unknown> = {}) {
  const mode = process.env.ECOM_MODE || 'MOCK';
  const title = EVENT_ES[event] || event;
  const lines = [`ECOM · ${title}`, `modo: ${mode}`];

  for (const [k, v] of Object.entries(details)) {
    if (k === 'mode') continue;
    const label = FIELD_ES[k] || k;
    const value = typeof v === 'object' ? JSON.stringify(v) : String(v ?? '');
    lines.push(`${label}: ${value}`);
  }

  return sendTelegram(lines.join('\n'));
}

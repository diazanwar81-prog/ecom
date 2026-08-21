/** Lightweight Telegram notifier for ECOM ops alerts. */

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

export async function alertOps(event: string, details: Record<string, unknown> = {}) {
  const mode = process.env.ECOM_MODE || 'MOCK';
  const lines = [
    `ECOM · ${event}`,
    `mode=${mode}`,
    ...Object.entries(details).map(([k, v]) => `${k}: ${typeof v === 'object' ? JSON.stringify(v) : v}`),
  ];
  return sendTelegram(lines.join('\n'));
}

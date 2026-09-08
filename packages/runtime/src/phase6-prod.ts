/**
 * FASE 6 — Producción: checklist de readiness (no despliega solo)
 */

export const PHASE6 = {
  id: 6,
  name: 'Producción',
  artifacts: [
    '.github/workflows/ci.yml',
    'docs/RUNBOOK.md',
    'docs/PHASES_1_6_COMPLETION.md',
  ],
} as const;

export type ProdCheck = { id: string; ok: boolean; critical: boolean; message: string };

export function phase6Readiness(env: Record<string, string | undefined> = process.env): {
  ok: boolean;
  score: number;
  checks: ProdCheck[];
} {
  const checks: ProdCheck[] = [
    {
      id: 'https_url',
      critical: true,
      ok: /^https:\/\//i.test(String(env.API_URL || '')),
      message: 'API_URL debe ser HTTPS público en REAL',
    },
    {
      id: 'session_secret',
      critical: true,
      ok: String(env.SESSION_SECRET || '').length >= 16,
      message: 'SESSION_SECRET ≥ 16',
    },
    {
      id: 'shopify',
      critical: true,
      ok: Boolean(env.SHOPIFY_SHOP_DOMAIN && env.SHOPIFY_ACCESS_TOKEN),
      message: 'Shopify configurado',
    },
    {
      id: 'cj',
      critical: true,
      ok: Boolean(env.CJ_API_KEY),
      message: 'CJ_API_KEY',
    },
    {
      id: 'webhook_secret',
      critical: true,
      ok: Boolean(env.SHOPIFY_WEBHOOK_SECRET),
      message: 'SHOPIFY_WEBHOOK_SECRET',
    },
    {
      id: 'paid_ai_off',
      critical: true,
      ok: String(env.ECOM_ALLOW_PAID_AI || 'false').toLowerCase() !== 'true',
      message: 'ECOM_ALLOW_PAID_AI debe ser false por defecto',
    },
    {
      id: 'real_confirm',
      critical: false,
      ok:
        String(env.ECOM_MODE || '').toUpperCase() !== 'REAL' ||
        env.ECOM_REAL_CONFIRM === 'I_UNDERSTAND_REAL_MODE',
      message: 'REAL requiere ECOM_REAL_CONFIRM',
    },
    {
      id: 'telegram',
      critical: false,
      ok: Boolean(env.TELEGRAM_BOT_TOKEN && env.TELEGRAM_CHAT_ID),
      message: 'Telegram alertas (recomendado)',
    },
  ];
  const criticalFailed = checks.filter((c) => c.critical && !c.ok).length;
  const score = Math.round((checks.filter((c) => c.ok).length / checks.length) * 100);
  return { ok: criticalFailed === 0, score, checks };
}

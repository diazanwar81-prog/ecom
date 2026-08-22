/**
 * ECOM Deploy — block 36
 * Production readiness checklist, env audit, CI hints.
 */

export type CheckItem = {
  key: string;
  ok: boolean;
  severity: 'critical' | 'recommended' | 'optional';
  note: string;
};

function has(env: Record<string, string | undefined>, k: string, minLen = 1): boolean {
  const v = env[k];
  return typeof v === 'string' && v.trim().length >= minLen;
}

export function productionReadiness(env: Record<string, string | undefined> = process.env): {
  ok: boolean;
  score: number;
  items: CheckItem[];
  blockers: string[];
} {
  const mode = (env.ECOM_MODE || 'MOCK').toUpperCase();
  const items: CheckItem[] = [
    {
      key: 'ECOM_MODE',
      ok: mode === 'SANDBOX' || mode === 'REAL',
      severity: 'critical',
      note: `Actual: ${mode}. REAL solo cuando checklist completa.`,
    },
    {
      key: 'DATABASE_URL',
      ok: has(env, 'DATABASE_URL', 10),
      severity: 'critical',
      note: 'Postgres de producción / staging',
    },
    {
      key: 'REDIS_URL',
      ok: has(env, 'REDIS_URL', 8),
      severity: 'critical',
      note: 'Cola BullMQ',
    },
    {
      key: 'SESSION_SECRET',
      ok: has(env, 'SESSION_SECRET', 16),
      severity: 'critical',
      note: '≥16 caracteres',
    },
    {
      key: 'SHOPIFY_ACCESS_TOKEN',
      ok: has(env, 'SHOPIFY_ACCESS_TOKEN', 10),
      severity: 'critical',
      note: 'Admin API token',
    },
    {
      key: 'SHOPIFY_SHOP_DOMAIN',
      ok: has(env, 'SHOPIFY_SHOP_DOMAIN', 5),
      severity: 'critical',
      note: '*.myshopify.com',
    },
    {
      key: 'SHOPIFY_WEBHOOK_SECRET',
      ok: has(env, 'SHOPIFY_WEBHOOK_SECRET', 8),
      severity: 'critical',
      note: 'Firma webhooks',
    },
    {
      key: 'CJ_API_KEY',
      ok: has(env, 'CJ_API_KEY', 8),
      severity: 'critical',
      note: 'Fulfillment supplier',
    },
    {
      key: 'ECOM_ALLOW_PAID_AI',
      ok: String(env.ECOM_ALLOW_PAID_AI || 'false').toLowerCase() === 'false',
      severity: 'recommended',
      note: 'Debe ser false salvo presupuesto explícito',
    },
    {
      key: 'ECOM_ALLOW_PAID_ADS',
      ok: String(env.ECOM_ALLOW_PAID_ADS || 'false').toLowerCase() === 'false',
      severity: 'recommended',
      note: 'Ads $0 por defecto',
    },
    {
      key: 'TELEGRAM_BOT_TOKEN',
      ok: has(env, 'TELEGRAM_BOT_TOKEN', 10),
      severity: 'recommended',
      note: 'Alertas ops',
    },
    {
      key: 'HTTPS_TUNNEL_OR_DOMAIN',
      ok: has(env, 'APP_URL', 8) && String(env.APP_URL).startsWith('https'),
      severity: 'recommended',
      note: 'URL pública HTTPS para webhooks',
    },
  ];

  const criticalFail = items.filter((i) => i.severity === 'critical' && !i.ok);
  const okCount = items.filter((i) => i.ok).length;
  const score = Math.round((okCount / items.length) * 100);
  return {
    ok: criticalFail.length === 0,
    score,
    items,
    blockers: criticalFail.map((i) => i.key),
  };
}

export function ciPipelineHint(): string[] {
  return [
    '1. pnpm install --frozen-lockfile',
    '2. pnpm --filter @ecom/rules test (si vitest disponible)',
    '3. prisma generate + migrate deploy',
    '4. docker compose build api web',
    '5. health check curl $API_URL/health',
    '6. Nunca subir .env con secretos reales',
  ];
}

export const DEPLOY_META = {
  block: 36,
  features: ['readiness_checklist', 'ci_hints', 'mode_gate'],
};

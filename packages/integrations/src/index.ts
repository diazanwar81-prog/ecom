/**
 * ECOM Integration Manager — Centro de integraciones
 * Registry + status + test contract. Secrets nunca van al frontend.
 * CONNECT/DISCONNECT persisten en API/DB; este paquete es la lógica pura.
 */

export type IntegrationId =
  | 'shopify'
  | 'cj'
  | 'dropi'
  | 'serper'
  | 'telegram'
  | 'gemini'
  | 'canva'
  | 'pinterest'
  | 'openai_compat';

export type IntegrationStatus =
  | 'DISCONNECTED'
  | 'CONNECTED'
  | 'ERROR'
  | 'DISABLED'
  | 'PENDING_AUTH';

export type AuthKind = 'oauth' | 'api_key' | 'bot_token' | 'none';

export type IntegrationDef = {
  id: IntegrationId;
  name: string;
  category: 'commerce' | 'supplier' | 'trends' | 'alerts' | 'ai' | 'branding' | 'social';
  authKind: AuthKind;
  /** Requires explicit cost/allow flag before CONNECT in REAL */
  paidRisk: boolean;
  envKeys: string[];
  allowFlag?: string;
  description: string;
};

export const INTEGRATION_CATALOG: IntegrationDef[] = [
  {
    id: 'shopify',
    name: 'Shopify',
    category: 'commerce',
    authKind: 'api_key',
    paidRisk: false,
    envKeys: ['SHOPIFY_SHOP_DOMAIN', 'SHOPIFY_ACCESS_TOKEN', 'SHOPIFY_WEBHOOK_SECRET'],
    description: 'Productos, pedidos, webhooks, inventario',
  },
  {
    id: 'cj',
    name: 'CJ Dropshipping',
    category: 'supplier',
    authKind: 'api_key',
    paidRisk: false,
    envKeys: ['CJ_API_KEY'],
    description: 'Catálogo, fulfill, tracking, delist proxy',
  },
  {
    id: 'dropi',
    name: 'Dropi',
    category: 'supplier',
    authKind: 'api_key',
    paidRisk: false,
    envKeys: ['DROPI_API_KEY'],
    description: 'Proveedor alternativo (Colombia) — connector stub',
  },
  {
    id: 'serper',
    name: 'Serper / Trends',
    category: 'trends',
    authKind: 'api_key',
    paidRisk: false,
    envKeys: ['SERPER_API_KEY'],
    description: 'Discovery / tendencias search',
  },
  {
    id: 'telegram',
    name: 'Telegram Alerts',
    category: 'alerts',
    authKind: 'bot_token',
    paidRisk: false,
    envKeys: ['TELEGRAM_BOT_TOKEN', 'TELEGRAM_CHAT_ID'],
    description: 'Alertas ops y digest',
  },
  {
    id: 'gemini',
    name: 'Google Gemini',
    category: 'ai',
    authKind: 'api_key',
    paidRisk: true,
    envKeys: ['GEMINI_API_KEY'],
    allowFlag: 'ECOM_ALLOW_PAID_AI',
    description: 'AI Router — bloqueado si ECOM_ALLOW_PAID_AI!=true',
  },
  {
    id: 'canva',
    name: 'Canva',
    category: 'branding',
    authKind: 'oauth',
    paidRisk: true,
    envKeys: ['CANVA_CLIENT_ID', 'CANVA_CLIENT_SECRET'],
    allowFlag: 'ECOM_ALLOW_CANVA',
    description: 'Branding — OFF por defecto',
  },
  {
    id: 'pinterest',
    name: 'Pinterest',
    category: 'social',
    authKind: 'oauth',
    paidRisk: false,
    envKeys: ['PINTEREST_ACCESS_TOKEN'],
    description: 'Trends / orgánico — opcional',
  },
];

export type ConnectionSnapshot = {
  id: IntegrationId;
  status: IntegrationStatus;
  configured: boolean;
  lastError?: string;
  allowBlocked?: boolean;
  missingEnv: string[];
};

function env(name: string): string {
  return String(process.env[name] ?? '')
    .replace(/\r/g, '')
    .trim();
}

function flagTrue(name?: string): boolean {
  if (!name) return true;
  const v = env(name).toLowerCase();
  return v === 'true' || v === '1' || v === 'yes';
}

function isConfigured(def: IntegrationDef): { ok: boolean; missing: string[] } {
  const missing = def.envKeys.filter((k) => {
    const v = env(k);
    return !v || v.toLowerCase().includes('replace');
  });
  return { ok: missing.length === 0, missing };
}

/** Status from env only (no network). Safe for panel bootstrap. */
export function getIntegrationSnapshot(id: IntegrationId): ConnectionSnapshot {
  const def = INTEGRATION_CATALOG.find((d) => d.id === id);
  if (!def) {
    return {
      id,
      status: 'ERROR',
      configured: false,
      lastError: 'unknown_integration',
      missingEnv: [],
    };
  }
  if (def.paidRisk && def.allowFlag && !flagTrue(def.allowFlag)) {
    const cfg = isConfigured(def);
    return {
      id,
      status: 'DISABLED',
      configured: cfg.ok,
      allowBlocked: true,
      missingEnv: cfg.missing,
      lastError: `${def.allowFlag} must be true to enable`,
    };
  }
  const cfg = isConfigured(def);
  if (!cfg.ok) {
    return {
      id,
      status: 'DISCONNECTED',
      configured: false,
      missingEnv: cfg.missing,
    };
  }
  return {
    id,
    status: 'CONNECTED',
    configured: true,
    missingEnv: [],
  };
}

export function listIntegrationSnapshots(): ConnectionSnapshot[] {
  return INTEGRATION_CATALOG.map((d) => getIntegrationSnapshot(d.id));
}

export type TestResult = {
  id: IntegrationId;
  ok: boolean;
  status: IntegrationStatus;
  message: string;
  mock?: boolean;
};

/**
 * Local/config test only — does not call paid APIs.
 * Network live tests belong in API adapters (shopify/cj) when mode allows.
 */
export function testIntegrationConfig(id: IntegrationId): TestResult {
  const snap = getIntegrationSnapshot(id);
  if (snap.status === 'DISABLED') {
    return { id, ok: false, status: 'DISABLED', message: snap.lastError || 'disabled' };
  }
  if (!snap.configured) {
    return {
      id,
      ok: false,
      status: 'DISCONNECTED',
      message: `Faltan env: ${snap.missingEnv.join(', ')}`,
    };
  }
  return {
    id,
    ok: true,
    status: 'CONNECTED',
    message: 'Credenciales presentes (test de config; no es ping live)',
    mock: false,
  };
}

export function canUseIntegration(id: IntegrationId): {
  allowed: boolean;
  reason?: string;
} {
  const snap = getIntegrationSnapshot(id);
  if (snap.status === 'DISABLED') return { allowed: false, reason: snap.lastError };
  if (!snap.configured) return { allowed: false, reason: 'not_configured' };
  return { allowed: true };
}

export const INTEGRATIONS_META = {
  feature: 'integration_manager',
  actions: ['list', 'status', 'test_config', 'connect_gate'],
  note: 'OAuth token storage + UI /integrations se cablean en apps/api y apps/web',
};

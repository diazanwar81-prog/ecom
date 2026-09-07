/**
 * Alertas + kill-switch + budget diario (sin gastar APIs de pago).
 */

export type AlertSeverity = 'info' | 'warn' | 'critical';

export type AlertEvent = {
  id: string;
  severity: AlertSeverity;
  code: string;
  message: string;
  at: string;
  meta?: Record<string, unknown>;
};

export function isKillSwitchOn(env: Record<string, string | undefined> = process.env): boolean {
  const k = String(env.ECOM_KILL_SWITCH || '').toLowerCase();
  const p = String(env.ECOM_PAUSE_ALL || '').toLowerCase();
  return k === 'true' || k === '1' || p === 'true' || p === '1';
}

export type BudgetCaps = {
  maxNewProducts: number;
  maxPublishes: number;
  maxFulfills: number;
  maxAiCalls: number;
  maxSpendUsd: number;
};

export function loadBudgetCaps(env: Record<string, string | undefined> = process.env): BudgetCaps {
  const n = (k: string, d: number, max: number) => {
    const v = Number(env[k]);
    if (!Number.isFinite(v) || v < 0) return d;
    return Math.min(v, max);
  };
  return {
    maxNewProducts: n('ECOM_MAX_NEW_PRODUCTS_PER_DAY', 10, 50),
    maxPublishes: n('ECOM_MAX_PUBLISHES_PER_DAY', 20, 100),
    maxFulfills: n('ECOM_MAX_FULFILLS_PER_DAY', 50, 200),
    maxAiCalls: n('ECOM_MAX_AI_CALLS_PER_DAY', 100, 500),
    maxSpendUsd: n('ECOM_ADS_MAX_DAILY_USD', 0, 1000),
  };
}

export type BudgetUsage = {
  newProducts: number;
  publishes: number;
  fulfills: number;
  aiCalls: number;
  spendUsd: number;
};

export type BudgetCheck =
  | { ok: true; remaining: Partial<BudgetUsage> }
  | { ok: false; code: string; message: string };

export function checkBudget(
  action: keyof BudgetUsage,
  usage: BudgetUsage,
  caps: BudgetCaps = loadBudgetCaps(),
): BudgetCheck {
  const map: Record<keyof BudgetUsage, { cap: number; used: number; code: string }> = {
    newProducts: { cap: caps.maxNewProducts, used: usage.newProducts, code: 'cap_new_products' },
    publishes: { cap: caps.maxPublishes, used: usage.publishes, code: 'cap_publishes' },
    fulfills: { cap: caps.maxFulfills, used: usage.fulfills, code: 'cap_fulfills' },
    aiCalls: { cap: caps.maxAiCalls, used: usage.aiCalls, code: 'cap_ai' },
    spendUsd: { cap: caps.maxSpendUsd, used: usage.spendUsd, code: 'cap_spend' },
  };
  const row = map[action];
  if (row.used >= row.cap) {
    return {
      ok: false,
      code: row.code,
      message: `${action} daily cap ${row.cap} reached (${row.used})`,
    };
  }
  return {
    ok: true,
    remaining: { [action]: Math.max(0, row.cap - row.used) } as Partial<BudgetUsage>,
  };
}

export function gateAction(input: {
  action: keyof BudgetUsage;
  usage: BudgetUsage;
  env?: Record<string, string | undefined>;
}): { allowed: boolean; alerts: AlertEvent[]; reason?: string } {
  const env = input.env || process.env;
  const alerts: AlertEvent[] = [];
  const now = new Date().toISOString();

  if (isKillSwitchOn(env)) {
    alerts.push({
      id: `kill-${Date.now()}`,
      severity: 'critical',
      code: 'KILL_SWITCH',
      message: env.ECOM_KILL_SWITCH_REASON || 'Kill-switch activo',
      at: now,
    });
    return { allowed: false, alerts, reason: 'kill_switch' };
  }

  if (String(env.ECOM_ALLOW_PAID_AI || '').toLowerCase() === 'true' && input.action === 'aiCalls') {
    alerts.push({
      id: `ai-paid-${Date.now()}`,
      severity: 'warn',
      code: 'PAID_AI_ENABLED',
      message: 'ECOM_ALLOW_PAID_AI=true — revisar presupuesto',
      at: now,
    });
  }

  if (String(env.ECOM_ALLOW_PAID_ADS || '').toLowerCase() === 'true' && input.action === 'spendUsd') {
    alerts.push({
      id: `ads-${Date.now()}`,
      severity: 'warn',
      code: 'PAID_ADS_ENABLED',
      message: 'Ads de pago habilitados',
      at: now,
    });
  }

  const budget = checkBudget(input.action, input.usage, loadBudgetCaps(env));
  if (!budget.ok) {
    alerts.push({
      id: `budget-${Date.now()}`,
      severity: 'warn',
      code: budget.code,
      message: budget.message,
      at: now,
    });
    return { allowed: false, alerts, reason: budget.code };
  }

  return { allowed: true, alerts };
}

/** Payload listo para Telegram / panel */
export function formatAlertMessage(a: AlertEvent): string {
  return `[ECOM ${a.severity.toUpperCase()}] ${a.code}: ${a.message}`;
}

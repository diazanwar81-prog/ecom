/**
 * Autopilot constraints — límites antes de auto-approve / auto-publish
 */

export type ApprovalMode = 'MANUAL' | 'SEMIAUTO' | 'AUTO';

export type AutopilotConstraints = {
  enabled: boolean;
  country: string;
  currency: string;
  minMarginPct: number;
  maxShippingPctOfPrice: number;
  maxNewProductsPerDay: number;
  maxPublishesPerDay: number;
  maxFulfillsPerDay: number;
  maxAiCallsPerDay: number;
  maxAutoApprovePerDay: number;
  approvalMode: ApprovalMode;
  allowPaidAi: boolean;
  allowCanva: boolean;
  killSwitch: boolean;
};

function num(name: string, fallback: number, max?: number): number {
  const n = Number(process.env[name]);
  if (!Number.isFinite(n) || n < 0) return fallback;
  if (max != null) return Math.min(n, max);
  return n;
}

function flag(name: string): boolean {
  const v = String(process.env[name] || '')
    .trim()
    .toLowerCase();
  return v === 'true' || v === '1' || v === 'yes';
}

export function loadConstraintsFromEnv(): AutopilotConstraints {
  const mode = String(process.env.ECOM_APPROVAL_MODE || 'MANUAL').toUpperCase();
  const approvalMode: ApprovalMode =
    mode === 'AUTO' || mode === 'SEMIAUTO' || mode === 'MANUAL' ? mode : 'MANUAL';

  return {
    enabled: flag('ECOM_AUTOPILOT') || flag('ECOM_AUTO_GO_LIVE'),
    country: process.env.ECOM_MARKET_COUNTRY || 'CO',
    currency: process.env.ECOM_MARKET_CURRENCY || 'COP',
    minMarginPct: num('ECOM_MIN_MARGIN_PCT', 35),
    maxShippingPctOfPrice: num('ECOM_MAX_SHIPPING_PCT', 15),
    maxNewProductsPerDay: num('ECOM_MAX_NEW_PRODUCTS_PER_DAY', 10, 50),
    maxPublishesPerDay: num('ECOM_MAX_PUBLISHES_PER_DAY', 20, 100),
    maxFulfillsPerDay: num('ECOM_MAX_FULFILLS_PER_DAY', 50, 200),
    maxAiCallsPerDay: num('ECOM_MAX_AI_CALLS_PER_DAY', 100, 500),
    maxAutoApprovePerDay: num('ECOM_AUTO_APPROVE_MAX_PER_DAY', 20, 100),
    approvalMode,
    allowPaidAi: flag('ECOM_ALLOW_PAID_AI'),
    allowCanva: flag('ECOM_ALLOW_CANVA'),
    killSwitch: flag('ECOM_KILL_SWITCH') || flag('ECOM_PAUSE_ALL'),
  };
}

export type AutopilotAction = 'discover' | 'auto_approve' | 'auto_publish' | 'fulfill' | 'ai_call';

export type UsageCounters = {
  newProductsToday: number;
  publishesToday: number;
  fulfillsToday: number;
  aiCallsToday: number;
  autoApprovesToday: number;
};

export function evaluateAutopilotAction(
  action: AutopilotAction,
  constraints: AutopilotConstraints,
  usage: UsageCounters,
  context?: { marginPct?: number; shippingPct?: number; isFirstPublish?: boolean },
): { allowed: boolean; reason?: string } {
  if (!constraints.enabled) return { allowed: false, reason: 'autopilot_disabled' };
  if (constraints.killSwitch) return { allowed: false, reason: 'kill_switch' };

  if (action === 'ai_call') {
    if (!constraints.allowPaidAi && process.env.ECOM_AI_FORCE_LIVE === 'true') {
      // still allow if force live free tier — cost gate separate
    }
    if (usage.aiCallsToday >= constraints.maxAiCallsPerDay) {
      return { allowed: false, reason: 'ai_daily_cap' };
    }
    return { allowed: true };
  }

  if (action === 'discover') {
    if (usage.newProductsToday >= constraints.maxNewProductsPerDay) {
      return { allowed: false, reason: 'new_products_cap' };
    }
    return { allowed: true };
  }

  if (action === 'auto_approve') {
    if (constraints.approvalMode === 'MANUAL') {
      return { allowed: false, reason: 'approval_mode_manual' };
    }
    if (usage.autoApprovesToday >= constraints.maxAutoApprovePerDay) {
      return { allowed: false, reason: 'auto_approve_cap' };
    }
    if (context?.marginPct != null && context.marginPct < constraints.minMarginPct) {
      return { allowed: false, reason: 'margin_below_min' };
    }
    if (
      context?.shippingPct != null &&
      context.shippingPct > constraints.maxShippingPctOfPrice
    ) {
      return { allowed: false, reason: 'shipping_pct_exceeded' };
    }
    return { allowed: true };
  }

  if (action === 'auto_publish') {
    if (!flag('ECOM_AUTO_GO_LIVE') && constraints.approvalMode !== 'AUTO') {
      return { allowed: false, reason: 'auto_publish_disabled' };
    }
    if (context?.isFirstPublish && constraints.approvalMode !== 'AUTO') {
      return { allowed: false, reason: 'first_publish_needs_human' };
    }
    if (usage.publishesToday >= constraints.maxPublishesPerDay) {
      return { allowed: false, reason: 'publish_cap' };
    }
    if (context?.marginPct != null && context.marginPct < constraints.minMarginPct) {
      return { allowed: false, reason: 'margin_below_min' };
    }
    return { allowed: true };
  }

  if (action === 'fulfill') {
    if (usage.fulfillsToday >= constraints.maxFulfillsPerDay) {
      return { allowed: false, reason: 'fulfill_cap' };
    }
    return { allowed: true };
  }

  return { allowed: false, reason: 'unknown_action' };
}

function flag(name: string): boolean {
  const v = String(process.env[name] || '')
    .trim()
    .toLowerCase();
  return v === 'true' || v === '1' || v === 'yes';
}

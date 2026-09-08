/**
 * Phase-3 panel wire — KPIs reales desde Prisma + six-phase self-check
 */
import { buildDashboardKpis, type KpiInput } from '../../../packages/ops-p3/src/index';
import { runSixPhaseSelfCheck } from '../../../packages/runtime/src/index';
import { listIntegrationSnapshots } from '../../../packages/integrations/src/index';

type PrismaCounts = {
  product: { count: (args?: any) => Promise<number> };
  order: { count: (args?: any) => Promise<number> };
};

export async function loadDashboardKpisFromDb(prisma: PrismaCounts) {
  const [
    productsDetected,
    productsPendingApproval,
    productsDraft,
    productsPublished,
    productsPaused,
    productsRejected,
    ordersPaid,
    ordersFulfilling,
    ordersFulfilled,
    ordersCancelled,
  ] = await Promise.all([
    prisma.product.count({ where: { status: 'DETECTED' } }),
    prisma.product.count({ where: { status: 'PENDING_APPROVAL' } }),
    prisma.product.count({ where: { status: 'DRAFT' } }),
    prisma.product.count({ where: { status: 'PUBLISHED' } }),
    prisma.product.count({ where: { status: 'PAUSED' } }),
    prisma.product.count({ where: { status: 'REJECTED' } }),
    prisma.order.count({ where: { status: 'PAID' } }),
    prisma.order.count({ where: { status: 'FULFILLING' } }),
    prisma.order.count({ where: { status: 'FULFILLED' } }),
    prisma.order.count({ where: { status: 'CANCELLED' } }),
  ]);

  const kill =
    String(process.env.ECOM_KILL_SWITCH || '').toLowerCase() === 'true' ||
    String(process.env.ECOM_PAUSE_ALL || '').toLowerCase() === 'true';

  const input: KpiInput = {
    mode: process.env.ECOM_MODE || 'MOCK',
    productsDetected,
    productsPendingApproval,
    productsDraft,
    productsPublished,
    productsPaused,
    productsRejected,
    ordersPaid,
    ordersFulfilling,
    ordersFulfilled,
    ordersCancelled,
    jobsFailed24h: 0,
    stockRisks: productsPaused,
    killSwitch: kill,
    revenueToday: null,
    costToday: null,
    currency: process.env.ECOM_CURRENCY || 'COP',
    shopifyConnected: Boolean(
      process.env.SHOPIFY_SHOP_DOMAIN && process.env.SHOPIFY_ACCESS_TOKEN,
    ),
    cjConnected: Boolean(process.env.CJ_API_KEY),
    telegramConnected: Boolean(
      process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID,
    ),
    publishesToday: 0,
    publishCap: Number(process.env.ECOM_MAX_PUBLISHES_PER_DAY || 20),
    fulfillsToday: 0,
    fulfillCap: Number(process.env.ECOM_MAX_FULFILLS_PER_DAY || 50),
  };

  return buildDashboardKpis(input);
}

export function loadIntegrationsHub() {
  return {
    snapshots: listIntegrationSnapshots(),
    note: 'Status from env flags; CONNECT UI cableado en panel pendiente',
  };
}

export function loadSixPhaseReport() {
  return runSixPhaseSelfCheck(process.env as any);
}

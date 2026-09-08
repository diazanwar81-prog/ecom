/**
 * FASE 3 — Panel de control (contratos de respuesta API)
 */
import { listIntegrationSnapshots, testIntegrationConfig, INTEGRATION_CATALOG } from '@ecom/integrations';
import { buildDashboardKpis, type KpiInput } from '@ecom/ops-p3';

export const PHASE3 = {
  id: 3,
  name: 'Panel de control',
  routes: [
    'GET  /integrations',
    'POST /integrations/:id/test',
    'GET  /dashboard/kpis',
    'GET  /ops/jobs/health',
  ],
} as const;

export function phase3ListIntegrations() {
  return {
    catalog: INTEGRATION_CATALOG,
    snapshots: listIntegrationSnapshots(),
  };
}

export function phase3TestIntegration(id: Parameters<typeof testIntegrationConfig>[0]) {
  return testIntegrationConfig(id);
}

export function phase3BuildKpis(input: KpiInput) {
  return buildDashboardKpis(input);
}

/** Shape mínimo para el panel web */
export function phase3PanelBootstrap(kpiInput: KpiInput) {
  return {
    integrations: phase3ListIntegrations(),
    kpis: phase3BuildKpis(kpiInput),
    generatedAt: new Date().toISOString(),
  };
}

/**
 * FASE F4 — Producción: readiness + backup hint + rollback
 */
import { phase6Readiness } from '@ecom/runtime';

export const FINAL_F4 = {
  id: 'F4',
  name: 'Producción',
  artifacts: ['docs/RUNBOOK.md', '.github/workflows/ci.yml', 'docs/FINAL_4_BLOCK.md'],
} as const;

export function productionBlock(env: Record<string, string | undefined> = process.env) {
  const readiness = phase6Readiness(env);
  return {
    at: new Date().toISOString(),
    readiness,
    backupHint:
      'pg_dump "$DATABASE_URL" > backup-$(date +%F).sql && gzip backup-$(date +%F).sql',
    rollback: [
      'ECOM_KILL_SWITCH=true',
      'ECOM_MODE=MOCK',
      'docker compose --profile app stop',
      'Revisar AuditLog + logs api',
    ],
    deployChecklist: [
      'CI verde en main',
      'migrate deploy',
      'API_URL HTTPS fijo',
      'webhook register',
      'ops/p0/verify score 100',
      'dashboard/kpis health != critical',
      'backup diario programado',
    ],
  };
}

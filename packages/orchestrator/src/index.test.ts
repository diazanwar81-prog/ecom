import { describe, expect, it } from 'vitest';
import { runProductPipeline, listAgents, getOrchestratorMeta } from './index';

describe('orchestrator', () => {
  it('lists agents from Prompt Maestro set', () => {
    const agents = listAgents();
    expect(agents.map((a) => a.id)).toContain('margin');
    expect(agents.map((a) => a.id)).toContain('publish_gate');
    expect(getOrchestratorMeta().block).toBe(8);
  });

  it('blocks low margin candidate', async () => {
    const r = await runProductPipeline({
      title: 'Producto caro',
      salePrice: 50000,
      productCost: 40000,
      shippingCost: 5000,
      stock: 10,
      opportunityScore: 70,
      confidence: 90,
      supplierVerified: true,
      supplierName: 'CJ',
      isFirstPublication: true,
      skipAiCopy: true,
    });
    expect(r.status).toBe('BLOCKED');
    expect(r.canPublish).toBe(false);
    expect(r.steps.some((s) => s.agent === 'margin')).toBe(true);
  });

  it('marks good first publication as NEEDS_APPROVAL', async () => {
    const r = await runProductPipeline({
      title: 'Organizador premium',
      salePrice: 89900,
      productCost: 32000,
      shippingCost: 12000,
      stock: 100,
      opportunityScore: 72,
      confidence: 88,
      supplierVerified: true,
      supplierName: 'CJ Mock',
      isFirstPublication: true,
      skipAiCopy: true,
    });
    expect(['NEEDS_APPROVAL', 'ELIGIBLE']).toContain(r.status);
    expect(r.marginPercent).toBeGreaterThanOrEqual(35);
    expect(r.needsHumanApproval).toBe(true);
  });

  it('blocks unverified supplier', async () => {
    const r = await runProductPipeline({
      title: 'Sin proveedor',
      salePrice: 100000,
      productCost: 30000,
      shippingCost: 10000,
      stock: 50,
      opportunityScore: 80,
      confidence: 96,
      supplierVerified: false,
      isFirstPublication: false,
      skipAiCopy: true,
    });
    expect(r.status).toBe('BLOCKED');
    expect(r.blockedReasons.join(' ')).toMatch(/supplier/i);
  });
});

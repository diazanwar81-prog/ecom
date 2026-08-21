#!/usr/bin/env python3
"""Apply block-11 BullMQ jobs wiring to apps/api/src/main.ts (idempotent)."""
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
MAIN = ROOT / "apps/api/src/main.ts"

def main():
    if not MAIN.exists():
        print("ERROR: missing", MAIN)
        sys.exit(1)
    t = MAIN.read_text()
    if "class JobsController" in t and "block: 11" in t:
        print("Already patched (JobsController + block 11). Nothing to do.")
        return
    if "class DiscoveryController" not in t:
        print("ERROR: DiscoveryController not found — restore main.ts first")
        sys.exit(1)

    old_imp = "import { prisma, ProductStatus, ApprovalStatus, RuntimeMode } from '../../../packages/database/src/index';"
    if "packages/queue/src/index" not in t:
        if old_imp not in t:
            print("ERROR: database import anchor missing")
            sys.exit(1)
        t = t.replace(
            old_imp,
            old_imp
            + "\nimport {\n  enqueueDiscovery,\n  enqueuePipeline,\n  listRecentJobs,\n  getQueueStatus,\n  startWorkers,\n} from '../../../packages/queue/src/index';",
            1,
        )

    t = t.replace(
        """      block: 10,
      aiRouter: true,
      orchestrator: true,
      agentRuns: true,
      discovery: true,""",
        """      block: 11,
      aiRouter: true,
      orchestrator: true,
      agentRuns: true,
      discovery: true,
      queue: true,""",
        1,
    )

    if "class JobsController" not in t:
        jobs = '''
@Controller('jobs')
class JobsController {
  @Get()
  async list(@Query('limit') limit = '20') {
    try {
      const recent = await listRecentJobs(Number(limit) || 20);
      return { mode: MODE, ...getQueueStatus(), ...recent };
    } catch (e: any) {
      return { mode: MODE, error: e?.message || 'queue_unavailable', items: [] };
    }
  }

  @Get('status')
  status() {
    return { mode: MODE, ...getQueueStatus() };
  }

  @Post('discovery')
  async discovery(
    @Body()
    body: {
      limit?: number;
      runPipeline?: boolean;
      onlyPassingFilters?: boolean;
      includeWeak?: boolean;
      sync?: boolean;
    },
  ) {
    if (body.sync) {
      const store = await prisma.store.findFirst();
      if (!store) return { error: 'no_store' };
      const found = await discoverCandidates({
        limit: body.limit ?? 5,
        includeWeak: Boolean(body.includeWeak),
      });
      const onlyPass = body.onlyPassingFilters !== false;
      const runPipeline = Boolean(body.runPipeline);
      const created: any[] = [];
      for (const c of found.items) {
        const filters = candidatePassesHardFilters(c);
        if (onlyPass && !filters.ok) continue;
        const r = await ingestCandidate(store.id, c, runPipeline);
        if (!r.skipped) created.push({ title: c.title, productId: r.productId });
      }
      await writeAudit('JOB_DISCOVERY_SYNC', 'Queue', store.id, { created: created.length });
      return { mode: MODE, sync: true, created: created.length, items: created };
    }
    try {
      const job = await enqueueDiscovery({
        limit: body.limit ?? 5,
        runPipeline: Boolean(body.runPipeline),
        onlyPassingFilters: body.onlyPassingFilters !== false,
        includeWeak: Boolean(body.includeWeak),
      });
      await writeAudit('JOB_ENQUEUED', 'Queue', String(job.jobId), job);
      return { mode: MODE, ...job };
    } catch (e: any) {
      return { mode: MODE, error: e?.message || 'enqueue_failed' };
    }
  }

  @Post('pipeline')
  async pipelineJob(@Body() body: { productId?: string; skipAiCopy?: boolean }) {
    if (!body.productId) return { error: 'productId_required' };
    try {
      const job = await enqueuePipeline({
        productId: body.productId,
        skipAiCopy: body.skipAiCopy !== false,
      });
      await writeAudit('JOB_ENQUEUED', 'Queue', String(job.jobId), job);
      return { mode: MODE, ...job };
    } catch (e: any) {
      return { mode: MODE, error: e?.message || 'enqueue_failed' };
    }
  }
}

'''
        anchor = "@Controller('agents')\nclass AgentsController {"
        if anchor not in t:
            print("ERROR: AgentsController anchor missing")
            sys.exit(1)
        t = t.replace(anchor, jobs + anchor, 1)

    t = t.replace(
        "HealthController,\n    DiscoveryController,\n    AgentsController,",
        "HealthController,\n    DiscoveryController,\n    JobsController,\n    AgentsController,",
        1,
    )

    old_boot = """async function bootstrap() {
  await ensureSeed();
  const app = await NestFactory.create(AppModule);
  app.enableCors({ origin: process.env.APP_URL ?? 'http://localhost:3000' });
  await app.listen(Number(process.env.API_PORT ?? 4000));
  console.log(`ECOM API block-10 (discovery) on ${process.env.API_PORT ?? 4000} mode=${MODE}`);
}"""
    new_boot = """async function bootstrap() {
  await ensureSeed();
  try {
    await startWorkers({
      onDiscovery: async (data) => {
        const store = await prisma.store.findFirst();
        if (!store) return { error: 'no_store' };
        const found = await discoverCandidates({
          limit: data.limit ?? 5,
          includeWeak: Boolean(data.includeWeak),
        });
        const onlyPass = data.onlyPassingFilters !== false;
        const created: any[] = [];
        for (const c of found.items) {
          const filters = candidatePassesHardFilters(c);
          if (onlyPass && !filters.ok) continue;
          const r = await ingestCandidate(store.id, c, Boolean(data.runPipeline));
          if (!r.skipped) created.push(r.productId);
        }
        await writeAudit('JOB_DISCOVERY_DONE', 'Queue', store.id, { created: created.length });
        return { created: created.length, ids: created };
      },
      onPipeline: async (data) => {
        const p = await prisma.product.findUnique({
          where: { id: data.productId },
          include: { suppliers: { include: { supplier: true }, orderBy: { isPrimary: 'desc' } } },
        });
        if (!p) return { error: 'not_found' };
        const enriched = enrichProduct(p);
        const result = await runProductPipeline({
          title: enriched.title,
          salePrice: enriched.salePrice,
          productCost: enriched.productCost,
          shippingCost: enriched.shippingCost,
          stock: enriched.stock,
          opportunityScore: enriched.opportunityScore ?? 0,
          confidence: enriched.confidence ?? 0,
          supplierName: enriched.supplierName,
          supplierVerified: enriched.verified,
          isFirstPublication: enriched.isFirstPublication,
          currency: enriched.currency,
          skipAiCopy: data.skipAiCopy !== false,
        });
        await saveAgentRun(result, { productId: p.id, storeId: p.storeId });
        return { status: result.status, traceId: result.traceId };
      },
    });
  } catch (e: any) {
    console.warn('[queue] workers not started:', e?.message);
  }
  const app = await NestFactory.create(AppModule);
  app.enableCors({ origin: process.env.APP_URL ?? 'http://localhost:3000' });
  await app.listen(Number(process.env.API_PORT ?? 4000));
  console.log(`ECOM API block-11 (queue) on ${process.env.API_PORT ?? 4000} mode=${MODE}`);
}"""
    if old_boot in t:
        t = t.replace(old_boot, new_boot, 1)
    elif "block-11 (queue)" not in t:
        print("WARNING: bootstrap block-10 string not found; check bootstrap manually")

    MAIN.write_text(t)
    print("Patched", MAIN)
    print("  JobsController:", "class JobsController" in t)
    print("  block 11:", "block: 11" in t)
    print("  lines:", t.count("\n") + 1)

if __name__ == "__main__":
    main()

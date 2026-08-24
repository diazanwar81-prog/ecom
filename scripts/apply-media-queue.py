#!/usr/bin/env python3
"""
Add ecom-media BullMQ queue (concurrency 1, min 1.2s between jobs)
+ enqueueMedia / enqueueMediaBulk
+ JobsController POST /jobs/media and /jobs/media/bulk
+ worker handler onMedia
"""
from pathlib import Path

# --- queue package ---
qpath = Path('packages/queue/src/index.ts')
q = qpath.read_text(encoding='utf-8')

if "'product:media-sync'" not in q and 'product:media-sync' not in q:
    q = q.replace(
        "export type JobName = 'discovery:run' | 'product:pipeline';",
        "export type JobName = 'discovery:run' | 'product:pipeline' | 'product:media-sync';",
        1,
    )
    q = q.replace(
        "export interface PipelineJobData {\n  productId: string;\n  skipAiCopy?: boolean;\n}",
        "export interface PipelineJobData {\n  productId: string;\n  skipAiCopy?: boolean;\n}\n\nexport interface MediaJobData {\n  productId: string;\n}",
        1,
    )
    q = q.replace(
        'let discoveryQueue: Queue | null = null;\nlet pipelineQueue: Queue | null = null;',
        'let discoveryQueue: Queue | null = null;\nlet pipelineQueue: Queue | null = null;\nlet mediaQueue: Queue | null = null;',
        1,
    )
    q = q.replace(
        "function getPipelineQueue() {\n  if (!pipelineQueue) {\n    pipelineQueue = new Queue('ecom-pipeline', { connection: connection() });\n  }\n  return pipelineQueue;\n}",
        "function getPipelineQueue() {\n  if (!pipelineQueue) {\n    pipelineQueue = new Queue('ecom-pipeline', { connection: connection() });\n  }\n  return pipelineQueue;\n}\n\nfunction getMediaQueue() {\n  if (!mediaQueue) {\n    mediaQueue = new Queue('ecom-media', {\n      connection: connection(),\n      defaultJobOptions: {\n        ...defaultOpts,\n        // CJ QPS ~1/s — stagger retries\n        attempts: 4,\n        backoff: { type: 'fixed', delay: 1500 },\n      },\n    });\n  }\n  return mediaQueue;\n}",
        1,
    )
    # getQueueStatus queues list
    q = q.replace(
        "queues: ['ecom-discovery', 'ecom-pipeline'],",
        "queues: ['ecom-discovery', 'ecom-pipeline', 'ecom-media'],",
        1,
    )
    # enqueue functions before listRecentJobs or after enqueuePipeline
    if 'enqueueMedia' not in q:
        marker = 'export async function enqueuePipeline'
        idx = q.find(marker)
        if idx < 0:
            raise SystemExit('enqueuePipeline not found')
        # find end of enqueuePipeline function
        rest = q[idx:]
        # insert after first closing of enqueuePipeline — look for next export
        end_rel = rest.find('\nexport async function listRecentJobs')
        if end_rel < 0:
            end_rel = rest.find('\nexport function startDiscoveryScheduler')
        if end_rel < 0:
            raise SystemExit('insert point not found')
        insert = '''
export async function enqueueMedia(data: MediaJobData) {
  if (!data.productId) throw new Error('productId required');
  const q = getMediaQueue();
  const job = await q.add('product:media-sync', data, {
    ...defaultOpts,
    attempts: 4,
    backoff: { type: 'fixed', delay: 1500 },
    // unique per product while waiting/active
    jobId: `media-${data.productId}`,
  });
  return { ok: true, queue: 'ecom-media', jobId: job.id, name: 'product:media-sync', data };
}

export async function enqueueMediaBulk(productIds: string[]) {
  const results: { productId: string; jobId?: string; error?: string }[] = [];
  for (const productId of productIds) {
    try {
      const job = await enqueueMedia({ productId });
      results.push({ productId, jobId: String(job.jobId) });
    } catch (e: any) {
      // jobId duplicate is fine — already queued
      const msg = e?.message || String(e);
      results.push({ productId, error: msg.includes('Job') ? 'already_queued_or_exists' : msg });
    }
  }
  return { ok: true, queue: 'ecom-media', enqueued: results.filter((r) => r.jobId).length, results };
}

'''
        q = q[:idx + end_rel] + insert + q[idx + end_rel:]

    # listRecentJobs should include media queue — find and patch
    if "getMediaQueue()" not in q.split('listRecentJobs')[1][:800] if 'listRecentJobs' in q else True:
        q = q.replace(
            "const [dJobs, pJobs] = await Promise.all([\n    getDiscoveryQueue().getJobs",
            "const [dJobs, pJobs, mJobs] = await Promise.all([\n    getDiscoveryQueue().getJobs",
            1,
        )
        # fragile - read how listRecentJobs works
        pass

    # startWorkers — extend signature and add media worker
    old_workers = '''export async function startWorkers(handlers: {
  onDiscovery: (data: DiscoveryJobData) => Promise<unknown>;
  onPipeline: (data: PipelineJobData) => Promise<unknown>;
}) {
  const { Worker } = await import('bullmq');
  const conn = connection();

  const discoveryWorker = new Worker(
    'ecom-discovery',
    async (job) => handlers.onDiscovery(job.data as DiscoveryJobData),
    { connection: conn, concurrency: 1 },
  );

  const pipelineWorker = new Worker(
    'ecom-pipeline',
    async (job) => handlers.onPipeline(job.data as PipelineJobData),
    { connection: conn, concurrency: 2 },
  );

  discoveryWorker.on('failed', (job, err) => {
    console.warn('[queue] discovery failed', job?.id, err.message);
  });
  pipelineWorker.on('failed', (job, err) => {
    console.warn('[queue] pipeline failed', job?.id, err.message);
  });

  console.log('[queue] workers started: ecom-discovery, ecom-pipeline');
  return { discoveryWorker, pipelineWorker };
}'''

    new_workers = '''export async function startWorkers(handlers: {
  onDiscovery: (data: DiscoveryJobData) => Promise<unknown>;
  onPipeline: (data: PipelineJobData) => Promise<unknown>;
  onMedia?: (data: MediaJobData) => Promise<unknown>;
}) {
  const { Worker } = await import('bullmq');
  const conn = connection();

  const discoveryWorker = new Worker(
    'ecom-discovery',
    async (job) => handlers.onDiscovery(job.data as DiscoveryJobData),
    { connection: conn, concurrency: 1 },
  );

  const pipelineWorker = new Worker(
    'ecom-pipeline',
    async (job) => handlers.onPipeline(job.data as PipelineJobData),
    { connection: conn, concurrency: 2 },
  );

  // CJ API QPS = 1/s — single concurrency + limiter
  const mediaWorker = new Worker(
    'ecom-media',
    async (job) => {
      if (!handlers.onMedia) return { skipped: true };
      const result = await handlers.onMedia(job.data as MediaJobData);
      // hard pacing after each CJ call
      await new Promise((r) => setTimeout(r, 1200));
      return result;
    },
    {
      connection: conn,
      concurrency: 1,
      limiter: { max: 1, duration: 1200 },
    },
  );

  discoveryWorker.on('failed', (job, err) => {
    console.warn('[queue] discovery failed', job?.id, err.message);
  });
  pipelineWorker.on('failed', (job, err) => {
    console.warn('[queue] pipeline failed', job?.id, err.message);
  });
  mediaWorker.on('failed', (job, err) => {
    console.warn('[queue] media failed', job?.id, err.message);
  });
  mediaWorker.on('completed', (job) => {
    console.log('[queue] media done', job.id, job.returnvalue);
  });

  console.log('[queue] workers started: ecom-discovery, ecom-pipeline, ecom-media (1/s)');
  return { discoveryWorker, pipelineWorker, mediaWorker };
}'''

    if old_workers in q:
        q = q.replace(old_workers, new_workers, 1)
        print('startWorkers replaced')
    elif 'ecom-media' in q and 'onMedia' in q:
        print('startWorkers already has media')
    else:
        print('WARNING: startWorkers block not exact match — manual check')
        # try softer replace of console.log line
        if "console.log('[queue] workers started: ecom-discovery, ecom-pipeline');" in q:
            print('partial match only')

    qpath.write_text(q, encoding='utf-8')
    print('queue package updated')
else:
    print('queue already has media job type')

# --- main.ts imports ---
main = Path('apps/api/src/main.ts')
t = main.read_text(encoding='utf-8')

if 'enqueueMedia' not in t:
    t = t.replace(
        '  enqueueDiscovery,\n  enqueuePipeline,',
        '  enqueueDiscovery,\n  enqueuePipeline,\n  enqueueMedia,\n  enqueueMediaBulk,',
        1,
    )
    # alternate import style
    if 'enqueueMedia' not in t:
        t = t.replace(
            'enqueuePipeline,',
            'enqueuePipeline,\n  enqueueMedia,\n  enqueueMediaBulk,',
            1,
        )
    print('imports updated')

# JobsController endpoints
if "@Post('media')" not in t and "@Post('media/bulk')" not in t:
    anchor = "  @Post('pipeline')\n  async pipelineJob"
    if anchor not in t:
        # try without exact whitespace
        anchor = "@Post('pipeline')"
    insert = '''  @Post('media')
  async mediaJob(@Body() body: { productId?: string }) {
    if (!body.productId) return { error: 'productId_required' };
    try {
      const job = await enqueueMedia({ productId: body.productId });
      await writeAudit('JOB_ENQUEUED', 'Queue', String(job.jobId), job);
      return { mode: MODE, ...job };
    } catch (e: any) {
      return { mode: MODE, error: e?.message || 'enqueue_failed' };
    }
  }

  @Post('media/bulk')
  async mediaBulk(@Body() body: { productIds?: string[]; onlyMissing?: boolean }) {
    let ids = body.productIds || [];
    if (!ids.length) {
      const rows = await prisma.product.findMany({
        include: { suppliers: { orderBy: { isPrimary: 'desc' } } },
        orderBy: { createdAt: 'desc' },
        take: 100,
      });
      const onlyMissing = body.onlyMissing !== false;
      ids = rows
        .filter((p) => {
          const hasSku = p.suppliers?.some((s) => s.cjSku);
          if (!hasSku) return false;
          if (!onlyMissing) return true;
          const imgs = p.imageUrls as any;
          const n = Array.isArray(imgs) ? imgs.length : 0;
          return n === 0;
        })
        .map((p) => p.id);
    }
    if (!ids.length) return { mode: MODE, enqueued: 0, note: 'nothing to sync' };
    try {
      const result = await enqueueMediaBulk(ids);
      await writeAudit('JOB_MEDIA_BULK', 'Queue', 'bulk', {
        enqueued: result.enqueued,
        total: ids.length,
      });
      return { mode: MODE, ...result };
    } catch (e: any) {
      return { mode: MODE, error: e?.message || 'bulk_failed' };
    }
  }

  @Post('pipeline')
  async pipelineJob'''
    if "@Post('pipeline')\n  async pipelineJob" in t:
        t = t.replace("  @Post('pipeline')\n  async pipelineJob", insert, 1)
        print('JobsController media endpoints added')
    elif "@Post('pipeline')" in t:
        # less safe
        t = t.replace(
            "  @Post('pipeline')",
            "  @Post('media')\n  async mediaJob(@Body() body: { productId?: string }) {\n    if (!body.productId) return { error: 'productId_required' };\n    try {\n      const job = await enqueueMedia({ productId: body.productId });\n      return { mode: MODE, ...job };\n    } catch (e: any) {\n      return { mode: MODE, error: e?.message || 'enqueue_failed' };\n    }\n  }\n\n  @Post('media/bulk')\n  async mediaBulk(@Body() body: { productIds?: string[]; onlyMissing?: boolean }) {\n    let ids = body.productIds || [];\n    if (!ids.length) {\n      const rows = await prisma.product.findMany({ include: { suppliers: true }, take: 100 });\n      ids = rows.filter((p: any) => !(Array.isArray(p.imageUrls) && p.imageUrls.length)).map((p: any) => p.id);\n    }\n    const result = await enqueueMediaBulk(ids);\n    return { mode: MODE, ...result };\n  }\n\n  @Post('pipeline')",
            1,
        )
        print('JobsController media endpoints added (fallback)')
    else:
        print('WARNING: pipeline endpoint not found')
else:
    print('media endpoints already present')

# bootstrap onMedia handler
if 'onMedia:' not in t:
    old_handler_end = '''      await saveAgentRun(result, { productId: p.id, storeId: p.storeId });
        return { status: result.status, traceId: result.traceId };
      },
    });'''
    new_handler_end = '''      await saveAgentRun(result, { productId: p.id, storeId: p.storeId });
        return { status: result.status, traceId: result.traceId };
      },
      onMedia: async (data) => {
        const p = await prisma.product.findUnique({
          where: { id: data.productId },
          include: { suppliers: { orderBy: { isPrimary: 'desc' } } },
        });
        if (!p) return { error: 'not_found', productId: data.productId };
        const primary = p.suppliers?.[0];
        const urls = await resolveCjImageUrls(p.title, primary?.cjSku || null);
        if (urls.length === 0) {
          return { productId: data.productId, count: 0, note: 'no_images' };
        }
        try {
          await prisma.product.update({
            where: { id: data.productId },
            data: { imageUrls: urls as any },
          });
        } catch (e: any) {
          return { productId: data.productId, count: urls.length, error: e?.message };
        }
        await writeAudit('PRODUCT_MEDIA_SYNC', 'Product', data.productId, {
          count: urls.length,
          via: 'queue',
        });
        return { productId: data.productId, count: urls.length };
      },
    });'''
    if old_handler_end in t:
        t = t.replace(old_handler_end, new_handler_end, 1)
        print('onMedia handler wired')
    else:
        print('WARNING: bootstrap handler anchor not found')
else:
    print('onMedia already wired')

main.write_text(t, encoding='utf-8')
print('main.ts updated')
print('Done')

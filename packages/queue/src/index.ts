/**
 * ECOM Job Queue (BullMQ + Redis)
 * block 11: jobs discovery/pipeline
 * block 13: periodic discovery scheduler
 */

import { Queue, type JobsOptions } from 'bullmq';

export type JobName = 'discovery:run' | 'product:pipeline';

export interface DiscoveryJobData {
  limit?: number;
  runPipeline?: boolean;
  onlyPassingFilters?: boolean;
  includeWeak?: boolean;
}

export interface PipelineJobData {
  productId: string;
  skipAiCopy?: boolean;
}

function redisUrl() {
  return (process.env.REDIS_URL || 'redis://127.0.0.1:6379').trim();
}

function connection() {
  return { url: redisUrl() } as any;
}

let discoveryQueue: Queue | null = null;
let pipelineQueue: Queue | null = null;

function getDiscoveryQueue() {
  if (!discoveryQueue) {
    discoveryQueue = new Queue('ecom-discovery', { connection: connection() });
  }
  return discoveryQueue;
}

function getPipelineQueue() {
  if (!pipelineQueue) {
    pipelineQueue = new Queue('ecom-pipeline', { connection: connection() });
  }
  return pipelineQueue;
}

const defaultOpts: JobsOptions = {
  attempts: 3,
  backoff: { type: 'exponential', delay: 2000 },
  removeOnComplete: { count: 100 },
  removeOnFail: { count: 50 },
};

function envInt(name: string, fallback: number) {
  const n = Number(process.env[name]);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

export function getQueueStatus() {
  const intervalMin = envInt('ECOM_DISCOVERY_INTERVAL_MINUTES', 0);
  return {
    block: 13,
    redisUrl: redisUrl().replace(/:\/\/.*@/, '://***@'),
    queues: ['ecom-discovery', 'ecom-pipeline'],
    scheduler: {
      enabled: intervalMin > 0,
      intervalMinutes: intervalMin,
      limit: envInt('ECOM_DISCOVERY_LIMIT', 3),
      maxPerDay: envInt('ECOM_DISCOVERY_MAX_PER_DAY', 48),
    },
    note:
      intervalMin > 0
        ? `Scheduler activo cada ${intervalMin} min`
        : 'Scheduler off (ECOM_DISCOVERY_INTERVAL_MINUTES=0). Jobs manuales OK.',
  };
}

export async function enqueueDiscovery(data: DiscoveryJobData = {}) {
  const q = getDiscoveryQueue();
  const job = await q.add('discovery:run', data, defaultOpts);
  return { ok: true, queue: 'ecom-discovery', jobId: job.id, name: 'discovery:run', data };
}

export async function enqueuePipeline(data: PipelineJobData) {
  if (!data.productId) throw new Error('productId required');
  const q = getPipelineQueue();
  const job = await q.add('product:pipeline', data, defaultOpts);
  return { ok: true, queue: 'ecom-pipeline', jobId: job.id, name: 'product:pipeline', data };
}

export async function listRecentJobs(limit = 20) {
  const dq = getDiscoveryQueue();
  const pq = getPipelineQueue();
  const [dc, df, pc, pf] = await Promise.all([
    dq.getJobs(['completed'], 0, limit),
    dq.getJobs(['failed'], 0, 5),
    pq.getJobs(['completed'], 0, limit),
    pq.getJobs(['failed'], 0, 5),
  ]);
  const map = (j: any) => ({
    id: j.id,
    name: j.name,
    queue: j.queueName,
    state: j.finishedOn ? (j.failedReason ? 'failed' : 'completed') : 'unknown',
    failedReason: j.failedReason,
    timestamp: j.finishedOn || j.timestamp,
    data: j.data,
    returnvalue: j.returnvalue,
  });
  return {
    items: [...dc, ...df, ...pc, ...pf]
      .map(map)
      .sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0))
      .slice(0, limit),
  };
}

/** Count discovery jobs finished today (UTC day). */
async function discoveryJobsToday(): Promise<number> {
  const q = getDiscoveryQueue();
  const start = new Date();
  start.setUTCHours(0, 0, 0, 0);
  const jobs = await q.getJobs(['completed', 'failed', 'active', 'waiting'], 0, 200);
  return jobs.filter((j) => (j.timestamp || 0) >= start.getTime()).length;
}

/**
 * Periodic discovery: only if interval > 0, no pending jobs, under daily cap.
 */
export function startDiscoveryScheduler() {
  const intervalMin = envInt('ECOM_DISCOVERY_INTERVAL_MINUTES', 0);
  if (intervalMin <= 0) {
    console.log('[queue] discovery scheduler OFF (set ECOM_DISCOVERY_INTERVAL_MINUTES>0)');
    return { enabled: false };
  }

  const limit = envInt('ECOM_DISCOVERY_LIMIT', 3);
  const maxPerDay = envInt('ECOM_DISCOVERY_MAX_PER_DAY', 48);
  const ms = intervalMin * 60 * 1000;

  const tick = async () => {
    try {
      const q = getDiscoveryQueue();
      const waiting = await q.getWaitingCount();
      const active = await q.getActiveCount();
      if (waiting + active > 0) {
        console.log('[queue] scheduler skip — jobs pending');
        return;
      }
      const today = await discoveryJobsToday();
      if (today >= maxPerDay) {
        console.log(`[queue] scheduler skip — daily cap ${maxPerDay}`);
        return;
      }
      const job = await enqueueDiscovery({
        limit,
        runPipeline: true,
        onlyPassingFilters: true,
        includeWeak: false,
      });
      console.log('[queue] scheduler enqueued discovery', job.jobId);
    } catch (e: any) {
      console.warn('[queue] scheduler error', e?.message);
    }
  };

  // first run after 1 min, then interval
  setTimeout(() => {
    void tick();
    setInterval(() => void tick(), ms);
  }, 60_000);

  console.log(`[queue] discovery scheduler ON every ${intervalMin} min (cap ${maxPerDay}/day)`);
  return { enabled: true, intervalMin, maxPerDay, limit };
}

export async function startWorkers(handlers: {
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
}

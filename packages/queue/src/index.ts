/**
 * ECOM Job Queue (BullMQ + Redis) — block 11
 * Jobs: discovery:run, product:pipeline
 * Safe defaults: if Redis down, enqueue returns error (no silent fake success)
 */

import { Queue, QueueEvents, type JobsOptions } from 'bullmq';

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
  const url = redisUrl();
  // BullMQ expects connection object or URL via ioredis
  return { url } as any;
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

export function getQueueStatus() {
  return {
    block: 11,
    redisUrl: redisUrl().replace(/:\/\/.*@/, '://***@'),
    queues: ['ecom-discovery', 'ecom-pipeline'],
    note: 'Jobs en cola; el worker corre embebido en la API al arrancar.',
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
    items: [...dc, ...df, ...pc, ...pf].map(map).sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0)).slice(0, limit),
  };
}

/**
 * Start workers — pass handlers from API so jobs can call prisma/orchestrator.
 */
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

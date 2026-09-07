/**
 * ECOM Jobs — BullMQ discovery/pipeline + stable 24/7 catalog
 */
import { Queue, Worker, type Job } from 'bullmq';
import IORedis from 'ioredis';

export * from './stable-jobs';

export type DiscoveryJobData = {
  triggeredBy: 'scheduler' | 'manual' | 'api';
  correlationId?: string;
};

export type PipelineJobData = {
  productId: string;
  stage?: string;
  correlationId?: string;
};

let connectionSingleton: IORedis | null = null;
let discoveryQueue: Queue | null = null;
let pipelineQueue: Queue | null = null;
let workersStarted = false;

function connection() {
  if (!connectionSingleton) {
    const url = process.env.REDIS_URL || 'redis://127.0.0.1:6379';
    connectionSingleton = new IORedis(url, { maxRetriesPerRequest: null });
  }
  return connectionSingleton;
}

export function getDiscoveryQueue() {
  if (!discoveryQueue) {
    discoveryQueue = new Queue('ecom-discovery', { connection: connection() });
  }
  return discoveryQueue;
}

export function getPipelineQueue() {
  if (!pipelineQueue) {
    pipelineQueue = new Queue('ecom-pipeline', { connection: connection() });
  }
  return pipelineQueue;
}

export async function enqueueDiscovery(data: DiscoveryJobData) {
  const q = getDiscoveryQueue();
  const job = await q.add('discovery-run', data, {
    removeOnComplete: 50,
    removeOnFail: 20,
    attempts: 2,
    backoff: { type: 'exponential', delay: 2000 },
  });
  return { jobId: job.id, queue: 'ecom-discovery', data };
}

export async function enqueuePipeline(data: PipelineJobData) {
  const q = getPipelineQueue();
  const job = await q.add('product-pipeline', data, {
    removeOnComplete: 50,
    removeOnFail: 20,
    attempts: 2,
    backoff: { type: 'exponential', delay: 2000 },
  });
  return { jobId: job.id, queue: 'ecom-pipeline', data };
}

export async function getJobState(queueName: string, jobId: string) {
  const q = queueName.includes('pipeline') ? getPipelineQueue() : getDiscoveryQueue();
  const job = await q.getJob(jobId);
  if (!job) return { error: 'not_found' };
  const state = await job.getState();
  return {
    id: job.id,
    name: job.name,
    state,
    progress: job.progress,
    data: job.data,
    returnvalue: job.returnvalue,
    failedReason: job.failedReason,
    timestamp: job.timestamp,
    finishedOn: job.finishedOn,
  };
}

export type JobHandlers = {
  onDiscovery: (data: DiscoveryJobData, job: Job) => Promise<unknown>;
  onPipeline: (data: PipelineJobData, job: Job) => Promise<unknown>;
};

export function startWorkers(handlers: JobHandlers) {
  if (workersStarted) return { ok: true, already: true };
  try {
    const conn = connection();
    new Worker(
      'ecom-discovery',
      async (job) => handlers.onDiscovery(job.data as DiscoveryJobData, job),
      { connection: conn, concurrency: 1 },
    );
    new Worker(
      'ecom-pipeline',
      async (job) => handlers.onPipeline(job.data as PipelineJobData, job),
      { connection: conn, concurrency: 2 },
    );
    workersStarted = true;
    console.log('ECOM BullMQ workers started');
    return { ok: true, already: false };
  } catch (e: any) {
    console.warn('BullMQ workers failed to start', e?.message);
    return { ok: false, error: e?.message };
  }
}

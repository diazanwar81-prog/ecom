/**
 * ECOM Jobs — BullMQ over Redis
 * Queues: discovery, pipeline
 * Falls back to inline execution if Redis unavailable
 */

import { Queue, Worker, type Job, type ConnectionOptions } from 'bullmq';

export type DiscoveryJobData = {
  limit?: number;
  runPipeline?: boolean;
  onlyPassingFilters?: boolean;
  includeWeak?: boolean;
};

export type PipelineJobData = {
  productId: string;
  skipAiCopy?: boolean;
};

function redisUrl() {
  return (process.env.REDIS_URL || 'redis://127.0.0.1:6379').trim();
}

function connection(): ConnectionOptions {
  const url = new URL(redisUrl());
  return {
    host: url.hostname,
    port: Number(url.port || 6379),
    maxRetriesPerRequest: null,
  };
}

let discoveryQueue: Queue | null = null;
let pipelineQueue: Queue | null = null;
let workersStarted = false;

export function getJobsStatus() {
  return {
    block: 11,
    redisUrl: redisUrl().replace(/:\/\/.*@/, '://***@'),
    queues: ['ecom-discovery', 'ecom-pipeline'],
    workersStarted,
    note: 'Jobs en Redis. Si Redis cae, la API puede ejecutar inline.',
  };
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

/** Start workers once (call from API bootstrap) */
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

import crypto from 'crypto';
import { db } from './db';
import { logger } from './logger';

export interface QueueJob {
  id: string;
  type: string;
  status: 'queued' | 'running' | 'completed' | 'failed';
  priority: number;
  attempts: number;
  maxAttempts: number;
  payload: string;
  createdAt: number;
  updatedAt: number;
  error?: string;
}

const STALE_JOB_TIMEOUT = 5 * 60 * 1000;

export class PersistentQueue {
  async enqueue(type: string, payload: unknown, priority: number = 5, maxAttempts: number = 3): Promise<string> {
    const id = `job-${crypto.randomUUID()}`;
    await db.review.create({
      data: {
        id,
        repositoryId: 'queue',
        platform: 'queue',
        prNumber: 0,
        prTitle: type,
        prAuthor: 'system',
        prUrl: '',
        status: 'queued',
        summary: JSON.stringify({
          type,
          priority,
          maxAttempts,
          attempts: 0,
          payload: typeof payload === 'string' ? payload : JSON.stringify(payload),
          createdAt: Date.now(),
        }),
      },
    });
    logger.info('Job enqueued', { id, type, priority });
    return id;
  }

  async dequeue(): Promise<QueueJob | null> {
    const jobs = await db.review.findMany({
      where: { repositoryId: 'queue', status: 'queued' },
      orderBy: { createdAt: 'asc' },
      take: 10,
    });

    if (jobs.length === 0) return null;

    const parsedJobs: QueueJob[] = [];
    for (const job of jobs) {
      try {
        const data = JSON.parse(job.summary || '{}');
        parsedJobs.push({
          id: job.id,
          type: data.type || job.prTitle,
          status: 'queued',
          priority: data.priority || 5,
          attempts: data.attempts || 0,
          maxAttempts: data.maxAttempts || 3,
          payload: data.payload || '',
          createdAt: new Date(job.createdAt).getTime(),
          updatedAt: new Date(job.updatedAt).getTime(),
        });
      } catch {
        continue;
      }
    }

    parsedJobs.sort((a, b) => a.priority - b.priority || a.createdAt - b.createdAt);

    const selected = parsedJobs[0];
    await db.review.update({
      where: { id: selected.id },
      data: { status: 'running' },
    });
    selected.status = 'running';
    return selected;
  }

  async markCompleted(id: string): Promise<void> {
    const job = await db.review.findUnique({ where: { id } });
    if (!job) return;
    const data = JSON.parse(job.summary || '{}');
    data.attempts = (data.attempts || 0) + 1;
    data.completedAt = Date.now();
    await db.review.update({
      where: { id },
      data: { status: 'completed', summary: JSON.stringify(data) },
    });
  }

  async markFailed(id: string, error?: string): Promise<void> {
    const job = await db.review.findUnique({ where: { id } });
    if (!job) return;
    const data = JSON.parse(job.summary || '{}');
    data.attempts = (data.attempts || 0) + 1;
    data.error = error;
    data.lastFailedAt = Date.now();
    const attempts = data.attempts || 0;
    const maxAttempts = data.maxAttempts || 3;

    if (attempts >= maxAttempts) {
      await db.review.update({
        where: { id },
        data: { status: 'failed', summary: JSON.stringify(data) },
      });
    } else {
      await db.review.update({
        where: { id },
        data: { status: 'queued', summary: JSON.stringify(data) },
      });
    }
  }

  async getStats(): Promise<Record<string, number>> {
    const all = await db.review.findMany({
      where: { repositoryId: 'queue' },
      select: { status: true },
    });
    return {
      queued: all.filter(j => j.status === 'queued').length,
      running: all.filter(j => j.status === 'running').length,
      completed: all.filter(j => j.status === 'completed').length,
      failed: all.filter(j => j.status === 'failed').length,
      total: all.length,
    };
  }

  async recoverStaleJobs(): Promise<number> {
    const cutoff = new Date(Date.now() - STALE_JOB_TIMEOUT);
    const staleJobs = await db.review.findMany({
      where: {
        repositoryId: 'queue',
        status: 'running',
        updatedAt: { lt: cutoff },
      },
    });
    for (const job of staleJobs) {
      const data = JSON.parse(job.summary || '{}');
      data.attempts = (data.attempts || 0) + 1;
      data.recoveredAt = Date.now();
      const attempts = data.attempts || 0;
      const maxAttempts = data.maxAttempts || 3;
      const newStatus = attempts >= maxAttempts ? 'failed' : 'queued';
      await db.review.update({
        where: { id: job.id },
        data: { status: newStatus, summary: JSON.stringify(data) },
      });
    }
    return staleJobs.length;
  }

  async getJob(id: string): Promise<QueueJob | null> {
    const job = await db.review.findUnique({ where: { id } });
    if (!job) return null;
    try {
      const data = JSON.parse(job.summary || '{}');
      return {
        id: job.id,
        type: data.type || job.prTitle,
        status: job.status as QueueJob['status'],
        priority: data.priority || 5,
        attempts: data.attempts || 0,
        maxAttempts: data.maxAttempts || 3,
        payload: data.payload || '',
        createdAt: new Date(job.createdAt).getTime(),
        updatedAt: new Date(job.updatedAt).getTime(),
        error: data.error,
      };
    } catch {
      return null;
    }
  }

  async clearCompleted(): Promise<number> {
    const result = await db.review.deleteMany({
      where: { repositoryId: 'queue', status: 'completed' },
    });
    if (result.count > 0) {
      logger.info('Cleared completed jobs', { count: result.count });
    }
    return result.count;
  }
}

export const queue = new PersistentQueue();

export async function processQueue(
  handler: (job: QueueJob) => Promise<void>,
  options?: { pollIntervalMs?: number; maxConcurrent?: number }
): Promise<void> {
  const pollInterval = options?.pollIntervalMs || 1000;
  const maxConcurrent = options?.maxConcurrent || 3;
  let running = 0;

  const poll = async () => {
    if (running >= maxConcurrent) return;
    const job = await queue.dequeue();
    if (!job) return;

    running++;
    handler(job)
      .then(async () => {
        await queue.markCompleted(job.id);
      })
      .catch(async (err) => {
        const msg = err instanceof Error ? err.message : 'Unknown error';
        logger.error('Job processing failed', { id: job.id, error: msg });
        await queue.markFailed(job.id, msg);
      })
      .finally(() => {
        running--;
      });
  };

  setInterval(async () => {
    try {
      await poll();
    } catch {
      // keep polling
    }
  }, pollInterval);
}

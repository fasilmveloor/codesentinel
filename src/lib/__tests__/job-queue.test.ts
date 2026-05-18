import { describe, it, expect } from 'vitest';

describe('Job Queue', () => {
  interface QueueJob {
    id: string;
    type: string;
    status: 'queued' | 'running' | 'completed' | 'failed';
    priority: number;
    attempts: number;
    maxAttempts: number;
    createdAt: number;
  }

  // Simple in-memory queue for testing
  class SimpleQueue {
    private jobs: QueueJob[] = [];

    enqueue(type: string, priority: number = 5): string {
      const id = `job-${Math.random().toString(36).substring(2, 8)}`;
      this.jobs.push({ id, type, status: 'queued', priority, attempts: 0, maxAttempts: 3, createdAt: Date.now() });
      // Sort by priority (lower = higher priority)
      this.jobs.sort((a, b) => a.priority - b.priority);
      return id;
    }

    dequeue(): QueueJob | undefined {
      const job = this.jobs.find(j => j.status === 'queued');
      if (job) job.status = 'running';
      return job;
    }

    markCompleted(id: string): void {
      const job = this.jobs.find(j => j.id === id);
      if (job) job.status = 'completed';
    }

    markFailed(id: string): void {
      const job = this.jobs.find(j => j.id === id);
      if (job) {
        job.attempts++;
        if (job.attempts >= job.maxAttempts) job.status = 'failed';
        else job.status = 'queued'; // Re-queue for retry
      }
    }

    getStats() {
      return {
        queued: this.jobs.filter(j => j.status === 'queued').length,
        running: this.jobs.filter(j => j.status === 'running').length,
        completed: this.jobs.filter(j => j.status === 'completed').length,
        failed: this.jobs.filter(j => j.status === 'failed').length,
      };
    }
  }

  it('should enqueue and dequeue jobs', () => {
    const queue = new SimpleQueue();
    const id = queue.enqueue('github_review');
    const job = queue.dequeue();
    expect(job).toBeTruthy();
    expect(job!.id).toBe(id);
    expect(job!.status).toBe('running');
  });

  it('should respect priority ordering', () => {
    const queue = new SimpleQueue();
    queue.enqueue('github_review', 5);
    queue.enqueue('github_review', 1); // Higher priority
    queue.enqueue('github_review', 3);
    const job = queue.dequeue();
    expect(job!.priority).toBe(1);
  });

  it('should mark jobs as completed', () => {
    const queue = new SimpleQueue();
    const id = queue.enqueue('github_review');
    const job = queue.dequeue();
    queue.markCompleted(id);
    expect(queue.getStats().completed).toBe(1);
  });

  it('should retry failed jobs up to max attempts', () => {
    const queue = new SimpleQueue();
    const id = queue.enqueue('github_review');
    queue.dequeue();
    queue.markFailed(id); // Attempt 1 → re-queued
    queue.dequeue();
    queue.markFailed(id); // Attempt 2 → re-queued
    queue.dequeue();
    queue.markFailed(id); // Attempt 3 → failed permanently
    expect(queue.getStats().failed).toBe(1);
  });

  it('should report correct stats', () => {
    const queue = new SimpleQueue();
    const id1 = queue.enqueue('github_review');
    queue.enqueue('gitlab_review');
    const job = queue.dequeue();
    if (job) queue.markCompleted(job.id);
    const stats = queue.getStats();
    expect(stats.queued).toBe(1);
    expect(stats.completed + stats.running).toBeGreaterThanOrEqual(1);
  });
});

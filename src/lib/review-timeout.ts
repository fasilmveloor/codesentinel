import { db } from './db';
import { REVIEW_TIMEOUT_MS } from './constants';

/**
 * Cleanup reviews stuck in "reviewing" status for too long.
 * Called on module load and periodically to prevent indefinite stuck states.
 *
 * Serverless-compatible: uses a singleton pattern to avoid running
 * multiple setInterval timers on each cold start.
 */
export async function cleanupStuckReviews(): Promise<void> {
  try {
    const stuckThreshold = new Date(Date.now() - REVIEW_TIMEOUT_MS);
    const stuckReviews = await db.review.findMany({
      where: {
        status: 'reviewing',
        updatedAt: { lt: stuckThreshold },
      },
    });
    for (const review of stuckReviews) {
      await db.review.update({
        where: { id: review.id },
        data: {
          status: 'failed',
          summary: 'Review timed out — the processing took too long and was automatically terminated.',
        },
      });
    }
    if (stuckReviews.length > 0) {
      console.warn(`Cleaned up ${stuckReviews.length} stuck review(s)`);
    }
  } catch (err) {
    console.error('Failed to cleanup stuck reviews:', err);
  }
}

/**
 * Wrap a promise with a timeout. If the promise doesn't resolve within the
 * specified time, the review is marked as failed and the promise is rejected.
 */
export function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  reviewId: string
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(async () => {
      // Mark the review as failed on timeout
      try {
        await db.review.update({
          where: { id: reviewId },
          data: {
            status: 'failed',
            summary: `Review timed out after ${ms / 1000} seconds. The AI processing took too long.`,
          },
        });
      } catch { /* Best effort */ }
      reject(new Error(`Review ${reviewId} timed out after ${ms}ms`));
    }, ms);
    promise.then(
      (result) => { clearTimeout(timer); resolve(result); },
      (err) => { clearTimeout(timer); reject(err); }
    );
  });
}

// --- Singleton cleanup scheduler ---
// Prevents multiple setInterval timers in serverless environments
// where each cold start would otherwise create a new timer.

let cleanupIntervalId: ReturnType<typeof setInterval> | null = null;
let cleanupInitialized = false;

/**
 * Initialize the stuck review cleanup scheduler.
 * Safe to call multiple times — only initializes once.
 * Called automatically on first import.
 */
export function initCleanupScheduler(): void {
  if (cleanupInitialized) return;
  cleanupInitialized = true;

  // Run cleanup once on initialization
  cleanupStuckReviews().catch(() => {});

  // Schedule periodic cleanup only if not in a serverless environment
  // or if explicitly enabled via environment variable
  if (typeof setInterval !== 'undefined') {
    const isServerless = process.env.NETLIFY === 'true' ||
      process.env.VERCEL === '1' ||
      process.env.AWS_LAMBDA_FUNCTION_NAME;

    // In serverless: only run cleanup on module load (no interval)
    // In long-running: run cleanup every 60 seconds
    if (!isServerless) {
      cleanupIntervalId = setInterval(() => {
        cleanupStuckReviews().catch(() => {});
      }, 60 * 1000);

      // Prevent the interval from keeping the process alive
      if (cleanupIntervalId && typeof cleanupIntervalId === 'object' && 'unref' in cleanupIntervalId) {
        cleanupIntervalId.unref();
      }
    }
  }
}

/**
 * Stop the cleanup scheduler. Useful for graceful shutdown.
 */
export function stopCleanupScheduler(): void {
  if (cleanupIntervalId !== null) {
    clearInterval(cleanupIntervalId);
    cleanupIntervalId = null;
  }
  cleanupInitialized = false;
}

// Auto-initialize on module import
initCleanupScheduler();

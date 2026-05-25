import { db } from './db';
import { RATE_LIMIT_WINDOW, RATE_LIMIT_MAX } from './constants';

/**
 * DB-backed rate limiter.
 * Uses the AppConfig table to store rate limit counters per IP.
 * Works across serverless instances and survives server restarts.
 */

// Lazy cleanup: clean up on every Nth rate limit check to avoid unbounded growth
// without requiring a separate cron job (serverless-compatible)
const CLEANUP_EVERY_N_REQUESTS = 50;
let requestCounter = 0;

// --- Cleanup Metrics ---

export interface CleanupMetrics {
  lastCleanupAt: string | null;
  lastCleanupCount: number;
  totalCleanups: number;
  totalEntriesCleaned: number;
}

// In-memory metrics (reset on cold start, which is acceptable for monitoring)
let cleanupMetrics: CleanupMetrics = {
  lastCleanupAt: null,
  lastCleanupCount: 0,
  totalCleanups: 0,
  totalEntriesCleaned: 0,
};

/**
 * Get cleanup metrics for monitoring dashboards.
 */
export function getCleanupMetrics(): CleanupMetrics {
  return { ...cleanupMetrics };
}

// --- Per-IP rate limit tracking (uses DB for serverless compatibility) ---

export async function checkRateLimit(ip: string, max?: number): Promise<boolean> {
  const key = `rate_limit:${ip}`;
  const now = Date.now();
  const limit = max ?? RATE_LIMIT_MAX;

  try {
    const record = await db.appConfig.findUnique({ where: { key } });

    if (!record || now > parseInt(record.value.split(':')[1], 10)) {
      // New window or expired window
      await db.appConfig.upsert({
        where: { key },
        update: { value: `1:${now + RATE_LIMIT_WINDOW}` },
        create: { key, value: `1:${now + RATE_LIMIT_WINDOW}` },
      });

      // Lazy cleanup: periodically clean expired entries
      requestCounter++;
      if (requestCounter >= CLEANUP_EVERY_N_REQUESTS) {
        requestCounter = 0;
        // Fire-and-forget cleanup (non-blocking)
        cleanupRateLimitEntries().catch(() => {});
      }

      return true;
    }

    const [countStr, resetTimeStr] = record.value.split(':');
    const count = parseInt(countStr, 10);

    if (count >= limit) {
      return false;
    }

    await db.appConfig.update({
      where: { key },
      data: { value: `${count + 1}:${resetTimeStr}` },
    });

    return true;
  } catch {
    // If DB fails, allow the request through (fail open)
    return true;
  }
}

/**
 * Clean up expired rate limit entries from the database.
 * Uses Prisma instead of raw SQL for database-portability.
 * Should be called periodically to prevent unbounded growth.
 *
 * Strategy:
 * 1. Scan for keys matching the rate_limit: prefix
 * 2. Parse each entry's expiry timestamp
 * 3. Delete expired entries in a batch
 *
 * This is called lazily by checkRateLimit() and can also be
 * triggered via the /api/cleanup API endpoint or an external cron.
 *
 * Cleanup can also be scheduled via:
 * - The /api/cleanup/scheduled endpoint (supports CRON_SECRET for auth)
 * - An external cron service (cron-job.org, GitHub Actions, etc.)
 * - Netlify scheduled functions
 */
export async function cleanupRateLimitEntries(): Promise<number> {
  const now = Date.now();
  let cleaned = 0;

  try {
    // Use Prisma's findMany with startsWith filter — more portable than raw SQL
    // We scan all rate_limit keys and delete expired ones
    const allEntries = await db.appConfig.findMany({
      where: {
        key: { startsWith: 'rate_limit:' },
      },
      select: { key: true, value: true },
    });

    const expiredKeys: string[] = [];
    for (const entry of allEntries) {
      const parts = entry.value.split(':');
      if (parts.length < 2) {
        // Malformed entry — clean it up
        expiredKeys.push(entry.key);
        continue;
      }
      const resetTime = parseInt(parts[1], 10);
      if (isNaN(resetTime) || now > resetTime) {
        expiredKeys.push(entry.key);
      }
    }

    // Batch delete expired entries
    if (expiredKeys.length > 0) {
      await db.appConfig.deleteMany({
        where: {
          key: { in: expiredKeys },
        },
      });
      cleaned = expiredKeys.length;
    }

    // Update cleanup metrics
    if (cleaned > 0) {
      cleanupMetrics = {
        lastCleanupAt: new Date().toISOString(),
        lastCleanupCount: cleaned,
        totalCleanups: cleanupMetrics.totalCleanups + 1,
        totalEntriesCleaned: cleanupMetrics.totalEntriesCleaned + cleaned,
      };

      // Persist cleanup timestamp to DB for cross-instance visibility
      try {
        await db.appConfig.upsert({
          where: { key: 'rate_limit_last_cleanup' },
          update: { value: new Date().toISOString() },
          create: { key: 'rate_limit_last_cleanup', value: new Date().toISOString() },
        });
      } catch {
        // Non-critical — metrics are primarily in-memory
      }
    }
  } catch {
    // Silent fail — cleanup is best-effort
  }

  return cleaned;
}

/**
 * Get statistics about rate limit entries for monitoring.
 * Returns count of active and expired entries.
 */
export async function getRateLimitStats(): Promise<{ active: number; expired: number; total: number; lastCleanupAt: string | null }> {
  const now = Date.now();
  let active = 0;
  let expired = 0;
  let lastCleanupAt: string | null = cleanupMetrics.lastCleanupAt;

  try {
    const [allEntries, lastCleanupRecord] = await Promise.all([
      db.appConfig.findMany({
        where: { key: { startsWith: 'rate_limit:' } },
        select: { value: true },
      }),
      db.appConfig.findUnique({ where: { key: 'rate_limit_last_cleanup' } }),
    ]);

    for (const entry of allEntries) {
      const parts = entry.value.split(':');
      if (parts.length < 2) {
        expired++;
        continue;
      }
      const resetTime = parseInt(parts[1], 10);
      if (isNaN(resetTime) || now > resetTime) {
        expired++;
      } else {
        active++;
      }
    }

    // Use DB-persisted timestamp if available (more reliable across instances)
    if (lastCleanupRecord?.value) {
      lastCleanupAt = lastCleanupRecord.value;
    }
  } catch {
    // Return what we have on failure
  }

  return { active, expired, total: active + expired, lastCleanupAt };
}

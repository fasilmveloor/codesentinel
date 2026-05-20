import { db } from './db';
import { RATE_LIMIT_WINDOW, RATE_LIMIT_MAX } from './constants';

// DB-backed rate limiter — serverless-friendly (survives cold starts)
// Uses the AppConfig table to track rate limit counters per IP.
// On each check, expired entries are lazily cleaned up.

const RATE_LIMIT_KEY_PREFIX = 'ratelimit:';

interface RateLimitRecord {
  count: number;
  resetTime: number;
}

function parseRecord(value: string): RateLimitRecord | null {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

/**
 * Check rate limit for a given IP address using the database.
 * Returns true if the request is allowed, false if rate limited.
 * Also performs lazy cleanup of expired entries.
 */
export async function checkRateLimit(ip: string): Promise<boolean> {
  const key = `${RATE_LIMIT_KEY_PREFIX}${ip}`;
  const now = Date.now();

  // Lazy cleanup: delete expired entries (max 5 per check to avoid slowness)
  try {
    const allRateLimitConfigs = await db.appConfig.findMany({
      where: { key: { startsWith: RATE_LIMIT_KEY_PREFIX } },
      take: 50,
    });

    let deleted = 0;
    for (const config of allRateLimitConfigs) {
      const record = parseRecord(config.value);
      if (record && now > record.resetTime) {
        await db.appConfig.delete({ where: { key: config.key } });
        deleted++;
        if (deleted >= 5) break; // Limit cleanup per request
      }
    }
  } catch {
    // Cleanup failure shouldn't block the request
  }

  // Check current rate limit
  try {
    const existing = await db.appConfig.findUnique({ where: { key } });
    const record = existing ? parseRecord(existing.value) : null;

    if (!record || now > record.resetTime) {
      // Window expired or no record — start fresh
      await db.appConfig.upsert({
        where: { key },
        update: { value: JSON.stringify({ count: 1, resetTime: now + RATE_LIMIT_WINDOW }) },
        create: { key, value: JSON.stringify({ count: 1, resetTime: now + RATE_LIMIT_WINDOW }) },
      });
      return true;
    }

    if (record.count >= RATE_LIMIT_MAX) {
      return false; // Rate limited
    }

    // Increment counter
    await db.appConfig.update({
      where: { key },
      data: { value: JSON.stringify({ count: record.count + 1, resetTime: record.resetTime }) },
    });

    return true;
  } catch {
    // If DB operation fails, allow the request (fail open)
    console.error('Rate limit DB operation failed, allowing request');
    return true;
  }
}

/**
 * Manual cleanup of all expired rate limit entries.
 * Can be called from a scheduled function or admin endpoint.
 */
export async function cleanupRateLimitEntries(): Promise<number> {
  const now = Date.now();
  let deleted = 0;

  try {
    const allRateLimitConfigs = await db.appConfig.findMany({
      where: { key: { startsWith: RATE_LIMIT_KEY_PREFIX } },
    });

    for (const config of allRateLimitConfigs) {
      const record = parseRecord(config.value);
      if (record && now > record.resetTime) {
        await db.appConfig.delete({ where: { key: config.key } });
        deleted++;
      }
    }
  } catch {
    // Ignore cleanup errors
  }

  return deleted;
}

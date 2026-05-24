import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { checkRateLimit, cleanupRateLimitEntries, getRateLimitStats, getCleanupMetrics } from '../rate-limit';
import { RATE_LIMIT_WINDOW, RATE_LIMIT_MAX } from '../constants';

// Mock the db module
vi.mock('@/lib/db', () => ({
  db: {
    appConfig: {
      findUnique: vi.fn(),
      upsert: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
      deleteMany: vi.fn(),
      findMany: vi.fn(),
    },
  },
}));

import { db } from '@/lib/db';
const mockFindUnique = db.appConfig.findUnique as ReturnType<typeof vi.fn>;
const mockUpsert = db.appConfig.upsert as ReturnType<typeof vi.fn>;
const mockUpdate = db.appConfig.update as ReturnType<typeof vi.fn>;
const mockDelete = db.appConfig.delete as ReturnType<typeof vi.fn>;
const mockDeleteMany = db.appConfig.deleteMany as ReturnType<typeof vi.fn>;
const mockFindMany = db.appConfig.findMany as ReturnType<typeof vi.fn>;

describe('checkRateLimit', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2024-01-01T00:00:00Z'));
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('should return true for new IPs', async () => {
    mockFindUnique.mockResolvedValueOnce(null);
    mockUpsert.mockResolvedValueOnce({});
    const result = await checkRateLimit('192.168.1.1');
    expect(result).toBe(true);
  });

  it('should return true for multiple new IPs', async () => {
    mockFindUnique.mockResolvedValue(null);
    mockUpsert.mockResolvedValue({});
    expect(await checkRateLimit('192.168.1.1')).toBe(true);
    expect(await checkRateLimit('10.0.0.1')).toBe(true);
    expect(await checkRateLimit('172.16.0.1')).toBe(true);
  });

  it('should return false when limit exceeded for same IP', async () => {
    const now = Date.now();
    const resetTime = now + RATE_LIMIT_WINDOW;

    // First request - no record
    mockFindUnique.mockResolvedValueOnce(null);
    mockUpsert.mockResolvedValueOnce({});

    // Subsequent requests within the window
    for (let i = 1; i < RATE_LIMIT_MAX; i++) {
      mockFindUnique.mockResolvedValueOnce({
        key: 'rate_limit:192.168.1.100',
        value: `${i}:${resetTime}`,
      });
      mockUpdate.mockResolvedValueOnce({});
    }

    // Use up the rate limit
    for (let i = 0; i < RATE_LIMIT_MAX; i++) {
      expect(await checkRateLimit('192.168.1.100')).toBe(true);
    }

    // Next request should be rejected
    mockFindUnique.mockResolvedValueOnce({
      key: 'rate_limit:192.168.1.100',
      value: `${RATE_LIMIT_MAX}:${resetTime}`,
    });
    expect(await checkRateLimit('192.168.1.100')).toBe(false);
  });

  it('should not affect other IPs when one is rate limited', async () => {
    const now = Date.now();
    const resetTime = now + RATE_LIMIT_WINDOW;

    // Use up the rate limit for one IP
    mockFindUnique.mockResolvedValueOnce(null);
    mockUpsert.mockResolvedValueOnce({});
    for (let i = 1; i < RATE_LIMIT_MAX; i++) {
      mockFindUnique.mockResolvedValueOnce({
        key: 'rate_limit:192.168.1.100',
        value: `${i}:${resetTime}`,
      });
      mockUpdate.mockResolvedValueOnce({});
    }

    for (let i = 0; i < RATE_LIMIT_MAX; i++) {
      await checkRateLimit('192.168.1.100');
    }

    // This IP is now rate limited
    mockFindUnique.mockResolvedValueOnce({
      key: 'rate_limit:192.168.1.100',
      value: `${RATE_LIMIT_MAX}:${resetTime}`,
    });
    expect(await checkRateLimit('192.168.1.100')).toBe(false);

    // Different IP should still work
    mockFindUnique.mockResolvedValueOnce(null);
    mockUpsert.mockResolvedValueOnce({});
    expect(await checkRateLimit('10.0.0.1')).toBe(true);
  });

  it('should reset after window expires', async () => {
    const now = Date.now();

    // First request creates a record
    mockFindUnique.mockResolvedValueOnce(null);
    mockUpsert.mockResolvedValueOnce({});
    await checkRateLimit('192.168.1.200');

    // Use up the rate limit
    const resetTime = now + RATE_LIMIT_WINDOW;
    for (let i = 1; i < RATE_LIMIT_MAX; i++) {
      mockFindUnique.mockResolvedValueOnce({
        key: 'rate_limit:192.168.1.200',
        value: `${i}:${resetTime}`,
      });
      mockUpdate.mockResolvedValueOnce({});
    }
    for (let i = 1; i < RATE_LIMIT_MAX; i++) {
      await checkRateLimit('192.168.1.200');
    }

    // Should be rate limited
    mockFindUnique.mockResolvedValueOnce({
      key: 'rate_limit:192.168.1.200',
      value: `${RATE_LIMIT_MAX}:${resetTime}`,
    });
    expect(await checkRateLimit('192.168.1.200')).toBe(false);

    // Advance time past the rate limit window
    vi.advanceTimersByTime(RATE_LIMIT_WINDOW + 1);

    // Should be allowed again (window expired)
    mockFindUnique.mockResolvedValueOnce({
      key: 'rate_limit:192.168.1.200',
      value: `${RATE_LIMIT_MAX}:${now + RATE_LIMIT_WINDOW}`, // old resetTime
    });
    mockUpsert.mockResolvedValueOnce({});
    expect(await checkRateLimit('192.168.1.200')).toBe(true);
  });

  it('should track count incrementally within the window', async () => {
    const now = Date.now();
    const resetTime = now + RATE_LIMIT_WINDOW;

    // First request
    mockFindUnique.mockResolvedValueOnce(null);
    mockUpsert.mockResolvedValueOnce({});
    expect(await checkRateLimit('192.168.1.50')).toBe(true);

    // Advance time but stay within window
    vi.advanceTimersByTime(RATE_LIMIT_WINDOW / 2);

    // Should still be allowed (count < RATE_LIMIT_MAX)
    mockFindUnique.mockResolvedValueOnce({
      key: 'rate_limit:192.168.1.50',
      value: `1:${resetTime}`,
    });
    mockUpdate.mockResolvedValueOnce({});
    expect(await checkRateLimit('192.168.1.50')).toBe(true);
  });

  it('should handle IPv6-style addresses', async () => {
    mockFindUnique.mockResolvedValue(null);
    mockUpsert.mockResolvedValue({});
    expect(await checkRateLimit('::1')).toBe(true);
    expect(await checkRateLimit('2001:db8::1')).toBe(true);
  });

  it('should fail open when DB fails', async () => {
    mockFindUnique.mockRejectedValueOnce(new Error('DB error'));
    const result = await checkRateLimit('192.168.1.1');
    expect(result).toBe(true);
  });
});

describe('cleanupRateLimitEntries', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2024-01-01T00:00:00Z'));
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('should remove expired entries using Prisma findMany + deleteMany', async () => {
    const now = Date.now();
    const expiredResetTime = now - 1000; // Already expired
    mockFindMany.mockResolvedValueOnce([
      { key: 'rate_limit:192.168.1.1', value: `5:${expiredResetTime}` },
    ]);
    mockDeleteMany.mockResolvedValueOnce({ count: 1 });

    const cleaned = await cleanupRateLimitEntries();
    expect(cleaned).toBe(1);
    // Verify it uses Prisma's findMany with startsWith filter, not raw SQL
    expect(mockFindMany).toHaveBeenCalledWith({
      where: { key: { startsWith: 'rate_limit:' } },
      select: { key: true, value: true },
    });
    expect(mockDeleteMany).toHaveBeenCalledWith({
      where: { key: { in: ['rate_limit:192.168.1.1'] } },
    });
  });

  it('should not remove non-expired entries', async () => {
    const now = Date.now();
    const activeResetTime = now + RATE_LIMIT_WINDOW;
    mockFindMany.mockResolvedValueOnce([
      { key: 'rate_limit:192.168.1.1', value: `1:${activeResetTime}` },
    ]);

    const cleaned = await cleanupRateLimitEntries();
    expect(cleaned).toBe(0);
    expect(mockDeleteMany).not.toHaveBeenCalled();
  });

  it('should handle cleanup when no entries exist', async () => {
    mockFindMany.mockResolvedValueOnce([]);
    const cleaned = await cleanupRateLimitEntries();
    expect(cleaned).toBe(0);
  });

  it('should remove only expired entries, keeping valid ones', async () => {
    const now = Date.now();
    const expiredResetTime = now - 1000;
    const activeResetTime = now + RATE_LIMIT_WINDOW;

    mockFindMany.mockResolvedValueOnce([
      { key: 'rate_limit:99.99.99.1', value: `5:${expiredResetTime}` },
      { key: 'rate_limit:99.99.99.2', value: `1:${activeResetTime}` },
    ]);
    mockDeleteMany.mockResolvedValueOnce({ count: 1 });

    const cleaned = await cleanupRateLimitEntries();
    expect(cleaned).toBe(1);
    expect(mockDeleteMany).toHaveBeenCalledWith({
      where: { key: { in: ['rate_limit:99.99.99.1'] } },
    });
  });

  it('should handle malformed entries during cleanup', async () => {
    mockFindMany.mockResolvedValueOnce([
      { key: 'rate_limit:3.3.3.3', value: 'malformed-no-colon' },
      { key: 'rate_limit:4.4.4.4', value: 'notanumber:abc' },
    ]);
    mockDeleteMany.mockResolvedValueOnce({ count: 2 });

    const cleaned = await cleanupRateLimitEntries();
    expect(cleaned).toBe(2);
    // Both malformed entries should be cleaned up
    expect(mockDeleteMany).toHaveBeenCalledWith({
      where: { key: { in: ['rate_limit:3.3.3.3', 'rate_limit:4.4.4.4'] } },
    });
  });

  it('should handle DB errors gracefully', async () => {
    mockFindMany.mockRejectedValueOnce(new Error('DB error'));
    const cleaned = await cleanupRateLimitEntries();
    expect(cleaned).toBe(0);
  });
});

describe('getRateLimitStats', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2024-01-01T00:00:00Z'));
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('should return correct stats for mixed entries', async () => {
    const now = Date.now();
    mockFindMany.mockResolvedValueOnce([
      { value: `5:${now - 1000}` },      // Expired
      { value: `3:${now + 60000}` },      // Active
      { value: `1:${now + 60000}` },      // Active
    ]);
    mockFindUnique.mockResolvedValueOnce(null); // rate_limit_last_cleanup

    const stats = await getRateLimitStats();
    expect(stats.expired).toBe(1);
    expect(stats.active).toBe(2);
    expect(stats.total).toBe(3);
  });

  it('should return lastCleanupAt from DB record', async () => {
    const now = Date.now();
    mockFindMany.mockResolvedValueOnce([]);
    mockFindUnique.mockResolvedValueOnce({
      key: 'rate_limit_last_cleanup',
      value: '2024-06-15T10:30:00.000Z',
      id: '1',
    });

    const stats = await getRateLimitStats();
    expect(stats.lastCleanupAt).toBe('2024-06-15T10:30:00.000Z');
  });

  it('should handle empty entries', async () => {
    mockFindMany.mockResolvedValueOnce([]);
    mockFindUnique.mockResolvedValueOnce(null);
    const stats = await getRateLimitStats();
    expect(stats.active).toBe(0);
    expect(stats.expired).toBe(0);
    expect(stats.total).toBe(0);
  });

  it('should handle DB errors', async () => {
    mockFindMany.mockRejectedValueOnce(new Error('DB error'));
    const stats = await getRateLimitStats();
    expect(stats.active).toBe(0);
    expect(stats.expired).toBe(0);
    expect(stats.total).toBe(0);
  });
});

describe('getCleanupMetrics', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should return initial metrics with zero values', () => {
    const metrics = getCleanupMetrics();
    expect(metrics).toHaveProperty('lastCleanupAt');
    expect(metrics).toHaveProperty('lastCleanupCount');
    expect(metrics).toHaveProperty('totalCleanups');
    expect(metrics).toHaveProperty('totalEntriesCleaned');
  });

  it('should update metrics after successful cleanup', async () => {
    const now = Date.now();
    const expiredResetTime = now - 1000;

    mockFindMany.mockResolvedValueOnce([
      { key: 'rate_limit:10.10.10.1', value: `5:${expiredResetTime}` },
      { key: 'rate_limit:10.10.10.2', value: `3:${expiredResetTime}` },
    ]);
    mockDeleteMany.mockResolvedValueOnce({ count: 2 });
    mockUpsert.mockResolvedValueOnce({ key: 'rate_limit_last_cleanup', value: new Date().toISOString(), id: '1' });

    const cleaned = await cleanupRateLimitEntries();
    expect(cleaned).toBe(2);

    const metrics = getCleanupMetrics();
    expect(metrics.totalCleanups).toBeGreaterThan(0);
    expect(metrics.totalEntriesCleaned).toBeGreaterThanOrEqual(2);
    expect(metrics.lastCleanupAt).not.toBeNull();
    expect(metrics.lastCleanupCount).toBe(2);
  });
});

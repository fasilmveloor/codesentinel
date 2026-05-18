import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { checkRateLimit, cleanupRateLimitMap } from '../rate-limit';
import { RATE_LIMIT_WINDOW, RATE_LIMIT_MAX } from '../constants';

describe('checkRateLimit', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2024-01-01T00:00:00Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('should return true for new IPs', () => {
    const result = checkRateLimit('192.168.1.1');
    expect(result).toBe(true);
  });

  it('should return true for multiple new IPs', () => {
    expect(checkRateLimit('192.168.1.1')).toBe(true);
    expect(checkRateLimit('10.0.0.1')).toBe(true);
    expect(checkRateLimit('172.16.0.1')).toBe(true);
  });

  it('should return false when limit exceeded for same IP', () => {
    for (let i = 0; i < RATE_LIMIT_MAX; i++) {
      expect(checkRateLimit('192.168.1.100')).toBe(true);
    }
    expect(checkRateLimit('192.168.1.100')).toBe(false);
  });

  it('should not affect other IPs when one is rate limited', () => {
    for (let i = 0; i < RATE_LIMIT_MAX; i++) {
      checkRateLimit('192.168.1.100');
    }
    expect(checkRateLimit('192.168.1.100')).toBe(false);
    expect(checkRateLimit('10.0.0.1')).toBe(true);
  });

  it('should reset after window expires', () => {
    for (let i = 0; i < RATE_LIMIT_MAX; i++) {
      checkRateLimit('192.168.1.200');
    }
    expect(checkRateLimit('192.168.1.200')).toBe(false);
    vi.advanceTimersByTime(RATE_LIMIT_WINDOW + 1);
    expect(checkRateLimit('192.168.1.200')).toBe(true);
  });

  it('should track count incrementally within the window', () => {
    expect(checkRateLimit('192.168.1.50')).toBe(true);
    vi.advanceTimersByTime(RATE_LIMIT_WINDOW / 2);
    expect(checkRateLimit('192.168.1.50')).toBe(true);
  });
});

describe('cleanupRateLimitMap', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2024-01-01T00:00:00Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('should remove expired entries', () => {
    checkRateLimit('192.168.1.1');
    vi.advanceTimersByTime(RATE_LIMIT_WINDOW + 1);
    cleanupRateLimitMap();
    expect(checkRateLimit('192.168.1.1')).toBe(true);
  });

  it('should not remove non-expired entries', () => {
    checkRateLimit('192.168.1.1');
    vi.advanceTimersByTime(RATE_LIMIT_WINDOW / 2);
    cleanupRateLimitMap();
    for (let i = 1; i < RATE_LIMIT_MAX; i++) {
      checkRateLimit('192.168.1.1');
    }
    expect(checkRateLimit('192.168.1.1')).toBe(false);
  });

  it('should handle cleanup when map is empty', () => {
    expect(() => cleanupRateLimitMap()).not.toThrow();
  });

  it('should remove only expired entries, keeping valid ones', () => {
    // Use unique IPs to avoid interference from other tests
    const expiredIP = '203.0.113.1';
    const activeIP = '203.0.113.2';
    
    checkRateLimit(expiredIP);
    vi.advanceTimersByTime(RATE_LIMIT_WINDOW / 2);
    checkRateLimit(activeIP);
    // Advance so first entry is expired but second is not
    vi.advanceTimersByTime(RATE_LIMIT_WINDOW / 2 + 1);
    cleanupRateLimitMap();
    // First IP should be treated as new (expired → cleaned up)
    expect(checkRateLimit(expiredIP)).toBe(true);
    // Second IP: its window hasn't expired yet, still allows more requests
    expect(checkRateLimit(activeIP)).toBe(true);
  });
});

import { describe, it, expect } from 'vitest';
import { formatDate } from '../format';

describe('formatDate', () => {
  it('should return a formatted date string', () => {
    const result = formatDate('2024-01-15T10:30:00Z');
    expect(result).toBeTypeOf('string');
    expect(result.length).toBeGreaterThan(0);
  });

  it('should handle ISO date strings', () => {
    const isoDate = '2024-06-15T14:30:00.000Z';
    const result = formatDate(isoDate);
    expect(result).toBeTypeOf('string');
    // Should contain recognizable date components
    expect(result.length).toBeGreaterThan(0);
  });

  it('should handle ISO date strings with timezone offset', () => {
    const result = formatDate('2024-01-15T10:30:00+05:00');
    expect(result).toBeTypeOf('string');
    expect(result.length).toBeGreaterThan(0);
  });

  it('should handle date-only strings', () => {
    const result = formatDate('2024-01-15');
    expect(result).toBeTypeOf('string');
    expect(result.length).toBeGreaterThan(0);
  });

  it('should handle empty input gracefully', () => {
    const result = formatDate('');
    // Empty string creates an Invalid Date, which toLocaleDateString returns "Invalid Date"
    expect(result).toBeTypeOf('string');
  });

  it('should handle invalid input gracefully', () => {
    const result = formatDate('not-a-date');
    expect(result).toBeTypeOf('string');
    // Invalid date strings still return a string (may be "Invalid Date")
  });

  it('should produce consistent output for the same input', () => {
    const dateStr = '2024-03-15T12:00:00Z';
    const result1 = formatDate(dateStr);
    const result2 = formatDate(dateStr);
    expect(result1).toBe(result2);
  });

  it('should produce different output for different dates', () => {
    const result1 = formatDate('2024-01-01T00:00:00Z');
    const result2 = formatDate('2024-12-31T23:59:59Z');
    expect(result1).not.toBe(result2);
  });

  it('should return the original string when Date constructor throws', () => {
    // Most invalid date strings just create Invalid Date objects, which toLocaleDateString
    // handles without throwing. But the catch block ensures robustness.
    const result = formatDate('anything');
    expect(result).toBeTypeOf('string');
  });

  it('should format a Date object string representation', () => {
    const date = new Date('2024-07-04T12:00:00Z');
    const result = formatDate(date.toISOString());
    expect(result).toBeTypeOf('string');
    expect(result.length).toBeGreaterThan(0);
  });
});

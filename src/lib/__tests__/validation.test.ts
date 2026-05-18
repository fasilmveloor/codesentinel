import { describe, it, expect } from 'vitest';

describe('Input Validation', () => {
  function sanitizeString(input: string, maxLength: number = 10000): string {
    return input
      .replace(/\0/g, '') // Remove null bytes
      .substring(0, maxLength)
      .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '') // Remove script tags
      .trim();
  }

  function validatePRNumber(prNumber: unknown): { valid: boolean; value: number } {
    const num = typeof prNumber === 'string' ? parseInt(prNumber, 10) : typeof prNumber === 'number' ? prNumber : NaN;
    if (isNaN(num) || num < 1 || num > 1000000 || !Number.isInteger(num)) return { valid: false, value: 0 };
    return { valid: true, value: num };
  }

  function isValidUrl(url: string): boolean {
    try {
      const parsed = new URL(url);
      return parsed.protocol === 'http:' || parsed.protocol === 'https:';
    } catch { return false; }
  }

  describe('sanitizeString', () => {
    it('should remove null bytes', () => {
      expect(sanitizeString('hello\0world')).toBe('helloworld');
    });

    it('should truncate to max length', () => {
      const long = 'a'.repeat(200);
      expect(sanitizeString(long, 100).length).toBeLessThanOrEqual(100);
    });

    it('should remove script tags', () => {
      expect(sanitizeString('<script>alert("xss")</script>hello')).toBe('hello');
    });

    it('should trim whitespace', () => {
      expect(sanitizeString('  hello  ')).toBe('hello');
    });
  });

  describe('validatePRNumber', () => {
    it('should accept valid PR numbers', () => {
      expect(validatePRNumber(42).valid).toBe(true);
      expect(validatePRNumber(1).valid).toBe(true);
      expect(validatePRNumber(1000000).valid).toBe(true);
    });

    it('should accept string PR numbers', () => {
      expect(validatePRNumber('42').valid).toBe(true);
      expect(validatePRNumber('42').value).toBe(42);
    });

    it('should reject invalid PR numbers', () => {
      expect(validatePRNumber(0).valid).toBe(false);
      expect(validatePRNumber(-1).valid).toBe(false);
      expect(validatePRNumber(1.5).valid).toBe(false);
      expect(validatePRNumber('abc').valid).toBe(false);
    });
  });

  describe('isValidUrl', () => {
    it('should accept http/https URLs', () => {
      expect(isValidUrl('https://github.com')).toBe(true);
      expect(isValidUrl('http://localhost:3000')).toBe(true);
    });

    it('should reject non-http URLs', () => {
      expect(isValidUrl('ftp://files.example.com')).toBe(false);
      expect(isValidUrl('javascript:alert(1)')).toBe(false);
    });

    it('should reject invalid URLs', () => {
      expect(isValidUrl('not-a-url')).toBe(false);
      expect(isValidUrl('')).toBe(false);
    });
  });
});

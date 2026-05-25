import { describe, it, expect } from 'vitest';
import { sanitizeString, validatePRNumber, isValidUrl } from '@/lib/validation';

describe('Input Validation', () => {
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

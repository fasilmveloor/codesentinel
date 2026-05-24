import { describe, it, expect } from 'vitest';
import {
  DEFAULT_TIMEOUT,
  GITHUB_API_TIMEOUT,
  AI_API_TIMEOUT,
  DIFF_MAX_LENGTH,
  FILE_CONTENT_TRUNCATE,
  GITHUB_FILE_CONTENT_TRUNCATE,
  GITHUB_REVIEW_BODY_MAX,
  GITHUB_ANNOTATION_LIMIT,
  CONFIG_VALUE_MAX_LENGTH,
  MASK_MIN_LENGTH,
  RATE_LIMIT_WINDOW,
  RATE_LIMIT_MAX,
  DEFAULT_PAGE,
  DEFAULT_LIMIT,
  MAX_LIMIT,
  REPO_NAME_REGEX,
} from '../constants';

describe('Constants', () => {
  describe('Timeout values', () => {
    it('DEFAULT_TIMEOUT should be a positive number', () => {
      expect(DEFAULT_TIMEOUT).toBeTypeOf('number');
      expect(DEFAULT_TIMEOUT).toBeGreaterThan(0);
    });

    it('GITHUB_API_TIMEOUT should be a positive number', () => {
      expect(GITHUB_API_TIMEOUT).toBeTypeOf('number');
      expect(GITHUB_API_TIMEOUT).toBeGreaterThan(0);
    });

    it('AI_API_TIMEOUT should be a positive number', () => {
      expect(AI_API_TIMEOUT).toBeTypeOf('number');
      expect(AI_API_TIMEOUT).toBeGreaterThan(0);
    });

    it('AI_API_TIMEOUT should be larger than DEFAULT_TIMEOUT', () => {
      expect(AI_API_TIMEOUT).toBeGreaterThan(DEFAULT_TIMEOUT);
    });

    it('DEFAULT_TIMEOUT should be 30000', () => {
      expect(DEFAULT_TIMEOUT).toBe(30000);
    });

    it('GITHUB_API_TIMEOUT should be 15000', () => {
      expect(GITHUB_API_TIMEOUT).toBe(15000);
    });

    it('AI_API_TIMEOUT should be 60000', () => {
      expect(AI_API_TIMEOUT).toBe(60000);
    });
  });

  describe('Content limits', () => {
    it('DIFF_MAX_LENGTH should be a positive number', () => {
      expect(DIFF_MAX_LENGTH).toBeTypeOf('number');
      expect(DIFF_MAX_LENGTH).toBeGreaterThan(0);
    });

    it('FILE_CONTENT_TRUNCATE should be a positive number', () => {
      expect(FILE_CONTENT_TRUNCATE).toBeTypeOf('number');
      expect(FILE_CONTENT_TRUNCATE).toBeGreaterThan(0);
    });

    it('GITHUB_FILE_CONTENT_TRUNCATE should be a positive number', () => {
      expect(GITHUB_FILE_CONTENT_TRUNCATE).toBeTypeOf('number');
      expect(GITHUB_FILE_CONTENT_TRUNCATE).toBeGreaterThan(0);
    });

    it('FILE_CONTENT_TRUNCATE should be less than DIFF_MAX_LENGTH', () => {
      expect(FILE_CONTENT_TRUNCATE).toBeLessThan(DIFF_MAX_LENGTH);
    });

    it('DIFF_MAX_LENGTH should be 50000', () => {
      expect(DIFF_MAX_LENGTH).toBe(50000);
    });

    it('FILE_CONTENT_TRUNCATE should be 8000', () => {
      expect(FILE_CONTENT_TRUNCATE).toBe(8000);
    });

    it('GITHUB_FILE_CONTENT_TRUNCATE should be 10000', () => {
      expect(GITHUB_FILE_CONTENT_TRUNCATE).toBe(10000);
    });
  });

  describe('GitHub API limits', () => {
    it('GITHUB_REVIEW_BODY_MAX should be a positive number', () => {
      expect(GITHUB_REVIEW_BODY_MAX).toBeTypeOf('number');
      expect(GITHUB_REVIEW_BODY_MAX).toBeGreaterThan(0);
    });

    it('GITHUB_ANNOTATION_LIMIT should be a positive number', () => {
      expect(GITHUB_ANNOTATION_LIMIT).toBeTypeOf('number');
      expect(GITHUB_ANNOTATION_LIMIT).toBeGreaterThan(0);
    });

    it('GITHUB_REVIEW_BODY_MAX should be 65536', () => {
      expect(GITHUB_REVIEW_BODY_MAX).toBe(65536);
    });

    it('GITHUB_ANNOTATION_LIMIT should be 50', () => {
      expect(GITHUB_ANNOTATION_LIMIT).toBe(50);
    });
  });

  describe('Config validation limits', () => {
    it('CONFIG_VALUE_MAX_LENGTH should be a positive number', () => {
      expect(CONFIG_VALUE_MAX_LENGTH).toBeTypeOf('number');
      expect(CONFIG_VALUE_MAX_LENGTH).toBeGreaterThan(0);
    });

    it('MASK_MIN_LENGTH should be a positive number', () => {
      expect(MASK_MIN_LENGTH).toBeTypeOf('number');
      expect(MASK_MIN_LENGTH).toBeGreaterThan(0);
    });

    it('CONFIG_VALUE_MAX_LENGTH should be 10000', () => {
      expect(CONFIG_VALUE_MAX_LENGTH).toBe(10000);
    });

    it('MASK_MIN_LENGTH should be 8', () => {
      expect(MASK_MIN_LENGTH).toBe(8);
    });
  });

  describe('Rate limiting', () => {
    it('RATE_LIMIT_WINDOW should be a positive number', () => {
      expect(RATE_LIMIT_WINDOW).toBeTypeOf('number');
      expect(RATE_LIMIT_WINDOW).toBeGreaterThan(0);
    });

    it('RATE_LIMIT_MAX should be a positive number', () => {
      expect(RATE_LIMIT_MAX).toBeTypeOf('number');
      expect(RATE_LIMIT_MAX).toBeGreaterThan(0);
    });

    it('RATE_LIMIT_WINDOW should be 60000', () => {
      expect(RATE_LIMIT_WINDOW).toBe(60000);
    });

    it('RATE_LIMIT_MAX should be 30', () => {
      expect(RATE_LIMIT_MAX).toBe(30);
    });
  });

  describe('Pagination defaults', () => {
    it('DEFAULT_PAGE should be 1', () => {
      expect(DEFAULT_PAGE).toBe(1);
    });

    it('DEFAULT_LIMIT should be a positive number', () => {
      expect(DEFAULT_LIMIT).toBeGreaterThan(0);
    });

    it('MAX_LIMIT should be greater than or equal to DEFAULT_LIMIT', () => {
      expect(MAX_LIMIT).toBeGreaterThanOrEqual(DEFAULT_LIMIT);
    });

    it('DEFAULT_LIMIT should be 10', () => {
      expect(DEFAULT_LIMIT).toBe(10);
    });

    it('MAX_LIMIT should be 100', () => {
      expect(MAX_LIMIT).toBe(100);
    });
  });

  describe('REPO_NAME_REGEX', () => {
    it('should match valid alphanumeric names', () => {
      expect(REPO_NAME_REGEX.test('my-repo')).toBe(true);
      expect(REPO_NAME_REGEX.test('my_repo')).toBe(true);
      expect(REPO_NAME_REGEX.test('my.repo')).toBe(true);
      expect(REPO_NAME_REGEX.test('MyRepo123')).toBe(true);
      expect(REPO_NAME_REGEX.test('abc')).toBe(true);
    });

    it('should match single character names', () => {
      expect(REPO_NAME_REGEX.test('a')).toBe(true);
      expect(REPO_NAME_REGEX.test('1')).toBe(true);
    });

    it('should reject names with spaces', () => {
      expect(REPO_NAME_REGEX.test('my repo')).toBe(false);
    });

    it('should reject names with special characters', () => {
      expect(REPO_NAME_REGEX.test('my@repo')).toBe(false);
      expect(REPO_NAME_REGEX.test('my!repo')).toBe(false);
      expect(REPO_NAME_REGEX.test('my#repo')).toBe(false);
    });

    it('should reject empty strings', () => {
      expect(REPO_NAME_REGEX.test('')).toBe(false);
    });

    it('should reject names with slashes', () => {
      expect(REPO_NAME_REGEX.test('owner/repo')).toBe(false);
    });

    it('should reject names with colons', () => {
      expect(REPO_NAME_REGEX.test('owner:repo')).toBe(false);
    });
  });
});

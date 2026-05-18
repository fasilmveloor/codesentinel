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
  RATE_LIMIT_WINDOW,
  RATE_LIMIT_MAX,
  DEFAULT_PAGE,
  DEFAULT_LIMIT,
  MAX_LIMIT,
  REPO_NAME_REGEX,
} from '../constants';

describe('Constants', () => {
  describe('Timeout values', () => {
    it('DEFAULT_TIMEOUT should be positive', () => {
      expect(DEFAULT_TIMEOUT).toBeGreaterThan(0);
    });
    it('GITHUB_API_TIMEOUT should be positive', () => {
      expect(GITHUB_API_TIMEOUT).toBeGreaterThan(0);
    });
    it('AI_API_TIMEOUT should be positive', () => {
      expect(AI_API_TIMEOUT).toBeGreaterThan(0);
    });
    it('AI_API_TIMEOUT should be >= DEFAULT_TIMEOUT', () => {
      expect(AI_API_TIMEOUT).toBeGreaterThanOrEqual(DEFAULT_TIMEOUT);
    });
  });

  describe('Content limits', () => {
    it('DIFF_MAX_LENGTH should be positive', () => {
      expect(DIFF_MAX_LENGTH).toBeGreaterThan(0);
    });
    it('FILE_CONTENT_TRUNCATE should be positive', () => {
      expect(FILE_CONTENT_TRUNCATE).toBeGreaterThan(0);
    });
    it('GITHUB_FILE_CONTENT_TRUNCATE should be positive', () => {
      expect(GITHUB_FILE_CONTENT_TRUNCATE).toBeGreaterThan(0);
    });
    it('GITHUB_REVIEW_BODY_MAX should be positive', () => {
      expect(GITHUB_REVIEW_BODY_MAX).toBeGreaterThan(0);
    });
    it('GITHUB_ANNOTATION_LIMIT should be positive', () => {
      expect(GITHUB_ANNOTATION_LIMIT).toBeGreaterThan(0);
    });
    it('CONFIG_VALUE_MAX_LENGTH should be positive', () => {
      expect(CONFIG_VALUE_MAX_LENGTH).toBeGreaterThan(0);
    });
  });

  describe('Rate limiting', () => {
    it('RATE_LIMIT_WINDOW should be positive', () => {
      expect(RATE_LIMIT_WINDOW).toBeGreaterThan(0);
    });
    it('RATE_LIMIT_MAX should be positive', () => {
      expect(RATE_LIMIT_MAX).toBeGreaterThan(0);
    });
  });

  describe('Pagination', () => {
    it('DEFAULT_PAGE should be 1', () => {
      expect(DEFAULT_PAGE).toBe(1);
    });
    it('DEFAULT_LIMIT should be positive', () => {
      expect(DEFAULT_LIMIT).toBeGreaterThan(0);
    });
    it('MAX_LIMIT should be >= DEFAULT_LIMIT', () => {
      expect(MAX_LIMIT).toBeGreaterThanOrEqual(DEFAULT_LIMIT);
    });
  });

  describe('REPO_NAME_REGEX', () => {
    it('should match valid repo names', () => {
      expect(REPO_NAME_REGEX.test('my-repo')).toBe(true);
      expect(REPO_NAME_REGEX.test('my_repo')).toBe(true);
      expect(REPO_NAME_REGEX.test('my.repo')).toBe(true);
      expect(REPO_NAME_REGEX.test('repo123')).toBe(true);
    });
    it('should reject path traversal', () => {
      expect(REPO_NAME_REGEX.test('../etc')).toBe(false);
      expect(REPO_NAME_REGEX.test('repo/../../etc')).toBe(false);
    });
    it('should reject special characters', () => {
      expect(REPO_NAME_REGEX.test('repo;rm')).toBe(false);
      expect(REPO_NAME_REGEX.test('repo$(cmd)')).toBe(false);
    });
    it('should reject empty string', () => {
      expect(REPO_NAME_REGEX.test('')).toBe(false);
    });
    it('should reject spaces', () => {
      expect(REPO_NAME_REGEX.test('my repo')).toBe(false);
    });
  });
});

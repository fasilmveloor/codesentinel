import { describe, it, expect } from 'vitest';
import { CONFIG_VALUE_MAX_LENGTH, MASK_MIN_LENGTH } from '@/lib/constants';

/**
 * Replicate the config validation logic from the config API route
 * for isolated unit testing without database dependencies.
 */

const SENSITIVE_KEYS = [
  'github_token',
  'github_app_private_key',
  'gitlab_token',
  'gitlab_webhook_secret',
  'webhook_secret',
  'ai_api_key',
];

const ALLOWED_KEYS = [
  'github_token',
  'webhook_secret',
  'github_app_id',
  'github_app_private_key',
  'gitlab_token',
  'gitlab_host',
  'gitlab_webhook_secret',
  'ai_provider',
  'ai_model',
  'ai_api_key',
  'ai_base_url',
  'ai_temperature',
  'ai_max_steps',
  'block_merge',
];

function maskValue(value: string): string {
  if (value.length <= MASK_MIN_LENGTH) return '--------';
  return value.substring(0, 4) + '----' + value.substring(value.length - 4);
}

function validateConfigKey(key: unknown): boolean {
  return typeof key === 'string' && key.length > 0 && key.length <= 100 && ALLOWED_KEYS.includes(key);
}

function validateConfigValue(value: unknown): boolean {
  return typeof value === 'string' && value.length <= CONFIG_VALUE_MAX_LENGTH;
}

describe('Config API validation', () => {
  describe('maskValue', () => {
    it('should mask sensitive values correctly', () => {
      const masked = maskValue('ghp_1234567890abcdefghijklmnop');
      expect(masked).toBe('ghp_----mnop');
      expect(masked.startsWith('ghp_')).toBe(true);
      expect(masked.endsWith('mnop')).toBe(true);
    });

    it('should return fixed mask for short values', () => {
      expect(maskValue('short')).toBe('--------');
      expect(maskValue('1234567')).toBe('--------');
    });

    it('should return fixed mask for values at MASK_MIN_LENGTH boundary', () => {
      // MASK_MIN_LENGTH is 8, values <= 8 should be fully masked
      expect(maskValue('12345678')).toBe('--------');
    });

    it('should show first 4 and last 4 for values just over threshold', () => {
      // 9 characters: first 4 + ---- + last 4
      expect(maskValue('123456789')).toBe('1234----6789');
    });

    it('should handle long values like private keys', () => {
      const longValue = '-----BEGIN RSA PRIVATE KEY-----\nMIIEpAIBAAKCAQEA...\n-----END RSA PRIVATE KEY-----';
      const masked = maskValue(longValue);
      expect(masked.startsWith('----')).toBe(true);
      expect(masked.endsWith('-----')).toBe(true);
      expect(masked).toContain('----');
    });

    it('should mask empty-ish but over-threshold strings', () => {
      const masked = maskValue('123456789');
      expect(masked).not.toBe('123456789');
      expect(masked).toContain('----');
    });

    it('should preserve exactly 12 characters + ---- for typical token', () => {
      const token = 'ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ1234';
      const masked = maskValue(token);
      // First 4 chars + "----" + last 4 chars
      expect(masked).toBe('ghp_----1234');
    });
  });

  describe('validateConfigKey', () => {
    it('should accept valid config keys', () => {
      for (const key of ALLOWED_KEYS) {
        expect(validateConfigKey(key)).toBe(true);
      }
    });

    it('should reject invalid config keys', () => {
      expect(validateConfigKey('invalid_key')).toBe(false);
      expect(validateConfigKey('admin_password_hash')).toBe(false);
      expect(validateConfigKey('random_setting')).toBe(false);
    });

    it('should reject non-string keys', () => {
      expect(validateConfigKey(123)).toBe(false);
      expect(validateConfigKey(null)).toBe(false);
      expect(validateConfigKey(undefined)).toBe(false);
    });

    it('should reject empty string keys', () => {
      expect(validateConfigKey('')).toBe(false);
    });

    it('should reject keys exceeding max length', () => {
      expect(validateConfigKey('a'.repeat(101))).toBe(false);
    });

    it('should accept keys at max length boundary (100 chars) if in allowed list', () => {
      // This test verifies the boundary check; a 100-char key wouldn't be in the allowed list
      // but the length check itself should pass
      const longKey = 'a'.repeat(100);
      // It passes the length/type check but fails the allowed list check
      expect(validateConfigKey(longKey)).toBe(false);
    });
  });

  describe('validateConfigValue', () => {
    it('should accept valid string values', () => {
      expect(validateConfigValue('some value')).toBe(true);
      expect(validateConfigValue('true')).toBe(true);
    });

    it('should reject values exceeding max length', () => {
      expect(validateConfigValue('a'.repeat(CONFIG_VALUE_MAX_LENGTH + 1))).toBe(false);
    });

    it('should accept values at max length boundary', () => {
      expect(validateConfigValue('a'.repeat(CONFIG_VALUE_MAX_LENGTH))).toBe(true);
    });

    it('should reject non-string values', () => {
      expect(validateConfigValue(123)).toBe(false);
      expect(validateConfigValue(null)).toBe(false);
      expect(validateConfigValue(undefined)).toBe(false);
      expect(validateConfigValue({})).toBe(false);
    });

    it('should accept empty string', () => {
      expect(validateConfigValue('')).toBe(true);
    });
  });

  describe('SENSITIVE_KEYS', () => {
    it('should be a subset of ALLOWED_KEYS', () => {
      for (const key of SENSITIVE_KEYS) {
        expect(ALLOWED_KEYS).toContain(key);
      }
    });

    it('should include all token/secret/key fields', () => {
      expect(SENSITIVE_KEYS).toContain('github_token');
      expect(SENSITIVE_KEYS).toContain('github_app_private_key');
      expect(SENSITIVE_KEYS).toContain('gitlab_token');
      expect(SENSITIVE_KEYS).toContain('gitlab_webhook_secret');
      expect(SENSITIVE_KEYS).toContain('webhook_secret');
      expect(SENSITIVE_KEYS).toContain('ai_api_key');
    });

    it('should not include non-sensitive fields', () => {
      expect(SENSITIVE_KEYS).not.toContain('github_app_id');
      expect(SENSITIVE_KEYS).not.toContain('ai_provider');
      expect(SENSITIVE_KEYS).not.toContain('ai_model');
      expect(SENSITIVE_KEYS).not.toContain('ai_base_url');
      expect(SENSITIVE_KEYS).not.toContain('ai_temperature');
      expect(SENSITIVE_KEYS).not.toContain('ai_max_steps');
      expect(SENSITIVE_KEYS).not.toContain('block_merge');
      expect(SENSITIVE_KEYS).not.toContain('gitlab_host');
    });
  });

  describe('ALLOWED_KEYS completeness', () => {
    it('should contain all expected configuration keys', () => {
      expect(ALLOWED_KEYS).toHaveLength(14);
      expect(ALLOWED_KEYS).toContain('github_token');
      expect(ALLOWED_KEYS).toContain('webhook_secret');
      expect(ALLOWED_KEYS).toContain('github_app_id');
      expect(ALLOWED_KEYS).toContain('github_app_private_key');
      expect(ALLOWED_KEYS).toContain('gitlab_token');
      expect(ALLOWED_KEYS).toContain('gitlab_host');
      expect(ALLOWED_KEYS).toContain('gitlab_webhook_secret');
      expect(ALLOWED_KEYS).toContain('ai_provider');
      expect(ALLOWED_KEYS).toContain('ai_model');
      expect(ALLOWED_KEYS).toContain('ai_api_key');
      expect(ALLOWED_KEYS).toContain('ai_base_url');
      expect(ALLOWED_KEYS).toContain('ai_temperature');
      expect(ALLOWED_KEYS).toContain('ai_max_steps');
      expect(ALLOWED_KEYS).toContain('block_merge');
    });

    it('should not contain keys from a different context', () => {
      expect(ALLOWED_KEYS).not.toContain('admin_password_hash');
      expect(ALLOWED_KEYS).not.toContain('random_key');
    });
  });
});

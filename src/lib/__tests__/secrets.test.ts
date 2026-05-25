import { describe, it, expect } from 'vitest';
import crypto from 'crypto';
import { encrypt, decrypt, maskSecret, isSecretLike } from '@/lib/secrets';

describe('Secret Management', () => {
  function createKey(secret: string, salt: Buffer): Buffer {
    return crypto.pbkdf2Sync(secret, salt, 100000, 32, 'sha256');
  }

  describe('encrypt/decrypt roundtrip', () => {
    it('should encrypt and decrypt correctly', () => {
      const salt = crypto.randomBytes(16);
      const key = createKey('test-encryption-key', salt);
      const plaintext = 'my-super-secret-api-key';
      const encrypted = encrypt(plaintext, key);
      const decrypted = decrypt(encrypted, key);
      expect(decrypted).toBe(plaintext);
    });

    it('should produce different ciphertexts for same plaintext', () => {
      const salt = crypto.randomBytes(16);
      const key = createKey('test-encryption-key', salt);
      const plaintext = 'same-secret';
      const enc1 = encrypt(plaintext, key);
      const enc2 = encrypt(plaintext, key);
      expect(enc1).not.toBe(enc2);
    });

    it('should fail decryption with wrong key', () => {
      const salt = crypto.randomBytes(16);
      const key1 = createKey('correct-key', salt);
      const key2 = createKey('wrong-key', salt);
      const encrypted = encrypt('secret', key1);
      expect(() => decrypt(encrypted, key2)).toThrow();
    });
  });

  describe('maskSecret', () => {
    it('should mask long secrets', () => {
      const result = maskSecret('sk-abc123def456ghi789jkl012mno345');
      expect(result).toContain('sk-a');
      expect(result).toContain('o345');
      expect(result).toContain('*');
    });

    it('should fully mask short secrets', () => {
      const result = maskSecret('short');
      expect(result).toBe('*****');
    });

    it('should mask 8-char secrets fully', () => {
      const result = maskSecret('12345678');
      expect(result).toBe('********');
    });
  });

  describe('isSecretLike', () => {
    it('should detect OpenAI-style API keys', () => {
      expect(isSecretLike('sk-abc123def456ghi789jkl012mno345pqr')).toBe(true);
    });

    it('should detect GitHub PATs', () => {
      expect(isSecretLike('ghp_1234567890abcdefghijklmnopqrstuvwxyz')).toBe(true);
    });

    it('should detect private keys', () => {
      expect(isSecretLike('-----BEGIN RSA PRIVATE KEY-----')).toBe(true);
    });

    it('should not flag normal strings', () => {
      expect(isSecretLike('hello world')).toBe(false);
      expect(isSecretLike('config setting')).toBe(false);
    });
  });
});

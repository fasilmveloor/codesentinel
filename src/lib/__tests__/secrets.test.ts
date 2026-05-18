import { describe, it, expect } from 'vitest';
import crypto from 'crypto';

describe('Secret Management', () => {
  // Replicate AES-256-GCM encrypt/decrypt for testing
  function deriveKey(secret: string, salt: Buffer): Buffer {
    return crypto.pbkdf2Sync(secret, salt, 100000, 32, 'sha256');
  }

  function encrypt(plaintext: string, key: Buffer): string {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
    const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const authTag = cipher.getAuthTag();
    return Buffer.concat([iv, authTag, encrypted]).toString('base64');
  }

  function decrypt(ciphertext: string, key: Buffer): string {
    const data = Buffer.from(ciphertext, 'base64');
    const iv = data.subarray(0, 12);
    const authTag = data.subarray(12, 28);
    const encrypted = data.subarray(28);
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(authTag);
    return decipher.update(encrypted) + decipher.final('utf8');
  }

  function maskSecret(value: string): string {
    if (value.length <= 8) return '*'.repeat(value.length);
    return value.substring(0, 4) + '*'.repeat(value.length - 8) + value.substring(value.length - 4);
  }

  function isSecretLike(value: string): boolean {
    const patterns = [
      /sk-[a-zA-Z0-9]{20,}/,  // OpenAI-style API key
      /ghp_[a-zA-Z0-9]{36}/,  // GitHub PAT
      /gho_[a-zA-Z0-9]{36}/,  // GitHub OAuth
      /glpat-[a-zA-Z0-9\-]{20,}/, // GitLab PAT
      /-----BEGIN (?:RSA )?PRIVATE KEY-----/, // Private key
    ];
    return patterns.some(p => p.test(value));
  }

  describe('encrypt/decrypt roundtrip', () => {
    it('should encrypt and decrypt correctly', () => {
      const salt = crypto.randomBytes(16);
      const key = deriveKey('test-encryption-key', salt);
      const plaintext = 'my-super-secret-api-key';
      const encrypted = encrypt(plaintext, key);
      const decrypted = decrypt(encrypted, key);
      expect(decrypted).toBe(plaintext);
    });

    it('should produce different ciphertexts for same plaintext', () => {
      const salt = crypto.randomBytes(16);
      const key = deriveKey('test-encryption-key', salt);
      const plaintext = 'same-secret';
      const enc1 = encrypt(plaintext, key);
      const enc2 = encrypt(plaintext, key);
      expect(enc1).not.toBe(enc2); // Different IVs
    });

    it('should fail decryption with wrong key', () => {
      const salt = crypto.randomBytes(16);
      const key1 = deriveKey('correct-key', salt);
      const key2 = deriveKey('wrong-key', salt);
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

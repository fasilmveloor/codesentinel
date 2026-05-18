import { describe, it, expect } from 'vitest';
import { validateRepoName, generateJWT } from '../github';

describe('GitHub utilities', () => {
  describe('validateRepoName', () => {
    it('should accept valid owner/repo pairs', () => {
      expect(validateRepoName('my-org', 'my-repo')).toBe(true);
      expect(validateRepoName('user123', 'project.name')).toBe(true);
    });

    it('should reject path traversal', () => {
      expect(validateRepoName('../etc', 'passwd')).toBe(false);
      expect(validateRepoName('org', '../../etc')).toBe(false);
    });

    it('should reject special characters', () => {
      expect(validateRepoName('org', 'repo;rm')).toBe(false);
      expect(validateRepoName('org', 'repo$(whoami)')).toBe(false);
    });
  });

  describe('generateJWT', () => {
    it('should generate a valid JWT structure', () => {
      // We can't fully test JWT without a real private key, but we can test the structure
      const appId = '12345';
      // Generate a test RSA key pair
      const crypto = require('crypto');
      const { privateKey } = crypto.generateKeyPairSync('rsa', {
        modulusLength: 2048,
      });

      const token = generateJWT(appId, privateKey.export({ type: 'pkcs1', format: 'pem' }).toString());
      expect(token).toBeTruthy();
      const parts = token.split('.');
      expect(parts).toHaveLength(3); // header.payload.signature

      // Decode header
      const header = JSON.parse(Buffer.from(parts[0], 'base64url').toString());
      expect(header.alg).toBe('RS256');
      expect(header.typ).toBe('JWT');

      // Decode payload
      const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString());
      expect(payload.iss).toBe(appId);
      expect(payload.iat).toBeLessThan(payload.exp);
    });
  });
});

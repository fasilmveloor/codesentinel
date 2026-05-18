import { describe, it, expect } from 'vitest';
import {
  hashPassword,
  verifyPassword,
  createSession,
  validateSession,
  destroySession,
  createSessionCookie,
  clearSessionCookie,
  getSessionToken,
  SESSION_COOKIE_NAME,
  SESSION_EXPIRY_MS,
} from '../auth';

describe('Auth utilities', () => {
  describe('hashPassword', () => {
    it('should return a string in salt:hash format', async () => {
      const result = await hashPassword('testpassword');
      expect(result).toBeTypeOf('string');
      const parts = result.split(':');
      expect(parts).toHaveLength(2);
      expect(parts[0].length).toBeGreaterThan(0);
      expect(parts[1].length).toBeGreaterThan(0);
    });

    it('should produce different hashes for the same password', async () => {
      const hash1 = await hashPassword('samepassword');
      const hash2 = await hashPassword('samepassword');
      expect(hash1).not.toBe(hash2);
    });
  });

  describe('verifyPassword', () => {
    it('should verify a correct password', async () => {
      const password = 'my-secure-password';
      const hash = await hashPassword(password);
      const result = await verifyPassword(password, hash);
      expect(result).toBe(true);
    });

    it('should reject an incorrect password', async () => {
      const hash = await hashPassword('correct-password');
      const result = await verifyPassword('wrong-password', hash);
      expect(result).toBe(false);
    });

    it('should return false for malformed hash', async () => {
      const result = await verifyPassword('password', 'malformedhash');
      expect(result).toBe(false);
    });

    it('should return false for empty hash', async () => {
      const result = await verifyPassword('password', '');
      expect(result).toBe(false);
    });

    it('should return false for hash with only separator', async () => {
      const result = await verifyPassword('password', ':');
      expect(result).toBe(false);
    });
  });

  describe('Session management', () => {
    it('should create a session token', () => {
      const token = createSession();
      expect(token).toBeTypeOf('string');
      expect(token.length).toBeGreaterThan(0);
    });

    it('should validate a created session', () => {
      const token = createSession();
      expect(validateSession(token)).toBe(true);
    });

    it('should not validate a non-existent session', () => {
      expect(validateSession('nonexistent-token')).toBe(false);
    });

    it('should destroy a session', () => {
      const token = createSession();
      expect(validateSession(token)).toBe(true);
      destroySession(token);
      expect(validateSession(token)).toBe(false);
    });

    it('should not throw when destroying a non-existent session', () => {
      expect(() => destroySession('nonexistent')).not.toThrow();
    });
  });

  describe('Cookie helpers', () => {
    it('should create a session cookie with the correct name', () => {
      const token = 'test-token-123';
      const cookie = createSessionCookie(token);
      expect(cookie).toContain(`${SESSION_COOKIE_NAME}=${token}`);
      expect(cookie).toContain('Path=/');
      expect(cookie).toContain('HttpOnly');
      expect(cookie).toContain('SameSite=Strict');
    });

    it('should create a clear cookie with Max-Age=0', () => {
      const cookie = clearSessionCookie();
      expect(cookie).toContain(`${SESSION_COOKIE_NAME}=`);
      expect(cookie).toContain('Max-Age=0');
      expect(cookie).toContain('Expires=Thu, 01 Jan 1970 00:00:00 GMT');
    });

    it('getSessionToken should extract token from cookie header', () => {
      const token = 'my-session-token';
      const request = new Request('http://localhost', {
        headers: { cookie: `${SESSION_COOKIE_NAME}=${token}` },
      });
      expect(getSessionToken(request)).toBe(token);
    });

    it('getSessionToken should return null when no cookie header', () => {
      const request = new Request('http://localhost');
      expect(getSessionToken(request)).toBeNull();
    });

    it('getSessionToken should handle multiple cookies', () => {
      const token = 'target-token';
      const request = new Request('http://localhost', {
        headers: { cookie: `other=value; ${SESSION_COOKIE_NAME}=${token}; another=cookie` },
      });
      expect(getSessionToken(request)).toBe(token);
    });
  });

  describe('Exported constants', () => {
    it('SESSION_COOKIE_NAME should be a non-empty string', () => {
      expect(SESSION_COOKIE_NAME).toBeTypeOf('string');
      expect(SESSION_COOKIE_NAME.length).toBeGreaterThan(0);
    });

    it('SESSION_EXPIRY_MS should represent 7 days', () => {
      const sevenDays = 7 * 24 * 60 * 60 * 1000;
      expect(SESSION_EXPIRY_MS).toBe(sevenDays);
    });
  });
});

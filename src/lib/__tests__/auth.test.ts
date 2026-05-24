import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  hashPassword,
  verifyPassword,
  createSession,
  validateSession,
  destroySession,
  createSessionCookie,
  clearSessionCookie,
  getSessionToken,
  requireAuth,
  SESSION_COOKIE_NAME,
  SESSION_EXPIRY_MS,
} from '../auth';

// Mock the db module for DB-dependent functions
// Use factory pattern to avoid hoisting issues
vi.mock('@/lib/db', () => ({
  db: {
    appConfig: {
      findUnique: vi.fn(),
      upsert: vi.fn(),
    },
  },
}));

// Import the mocked functions after vi.mock
import { db } from '@/lib/db';
const mockFindUnique = db.appConfig.findUnique as ReturnType<typeof vi.fn>;
const mockUpsert = db.appConfig.upsert as ReturnType<typeof vi.fn>;

describe('Auth utilities', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset the cached JWT secret between tests
    // We need to re-import or use a workaround
  });

  describe('hashPassword', () => {
    it('should return a string in salt:hash format', async () => {
      const result = await hashPassword('testpassword');
      expect(result).toBeTypeOf('string');
      const parts = result.split(':');
      expect(parts).toHaveLength(2);
      expect(parts[0].length).toBeGreaterThan(0); // salt
      expect(parts[1].length).toBeGreaterThan(0); // hash
    });

    it('should produce different hashes for the same password (due to random salt)', async () => {
      const hash1 = await hashPassword('samepassword');
      const hash2 = await hashPassword('samepassword');
      expect(hash1).not.toBe(hash2);
    });

    it('should produce different salts for different calls', async () => {
      const hash1 = await hashPassword('password');
      const hash2 = await hashPassword('password');
      const salt1 = hash1.split(':')[0];
      const salt2 = hash2.split(':')[0];
      expect(salt1).not.toBe(salt2);
    });

    it('should handle empty password', async () => {
      const result = await hashPassword('');
      expect(result).toBeTypeOf('string');
      const parts = result.split(':');
      expect(parts).toHaveLength(2);
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

    it('should return false for malformed hash (no colon)', async () => {
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

    it('should return false for hash with empty salt', async () => {
      const result = await verifyPassword('password', ':somehash');
      expect(result).toBe(false);
    });

    it('should return false for hash with empty derived key', async () => {
      const result = await verifyPassword('password', 'somesalt:');
      expect(result).toBe(false);
    });
  });

  describe('hashPassword + verifyPassword integration', () => {
    it('should work end-to-end for various password strings', async () => {
      const passwords = [
        'simple',
        'with spaces and symbols!@#$%',
        'unicode: 你好世界',
        'a'.repeat(1000), // long password
        'p@ssw0rd!',
      ];

      for (const password of passwords) {
        const hash = await hashPassword(password);
        const isValid = await verifyPassword(password, hash);
        expect(isValid).toBe(true);
      }
    });

    it('should not verify with a hash from a different password', async () => {
      const hash1 = await hashPassword('password1');
      const isValid = await verifyPassword('password2', hash1);
      expect(isValid).toBe(false);
    });
  });

  describe('Session management (JWT-based)', () => {
    it('should create a session token (JWT)', async () => {
      // Mock DB for JWT secret
      mockFindUnique.mockResolvedValueOnce({ key: 'jwt_secret', value: 'test-secret-key-for-testing-minimum-32-chars' });
      const token = await createSession();
      expect(token).toBeTypeOf('string');
      expect(token.length).toBeGreaterThan(0);
      // JWT has 3 parts separated by dots
      expect(token.split('.').length).toBe(3);
    });

    it('should validate a created session', async () => {
      // Use a consistent secret for create + validate
      const secret = 'test-secret-key-for-testing-minimum-32-chars';
      mockFindUnique.mockResolvedValue({ key: 'jwt_secret', value: secret });
      const token = await createSession();
      const isValid = await validateSession(token);
      expect(isValid).toBe(true);
    });

    it('should not validate a non-existent session', async () => {
      mockFindUnique.mockResolvedValue({ key: 'jwt_secret', value: 'test-secret-key-for-testing-minimum-32-chars' });
      expect(await validateSession('nonexistent-token')).toBe(false);
    });

    it('should not validate a tampered token', async () => {
      const secret = 'test-secret-key-for-testing-minimum-32-chars';
      mockFindUnique.mockResolvedValue({ key: 'jwt_secret', value: secret });
      const token = await createSession();
      // Tamper with the token
      const parts = token.split('.');
      const tampered = `${parts[0]}.${Buffer.from(JSON.stringify({ sub: 'hacker', exp: 9999999999 })).toString('base64url')}.${parts[2]}`;
      expect(await validateSession(tampered)).toBe(false);
    });

    it('should destroy a session without error (no-op for JWT)', async () => {
      const secret = 'test-secret-key-for-testing-minimum-32-chars';
      mockFindUnique.mockResolvedValue({ key: 'jwt_secret', value: secret });
      const token = await createSession();
      // destroySession is synchronous for JWT (no-op)
      expect(() => destroySession(token)).not.toThrow();
    });

    it('should not throw when destroying a non-existent session', () => {
      expect(() => destroySession('nonexistent')).not.toThrow();
    });

    it('should create unique tokens for different timestamps', async () => {
      const secret = 'test-secret-key-for-testing-minimum-32-chars';
      mockFindUnique.mockResolvedValue({ key: 'jwt_secret', value: secret });
      const token1 = await createSession();
      // Advance time to ensure different iat
      vi.useFakeTimers();
      vi.advanceTimersByTime(1000);
      const token2 = await createSession();
      vi.useRealTimers();
      // JWTs created at different timestamps will differ
      expect(token1).not.toBe(token2);
    });

    it('should not validate an expired JWT', async () => {
      // We can't easily test expiry without manipulating time,
      // but we can test with a manually crafted expired token
      const secret = 'test-secret-key-for-testing-minimum-32-chars';
      mockFindUnique.mockResolvedValue({ key: 'jwt_secret', value: secret });
      // Create a token that's already expired (exp in the past)
      const crypto = await import('crypto');
      const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
      const payload = Buffer.from(JSON.stringify({ sub: 'admin', iat: 1, exp: 1 })).toString('base64url');
      const signInput = `${header}.${payload}`;
      const signature = crypto.createHmac('sha256', secret).update(signInput).digest('base64url');
      const expiredToken = `${signInput}.${signature}`;
      expect(await validateSession(expiredToken)).toBe(false);
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

    it('should include Max-Age in session cookie', () => {
      const cookie = createSessionCookie('token');
      expect(cookie).toContain('Max-Age=');
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

    it('getSessionToken should return null when session cookie is not present', () => {
      const request = new Request('http://localhost', {
        headers: { cookie: 'other-cookie=value' },
      });
      expect(getSessionToken(request)).toBeNull();
    });

    it('getSessionToken should handle multiple cookies', () => {
      const token = 'target-token';
      const request = new Request('http://localhost', {
        headers: { cookie: `other=value; ${SESSION_COOKIE_NAME}=${token}; another=cookie` },
      });
      expect(getSessionToken(request)).toBe(token);
    });

    it('getSessionToken should handle cookies with spaces around delimiter', () => {
      const token = 'spaced-token';
      const request = new Request('http://localhost', {
        headers: { cookie: `  ${SESSION_COOKIE_NAME}=${token}  ; other=val` },
      });
      expect(getSessionToken(request)).toBe(token);
    });
  });

  describe('requireAuth', () => {
    it('should return 401 response when no session cookie', async () => {
      mockFindUnique.mockResolvedValue({ key: 'jwt_secret', value: 'test-secret-key-for-testing-minimum-32-chars' });
      const request = new Request('http://localhost');
      const result = await requireAuth(request);
      expect(result).not.toBeNull();
      expect(result!.status).toBe(401);
    });

    it('should return 401 response when session token is invalid', async () => {
      mockFindUnique.mockResolvedValue({ key: 'jwt_secret', value: 'test-secret-key-for-testing-minimum-32-chars' });
      const request = new Request('http://localhost', {
        headers: { cookie: `${SESSION_COOKIE_NAME}=invalid-token` },
      });
      const result = await requireAuth(request);
      expect(result).not.toBeNull();
      expect(result!.status).toBe(401);
    });

    it('should return null when session is valid', async () => {
      const secret = 'test-secret-key-for-testing-minimum-32-chars';
      mockFindUnique.mockResolvedValue({ key: 'jwt_secret', value: secret });
      const token = await createSession();
      const request = new Request('http://localhost', {
        headers: { cookie: `${SESSION_COOKIE_NAME}=${token}` },
      });
      const result = await requireAuth(request);
      expect(result).toBeNull();
    });

    it('should return JSON error body', async () => {
      mockFindUnique.mockResolvedValue({ key: 'jwt_secret', value: 'test-secret-key-for-testing-minimum-32-chars' });
      const request = new Request('http://localhost');
      const result = await requireAuth(request);
      const body = await result!.json();
      expect(body).toHaveProperty('error', 'Authentication required');
    });
  });

  describe('Exported constants', () => {
    it('SESSION_COOKIE_NAME should be a non-empty string', () => {
      expect(SESSION_COOKIE_NAME).toBeTypeOf('string');
      expect(SESSION_COOKIE_NAME.length).toBeGreaterThan(0);
    });

    it('SESSION_EXPIRY_MS should be a positive number', () => {
      expect(SESSION_EXPIRY_MS).toBeTypeOf('number');
      expect(SESSION_EXPIRY_MS).toBeGreaterThan(0);
    });

    it('SESSION_EXPIRY_MS should represent 7 days', () => {
      const sevenDays = 7 * 24 * 60 * 60 * 1000;
      expect(SESSION_EXPIRY_MS).toBe(sevenDays);
    });
  });
});

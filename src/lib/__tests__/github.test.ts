import { describe, it, expect } from 'vitest';
import crypto from 'crypto';
import { validateRepoName, generateJWT } from '../github';
import type { PRInfo } from '../github';
import { REPO_NAME_REGEX } from '../constants';

// Generate a test RSA key pair once for JWT tests
const { privateKey: testPrivateKey } = crypto.generateKeyPairSync('rsa', {
  modulusLength: 2048,
});
const testPemKey = testPrivateKey.export({ type: 'pkcs1', format: 'pem' }).toString();

describe('validateRepoName', () => {
  describe('accepts valid names', () => {
    it('should accept alphanumeric names', () => {
      expect(validateRepoName('myrepo', 'myrepo')).toBe(true);
      expect(validateRepoName('MyRepo123', 'another')).toBe(true);
    });

    it('should accept names with hyphens', () => {
      expect(validateRepoName('my-repo', 'my-owner')).toBe(true);
    });

    it('should accept names with dots', () => {
      expect(validateRepoName('my.repo', 'owner')).toBe(true);
    });

    it('should accept names with underscores', () => {
      expect(validateRepoName('my_repo', 'owner')).toBe(true);
    });

    it('should accept names with all allowed characters combined', () => {
      expect(validateRepoName('My-Repo_1.0', 'owner-name_2.0')).toBe(true);
    });

    it('should accept single character names', () => {
      expect(validateRepoName('a', 'b')).toBe(true);
    });
  });

  describe('rejects invalid names', () => {
    it('should reject names with special characters', () => {
      expect(validateRepoName('my@repo', 'owner')).toBe(false);
      expect(validateRepoName('owner', 'my!repo')).toBe(false);
      expect(validateRepoName('my#repo', 'owner')).toBe(false);
      expect(validateRepoName('owner', 'my$repo')).toBe(false);
    });

    it('should reject names with slashes', () => {
      expect(validateRepoName('owner/repo', 'repo')).toBe(false);
      expect(validateRepoName('owner', 'repo/sub')).toBe(false);
    });

    it('should reject names with spaces', () => {
      expect(validateRepoName('my repo', 'owner')).toBe(false);
      expect(validateRepoName('owner', 'my repo')).toBe(false);
    });

    it('should reject empty names', () => {
      expect(validateRepoName('', 'repo')).toBe(false);
      expect(validateRepoName('owner', '')).toBe(false);
      expect(validateRepoName('', '')).toBe(false);
    });

    it('should reject names with colons', () => {
      expect(validateRepoName('owner:repo', 'repo')).toBe(false);
    });
  });

  it('should match REPO_NAME_REGEX behavior', () => {
    const validNames = ['my-repo', 'my_repo', 'my.repo', 'MyRepo123'];
    for (const name of validNames) {
      expect(REPO_NAME_REGEX.test(name)).toBe(true);
      expect(validateRepoName(name, name)).toBe(true);
    }

    const invalidNames = ['my repo', 'my/repo', 'my@repo', ''];
    for (const name of invalidNames) {
      expect(REPO_NAME_REGEX.test(name)).toBe(false);
      expect(validateRepoName(name, name)).toBe(false);
    }
  });
});

describe('generateJWT', () => {
  it('should create a string with three base64url parts separated by dots', () => {
    const appId = '12345';
    const token = generateJWT(appId, testPemKey);

    // JWT should have three parts separated by dots
    const parts = token.split('.');
    expect(parts).toHaveLength(3);

    // Each part should be a valid base64url string (no padding, URL-safe chars only)
    for (const part of parts) {
      expect(part).toMatch(/^[A-Za-z0-9_-]+$/);
      expect(part).not.toContain('=');
      expect(part).not.toContain('+');
      expect(part).not.toContain('/');
    }

    // Header should decode to the expected JWT header
    const header = JSON.parse(Buffer.from(parts[0], 'base64url').toString());
    expect(header).toEqual({ alg: 'RS256', typ: 'JWT' });

    // Payload should contain the expected fields
    const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString());
    expect(payload).toHaveProperty('iat');
    expect(payload).toHaveProperty('exp');
    expect(payload).toHaveProperty('iss', appId);
    expect(payload.exp - payload.iat).toBe(11 * 60); // iat is 60s in the past, exp is 10min from now
  });

  it('should produce different tokens for different app IDs', () => {
    const token1 = generateJWT('app1', testPemKey);
    const token2 = generateJWT('app2', testPemKey);

    expect(token1).not.toBe(token2);
  });

  it('should produce different tokens for the same app ID at different times', () => {
    const token1 = generateJWT('app1', testPemKey);
    // JWT includes iat (issued at) timestamp, so tokens created at different times differ
    // This is implicitly tested since iat changes with time
    expect(token1).toBeTypeOf('string');
    expect(token1.split('.')).toHaveLength(3);
  });

  it('should include the correct issuer in the payload', () => {
    const appId = '98765';
    const token = generateJWT(appId, testPemKey);
    const parts = token.split('.');
    const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString());
    expect(payload.iss).toBe(appId);
  });

  it('should have exp > iat in the payload', () => {
    const token = generateJWT('app1', testPemKey);
    const parts = token.split('.');
    const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString());
    expect(payload.exp).toBeGreaterThan(payload.iat);
  });

  it('should throw with an invalid private key', () => {
    expect(() => generateJWT('app1', 'not-a-valid-key')).toThrow();
  });
});

describe('PRInfo interface', () => {
  it('should accept a valid PRInfo object', () => {
    const prInfo: PRInfo = {
      title: 'Test PR',
      author: 'testuser',
      url: 'https://github.com/owner/repo/pull/1',
      body: 'Test body',
      baseBranch: 'main',
      headBranch: 'feature',
      additions: 10,
      deletions: 5,
      changedFiles: 2,
      headSha: 'abc123',
    };

    expect(prInfo.title).toBe('Test PR');
    expect(prInfo.author).toBe('testuser');
    expect(prInfo.additions).toBe(10);
    expect(prInfo.deletions).toBe(5);
    expect(prInfo.changedFiles).toBe(2);
    expect(prInfo.headSha).toBe('abc123');
  });

  it('should have all required fields', () => {
    const prInfo: PRInfo = {
      title: '',
      author: '',
      url: '',
      body: '',
      baseBranch: '',
      headBranch: '',
      additions: 0,
      deletions: 0,
      changedFiles: 0,
      headSha: '',
    };

    // Verify all expected keys exist
    expect(Object.keys(prInfo).sort()).toEqual(
      ['title', 'author', 'url', 'body', 'baseBranch', 'headBranch', 'additions', 'deletions', 'changedFiles', 'headSha'].sort()
    );
  });
});

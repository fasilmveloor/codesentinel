import { describe, it, expect } from 'vitest';
import crypto from 'crypto';

describe('GitHub webhook signature verification', () => {
  function verifySignature(payload: string, signature: string, secret: string): boolean {
    const expectedSignature = 'sha256=' + crypto.createHmac('sha256', secret).update(payload).digest('hex');
    if (!signature || signature.length !== expectedSignature.length) return false;
    try {
      return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expectedSignature));
    } catch { return false; }
  }

  const secret = 'test-webhook-secret';

  it('should verify a correctly signed payload', () => {
    const payload = '{"action":"opened","pull_request":{"number":1}}';
    const signature = 'sha256=' + crypto.createHmac('sha256', secret).update(payload).digest('hex');
    expect(verifySignature(payload, signature, secret)).toBe(true);
  });

  it('should reject payload with wrong secret', () => {
    const payload = '{"action":"opened"}';
    const wrongSignature = 'sha256=' + crypto.createHmac('sha256', 'wrong-secret').update(payload).digest('hex');
    expect(verifySignature(payload, wrongSignature, secret)).toBe(false);
  });

  it('should reject missing signature', () => {
    expect(verifySignature('{}', '', secret)).toBe(false);
  });

  it('should reject tampered payload', () => {
    const payload = '{"action":"opened"}';
    const signature = 'sha256=' + crypto.createHmac('sha256', secret).update(payload).digest('hex');
    expect(verifySignature('{"action":"closed"}', signature, secret)).toBe(false);
  });
});

describe('Comment command parsing', () => {
  const COMMENT_COMMANDS = ['/review', '/recheck', '/check', '/re-review', '/review again'];

  function parseCommentCommand(body: string): { isCommand: boolean; command: string; args: string } {
    const trimmed = body.trim().toLowerCase();
    for (const cmd of COMMENT_COMMANDS) {
      if (trimmed.startsWith(cmd)) {
        const args = body.trim().substring(cmd.length).trim();
        return { isCommand: true, command: cmd, args };
      }
    }
    return { isCommand: false, command: '', args: '' };
  }

  it('should parse /review command', () => {
    const result = parseCommentCommand('/review');
    expect(result.isCommand).toBe(true);
    expect(result.command).toBe('/review');
    expect(result.args).toBe('');
  });

  it('should parse /review with arguments', () => {
    const result = parseCommentCommand('/review please check the error handling');
    expect(result.isCommand).toBe(true);
    expect(result.command).toBe('/review');
    expect(result.args).toBe('please check the error handling');
  });

  it('should parse /recheck command', () => {
    const result = parseCommentCommand('/recheck');
    expect(result.isCommand).toBe(true);
    expect(result.command).toBe('/recheck');
  });

  it('should parse /re-review command', () => {
    const result = parseCommentCommand('/re-review');
    expect(result.isCommand).toBe(true);
    expect(result.command).toBe('/re-review');
  });

  it('should not match regular comments', () => {
    const result = parseCommentCommand('This looks good to me');
    expect(result.isCommand).toBe(false);
  });

  it('should be case-insensitive for command matching', () => {
    const result = parseCommentCommand('/REVIEW please');
    expect(result.isCommand).toBe(true);
    expect(result.command).toBe('/review');
  });

  it('should handle /check with file argument', () => {
    const result = parseCommentCommand('/check src/auth.ts');
    expect(result.isCommand).toBe(true);
    expect(result.command).toBe('/check');
    expect(result.args).toBe('src/auth.ts');
  });
});

describe('Repository name validation', () => {
  const REPO_NAME_REGEX = /^[a-zA-Z0-9_.-]+$/;

  function validateRepoParams(owner: string, repo: string): boolean {
    return REPO_NAME_REGEX.test(owner) && REPO_NAME_REGEX.test(repo);
  }

  it('should accept valid owner/repo pairs', () => {
    expect(validateRepoParams('my-org', 'my-repo')).toBe(true);
    expect(validateRepoParams('user123', 'project.name')).toBe(true);
    expect(validateRepoParams('org_name', 'repo_name')).toBe(true);
  });

  it('should reject path traversal attempts', () => {
    expect(validateRepoParams('../etc', 'passwd')).toBe(false);
    expect(validateRepoParams('org', '../../etc/passwd')).toBe(false);
  });

  it('should reject names with special characters', () => {
    expect(validateRepoParams('org', 'repo;rm -rf')).toBe(false);
    expect(validateRepoParams('org|malicious', 'repo')).toBe(false);
    expect(validateRepoParams('org', 'repo$(whoami)')).toBe(false);
  });

  it('should reject empty names', () => {
    expect(validateRepoParams('', 'repo')).toBe(false);
    expect(validateRepoParams('org', '')).toBe(false);
  });

  it('should reject names with spaces', () => {
    expect(validateRepoParams('my org', 'repo')).toBe(false);
    expect(validateRepoParams('org', 'my repo')).toBe(false);
  });
});

describe('Severity to annotation level mapping', () => {
  function severityToAnnotationLevel(severity: string): 'notice' | 'warning' | 'failure' {
    if (severity === 'critical' || severity === 'error') return 'failure';
    if (severity === 'warning') return 'warning';
    return 'notice';
  }

  it('should map critical to failure', () => {
    expect(severityToAnnotationLevel('critical')).toBe('failure');
  });
  it('should map error to failure', () => {
    expect(severityToAnnotationLevel('error')).toBe('failure');
  });
  it('should map warning to warning', () => {
    expect(severityToAnnotationLevel('warning')).toBe('warning');
  });
  it('should map info to notice', () => {
    expect(severityToAnnotationLevel('info')).toBe('notice');
  });
  it('should map unknown to notice', () => {
    expect(severityToAnnotationLevel('unknown')).toBe('notice');
  });
});

describe('GitHub review body truncation', () => {
  function truncateForGitHub(text: string, maxLen: number): string {
    if (text.length <= maxLen) return text;
    return text.substring(0, maxLen - 20) + '\n\n... (truncated)';
  }

  it('should not truncate text within limits', () => {
    const text = 'Short review text';
    expect(truncateForGitHub(text, 65536)).toBe(text);
  });

  it('should truncate text exceeding limits', () => {
    const text = 'a'.repeat(70000);
    const result = truncateForGitHub(text, 65536);
    expect(result.length).toBeLessThan(text.length);
    expect(result).toContain('... (truncated)');
  });
});

describe('Check run conclusion mapping with merge blocking', () => {
  it('should map request_changes to failure when merge blocking is enabled', () => {
    const blockMerge = true;
    const conclusionMap: Record<string, 'success' | 'failure' | 'neutral'> = blockMerge
      ? { approve: 'success', request_changes: 'failure', comment: 'neutral' }
      : { approve: 'success', request_changes: 'neutral', comment: 'neutral' };
    expect(conclusionMap['request_changes']).toBe('failure');
  });

  it('should map request_changes to neutral when merge blocking is disabled', () => {
    const blockMerge = false;
    const conclusionMap: Record<string, 'success' | 'failure' | 'neutral'> = blockMerge
      ? { approve: 'success', request_changes: 'failure', comment: 'neutral' }
      : { approve: 'success', request_changes: 'neutral', comment: 'neutral' };
    expect(conclusionMap['request_changes']).toBe('neutral');
  });
});

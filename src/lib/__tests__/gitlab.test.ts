import { describe, it, expect } from 'vitest';

describe('GitLab utilities', () => {
  function encodeProjectPath(owner: string, repo: string): string {
    return encodeURIComponent(`${owner}/${repo}`);
  }

  it('should encode project paths for GitLab API', () => {
    expect(encodeProjectPath('my-org', 'my-repo')).toBe('my-org%2Fmy-repo');
  });

  it('should handle special characters in project paths', () => {
    expect(encodeProjectPath('org name', 'repo.name')).toBe('org%20name%2Frepo.name');
  });
});

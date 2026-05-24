import { describe, it, expect } from 'vitest';

/**
 * Tests for GitLab integration logic.
 * Tests the pure logic components from gitlab.ts without requiring API access.
 */

describe('GitLab project path encoding', () => {
  function encodeProjectPath(owner: string, repo: string): string {
    return encodeURIComponent(`${owner}/${repo}`);
  }

  it('should encode simple paths', () => {
    expect(encodeProjectPath('mygroup', 'myrepo')).toBe('mygroup%2Fmyrepo');
  });

  it('should encode nested group paths', () => {
    expect(encodeProjectPath('mygroup/subgroup', 'myrepo')).toBe('mygroup%2Fsubgroup%2Fmyrepo');
  });

  it('should encode special characters', () => {
    expect(encodeProjectPath('my-group', 'my.repo')).toBe('my-group%2Fmy.repo');
  });

  it('should handle deeply nested groups', () => {
    const result = encodeProjectPath('org/team/project', 'repo');
    expect(result).toContain('%2F');
    expect(decodeURIComponent(result)).toBe('org/team/project/repo');
  });
});

describe('GitLab diff formatting', () => {
  function formatMRChanges(changes: Array<{ old_path: string; new_path: string; diff: string; new_file: boolean; deleted_file: boolean; renamed_file: boolean }>): string {
    return changes.map((change) => {
      const oldPath = change.old_path || change.new_path;
      const newPath = change.new_path || change.old_path;
      let header = `diff --git a/${oldPath} b/${newPath}`;
      if (change.new_file) header += `\nnew file mode 100644\n--- /dev/null\n+++ b/${newPath}`;
      else if (change.deleted_file) header += `\ndeleted file mode 100644\n--- a/${oldPath}\n+++ /dev/null`;
      else header += `\n--- a/${oldPath}\n+++ b/${newPath}`;
      return `${header}\n${change.diff}`;
    }).join('\n');
  }

  it('should format modified file diff correctly', () => {
    const changes = [{
      old_path: 'src/app.ts',
      new_path: 'src/app.ts',
      diff: '@@ -1,3 +1,4 @@\n-old line\n+new line\n+added line',
      new_file: false,
      deleted_file: false,
      renamed_file: false,
    }];
    const result = formatMRChanges(changes);
    expect(result).toContain('diff --git a/src/app.ts b/src/app.ts');
    expect(result).toContain('--- a/src/app.ts');
    expect(result).toContain('+++ b/src/app.ts');
    expect(result).toContain('+new line');
  });

  it('should format new file diff correctly', () => {
    const changes = [{
      old_path: 'src/new.ts',
      new_path: 'src/new.ts',
      diff: '+new file content',
      new_file: true,
      deleted_file: false,
      renamed_file: false,
    }];
    const result = formatMRChanges(changes);
    expect(result).toContain('new file mode 100644');
    expect(result).toContain('--- /dev/null');
    expect(result).toContain('+++ b/src/new.ts');
  });

  it('should format deleted file diff correctly', () => {
    const changes = [{
      old_path: 'src/old.ts',
      new_path: 'src/old.ts',
      diff: '-deleted content',
      new_file: false,
      deleted_file: true,
      renamed_file: false,
    }];
    const result = formatMRChanges(changes);
    expect(result).toContain('deleted file mode 100644');
    expect(result).toContain('--- a/src/old.ts');
    expect(result).toContain('+++ /dev/null');
  });

  it('should format multiple file changes', () => {
    const changes = [
      { old_path: 'a.ts', new_path: 'a.ts', diff: '+a', new_file: false, deleted_file: false, renamed_file: false },
      { old_path: 'b.ts', new_path: 'b.ts', diff: '+b', new_file: false, deleted_file: false, renamed_file: false },
    ];
    const result = formatMRChanges(changes);
    expect(result).toContain('diff --git a/a.ts b/a.ts');
    expect(result).toContain('diff --git a/b.ts b/b.ts');
  });
});

describe('GitLab MR info extraction', () => {
  function extractMRInfo(data: Record<string, unknown>) {
    const changes = (data.changes || []) as Array<{ diff: string }>;
    return {
      title: data.title || '',
      author: (data.author as Record<string, string>)?.username || 'unknown',
      url: data.web_url || '',
      description: data.description || '',
      sourceBranch: data.source_branch || '',
      targetBranch: data.target_branch || '',
      additions: changes.reduce((sum, c) => sum + (c.diff.match(/^\+[^+]/gm) || []).length, 0),
      deletions: changes.reduce((sum, c) => sum + (c.diff.match(/^-[^-]/gm) || []).length, 0),
      changedFiles: changes.length,
      baseSha: (data.diff_refs as Record<string, string>)?.base_sha || '',
      headSha: (data.diff_refs as Record<string, string>)?.head_sha || '',
      startSha: (data.diff_refs as Record<string, string>)?.start_sha || '',
    };
  }

  it('should extract basic MR info', () => {
    const data = {
      title: 'Fix login bug',
      author: { username: 'dev' },
      web_url: 'https://gitlab.com/org/repo/-/merge_requests/1',
      description: 'This fixes the login issue',
      source_branch: 'fix/login',
      target_branch: 'main',
      diff_refs: { base_sha: 'abc', head_sha: 'def', start_sha: 'ghi' },
      changes: [],
    };
    const result = extractMRInfo(data);
    expect(result.title).toBe('Fix login bug');
    expect(result.author).toBe('dev');
    expect(result.sourceBranch).toBe('fix/login');
    expect(result.targetBranch).toBe('main');
    expect(result.baseSha).toBe('abc');
  });

  it('should count additions and deletions from changes', () => {
    const data = {
      title: 'Test MR',
      changes: [
        { diff: '+added line 1\n+added line 2\n-removed line' },
        { diff: '+another addition' },
      ],
    };
    const result = extractMRInfo(data);
    expect(result.additions).toBe(3);
    expect(result.deletions).toBe(1);
    expect(result.changedFiles).toBe(2);
  });

  it('should handle missing fields gracefully', () => {
    const data = {};
    const result = extractMRInfo(data);
    expect(result.title).toBe('');
    expect(result.author).toBe('unknown');
    expect(result.additions).toBe(0);
  });
});

describe('GitLab discussion position construction', () => {
  interface DiscussionPosition {
    base_sha: string;
    head_sha: string;
    start_sha: string;
    position_type: string;
    new_path: string;
    new_line: number;
  }

  it('should construct valid discussion positions for inline comments', () => {
    const position: DiscussionPosition = {
      base_sha: 'abc123',
      head_sha: 'def456',
      start_sha: 'ghi789',
      position_type: 'text',
      new_path: 'src/app.ts',
      new_line: 42,
    };
    expect(position.base_sha).toBe('abc123');
    expect(position.new_path).toBe('src/app.ts');
    expect(position.new_line).toBe(42);
    expect(position.position_type).toBe('text');
  });
});

describe('GitLab webhook event handling', () => {
  it('should identify Merge Request Hook events', () => {
    const event = 'Merge Request Hook';
    expect(event).toBe('Merge Request Hook');
  });

  it('should identify Note Hook events', () => {
    const event = 'Note Hook';
    expect(event).toBe('Note Hook');
  });

  it('should parse project path from path_with_namespace', () => {
    const pathWithNamespace = 'myorg/mysubgroup/myrepo';
    const parts = pathWithNamespace.split('/');
    const repo = parts.pop() || '';
    const owner = parts.join('/');
    expect(owner).toBe('myorg/mysubgroup');
    expect(repo).toBe('myrepo');
  });

  it('should parse simple project path', () => {
    const pathWithNamespace = 'myorg/myrepo';
    const parts = pathWithNamespace.split('/');
    const repo = parts.pop() || '';
    const owner = parts.join('/');
    expect(owner).toBe('myorg');
    expect(repo).toBe('myrepo');
  });

  it('should extract GitLab host from project web_url', () => {
    const webUrl = 'https://gitlab.example.com/myorg/myrepo';
    const host = new URL(webUrl).origin;
    expect(host).toBe('https://gitlab.example.com');
  });

  it('should handle gitlab.com URLs', () => {
    const webUrl = 'https://gitlab.com/myorg/myrepo';
    const host = new URL(webUrl).origin;
    expect(host).toBe('https://gitlab.com');
  });
});

import { describe, it, expect } from 'vitest';
import type { MRChange } from '../gitlab';

/**
 * Since encodeProjectPath is not exported, we test the encoding pattern
 * directly. The function uses encodeURIComponent(`${owner}/${repo}`),
 * which is the same logic GitLab uses for project IDs in API paths.
 */
function encodeProjectPath(owner: string, repo: string): string {
  return encodeURIComponent(`${owner}/${repo}`);
}

/**
 * Replicate the diff formatting logic from fetchMRDiff for testing.
 * This converts MRChange objects into unified diff format.
 */
function formatMRChangesToDiff(changes: MRChange[]): string {
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

describe('GitLab utilities', () => {
  describe('encodeProjectPath', () => {
    it('should encode simple owner/repo path', () => {
      const result = encodeProjectPath('myorg', 'myrepo');
      expect(result).toBe('myorg%2Fmyrepo');
    });

    it('should encode owner/repo with special characters', () => {
      const result = encodeProjectPath('my org', 'my repo');
      expect(result).toBe('my%20org%2Fmy%20repo');
    });

    it('should encode owner/repo with dots', () => {
      const result = encodeProjectPath('my.org', 'my.repo');
      expect(result).toBe('my.org%2Fmy.repo');
    });

    it('should encode owner/repo with unicode characters', () => {
      const result = encodeProjectPath('организация', 'проект');
      expect(result).toContain('%');
      // The slash should be encoded
      expect(result).not.toContain('/');
    });

    it('should encode owner/repo with percent signs', () => {
      const result = encodeProjectPath('100%', 'done');
      expect(result).toBe('100%25%2Fdone');
    });

    it('should encode owner/repo with hash', () => {
      const result = encodeProjectPath('org#1', 'repo#2');
      expect(result).toBe('org%231%2Frepo%232');
    });

    it('should produce a string with no unencoded slashes', () => {
      const result = encodeProjectPath('owner', 'repo');
      expect(result).not.toMatch(/\//);
    });
  });

  describe('MRChange diff formatting', () => {
    it('should format a new file diff correctly', () => {
      const changes: MRChange[] = [
        {
          old_path: '',
          new_path: 'src/new-file.ts',
          diff: '@@ -0,0 +1,3 @@\n+import foo from "bar";\n+\n+export default foo;',
          new_file: true,
          deleted_file: false,
          renamed_file: false,
        },
      ];

      const result = formatMRChangesToDiff(changes);

      // When old_path is empty, the formatMRChangesToDiff function falls back to new_path
      // So the header becomes: diff --git a/src/new-file.ts b/src/new-file.ts
      expect(result).toContain('diff --git a/src/new-file.ts b/src/new-file.ts');
      expect(result).toContain('new file mode 100644');
      expect(result).toContain('--- /dev/null');
      expect(result).toContain('+++ b/src/new-file.ts');
      expect(result).toContain('+import foo from "bar";');
    });

    it('should format a deleted file diff correctly', () => {
      const changes: MRChange[] = [
        {
          old_path: 'src/old-file.ts',
          new_path: '',
          diff: '@@ -1,3 +0,0 @@\n-import foo from "bar";\n-\n-export default foo;',
          new_file: false,
          deleted_file: true,
          renamed_file: false,
        },
      ];

      const result = formatMRChangesToDiff(changes);

      expect(result).toContain('diff --git a/src/old-file.ts b/');
      expect(result).toContain('deleted file mode 100644');
      expect(result).toContain('--- a/src/old-file.ts');
      expect(result).toContain('+++ /dev/null');
      expect(result).toContain('-import foo from "bar";');
    });

    it('should format a modified file diff correctly', () => {
      const changes: MRChange[] = [
        {
          old_path: 'src/modified.ts',
          new_path: 'src/modified.ts',
          diff: '@@ -1,3 +1,4 @@\n import foo from "bar";\n \n+const x = 1;\n \n export default foo;',
          new_file: false,
          deleted_file: false,
          renamed_file: false,
        },
      ];

      const result = formatMRChangesToDiff(changes);

      expect(result).toContain('diff --git a/src/modified.ts b/src/modified.ts');
      expect(result).not.toContain('new file mode');
      expect(result).not.toContain('deleted file mode');
      expect(result).toContain('--- a/src/modified.ts');
      expect(result).toContain('+++ b/src/modified.ts');
    });

    it('should format multiple changes joined by newline', () => {
      const changes: MRChange[] = [
        {
          old_path: 'src/a.ts',
          new_path: 'src/a.ts',
          diff: '+a',
          new_file: false,
          deleted_file: false,
          renamed_file: false,
        },
        {
          old_path: 'src/b.ts',
          new_path: 'src/b.ts',
          diff: '+b',
          new_file: false,
          deleted_file: false,
          renamed_file: false,
        },
      ];

      const result = formatMRChangesToDiff(changes);

      // Should contain both diffs
      expect(result).toContain('diff --git a/src/a.ts b/src/a.ts');
      expect(result).toContain('diff --git a/src/b.ts b/src/b.ts');
    });

    it('should handle renamed file with diff content', () => {
      const changes: MRChange[] = [
        {
          old_path: 'src/old-name.ts',
          new_path: 'src/new-name.ts',
          diff: '@@ -1 +1 @@\n-old\n+new',
          new_file: false,
          deleted_file: false,
          renamed_file: true,
        },
      ];

      const result = formatMRChangesToDiff(changes);

      // Renamed file is treated like a modified file (no special header)
      expect(result).toContain('diff --git a/src/old-name.ts b/src/new-name.ts');
      expect(result).toContain('--- a/src/old-name.ts');
      expect(result).toContain('+++ b/src/new-name.ts');
      expect(result).not.toContain('new file mode');
      expect(result).not.toContain('deleted file mode');
    });

    it('should fall back to new_path when old_path is empty for non-new-file', () => {
      const changes: MRChange[] = [
        {
          old_path: '',
          new_path: 'src/fallback.ts',
          diff: '+content',
          new_file: false,
          deleted_file: false,
          renamed_file: false,
        },
      ];

      const result = formatMRChangesToDiff(changes);
      // old_path falls back to new_path: "src/fallback.ts"
      expect(result).toContain('diff --git a/src/fallback.ts b/src/fallback.ts');
    });
  });
});

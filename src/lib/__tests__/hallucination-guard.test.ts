import { describe, it, expect } from 'vitest';
import {
  extractDiffLineRanges,
  validateReviewAgainstDiff,
  HunkRange,
  DiffFileRange,
} from '@/lib/reviewer';

// --- Hallucination Guard Integration Tests ---
// Tests the diff line range extraction and comment validation against actual diffs
// with hunk-level precision for line number validation

const SAMPLE_DIFF = `diff --git a/src/lib/auth.ts b/src/lib/auth.ts
index abc1234..def5678 100644
--- a/src/lib/auth.ts
+++ b/src/lib/auth.ts
@@ -10,6 +10,10 @@ import { db } from './db';
 const SESSION_SECRET = process.env.SESSION_SECRET || 'default-secret';
 const SESSION_MAX_AGE = 24 * 60 * 60;
 
+// New authentication middleware
+export function validateSession(token: string): boolean {
+  return token.length > 0;
+}
+
 export async function hashPassword(password: string): Promise<string> {
   return bcrypt.hash(password, 12);
 }
diff --git a/src/lib/rate-limit.ts b/src/lib/rate-limit.ts
index 1111111..2222222 100644
--- a/src/lib/rate-limit.ts
+++ b/src/lib/rate-limit.ts
@@ -5,6 +5,8 @@ import { RATE_LIMIT_WINDOW, RATE_LIMIT_MAX } from './constants';
 export async function checkRateLimit(ip: string): Promise<boolean> {
   const key = \`rate_limit:\${ip}\`;
+  // Added cleanup trigger
+  const now = Date.now();
   const now2 = Date.now();
`;

// Diff with multiple hunks in the same file — tests gap detection
const MULTI_HUNK_DIFF = `diff --git a/src/lib/auth.ts b/src/lib/auth.ts
index abc1234..def5678 100644
--- a/src/lib/auth.ts
+++ b/src/lib/auth.ts
@@ -5,6 +5,10 @@ import { db } from './db';
 const A = 1;
 const B = 2;
 
+// First change block
+export function newFunc1() {
+  return true;
+}
+
 const C = 3;
 const D = 4;
@@ -50,6 +54,10 @@ export async function oldFunc() {
 const E = 5;
 const F = 6;
 
+// Second change block
+export function newFunc2() {
+  return false;
+}
+
 const G = 7;
`;

// Diff with a new file (no context lines)
const NEW_FILE_DIFF = `diff --git a/src/new-module.ts b/src/new-module.ts
new file mode 100644
index 0000000..aaa1111
--- /dev/null
+++ b/src/new-module.ts
@@ -0,0 +1,5 @@
+export function hello() {
+  return 'world';
+}
+
+export const VERSION = '1.0.0';
`;

describe('Hallucination Guard — extractDiffLineRanges', () => {
  it('should extract correct line ranges from a unified diff', () => {
    const ranges = extractDiffLineRanges(SAMPLE_DIFF);

    // Should have 2 files
    expect(ranges.size).toBe(2);

    // Check auth.ts
    const authRange = ranges.get('src/lib/auth.ts');
    expect(authRange).toBeDefined();
    expect(authRange!.addedLines.size).toBeGreaterThan(0);

    // Check rate-limit.ts
    const rateLimitRange = ranges.get('src/lib/rate-limit.ts');
    expect(rateLimitRange).toBeDefined();
    expect(rateLimitRange!.addedLines.size).toBeGreaterThan(0);
  });

  it('should handle empty diff gracefully', () => {
    const ranges = extractDiffLineRanges('');
    expect(ranges.size).toBe(0);
  });

  it('should track added lines correctly', () => {
    const ranges = extractDiffLineRanges(SAMPLE_DIFF);
    const authRange = ranges.get('src/lib/auth.ts');
    expect(authRange).toBeDefined();
    // The auth.ts diff has added lines for the new function
    expect(authRange!.addedLines.size).toBeGreaterThanOrEqual(4);
    // Verify specific added lines are tracked
    expect(authRange!.addedLines.has(13)).toBe(true);
    expect(authRange!.addedLines.has(14)).toBe(true);
    expect(authRange!.addedLines.has(15)).toBe(true);
    expect(authRange!.addedLines.has(16)).toBe(true);
  });

  it('should handle diff with multiple hunks in the same file', () => {
    const ranges = extractDiffLineRanges(MULTI_HUNK_DIFF);
    const authRange = ranges.get('src/lib/auth.ts');
    expect(authRange).toBeDefined();
    expect(authRange!.hunks.length).toBe(2);

    // First hunk starts at line 5
    expect(authRange!.hunks[0].startLine).toBe(5);
    // Second hunk starts at line 54
    expect(authRange!.hunks[1].startLine).toBe(54);

    // Should have added lines in both hunks
    expect(authRange!.addedLines.size).toBeGreaterThanOrEqual(8);
  });

  it('should extract hunk ranges for new files', () => {
    const ranges = extractDiffLineRanges(NEW_FILE_DIFF);
    const newModuleRange = ranges.get('src/new-module.ts');
    expect(newModuleRange).toBeDefined();
    expect(newModuleRange!.hunks.length).toBe(1);
    expect(newModuleRange!.addedLines.size).toBe(5);
  });

  it('should track hunk start and end lines correctly', () => {
    const ranges = extractDiffLineRanges(MULTI_HUNK_DIFF);
    const authRange = ranges.get('src/lib/auth.ts');
    expect(authRange).toBeDefined();

    // First hunk: @@ -5,6 +5,10 @@ means new starts at line 5, count is 10
    const firstHunk = authRange!.hunks[0];
    expect(firstHunk.startLine).toBe(5);

    // Second hunk: @@ -50,6 +54,10 @@ means new starts at line 54, count is 10
    const secondHunk = authRange!.hunks[1];
    expect(secondHunk.startLine).toBe(54);
  });
});

describe('Hallucination Guard — validateReviewAgainstDiff', () => {
  it('should validate comments with correct file paths and line numbers', () => {
    const ranges = extractDiffLineRanges(SAMPLE_DIFF);

    const parsed = {
      overallScore: 'request_changes',
      summary: 'Found issues',
      comments: [
        {
          filePath: 'src/lib/auth.ts',
          line: 13,
          side: 'RIGHT',
          body: 'Insecure validation',
          severity: 'error',
        },
      ],
    };

    const result = validateReviewAgainstDiff(parsed, ranges);
    expect(result.filteredComments.length).toBe(0);
    expect(result.validComments.length).toBe(1);
  });

  it('should filter comments with file paths not in the diff', () => {
    const ranges = extractDiffLineRanges(SAMPLE_DIFF);

    const parsed = {
      overallScore: 'comment',
      summary: 'Some feedback',
      comments: [
        {
          filePath: 'src/nonexistent/file.ts',
          line: 10,
          body: 'This file does not exist in the diff',
          severity: 'info',
        },
      ],
    };

    const result = validateReviewAgainstDiff(parsed, ranges);
    expect(result.filteredComments.length).toBe(1);
    expect(result.warnings.length).toBeGreaterThan(0);
    expect(result.warnings[0]).toContain('not found in diff');
  });

  it('should remove line numbers that exceed diff range (hallucinated lines)', () => {
    const ranges = extractDiffLineRanges(SAMPLE_DIFF);

    const parsed = {
      overallScore: 'comment',
      summary: 'Some feedback',
      comments: [
        {
          filePath: 'src/lib/auth.ts',
          line: 99999, // Way beyond the file's diff range
          body: 'This line does not exist',
          severity: 'info',
        },
      ],
    };

    const result = validateReviewAgainstDiff(parsed, ranges);
    expect(result.warnings.length).toBeGreaterThan(0);
    expect(result.warnings.some(w => w.includes('exceeds diff range') || w.includes('hallucination'))).toBe(true);
    // Line should have been removed
    expect(result.validComments[0]?.line).toBeNull();
  });

  it('should reject line numbers in the gap between hunks', () => {
    const ranges = extractDiffLineRanges(MULTI_HUNK_DIFF);

    // Line 30 is between hunk 1 (lines ~5-14) and hunk 2 (lines ~54-64)
    // It's within the file but NOT in any hunk
    const parsed = {
      overallScore: 'comment',
      summary: 'Feedback',
      comments: [
        {
          filePath: 'src/lib/auth.ts',
          line: 30, // Between the two hunks — should be flagged
          body: 'This line is in the gap between hunks',
          severity: 'info',
        },
      ],
    };

    const result = validateReviewAgainstDiff(parsed, ranges);
    expect(result.warnings.some(w => w.includes('between diff hunks'))).toBe(true);
    expect(result.validComments[0]?.line).toBeNull();
  });

  it('should allow line numbers within a hunk with context tolerance', () => {
    const ranges = extractDiffLineRanges(MULTI_HUNK_DIFF);

    // Line 7 is within the first hunk (starts at 5)
    const parsed = {
      overallScore: 'comment',
      summary: 'Feedback',
      comments: [
        {
          filePath: 'src/lib/auth.ts',
          line: 7, // Within first hunk
          body: 'Context line near added code',
          severity: 'info',
        },
      ],
    };

    const result = validateReviewAgainstDiff(parsed, ranges);
    expect(result.filteredComments.length).toBe(0);
    expect(result.validComments.length).toBe(1);
    expect(result.validComments[0]?.line).toBe(7);
  });

  it('should allow line numbers ±2 from hunk boundaries (context tolerance)', () => {
    const ranges = extractDiffLineRanges(MULTI_HUNK_DIFF);
    const authRange = ranges.get('src/lib/auth.ts');
    expect(authRange).toBeDefined();

    // Test line just before the first hunk start (startLine - 2 should be allowed)
    const firstHunkStart = authRange!.hunks[0].startLine;
    const parsed = {
      overallScore: 'comment',
      summary: 'Feedback',
      comments: [
        {
          filePath: 'src/lib/auth.ts',
          line: firstHunkStart - 2, // Within context tolerance
          body: 'Line just before the hunk',
          severity: 'info',
        },
      ],
    };

    const result = validateReviewAgainstDiff(parsed, ranges);
    expect(result.filteredComments.length).toBe(0);
    expect(result.validComments[0]?.line).toBe(firstHunkStart - 2);
  });

  it('should reject line numbers more than ±2 from any hunk', () => {
    const ranges = extractDiffLineRanges(MULTI_HUNK_DIFF);
    const authRange = ranges.get('src/lib/auth.ts');
    expect(authRange).toBeDefined();

    // Test line 3 above the first hunk (start is 5, so 5-3=2, line 2 is more than 2 away)
    const parsed = {
      overallScore: 'comment',
      summary: 'Feedback',
      comments: [
        {
          filePath: 'src/lib/auth.ts',
          line: 1, // Before the diff range
          body: 'Line before the first hunk',
          severity: 'info',
        },
      ],
    };

    const result = validateReviewAgainstDiff(parsed, ranges);
    expect(result.warnings.some(w => w.includes('before the diff range') || w.includes('hallucination'))).toBe(true);
    expect(result.validComments[0]?.line).toBeNull();
  });

  it('should normalize fuzzy file path matches', () => {
    const ranges = extractDiffLineRanges(SAMPLE_DIFF);

    const parsed = {
      overallScore: 'comment',
      summary: 'Feedback',
      comments: [
        {
          filePath: 'auth.ts', // Partial path — should match src/lib/auth.ts
          line: null,
          body: 'Good changes',
          severity: 'info',
        },
      ],
    };

    const result = validateReviewAgainstDiff(parsed, ranges);
    expect(result.filteredComments.length).toBe(0);
    // Should be normalized to the full path
    expect(result.validComments[0]?.filePath).toBe('src/lib/auth.ts');
  });

  it('should reject invalid severity values', () => {
    const ranges = extractDiffLineRanges(SAMPLE_DIFF);

    const parsed = {
      overallScore: 'comment',
      summary: 'Feedback',
      comments: [
        {
          filePath: 'src/lib/auth.ts',
          line: null,
          body: 'Test',
          severity: 'super_critical', // Invalid
        },
      ],
    };

    const result = validateReviewAgainstDiff(parsed, ranges);
    expect(result.warnings.some(w => w.includes('Invalid severity'))).toBe(true);
    expect(result.validComments[0]?.severity).toBe('info');
  });

  it('should reject invalid overallScore values', () => {
    const ranges = extractDiffLineRanges(SAMPLE_DIFF);

    const parsed = {
      overallScore: 'block_merge', // Invalid
      summary: 'Feedback',
      comments: [],
    };

    const result = validateReviewAgainstDiff(parsed, ranges);
    expect(result.warnings.some(w => w.includes('Invalid overallScore'))).toBe(true);
    expect(parsed.overallScore).toBe('comment');
  });

  it('should keep all comments (without lines) if every comment fails validation', () => {
    const ranges = extractDiffLineRanges(SAMPLE_DIFF);

    const parsed = {
      overallScore: 'comment',
      summary: 'Review',
      comments: [
        { filePath: 'totally/fake/file1.ts', line: 1, body: 'Issue 1', severity: 'info' },
        { filePath: 'totally/fake/file2.ts', line: 2, body: 'Issue 2', severity: 'info' },
      ],
    };

    const result = validateReviewAgainstDiff(parsed, ranges);
    // All comments were filtered but should be kept without line numbers
    expect(result.warnings.some(w => w.includes('failed hallucination validation'))).toBe(true);
    expect(result.validComments.length).toBe(2);
    // Lines should be stripped
    expect(result.validComments.every(c => c.line === null)).toBe(true);
  });

  it('should allow comments on context lines near the diff', () => {
    const ranges = extractDiffLineRanges(SAMPLE_DIFF);

    const parsed = {
      overallScore: 'comment',
      summary: 'Feedback',
      comments: [
        {
          filePath: 'src/lib/auth.ts',
          line: 11, // Context line near the added lines (13-16)
          body: 'Consider improving this constant',
          severity: 'info',
        },
      ],
    };

    const result = validateReviewAgainstDiff(parsed, ranges);
    // Context lines should be allowed (not filtered)
    expect(result.filteredComments.length).toBe(0);
    expect(result.validComments.length).toBe(1);
    expect(result.validComments[0]?.line).toBe(11);
  });

  it('should handle zero or negative line numbers', () => {
    const ranges = extractDiffLineRanges(SAMPLE_DIFF);

    const parsed = {
      overallScore: 'comment',
      summary: 'Feedback',
      comments: [
        {
          filePath: 'src/lib/auth.ts',
          line: 0,
          body: 'Invalid line',
          severity: 'info',
        },
      ],
    };

    const result = validateReviewAgainstDiff(parsed, ranges);
    expect(result.warnings.some(w => w.includes('invalid') || w.includes('positive'))).toBe(true);
    expect(result.validComments[0]?.line).toBeNull();
  });

  it('should validate lines for new files correctly', () => {
    const ranges = extractDiffLineRanges(NEW_FILE_DIFF);

    // New file: lines 1-5 are all added
    const parsed = {
      overallScore: 'comment',
      summary: 'Feedback',
      comments: [
        {
          filePath: 'src/new-module.ts',
          line: 1,
          body: 'First line of new file',
          severity: 'info',
        },
        {
          filePath: 'src/new-module.ts',
          line: 3,
          body: 'Return statement',
          severity: 'info',
        },
      ],
    };

    const result = validateReviewAgainstDiff(parsed, ranges);
    expect(result.filteredComments.length).toBe(0);
    expect(result.validComments.length).toBe(2);
  });

  it('should flag hallucinated lines in new files', () => {
    const ranges = extractDiffLineRanges(NEW_FILE_DIFF);

    const parsed = {
      overallScore: 'comment',
      summary: 'Feedback',
      comments: [
        {
          filePath: 'src/new-module.ts',
          line: 100, // New file only has 5 lines
          body: 'This line does not exist',
          severity: 'info',
        },
      ],
    };

    const result = validateReviewAgainstDiff(parsed, ranges);
    expect(result.warnings.length).toBeGreaterThan(0);
    expect(result.validComments[0]?.line).toBeNull();
  });
});

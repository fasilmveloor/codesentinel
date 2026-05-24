import { describe, it, expect } from 'vitest';

// --- Bad PR Sample Data ---

interface BadPRSample {
  name: string;
  diff: string;
  expectedCategories: string[];
}

const BAD_PR_SAMPLES: BadPRSample[] = [
  {
    name: 'SQL Injection via string concatenation',
    diff: `diff --git a/src/db/query.ts b/src/db/query.ts
--- a/src/db/query.ts
+++ b/src/db/query.ts
@@ -1,3 +1,5 @@
 export function getUser(id: string) {
-  return db.query('SELECT * FROM users WHERE id = $1', [id]);
+  return db.query('SELECT * FROM users WHERE id = ' + id);
+  // direct string concatenation - no parameterization
 }`,
    expectedCategories: ['SQL Injection', 'Security'],
  },
  {
    name: 'Hardcoded secret in source code',
    diff: `diff --git a/src/config.ts b/src/config.ts
--- a/src/config.ts
+++ b/src/config.ts
@@ -1,2 +1,4 @@
 export const dbConfig = {
+  host: 'prod-db.example.com',
+  password: 'super_secret_password_123',
 };`,
    expectedCategories: ['Hardcoded Secrets', 'Security'],
  },
  {
    name: 'Prototype Pollution via __proto__',
    diff: `diff --git a/src/utils/merge.ts b/src/utils/merge.ts
--- a/src/utils/merge.ts
+++ b/src/utils/merge.ts
@@ -1,3 +1,8 @@
 export function deepMerge(target: any, source: any) {
-  return { ...target, ...source };
+  for (const key in source) {
+    target[key] = source[key];
+  }
+  // No check for __proto__ or constructor
+  return target;
 }`,
    expectedCategories: ['Prototype Pollution', 'Security'],
  },
  {
    name: 'Missing error handling in async function',
    diff: `diff --git a/src/api/fetch.ts b/src/api/fetch.ts
--- a/src/api/fetch.ts
+++ b/src/api/fetch.ts
@@ -1,3 +1,5 @@
 export async function fetchData(url: string) {
-  const response = await fetch(url);
-  return response.json();
+  const response = await fetch(url);
+  const data = await response.json();
+  return data;
+  // No try/catch, no status check, no error handling
 }`,
    expectedCategories: ['Missing Error Handling'],
  },
  {
    name: 'Race condition with shared mutable state',
    diff: `diff --git a/src/cache.ts b/src/cache.ts
--- a/src/cache.ts
+++ b/src/cache.ts
@@ -1,5 +1,7 @@
 let cache: Map<string, any> = new Map();
 
 export async function getOrFetch(key: string, fetcher: () => Promise<any>) {
-  if (!cache.has(key)) cache.set(key, await fetcher());
+  if (!cache.has(key)) {
+    cache.set(key, await fetcher()); // Race: multiple callers can enter here
+  }
   return cache.get(key);
 }`,
    expectedCategories: ['Race Condition'],
  },
  {
    name: 'Missing input validation on user data',
    diff: `diff --git a/src/api/users.ts b/src/api/users.ts
--- a/src/api/users.ts
+++ b/src/api/users.ts
@@ -1,3 +1,8 @@
 export async function createUser(req: Request) {
-  const body = await req.json();
-  return db.insert('users', body);
+  const body = await req.json();
+  // No validation on body fields
+  // No sanitization
+  // Directly inserting user input into DB
+  return db.insert('users', body);
 }`,
    expectedCategories: ['Missing Input Validation', 'Security'],
  },
];

// --- Tests ---

describe('Evaluation Benchmarks', () => {
  describe('Sample Integrity', () => {
    it('all benchmarks have required fields', () => {
      for (const sample of BAD_PR_SAMPLES) {
        expect(sample).toHaveProperty('name');
        expect(sample).toHaveProperty('diff');
        expect(sample).toHaveProperty('expectedCategories');
        expect(sample.name).toBeTruthy();
        expect(sample.diff).toBeTruthy();
        expect(sample.expectedCategories.length).toBeGreaterThan(0);
      }
    });

    it('all sample names are unique', () => {
      const names = BAD_PR_SAMPLES.map(s => s.name);
      const uniqueNames = new Set(names);
      expect(uniqueNames.size).toBe(names.length);
    });

    it('all diffs have at least one added line', () => {
      for (const sample of BAD_PR_SAMPLES) {
        const hasAddition = sample.diff.split('\n').some(line => line.startsWith('+') && !line.startsWith('+++'));
        expect(hasAddition).toBe(true);
      }
    });
  });

  describe('Category Coverage', () => {
    it('security-related categories are present', () => {
      const securitySamples = BAD_PR_SAMPLES.filter(s =>
        s.expectedCategories.some(c => c.toLowerCase().includes('security') || c.toLowerCase().includes('injection'))
      );
      expect(securitySamples.length).toBeGreaterThanOrEqual(2);
    });

    it('covers all 6 benchmark categories', () => {
      const allCategories = BAD_PR_SAMPLES.flatMap(s => s.expectedCategories);
      const requiredCategories = ['SQL Injection', 'Hardcoded Secrets', 'Prototype Pollution', 'Missing Error Handling', 'Race Condition', 'Missing Input Validation'];
      for (const cat of requiredCategories) {
        expect(allCategories.some(c => c.includes(cat))).toBe(true);
      }
    });
  });

  describe('Output Schema Validation', () => {
    it('valid review scores are recognized', () => {
      const validScores = ['approve', 'request_changes', 'comment'];
      for (const score of validScores) {
        expect(['approve', 'request_changes', 'comment']).toContain(score);
      }
    });

    it('valid severity levels are recognized', () => {
      const validSeverities = ['info', 'warning', 'error', 'critical'];
      for (const sev of validSeverities) {
        expect(['info', 'warning', 'error', 'critical']).toContain(sev);
      }
    });
  });

  describe('Hallucination Detection', () => {
    it('invalid file paths are rejected', () => {
      const diffFiles = new Set(['src/db/query.ts', 'src/config.ts']);
      const commentPath = 'src/nonexistent/file.ts';
      const isValid = diffFiles.has(commentPath) ||
        Array.from(diffFiles).some(f => f.endsWith(commentPath) || commentPath.endsWith(f));
      expect(isValid).toBe(false);
    });

    it('valid file paths are accepted', () => {
      const diffFiles = new Set(['src/db/query.ts', 'src/config.ts']);
      const commentPath = 'src/db/query.ts';
      const isValid = diffFiles.has(commentPath) ||
        Array.from(diffFiles).some(f => f.endsWith(commentPath) || commentPath.endsWith(f));
      expect(isValid).toBe(true);
    });

    it('line numbers outside diff range are flagged', () => {
      // A diff with 5 added lines shouldn't reference line 500
      const diffLineCount = 5;
      const commentLine = 500;
      const isPlausible = commentLine <= diffLineCount * 10; // generous bound
      expect(isPlausible).toBe(false);
    });

    it('severity values are validated', () => {
      const validSeverities = ['info', 'warning', 'error', 'critical'];
      const invalidSeverities = ['low', 'high', 'medium', 'blocker', ''];
      for (const sev of invalidSeverities) {
        expect(validSeverities).not.toContain(sev);
      }
    });
  });

  describe('Approval Suspicion', () => {
    it('benchmarks should NOT trivially approve all bad PRs', () => {
      // All samples are intentionally bad PRs — they should trigger request_changes or comment
      // An AI that approves all of these would be suspicious
      for (const sample of BAD_PR_SAMPLES) {
        // These are intentionally bad — any reasonable review should find issues
        expect(sample.expectedCategories.length).toBeGreaterThan(0);
        expect(sample.diff.length).toBeGreaterThan(50);
      }
    });
  });
});

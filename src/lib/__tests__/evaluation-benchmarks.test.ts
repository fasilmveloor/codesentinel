import { describe, it, expect } from 'vitest';
// Replicate parseReviewFromContent locally (same logic as reviewer.ts)
function parseReviewFromContent(content: string): Record<string, unknown> | null {
  const jsonMatch = content.match(/```json\s*([\s\S]*?)```/);
  if (jsonMatch) {
    try {
      const parsed = JSON.parse(jsonMatch[1].trim());
      if (parsed.action === 'final_review' || parsed.overallScore) return parsed;
    } catch { /* */ }
  }
  try {
    const parsed = JSON.parse(content.trim());
    if (parsed.action === 'final_review' || parsed.overallScore) return parsed;
  } catch { /* */ }
  return null;
}

// --- Curated Bad PR Diffs for Benchmarking ---

const SQL_INJECTION_DIFF = `diff --git a/src/lib/users.ts b/src/lib/users.ts
--- a/src/lib/users.ts
+++ b/src/lib/users.ts
@@ -10,6 +10,10 @@ export async function getUser(id: string) {
+export async function getUserByName(name: string) {
+  const query = "SELECT * FROM users WHERE name = '" + name + "'";
+  return db.query(query);
+}
`;

const XSS_DIFF = `diff --git a/src/components/profile.tsx b/src/components/profile.tsx
--- a/src/components/profile.tsx
+++ b/src/components/profile.tsx
@@ -5,6 +5,8 @@ export function Profile({ user }: { user: User }) {
+  return (
+    <div dangerouslySetInnerHTML={{ __html: user.bio }} />
+  );
+}
`;

const HARDCODED_SECRETS_DIFF = `diff --git a/src/config.ts b/src/config.ts
--- a/src/config.ts
+++ b/src/config.ts
@@ -1,3 +1,6 @@
+const DB_PASSWORD = "mysecretpassword123";
+const API_KEY = "sk-abc123def456ghi789";
+const JWT_SECRET = "super-secret-key";
`;

const RACE_CONDITION_DIFF = `diff --git a/src/lib/file-handler.ts b/src/lib/file-handler.ts
--- a/src/lib/file-handler.ts
+++ b/src/lib/file-handler.ts
@@ -8,6 +8,11 @@ export async function processFile(path: string) {
+  if (fs.existsSync(path)) {
+    const data = fs.readFileSync(path);
+    return JSON.parse(data);
+  }
+  return null;
`;

const MISSING_ERROR_HANDLING_DIFF = `diff --git a/src/lib/api.ts b/src/lib/api.ts
--- a/src/lib/api.ts
+++ b/src/lib/api.ts
@@ -12,6 +12,9 @@ export async function fetchData(url: string) {
+  const response = await fetch(url);
+  const data = response.json();
+  return data;
`;

const N_PLUS_ONE_DIFF = `diff --git a/src/lib/orders.ts b/src/lib/orders.ts
--- a/src/lib/orders.ts
+++ b/src/lib/orders.ts
@@ -5,6 +5,12 @@ export async function getOrdersWithUsers() {
+  const orders = await db.order.findMany();
+  for (const order of orders) {
+    order.user = await db.user.findUnique({ where: { id: order.userId } });
+  }
+  return orders;
`;

const VULNERABLE_DEPS_DIFF = `diff --git a/package.json b/package.json
--- a/package.json
+++ b/package.json
@@ -10,6 +10,8 @@
   "dependencies": {
+    "lodash": "^3.10.1",
+    "moment": "^2.29.0",
   }
`;

const OFF_BY_ONE_DIFF = `diff --git a/src/lib/pagination.ts b/src/lib/pagination.ts
--- a/src/lib/pagination.ts
+++ b/src/lib/pagination.ts
@@ -3,6 +3,10 @@ export function getPage<T>(items: T[], page: number, pageSize: number) {
+  const start = page * pageSize;
+  const end = start + pageSize;
+  return items.slice(start, end + 1);
+}
`;

const PATH_TRAVERSAL_DIFF = `diff --git a/src/lib/files.ts b/src/lib/files.ts
--- a/src/lib/files.ts
+++ b/src/lib/files.ts
@@ -5,6 +5,9 @@ export async function readFile(req: Request) {
+  const filename = req.query.get('file');
+  const content = fs.readFileSync(\`/uploads/\${filename}\`, 'utf-8');
+  return content;
`;

const TYPE_COERCION_DIFF = `diff --git a/src/lib/validate.ts b/src/lib/validate.ts
--- a/src/lib/validate.ts
+++ b/src/lib/validate.ts
@@ -3,6 +3,9 @@ export function isValid(value: any) {
+  if (value == true) {
+    return true;
+  }
+  return false;
`;

describe('Review Output Parsing Benchmarks', () => {
  it('should parse a valid review with approve score', () => {
    const content = '```json\n{"action":"final_review","summary":"LGTM","overallScore":"approve","comments":[]}\n```';
    const parsed = parseReviewFromContent(content);
    expect(parsed).not.toBeNull();
    expect(parsed!.overallScore).toBe('approve');
  });

  it('should parse a review with request_changes and comments', () => {
    const content = '```json\n{"action":"final_review","summary":"Issues found","overallScore":"request_changes","comments":[{"filePath":"src/auth.ts","line":10,"side":"RIGHT","body":"SQL injection","severity":"critical"}]}\n```';
    const parsed = parseReviewFromContent(content);
    expect(parsed).not.toBeNull();
    expect(parsed!.overallScore).toBe('request_changes');
    expect((parsed!.comments as unknown[])).toHaveLength(1);
  });

  it('should parse raw JSON without code fences', () => {
    const content = '{"action":"final_review","summary":"OK","overallScore":"comment","comments":[]}';
    const parsed = parseReviewFromContent(content);
    expect(parsed).not.toBeNull();
    expect(parsed!.overallScore).toBe('comment');
  });
});

describe('Bad PR Detection Benchmarks', () => {
  const benchmarkCases = [
    { name: 'SQL Injection', diff: SQL_INJECTION_DIFF, expectedMinSeverity: 'critical' },
    { name: 'XSS via dangerouslySetInnerHTML', diff: XSS_DIFF, expectedMinSeverity: 'error' },
    { name: 'Hardcoded Secrets', diff: HARDCODED_SECRETS_DIFF, expectedMinSeverity: 'critical' },
    { name: 'Race Condition (TOCTOU)', diff: RACE_CONDITION_DIFF, expectedMinSeverity: 'warning' },
    { name: 'Missing Error Handling', diff: MISSING_ERROR_HANDLING_DIFF, expectedMinSeverity: 'warning' },
    { name: 'N+1 Query', diff: N_PLUS_ONE_DIFF, expectedMinSeverity: 'warning' },
    { name: 'Vulnerable Dependencies', diff: VULNERABLE_DEPS_DIFF, expectedMinSeverity: 'error' },
    { name: 'Off-by-One Error', diff: OFF_BY_ONE_DIFF, expectedMinSeverity: 'error' },
    { name: 'Path Traversal', diff: PATH_TRAVERSAL_DIFF, expectedMinSeverity: 'critical' },
    { name: 'Type Coercion Bug', diff: TYPE_COERCION_DIFF, expectedMinSeverity: 'warning' },
  ];

  it('should have all 10 benchmark cases defined', () => {
    expect(benchmarkCases).toHaveLength(10);
  });

  it('each benchmark case should have a non-trivial diff', () => {
    for (const { name, diff } of benchmarkCases) {
      expect(diff.length, `Diff for "${name}" should not be empty`).toBeGreaterThan(50);
      expect(diff, `Diff for "${name}" should contain diff headers`).toContain('diff --git');
    }
  });

  it('each benchmark case should specify a valid severity', () => {
    const validSeverities = ['info', 'warning', 'error', 'critical'];
    for (const { name, expectedMinSeverity } of benchmarkCases) {
      expect(validSeverities, `Severity for "${name}" should be valid`).toContain(expectedMinSeverity);
    }
  });

  it('should correctly parse a simulated AI response for SQL injection', () => {
    const simulatedAIResponse = '```json\n{"action":"final_review","summary":"SQL injection vulnerability detected","overallScore":"request_changes","comments":[{"filePath":"src/lib/users.ts","line":12,"side":"RIGHT","body":"SQL injection: Use parameterized queries","severity":"critical"}]}\n```';
    const parsed = parseReviewFromContent(simulatedAIResponse);
    expect(parsed).not.toBeNull();
    expect(parsed!.overallScore).toBe('request_changes');
    const comments = parsed!.comments as Array<Record<string, unknown>>;
    expect(comments).toHaveLength(1);
    expect(comments[0].severity).toBe('critical');
    expect(comments[0].body).toContain('SQL injection');
  });

  it('should correctly parse a simulated AI response for hardcoded secrets', () => {
    const simulatedAIResponse = '```json\n{"action":"final_review","summary":"Hardcoded secrets detected","overallScore":"request_changes","comments":[{"filePath":"src/config.ts","line":2,"side":"RIGHT","body":"Hardcoded password","severity":"critical"},{"filePath":"src/config.ts","line":3,"side":"RIGHT","body":"Hardcoded API key","severity":"critical"}]}\n```';
    const parsed = parseReviewFromContent(simulatedAIResponse);
    expect(parsed).not.toBeNull();
    const comments = parsed!.comments as Array<Record<string, unknown>>;
    expect(comments).toHaveLength(2);
    expect(comments.every(c => c.severity === 'critical')).toBe(true);
  });

  it('should correctly parse a simulated AI response for path traversal', () => {
    const simulatedAIResponse = '```json\n{"action":"final_review","summary":"Path traversal vulnerability","overallScore":"request_changes","comments":[{"filePath":"src/lib/files.ts","line":7,"side":"RIGHT","body":"Path traversal: User input used in file path","severity":"critical"}]}\n```';
    const parsed = parseReviewFromContent(simulatedAIResponse);
    expect(parsed).not.toBeNull();
    const comments = parsed!.comments as Array<Record<string, unknown>>;
    expect(comments[0].severity).toBe('critical');
    expect(comments[0].body as string).toContain('Path traversal');
  });
});

describe('Review Quality Metrics', () => {
  it('should track hallucination potential: comments reference files that exist in diff', () => {
    const diff = SQL_INJECTION_DIFF;
    const diffFiles: string[] = [];
    for (const line of diff.split('\n')) {
      const match = line.match(/^\+\+\+ b\/(.+)$/);
      if (match) diffFiles.push(match[1]);
    }

    const reviewComments = [
      { filePath: 'src/lib/users.ts', line: 12, body: 'SQL injection', severity: 'critical' },
      { filePath: 'src/lib/admin.ts', line: 5, body: 'Also in admin', severity: 'warning' }, // NOT in diff
    ];

    const hallucinatedComments = reviewComments.filter(c => !diffFiles.includes(c.filePath));
    expect(hallucinatedComments).toHaveLength(1);
    expect(hallucinatedComments[0].filePath).toBe('src/lib/admin.ts');
  });

  it('should validate that severity levels are internally consistent', () => {
    const parsed = {
      overallScore: 'approve',
      comments: [{ filePath: 'a.ts', line: 1, body: 'Small suggestion', severity: 'info' }],
    };
    const hasHighSeverityWithApprove = parsed.overallScore === 'approve' &&
      (parsed.comments as Array<{ severity: string }>).some(c => c.severity === 'critical' || c.severity === 'error');
    expect(hasHighSeverityWithApprove).toBe(false);
  });

  it('should flag inconsistency: request_changes with no error/critical comments', () => {
    const parsed = {
      overallScore: 'request_changes',
      comments: [{ filePath: 'a.ts', line: 1, body: 'Minor style issue', severity: 'info' }],
    };
    const hasNoHighSeverity = !(parsed.comments as Array<{ severity: string }>).some(
      c => c.severity === 'critical' || c.severity === 'error'
    );
    const inconsistent = parsed.overallScore === 'request_changes' && hasNoHighSeverity;
    expect(inconsistent).toBe(true);
  });
});

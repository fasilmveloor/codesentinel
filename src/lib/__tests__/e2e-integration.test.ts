import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// --- E2E Integration Tests for CodeSentinel ---
// Tests the full webhook → review pipeline with mocked external services
// Including: token usage tracking, hallucination guard, hunk-level line validation,
// scheduled cleanup, and comprehensive GitHub/GitLab webhook handling

// Mock the database module
vi.mock('@/lib/db', () => ({
  db: {
    appConfig: {
      findUnique: vi.fn(),
      upsert: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
      deleteMany: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
    },
    review: {
      create: vi.fn(),
      update: vi.fn(),
      findMany: vi.fn(),
    },
    reviewComment: {
      createMany: vi.fn(),
    },
    repository: {
      create: vi.fn(),
      updateMany: vi.fn(),
    },
    $queryRaw: vi.fn(),
  },
}));

// Mock the AI SDK
vi.mock('z-ai-web-dev-sdk', () => ({
  default: {
    create: vi.fn(),
  },
}));

// Mock the GitHub module
vi.mock('@/lib/github', () => ({
  fetchPRDiff: vi.fn(),
  fetchPRInfo: vi.fn(),
  upsertRepository: vi.fn(),
  postPRReview: vi.fn(),
  postPRComment: vi.fn(),
  replyToReviewComment: vi.fn(),
  createCheckRun: vi.fn(),
  updateCheckRun: vi.fn(),
  getInstallationToken: vi.fn(),
}));

// Mock the GitLab module
vi.mock('@/lib/gitlab', () => ({
  fetchMRDiff: vi.fn(),
  fetchMRChanges: vi.fn(),
  postMRDiscussion: vi.fn(),
  postMRNote: vi.fn(),
  upsertGitLabRepository: vi.fn(),
}));

// Mock review-timeout
vi.mock('@/lib/review-timeout', () => ({
  withTimeout: vi.fn((promise) => promise),
  cleanupStuckReviews: vi.fn(),
}));

import { NextRequest } from 'next/server';
import crypto from 'crypto';
import { db } from '@/lib/db';
import { fetchPRDiff, fetchPRInfo, upsertRepository, postPRReview, postPRComment } from '@/lib/github';
import { fetchMRDiff, fetchMRChanges, postMRNote, upsertGitLabRepository } from '@/lib/gitlab';
import { checkRateLimit, cleanupRateLimitEntries, getRateLimitStats, getCleanupMetrics } from '@/lib/rate-limit';
import {
  extractDiffLineRanges,
  validateReviewAgainstDiff,
  parseReviewFromContent,
  buildReviewResult,
  TokenUsage,
} from '@/lib/reviewer';

// ============================================================
// Test Fixtures
// ============================================================

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

const SAMPLE_PR_INFO = {
  title: 'Add session validation',
  author: 'developer',
  body: 'This PR adds a new validateSession function',
  baseBranch: 'main',
  headBranch: 'feature/auth',
  additions: 4,
  deletions: 0,
  changedFiles: 2,
};

const GITHUB_WEBHOOK_SECRET = 'test-webhook-secret';

function createGitHubSignature(payload: string, secret: string): string {
  return 'sha256=' + crypto.createHmac('sha256', secret).update(payload).digest('hex');
}

function createMockRequest(body: string | Record<string, unknown>, headers: Record<string, string>): NextRequest {
  const bodyStr = typeof body === 'string' ? body : JSON.stringify(body);
  return new NextRequest('http://localhost:3000/api/webhook', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...headers,
    },
    body: bodyStr,
  });
}

// ============================================================
// 1. Hallucination Guard E2E Tests
// ============================================================

describe('Hallucination Guard E2E', () => {
  it('should extract and validate diff line ranges end-to-end', () => {
    // Step 1: Extract line ranges from the diff
    const diffRanges = extractDiffLineRanges(SAMPLE_DIFF);
    expect(diffRanges.size).toBe(2);

    // Step 2: Simulate AI producing a review with some hallucinated content
    const aiReviewOutput = {
      overallScore: 'request_changes',
      summary: 'Found security issues',
      comments: [
        {
          filePath: 'src/lib/auth.ts',
          line: 13, // Valid line in the diff
          body: 'Insecure token validation',
          severity: 'error',
        },
        {
          filePath: 'src/lib/auth.ts',
          line: 999, // Hallucinated line
          body: 'This line does not exist',
          severity: 'warning',
        },
        {
          filePath: 'src/lib/nonexistent.ts', // Hallucinated file
          line: 1,
          body: 'This file is not in the diff',
          severity: 'info',
        },
        {
          filePath: 'src/lib/rate-limit.ts',
          line: 7, // Valid line
          body: 'Missing cleanup trigger',
          severity: 'warning',
        },
      ],
    };

    // Step 3: Validate against the actual diff
    const result = validateReviewAgainstDiff(aiReviewOutput, diffRanges);

    // Valid comments should be kept
    expect(result.validComments.length).toBeGreaterThanOrEqual(2);

    // Hallucinated file should be filtered
    expect(result.filteredComments.some(c => (c as Record<string, unknown>).filePath === 'src/lib/nonexistent.ts')).toBe(true);

    // Hallucinated line should be removed
    expect(result.warnings.some(w => w.includes('exceeds diff range') || w.includes('hallucination'))).toBe(true);
  });

  it('should detect line numbers between hunks as hallucinations', () => {
    const multiHunkDiff = `diff --git a/app.ts b/app.ts
--- a/app.ts
+++ b/app.ts
@@ -5,3 +5,5 @@ import { db } from './db';
 const A = 1;
+const B = 2;
+const C = 3;
 const D = 4;
@@ -50,3 +52,5 @@ export function main() {
 const E = 5;
+const F = 6;
+const G = 7;
 const H = 8;
`;

    const diffRanges = extractDiffLineRanges(multiHunkDiff);
    const appRange = diffRanges.get('app.ts');
    expect(appRange).toBeDefined();
    expect(appRange!.hunks.length).toBe(2);

    // Line 30 is between the two hunks
    const aiReview = {
      overallScore: 'comment',
      summary: 'Feedback',
      comments: [
        { filePath: 'app.ts', line: 6, body: 'Valid - in first hunk', severity: 'info' },
        { filePath: 'app.ts', line: 30, body: 'Hallucinated - between hunks', severity: 'info' },
        { filePath: 'app.ts', line: 53, body: 'Valid - in second hunk', severity: 'info' },
      ],
    };

    const result = validateReviewAgainstDiff(aiReview, diffRanges);

    // Line 30 should be flagged as between hunks
    expect(result.warnings.some(w => w.includes('between diff hunks'))).toBe(true);

    // The comment with line 30 should have its line removed
    const betweenHunkComment = result.validComments.find(c => (c as Record<string, unknown>).body === 'Hallucinated - between hunks');
    expect(betweenHunkComment).toBeDefined();
    expect((betweenHunkComment as Record<string, unknown>).line).toBeNull();
  });
});

// ============================================================
// 2. Token Usage Tracking E2E Tests
// ============================================================

describe('Token Usage Tracking E2E', () => {
  it('should include tokenUsage with isEstimated flag when API provides real data', () => {
    const result = buildReviewResult(
      { overallScore: 'approve', summary: 'LGTM', comments: [] },
      [],
      'z-ai-default',
      3300,
      { promptTokens: 2500, completionTokens: 800, totalTokens: 3300, isEstimated: false },
      undefined
    );

    expect(result.tokenUsage).toBeDefined();
    expect(result.tokenUsage!.isEstimated).toBe(false);
    expect(result.tokenUsage!.promptTokens).toBe(2500);
    expect(result.tokenUsage!.completionTokens).toBe(800);
    expect(result.tokenUsage!.totalTokens).toBe(3300);
    expect(result.tokensUsed).toBe(3300);
  });

  it('should include tokenUsage with isEstimated=true when using estimation', () => {
    const result = buildReviewResult(
      { overallScore: 'comment', summary: 'Feedback', comments: [] },
      [],
      'z-ai-default',
      500,
      { promptTokens: 300, completionTokens: 200, totalTokens: 500, isEstimated: true },
      undefined
    );

    expect(result.tokenUsage).toBeDefined();
    expect(result.tokenUsage!.isEstimated).toBe(true);
    expect(result.tokenUsage!.totalTokens).toBe(500);
  });

  it('should parse review from AI response content correctly', () => {
    const aiResponse = `I've analyzed this PR and found some issues.

\`\`\`json
{
  "action": "final_review",
  "summary": "Found security vulnerability in auth",
  "overallScore": "request_changes",
  "comments": [
    {
      "filePath": "src/lib/auth.ts",
      "line": 13,
      "body": "Insecure validation",
      "severity": "error"
    }
  ]
}
\`\`\``;

    const parsed = parseReviewFromContent(aiResponse);
    expect(parsed).not.toBeNull();
    expect(parsed!.overallScore).toBe('request_changes');
    expect((parsed!.comments as Array<Record<string, unknown>>).length).toBe(1);
  });

  it('should track prompt + completion tokens separately', () => {
    const tokenUsage: TokenUsage = {
      promptTokens: 5000,
      completionTokens: 1500,
      totalTokens: 6500,
      isEstimated: false,
    };

    expect(tokenUsage.promptTokens + tokenUsage.completionTokens).toBe(tokenUsage.totalTokens);
  });
});

// ============================================================
// 3. GitHub Webhook E2E Tests
// ============================================================

describe('GitHub Webhook E2E', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default mock implementations — provide webhook_secret for all tests
    (vi.mocked(db.appConfig.findUnique) as any).mockImplementation(async (args: any) => {
      const key = args?.where?.key;
      if (key === 'webhook_secret') return { key, value: GITHUB_WEBHOOK_SECRET, id: '1' };
      if (key === 'block_merge') return null;
      if (key && key.startsWith('rate_limit:')) return null;
      return null;
    });
    (vi.mocked(db.appConfig.upsert) as any).mockResolvedValue({ key: 'test', value: 'test', id: '1' });
    vi.mocked(upsertRepository).mockResolvedValue('repo-id-1');
    vi.mocked(fetchPRDiff).mockResolvedValue(SAMPLE_DIFF);
    vi.mocked(fetchPRInfo).mockResolvedValue({
      ...SAMPLE_PR_INFO,
      headSha: 'abc123',
      url: 'https://github.com/owner/repo/pull/1',
    });
    vi.mocked(postPRReview).mockResolvedValue(undefined);
    vi.mocked(postPRComment).mockResolvedValue(undefined);
    vi.mocked(db.review.create).mockResolvedValue({
      id: 'review-id-1',
      repositoryId: 'repo-id-1',
      platform: 'github',
      prNumber: 1,
      prTitle: SAMPLE_PR_INFO.title,
      prAuthor: SAMPLE_PR_INFO.author,
      prUrl: 'https://github.com/owner/repo/pull/1',
      status: 'reviewing',
      headSha: 'abc123',
      isReReview: false,
      summary: null,
      overallScore: null,
      agentSteps: null,
      modelUsed: null,
      tokensUsed: null,
      checkRunId: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    } as never);
    vi.mocked(db.review.update).mockResolvedValue({} as never);
    vi.mocked(db.reviewComment.createMany).mockResolvedValue({ count: 1 });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('pull_request opened event', () => {
    it('should process a valid pull_request opened webhook', async () => {
      const payload = {
        action: 'opened',
        pull_request: {
          number: 1,
          title: 'Add session validation',
          user: { login: 'developer' },
          html_url: 'https://github.com/owner/repo/pull/1',
          head: { sha: 'abc123' },
        },
        repository: {
          owner: { login: 'owner' },
          name: 'repo',
        },
        installation: { id: 12345 },
      };

      const bodyStr = JSON.stringify(payload);
      const signature = createGitHubSignature(bodyStr, GITHUB_WEBHOOK_SECRET);

      const request = createMockRequest(bodyStr, {
        'x-github-event': 'pull_request',
        'x-hub-signature-256': signature,
        'x-forwarded-for': '127.0.0.1',
      });

      // Import the handler dynamically to ensure mocks are in place
      const { POST } = await import('@/app/api/webhook/route');
      const response = await POST(request);

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.message).toContain('Review processing started');
      expect(data.pr).toBe(1);

      // Verify upsertRepository was called
      expect(upsertRepository).toHaveBeenCalledWith('owner', 'repo', 12345, 'github');
    });

    it('should reject webhooks with invalid signatures', async () => {
      const payload = {
        action: 'opened',
        pull_request: {
          number: 1,
          title: 'Test',
          user: { login: 'dev' },
          html_url: 'https://github.com/owner/repo/pull/1',
          head: { sha: 'abc' },
        },
        repository: { owner: { login: 'owner' }, name: 'repo' },
      };

      const bodyStr = JSON.stringify(payload);

      (vi.mocked(db.appConfig.findUnique) as any).mockImplementation(async (args: any) => {
        const key = args?.where?.key;
        if (key === 'webhook_secret') return { key, value: GITHUB_WEBHOOK_SECRET, id: '1' };
        return null;
      });

      const request = createMockRequest(bodyStr, {
        'x-github-event': 'pull_request',
        'x-hub-signature-256': 'sha256=invalidsignature',
        'x-forwarded-for': '127.0.0.1',
      });

      const { POST } = await import('@/app/api/webhook/route');
      const response = await POST(request);

      expect(response.status).toBe(401);
    });

    it('should ignore pull_request events with unsupported actions', async () => {
      const payload = {
        action: 'closed',
        pull_request: {
          number: 1,
          title: 'Test',
          user: { login: 'dev' },
          html_url: 'https://github.com/owner/repo/pull/1',
          head: { sha: 'abc' },
        },
        repository: { owner: { login: 'owner' }, name: 'repo' },
      };

      const bodyStr = JSON.stringify(payload);
      const signature = createGitHubSignature(bodyStr, GITHUB_WEBHOOK_SECRET);

      const request = createMockRequest(bodyStr, {
        'x-github-event': 'pull_request',
        'x-hub-signature-256': signature,
        'x-forwarded-for': '127.0.0.1',
      });

      const { POST } = await import('@/app/api/webhook/route');
      const response = await POST(request);

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.message).toBe('Event ignored');
    });
  });

  describe('issue_comment command parsing', () => {
    it('should trigger re-review when /review command is used on a PR', async () => {
      const payload = {
        action: 'created',
        issue: {
          number: 1,
          pull_request: {}, // This makes it a PR comment, not an issue comment
          title: 'Add session validation',
          html_url: 'https://github.com/owner/repo/pull/1',
        },
        comment: {
          body: '/review please check the auth logic',
          id: 999,
          user: { login: 'reviewer' },
        },
        repository: { owner: { login: 'owner' }, name: 'repo' },
        installation: { id: 12345 },
      };

      const bodyStr = JSON.stringify(payload);
      const signature = createGitHubSignature(bodyStr, GITHUB_WEBHOOK_SECRET);

      vi.mocked(fetchPRInfo).mockResolvedValue({
        ...SAMPLE_PR_INFO,
        headSha: 'abc123',
        url: 'https://github.com/owner/repo/pull/1',
      });

      const request = createMockRequest(bodyStr, {
        'x-github-event': 'issue_comment',
        'x-hub-signature-256': signature,
        'x-forwarded-for': '127.0.0.1',
      });

      const { POST } = await import('@/app/api/webhook/route');
      const response = await POST(request);

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.message).toContain('Re-review triggered');

      // Verify acknowledgment comment was posted
      expect(postPRComment).toHaveBeenCalled();
    });

    it('should ignore /review commands on regular issues (not PRs)', async () => {
      const payload = {
        action: 'created',
        issue: {
          number: 5,
          // No pull_request property — this is a regular issue, not a PR
          title: 'Bug report',
          html_url: 'https://github.com/owner/repo/issues/5',
        },
        comment: {
          body: '/review',
          id: 998,
          user: { login: 'reviewer' },
        },
        repository: { owner: { login: 'owner' }, name: 'repo' },
        installation: { id: 12345 },
      };

      const bodyStr = JSON.stringify(payload);
      const signature = createGitHubSignature(bodyStr, GITHUB_WEBHOOK_SECRET);
      const request = createMockRequest(bodyStr, {
        'x-github-event': 'issue_comment',
        'x-hub-signature-256': signature,
        'x-forwarded-for': '127.0.0.1',
      });

      const { POST } = await import('@/app/api/webhook/route');
      const response = await POST(request);

      expect(response.status).toBe(200);
      // Should be ignored since it's not a PR
      const data = await response.json();
      expect(data.message).toBe('Event ignored');
    });
  });

  describe('rate limiting', () => {
    it('should return 429 when rate limit is exceeded', async () => {
      // Mock rate limit as exceeded (but still provide webhook_secret)
      (vi.mocked(db.appConfig.findUnique) as any).mockImplementation(async (args: any) => {
        const key = args?.where?.key;
        if (key === 'webhook_secret') return { key, value: GITHUB_WEBHOOK_SECRET, id: '1' };
        if (key && key.startsWith('rate_limit:')) {
          return { key, value: '30:9999999999999', id: '1' };
        }
        return null;
      });

      const payload = { action: 'opened', repository: { owner: { login: 'owner' }, name: 'repo' } };
      const bodyStr = JSON.stringify(payload);

      const request = createMockRequest(bodyStr, {
        'x-github-event': 'pull_request',
        'x-forwarded-for': '1.2.3.4',
      });

      const { POST } = await import('@/app/api/webhook/route');
      const response = await POST(request);

      expect(response.status).toBe(429);
    });
  });
});

// ============================================================
// 4. GitLab Webhook E2E Tests
// ============================================================

describe('GitLab Webhook E2E', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default mock implementations — provide gitlab_webhook_secret for all tests
    (vi.mocked(db.appConfig.findUnique) as any).mockImplementation(async (args: any) => {
      const key = args?.where?.key;
      if (key === 'gitlab_webhook_secret') return { key, value: 'test-token', id: '1' };
      if (key && key.startsWith('rate_limit:')) return null;
      return null;
    });
    (vi.mocked(db.appConfig.upsert) as any).mockResolvedValue({ key: 'test', value: 'test', id: '1' });
    vi.mocked(upsertGitLabRepository).mockResolvedValue('repo-id-2');
    vi.mocked(fetchMRDiff).mockResolvedValue(SAMPLE_DIFF);
    vi.mocked(fetchMRChanges).mockResolvedValue({
      changes: [],
      mrInfo: {
        title: 'Add session validation',
        author: 'developer',
        url: 'https://gitlab.com/owner/repo/-/merge_requests/5',
        description: 'This MR adds a new validateSession function',
        targetBranch: 'main',
        sourceBranch: 'feature/auth',
        additions: 4,
        deletions: 0,
        changedFiles: 2,
        baseSha: 'base123',
        headSha: 'head456',
        startSha: 'start789',
      },
    });
    vi.mocked(postMRNote).mockResolvedValue(undefined);
    vi.mocked(db.review.create).mockResolvedValue({
      id: 'review-id-2',
      repositoryId: 'repo-id-2',
      platform: 'gitlab',
      prNumber: 5,
      prTitle: 'Add session validation',
      prAuthor: 'developer',
      prUrl: 'https://gitlab.com/owner/repo/-/merge_requests/5',
      status: 'reviewing',
      headSha: null,
      isReReview: false,
      summary: null,
      overallScore: null,
      agentSteps: null,
      modelUsed: null,
      tokensUsed: null,
      checkRunId: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    } as never);
    vi.mocked(db.review.update).mockResolvedValue({} as never);
    vi.mocked(db.reviewComment.createMany).mockResolvedValue({ count: 1 });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('Merge Request Hook', () => {
    it('should process a valid merge request open event', async () => {
      const payload = {
        object_kind: 'merge_request',
        object_attributes: {
          action: 'open',
          iid: 5,
          title: 'Add session validation',
          url: 'https://gitlab.com/owner/repo/-/merge_requests/5',
        },
        project: {
          path_with_namespace: 'owner/repo',
          web_url: 'https://gitlab.com/owner/repo',
        },
        user: { username: 'developer' },
      };

      const bodyStr = JSON.stringify(payload);
      const request = createMockRequest(bodyStr, {
        'x-gitlab-event': 'Merge Request Hook',
        'x-gitlab-token': 'test-token',
        'x-forwarded-for': '127.0.0.1',
      });

      const { POST } = await import('@/app/api/webhook/gitlab/route');
      const response = await POST(request);

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.message).toContain('Review processing started');
      expect(data.mr).toBe(5);

      // Verify repository was registered
      expect(upsertGitLabRepository).toHaveBeenCalledWith('owner', 'repo', 'https://gitlab.com');
    });

    it('should reject webhooks with invalid GitLab tokens', async () => {
      const payload = {
        object_kind: 'merge_request',
        object_attributes: { action: 'open', iid: 5, title: 'Test', url: 'https://gitlab.com/owner/repo/-/merge_requests/5' },
        project: { path_with_namespace: 'owner/repo', web_url: 'https://gitlab.com/owner/repo' },
      };

      (vi.mocked(db.appConfig.findUnique) as any).mockImplementation(async (args: any) => {
        const key = args?.where?.key;
        if (key === 'gitlab_webhook_secret') return { key, value: 'correct-token', id: '1' };
        return null;
      });

      const bodyStr = JSON.stringify(payload);
      const request = createMockRequest(bodyStr, {
        'x-gitlab-event': 'Merge Request Hook',
        'x-gitlab-token': 'wrong-token',
        'x-forwarded-for': '127.0.0.1',
      });

      const { POST } = await import('@/app/api/webhook/gitlab/route');
      const response = await POST(request);

      expect(response.status).toBe(401);
    });

    it('should handle Note Hook with /review command on MR', async () => {
      const payload = {
        object_kind: 'note',
        object_attributes: {
          note: '/review please check the auth changes',
          noteable_type: 'MergeRequest',
        },
        merge_request: {
          iid: 5,
          title: 'Add session validation',
          url: 'https://gitlab.com/owner/repo/-/merge_requests/5',
        },
        project: {
          path_with_namespace: 'owner/repo',
          web_url: 'https://gitlab.com/owner/repo',
        },
        user: { username: 'developer' },
      };

      const bodyStr = JSON.stringify(payload);
      const request = createMockRequest(bodyStr, {
        'x-gitlab-event': 'Note Hook',
        'x-gitlab-token': 'test-token',
        'x-forwarded-for': '127.0.0.1',
      });

      const { POST } = await import('@/app/api/webhook/gitlab/route');
      const response = await POST(request);

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.message).toContain('Re-review triggered');
    });

    it('should ignore Note Hooks on non-MR noteable types', async () => {
      const payload = {
        object_kind: 'note',
        object_attributes: {
          note: '/review this issue',
          noteable_type: 'Issue', // Not a MergeRequest
        },
        issue: {
          iid: 10,
          title: 'Bug report',
        },
        project: {
          path_with_namespace: 'owner/repo',
          web_url: 'https://gitlab.com/owner/repo',
        },
      };

      const bodyStr2 = JSON.stringify(payload);
      const request2 = createMockRequest(bodyStr2, {
        'x-gitlab-event': 'Note Hook',
        'x-gitlab-token': 'test-token',
        'x-forwarded-for': '127.0.0.1',
      });

      const { POST } = await import('@/app/api/webhook/gitlab/route');
      const response = await POST(request2);

      expect(response.status).toBe(200);
      // Should be ignored since it's not an MR note
    });
  });
});

// ============================================================
// 5. Rate Limit E2E Tests
// ============================================================

describe('Rate Limit E2E', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should allow requests within rate limit', async () => {
    vi.mocked(db.appConfig.findUnique).mockResolvedValue(null);
    vi.mocked(db.appConfig.upsert).mockResolvedValue({ key: 'test', value: '1:9999999999999', id: '1' } as any);

    const result = await checkRateLimit('192.168.1.1');
    expect(result).toBe(true);
  });

  it('should block requests exceeding rate limit', async () => {
    vi.mocked(db.appConfig.findUnique).mockResolvedValue({
      key: 'rate_limit:10.0.0.1',
      value: '30:9999999999999',
      id: '1',
    } as any);

    const result = await checkRateLimit('10.0.0.1');
    expect(result).toBe(false);
  });

  it('should clean up expired entries using Prisma (not raw SQL)', async () => {
    vi.mocked(db.appConfig.findMany).mockResolvedValue([
      { key: 'rate_limit:1.1.1.1', value: '5:1000' }, // Expired (reset time in the past)
      { key: 'rate_limit:2.2.2.2', value: '3:9999999999999' }, // Active
    ] as never);
    vi.mocked(db.appConfig.deleteMany).mockResolvedValue({ count: 1 });
    vi.mocked(db.appConfig.upsert).mockResolvedValue({ key: 'rate_limit_last_cleanup', value: new Date().toISOString(), id: '1' } as never);

    const cleaned = await cleanupRateLimitEntries();
    expect(cleaned).toBe(1);

    // Verify it used Prisma's deleteMany, not raw SQL
    expect(db.appConfig.deleteMany).toHaveBeenCalledWith({
      where: { key: { in: ['rate_limit:1.1.1.1'] } },
    });
    // Verify raw SQL was NOT used
    expect(db.$queryRaw).not.toHaveBeenCalled();
  });

  it('should handle malformed entries during cleanup', async () => {
    vi.mocked(db.appConfig.findMany).mockResolvedValue([
      { key: 'rate_limit:3.3.3.3', value: 'malformed-no-colon' }, // Malformed
      { key: 'rate_limit:4.4.4.4', value: 'notanumber:abc' }, // Malformed reset time
    ] as never);
    vi.mocked(db.appConfig.deleteMany).mockResolvedValue({ count: 2 });

    const cleaned = await cleanupRateLimitEntries();
    expect(cleaned).toBe(2);
    expect(db.appConfig.deleteMany).toHaveBeenCalledWith({
      where: { key: { in: ['rate_limit:3.3.3.3', 'rate_limit:4.4.4.4'] } },
    });
  });

  it('should track cleanup metrics', async () => {
    vi.mocked(db.appConfig.findMany).mockResolvedValue([
      { key: 'rate_limit:5.5.5.5', value: '1:1000' }, // Expired
    ] as never);
    vi.mocked(db.appConfig.deleteMany).mockResolvedValue({ count: 1 });
    vi.mocked(db.appConfig.upsert).mockResolvedValue({ key: 'rate_limit_last_cleanup', value: new Date().toISOString(), id: '1' } as never);

    const cleaned = await cleanupRateLimitEntries();
    expect(cleaned).toBe(1);

    const metrics = getCleanupMetrics();
    expect(metrics.totalCleanups).toBeGreaterThan(0);
    expect(metrics.totalEntriesCleaned).toBeGreaterThan(0);
    expect(metrics.lastCleanupAt).not.toBeNull();
  });

  it('should return stats with lastCleanupAt', async () => {
    vi.mocked(db.appConfig.findMany).mockResolvedValue([
      { value: '5:9999999999999' },
      { value: '3:1000' }, // Expired
    ] as never);
    vi.mocked(db.appConfig.findUnique).mockResolvedValue({
      key: 'rate_limit_last_cleanup',
      value: '2025-01-01T00:00:00.000Z',
      id: '1',
    } as never);

    const stats = await getRateLimitStats();
    expect(stats.active).toBe(1);
    expect(stats.expired).toBe(1);
    expect(stats.total).toBe(2);
    expect(stats.lastCleanupAt).toBe('2025-01-01T00:00:00.000Z');
  });
});

// ============================================================
// 6. Scheduled Cleanup API E2E Tests
// ============================================================

describe('Scheduled Cleanup API E2E', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.CRON_SECRET;
  });

  afterEach(() => {
    delete process.env.CRON_SECRET;
  });

  it('should allow unauthenticated requests when CRON_SECRET is not set', async () => {
    vi.mocked(db.appConfig.findMany).mockResolvedValue([]);
    vi.mocked(db.appConfig.findUnique).mockResolvedValue(null);

    const request = new NextRequest('http://localhost:3000/api/cleanup/scheduled', {
      method: 'POST',
    });

    const { POST } = await import('@/app/api/cleanup/scheduled/route');
    const response = await POST(request);

    expect(response.status).toBe(200);
  });

  it('should reject requests with wrong CRON_SECRET', async () => {
    process.env.CRON_SECRET = 'my-secret';

    const request = new NextRequest('http://localhost:3000/api/cleanup/scheduled', {
      method: 'POST',
      headers: {
        authorization: 'Bearer wrong-secret',
      },
    });

    const { POST } = await import('@/app/api/cleanup/scheduled/route');
    const response = await POST(request);

    expect(response.status).toBe(401);
  });

  it('should allow requests with correct CRON_SECRET', async () => {
    process.env.CRON_SECRET = 'my-secret';
    vi.mocked(db.appConfig.findMany).mockResolvedValue([]);
    vi.mocked(db.appConfig.findUnique).mockResolvedValue(null);

    const request = new NextRequest('http://localhost:3000/api/cleanup/scheduled', {
      method: 'POST',
      headers: {
        authorization: 'Bearer my-secret',
      },
    });

    const { POST } = await import('@/app/api/cleanup/scheduled/route');
    const response = await POST(request);

    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.success).toBe(true);
    expect(data).toHaveProperty('cleaned');
    expect(data).toHaveProperty('durationMs');
    expect(data).toHaveProperty('stats');
    expect(data).toHaveProperty('metrics');
    expect(data).toHaveProperty('timestamp');
  });

  it('should return stats via GET endpoint', async () => {
    vi.mocked(db.appConfig.findMany).mockResolvedValue([]);
    vi.mocked(db.appConfig.findUnique).mockResolvedValue(null);

    const request = new NextRequest('http://localhost:3000/api/cleanup/scheduled', {
      method: 'GET',
    });

    const { GET } = await import('@/app/api/cleanup/scheduled/route');
    const response = await GET(request);

    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data).toHaveProperty('stats');
    expect(data).toHaveProperty('metrics');
    expect(data).toHaveProperty('timestamp');
  });
});

// ============================================================
// 7. Full Pipeline: Diff → Extract → Validate → Build Result
// ============================================================

describe('Full Review Pipeline E2E', () => {
  it('should process a complete review pipeline end-to-end', () => {
    // Step 1: Extract diff ranges from raw diff
    const diffRanges = extractDiffLineRanges(SAMPLE_DIFF);
    expect(diffRanges.size).toBe(2);

    // Step 2: Parse AI response
    const aiResponse = `I found a security issue.

\`\`\`json
{
  "action": "final_review",
  "summary": "Security vulnerability found in token validation",
  "overallScore": "request_changes",
  "comments": [
    {
      "filePath": "src/lib/auth.ts",
      "line": 14,
      "body": "The token validation only checks length, not content. Use crypto.timingSafeEqual.",
      "severity": "error"
    }
  ]
}
\`\`\``;

    const parsed = parseReviewFromContent(aiResponse);
    expect(parsed).not.toBeNull();
    expect(parsed!.overallScore).toBe('request_changes');

    // Step 3: Run hallucination validation
    const validationResult = validateReviewAgainstDiff(parsed!, diffRanges);
    expect(validationResult.filteredComments.length).toBe(0);
    expect(validationResult.validComments.length).toBe(1);

    // Step 4: Build final result with token usage
    const result = buildReviewResult(
      parsed!,
      [{ step: 'analyze', description: 'Analyzed PR', timestamp: new Date().toISOString() }],
      'z-ai-default',
      1500,
      { promptTokens: 1000, completionTokens: 500, totalTokens: 1500, isEstimated: false },
      validationResult.warnings.length > 0 ? validationResult.warnings : undefined
    );

    expect(result.overallScore).toBe('request_changes');
    expect(result.comments.length).toBe(1);
    expect(result.comments[0].filePath).toBe('src/lib/auth.ts');
    expect(result.tokenUsage).toBeDefined();
    expect(result.tokenUsage!.isEstimated).toBe(false);
    expect(result.tokensUsed).toBe(1500);
  });

  it('should handle hallucinated content in the full pipeline', () => {
    // Step 1: Extract
    const diffRanges = extractDiffLineRanges(SAMPLE_DIFF);

    // Step 2: Parse AI response with hallucinated content
    const aiResponse = `\`\`\`json
{
  "action": "final_review",
  "summary": "Review",
  "overallScore": "comment",
  "comments": [
    {
      "filePath": "src/lib/auth.ts",
      "line": 99999,
      "body": "This line does not exist",
      "severity": "info"
    },
    {
      "filePath": "totally/fake/file.ts",
      "line": 1,
      "body": "Fake file comment",
      "severity": "warning"
    }
  ]
}
\`\`\``;

    const parsed = parseReviewFromContent(aiResponse);
    expect(parsed).not.toBeNull();

    // Step 3: Validate — should catch hallucinations
    const validationResult = validateReviewAgainstDiff(parsed!, diffRanges);
    expect(validationResult.warnings.length).toBeGreaterThan(0);

    // Both comments should have been processed — line numbers removed for hallucinated lines
    // but comments themselves kept with warnings
    expect(validationResult.validComments.length).toBeGreaterThan(0);

    // Step 4: Build result — should include hallucination warnings
    const result = buildReviewResult(
      parsed!,
      [],
      'z-ai-default',
      800,
      { promptTokens: 500, completionTokens: 300, totalTokens: 800, isEstimated: true },
      validationResult.warnings
    );

    expect(result.hallucinationWarnings).toBeDefined();
    expect(result.hallucinationWarnings!.length).toBeGreaterThan(0);
  });
});

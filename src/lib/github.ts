import crypto from 'crypto';
import { db } from './db';
import { GITHUB_API_TIMEOUT, GITHUB_FILE_CONTENT_TRUNCATE, REPO_NAME_REGEX } from './constants';

function fetchWithTimeout(url: string, options: RequestInit, timeout = GITHUB_API_TIMEOUT): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);
  return fetch(url, { ...options, signal: controller.signal }).finally(() => clearTimeout(timeoutId));
}

export function validateRepoName(owner: string, repo: string): boolean {
  return REPO_NAME_REGEX.test(owner) && REPO_NAME_REGEX.test(repo);
}

export interface PRInfo {
  title: string;
  author: string;
  url: string;
  body: string;
  baseBranch: string;
  headBranch: string;
  additions: number;
  deletions: number;
  changedFiles: number;
  headSha: string;
}

// Helper to get config from DB
async function getConfig(key: string): Promise<string | null> {
  const config = await db.appConfig.findUnique({ where: { key } });
  return config?.value || null;
}

// Generate JWT for GitHub App authentication
export function generateJWT(appId: string, privateKey: string): string {
  const now = Math.floor(Date.now() / 1000);
  const payload = {
    iat: now - 60,
    exp: now + 10 * 60,
    iss: appId,
  };

  const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url');
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signInput = `${header}.${body}`;

  const sign = crypto.createSign('RSA-SHA256');
  sign.update(signInput);
  sign.end();
  const signature = sign.sign(privateKey, 'base64url');

  return `${signInput}.${signature}`;
}

// Get installation access token
export async function getInstallationToken(installationId: number): Promise<string> {
  const appId = await getConfig('github_app_id');
  const privateKey = await getConfig('github_app_private_key');

  if (!appId || !privateKey) {
    throw new Error('GitHub App ID or Private Key not configured');
  }

  const jwt = generateJWT(appId, privateKey);

  const response = await fetchWithTimeout(
    `https://api.github.com/app/installations/${installationId}/access_tokens`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${jwt}`,
        Accept: 'application/vnd.github.v3+json',
        'User-Agent': 'AI-PR-Reviewer',
      },
    }
  );

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Failed to get installation token: ${response.status} - ${errorText}`);
  }

  const data = await response.json();
  return data.token;
}

// Get token - tries GitHub App first, falls back to PAT
async function getToken(installationId?: number): Promise<string> {
  if (installationId) {
    return getInstallationToken(installationId);
  }
  const pat = await getConfig('github_token');
  if (pat) return pat;
  throw new Error('No GitHub authentication configured.');
}

export async function fetchPRDiff(
  owner: string,
  repo: string,
  prNumber: number,
  installationId?: number
): Promise<string> {
  if (!validateRepoName(owner, repo)) {
    throw new Error('Invalid owner or repo name');
  }
  const token = await getToken(installationId);
  const response = await fetchWithTimeout(
    `https://api.github.com/repos/${owner}/${repo}/pulls/${prNumber}`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github.v3.diff',
        'User-Agent': 'AI-PR-Reviewer',
      },
    }
  );
  if (!response.ok) {
    throw new Error(`Failed to fetch PR diff: ${response.status}`);
  }
  return response.text();
}

export async function fetchPRInfo(
  owner: string,
  repo: string,
  prNumber: number,
  installationId?: number
): Promise<PRInfo> {
  if (!validateRepoName(owner, repo)) {
    throw new Error('Invalid owner or repo name');
  }
  const token = await getToken(installationId);
  const response = await fetchWithTimeout(
    `https://api.github.com/repos/${owner}/${repo}/pulls/${prNumber}`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github.v3+json',
        'User-Agent': 'AI-PR-Reviewer',
      },
    }
  );
  if (!response.ok) {
    throw new Error(`Failed to fetch PR info: ${response.status}`);
  }
  const data = await response.json();
  return {
    title: data.title || '',
    author: data.user?.login || 'unknown',
    url: data.html_url || '',
    body: data.body || '',
    baseBranch: data.base?.ref || '',
    headBranch: data.head?.ref || '',
    additions: data.additions || 0,
    deletions: data.deletions || 0,
    changedFiles: data.changed_files || 0,
    headSha: data.head?.sha || '',
  };
}

// Fetch a single file from the repo
export async function fetchFileContent(
  owner: string,
  repo: string,
  filePath: string,
  ref: string = 'HEAD',
  installationId?: number
): Promise<string | null> {
  if (!validateRepoName(owner, repo)) {
    return null;
  }
  const token = await getToken(installationId);
  try {
    const response = await fetchWithTimeout(
      `https://api.github.com/repos/${owner}/${repo}/contents/${filePath}?ref=${ref}`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/vnd.github.v3+json',
          'User-Agent': 'AI-PR-Reviewer',
        },
      }
    );
    if (!response.ok) return null;
    const data = await response.json();
    if (data.type === 'file' && data.content) {
      const content = Buffer.from(data.content, 'base64').toString('utf-8');
      return content.length > GITHUB_FILE_CONTENT_TRUNCATE
        ? content.substring(0, GITHUB_FILE_CONTENT_TRUNCATE) + '\n... (truncated)'
        : content;
    }
    return null;
  } catch {
    return null;
  }
}

export interface GitHubReviewComment {
  path: string;
  line?: number;
  side?: 'LEFT' | 'RIGHT';
  body: string;
}

export async function postPRReview(
  owner: string,
  repo: string,
  prNumber: number,
  body: string,
  event: 'APPROVE' | 'REQUEST_CHANGES' | 'COMMENT',
  comments: GitHubReviewComment[],
  installationId?: number
): Promise<void> {
  if (!validateRepoName(owner, repo)) {
    throw new Error('Invalid owner or repo name');
  }
  const token = await getToken(installationId);
  const reviewComments = comments.map((c) => ({
    path: c.path,
    ...(c.line != null ? { line: c.line } : {}),
    ...(c.side ? { side: c.side } : {}),
    body: c.body,
  }));

  const response = await fetchWithTimeout(
    `https://api.github.com/repos/${owner}/${repo}/pulls/${prNumber}/reviews`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github.v3+json',
        'User-Agent': 'AI-PR-Reviewer',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ body, event, comments: reviewComments }),
    }
  );
  if (!response.ok) {
    const errorText = await response.text();
    console.error('Failed to post PR review:', errorText);
    throw new Error(`Failed to post PR review: ${response.status}`);
  }
}

// Post a comment reply on a PR (issue comment)
export async function postPRComment(
  owner: string,
  repo: string,
  prNumber: number,
  body: string,
  installationId?: number
): Promise<void> {
  if (!validateRepoName(owner, repo)) {
    throw new Error('Invalid owner or repo name');
  }
  const token = await getToken(installationId);
  const response = await fetchWithTimeout(
    `https://api.github.com/repos/${owner}/${repo}/issues/${prNumber}/comments`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github.v3+json',
        'User-Agent': 'AI-PR-Reviewer',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ body }),
    }
  );
  if (!response.ok) {
    console.error('Failed to post PR comment:', response.status);
    throw new Error(`Failed to post PR comment: ${response.status}`);
  }
}

// Reply to a review comment (in-line reply)
export async function replyToReviewComment(
  owner: string,
  repo: string,
  prNumber: number,
  reviewCommentId: number,
  body: string,
  installationId?: number
): Promise<void> {
  if (!validateRepoName(owner, repo)) {
    throw new Error('Invalid owner or repo name');
  }
  const token = await getToken(installationId);
  const response = await fetchWithTimeout(
    `https://api.github.com/repos/${owner}/${repo}/pulls/${prNumber}/comments/${reviewCommentId}/replies`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github.v3+json',
        'User-Agent': 'AI-PR-Reviewer',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ body }),
    }
  );
  if (!response.ok) {
    const errorMsg = `Failed to reply to review comment: ${response.status}`;
    console.error(errorMsg);
    // Fall back to posting a general PR comment
    await postPRComment(owner, repo, prNumber, body, installationId);
  }
}

// --- Check Run Functions ---

export async function createCheckRun(
  owner: string,
  repo: string,
  headSha: string,
  status: 'queued' | 'in_progress' | 'completed',
  options?: {
    conclusion?: 'success' | 'failure' | 'neutral' | 'cancelled' | 'timed_out' | 'action_required';
    output?: {
      title: string;
      summary: string;
      text?: string;
      annotations?: Array<{
        path: string;
        start_line: number;
        end_line: number;
        annotation_level: 'notice' | 'warning' | 'failure';
        message: string;
      }>;
    };
    detailsUrl?: string;
  },
  installationId?: number
): Promise<number> {
  if (!validateRepoName(owner, repo)) {
    throw new Error('Invalid owner or repo name');
  }
  const token = await getToken(installationId);
  const reqBody: Record<string, unknown> = {
    name: 'AI Code Review',
    head_sha: headSha,
    status,
  };
  if (status === 'completed') {
    reqBody.conclusion = options?.conclusion || 'neutral';
  }
  if (options?.output) reqBody.output = options.output;
  if (options?.detailsUrl) reqBody.details_url = options.detailsUrl;

  const response = await fetchWithTimeout(
    `https://api.github.com/repos/${owner}/${repo}/check-runs`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github.v3+json',
        'User-Agent': 'AI-PR-Reviewer',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(reqBody),
    }
  );
  if (!response.ok) {
    const errorText = await response.text();
    console.error('Failed to create check run:', errorText);
    throw new Error(`Failed to create check run: ${response.status}`);
  }
  const data = await response.json();
  return data.id;
}

export async function updateCheckRun(
  owner: string,
  repo: string,
  checkRunId: number,
  status: 'queued' | 'in_progress' | 'completed',
  options?: {
    conclusion?: 'success' | 'failure' | 'neutral' | 'cancelled' | 'timed_out' | 'action_required';
    output?: {
      title: string;
      summary: string;
      text?: string;
      annotations?: Array<{
        path: string;
        start_line: number;
        end_line: number;
        annotation_level: 'notice' | 'warning' | 'failure';
        message: string;
      }>;
    };
    detailsUrl?: string;
  },
  installationId?: number
): Promise<void> {
  if (!validateRepoName(owner, repo)) {
    throw new Error('Invalid owner or repo name');
  }
  const token = await getToken(installationId);
  const reqBody: Record<string, unknown> = { status };
  if (status === 'completed') {
    reqBody.conclusion = options?.conclusion || 'neutral';
  }
  if (options?.output) reqBody.output = options.output;
  if (options?.detailsUrl) reqBody.details_url = options.detailsUrl;

  const response = await fetchWithTimeout(
    `https://api.github.com/repos/${owner}/${repo}/check-runs/${checkRunId}`,
    {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github.v3+json',
        'User-Agent': 'AI-PR-Reviewer',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(reqBody),
    }
  );
  if (!response.ok) {
    console.error('Failed to update check run:', response.status);
    throw new Error(`Failed to update check run: ${response.status}`);
  }
}

export async function upsertRepository(
  owner: string,
  name: string,
  installationId?: number,
  platform: string = 'github'
): Promise<string> {
  const fullName = `${owner}/${name}`;
  const repo = await db.repository.upsert({
    where: { fullName },
    update: {
      owner,
      name,
      isActive: true,
      ...(installationId != null ? { installationId } : {}),
      platform,
    },
    create: {
      owner,
      name,
      fullName,
      isActive: true,
      platform,
      ...(installationId != null ? { installationId } : {}),
    },
  });
  return repo.id;
}

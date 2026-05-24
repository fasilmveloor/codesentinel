import { db } from './db';

export interface MRInfo {
  title: string;
  author: string;
  url: string;
  description: string;
  sourceBranch: string;
  targetBranch: string;
  additions: number;
  deletions: number;
  changedFiles: number;
  baseSha: string;
  headSha: string;
  startSha: string;
}

export interface MRChange {
  old_path: string;
  new_path: string;
  diff: string;
  new_file: boolean;
  deleted_file: boolean;
  renamed_file: boolean;
}

async function getGitLabConfig(host?: string): Promise<{ token: string; gitlabHost: string }> {
  const tokenConfig = await db.appConfig.findUnique({ where: { key: 'gitlab_token' } });
  const hostConfig = await db.appConfig.findUnique({ where: { key: 'gitlab_host' } });

  if (!tokenConfig?.value) throw new Error('GitLab token not configured');

  return { token: tokenConfig.value, gitlabHost: host || hostConfig?.value || 'https://gitlab.com' };
}

function encodeProjectPath(owner: string, repo: string): string {
  return encodeURIComponent(`${owner}/${repo}`);
}

export async function fetchMRDiff(owner: string, repo: string, mrIid: number, host?: string): Promise<string> {
  // Reuse fetchMRChanges to avoid duplicate API calls
  const { changes } = await fetchMRChanges(owner, repo, mrIid, host);

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

export async function fetchMRInfo(owner: string, repo: string, mrIid: number, host?: string): Promise<MRInfo> {
  const { token, gitlabHost } = await getGitLabConfig(host);
  const projectId = encodeProjectPath(owner, repo);

  const response = await fetch(
    `${gitlabHost}/api/v4/projects/${projectId}/merge_requests/${mrIid}`,
    { headers: { 'PRIVATE-TOKEN': token, 'User-Agent': 'CodeSentinel' } }
  );
  if (!response.ok) throw new Error(`Failed to fetch MR info: ${response.status}`);
  const data = await response.json();

  // The single MR endpoint doesn't include diff stats, so we compute from changes
  // if the changes array is present (it sometimes is on gitlab.com), otherwise we
  // fall back to a separate /changes request.
  const changes: MRChange[] = data.changes || [];

  return {
    title: data.title || '',
    author: data.author?.username || 'unknown',
    url: data.web_url || '',
    description: data.description || '',
    sourceBranch: data.source_branch || '',
    targetBranch: data.target_branch || '',
    additions: changes.length > 0
      ? changes.reduce((sum, c) => sum + (c.diff.match(/^\+[^+]/gm) || []).length, 0)
      : 0,
    deletions: changes.length > 0
      ? changes.reduce((sum, c) => sum + (c.diff.match(/^-[^-]/gm) || []).length, 0)
      : 0,
    changedFiles: changes.length || 0,
    baseSha: data.diff_refs?.base_sha || '',
    headSha: data.diff_refs?.head_sha || '',
    startSha: data.diff_refs?.start_sha || '',
  };
}

export async function fetchMRChanges(owner: string, repo: string, mrIid: number, host?: string): Promise<{ changes: MRChange[]; mrInfo: MRInfo }> {
  const { token, gitlabHost } = await getGitLabConfig(host);
  const projectId = encodeProjectPath(owner, repo);

  const response = await fetch(
    `${gitlabHost}/api/v4/projects/${projectId}/merge_requests/${mrIid}/changes`,
    { headers: { 'PRIVATE-TOKEN': token, 'User-Agent': 'CodeSentinel' } }
  );
  if (!response.ok) throw new Error(`Failed to fetch MR changes: ${response.status}`);
  const data = await response.json();
  const changes: MRChange[] = data.changes || [];

  const mrInfo: MRInfo = {
    title: data.title || '',
    author: data.author?.username || 'unknown',
    url: data.web_url || '',
    description: data.description || '',
    sourceBranch: data.source_branch || '',
    targetBranch: data.target_branch || '',
    additions: changes.reduce((sum, c) => sum + (c.diff.match(/^\+[^+]/gm) || []).length, 0),
    deletions: changes.reduce((sum, c) => sum + (c.diff.match(/^-[^-]/gm) || []).length, 0),
    changedFiles: changes.length,
    baseSha: data.diff_refs?.base_sha || '',
    headSha: data.diff_refs?.head_sha || '',
    startSha: data.diff_refs?.start_sha || '',
  };

  return { changes, mrInfo };
}

interface DiscussionPosition {
  base_sha: string;
  head_sha: string;
  start_sha: string;
  position_type: string;
  new_path: string;
  new_line: number;
}

export async function postMRDiscussion(owner: string, repo: string, mrIid: number, body: string, position?: DiscussionPosition, host?: string): Promise<void> {
  const { token, gitlabHost } = await getGitLabConfig(host);
  const projectId = encodeProjectPath(owner, repo);
  const requestBody: { body: string; position?: DiscussionPosition } = { body };
  if (position) requestBody.position = position;

  const response = await fetch(
    `${gitlabHost}/api/v4/projects/${projectId}/merge_requests/${mrIid}/discussions`,
    { method: 'POST', headers: { 'PRIVATE-TOKEN': token, 'User-Agent': 'CodeSentinel', 'Content-Type': 'application/json' }, body: JSON.stringify(requestBody) }
  );
  if (!response.ok) {
    console.error('Failed to post MR discussion:', response.status);
    throw new Error(`Failed to post MR discussion: ${response.status}`);
  }
}

export async function postMRNote(owner: string, repo: string, mrIid: number, body: string, host?: string): Promise<void> {
  const { token, gitlabHost } = await getGitLabConfig(host);
  const projectId = encodeProjectPath(owner, repo);

  const response = await fetch(
    `${gitlabHost}/api/v4/projects/${projectId}/merge_requests/${mrIid}/notes`,
    { method: 'POST', headers: { 'PRIVATE-TOKEN': token, 'User-Agent': 'CodeSentinel', 'Content-Type': 'application/json' }, body: JSON.stringify({ body }) }
  );
  if (!response.ok) {
    console.error('Failed to post MR note:', response.status);
    throw new Error(`Failed to post MR note: ${response.status}`);
  }
}

export async function upsertGitLabRepository(owner: string, name: string, host?: string): Promise<string> {
  const fullName = `${owner}/${name}`;
  const gitlabHost = host || 'https://gitlab.com';
  const repo = await db.repository.upsert({
    where: { fullName },
    update: { owner, name, isActive: true, platform: 'gitlab', gitlabHost },
    create: { owner, name, fullName, isActive: true, platform: 'gitlab', gitlabHost },
  });
  return repo.id;
}

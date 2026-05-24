import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import { db } from '@/lib/db';
import { fetchMRDiff, fetchMRChanges, postMRDiscussion, postMRNote, upsertGitLabRepository } from '@/lib/gitlab';
import { reviewPR } from '@/lib/reviewer';
import { checkRateLimit } from '@/lib/rate-limit';
import { withTimeout } from '@/lib/review-timeout';
import { REVIEW_TIMEOUT_MS } from '@/lib/constants';

function timingSafeTokenCompare(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  try {
    return crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
  } catch {
    return false;
  }
}

async function processGitLabReview(
  owner: string,
  repo: string,
  mrIid: number,
  mrTitle: string,
  mrAuthor: string,
  mrUrl: string,
  host?: string,
  reviewMode?: 'fix' | 'explain'
) {
  let reviewId: string | undefined;

  try {
    const repositoryId = await upsertGitLabRepository(owner, repo, host);

    const review = await db.review.create({
      data: {
        repositoryId,
        platform: 'gitlab',
        prNumber: mrIid,
        prTitle: mrTitle,
        prAuthor: mrAuthor,
        prUrl: mrUrl,
        status: 'reviewing',
      },
    });
    reviewId = review.id;

    // Single API call for both MR info and diff (avoid double API call)
    const { mrInfo, changes } = await fetchMRChanges(owner, repo, mrIid, host);
    const diff = changes.map((change: any) => {
      const oldPath = change.old_path || change.new_path;
      const newPath = change.new_path || change.old_path;
      let header = `diff --git a/${oldPath} b/${newPath}`;
      if (change.new_file) header += `\nnew file mode 100644\n--- /dev/null\n+++ b/${newPath}`;
      else if (change.deleted_file) header += `\ndeleted file mode 100644\n--- a/${oldPath}\n+++ /dev/null`;
      else header += `\n--- a/${oldPath}\n+++ b/${newPath}`;
      return `${header}\n${change.diff}`;
    }).join('\n');

    // Wrap AI review with timeout to prevent stuck "reviewing" status
    const result = await withTimeout(
      reviewPR(diff, {
        title: mrInfo.title,
        author: mrInfo.author,
        body: mrInfo.description,
        baseBranch: mrInfo.targetBranch,
        headBranch: mrInfo.sourceBranch,
        additions: mrInfo.additions,
        deletions: mrInfo.deletions,
        changedFiles: mrInfo.changedFiles,
      }, {
        platform: 'gitlab',
        owner,
        repo,
        prNumber: mrIid,
        diff,
        gitlabHost: host,
        repositoryId,
        reviewMode,
      }),
      REVIEW_TIMEOUT_MS,
      reviewId
    );

    await db.review.update({
      where: { id: reviewId! },
      data: {
        status: 'completed',
        summary: result.summary,
        overallScore: result.overallScore,
        agentSteps: JSON.stringify(result.agentSteps),
        modelUsed: result.modelUsed,
        tokensUsed: result.tokensUsed,
      },
    });

    if (result.comments.length > 0 && reviewId) {
      await db.reviewComment.createMany({
        data: result.comments.map((c) => ({
          reviewId: reviewId!,
          filePath: c.filePath,
          line: c.line,
          side: c.side,
          body: c.body,
          severity: c.severity,
        })),
      });
    }

    try {
      const scoreEmoji: Record<string, string> = { approve: '✅', request_changes: '⚠️', comment: '💬' };

      // Build reasoning trace section
      let reasoningTrace = '';
      try {
        const steps = result.agentSteps;
        if (steps && steps.length > 0) {
          const stepLabels: Record<string, string> = {
            analyze: 'Analyzed',
            tool_call: 'Investigated',
            reflect: 'Reviewed',
            review: 'Produced',
            synthesis: 'Synthesized',
            force_final: 'Finalized',
            fallback: 'Fallback',
          };
          const traceLines = steps
            .filter((s) => s.step !== 'synthesis')
            .map((s, i) => {
              const label = stepLabels[s.step] || s.step;
              const toolLabel = s.tool ? ` \`${s.tool}\`` : '';
              const reasoningText = s.reasoning ? ` — ${s.reasoning}` : '';
              const conclusionText = s.conclusion ? `\n   > ${s.conclusion}` : '';
              return `${i + 1}. **${label}**${toolLabel} ${s.description}${reasoningText}${conclusionText}`;
            })
            .join('\n');

          reasoningTrace = `\n\n<details><summary>🔍 Investigation Trace</summary>\n\n${traceLines}\n\n_Tokens used: ~${result.tokensUsed} | Model: ${result.modelUsed} | Steps: ${steps.length}_\n</details>`;
        }
      } catch { /* Gracefully skip if trace fails */ }

      const noteBody = `## AI Review ${scoreEmoji[result.overallScore] || '💬'}\n\n${result.summary}${reasoningTrace}\n\n---\n*Powered by CodeSentinel*`;
      await postMRNote(owner, repo, mrIid, noteBody, host);

      for (const comment of result.comments) {
        if (comment.line != null && mrInfo.baseSha && mrInfo.headSha && mrInfo.startSha) {
          try {
            await postMRDiscussion(owner, repo, mrIid,
              `[**${comment.severity?.toUpperCase() || 'INFO'}**] ${comment.body}`,
              { base_sha: mrInfo.baseSha, head_sha: mrInfo.headSha, start_sha: mrInfo.startSha, position_type: 'text', new_path: comment.filePath, new_line: comment.line },
              host
            );
          } catch {
            await postMRNote(owner, repo, mrIid, `**${comment.filePath}:${comment.line}** [${comment.severity?.toUpperCase() || 'INFO'}] ${comment.body}`, host);
          }
        } else {
          await postMRNote(owner, repo, mrIid, `**${comment.filePath}${comment.line ? `:${comment.line}` : ''}** [${comment.severity?.toUpperCase() || 'INFO'}] ${comment.body}`, host);
        }
      }
    } catch (postError) {
      console.error('Failed to post review to GitLab:', postError);
    }
  } catch (error) {
    console.error('GitLab review processing failed:', error);
    if (reviewId) {
      await db.review.update({
        where: { id: reviewId! },
        data: { status: 'failed', summary: error instanceof Error ? error.message : 'Review processing failed' },
      });
    }
  }
}

export async function POST(request: NextRequest) {
  // Rate limiting (MUST await — checkRateLimit is async and returns Promise<boolean>)
  const clientIp = request.headers.get('x-forwarded-for') || request.headers.get('x-real-ip') || 'unknown';
  if (!(await checkRateLimit(clientIp))) {
    return NextResponse.json({ error: 'Rate limit exceeded' }, { status: 429 });
  }

  try {
    const secretConfig = await db.appConfig.findUnique({ where: { key: 'gitlab_webhook_secret' } });
    if (!secretConfig?.value) {
      console.error('SECURITY: No gitlab_webhook_secret configured — rejecting all GitLab webhook requests');
      return NextResponse.json({ error: 'GitLab webhook secret not configured' }, { status: 401 });
    }
    const token = request.headers.get('x-gitlab-token');
    if (!token || !timingSafeTokenCompare(token, secretConfig.value)) {
      return NextResponse.json({ error: 'Invalid token' }, { status: 401 });
    }

    const payload = await request.json();
    const event = request.headers.get('x-gitlab-event');

    if (event === 'Merge Request Hook') {
      const mr = payload.object_attributes;
      const action = mr.action;

      if (action === 'open' || action === 'update' || action === 'reopen') {
        const project = payload.project;
        const pathWithNamespace = project?.path_with_namespace || '';
        const parts = pathWithNamespace.split('/');
        const repo = parts.pop() || '';
        const owner = parts.join('/');
        const host = project?.web_url ? new URL(project.web_url).origin : undefined;

        if (owner && repo && mr.iid) {
          processGitLabReview(owner, repo, mr.iid, mr.title, payload.user?.username || 'unknown', mr.url, host).catch(console.error);
          return NextResponse.json({ message: 'Review processing started', mr: mr.iid });
        }
      }
    }

    if (event === 'Note Hook') {
      const noteableType = payload.object_attributes?.noteable_type;
      if (noteableType === 'MergeRequest') {
        const noteBody = payload.object_attributes?.note || '';
        const commands = ['/review', '/recheck', '/check', '/re-review', '/help', '/fix', '/explain', '/ignore'];
        const isCommand = commands.some(cmd => noteBody.trim().toLowerCase().startsWith(cmd));

        if (isCommand) {
          const project = payload.project;
          const mr = payload.merge_request;
          const pathWithNamespace = project?.path_with_namespace || '';
          const parts = pathWithNamespace.split('/');
          const repo = parts.pop() || '';
          const owner = parts.join('/');
          const host = project?.web_url ? new URL(project.web_url).origin : undefined;
          const mrIid = mr?.iid;

          // Handle /help command
          if (noteBody.trim().toLowerCase().startsWith('/help')) {
            const helpText = `**CodeSentinel Commands**\n\n| Command | Description |\n|---|---|\n| \`/review\` | Start a full review |\n| \`/recheck\` | Re-review after changes |\n| \`/check\` | Quick check |\n| \`/fix\` | Get fix suggestions |\n| \`/explain\` | Explain the code |\n| \`/ignore\` | Suppress reviews on files |\n| \`/help\` | Show this help |\n\nYou can also specify a file or question: \`/check src/auth.ts\``;
            try {
              await postMRNote(owner, repo, mrIid, helpText, host);
            } catch { /* */ }
            return NextResponse.json({ message: 'Help posted', mr: mrIid });
          }

          // Handle /ignore command
          if (noteBody.trim().toLowerCase().startsWith('/ignore')) {
            const ignoreArgs = noteBody.trim().substring(7).trim();
            const patterns = ignoreArgs ? ignoreArgs.split(/\s+/).filter(Boolean) : [];
            try {
              const existingConfig = await db.appConfig.findUnique({ where: { key: 'ignore_patterns' } });
              const existingPatterns = existingConfig?.value ? JSON.parse(existingConfig.value) : [];
              const newPatterns = [...new Set([...existingPatterns, ...patterns])];
              await db.appConfig.upsert({
                where: { key: 'ignore_patterns' },
                update: { value: JSON.stringify(newPatterns) },
                create: { key: 'ignore_patterns', value: JSON.stringify(newPatterns) },
              });
              const confirmText = `**Ignore patterns updated** 🙈\n\nThe following file patterns will be excluded from reviews:\n${newPatterns.map(p => `- \`${p}\``).join('\n')}\n\n_To remove patterns, update the \`ignore_patterns\` config in the dashboard._`;
              try {
                await postMRNote(owner, repo, mrIid, confirmText, host);
              } catch { /* */ }
            } catch { /* */ }
            return NextResponse.json({ message: 'Ignore patterns updated', mr: mrIid });
          }

          // Determine review mode from command
          let reviewMode: 'fix' | 'explain' | undefined;
          if (noteBody.trim().toLowerCase().startsWith('/fix')) {
            reviewMode = 'fix';
          } else if (noteBody.trim().toLowerCase().startsWith('/explain')) {
            reviewMode = 'explain';
          }

          if (owner && repo && mrIid) {
            processGitLabReview(owner, repo, mrIid, mr?.title || '', payload.user?.username || 'unknown', mr?.url || '', host, reviewMode).catch(console.error);
            return NextResponse.json({ message: 'Re-review triggered by note', mr: mrIid });
          }
        }
      }
    }

    return NextResponse.json({ message: 'Event ignored' });
  } catch (error) {
    console.error('GitLab webhook error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { fetchMRDiff, fetchMRChanges, postMRDiscussion, postMRNote, upsertGitLabRepository } from '@/lib/gitlab';
import { reviewPR } from '@/lib/reviewer';

async function processGitLabReview(
  owner: string,
  repo: string,
  mrIid: number,
  prTitle: string,
  prAuthor: string,
  prUrl: string,
  host?: string
) {
  let reviewId: string | undefined;

  try {
    const repositoryId = await upsertGitLabRepository(owner, repo, host);

    const review = await db.review.create({
      data: {
        repositoryId,
        platform: 'gitlab',
        prNumber: mrIid,
        prTitle,
        prAuthor,
        prUrl,
        status: 'reviewing',
      },
    });
    reviewId = review.id;

    const { mrInfo } = await fetchMRChanges(owner, repo, mrIid, host);
    const diff = await fetchMRDiff(owner, repo, mrIid, host);

    const result = await reviewPR(diff, {
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
    });

    await db.review.update({
      where: { id: reviewId },
      data: {
        status: 'completed',
        summary: result.summary,
        overallScore: result.overallScore,
        agentSteps: JSON.stringify(result.agentSteps),
        modelUsed: result.modelUsed,
        tokensUsed: result.tokensUsed,
      },
    });

    if (result.comments.length > 0) {
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
      const scoreEmoji: Record<string, string> = { approve: 'Approved', request_changes: 'Changes requested', comment: 'Commented' };
      const noteBody = `## AI Review ${scoreEmoji[result.overallScore] || 'Commented'}\n\n${result.summary}\n\n---\n*Powered by CodeSentinel AI PR Reviewer*`;
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
        where: { id: reviewId },
        data: { status: 'failed', summary: error instanceof Error ? error.message : 'Review processing failed' },
      });
    }
  }
}

export async function POST(request: NextRequest) {
  try {
    const secretConfig = await db.appConfig.findUnique({ where: { key: 'gitlab_webhook_secret' } });
    if (secretConfig?.value) {
      const token = request.headers.get('x-gitlab-token');
      if (!token || token !== secretConfig.value) {
        return NextResponse.json({ error: 'Invalid token' }, { status: 401 });
      }
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
        const commands = ['/review', '/recheck', '/check', '/re-review'];
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

          if (owner && repo && mrIid) {
            processGitLabReview(owner, repo, mrIid, mr?.title || '', payload.user?.username || 'unknown', mr?.url || '', host).catch(console.error);
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

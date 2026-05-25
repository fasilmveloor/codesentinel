import { NextRequest, NextResponse } from 'next/server';
import { fetchPRDiff, fetchPRInfo, upsertRepository, postPRReview } from '@/lib/github';
import { fetchMRDiff, fetchMRChanges, postMRDiscussion, postMRNote, upsertGitLabRepository } from '@/lib/gitlab';
import { reviewPR } from '@/lib/reviewer';
import { db } from '@/lib/db';
import { requireAuth } from '@/lib/auth';
import { withTimeout } from '@/lib/review-timeout';
import { REVIEW_TIMEOUT_MS } from '@/lib/constants';
import { logger } from '@/lib/logger';

export async function POST(request: NextRequest) {
  // Auth check
  const authError = await requireAuth(request);
  if (authError) return authError;

  try {
    const body = await request.json();
    const { owner, repo, prNumber, platform } = body;

    if (!owner || !repo || !prNumber) {
      return NextResponse.json({ error: 'Missing required fields: owner, repo, prNumber' }, { status: 400 });
    }

    const isGitLab = platform === 'gitlab';

    if (isGitLab) {
      return triggerGitLabReview(owner, repo, Number(prNumber));
    } else {
      return triggerGitHubReview(owner, repo, Number(prNumber));
    }
  } catch (error) {
    logger.error('Trigger review error', { error });
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

async function triggerGitHubReview(owner: string, repo: string, prNumber: number) {
  const repositoryId = await upsertRepository(owner, repo, undefined, 'github');

  let prInfo;
  try {
    prInfo = await fetchPRInfo(owner, repo, prNumber);
  } catch (error) {
    return NextResponse.json(
      { error: `Failed to fetch PR info: ${error instanceof Error ? error.message : 'Unknown error'}` },
      { status: 400 }
    );
  }

  const review = await db.review.create({
    data: {
      repositoryId,
      platform: 'github',
      prNumber,
      prTitle: prInfo.title,
      prAuthor: prInfo.author,
      prUrl: prInfo.url,
      status: 'reviewing',
      headSha: prInfo.headSha,
    },
  });

  (async () => {
    try {
      const diff = await fetchPRDiff(owner, repo, prNumber);
      const result = await withTimeout(
        reviewPR(diff, prInfo, { platform: 'github', owner, repo, prNumber, diff, repositoryId }),
        REVIEW_TIMEOUT_MS,
        review.id
      );

      await db.review.update({
        where: { id: review.id },
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
            reviewId: review.id, filePath: c.filePath, line: c.line, side: c.side, body: c.body, severity: c.severity,
          })),
        });
      }

      try {
        const eventMap: Record<string, 'APPROVE' | 'REQUEST_CHANGES' | 'COMMENT'> = {
          approve: 'APPROVE', request_changes: 'REQUEST_CHANGES', comment: 'COMMENT',
        };
        const ghEvent = eventMap[result.overallScore] || 'COMMENT';
        const ghComments = result.comments.filter((c) => c.line != null).map((c) => ({
          path: c.filePath, line: c.line as number, side: c.side || 'RIGHT', body: `[**${c.severity?.toUpperCase() || 'INFO'}**] ${c.body}`,
        }));
        await postPRReview(owner, repo, prNumber, result.summary, ghEvent, ghComments);
      } catch (postError) {
        logger.error('Failed to post review to GitHub', { error: postError });
      }
    } catch (error) {
      logger.error('Review processing failed', { error });
      await db.review.update({
        where: { id: review.id },
        data: { status: 'failed', summary: error instanceof Error ? error.message : 'Review processing failed' },
      });
    }
  })();

  return NextResponse.json({ message: 'Review started', reviewId: review.id });
}

async function triggerGitLabReview(owner: string, repo: string, mrIid: number) {
  const repositoryId = await upsertGitLabRepository(owner, repo);

  let mrInfo;
  try {
    const result = await fetchMRChanges(owner, repo, mrIid);
    mrInfo = result.mrInfo;
  } catch (error) {
    return NextResponse.json(
      { error: `Failed to fetch MR info: ${error instanceof Error ? error.message : 'Unknown error'}` },
      { status: 400 }
    );
  }

  const review = await db.review.create({
    data: {
      repositoryId,
      platform: 'gitlab',
      prNumber: mrIid,
      prTitle: mrInfo.title,
      prAuthor: mrInfo.author,
      prUrl: mrInfo.url,
      status: 'reviewing',
    },
  });

  (async () => {
    try {
      const diff = await fetchMRDiff(owner, repo, mrIid);
      const result = await withTimeout(
        reviewPR(diff, {
          title: mrInfo.title, author: mrInfo.author, body: mrInfo.description,
          baseBranch: mrInfo.targetBranch, headBranch: mrInfo.sourceBranch,
          additions: mrInfo.additions, deletions: mrInfo.deletions, changedFiles: mrInfo.changedFiles,
        }, { platform: 'gitlab', owner, repo, prNumber: mrIid, diff, repositoryId }),
        REVIEW_TIMEOUT_MS,
        review.id
      );

      await db.review.update({
        where: { id: review.id },
        data: {
          status: 'completed', summary: result.summary, overallScore: result.overallScore,
          agentSteps: JSON.stringify(result.agentSteps), modelUsed: result.modelUsed, tokensUsed: result.tokensUsed,
        },
      });

      if (result.comments.length > 0) {
        await db.reviewComment.createMany({
          data: result.comments.map((c) => ({
            reviewId: review.id, filePath: c.filePath, line: c.line, side: c.side, body: c.body, severity: c.severity,
          })),
        });
      }

      try {
        const scoreEmoji: Record<string, string> = { approve: '✅', request_changes: '⚠️', comment: '💬' };
        await postMRNote(owner, repo, mrIid, `## AI Review ${scoreEmoji[result.overallScore] || '💬'}\n\n${result.summary}\n\n---\n*Powered by CodeSentinel*`);
        for (const comment of result.comments) {
          if (comment.line != null && mrInfo.baseSha && mrInfo.headSha && mrInfo.startSha) {
            try {
              await postMRDiscussion(owner, repo, mrIid, `[**${comment.severity?.toUpperCase() || 'INFO'}**] ${comment.body}`, {
                base_sha: mrInfo.baseSha, head_sha: mrInfo.headSha, start_sha: mrInfo.startSha,
                position_type: 'text', new_path: comment.filePath, new_line: comment.line,
              });
            } catch {
              await postMRNote(owner, repo, mrIid, `**${comment.filePath}:${comment.line}** [${comment.severity?.toUpperCase() || 'INFO'}] ${comment.body}`);
            }
          } else {
            await postMRNote(owner, repo, mrIid, `**${comment.filePath}${comment.line ? `:${comment.line}` : ''}** [${comment.severity?.toUpperCase() || 'INFO'}] ${comment.body}`);
          }
        }
      } catch (postError) {
        logger.error('Failed to post review to GitLab', { error: postError });
      }
    } catch (error) {
      logger.error('GitLab review processing failed', { error });
      await db.review.update({
        where: { id: review.id },
        data: { status: 'failed', summary: error instanceof Error ? error.message : 'Review processing failed' },
      });
    }
  })();

  return NextResponse.json({ message: 'Review started', reviewId: review.id });
}

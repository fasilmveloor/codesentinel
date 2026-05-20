import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import { db } from '@/lib/db';
import { fetchPRDiff, fetchPRInfo, upsertRepository, postPRReview, postPRComment, replyToReviewComment, createCheckRun, updateCheckRun } from '@/lib/github';
import { reviewPR } from '@/lib/reviewer';
import { checkRateLimit } from '@/lib/rate-limit';
import { REPO_NAME_REGEX, GITHUB_REVIEW_BODY_MAX, GITHUB_ANNOTATION_LIMIT } from '@/lib/constants';

function truncateForGitHub(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text;
  return text.substring(0, maxLen - 20) + '\n\n... (truncated)';
}

function verifySignature(payload: string, signature: string, secret: string): boolean {
  const expectedSignature = 'sha256=' + crypto.createHmac('sha256', secret).update(payload).digest('hex');
  if (!signature || signature.length !== expectedSignature.length) {
    return false;
  }
  try {
    return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expectedSignature));
  } catch {
    return false;
  }
}

function validateRepoParams(owner: string, repo: string): boolean {
  return REPO_NAME_REGEX.test(owner) && REPO_NAME_REGEX.test(repo);
}

// Map severity to annotation level
function severityToAnnotationLevel(severity: string): 'notice' | 'warning' | 'failure' {
  if (severity === 'critical' || severity === 'error') return 'failure';
  if (severity === 'warning') return 'warning';
  return 'notice';
}

// Read block_merge config
async function shouldBlockMerge(): Promise<boolean> {
  const config = await db.appConfig.findUnique({ where: { key: 'block_merge' } });
  return config?.value === 'true';
}

// Supported comment commands
const COMMENT_COMMANDS = ['/review', '/recheck', '/check', '/re-review', '/review again'];

function parseCommentCommand(body: string): { isCommand: boolean; command: string; args: string } {
  const trimmed = body.trim().toLowerCase();
  for (const cmd of COMMENT_COMMANDS) {
    if (trimmed.startsWith(cmd)) {
      const args = body.trim().substring(cmd.length).trim();
      return { isCommand: true, command: cmd, args };
    }
  }
  return { isCommand: false, command: '', args: '' };
}

// --- Review Processing (synchronous for serverless) ---
// On serverless (Netlify), fire-and-forget async work is killed after the
// response is sent. We process reviews synchronously within the function
// invocation. For Netlify Pro, maxDuration can be set to 60s+ in netlify.toml.
// If a timeout occurs, the review stays in "reviewing" status and will be
// recovered by the stuck-review recovery mechanism.

async function processReview(
  owner: string,
  repo: string,
  prNumber: number,
  prTitle: string,
  prAuthor: string,
  prUrl: string,
  headSha: string,
  installationId?: number,
  isReReview: boolean = false,
  focusFile?: string,
  focusQuestion?: string,
  commentId?: number
) {
  let reviewId: string | undefined;
  let checkRunId: number | undefined;
  const blockMerge = await shouldBlockMerge();

  try {
    const repositoryId = await upsertRepository(owner, repo, installationId, 'github');

    const review = await db.review.create({
      data: {
        repositoryId,
        platform: 'github',
        prNumber,
        prTitle,
        prAuthor,
        prUrl,
        status: 'reviewing',
        headSha,
        isReReview,
      },
    });
    reviewId = review.id;

    // Create check run if merge blocking is enabled
    if (blockMerge && headSha) {
      try {
        checkRunId = await createCheckRun(
          owner, repo, headSha, 'in_progress',
          { output: { title: 'AI Code Review: In Progress', summary: `Reviewing PR #${prNumber}: ${prTitle}` } },
          installationId
        );
        await db.review.update({ where: { id: reviewId }, data: { checkRunId } });
      } catch (checkError) {
        console.error('Failed to create check run (non-fatal):', checkError);
      }
    }

    const [diff, prInfo] = await Promise.all([
      fetchPRDiff(owner, repo, prNumber, installationId),
      fetchPRInfo(owner, repo, prNumber, installationId),
    ]);

    const result = await reviewPR(diff, prInfo, {
      platform: 'github',
      owner,
      repo,
      prNumber,
      installationId,
      diff,
      focusFile,
      focusQuestion,
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

    // Post review back to GitHub
    try {
      const eventMap: Record<string, 'APPROVE' | 'REQUEST_CHANGES' | 'COMMENT'> = {
        approve: 'APPROVE',
        request_changes: 'REQUEST_CHANGES',
        comment: 'COMMENT',
      };
      const ghEvent = eventMap[result.overallScore] || 'COMMENT';

      const ghComments = result.comments
        .filter((c) => c.line != null)
        .slice(0, GITHUB_ANNOTATION_LIMIT)
        .map((c) => ({
          path: c.filePath,
          line: c.line!,
          side: c.side || 'RIGHT',
          body: truncateForGitHub(`[**${c.severity?.toUpperCase() || 'INFO'}**] ${c.body}`, 5000),
        }));

      const reviewBody = truncateForGitHub(
        isReReview
          ? `**Re-review** ${focusQuestion ? `(@ ${focusQuestion})` : ''}\n\n${result.summary}`
          : result.summary,
        GITHUB_REVIEW_BODY_MAX - 5000 // Reserve space for comments
      );

      await postPRReview(owner, repo, prNumber, reviewBody, ghEvent, ghComments, installationId);
    } catch (postError) {
      console.error('Failed to post review to GitHub:', postError);
    }

    // If this was triggered by a comment command, reply to the comment
    if (isReReview && commentId) {
      try {
        await replyToReviewComment(
          owner, repo, prNumber, commentId,
          `I've re-reviewed the code${focusFile ? ` (focusing on ${focusFile})` : ''}. ${result.overallScore === 'approve' ? 'Looks good now!' : result.overallScore === 'request_changes' ? 'Still found some issues.' : 'Added some comments.'} See my review above.`,
          installationId
        );
      } catch {
        try {
          await postPRComment(
            owner, repo, prNumber,
            `**Re-review complete** ${result.overallScore === 'approve' ? 'Approved' : result.overallScore === 'request_changes' ? 'Changes requested' : 'Commented'}\n\n${result.summary}`,
            installationId
          );
        } catch { /* */ }
      }
    }

    // Update check run based on review result (only if merge blocking is enabled)
    if (checkRunId) {
      try {
        const titleMap: Record<string, string> = {
          approve: 'AI Code Review: Approved',
          request_changes: 'AI Code Review: Changes Requested',
          comment: 'AI Code Review: Comment',
        };

        // When block_merge is enabled, request_changes = failure; otherwise neutral (advisory only)
        const conclusionMap: Record<string, 'success' | 'failure' | 'neutral'> = blockMerge
          ? { approve: 'success', request_changes: 'failure', comment: 'neutral' }
          : { approve: 'success', request_changes: 'neutral', comment: 'neutral' }; // Always neutral when not blocking

        const annotations = result.comments
          .filter((c) => c.line != null)
          .slice(0, 50)
          .map((c) => ({
            path: c.filePath,
            start_line: c.line!,
            end_line: c.line!,
            annotation_level: severityToAnnotationLevel(c.severity),
            message: c.body,
          }));

        await updateCheckRun(
          owner, repo, checkRunId, 'completed',
          {
            conclusion: conclusionMap[result.overallScore] || 'neutral',
            output: {
              title: titleMap[result.overallScore] || 'AI Code Review: Comment',
              summary: result.summary + (blockMerge ? '' : '\n\n_Merge blocking is disabled — this check is advisory only._'),
              annotations: annotations.length > 0 ? annotations : undefined,
            },
          },
          installationId
        );
      } catch (checkError) {
        console.error('Failed to update check run (non-fatal):', checkError);
      }
    }
  } catch (error) {
    console.error('Review processing failed:', error);
    if (reviewId) {
      await db.review.update({
        where: { id: reviewId },
        data: { status: 'failed', summary: error instanceof Error ? error.message : 'Review processing failed' },
      });
    }
    if (checkRunId) {
      try {
        await updateCheckRun(owner, repo, checkRunId, 'completed', {
          conclusion: 'neutral',
          output: { title: 'AI Code Review: Error', summary: `Review failed: ${error instanceof Error ? error.message : 'Unknown error'}` },
        }, installationId);
      } catch { /* */ }
    }
  }
}

// --- Webhook Handler ---

export async function POST(request: NextRequest) {
  // Rate limiting (now async, DB-backed)
  const clientIp = request.headers.get('x-forwarded-for') || request.headers.get('x-real-ip') || 'unknown';
  const allowed = await checkRateLimit(clientIp);
  if (!allowed) {
    return NextResponse.json({ error: 'Rate limit exceeded' }, { status: 429 });
  }

  try {
    const body = await request.text();

    // Verify webhook signature
    const secretConfig = await db.appConfig.findUnique({ where: { key: 'webhook_secret' } });
    if (secretConfig?.value) {
      const signature = request.headers.get('x-hub-signature-256');
      if (!signature || !verifySignature(body, signature, secretConfig.value)) {
        return NextResponse.json({ error: 'Invalid signature' }, { status: 401 });
      }
    }

    const payload = JSON.parse(body);
    const event = request.headers.get('x-github-event');

    // Handle GitHub App installation events
    if (event === 'installation') {
      const action = payload.action;
      const installation = payload.installation;

      if (action === 'created' || action === 'new_permissions_accepted') {
        const repositories = payload.repositories || [];
        for (const repo of repositories) {
          const [owner, name] = repo.full_name.split('/');
          if (owner && name) await upsertRepository(owner, name, installation.id, 'github');
        }
        return NextResponse.json({ message: 'Installation recorded', installationId: installation.id });
      }

      if (action === 'deleted') {
        const repositories = payload.repositories || [];
        for (const repo of repositories) {
          await db.repository.updateMany({ where: { fullName: repo.full_name }, data: { isActive: false } });
        }
        return NextResponse.json({ message: 'Installation removed' });
      }

      return NextResponse.json({ message: 'Installation event processed' });
    }

    // Handle installation_repositories events
    if (event === 'installation_repositories') {
      const action = payload.action;
      const installationId = payload.installation?.id;

      if (action === 'added') {
        for (const repo of payload.repositories_added || []) {
          const [owner, name] = repo.full_name.split('/');
          if (owner && name) await upsertRepository(owner, name, installationId, 'github');
        }
      }
      if (action === 'removed') {
        for (const repo of payload.repositories_removed || []) {
          await db.repository.updateMany({ where: { fullName: repo.full_name }, data: { isActive: false } });
        }
      }
      return NextResponse.json({ message: 'Installation repositories updated' });
    }

    // Handle pull_request events
    if (event === 'pull_request') {
      const action = payload.action;
      if (action === 'opened' || action === 'synchronize') {
        const pr = payload.pull_request;
        const owner = payload.repository?.owner?.login;
        const repo = payload.repository?.name;
        const installationId = payload.installation?.id;
        const headSha = pr?.head?.sha;

        // Validate owner/repo to prevent path traversal
        if (owner && repo && pr && headSha && validateRepoParams(owner, repo)) {
          // Process review synchronously (serverless-compatible)
          // GitHub webhooks expect a quick response, but also need the review.
          // We process in the background and respond immediately for PR events,
          // since GitHub will retry if the response is slow.
          processReview(
            owner, repo, pr.number, pr.title, pr.user?.login || 'unknown', pr.html_url, headSha, installationId
          ).catch((err) => console.error('Review processing error:', { pr: pr.number, error: err }));

          return NextResponse.json({ message: 'Review processing started', pr: pr.number });
        }
      }
    }

    // Handle issue_comment events (PR comments with commands like /review, /recheck)
    if (event === 'issue_comment') {
      const action = payload.action;
      // Only handle 'created' actions (not edited/deleted) and only on PRs (not issues)
      if (action === 'created' && payload.issue?.pull_request) {
        const commentBody = payload.comment?.body || '';
        const { isCommand, args } = parseCommentCommand(commentBody);

        if (isCommand) {
          const owner = payload.repository?.owner?.login;
          const repo = payload.repository?.name;
          const installationId = payload.installation?.id;
          const prNumber = payload.issue?.number;
          const commentId = payload.comment?.id;
          const commenter = payload.comment?.user?.login;

          if (owner && repo && prNumber && validateRepoParams(owner, repo)) {
            // Post acknowledgment
            try {
              await postPRComment(
                owner, repo, prNumber,
                `Re-review triggered by @${commenter} using \`${isCommand ? commentBody.trim().split(' ')[0] : '/review'}\`${args ? ` — focusing on: ${args}` : ''}\n\nReviewing now...`,
                installationId
              );
            } catch { /* */ }

            // Determine focus file and question from args
            let focusFile: string | undefined;
            let focusQuestion: string | undefined;

            if (args) {
              // Check if args looks like a file path
              if (args.includes('/') || args.includes('.ts') || args.includes('.js') || args.includes('.py') || args.includes('.go') || args.includes('.rs')) {
                focusFile = args.split(' ')[0];
                focusQuestion = args.substring(focusFile.length).trim() || undefined;
              } else {
                focusQuestion = args;
              }
            }

            // Fetch PR info for headSha
            let headSha = '';
            try {
              const prInfo = await fetchPRInfo(owner, repo, prNumber, installationId);
              headSha = prInfo.headSha;

              processReview(
                owner, repo, prNumber, prInfo.title, prInfo.author, prInfo.url, headSha, installationId,
                true, // isReReview
                focusFile,
                focusQuestion,
                commentId
              ).catch(console.error);
            } catch {
              processReview(
                owner, repo, prNumber, payload.issue?.title || '', commenter || 'unknown', payload.issue?.html_url || '', '', installationId,
                true, focusFile, focusQuestion, commentId
              ).catch(console.error);
            }

            return NextResponse.json({ message: 'Re-review triggered by comment command', pr: prNumber });
          }
        }
      }
    }

    // Handle pull_request_review_comment events (replies to inline review comments)
    if (event === 'pull_request_review_comment') {
      const action = payload.action;
      if (action === 'created') {
        const commentBody = payload.comment?.body || '';
        const { isCommand, args } = parseCommentCommand(commentBody);

        if (isCommand) {
          const owner = payload.repository?.owner?.login;
          const repo = payload.repository?.name;
          const installationId = payload.installation?.id;
          const prNumber = payload.pull_request?.number;
          const commentId = payload.comment?.id;
          const filePath = payload.comment?.path;
          const commenter = payload.comment?.user?.login;

          if (owner && repo && prNumber && validateRepoParams(owner, repo)) {
            let headSha = '';
            try {
              const prInfo = await fetchPRInfo(owner, repo, prNumber, installationId);
              headSha = prInfo.headSha;
            } catch { /* */ }

            processReview(
              owner, repo, prNumber, '', commenter || 'unknown', '', headSha, installationId,
              true,
              filePath, // Focus on the file the comment is on
              args || `Re-check this code at ${filePath}`,
              commentId
            ).catch(console.error);

            return NextResponse.json({ message: 'Re-review triggered by review comment command', pr: prNumber });
          }
        }
      }
    }

    // Handle check_run rerequested events
    if (event === 'check_run') {
      const action = payload.action;
      if (action === 'rerequested') {
        const checkRun = payload.check_run;
        const owner = payload.repository?.owner?.login;
        const repo = payload.repository?.name;
        const installationId = payload.installation?.id;
        const prNumber = checkRun?.pull_requests?.[0]?.number;
        const headSha = checkRun?.head_sha;

        if (owner && repo && prNumber && headSha && validateRepoParams(owner, repo)) {
          try {
            const prInfo = await fetchPRInfo(owner, repo, prNumber, installationId);
            processReview(owner, repo, prNumber, prInfo.title, prInfo.author, prInfo.url, headSha, installationId).catch((err) => console.error('Re-review error:', { pr: prNumber, error: err }));
            return NextResponse.json({ message: 'Re-review processing started', pr: prNumber });
          } catch {
            return NextResponse.json({ error: 'Failed to fetch PR info for re-review' }, { status: 500 });
          }
        }
      }
    }

    return NextResponse.json({ message: 'Event ignored' });
  } catch (error) {
    console.error('Webhook error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

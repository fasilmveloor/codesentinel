import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import { db } from '@/lib/db';
import { fetchPRDiff, fetchPRInfo, upsertRepository, postPRReview, postPRComment, replyToReviewComment, createCheckRun, updateCheckRun } from '@/lib/github';
import { reviewPR } from '@/lib/reviewer';
import { checkRateLimit } from '@/lib/rate-limit';
import { REPO_NAME_REGEX, GITHUB_REVIEW_BODY_MAX, GITHUB_ANNOTATION_LIMIT, REVIEW_TIMEOUT_MS } from '@/lib/constants';
import { withTimeout } from '@/lib/review-timeout';

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
const COMMENT_COMMANDS = ['/review', '/recheck', '/check', '/re-review', '/review again', '/help', '/fix', '/explain', '/ignore'];

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

// --- Main Review Processing ---

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
  commentId?: number,
  reviewMode?: 'fix' | 'explain'
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
          { output: { title: 'CodeSentinel Review: In Progress', summary: `Reviewing PR #${prNumber}: ${prTitle}` } },
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

    // Wrap AI review with timeout to prevent stuck "reviewing" status
    const result = await withTimeout(
      reviewPR(diff, prInfo, {
      platform: 'github',
      owner,
      repo,
      prNumber,
      installationId,
      diff,
      repositoryId,
      focusFile,
      focusQuestion,
      reviewMode,
    }),
      REVIEW_TIMEOUT_MS,
      reviewId
    );

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
          line: c.line as number,
          side: c.side || 'RIGHT',
          body: truncateForGitHub(`[**${c.severity?.toUpperCase() || 'INFO'}**] ${c.body}`, 5000),
        }));

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
            .filter((s) => s.step !== 'synthesis') // Skip raw synthesis in comment
            .map((s, i) => {
              const label = stepLabels[s.step] || s.step;
              const toolLabel = s.tool ? ` \`${s.tool}\`` : '';
              const reasoningText = s.reasoning ? ` — ${s.reasoning}` : '';
              const conclusionText = s.conclusion ? `\n   > ${s.conclusion}` : '';
              return `${i + 1}. **${label}**${toolLabel} ${s.description}${reasoningText}${conclusionText}`;
            })
            .join('\n');

          reasoningTrace = `\n\n<details>\n<summary>🔍 Investigation Trace</summary>\n\n${traceLines}\n\n_Tokens used: ~${result.tokensUsed} | Model: ${result.modelUsed} | Steps: ${steps.length}_\n</details>`;
        }
      } catch { /* Gracefully skip if trace fails */ }

      const baseBody = isReReview
        ? `**Re-review** ${focusQuestion ? `(@ ${focusQuestion})` : ''}\n\n${result.summary}`
        : result.summary;

      const reviewBody = truncateForGitHub(
        baseBody + reasoningTrace,
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
            `**Re-review complete** ${result.overallScore === 'approve' ? '✅' : result.overallScore === 'request_changes' ? '⚠️' : '💬'}\n\n${result.summary}`,
            installationId
          );
        } catch { /* */ }
      }
    }

    // Update check run based on review result (only if merge blocking is enabled)
    if (checkRunId) {
      try {
        const titleMap: Record<string, string> = {
          approve: 'CodeSentinel Review: Approved',
          request_changes: 'CodeSentinel Review: Changes Requested',
          comment: 'CodeSentinel Review: Comment',
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
            start_line: c.line as number,
            end_line: c.line as number,
            annotation_level: severityToAnnotationLevel(c.severity),
            message: c.body,
          }));

        await updateCheckRun(
          owner, repo, checkRunId, 'completed',
          {
            conclusion: conclusionMap[result.overallScore] || 'neutral',
            output: {
              title: titleMap[result.overallScore] || 'CodeSentinel Review: Comment',
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
          output: { title: 'CodeSentinel Review: Error', summary: `Review failed: ${error instanceof Error ? error.message : 'Unknown error'}` },
        }, installationId);
      } catch { /* */ }
    }
  }
}

// --- Webhook Handler ---

export async function POST(request: NextRequest) {
  // Rate limiting (MUST await — checkRateLimit is async and returns Promise<boolean>)
  const clientIp = request.headers.get('x-forwarded-for') || request.headers.get('x-real-ip') || 'unknown';
  if (!(await checkRateLimit(clientIp))) {
    return NextResponse.json({ error: 'Rate limit exceeded' }, { status: 429 });
  }

  try {
    const body = await request.text();

    // Verify webhook signature (REQUIRED — no secret means no auth)
    const secretConfig = await db.appConfig.findUnique({ where: { key: 'webhook_secret' } });
    if (!secretConfig?.value) {
      console.error('SECURITY: No webhook_secret configured — rejecting all webhook requests');
      return NextResponse.json({ error: 'Webhook secret not configured' }, { status: 401 });
    }
    const signature = request.headers.get('x-hub-signature-256');
    if (!signature || !verifySignature(body, signature, secretConfig.value)) {
      return NextResponse.json({ error: 'Invalid signature' }, { status: 401 });
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

          // Handle /help command
          const trimmed = commentBody.trim().toLowerCase();
          if (trimmed.startsWith('/help')) {
            const helpText = `**CodeSentinel Commands**\n\n| Command | Description |\n|---|---|\n| \`/review\` | Start a full review |\n| \`/recheck\` | Re-review after changes |\n| \`/check\` | Quick check |\n| \`/re-review\` | Full re-review |\n| \`/fix\` | Get fix suggestions |\n| \`/explain\` | Explain the code |\n| \`/ignore\` | Suppress reviews on files |\n| \`/help\` | Show this help |\n\nYou can also specify a file or question: \`/check src/auth.ts\` or \`/review please verify error handling\``;
            try {
              await postPRComment(owner, repo, prNumber, helpText, installationId);
            } catch { /* */ }
            return NextResponse.json({ message: 'Help posted', pr: prNumber });
          }

          // Handle /ignore command
          if (trimmed.startsWith('/ignore')) {
            const ignoreArgs = commentBody.trim().substring(7).trim();
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
                await postPRComment(owner, repo, prNumber, confirmText, installationId);
              } catch { /* */ }
            } catch { /* */ }
            return NextResponse.json({ message: 'Ignore patterns updated', pr: prNumber });
          }

          if (owner && repo && prNumber && validateRepoParams(owner, repo)) {
            // Determine review mode from command
            let reviewMode: 'fix' | 'explain' | undefined;
            if (trimmed.startsWith('/fix')) {
              reviewMode = 'fix';
            } else if (trimmed.startsWith('/explain')) {
              reviewMode = 'explain';
            }

            // Post acknowledgment
            try {
              const modeLabel = reviewMode === 'fix' ? '🔧 Fix suggestions' : reviewMode === 'explain' ? '📖 Code explanation' : '🔄 Re-review';
              await postPRComment(
                owner, repo, prNumber,
                `${modeLabel} triggered by @${commenter} using \`${isCommand ? commentBody.trim().split(' ')[0] : '/review'}\`${args ? ` — focusing on: ${args}` : ''}\n\nReviewing now...`,
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
                commentId,
                reviewMode
              ).catch(console.error);
            } catch {
              processReview(
                owner, repo, prNumber, payload.issue?.title || '', commenter || 'unknown', payload.issue?.html_url || '', '', installationId,
                true, focusFile, focusQuestion, commentId, reviewMode
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
            // Determine review mode from command
            const reviewCommentTrimmed = commentBody.trim().toLowerCase();
            let reviewMode: 'fix' | 'explain' | undefined;
            if (reviewCommentTrimmed.startsWith('/fix')) {
              reviewMode = 'fix';
            } else if (reviewCommentTrimmed.startsWith('/explain')) {
              reviewMode = 'explain';
            }

            // Handle /help command
            if (reviewCommentTrimmed.startsWith('/help')) {
              const helpText = `**CodeSentinel Commands**\n\n| Command | Description |\n|---|---|\n| \`/review\` | Start a full review |\n| \`/recheck\` | Re-review after changes |\n| \`/check\` | Quick check |\n| \`/re-review\` | Full re-review |\n| \`/fix\` | Get fix suggestions |\n| \`/explain\` | Explain the code |\n| \`/ignore\` | Suppress reviews on files |\n| \`/help\` | Show this help |\n\nYou can also specify a file or question: \`/check src/auth.ts\``;
              try {
                await postPRComment(owner, repo, prNumber, helpText, installationId);
              } catch { /* */ }
              return NextResponse.json({ message: 'Help posted', pr: prNumber });
            }

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
              commentId,
              reviewMode
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

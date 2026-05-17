import ZAI from 'z-ai-web-dev-sdk';
import { db } from './db';
import { AI_API_TIMEOUT, FILE_CONTENT_TRUNCATE, DIFF_MAX_LENGTH, GITHUB_API_TIMEOUT } from './constants';

// --- Types ---

export interface ReviewCommentResult {
  filePath: string;
  line: number | null;
  side: 'LEFT' | 'RIGHT' | null;
  body: string;
  severity: 'info' | 'warning' | 'error' | 'critical';
}

export interface AgentStep {
  step: string;
  description: string;
  tool?: string;
  timestamp: string;
}

export interface ReviewResult {
  summary: string;
  overallScore: 'approve' | 'request_changes' | 'comment';
  comments: ReviewCommentResult[];
  agentSteps: AgentStep[];
  modelUsed: string;
  tokensUsed: number;
}

export interface ToolContext {
  platform: 'github' | 'gitlab';
  owner: string;
  repo: string;
  prNumber: number;
  diff: string;
  installationId?: number;
  gitlabHost?: string;
  // For targeted re-reviews triggered by comment commands
  focusFile?: string;
  focusQuestion?: string;
}

// AI Provider configuration
interface AIProviderConfig {
  provider: 'z-ai' | 'openai-compatible';
  model: string;
  apiKey?: string;
  baseUrl?: string;
  temperature: number;
  maxSteps: number;
}

// --- Agent Tools ---

const AGENT_TOOLS = [
  { name: 'fetch_file', description: 'Fetch the full content of a file from the repository', parameters: ['filePath', 'ref'] },
  { name: 'search_pattern', description: 'Search for a regex pattern in the PR diff', parameters: ['pattern'] },
  { name: 'check_tests', description: 'Check if test files exist for a given source file', parameters: ['filePath'] },
  { name: 'analyze_deps', description: 'Analyze dependency changes for potential issues', parameters: ['filePath'] },
];

// --- Review Output Schema ---

const REVIEW_OUTPUT_SCHEMA = `{
  "action": "final_review",
  "summary": "Overall summary (2-4 sentences)",
  "overallScore": "approve" | "request_changes" | "comment",
  "comments": [
    {
      "filePath": "path/to/file",
      "line": 42,
      "side": "RIGHT",
      "body": "Detailed feedback",
      "severity": "info" | "warning" | "error" | "critical"
    }
  ]
}`;

// --- System Prompts ---

const AGENT_SYSTEM_PROMPT = `You are an expert AI code review agent. You review Pull Requests using a systematic approach.

## Your Review Process

### Step 1: ANALYZE
Carefully read the diff. Identify:
- What changed and why
- Which files are most critical
- What needs deeper investigation

### Step 2: INVESTIGATE
Use your available tools to gather more context:
- fetch_file: Get full file content for files with partial context
- search_pattern: Find related code patterns in the diff
- check_tests: Verify test coverage for changed files
- analyze_deps: Check dependency changes

To use a tool, respond with a JSON block:
\`\`\`json
{
  "action": "tool_call",
  "tool": "tool_name",
  "parameters": { "param1": "value1" }
}
\`\`\`

### Step 3: REVIEW
After gathering context, provide your final review as:
\`\`\`json
${REVIEW_OUTPUT_SCHEMA}
\`\`\`

## Review Categories
1. Bugs and Logic Errors
2. Security Vulnerabilities
3. Code Style and Best Practices
4. Performance Issues
5. Missing Error Handling
6. Test Coverage Suggestions

## Guidelines
- Use "approve" only if the code is well-written with no significant issues
- Use "request_changes" if there are bugs, security vulnerabilities, or major issues
- Use "comment" for general feedback
- Severity: critical (security/data loss), error (bugs), warning (best practices), info (suggestions)
- Be constructive and specific
- Only comment on actual issues, not on every line`;

const FOCUSED_REVIEW_PROMPT = `You are an expert AI code review agent. A developer has asked you to re-examine a specific part of the code.

The developer's question or request is provided below. Focus your review on addressing their concern.

Respond with a JSON block:
\`\`\`json
${REVIEW_OUTPUT_SCHEMA}
\`\`\`

Be concise and directly address the developer's question. If the concern is valid, acknowledge it and provide feedback. If not, explain why.`;

// --- Helper: Get AI config ---

async function getAIConfig(): Promise<AIProviderConfig> {
  try {
    const [providerConfig, modelConfig, apiKeyConfig, baseUrlConfig, tempConfig, stepsConfig] = await Promise.all([
      db.appConfig.findUnique({ where: { key: 'ai_provider' } }),
      db.appConfig.findUnique({ where: { key: 'ai_model' } }),
      db.appConfig.findUnique({ where: { key: 'ai_api_key' } }),
      db.appConfig.findUnique({ where: { key: 'ai_base_url' } }),
      db.appConfig.findUnique({ where: { key: 'ai_temperature' } }),
      db.appConfig.findUnique({ where: { key: 'ai_max_steps' } }),
    ]);
    const provider = (providerConfig?.value as AIProviderConfig['provider']) || 'z-ai';
    return {
      provider,
      model: modelConfig?.value || 'default',
      apiKey: apiKeyConfig?.value || undefined,
      baseUrl: baseUrlConfig?.value || undefined,
      temperature: parseFloat(tempConfig?.value || '0.3'),
      maxSteps: parseInt(stepsConfig?.value || '5', 10),
    };
  } catch {
    return { provider: 'z-ai', model: 'default', temperature: 0.3, maxSteps: 5 };
  }
}

// --- Helper: OpenAI-compatible completion ---

async function openAICompatibleCompletion(
  config: AIProviderConfig,
  messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>
): Promise<string> {
  if (!config.baseUrl) {
    throw new Error('Base URL is required for OpenAI-compatible provider');
  }
  if (!config.apiKey) throw new Error('API key is required for OpenAI-compatible provider');

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), AI_API_TIMEOUT);

  try {
    const response = await fetch(`${config.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: config.model === 'default' ? 'default' : config.model,
        messages,
        temperature: config.temperature,
      }),
      signal: controller.signal,
    });
    clearTimeout(timeoutId);

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`OpenAI-compatible API error: ${response.status} - ${errorText}`);
    }
    const data = await response.json();
    return data.choices?.[0]?.message?.content || '';
  } catch (err) {
    clearTimeout(timeoutId);
    throw err;
  }
}

// --- Unified chat completion ---

async function chatCompletion(
  config: AIProviderConfig,
  messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>,
  zaiInstance?: ZAI | null
): Promise<string> {
  if (config.provider === 'openai-compatible') {
    return openAICompatibleCompletion(config, messages);
  }
  const zai = zaiInstance || await ZAI.create();
  const completion = await zai.chat.completions.create({ messages });
  return completion.choices?.[0]?.message?.content || '';
}

function getModelDisplayName(config: AIProviderConfig): string {
  if (config.provider === 'openai-compatible') {
    const model = config.model === 'default' ? 'unknown' : config.model;
    const provider = config.baseUrl?.includes('oencode') ? 'oencode' : 'openai-compatible';
    return `${model} via ${provider}`;
  }
  return config.model === 'advanced' ? 'z-ai-advanced' : 'z-ai-default';
}

// --- Helper: Get tokens ---

async function getGitHubToken(installationId?: number): Promise<string | null> {
  try {
    if (installationId) {
      const { getInstallationToken } = await import('./github');
      return await getInstallationToken(installationId);
    }
    const tokenConfig = await db.appConfig.findUnique({ where: { key: 'github_token' } });
    return tokenConfig?.value || null;
  } catch {
    return null;
  }
}

async function getGitLabToken(): Promise<{ token: string; host: string } | null> {
  try {
    const [tokenConfig, hostConfig] = await Promise.all([
      db.appConfig.findUnique({ where: { key: 'gitlab_token' } }),
      db.appConfig.findUnique({ where: { key: 'gitlab_host' } }),
    ]);
    if (!tokenConfig?.value) return null;
    return { token: tokenConfig.value, host: hostConfig?.value || 'https://gitlab.com' };
  } catch {
    return null;
  }
}

// --- Tool Executor ---

async function executeTool(
  toolName: string,
  params: Record<string, string>,
  context: ToolContext
): Promise<string> {
  switch (toolName) {
    case 'fetch_file': {
      const filePath = params.filePath;
      const ref = params.ref || 'HEAD';

      if (context.platform === 'github') {
        const token = await getGitHubToken(context.installationId);
        if (!token) return 'Error: No GitHub authentication configured.';
        try {
          const controller = new AbortController();
          const timeoutId = setTimeout(() => controller.abort(), GITHUB_API_TIMEOUT);
          const response = await fetch(
            `https://api.github.com/repos/${context.owner}/${context.repo}/contents/${filePath}?ref=${ref}`,
            {
              headers: {
                Authorization: `Bearer ${token}`,
                Accept: 'application/vnd.github.v3+json',
                'User-Agent': 'AI-PR-Reviewer',
              },
              signal: controller.signal,
            }
          );
          clearTimeout(timeoutId);
          if (!response.ok) return `Error: Failed to fetch file (${response.status}).`;
          const data = await response.json();
          if (data.type === 'file' && data.content) {
            const content = Buffer.from(data.content, 'base64').toString('utf-8');
            return content.length > FILE_CONTENT_TRUNCATE
              ? content.substring(0, FILE_CONTENT_TRUNCATE) + '\n... (truncated)'
              : content;
          }
          return 'Error: Not a file or no content available.';
        } catch (err) {
          const msg = err instanceof Error ? err.message : 'Unknown error';
          if (msg.includes('abort')) return 'Error: Fetch timed out';
          return `Error fetching file: ${msg}`;
        }
      } else {
        const gitlab = await getGitLabToken();
        if (!gitlab) return 'Error: No GitLab authentication configured.';
        try {
          const projectId = encodeURIComponent(`${context.owner}/${context.repo}`);
          const encodedPath = encodeURIComponent(filePath);
          const response = await fetch(
            `${gitlab.host}/api/v4/projects/${projectId}/repository/files/${encodedPath}?ref=${ref}`,
            { headers: { 'PRIVATE-TOKEN': gitlab.token, 'User-Agent': 'AI-PR-Reviewer' } }
          );
          if (!response.ok) return `Error: Failed to fetch file (${response.status}).`;
          const data = await response.json();
          if (data.content) {
            const content = Buffer.from(data.content, 'base64').toString('utf-8');
            return content.length > 8000 ? content.substring(0, 8000) + '\n... (truncated)' : content;
          }
          return 'Error: No content available.';
        } catch (err) {
          return `Error fetching file: ${err instanceof Error ? err.message : 'Unknown error'}`;
        }
      }
    }

    case 'search_pattern': {
      const pattern = params.pattern;
      try {
        const regex = new RegExp(pattern, 'gm');
        const matches = context.diff.match(regex);
        if (!matches) return 'No matches found for the given pattern.';
        const lines = context.diff.split('\n');
        const matchedLines: string[] = [];
        const lineRegex = new RegExp(pattern);
        for (let i = 0; i < lines.length; i++) {
          if (lineRegex.test(lines[i])) {
            const start = Math.max(0, i - 2);
            const end = Math.min(lines.length - 1, i + 2);
            for (let j = start; j <= end; j++) {
              matchedLines.push(`L${j + 1}: ${lines[j]}`);
            }
            matchedLines.push('---');
          }
        }
        return `Found ${matches.length} match(es):\n${matchedLines.slice(0, 50).join('\n')}`;
      } catch {
        return 'Invalid regex pattern provided.';
      }
    }

    case 'check_tests': {
      const filePath = params.filePath;
      const dir = filePath.substring(0, filePath.lastIndexOf('/')) || '.';
      const basename = filePath.substring(filePath.lastIndexOf('/') + 1);
      const ext = basename.includes('.') ? '.' + basename.split('.').pop() : '';
      const nameWithoutExt = ext ? basename.substring(0, basename.length - ext.length) : basename;

      const testPatterns = [
        `${dir}/${nameWithoutExt}.test${ext}`,
        `${dir}/${nameWithoutExt}.spec${ext}`,
        `${dir}/__tests__/${nameWithoutExt}.test${ext}`,
        `${dir}/tests/${nameWithoutExt}.test${ext}`,
      ];

      const found: string[] = [];
      const notFound: string[] = [];

      for (const testPath of testPatterns) {
        try {
          let exists = false;
          if (context.platform === 'github') {
            const token = await getGitHubToken(context.installationId);
            if (token) {
              const resp = await fetch(
                `https://api.github.com/repos/${context.owner}/${context.repo}/contents/${testPath}`,
                { headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github.v3+json', 'User-Agent': 'AI-PR-Reviewer' }, method: 'HEAD' }
              );
              exists = resp.ok;
            }
          } else {
            const gitlab = await getGitLabToken();
            if (gitlab) {
              const projectId = encodeURIComponent(`${context.owner}/${context.repo}`);
              const encodedPath = encodeURIComponent(testPath);
              const resp = await fetch(
                `${gitlab.host}/api/v4/projects/${projectId}/repository/files/${encodedPath}?ref=main`,
                { headers: { 'PRIVATE-TOKEN': gitlab.token, 'User-Agent': 'AI-PR-Reviewer' }, method: 'HEAD' }
              );
              exists = resp.ok;
            }
          }
          if (exists) found.push(testPath);
          else notFound.push(testPath);
        } catch {
          notFound.push(testPath);
        }
      }

      if (found.length > 0) {
        return `Test files found for ${filePath}:\n${found.map(t => `  Found: ${t}`).join('\n')}`;
      }
      return `No test files found for ${filePath}. Consider adding tests.`;
    }

    case 'analyze_deps': {
      const filePath = params.filePath;
      const diffLines = context.diff.split('\n');
      let inTargetFile = false;
      let fileContent = '';

      for (const line of diffLines) {
        if (line.startsWith('diff --git') || line.startsWith('---') || line.startsWith('+++')) {
          if (line.includes(filePath) || line.includes(filePath.split('/').pop() || '')) {
            inTargetFile = true;
          } else if (inTargetFile) {
            inTargetFile = false;
          }
        }
        if (inTargetFile) fileContent += line + '\n';
      }

      if (!fileContent) {
        const fetchResult = await executeTool('fetch_file', { filePath }, context);
        fileContent = fetchResult;
      }

      const issues: string[] = [];
      const warnings: string[] = [];

      if (filePath.includes('package.json') || fileContent.includes('"dependencies"')) {
        const knownVulnerable: Record<string, string> = {
          'lodash@': '<4.17.21 may have prototype pollution',
          'express@': '<4.17.3 has open redirect vulnerability',
          'moment@': 'Deprecated - consider using date-fns or dayjs',
          'node-sass@': 'Deprecated - use sass (dart-sass) instead',
          'request@': 'Deprecated - use node-fetch or axios',
        };
        for (const [pkg, issue] of Object.entries(knownVulnerable)) {
          if (fileContent.includes(pkg)) issues.push(`${pkg}: ${issue}`);
        }
      }

      let result = `Dependency analysis for ${filePath}:`;
      if (issues.length > 0) result += `\n\nIssues:\n${issues.map(i => `  - ${i}`).join('\n')}`;
      if (warnings.length > 0) result += `\n\nWarnings:\n${warnings.map(w => `  - ${w}`).join('\n')}`;
      if (issues.length === 0 && warnings.length === 0) result += '\n\nNo obvious dependency issues found.';
      return result;
    }

    default:
      return `Unknown tool: ${toolName}. Available: ${AGENT_TOOLS.map(t => t.name).join(', ')}`;
  }
}

// --- Parse review from content ---

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

// --- Build ReviewResult ---

function buildReviewResult(
  parsed: Record<string, unknown>,
  agentSteps: AgentStep[],
  modelUsed: string,
  totalTokens: number
): ReviewResult {
  agentSteps.push({
    step: 'review',
    description: `Produced final review: ${parsed.overallScore || 'comment'} with ${((parsed.comments || []) as Array<unknown>).length} comment(s)`,
    timestamp: new Date().toISOString(),
  });

  return {
    summary: (parsed.summary as string) || '',
    overallScore: (parsed.overallScore as 'approve' | 'request_changes' | 'comment') || 'comment',
    comments: ((parsed.comments || []) as Array<Record<string, unknown>>).map((c) => ({
      filePath: (c.filePath as string) || '',
      line: (c.line as number) || null,
      side: (c.side as 'LEFT' | 'RIGHT') || null,
      body: (c.body as string) || '',
      severity: (c.severity as 'info' | 'warning' | 'error' | 'critical') || 'info',
    })),
    agentSteps,
    modelUsed,
    tokensUsed: totalTokens,
  };
}

// --- Main Review Function ---

export async function reviewPR(
  diff: string,
  prInfo: {
    title: string;
    author: string;
    body: string;
    baseBranch: string;
    headBranch: string;
    additions: number;
    deletions: number;
    changedFiles: number;
  },
  context?: ToolContext
): Promise<ReviewResult> {
  const aiConfig = await getAIConfig();
  const modelUsed = getModelDisplayName(aiConfig);
  const agentSteps: AgentStep[] = [];
  const startTime = Date.now();

  let zaiInstance: ZAI | null = null;
  if (aiConfig.provider === 'z-ai') {
    zaiInstance = await ZAI.create();
  }

  // Determine if this is a focused re-review
  const isFocused = !!context?.focusQuestion || !!context?.focusFile;

  agentSteps.push({
    step: 'analyze',
    description: isFocused
      ? `Re-reviewing PR (focused): ${context?.focusFile || 'specific question'}`
      : `Analyzing PR: ${prInfo.title} (+${prInfo.additions} -${prInfo.deletions} across ${prInfo.changedFiles} files)`,
    timestamp: new Date().toISOString(),
  });

  // Build messages - truncate diff to a reasonable size
  const truncatedDiff = diff.substring(0, DIFF_MAX_LENGTH);
  const wasTruncated = diff.length > DIFF_MAX_LENGTH;

  const systemPrompt = isFocused ? FOCUSED_REVIEW_PROMPT : AGENT_SYSTEM_PROMPT;
  const messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = [
    { role: 'system', content: systemPrompt },
    {
      role: 'user',
      content: isFocused
        ? `Re-review this Pull Request with a specific focus:\n\n**Title**: ${prInfo.title}\n**Author**: ${prInfo.author}\n\n${context?.focusFile ? `**Focus File**: ${context.focusFile}\n` : ''}${context?.focusQuestion ? `**Developer's Question/Request**: ${context.focusQuestion}\n` : ''}\n**Diff**:\n\`\`\`diff\n${truncatedDiff}\n\`\`\`}`
        : `Review this Pull Request:\n\n**Title**: ${prInfo.title}\n**Author**: ${prInfo.author}\n**Branch**: ${prInfo.headBranch} → ${prInfo.baseBranch}\n**Changes**: +${prInfo.additions} -${prInfo.deletions} across ${prInfo.changedFiles} file(s)\n\n${prInfo.body ? `**Description**:\n${prInfo.body}\n` : ''}\n**Diff**:\n\`\`\`diff\n${truncatedDiff}\n\`\`\`${wasTruncated ? '\n\n(Note: Diff was truncated due to size)' : ''}`,
    },
  ];

  let totalTokens = 0;
  const maxSteps = Math.min(Math.max(aiConfig.maxSteps, 1), 10);

  for (let step = 0; step < maxSteps; step++) {
    const content = await chatCompletion(aiConfig, messages, zaiInstance);
    if (!content) throw new Error('No response from LLM');
    totalTokens += content.length;

    const parsed = parseReviewFromContent(content);

    if (parsed) {
      // Check for tool call
      if (parsed.action === 'tool_call' && context && step < maxSteps - 2) {
        const toolName = parsed.tool as string;
        const toolParams = (parsed.parameters || {}) as Record<string, string>;

        agentSteps.push({
          step: 'tool_call',
          description: `Called ${toolName} with ${JSON.stringify(toolParams)}`,
          tool: toolName,
          timestamp: new Date().toISOString(),
        });

        const toolResult = await executeTool(toolName, toolParams, { ...context, diff });
        messages.push({ role: 'assistant', content });
        messages.push({
          role: 'user',
          content: `Tool result for ${toolName}:\n\`\`\`\n${toolResult}\n\`\`\`\n\nContinue your review.`,
        });
        continue;
      }

      if (parsed.action === 'final_review' || parsed.overallScore) {
        agentSteps.push({
          step: 'reflect',
          description: 'Review findings validated',
          timestamp: new Date().toISOString(),
        });

        console.log(`Agent review completed in ${Date.now() - startTime}ms with ${agentSteps.length} steps`);
        return buildReviewResult(parsed, agentSteps, modelUsed, totalTokens);
      }
    }

    // No structured output found
    messages.push({ role: 'assistant', content });

    if (step === maxSteps - 1) {
      // Force final review on last step
      agentSteps.push({ step: 'force_final', description: 'Forcing structured output', timestamp: new Date().toISOString() });
      messages.push({
        role: 'user',
        content: `Please provide your final review now. You MUST respond with ONLY a JSON block:\n\`\`\`json\n${REVIEW_OUTPUT_SCHEMA}\n\`\`\``,
      });
      try {
        const finalContent = await chatCompletion(aiConfig, messages, zaiInstance);
        totalTokens += finalContent.length;
        const finalParsed = parseReviewFromContent(finalContent);
        if (finalParsed) {
          return buildReviewResult(finalParsed, agentSteps, modelUsed, totalTokens);
        }
      } catch { /* */ }
    } else {
      messages.push({
        role: 'user',
        content: 'Please continue. Either call a tool or provide your final review as JSON.',
      });
    }
  }

  // Fallback
  agentSteps.push({ step: 'fallback', description: 'Used fallback parsing', timestamp: new Date().toISOString() });
  return {
    summary: 'Review completed using fallback parsing.',
    overallScore: 'comment',
    comments: [],
    agentSteps,
    modelUsed,
    tokensUsed: totalTokens,
  };
}

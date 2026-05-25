import ZAI from 'z-ai-web-dev-sdk';
import { db } from './db';
import { AI_API_TIMEOUT, FILE_CONTENT_TRUNCATE, DIFF_MAX_LENGTH, GITHUB_API_TIMEOUT } from './constants';
import { logger } from '@/lib/logger';

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
  reasoning?: string;     // WHY the agent decided to take this step
  conclusion?: string;    // WHAT the agent concluded from this step
  evidence?: string;      // KEY evidence/snippet that informed the conclusion
  durationMs?: number;    // How long this step took
}

export interface TokenUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  /** Whether these are actual API-reported values or estimates */
  isEstimated: boolean;
}

export interface ReviewResult {
  summary: string;
  overallScore: 'approve' | 'request_changes' | 'comment';
  comments: ReviewCommentResult[];
  agentSteps: AgentStep[];
  modelUsed: string;
  tokensUsed: number;
  tokenUsage?: TokenUsage;
  hallucinationWarnings?: string[];
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
  // Repository ID for historical context lookups
  repositoryId?: string;
  // Review mode: 'fix' for fix suggestions, 'explain' for code explanation
  reviewMode?: 'fix' | 'explain';
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
  { name: 'file_relationships', description: 'Analyze which changed files import/reference each other to understand coupling and blast radius', parameters: [] },
  { name: 'historical_context', description: 'Fetch previous reviews for the same repository to provide context and identify recurring patterns', parameters: [] },
  { name: 'symbol_search', description: 'Search for function/class definitions and usages in the diff for symbol-aware navigation', parameters: ['symbol'] },
  { name: 'architectural_impact', description: 'Score the architectural impact of this PR by analyzing which layers are affected, coupling metrics, and risk assessment', parameters: [] },
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

Before calling a tool, always explain briefly why you need this information.
After receiving tool results, briefly note what you learned.

### Step 2: INVESTIGATE
Use your available tools to gather more context:
- fetch_file: Get full file content for files with partial context
- search_pattern: Find related code patterns in the diff
- check_tests: Verify test coverage for changed files
- analyze_deps: Check dependency changes
- file_relationships: Analyze import/reference relationships between changed files to understand coupling and blast radius
- historical_context: Fetch previous reviews for this repository to identify recurring patterns and past issues
- symbol_search: Find function/class definitions and usages in the diff for symbol-aware navigation
- architectural_impact: Score the architectural impact of this PR by analyzing which layers are affected, coupling metrics, and risk assessment

Before calling a tool, always explain briefly why you need this information.
After receiving tool results, briefly note what you learned.

To use a tool, respond with a JSON block:
\`\`\`json
{
  "action": "tool_call",
  "tool": "tool_name",
  "reasoning": "Brief explanation of why you need this tool",
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
- Only comment on actual issues, not on every line
- Before calling a tool, always explain briefly why you need this information
- After receiving tool results, briefly note what you learned`;

const FOCUSED_REVIEW_PROMPT = `You are an expert AI code review agent. A developer has asked you to re-examine a specific part of the code.

The developer's question or request is provided below. Focus your review on addressing their concern.

Respond with a JSON block:
\`\`\`json
${REVIEW_OUTPUT_SCHEMA}
\`\`\`

Be concise and directly address the developer's question. If the concern is valid, acknowledge it and provide feedback. If not, explain why.`;

const FIX_SUGGESTION_PROMPT = `You are an expert AI code review agent. A developer has asked you to suggest fixes for the issues in this code.

Instead of just pointing out problems, provide concrete fix suggestions with code examples where possible.

For each issue found, include:
1. The problem
2. A suggested fix (with code snippet if applicable)
3. Why the fix works

Respond with a JSON block:
\`\`\`json
${REVIEW_OUTPUT_SCHEMA}
\`\`\`

Focus on actionable fixes rather than just observations.`;

const EXPLAIN_CODE_PROMPT = `You are an expert AI code review agent. A developer has asked you to explain this code rather than review it.

Focus on:
1. What the code does and why
2. How the different parts connect
3. Any design patterns or architectural decisions
4. Potential areas of confusion

Respond with a JSON block:
\`\`\`json
${REVIEW_OUTPUT_SCHEMA}
\`\`\`

Use "comment" as the overallScore since this is an explanation, not a review. Use "info" severity for all comments since these are explanatory, not issues.`;

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

interface CompletionResponse {
  content: string;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

async function openAICompatibleCompletion(
  config: AIProviderConfig,
  messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>
): Promise<CompletionResponse> {
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
    const content = data.choices?.[0]?.message?.content || '';
    const usage = data.usage ? {
      prompt_tokens: data.usage.prompt_tokens || 0,
      completion_tokens: data.usage.completion_tokens || 0,
      total_tokens: data.usage.total_tokens || 0,
    } : undefined;
    return { content, usage };
  } catch (err) {
    clearTimeout(timeoutId);
    throw err;
  }
}

// --- Agent Context Management ---

const AGENT_CONTEXT_LIMIT_CHARS = 32000;

// --- Unified chat completion with retry ---

const MAX_RETRIES = 2;
const RETRY_DELAY_MS = 1000;

async function chatCompletion(
  config: AIProviderConfig,
  messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>,
  zaiInstance?: ZAI | null
): Promise<CompletionResponse> {
  let lastError: Error | null = null;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      if (config.provider === 'openai-compatible') {
        return await openAICompatibleCompletion(config, messages);
      }
      const zai = zaiInstance || await ZAI.create();
      const completion = await zai.chat.completions.create({ messages });
      const content = completion.choices?.[0]?.message?.content || '';
      // Extract actual token usage from z-ai SDK response
      const usage = completion.usage ? {
        prompt_tokens: (completion.usage as { prompt_tokens?: number }).prompt_tokens || 0,
        completion_tokens: (completion.usage as { completion_tokens?: number }).completion_tokens || 0,
        total_tokens: (completion.usage as { total_tokens?: number }).total_tokens || 0,
      } : undefined;
      return { content, usage };
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      if (attempt < MAX_RETRIES) {
        await new Promise(resolve => setTimeout(resolve, RETRY_DELAY_MS * (attempt + 1)));
      }
    }
  }
  throw lastError || new Error('Chat completion failed after retries');
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

// --- Helper: Escape regex special characters ---

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// --- Tool Executor ---

async function executeTool(
  toolName: string,
  params: Record<string, string>,
  context: ToolContext
): Promise<string> {
  // Security: Validate file paths to prevent traversal attacks
  const validateFilePath = (path: string): string | null => {
    if (!path || path.length === 0) return 'Error: No file path provided.';
    // Block path traversal attempts
    if (path.includes('..') || path.startsWith('/') || path.startsWith('\\')) {
      return `Error: Invalid file path "${path}" — path traversal is not allowed.`;
    }
    // Block null bytes
    if (path.includes('\0')) {
      return 'Error: Invalid file path — null bytes are not allowed.';
    }
    return null;
  };

  switch (toolName) {
    case 'fetch_file': {
      const filePath = params.filePath;
      const ref = params.ref || 'HEAD';

      // Path traversal validation
      const pathError = validateFilePath(filePath);
      if (pathError) return pathError;

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
                'User-Agent': 'CodeSentinel',
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
            { headers: { 'PRIVATE-TOKEN': gitlab.token, 'User-Agent': 'CodeSentinel' } }
          );
          if (!response.ok) return `Error: Failed to fetch file (${response.status}).`;
          const data = await response.json();
          if (data.content) {
            const content = Buffer.from(data.content, 'base64').toString('utf-8');
            return content.length > FILE_CONTENT_TRUNCATE
              ? content.substring(0, FILE_CONTENT_TRUNCATE) + '\n... (truncated)'
              : content;
          }
          return 'Error: No content available.';
        } catch (err) {
          return `Error fetching file: ${err instanceof Error ? err.message : 'Unknown error'}`;
        }
      }
    }

    case 'search_pattern': {
      const pattern = params.pattern;
      // ReDoS protection: reject overly complex or long patterns
      if (pattern.length > 200) {
        return 'Pattern too long (max 200 characters). Please use a more specific pattern.';
      }
      // Count quantifiers and alternations — crude complexity heuristic
      const complexityScore = (pattern.match(/[+*?{]/g) || []).length + (pattern.match(/\|/g) || []).length;
      if (complexityScore > 15) {
        return 'Pattern too complex (too many quantifiers/alternations). Simplify to avoid performance issues.';
      }
      try {
        const regex = new RegExp(pattern, 'gm');
        const matches = context.diff.match(regex);
        if (!matches) return 'No matches found for the given pattern.';
        const lines = context.diff.split('\n');
        const matchedLines: string[] = [];
        // Use a separate regex instance for line-by-line testing (stateful with /g flag)
        for (let i = 0; i < lines.length; i++) {
          const lineRegex = new RegExp(pattern);
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
      // Path traversal validation
      const checkTestsPathError = validateFilePath(filePath);
      if (checkTestsPathError) return checkTestsPathError;
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
                { headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github.v3+json', 'User-Agent': 'CodeSentinel' }, method: 'HEAD' }
              );
              exists = resp.ok;
            }
          } else {
            const gitlab = await getGitLabToken();
            if (gitlab) {
              const projectId = encodeURIComponent(`${context.owner}/${context.repo}`);
              const encodedPath = encodeURIComponent(testPath);
              const resp = await fetch(
                `${gitlab.host}/api/v4/projects/${projectId}/repository/files/${encodedPath}?ref=HEAD`,
                { headers: { 'PRIVATE-TOKEN': gitlab.token, 'User-Agent': 'CodeSentinel' }, method: 'HEAD' }
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
      // Path traversal validation
      const analyzeDepsPathError = validateFilePath(filePath);
      if (analyzeDepsPathError) return analyzeDepsPathError;
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

      const isManifest = filePath.includes('package.json') ||
        filePath.includes('requirements.txt') ||
        filePath.includes('Cargo.toml') ||
        filePath.includes('go.mod') ||
        filePath.includes('Gemfile') ||
        filePath.includes('pom.xml') ||
        filePath.includes('build.gradle') ||
        fileContent.includes('"dependencies"') ||
        fileContent.includes('"devDependencies"');

      if (isManifest) {
        // Known deprecated / vulnerable packages
        const knownVulnerable: Record<string, string> = {
          'lodash@': '<4.17.21 may have prototype pollution',
          'express@': '<4.17.3 has open redirect vulnerability',
          'moment@': 'Deprecated - consider using date-fns or dayjs',
          'node-sass@': 'Deprecated - use sass (dart-sass) instead',
          'request@': 'Deprecated - use node-fetch or axios',
          'core-js@2': 'core-js@2 is deprecated, use core-js@3',
          'rxjs@5': 'RxJS 5 is outdated, migrate to RxJS 7+',
          'angular@1': 'AngularJS 1.x is EOL, migrate to Angular 14+',
          'jquery@2': 'jQuery 2.x is outdated, upgrade to 3.x',
          'babel-core@': 'babel-core is Babel 6, use @babel/core for Babel 7+',
        };
        for (const [pkg, issue] of Object.entries(knownVulnerable)) {
          if (fileContent.includes(pkg)) issues.push(`${pkg}: ${issue}`);
        }

        // Detect major version jumps in diff lines
        const addedDeps: string[] = [];
        const removedDeps: string[] = [];
        for (const line of diffLines) {
          if (line.startsWith('+') && !line.startsWith('++') && line.includes('"')) {
            addedDeps.push(line);
          }
          if (line.startsWith('-') && !line.startsWith('--') && line.includes('"')) {
            removedDeps.push(line);
          }
        }
        if (addedDeps.length > 0) {
          warnings.push(`${addedDeps.length} new/updated dependenc(ies) added — verify version pinning`);
        }
        if (removedDeps.length > 0 && addedDeps.length === 0) {
          warnings.push(`${removedDeps.length} dependenc(ies) removed — verify no breaking changes for consumers`);
        }
      }

      let result = `Dependency analysis for ${filePath}:`;
      if (issues.length > 0) result += `\n\nIssues:\n${issues.map(i => `  - ${i}`).join('\n')}`;
      if (warnings.length > 0) result += `\n\nWarnings:\n${warnings.map(w => `  - ${w}`).join('\n')}`;
      if (issues.length === 0 && warnings.length === 0) result += '\n\nNo obvious dependency issues found.';
      return result;
    }

    case 'file_relationships': {
      try {
        const diffLines = context.diff.split('\n');
        const changedFiles: string[] = [];

        // Parse changed files from diff headers
        for (const line of diffLines) {
          const match = line.match(/^\+\+\+ b\/(.+)$/);
          if (match) {
            changedFiles.push(match[1]);
          }
        }

        if (changedFiles.length === 0) {
          return 'No changed files found in the diff.';
        }

        // Build import map: for each changed file, find what it imports from other changed files
        const importMap: Record<string, string[]> = {};
        const reverseImportMap: Record<string, string[]> = {};

        // Regex patterns for import/require statements
        const importPatterns = [
          /(?:import|from)\s+['"]([^'"]+)['"]/g,                          // ES imports: import X from 'path' / from 'path'
          /require\s*\(\s*['"]([^'"]+)['"]\s*\)/g,                      // CommonJS: require('path')
          /(?:include|require_relative)\s+['"]([^'"]+)['"]/g,             // Ruby
          /from\s+['"]([^'"]+)['"]\s+import/g,                             // Python-style (reversed)
          /import\s+['"]([^'"]+)['"]/g,                                     // Python: import 'module'
        ];

        let currentFile = '';
        for (const line of diffLines) {
          const fileHeader = line.match(/^\+\+\+ b\/(.+)$/);
          if (fileHeader) {
            currentFile = fileHeader[1];
            if (!importMap[currentFile]) importMap[currentFile] = [];
            continue;
          }

          if (!currentFile || !line.startsWith('+') || line.startsWith('+++')) continue;

          for (const pattern of importPatterns) {
            pattern.lastIndex = 0;
            let importMatch;
            while ((importMatch = pattern.exec(line)) !== null) {
              const importPath = importMatch[1];
              // Resolve relative imports to potential changed files
              if (importPath.startsWith('.')) {
                // Attempt to resolve relative path against current file's directory
                const currentDir = currentFile.substring(0, currentFile.lastIndexOf('/')) || '.';
                const resolved = (currentDir + '/' + importPath).replace(/\/\.\//g, '/').replace(/[^/]+\/\.\.\//g, '');

                // Check if resolved path matches any changed file (with or without extension)
                for (const cf of changedFiles) {
                  const cfNoExt = cf.replace(/\.[^.]+$/, '');
                  if (cf === resolved || cf === resolved + '.ts' || cf === resolved + '.js' ||
                      cf === resolved + '.tsx' || cf === resolved + '.jsx' ||
                      cf === resolved + '.py' || cf === resolved + '.rb' ||
                      cfNoExt === resolved) {
                    if (!importMap[currentFile].includes(cf)) {
                      importMap[currentFile].push(cf);
                    }
                    if (!reverseImportMap[cf]) reverseImportMap[cf] = [];
                    if (!reverseImportMap[cf].includes(currentFile)) {
                      reverseImportMap[cf].push(currentFile);
                    }
                  }
                }
              }
            }
          }
        }

        // Identify clusters using simple connected-components
        const visited = new Set<string>();
        const clusters: string[][] = [];
        for (const file of changedFiles) {
          if (visited.has(file)) continue;
          const cluster: string[] = [];
          const queue = [file];
          while (queue.length > 0) {
            const current = queue.shift();
            if (!current) continue;
            if (visited.has(current)) continue;
            visited.add(current);
            cluster.push(current);
            const neighbors = [...(importMap[current] || []), ...(reverseImportMap[current] || [])];
            for (const neighbor of neighbors) {
              if (!visited.has(neighbor)) queue.push(neighbor);
            }
          }
          if (cluster.length > 1) clusters.push(cluster);
        }

        // Build result
        let result = `File relationship analysis for ${changedFiles.length} changed file(s):\n\n`;

        if (clusters.length > 0) {
          result += `Changed files form ${clusters.length} cluster(s) of coupled files:\n`;
          for (const [i, cluster] of clusters.entries()) {
            result += `  Cluster ${i + 1}: ${cluster.join(', ')}\n`;
          }
        } else {
          result += 'Changed files form no significant clusters (files are independent).\n';
        }

        result += '\nImport relationships:\n';
        let hasRelationships = false;
        for (const [file, deps] of Object.entries(importMap)) {
          if (deps.length > 0) {
            hasRelationships = true;
            result += `  ${file} imports: ${deps.join(', ')}\n`;
          }
        }
        if (!hasRelationships) result += '  No import relationships detected among changed files.\n';

        // Blast radius
        result += '\nBlast radius (files imported by most other changed files):\n';
        const blastRadius = Object.entries(reverseImportMap)
          .sort((a, b) => b[1].length - a[1].length);
        if (blastRadius.length > 0) {
          for (const [file, importers] of blastRadius) {
            result += `  ${file} is imported by ${importers.length} other changed file(s): ${importers.join(', ')}${importers.length >= 2 ? ' (high blast radius)' : ''}\n`;
          }
        } else {
          result += '  No high blast radius files detected.\n';
        }

        return result;
      } catch (err) {
        return `Error analyzing file relationships: ${err instanceof Error ? err.message : 'Unknown error'}`;
      }
    }

    case 'historical_context': {
      try {
        if (!context.repositoryId) {
          return 'No repository ID available — cannot fetch historical context.';
        }

        const pastReviews = await db.review.findMany({
          where: { repositoryId: context.repositoryId, status: 'completed' },
          orderBy: { createdAt: 'desc' },
          take: 10,
          include: { comments: true },
        });

        if (pastReviews.length === 0) {
          return 'No previous reviews found for this repository.';
        }

        let result = `Historical context: ${pastReviews.length} previous review(s) for this repository:\n\n`;

        // Score distribution
        const scoreCounts: Record<string, number> = {};
        for (const review of pastReviews) {
          const score = review.overallScore || 'unknown';
          scoreCounts[score] = (scoreCounts[score] || 0) + 1;
        }
        result += `Previous review scores: ${Object.entries(scoreCounts).map(([k, v]) => `${k}: ${v}`).join(', ')}\n\n`;

        // Common issue patterns (severity + file frequency)
        const issuePatterns: Record<string, number> = {};
        const fileIssueFrequency: Record<string, number> = {};
        for (const review of pastReviews) {
          for (const comment of review.comments) {
            const key = `${comment.severity || 'info'}`;
            issuePatterns[key] = (issuePatterns[key] || 0) + 1;
            if (comment.filePath) {
              fileIssueFrequency[comment.filePath] = (fileIssueFrequency[comment.filePath] || 0) + 1;
            }
          }
        }

        result += `Issue severity distribution:\n${Object.entries(issuePatterns).map(([k, v]) => `  ${k}: ${v}`).join('\n')}\n\n`;

        // Files with most issues
        const frequentFiles = Object.entries(fileIssueFrequency)
          .sort((a, b) => b[1] - a[1])
          .slice(0, 5);
        if (frequentFiles.length > 0) {
          result += `Files with frequent issues:\n${frequentFiles.map(([f, c]) => `  ${f}: ${c} issue(s)`).join('\n')}\n\n`;
        }

        // Recent review summaries
        result += 'Recent reviews:\n';
        for (const review of pastReviews.slice(0, 5)) {
          result += `  PR #${review.prNumber} "${review.prTitle}" → ${review.overallScore || 'unknown'} (${review.comments.length} comment(s)) — ${review.createdAt.toISOString().split('T')[0]}\n`;
          if (review.summary) {
            result += `    Summary: ${review.summary.substring(0, 150)}${review.summary.length > 150 ? '...' : ''}\n`;
          }
        }

        return result;
      } catch (err) {
        return `Error fetching historical context: ${err instanceof Error ? err.message : 'Unknown error'}`;
      }
    }

    case 'symbol_search': {
      const symbol = params.symbol;
      if (!symbol) return 'Error: No symbol name provided.';

      try {
        const diffLines = context.diff.split('\n');
        let currentFile = '';
        const definitions: Array<{ file: string; line: number; snippet: string; type: string }> = [];
        const usages: Array<{ file: string; line: number; snippet: string }> = [];

        // Regex patterns for symbol definitions
        const definitionPatterns = [
          { type: 'function', regex: new RegExp(`(?:export\s+)?(?:async\s+)?function\s+${escapeRegex(symbol)}\\b`) },
          { type: 'const/let/var', regex: new RegExp(`(?:export\s+)?(?:const|let|var)\s+${escapeRegex(symbol)}\\s*=`) },
          { type: 'class', regex: new RegExp(`(?:export\s+)?(?:default\s+)?class\s+${escapeRegex(symbol)}\\b`) },
          { type: 'interface', regex: new RegExp(`(?:export\s+)?interface\s+${escapeRegex(symbol)}\\b`) },
          { type: 'type', regex: new RegExp(`(?:export\s+)?type\s+${escapeRegex(symbol)}\\b`) },
          { type: 'def', regex: new RegExp(`def\s+${escapeRegex(symbol)}\\b`) },
          { type: 'class (Python)', regex: new RegExp(`class\s+${escapeRegex(symbol)}\\b`) },
          { type: 'method', regex: new RegExp(`${escapeRegex(symbol)}\\s*\\(\\s*\\)\\s*{`) },
          { type: 'arrow function', regex: new RegExp(`(?:export\s+)?(?:const|let|var)\s+${escapeRegex(symbol)}\\s*=\\s*(?:async\s+)?\\(`) },
        ];

        // Usage pattern — symbol referenced but not defined
        const usageRegex = new RegExp(`\\b${escapeRegex(symbol)}\\b`);

        let lineNumber = 0;
        for (const line of diffLines) {
          lineNumber++;
          const fileHeader = line.match(/^\+\+\+ b\/(.+)$/);
          if (fileHeader) {
            currentFile = fileHeader[1];
            continue;
          }
          if (!currentFile) continue;
          // Only consider added lines for definitions and usages
          if (!line.startsWith('+') || line.startsWith('+++')) continue;

          // Check for definitions
          let isDefinition = false;
          for (const { type, regex } of definitionPatterns) {
            if (regex.test(line)) {
              definitions.push({
                file: currentFile,
                line: lineNumber,
                snippet: line.substring(0, 120).trim(),
                type,
              });
              isDefinition = true;
              break;
            }
          }

          // Check for usages (if not a definition)
          if (!isDefinition && usageRegex.test(line)) {
            usages.push({
              file: currentFile,
              line: lineNumber,
              snippet: line.substring(0, 120).trim(),
            });
          }
        }

        if (definitions.length === 0 && usages.length === 0) {
          return `Symbol "${symbol}" not found in the diff.`;
        }

        let result = `Symbol search for "${symbol}":\n\n`;

        if (definitions.length > 0) {
          result += 'Definitions:\n';
          for (const def of definitions) {
            result += `  [${def.type}] ${def.file} (line ~${def.line}): ${def.snippet}\n`;
          }
          result += '\n';
        }

        if (usages.length > 0) {
          result += 'Usages/References:\n';
          // Group usages by file
          const usagesByFile: Record<string, Array<{ line: number; snippet: string }>> = {};
          for (const usage of usages) {
            if (!usagesByFile[usage.file]) usagesByFile[usage.file] = [];
            usagesByFile[usage.file].push(usage);
          }
          for (const [file, fileUsages] of Object.entries(usagesByFile)) {
            result += `  ${file}: ${fileUsages.length} reference(s)\n`;
            for (const u of fileUsages.slice(0, 3)) {
              result += `    Line ~${u.line}: ${u.snippet}\n`;
            }
            if (fileUsages.length > 3) {
              result += `    ... and ${fileUsages.length - 3} more\n`;
            }
          }
          result += '\n';
        }

        // Summary
        const defFiles = [...new Set(definitions.map(d => d.file))];
        const usageFiles = [...new Set(usages.map(u => u.file))];
        if (defFiles.length > 0 && usageFiles.length > 0) {
          result += `Summary: Symbol "${symbol}" is defined in ${defFiles.join(', ')} and referenced in ${usageFiles.join(', ')}`;
        } else if (defFiles.length > 0) {
          result += `Summary: Symbol "${symbol}" is defined in ${defFiles.join(', ')} with no other references in the diff.`;
        } else {
          result += `Summary: Symbol "${symbol}" is referenced in ${usageFiles.join(', ')} but not defined in the diff.`;
        }

        return result;
      } catch (err) {
        return `Error searching for symbol: ${err instanceof Error ? err.message : 'Unknown error'}`;
      }
    }

    case 'architectural_impact': {
      try {
        const diffLines = context.diff.split('\n');
        const changedFiles: string[] = [];
        const fileChangeSizes: Record<string, number> = {};

        // Parse changed files and count lines changed
        let currentFile = '';
        for (const line of diffLines) {
          const fileHeader = line.match(/^\+\+\+ b\/(.+)$/);
          if (fileHeader) {
            currentFile = fileHeader[1];
            changedFiles.push(currentFile);
            fileChangeSizes[currentFile] = 0;
            continue;
          }
          if (currentFile && (line.startsWith('+') || line.startsWith('-')) && !line.startsWith('+++') && !line.startsWith('---')) {
            fileChangeSizes[currentFile] = (fileChangeSizes[currentFile] || 0) + 1;
          }
        }

        if (changedFiles.length === 0) {
          return 'No changed files found in the diff.';
        }

        // Architectural layer classification
        type Layer = 'config' | 'ui' | 'api' | 'lib' | 'db' | 'test' | 'docs' | 'build' | 'unknown';
        const layerPatterns: Record<Layer, RegExp> = {
          config: /\/?(?:\.env|config|settings|constants|\.rc|\.config)\b/i,
          ui: /\/?(?:components?|pages?|views?|layouts?|styles?|css|scss|ui)\b/i,
          api: /\/?(?:api|routes?|controllers?|endpoints?|handlers?|middleware)\b/i,
          lib: /\/?(?:lib|utils?|services?|helpers?|core|shared|modules?)\b/i,
          db: /\/?(?:db|database|models?|schema|prisma|migrations?|repositories?)\b/i,
          test: /\/?(?:test|spec|__tests__|fixtures?|mocks?)\b/i,
          docs: /\/?(?:docs?|readme|changelog|\.md|\.txt)\b/i,
          build: /\/?(?:build|scripts?|webpack|vite|rollup|esbuild|Makefile|Dockerfile|docker-compose)\b/i,
          unknown: /.*/,
        };

        const layerCounts: Record<Layer, number> = { config: 0, ui: 0, api: 0, lib: 0, db: 0, test: 0, docs: 0, build: 0, unknown: 0 };
        const fileLayers: Record<string, Layer> = {};

        for (const file of changedFiles) {
          let matched = false;
          for (const [layer, pattern] of Object.entries(layerPatterns)) {
            if (layer === 'unknown') continue;
            if (pattern.test(file)) {
              fileLayers[file] = layer as Layer;
              layerCounts[layer as Layer]++;
              matched = true;
              break;
            }
          }
          if (!matched) {
            fileLayers[file] = 'unknown';
            layerCounts.unknown++;
          }
        }

        // Calculate impact metrics
        const layersAffected = Object.entries(layerCounts).filter(([, c]) => c > 0).length;
        const totalChanges = Object.values(fileChangeSizes).reduce((a, b) => a + b, 0);
        const maxSingleFileChanges = Math.max(...Object.values(fileChangeSizes));

        // Cross-layer coupling: count files that import across architectural boundaries
        const crossLayerImports: string[] = [];
        const importRegex = /(?:import|from|require)\s+['"]([^'"]+)['"]/g;
        let currentFileForImport = '';
        for (const line of diffLines) {
          const fileHeader = line.match(/^\+\+\+ b\/(.+)$/);
          if (fileHeader) {
            currentFileForImport = fileHeader[1];
            continue;
          }
          if (!currentFileForImport || !line.startsWith('+') || line.startsWith('+++')) continue;
          importRegex.lastIndex = 0;
          let importMatch;
          while ((importMatch = importRegex.exec(line)) !== null) {
            const importPath = importMatch[1];
            if (!importPath.startsWith('.')) continue; // Only check relative imports
            // Check if this import crosses a layer boundary
            const sourceLayer = fileLayers[currentFileForImport];
            for (const [file, layer] of Object.entries(fileLayers)) {
              if (file !== currentFileForImport && layer !== sourceLayer) {
                const resolved = (currentFileForImport.substring(0, currentFileForImport.lastIndexOf('/')) + '/' + importPath)
                  .replace(/\/\.\//g, '/').replace(/[^/]+\/\.\.\//g, '');
                if (file.startsWith(resolved) || resolved.startsWith(file.replace(/\.[^.]+$/, ''))) {
                  crossLayerImports.push(`${currentFileForImport} (${sourceLayer}) → ${file} (${layer})`);
                  break;
                }
              }
            }
          }
        }

        // Risk scoring (0-10)
        let riskScore = 0;
        // More layers affected = higher risk
        riskScore += Math.min(layersAffected * 1.5, 4);
        // Large changes in a single file = higher risk
        if (maxSingleFileChanges > 100) riskScore += 2;
        else if (maxSingleFileChanges > 50) riskScore += 1;
        // Cross-layer coupling = higher risk
        riskScore += Math.min(crossLayerImports.length * 1, 2);
        // No test changes when lib/api changes = higher risk
        if ((layerCounts.lib > 0 || layerCounts.api > 0) && layerCounts.test === 0) riskScore += 1;
        // DB schema changes = higher risk
        if (layerCounts.db > 0) riskScore += 1;
        riskScore = Math.min(Math.round(riskScore), 10);

        // Build result
        const riskLevel = riskScore >= 7 ? 'HIGH' : riskScore >= 4 ? 'MEDIUM' : 'LOW';

        let result = `Architectural Impact Assessment\n\n`;
        result += `Risk Score: ${riskScore}/10 (${riskLevel} RISK)\n\n`;
        result += `Layers Affected: ${layersAffected} out of ${Object.keys(layerPatterns).length - 1} possible\n`;
        result += `Layer Distribution:\n`;
        for (const [layer, count] of Object.entries(layerCounts)) {
          if (count > 0) result += `  ${layer}: ${count} file(s)\n`;
        }

        result += `\nChange Metrics:\n`;
        result += `  Total changed lines: ${totalChanges}\n`;
        result += `  Largest single file change: ${maxSingleFileChanges} lines\n`;
        result += `  Files changed: ${changedFiles.length}\n`;

        if (crossLayerImports.length > 0) {
          result += `\nCross-Layer Coupling (${crossLayerImports.length} boundary crossing(s)):\n`;
          for (const imp of crossLayerImports.slice(0, 10)) {
            result += `  ${imp}\n`;
          }
          if (crossLayerImports.length > 10) {
            result += `  ... and ${crossLayerImports.length - 10} more\n`;
          }
        }

        // Specific risk indicators
        const riskIndicators: string[] = [];
        if (layerCounts.db > 0 && layerCounts.test === 0) riskIndicators.push('Database layer changes without test coverage');
        if (layerCounts.api > 0 && layerCounts.test === 0) riskIndicators.push('API layer changes without test coverage');
        if (crossLayerImports.length > 3) riskIndicators.push('High cross-layer coupling — changes may propagate far');
        if (maxSingleFileChanges > 100) riskIndicators.push('Very large single-file change — consider splitting');
        if (layersAffected >= 4) riskIndicators.push('Many architectural layers affected — broad impact');

        if (riskIndicators.length > 0) {
          result += `\nRisk Indicators:\n`;
          for (const indicator of riskIndicators) {
            result += `  ⚠ ${indicator}\n`;
          }
        }

        // Files by layer with change sizes
        result += `\nFiles by Layer:\n`;
        for (const [layer, _pattern] of Object.entries(layerPatterns)) {
          if (layer === 'unknown') continue;
          const layerFiles = changedFiles.filter(f => fileLayers[f] === layer);
          if (layerFiles.length > 0) {
            result += `  [${layer}]\n`;
            for (const f of layerFiles) {
              result += `    ${f} (${fileChangeSizes[f] || 0} lines changed)\n`;
            }
          }
        }

        return result;
      } catch (err) {
        return `Error analyzing architectural impact: ${err instanceof Error ? err.message : 'Unknown error'}`;
      }
    }

    default:
      return `Unknown tool: ${toolName}. Available: ${AGENT_TOOLS.map(t => t.name).join(', ')}`;
  }
}

// --- Hallucination Guard: Diff Line Range Extraction ---

export interface HunkRange {
  /** Start line of this hunk in the new (right/b) file (1-based) */
  startLine: number;
  /** End line of this hunk in the new (right/b) file (1-based, inclusive) */
  endLine: number;
}

export interface DiffFileRange {
  filePath: string;
  /** Line numbers in the NEW (right/b) version of the file that are part of the diff */
  addedLines: Set<number>;
  /** Start line of the new file hunk (first @@ line) */
  newFileStartLine: number;
  /** End line of the new file hunk (last relevant line) */
  newFileEndLine: number;
  /** Total lines in the new file hunk */
  newFileLineCount: number;
  /** Individual hunk ranges for precise line validation */
  hunks: HunkRange[];
}

/**
 * Parse a unified diff to extract per-file line ranges for hallucination validation.
 * Returns a map of filePath → DiffFileRange with the actual lines that were changed.
 */
export function extractDiffLineRanges(diff: string): Map<string, DiffFileRange> {
  const ranges = new Map<string, DiffFileRange>();
  const lines = diff.split('\n');
  let currentFile = '';
  let currentRange: DiffFileRange | null = null;
  let newLineCounter = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Match file header: +++ b/path/to/file
    const fileHeader = line.match(/^\+\+\+ b\/(.+)$/);
    if (fileHeader) {
      // Save previous range
      if (currentRange && currentFile) {
        currentRange.newFileEndLine = newLineCounter;
        ranges.set(currentFile, currentRange);
      }
      currentFile = fileHeader[1];
      currentRange = {
        filePath: currentFile,
        addedLines: new Set(),
        newFileStartLine: 0,
        newFileEndLine: 0,
        newFileLineCount: 0,
        hunks: [],
      };
      newLineCounter = 0;
      continue;
    }

    if (!currentRange) continue;

    // Match hunk header: @@ -old_start,old_count +new_start,new_count @@
    const hunkHeader = line.match(/^@@@? -(\d+)(?:,\d+)? \+(\d+)(?:,(\d+))? @@@?/);
    if (hunkHeader) {
      const newStart = parseInt(hunkHeader[2], 10);
      const newCount = hunkHeader[3] ? parseInt(hunkHeader[3], 10) : 1;
      // Save previous hunk's end line before starting a new one
      if (currentRange && currentRange.hunks.length > 0) {
        const lastHunk = currentRange.hunks[currentRange.hunks.length - 1];
        lastHunk.endLine = newLineCounter;
      }
      newLineCounter = newStart - 1; // Lines are 1-based, counter is 0-based before first line
      // Start tracking this hunk's range
      if (currentRange) {
        currentRange.hunks.push({ startLine: newStart, endLine: newStart + newCount - 1 });
        if (currentRange.newFileStartLine === 0) {
          currentRange.newFileStartLine = newStart;
        }
      }
      continue;
    }

    // Track new file line numbers
    if (line.startsWith('+') && !line.startsWith('+++')) {
      newLineCounter++;
      currentRange.addedLines.add(newLineCounter);
      currentRange.newFileLineCount++;
    } else if (line.startsWith('-') && !line.startsWith('---')) {
      // Removed line — don't increment newLineCounter
    } else if (!line.startsWith('\\')) {
      // Context line — increment newLineCounter but don't add to addedLines
      newLineCounter++;
    }
  }

  // Save last range
  if (currentRange && currentFile) {
    currentRange.newFileEndLine = newLineCounter;
    ranges.set(currentFile, currentRange);
  }

  return ranges;
}

// --- Hallucination Guard: Validate Review Comments ---

const VALID_SEVERITIES = new Set(['info', 'warning', 'error', 'critical']);
const VALID_SCORES = new Set(['approve', 'request_changes', 'comment']);

export interface HallucinationValidationResult {
  isValid: boolean;
  warnings: string[];
  /** Comments that passed validation */
  validComments: Array<Record<string, unknown>>;
  /** Comments that were filtered out */
  filteredComments: Array<Record<string, unknown>>;
}

/**
 * Validate parsed review output against the actual diff to detect hallucinations.
 * Checks:
 * 1. Comment filePaths exist in the diff
 * 2. Comment line numbers fall within the actual diff line ranges
 * 3. Severity values are from the valid enum
 * 4. overallScore is from the valid enum
 */
export function validateReviewAgainstDiff(
  parsed: Record<string, unknown>,
  diffRanges: Map<string, DiffFileRange>
): HallucinationValidationResult {
  const warnings: string[] = [];
  const validComments: Array<Record<string, unknown>> = [];
  const filteredComments: Array<Record<string, unknown>> = [];

  // Validate overallScore
  const overallScore = parsed.overallScore as string;
  if (overallScore && !VALID_SCORES.has(overallScore)) {
    warnings.push(`Invalid overallScore "${overallScore}" — defaulting to "comment"`);
    parsed.overallScore = 'comment';
  }

  // Build a lookup for fuzzy file path matching
  const diffFilePaths = new Set(diffRanges.keys());

  const comments = (parsed.comments || []) as Array<Record<string, unknown>>;
  for (const comment of comments) {
    const filePath = (comment.filePath as string) || '';
    const line = comment.line as number | null | undefined;
    const severity = (comment.severity as string) || 'info';
    let commentValid = true;
    const commentWarnings: string[] = [];

    // 1. Validate file path exists in diff
    let matchedPath = filePath;
    let pathFound = diffFilePaths.has(filePath);

    if (!pathFound && filePath) {
      // Try fuzzy matching: check if the diff has a path ending with this file
      for (const diffPath of diffFilePaths) {
        if (diffPath.endsWith(filePath) || filePath.endsWith(diffPath)) {
          matchedPath = diffPath;
          pathFound = true;
          break;
        }
      }
    }

    if (!pathFound && filePath) {
      commentWarnings.push(`File path "${filePath}" not found in diff — possible hallucination`);
      commentValid = false;
    } else if (pathFound && matchedPath !== filePath) {
      // Normalize to the actual diff path
      comment.filePath = matchedPath;
    }

    // 2. Validate line number against actual diff ranges (with hunk-level precision)
    if (line != null && pathFound && matchedPath) {
      const range = diffRanges.get(matchedPath);
      if (range) {
        if (line <= 0) {
          commentWarnings.push(`Line ${line} is invalid (must be positive) — removing line reference`);
          comment.line = null;
        } else if (range.hunks.length > 0) {
          // Hunk-level validation: check if line falls within any actual hunk
          const CONTEXT_TOLERANCE = 2; // Allow ±2 lines of context around each hunk
          let lineInHunk = false;
          for (const hunk of range.hunks) {
            if (line >= hunk.startLine - CONTEXT_TOLERANCE && line <= hunk.endLine + CONTEXT_TOLERANCE) {
              lineInHunk = true;
              break;
            }
          }
          if (!lineInHunk) {
            // Line is NOT within any hunk range (even with tolerance)
            // Check if it's within the overall file bounds but between hunks (gap region)
            const maxPlausibleLine = range.newFileEndLine + CONTEXT_TOLERANCE;
            if (line > maxPlausibleLine) {
              commentWarnings.push(`Line ${line} exceeds diff range (max ${maxPlausibleLine}) for ${matchedPath} — possible hallucination, removing line reference`);
            } else if (line < range.newFileStartLine - CONTEXT_TOLERANCE) {
              commentWarnings.push(`Line ${line} is before the diff range (starts at ${range.newFileStartLine}) for ${matchedPath} — possible hallucination, removing line reference`);
            } else {
              // Line is between hunks (gap region) — plausible file line but not in any changed region
              const hunkSummary = range.hunks.map(h => `${h.startLine}-${h.endLine}`).join(', ');
              commentWarnings.push(`Line ${line} is between diff hunks [${hunkSummary}] for ${matchedPath} — possible hallucination, removing line reference`);
            }
            comment.line = null;
          }
          // If line IS within a hunk (with tolerance), it's valid — even if not an added line
          // Reviewers can legitimately comment on context lines near changes
        } else if (range.newFileEndLine > 0) {
          // Fallback: no hunk data available, use overall file range
          const maxPlausibleLine = range.newFileEndLine + 2;
          if (line > maxPlausibleLine) {
            commentWarnings.push(`Line ${line} exceeds diff range (1-${maxPlausibleLine}) for ${matchedPath} — possible hallucination, removing line reference`);
            comment.line = null;
          } else if (line < range.newFileStartLine - 2) {
            commentWarnings.push(`Line ${line} is before diff range for ${matchedPath} — possible hallucination, removing line reference`);
            comment.line = null;
          }
        }
      }
    }

    // 3. Validate severity
    if (!VALID_SEVERITIES.has(severity)) {
      commentWarnings.push(`Invalid severity "${severity}" — defaulting to "info"`);
      comment.severity = 'info';
    }

    if (commentValid) {
      validComments.push(comment);
    } else {
      filteredComments.push(comment);
    }
    warnings.push(...commentWarnings);
  }

  // If too many comments were filtered, add a warning
  if (filteredComments.length > 0 && validComments.length === 0 && comments.length > 0) {
    warnings.push(`All ${comments.length} comment(s) failed hallucination validation — review may be unreliable`);
    // If ALL comments were filtered, keep them but strip their line numbers
    for (const comment of comments) {
      comment.line = null;
      validComments.push(comment);
    }
  }

  // Update parsed comments to only include valid ones
  parsed.comments = validComments;

  return {
    isValid: filteredComments.length === 0 && warnings.length === 0,
    warnings,
    validComments,
    filteredComments,
  };
}

// --- Parse review from content ---

export function parseReviewFromContent(content: string): Record<string, unknown> | null {
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

export function buildReviewResult(
  parsed: Record<string, unknown>,
  agentSteps: AgentStep[],
  modelUsed: string,
  totalTokens: number,
  tokenUsage?: TokenUsage,
  hallucinationWarnings?: string[]
): ReviewResult {
  agentSteps.push({
    step: 'review',
    description: `Produced final review: ${parsed.overallScore || 'comment'} with ${((parsed.comments || []) as Array<unknown>).length} comment(s)`,
    timestamp: new Date().toISOString(),
    reasoning: 'All investigation steps complete, producing structured review output',
    conclusion: `Final verdict: ${parsed.overallScore || 'comment'}. Found ${((parsed.comments || []) as Array<unknown>).length} issue(s). Summary: ${((parsed.summary as string) || '').substring(0, 200)}`,
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
    tokenUsage,
    hallucinationWarnings,
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
  const reviewStartTime = Date.now();

  let zaiInstance: ZAI | null = null;
  if (aiConfig.provider === 'z-ai') {
    zaiInstance = await ZAI.create();
  }

  // Determine if this is a focused re-review
  const isFocused = !!context?.focusQuestion || !!context?.focusFile;

  const analyzeStartTime = Date.now();
  agentSteps.push({
    step: 'analyze',
    description: isFocused
      ? `Re-reviewing PR (focused): ${context?.focusFile || 'specific question'}`
      : `Analyzing PR: ${prInfo.title} (+${prInfo.additions} -${prInfo.deletions} across ${prInfo.changedFiles} files)`,
    timestamp: new Date().toISOString(),
    reasoning: isFocused
      ? `Re-examining the PR with focus on ${context?.focusFile || 'a specific question'} to address the developer's concern`
      : `Starting review of a PR with ${prInfo.changedFiles} file(s) changed (+${prInfo.additions}/-${prInfo.deletions}). Will identify critical areas that need deeper investigation.`,
    conclusion: isFocused
      ? `Focusing re-review on: ${context?.focusFile || context?.focusQuestion || 'specific concern'}`
      : `Initial assessment: PR has ${prInfo.changedFiles} file(s) with ${prInfo.additions} additions and ${prInfo.deletions} deletions. Will investigate critical changes.`,
  });

  // Apply ignore patterns if configured
  let filteredDiff = diff;
  try {
    const ignoreConfig = await db.appConfig.findUnique({ where: { key: 'ignore_patterns' } });
    if (ignoreConfig?.value) {
      const patterns: string[] = JSON.parse(ignoreConfig.value);
      if (patterns.length > 0) {
        // Filter out diff sections for ignored file patterns
        const diffLines = filteredDiff.split('\n');
        const resultLines: string[] = [];
        let skipFile = false;
        for (const line of diffLines) {
          if (line.startsWith('diff --git')) {
            skipFile = false;
            for (const pattern of patterns) {
              // Convert glob to regex: * matches anything except /, ** matches everything including /
              const globRegex = new RegExp(
                '^' + escapeRegex(pattern)
                  .replace(/\\\*\\\*/g, '.*')  // ** matches everything including /
                  .replace(/\\\*/g, '[^/]*')    // * matches everything except /
                  .replace(/\\\?/g, '[^/]')     // ? matches single non-/ char
                + '$'
              );
              if (globRegex.test(line)) {
                skipFile = true;
                break;
              }
            }
          }
          if (!skipFile) resultLines.push(line);
        }
        filteredDiff = resultLines.join('\n');
      }
    }
  } catch { /* Gracefully skip if ignore patterns fail to parse */ }

  // Build messages - truncate diff to a reasonable size
  const truncatedDiff = filteredDiff.substring(0, DIFF_MAX_LENGTH);
  const wasTruncated = filteredDiff.length > DIFF_MAX_LENGTH;

  const systemPrompt = context?.reviewMode === 'fix'
    ? FIX_SUGGESTION_PROMPT
    : context?.reviewMode === 'explain'
      ? EXPLAIN_CODE_PROMPT
      : isFocused ? FOCUSED_REVIEW_PROMPT : AGENT_SYSTEM_PROMPT;
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
  let totalPromptTokens = 0;
  let totalCompletionTokens = 0;
  let hasRealTokenUsage = false;
  let prunedMessages = 0;

  // Estimate prompt token count from the initial messages
  // This provides a baseline even when the API doesn't return usage data
  const estimatePromptTokens = (msgs: Array<{ role: string; content: string }>): number => {
    let charCount = 0;
    for (const msg of msgs) {
      charCount += msg.content.length;
      // Account for role overhead and formatting
      charCount += msg.role.length + 10;
    }
    return Math.ceil(charCount / 4); // ~4 chars per token
  };

  const pruneMessages = () => {
    const totalChars = messages.reduce((sum, m) => sum + m.content.length, 0);
    if (totalChars <= AGENT_CONTEXT_LIMIT_CHARS) return;

    const KEEP_LAST = 3;
    const keepCount = 1 + KEEP_LAST;
    if (messages.length <= keepCount) return;

    const removedCount = messages.length - keepCount;
    const systemMsg = messages[0];
    const lastMessages = messages.slice(-KEEP_LAST);

    messages.length = 0;
    messages.push(systemMsg);
    messages.push({
      role: 'system' as const,
      content: `[Previous tool results pruned — ${removedCount} messages removed]`,
    });
    for (const msg of lastMessages) {
      messages.push(msg);
    }

    prunedMessages += removedCount;
    logger.warn(`Agent context pruned: removed ${removedCount} messages (${totalChars} chars > ${AGENT_CONTEXT_LIMIT_CHARS} limit)`);
  };

  const maxSteps = Math.min(Math.max(aiConfig.maxSteps, 1), 10);

  // Extract diff line ranges for hallucination validation
  const diffRanges = extractDiffLineRanges(filteredDiff);

  for (let step = 0; step < maxSteps; step++) {
    const stepStartTime = Date.now();
    const response = await chatCompletion(aiConfig, messages, zaiInstance);
    if (!response.content) throw new Error('No response from LLM');

    // Track actual token usage from API when available, estimate otherwise
    if (response.usage && response.usage.total_tokens > 0) {
      totalPromptTokens += response.usage.prompt_tokens;
      totalCompletionTokens += response.usage.completion_tokens;
      totalTokens += response.usage.total_tokens;
      hasRealTokenUsage = true;
    } else {
      // Fallback estimation: ~4 chars per token for English/code
      const estimatedCompletion = Math.ceil(response.content.length / 4);
      const estimatedPrompt = estimatePromptTokens(messages);
      totalTokens += estimatedPrompt + estimatedCompletion;
      totalPromptTokens += estimatedPrompt;
      totalCompletionTokens += estimatedCompletion;
    }

    // Extract reasoning from the LLM response (text before JSON block)
    const content = response.content;
    const reasoningMatch = content.match(/^([\s\S]*?)```json/);
    const extractedReasoning = reasoningMatch ? reasoningMatch[1].trim().replace(/^(Before calling a tool|I need to|Let me|I'll|I will|To understand|To check|To verify|To investigate)\s*/i, '$1').trim() : undefined;

    const parsed = parseReviewFromContent(content);

    if (parsed) {
      // Check for tool call
      if (parsed.action === 'tool_call' && context && step < maxSteps - 2) {
        const toolName = parsed.tool as string;
        const toolParams = (parsed.parameters || {}) as Record<string, string>;
        const toolReasoning = (parsed.reasoning as string) || extractedReasoning || `Investigating ${toolName} to gather more context for the review`;

        agentSteps.push({
          step: 'tool_call',
          description: `Called ${toolName} with ${JSON.stringify(toolParams)}`,
          tool: toolName,
          timestamp: new Date().toISOString(),
          reasoning: toolReasoning,
        });

        const toolResult = await executeTool(toolName, toolParams, { ...context, diff });

        // Extract key evidence from tool result (first meaningful lines)
        const evidenceLines = toolResult.split('\n').slice(0, 5).join('\n').trim();
        const isToolError = toolResult.startsWith('Error');
        const toolConclusion = isToolError
          ? `Tool call failed: ${toolResult}`
          : toolResult.length > 200
            ? `Found relevant information (${toolResult.length} chars). Key snippet: ${evidenceLines}...`
            : toolResult;

        // Update the last agent step with conclusion and evidence
        const lastStep = agentSteps[agentSteps.length - 1];
        if (lastStep && lastStep.step === 'tool_call') {
          lastStep.conclusion = toolConclusion;
          lastStep.evidence = toolResult.length > 500 ? toolResult.substring(0, 500) + '...' : toolResult;
          lastStep.durationMs = Date.now() - stepStartTime;
        }

        messages.push({ role: 'assistant', content });
        messages.push({
          role: 'user',
          content: `Tool result for ${toolName}:\n\`\`\`\n${toolResult}\n\`\`\`\n\nContinue your review. Briefly note what you learned from this result.`,
        });
        pruneMessages();
        continue;
      }

      if (parsed.action === 'final_review' || parsed.overallScore) {
        // Compute duration for the initial analyze step
        if (agentSteps.length > 0 && agentSteps[0].step === 'analyze') {
          agentSteps[0].durationMs = Date.now() - analyzeStartTime;
        }

        agentSteps.push({
          step: 'reflect',
          description: 'Review findings validated',
          timestamp: new Date().toISOString(),
          reasoning: extractedReasoning || 'Synthesizing all findings into a final review assessment',
          conclusion: `Overall assessment: ${parsed.overallScore || 'comment'}. ${((parsed.comments || []) as Array<unknown>).length} issue(s) identified.`,
          durationMs: Date.now() - stepStartTime,
        });

        // Add synthesis step
        const totalDuration = Date.now() - reviewStartTime;
        const stepsSummary = agentSteps.map((s, i) => {
          const parts = [`${i + 1}. **${s.step === 'tool_call' ? s.tool : s.step}**: ${s.description}`];
          if (s.reasoning) parts.push(`   Reason: ${s.reasoning}`);
          if (s.conclusion) parts.push(`   Result: ${s.conclusion}`);
          return parts.join('\n');
        }).join('\n');

        agentSteps.push({
          step: 'synthesis',
          description: 'Complete reasoning trace',
          timestamp: new Date().toISOString(),
          reasoning: `The agent followed a ${agentSteps.length}-step investigation process taking ${totalDuration}ms total.`,
          conclusion: stepsSummary,
          durationMs: Date.now() - stepStartTime,
        });

        logger.warn('Agent review completed', { totalDuration, steps: agentSteps.length });

        // Run hallucination validation against the actual diff
        const hallucinationResult = validateReviewAgainstDiff(parsed, diffRanges);
        if (hallucinationResult.warnings.length > 0) {
          logger.warn('Hallucination guard', { count: hallucinationResult.warnings.length, warnings: hallucinationResult.warnings });
        }

        const tokenUsage: TokenUsage = {
          promptTokens: totalPromptTokens,
          completionTokens: totalCompletionTokens,
          totalTokens,
          isEstimated: !hasRealTokenUsage,
        };

        return buildReviewResult(
          parsed, agentSteps, modelUsed, totalTokens,
          tokenUsage,
          hallucinationResult.warnings.length > 0 ? hallucinationResult.warnings : undefined
        );
      }
    }

    // No structured output found
    messages.push({ role: 'assistant', content });

    if (step === maxSteps - 1) {
      // Force final review on last step
      agentSteps.push({ step: 'force_final', description: 'Forcing structured output', timestamp: new Date().toISOString(), reasoning: 'Max steps reached without final review, forcing structured output', durationMs: Date.now() - stepStartTime });
      messages.push({
        role: 'user',
        content: `Please provide your final review now. You MUST respond with ONLY a JSON block:\n\`\`\`json\n${REVIEW_OUTPUT_SCHEMA}\n\`\`\``,
      });
      try {
        const finalResponse = await chatCompletion(aiConfig, messages, zaiInstance);
        // Track token usage for force-final step
        if (finalResponse.usage && finalResponse.usage.total_tokens > 0) {
          totalPromptTokens += finalResponse.usage.prompt_tokens;
          totalCompletionTokens += finalResponse.usage.completion_tokens;
          totalTokens += finalResponse.usage.total_tokens;
          hasRealTokenUsage = true;
        } else {
          const estimatedCompletion = Math.ceil(finalResponse.content.length / 4);
          const estimatedPrompt = estimatePromptTokens(messages);
          totalTokens += estimatedPrompt + estimatedCompletion;
          totalPromptTokens += estimatedPrompt;
          totalCompletionTokens += estimatedCompletion;
        }
        const finalParsed = parseReviewFromContent(finalResponse.content);
        if (finalParsed) {
          // Run hallucination validation
          const hallucinationResult = validateReviewAgainstDiff(finalParsed, diffRanges);
          if (hallucinationResult.warnings.length > 0) {
            logger.warn('Hallucination guard (force_final)', { count: hallucinationResult.warnings.length, warnings: hallucinationResult.warnings });
          }
          const tokenUsage: TokenUsage = {
            promptTokens: totalPromptTokens,
            completionTokens: totalCompletionTokens,
            totalTokens,
            isEstimated: !hasRealTokenUsage,
          };
          return buildReviewResult(
            finalParsed, agentSteps, modelUsed, totalTokens,
            tokenUsage,
            hallucinationResult.warnings.length > 0 ? hallucinationResult.warnings : undefined
          );
        }
      } catch { /* */ }
    } else {
      messages.push({
        role: 'user',
        content: 'Please continue. Either call a tool or provide your final review as JSON.',
      });
      pruneMessages();
    }
  }

  // Fallback
  agentSteps.push({ step: 'fallback', description: 'Used fallback parsing', timestamp: new Date().toISOString(), reasoning: 'Agent could not produce structured output, using fallback parsing' });
  return {
    summary: 'Review completed using fallback parsing.',
    overallScore: 'comment',
    comments: [],
    agentSteps,
    modelUsed,
    tokensUsed: totalTokens,
    tokenUsage: {
      promptTokens: totalPromptTokens,
      completionTokens: totalCompletionTokens,
      totalTokens,
      isEstimated: !hasRealTokenUsage,
    },
  };
}

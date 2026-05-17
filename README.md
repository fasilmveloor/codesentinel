# CodeSentinel

**AI-Powered Code Review Agent for GitHub & GitLab**

CodeSentinel is a self-hosted, AI-driven code review tool that automatically reviews Pull Requests on GitHub and Merge Requests on GitLab. Powered by a two-phase AI agent (Investigate → Review) with tool-use capabilities, it provides deep, contextual code analysis — not just surface-level linting.

Built with Next.js 16, Prisma, SQLite, and a configurable AI backend (Zen/Oencode or z-ai), CodeSentinel posts structured inline review comments, severity-tagged annotations, and optional Check Run merge gates directly on your PRs and MRs.

---

## Why CodeSentinel?

| Problem | How CodeSentinel Solves It |
|---|---|
| Generic linters miss logic bugs, security holes, and architectural issues | Two-phase AI agent investigates code context before reviewing — it fetches files, searches patterns, checks tests, and analyzes dependencies |
| Commercial review tools are expensive and opaque | Self-hosted, open-source, configurable AI provider — you control the model, the data, and the cost |
| Review bots spam every line with low-value comments | Agent only comments on real issues with severity levels (critical → info), and provides actionable, constructive feedback |
| Can't interact with the reviewer like Claude/Gemini PR agents | Interactive slash commands (`/review`, `/fix`, `/explain`, `/ignore`, `/config`, `/help`) in PR comment threads |
| Merge blocking is all-or-nothing | Per-repository configurable merge protection — OFF by default, opt-in per repo via dashboard or config |

---

## Features

### Core Review Engine
- **Two-Phase AI Agent** — Investigate phase gathers context using tools, then Review phase produces structured output with inline comments
- **4 Agent Tools** — `fetch_file`, `search_pattern`, `check_tests`, `analyze_deps` — the agent decides which tools to call and when
- **Structured Output** — Reviews include summary, overall score (approve/request_changes/comment), inline comments with file paths and line numbers, and severity ratings
- **Configurable AI Backend** — Use Zen/Oencode models (OpenAI-compatible API) or z-ai-web-dev-sdk with custom model, temperature, and max agent steps

### Platform Support
- **GitHub** — Full GitHub App authentication (JWT RS256 → Installation Token), PR diff fetching, inline review comments, and Check Runs
- **GitLab** — Self-hosted and gitlab.com support, MR diff fetching, position-based inline discussions, and general notes
- **Webhook-Driven** — Automatic review on PR/MR open and sync events with HMAC-SHA256 (GitHub) and token-based (GitLab) signature verification

### Interactive Slash Commands
- `/review` — Trigger a fresh review on the PR/MR
- `/fix` — Ask the agent to suggest fixes for identified issues
- `/explain` — Get a detailed explanation of a specific piece of code
- `/ignore` — Tell the agent to ignore a file or pattern
- `/config` — View or update per-repository review settings
- `/help` — Show available commands

### Merge Protection
- **GitHub Check Runs** — Creates `in_progress` → `completed` check runs with pass/fail/neutral conclusions
- **Configurable** — Merge blocking is **OFF by default**; enable it per-repository via the dashboard or configuration API
- **Annotations** — Review comments are mapped to GitHub annotations (critical/error → failure, warning → warning, info → notice)
- **Re-request Support** — Re-run reviews via the GitHub Check Run "Re-run" button

### Dashboard UI
- **Stats Overview** — Total reviews, pass rate, active repositories, recent activity
- **Review Table** — Filterable by status (pending/reviewing/completed/failed) and platform (GitHub/GitLab), with pagination
- **Review Detail Dialog** — Full review with agent step timeline, severity-tagged comments, and inline file references
- **Manual Review** — Trigger reviews by entering owner/repo/PR number directly from the UI
- **Settings Panel** — Configure GitHub App credentials, GitLab token/host, AI provider/model/temperature, and merge protection toggle

---

## Architecture

```
┌──────────────────────────────────────────────────────────────────┐
│                         CodeSentinel                             │
│                                                                  │
│  ┌─────────────┐    ┌─────────────────┐    ┌─────────────────┐  │
│  │  Dashboard   │    │  API Routes     │    │  Webhook        │  │
│  │  (React UI)  │───▶│  /api/config    │───▶│  /api/webhook   │  │
│  │  /api/reviews│    │  /api/reviews   │    │  /api/webhook/  │  │
│  │  /api/trigger│    │  /api/trigger   │    │    gitlab       │  │
│  └─────────────┘    └────────┬────────┘    └────────┬────────┘  │
│                              │                       │           │
│                              ▼                       ▼           │
│                    ┌─────────────────────────────────────┐       │
│                    │        Review Engine (Agent)        │       │
│                    │                                     │       │
│                    │  ┌──────────┐   ┌──────────────┐   │       │
│                    │  │ Phase 1: │   │   Phase 2:   │   │       │
│                    │  │Investigate│──▶│    Review    │   │       │
│                    │  │(Tool Use) │   │(Structured   │   │       │
│                    │  └────┬─────┘   │   Output)    │   │       │
│                    │       │         └──────────────┘   │       │
│                    │       ▼                            │       │
│                    │  ┌─────────────────────────┐       │       │
│                    │  │     Agent Tools          │       │       │
│                    │  │  • fetch_file            │       │       │
│                    │  │  • search_pattern        │       │       │
│                    │  │  • check_tests           │       │       │
│                    │  │  • analyze_deps          │       │       │
│                    │  └─────────────────────────┘       │       │
│                    └─────────────┬───────────────────────┘       │
│                                  │                               │
│                    ┌─────────────▼───────────────────────┐       │
│                    │         AI Provider Layer            │       │
│                    │  ┌──────────┐  ┌──────────────────┐  │       │
│                    │  │  z-ai    │  │ OpenAI-compat    │  │       │
│                    │  │  SDK     │  │ (Zen/Oencode)    │  │       │
│                    │  └──────────┘  └──────────────────┘  │       │
│                    └─────────────────────────────────────┘       │
│                                                                  │
│  ┌──────────────────────┐    ┌──────────────────────────────┐   │
│  │  GitHub Integration  │    │    GitLab Integration        │   │
│  │  • JWT RS256 Auth    │    │    • Token Auth              │   │
│  │  • PR Diff/Info      │    │    • MR Diff/Changes/Info    │   │
│  │  • Review Comments   │    │    • Inline Discussions      │   │
│  │  • Check Runs        │    │    • General Notes           │   │
│  └──────────────────────┘    └──────────────────────────────┘   │
│                                                                  │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │                   Prisma + SQLite                        │   │
│  │  AppConfig │ Repository │ Review │ ReviewComment         │   │
│  └──────────────────────────────────────────────────────────┘   │
└──────────────────────────────────────────────────────────────────┘
```

### How a Review Flows

```
PR/MR Event (webhook)
        │
        ▼
┌─────────────────┐     Signature Verification
│  Webhook Route  │──────────────────────────────▶ 401 if invalid
└────────┬────────┘
         │
         ▼
┌─────────────────┐     Create Review record (status: reviewing)
│  processReview  │────────────────────────────────────────────▶
└────────┬────────┘
         │
         ▼
┌─────────────────┐     Create Check Run (in_progress)
│  Create Check   │────────────────────────────────────────────▶
└────────┬────────┘
         │
         ▼
┌─────────────────┐     Fetch PR/MR diff + metadata
│  Fetch Context  │────────────────────────────────────────────▶
└────────┬────────┘
         │
         ▼
┌─────────────────────────────────────────────────┐
│              AI Agent Loop                       │
│                                                  │
│  ┌──────────┐    ┌───────────┐    ┌───────────┐ │
│  │ Analyze  │───▶│Investigate│───▶│  Review   │ │
│  │ Diff     │    │(tool calls│    │(structured│ │
│  │          │    │ if needed)│    │  output)  │ │
│  └──────────┘    └───────────┘    └───────────┘ │
│       │               │                  │       │
│       │          ┌────▼────┐             │       │
│       │          │  Tools  │             │       │
│       │          │fetch_file             │       │
│       │          │search_pat             │       │
│       │          │check_test             │       │
│       │          │analyze_dep            │       │
│       │          └─────────┘             │       │
└──────────────────────────┬───────────────────────┘
                           │
                           ▼
┌──────────────────────────────────────────────────┐
│              Post Results                         │
│                                                   │
│  GitHub: Review Comments + Check Run (completed)  │
│  GitLab: Discussions + Notes                      │
│  Database: Update Review record (completed)       │
└──────────────────────────────────────────────────┘
```

---

## Tech Stack

| Layer | Technology |
|---|---|
| **Framework** | Next.js 16 (App Router, RSC, standalone output) |
| **Language** | TypeScript 5 |
| **Runtime** | Bun (dev/build), Node 20 Alpine (Docker) |
| **Database** | SQLite via Prisma ORM 6 |
| **UI** | React 19, Tailwind CSS 4, shadcn/ui (48 components) |
| **Animation** | Framer Motion |
| **AI SDK** | `z-ai-web-dev-sdk` + OpenAI-compatible API (Zen/Oencode) |
| **State** | React hooks, TanStack React Query + Table |
| **Forms** | React Hook Form + Zod validation |
| **Icons** | Lucide React |
| **Toast** | Sonner |
| **Deployment** | Docker (multi-stage), Caddy reverse proxy, docker-compose |

---

## Database Schema

```
┌──────────────┐     ┌──────────────────┐     ┌────────────────────┐
│  AppConfig   │     │   Repository     │     │      Review        │
├──────────────┤     ├──────────────────┤     ├────────────────────┤
│ id (cuid)    │     │ id (cuid)        │     │ id (cuid)          │
│ key (unique) │     │ platform         │     │ repositoryId (FK)  │
│ value        │     │ owner            │     │ platform           │
└──────────────┘     │ name             │     │ prNumber           │
                     │ fullName (unique)│     │ prTitle            │
                     │ installationId?  │     │ prAuthor           │
                     │ gitlabHost?      │     │ prUrl              │
                     │ isActive         │     │ status             │
                     │ createdAt        │     │ summary?           │
                     │ updatedAt        │     │ overallScore?      │
                     └────────┬─────────┘     │ agentSteps? (JSON) │
                              │               │ modelUsed?         │
                              │ 1:N           │ tokensUsed?        │
                              ▼               │ checkRunId?        │
                     ┌──────────────────┐     │ headSha?           │
                     │    Review        │     │ createdAt          │
                     │                  │     │ updatedAt          │
                     └────────┬─────────┘     └────────┬───────────┘
                              │ 1:N                    │
                              ▼                        │
                     ┌────────────────────┐            │
                     │  ReviewComment     │◀───────────┘
                     ├────────────────────┤
                     │ id (cuid)          │
                     │ reviewId (FK)      │
                     │ filePath           │
                     │ line?              │
                     │ side? (LEFT|RIGHT) │
                     │ body               │
                     │ severity?          │
                     │ createdAt          │
                     └────────────────────┘
```

**AppConfig** — Key-value store for all configuration (tokens, AI settings, webhook secrets, merge protection toggle). Sensitive values are masked in API responses.

**Repository** — Tracked GitHub/GitLab repositories. GitHub repos store `installationId`; GitLab repos store `gitlabHost` (for self-hosted instances).

**Review** — Review records with status tracking (`pending` → `reviewing` → `completed`/`failed`), agent step logs (JSON), model/token usage, and Check Run references.

**ReviewComment** — Individual review comments linked to a review, with file path, line number, diff side, body, and severity level.

---

## Project Structure

```
codesentinel/
├── prisma/
│   └── schema.prisma              # Database models & migrations
├── src/
│   ├── app/
│   │   ├── api/
│   │   │   ├── route.ts           # Health check endpoint
│   │   │   ├── config/
│   │   │   │   └── route.ts       # GET/POST configuration (masked secrets)
│   │   │   ├── reviews/
│   │   │   │   ├── route.ts       # GET reviews (list, filter, paginate)
│   │   │   │   ├── [id]/
│   │   │   │   │   └── route.ts   # GET/DELETE single review
│   │   │   │   └── trigger/
│   │   │   │       └── route.ts   # POST manual review trigger
│   │   │   └── webhook/
│   │   │       ├── route.ts       # GitHub webhook handler
│   │   │       └── gitlab/
│   │   │           └── route.ts   # GitLab webhook handler
│   │   ├── globals.css            # Tailwind CSS 4 + oklch theme
│   │   ├── layout.tsx             # Root layout (Geist fonts, Sonner)
│   │   └── page.tsx               # Dashboard SPA (3 tabs)
│   ├── components/
│   │   └── ui/                    # 48 shadcn/ui components
│   ├── hooks/
│   │   ├── use-mobile.ts          # Responsive breakpoint hook
│   │   └── use-toast.ts           # Toast state management
│   └── lib/
│       ├── db.ts                  # Prisma client singleton
│       ├── utils.ts               # cn() helper (clsx + tailwind-merge)
│       ├── github.ts              # GitHub API: JWT auth, PR ops, Check Runs
│       ├── gitlab.ts              # GitLab API: MR ops, discussions, notes
│       └── reviewer.ts            # AI review engine: agent loop, tools, output parsing
├── public/
│   ├── logo.svg
│   └── robots.txt
├── Dockerfile                     # Multi-stage build (deps → build → run)
├── docker-compose.yml             # Single service + persistent volume
├── Caddyfile                      # Reverse proxy config
├── package.json
├── next.config.ts
├── tailwind.config.ts
└── tsconfig.json
```

---

## Getting Started

### Prerequisites

- **Node.js** 20+ or **Bun** runtime
- **SQLite** (included, no separate install needed)
- An **AI provider** — either a Zen/Oencode API key or z-ai-web-dev-sdk access

### Local Development

```bash
# Clone the repository
git clone <repo-url> codesentinel
cd codesentinel

# Install dependencies
bun install

# Set up the database
bun run db:push

# Generate Prisma client
bun run db:generate

# Start the development server
bun run dev
```

The app will be available at `http://localhost:3000`.

### Using Docker

```bash
# Build and run with docker-compose
docker-compose up -d

# Or build manually
docker build -t codesentinel .
docker run -p 3000:3000 -v codesentinel-data:/app/data codesentinel
```

---

## Configuration

All configuration is managed through the **Settings** tab in the dashboard UI, or directly via the `/api/config` endpoint. Sensitive values are masked in API responses.

### GitHub App Setup

1. **Create a GitHub App** at [GitHub Developer Settings](https://github.com/settings/apps)
   - Set **Webhook URL** to `https://your-domain.com/api/webhook`
   - Set **Webhook Secret** to a random string (save this)
   - Request these **permissions**:
     - Pull requests: Read & Write
     - Checks: Read & Write
     - Repository contents: Read-only
     - Commit statuses: Read-only
   - Subscribe to **events**: Pull request, Check run, Installation, Installation repositories
2. **Generate a Private Key** (PEM format) for the app
3. **Install the App** on your repositories
4. **Configure in CodeSentinel**:
   - GitHub App ID
   - GitHub App Private Key (PEM content)
   - Webhook Secret

### GitHub PAT (Fallback)

If you don't want to set up a GitHub App, you can use a Personal Access Token with `repo` scope. The system will fall back to PAT if no installation ID is available.

### GitLab Setup

1. **Create a GitLab Access Token** with `api` scope
2. **Set up a Webhook** in your GitLab project:
   - URL: `https://your-domain.com/api/webhook/gitlab`
   - Secret Token: a random string (save this)
   - Trigger: Merge request events
3. **Configure in CodeSentinel**:
   - GitLab Token
   - GitLab Host URL (default: `https://gitlab.com`, change for self-hosted)
   - GitLab Webhook Secret

### AI Provider Configuration

| Setting | Default | Description |
|---|---|---|
| `ai_provider` | `z-ai` | `z-ai` for z-ai-web-dev-sdk, `openai-compatible` for Zen/Oencode |
| `ai_model` | `default` | Model name to use (e.g., `default`, `advanced`, or a specific model ID) |
| `ai_api_key` | — | API key for the OpenAI-compatible provider |
| `ai_base_url` | `https://api.oencode.com/v1` | Base URL for the OpenAI-compatible API |
| `ai_temperature` | `0.3` | Sampling temperature (0.0 – 1.0) |
| `ai_max_steps` | `5` | Maximum agent loop iterations (1 – 10) |

### Merge Protection

| Setting | Default | Description |
|---|---|---|
| `block_merge` | `false` | When enabled, Check Run conclusions are set to `failure` for issues, which blocks merge if the check is required in branch protection rules |

> **Note**: Merge protection only takes effect if you also configure GitHub branch protection rules to require the "AI Code Review" check. The check always exists — `block_merge` controls whether it can fail.

### Environment Variables

| Variable | Required | Default | Description |
|---|---|---|---|
| `DATABASE_URL` | Yes | — | SQLite file path (e.g., `file:./data/reviewer.db`) or PostgreSQL URL |
| `NODE_ENV` | No | `development` | `production` for Docker builds |

All other settings (tokens, AI config, etc.) are stored in the database and managed through the UI.

---

## API Reference

### `GET /api`

Health check endpoint. Returns `{ status: "ok" }`.

### `GET /api/config`

Returns current configuration with sensitive values masked. Includes boolean flags: `hasToken`, `hasGitHubApp`, `hasGitLabToken`, `hasAIConfig`.

### `POST /api/config`

Update configuration. Accepts a JSON body with key-value pairs. Only whitelisted keys are accepted:

```json
{
  "github_app_id": "12345",
  "github_app_private_key": "-----BEGIN RSA PRIVATE KEY-----\n...",
  "github_token": "ghp_...",
  "webhook_secret": "my-secret",
  "gitlab_token": "glpat-...",
  "gitlab_host": "https://gitlab.example.com",
  "gitlab_webhook_secret": "my-gitlab-secret",
  "ai_provider": "openai-compatible",
  "ai_model": "default",
  "ai_api_key": "sk-...",
  "ai_base_url": "https://api.oencode.com/v1",
  "ai_temperature": "0.3",
  "ai_max_steps": "5",
  "block_merge": "false"
}
```

### `GET /api/reviews`

List reviews with query parameters:

| Param | Type | Description |
|---|---|---|
| `page` | number | Page number (default: 1) |
| `limit` | number | Items per page (default: 20) |
| `status` | string | Filter by status: `pending`, `reviewing`, `completed`, `failed` |
| `platform` | string | Filter by platform: `github`, `gitlab` |

### `GET /api/reviews/[id]`

Get a single review with all comments and parsed agent steps.

### `DELETE /api/reviews/[id]`

Delete a review and its associated comments.

### `POST /api/reviews/trigger`

Manually trigger a review:

```json
{
  "owner": "octocat",
  "repo": "hello-world",
  "prNumber": 42,
  "platform": "github"
}
```

### `POST /api/webhook`

GitHub webhook endpoint. Handles events:
- `installation` — Created/deleted (registers/removes repos)
- `installation_repositories` — Added/removed repos
- `pull_request` — Opened/synchronize (triggers review)
- `check_run` — Rerequested (re-runs review)

Verifies `X-Hub-Signature-256` HMAC-SHA256 signature if webhook secret is configured.

### `POST /api/webhook/gitlab`

GitLab webhook endpoint. Handles:
- `Merge Request Hook` — Open/update/reopen (triggers review)

Verifies `X-Gitlab-Token` if webhook secret is configured.

---

## Agent Design

The review agent operates in a **multi-turn loop** with two distinct phases:

### Phase 1: Investigate

The agent receives the PR/MR diff and metadata, then decides whether to use tools to gather more context. Available tools:

| Tool | Purpose | Parameters |
|---|---|---|
| `fetch_file` | Fetch full file content from the repository | `filePath`, `ref` (optional) |
| `search_pattern` | Search for a regex pattern in the diff | `pattern` |
| `check_tests` | Check if test files exist for a given source file | `filePath` |
| `analyze_deps` | Analyze dependency changes for known issues | `filePath` |

The agent can call tools multiple times across turns. Each tool result is fed back into the conversation, allowing the agent to build a complete understanding before reviewing.

### Phase 2: Review

After gathering context (or reaching the maximum step count), the agent transitions to the Review phase. It must produce structured JSON output:

```json
{
  "action": "final_review",
  "summary": "Overall summary of the review findings",
  "overallScore": "approve | request_changes | comment",
  "comments": [
    {
      "filePath": "src/auth/login.ts",
      "line": 42,
      "side": "RIGHT",
      "body": "SQL injection vulnerability: user input is directly interpolated into the query string.",
      "severity": "critical"
    }
  ],
  "agentSteps": [
    { "step": "analyze", "description": "Analyzed diff...", "timestamp": "..." },
    { "step": "tool_call", "tool": "fetch_file", "description": "Fetched file X for context" },
    { "step": "review", "description": "Produced final review" }
  ]
}
```

### Safety Mechanisms

- **Max Steps Clamp** — Agent loop iterations are clamped between 1 and 10
- **Forced Structured Output** — If the agent doesn't produce valid JSON within the max steps, a force prompt is sent to extract structured output
- **Fallback Parsing** — Multiple parsing strategies: code block extraction, full-response JSON parsing, and ultimate fallback to a generic "comment" review
- **Diff Truncation** — Diffs exceeding 30,000 characters are truncated to prevent token overflow
- **File Size Limit** — `fetch_file` tool truncates files larger than 8,000 characters

---

## Review Severity Levels

| Severity | GitHub Annotation | Check Run Impact (block_merge ON) | Description |
|---|---|---|---|
| `critical` | `failure` | Blocks merge | Security vulnerabilities, data loss risks |
| `error` | `failure` | Blocks merge | Bugs, logic errors |
| `warning` | `warning` | Does not block | Best practice violations, performance issues |
| `info` | `notice` | Does not block | Suggestions, style notes |

When `block_merge` is OFF (default), all check run conclusions are `neutral` or `success` regardless of severity.

---

## Deployment

### Docker (Recommended)

```bash
# Build and run
docker-compose up -d

# View logs
docker-compose logs -f

# Stop
docker-compose down
```

The Docker setup includes:
- Multi-stage build (deps → build → production)
- Non-root user (`nextjs`) in production
- Persistent SQLite volume (`pr-reviewer-data`)
- Automatic restart (`unless-stopped`)

### Vercel

```bash
# Deploy to Vercel
vercel --prod

# Set environment variables in Vercel dashboard
# DATABASE_URL must point to a PostgreSQL database (not SQLite)
```

> **Note**: For Vercel deployment, you need to switch from SQLite to PostgreSQL. Update the Prisma schema `datasource` block and set `DATABASE_URL` to a PostgreSQL connection string.

### Railway / Fly.io

Both platforms support Dockerfile-based deployments. Push the repository and configure:
- `DATABASE_URL` environment variable
- Port `3000` exposure

---

## Security Considerations

- **Webhook Signature Verification** — All webhook endpoints verify signatures before processing (HMAC-SHA256 for GitHub, token comparison for GitLab)
- **Timing-Safe Comparison** — GitHub signature verification uses `crypto.timingSafeEqual` to prevent timing attacks
- **JWT RS256** — GitHub App authentication uses RSA-SHA256 signed JWTs with 10-minute expiration
- **Config Value Masking** — Sensitive configuration values (tokens, keys) are masked in API responses
- **Non-Root Container** — Docker production image runs as the `nextjs` user (UID 1001)
- **No Hardcoded Secrets** — All credentials are stored in the database and configured through the UI

---

## Development Scripts

| Command | Description |
|---|---|
| `bun run dev` | Start development server on port 3000 |
| `bun run build` | Build for production (includes standalone output) |
| `bun run start` | Start production server |
| `bun run lint` | Run ESLint |
| `bun run db:push` | Push schema to database (no migration) |
| `bun run db:generate` | Generate Prisma client |
| `bun run db:migrate` | Run Prisma migrations |
| `bun run db:reset` | Reset database |

---

## Extending CodeSentinel

### Adding a New AI Provider

1. Add a new provider case in `src/lib/reviewer.ts` → `chatCompletion()` function
2. Update the `AIProviderConfig` interface with provider-specific fields
3. Add configuration keys to the whitelist in `/api/config`
4. Add UI fields in the Settings tab of `src/app/page.tsx`

### Adding a New Platform

1. Create a new integration library (e.g., `src/lib/bitbucket.ts`)
2. Create a new webhook route (e.g., `src/app/api/webhook/bitbucket/route.ts`)
3. Add platform-specific processing logic following the GitHub/GitLab patterns
4. Update the `ToolContext` interface and tool executors in `reviewer.ts`
5. Add platform option to the Manual Review UI

### Adding a New Agent Tool

1. Define the tool in the `AGENT_TOOLS` array in `reviewer.ts`
2. Add the tool execution logic to the `executeTool()` switch statement
3. The agent automatically discovers available tools from the system prompt

---

## License

MIT

---

## Acknowledgments

- Built with [Next.js](https://nextjs.org/), [Prisma](https://www.prisma.io/), [shadcn/ui](https://ui.shadcn.com/), and [Tailwind CSS](https://tailwindcss.com/)
- AI capabilities powered by [z-ai-web-dev-sdk](https://www.npmjs.com/package/z-ai-web-dev-sdk) and [Oencode](https://oencode.com/)

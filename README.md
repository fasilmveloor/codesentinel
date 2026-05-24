# CodeSentinel

[![CI](https://github.com/your-org/codesentinel/actions/workflows/ci.yml/badge.svg)](https://github.com/your-org/codesentinel/actions/workflows/ci.yml)
[![Tests](https://github.com/your-org/codesentinel/actions/workflows/ci.yml/badge.svg?branch=main&event=push)](https://github.com/your-org/codesentinel/actions/workflows/ci.yml)
[![Lint](https://github.com/your-org/codesentinel/actions/workflows/lint.yml/badge.svg)](https://github.com/your-org/codesentinel/actions/workflows/lint.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

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
| Can't interact with the reviewer like Claude/Gemini PR agents | Interactive slash commands (`/review`, `/fix`, `/explain`, `/ignore`, `/config`, `/help`, `/recheck`, `/check`, `/re-review`, `/review again`) in PR comment threads |
| Merge blocking is all-or-nothing | Per-repository configurable merge protection — OFF by default, opt-in per repo via dashboard or config |

---

## Features

### Core Review Engine
- **Two-Phase AI Agent** — Investigate phase gathers context using tools, then Review phase produces structured output with inline comments
- **8 Agent Tools** — `fetch_file`, `search_pattern`, `check_tests`, `analyze_deps`, `file_relationships`, `historical_context`, `symbol_search`, `architectural_impact` — the agent decides which tools to call and when
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
- `/recheck` — Re-review after changes
- `/check` — Quick check on a specific file or concern
- `/re-review` — Full re-review of the PR/MR
- `/review again` — Alias for re-review

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
│                    │  │     Agent Tools (8)      │       │       │
│                    │  │  • fetch_file            │       │       │
│                    │  │  • search_pattern        │       │       │
│                    │  │  • check_tests           │       │       │
│                    │  │  • analyze_deps          │       │       │
│                    │  │  • file_relationships    │       │       │
│                    │  │  • historical_context    │       │       │
│                    │  │  • symbol_search         │       │       │
│                    │  │  • architectural_impact  │       │       │
│                    │  └─────────────────────────┘       │       │
│                    │                                     │       │
│                    │  ┌─────────────────────────┐       │       │
│                    │  │   Hallucination Guards   │       │       │
│                    │  │  • File path validation  │       │       │
│                    │  │  • Line number checks    │       │       │
│                    │  │  • Comment count cap     │       │       │
│                    │  │  • ReDoS protection      │       │       │
│                    │  │  • Retry with backoff    │       │       │
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
│       │          │symbol_search          │       │
│       │          │file_relati            │       │
│       │          │blast_radius           │       │
│       │          └─────────┘             │       │
└──────────────────────────┬───────────────────────┘
                           │
                           ▼
┌──────────────────────────────────────────────────┐
│         Hallucination Guard Validation           │
│  • Filter comments with invalid file paths       │
│  • Cap comment count to prevent spam             │
│  • Ensure summary is present                     │
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
| **Language** | TypeScript 5 (strict mode, noImplicitAny) |
| **Runtime** | Bun (dev), Node 20 Alpine (Docker) |
| **Database** | SQLite via Prisma ORM 6 |
| **UI** | React 19, Tailwind CSS 4, shadcn/ui (55 components) |
| **Animation** | Framer Motion 11 |
| **AI SDK** | `z-ai-web-dev-sdk` + OpenAI-compatible API (Zen/Oencode) |
| **Icons** | Lucide React |
| **Toast** | Sonner |
| **Testing** | Vitest (unit + evaluation benchmarks) |
| **CI/CD** | GitHub Actions (lint, test, build) |
| **Deployment** | Docker (multi-stage), Caddy reverse proxy, docker-compose |

---

## Stateless Architecture

CodeSentinel uses a **stateless, JWT-based architecture** for authentication and a **database-backed** approach for rate limiting — no in-memory sessions or server-side state required.

### Authentication (JWT)
- Sessions are encoded as **HS256 JWT tokens** stored in HttpOnly cookies — no server-side session storage needed
- JWT secret is auto-generated on first boot and persisted in the database, surviving server restarts
- Token verification uses `crypto.timingSafeEqual` to prevent timing attacks
- Sessions expire after 7 days (configurable)
- Works correctly across multiple serverless instances or container restarts

### Rate Limiting (DB-Backed)
- Rate limit counters are stored in the **AppConfig** SQLite table, keyed by IP address
- Each entry stores `count:resetTime` and is automatically cleaned up after the window expires
- Works across serverless instances and survives server restarts (unlike in-memory rate limiters)
- Fails open: if the database is unavailable, requests are allowed through
- Default: 30 requests per minute per IP

---

## Structured Logging

CodeSentinel includes a built-in structured logger (`src/lib/logger.ts`) with the following features:

- **Log Levels**: `debug`, `info`, `warn`, `error` — controlled via `LOG_LEVEL` env var
- **Context Propagation**: Create child loggers with `logger.child({ component: 'reviewer' })` that inherit parent context
- **Production Mode**: Outputs structured JSON for easy ingestion by log aggregators (Datadog, CloudWatch, etc.)
- **Development Mode**: Pretty-printed, human-readable format with component tags and key=value pairs
- **Environment-Aware**: Defaults to `debug` in development, `info` in production

Example production log output:
```json
{"level":"info","timestamp":"2025-01-15T10:30:00.000Z","component":"reviewer","message":"Review completed","durationMs":4500,"steps":7}
```

Example development log output:
```
[INFO] 2025-01-15T10:30:00.000Z [reviewer] Review completed durationMs=4500 steps=7
```

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

**AppConfig** — Key-value store for all configuration (tokens, AI settings, webhook secrets, merge protection toggle, JWT secret, rate limit counters). Sensitive values are masked in API responses.

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
│   │   ├── ui/                    # 55 shadcn/ui components
│   │   ├── badges.tsx             # Severity & status badge components
│   │   ├── stat-card.tsx          # Dashboard stat card component
│   │   ├── review-detail-dialog.tsx # Full review detail dialog
│   │   ├── dashboard/
│   │   │   ├── dashboard-tab.tsx  # Main dashboard overview tab
│   │   │   └── manual-review-tab.tsx # Manual review trigger tab
│   │   ├── settings/
│   │   │   └── settings-tab.tsx   # Settings & configuration tab
│   │   └── layout/
│   │       ├── header.tsx         # App header component
│   │       └── footer.tsx         # App footer component
│   ├── hooks/
│   │   ├── use-mobile.ts          # Responsive breakpoint hook
│   │   └── use-toast.ts           # Toast state management
│   ├── lib/
│   │   ├── db.ts                  # Prisma client singleton
│   │   ├── utils.ts               # cn() helper (clsx + tailwind-merge)
│   │   ├── constants.ts           # Magic number constants & limits
│   │   ├── logger.ts              # Structured logger (JSON in prod)
│   │   ├── auth.ts                # JWT auth, password hashing, sessions
│   │   ├── rate-limit.ts          # DB-backed rate limiter
│   │   ├── format.ts              # Date formatting & key labels
│   │   ├── types.ts               # Shared TypeScript interfaces
│   │   ├── github.ts              # GitHub API: JWT auth, PR ops, Check Runs
│   │   ├── gitlab.ts              # GitLab API: MR ops, discussions, notes
│   │   ├── reviewer.ts            # AI review engine: agent loop, tools, hallucination guards
│   │   └── __tests__/
│   │       ├── constants.test.ts  # Constants validation tests
│   │       ├── auth.test.ts       # Auth & JWT tests
│   │       ├── rate-limit.test.ts # Rate limiter tests
│   │       ├── reviewer.test.ts   # Review parsing & building tests
│   │       ├── reviewer-tools.test.ts # Agent tool logic tests
│   │       ├── github.test.ts     # GitHub integration tests
│   │       ├── webhook-validation.test.ts # Webhook signature tests
│   │       └── evaluation-benchmarks.test.ts # AI review quality benchmarks
│   └── types/
│       └── index.ts               # Shared type definitions
├── public/
│   ├── logo.svg
│   └── robots.txt
├── vitest.config.ts               # Vitest configuration
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

### Running Tests

```bash
# Run all tests with Vitest
npx vitest run

# Run tests in watch mode
npx vitest

# Run a specific test file
npx vitest run src/lib/__tests__/reviewer.test.ts

# Run evaluation benchmarks
npx vitest run src/lib/__tests__/evaluation-benchmarks.test.ts
```

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
| `LOG_LEVEL` | No | `debug`/`info` | Log level (debug in dev, info in prod) |
| `COOKIE_SECURE` | No | — | Set to `true` to enable Secure flag on session cookies |

All other settings (tokens, AI config, etc.) are stored in the database and managed through the UI.

---

## API Reference

### `GET /api`

Health check endpoint. Returns `{ status: "ok", service: "codesentinel", version: "0.2.0" }`.

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
- `issue_comment` — PR comments with slash commands (`/review`, `/recheck`, `/check`, `/re-review`, `/review again`)

Verifies `X-Hub-Signature-256` HMAC-SHA256 signature if webhook secret is configured.

### `POST /api/webhook/gitlab`

GitLab webhook endpoint. Handles:
- `Merge Request Hook` — Open/update/reopen (triggers review)
- `Note Hook` — MR comments with slash commands (`/review`, `/recheck`, `/check`, `/re-review`)

Verifies `X-Gitlab-Token` if webhook secret is configured.

---

## Agent Design

The review agent operates in a **multi-turn loop** with two distinct phases:

### Phase 1: Investigate

The agent receives the PR/MR diff and metadata, then decides whether to use tools to gather more context. Available tools:

| Tool | Purpose | Parameters |
|---|---|---|
| `fetch_file` | Fetch full file content from the repository | `filePath`, `ref` (optional) |
| `search_pattern` | Search for a regex pattern in the diff (with ReDoS protection) | `pattern` |
| `check_tests` | Check if test files exist for a given source file | `filePath` |
| `analyze_deps` | Analyze dependency changes for known vulnerabilities and deprecation | `filePath` |
| `file_relationships` | Analyze import graph, detect coupling clusters, and blast radius | — |
| `historical_context` | Fetch previous reviews for the repository to identify recurring patterns | — |
| `symbol_search` | Find symbol definitions and usages across changed files (multi-language) | `symbol` |
| `architectural_impact` | Score architectural impact by analyzing affected layers and cross-boundary coupling | — |

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
- **Retry with Backoff** — Chat completions automatically retry up to 2 times with exponential backoff for transient API failures
- **ReDoS Protection** — `search_pattern` tool rejects regex patterns longer than 200 chars or with complexity score > 15
- **Diff Truncation** — Diffs exceeding 50,000 characters are truncated to prevent token overflow
- **File Size Limit** — `fetch_file` tool truncates files larger than 8,000 characters
- **Hallucination Guards** — Review output is validated against the diff context to catch and remove hallucinated file references:
  - File path validation: comments referencing files not present in the diff are filtered out
  - Fuzzy matching: partial path matches are allowed (e.g., relative vs. absolute paths)
  - Comment count cap: maximum 30 comments per review to prevent spam
  - Summary fallback: ensures a summary is always present
- **Review Mode Prompts** — Separate system prompts for `/fix` (fix suggestions), `/explain` (code explanation), and focused re-reviews

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

## Evaluation & Benchmarks

CodeSentinel includes an evaluation harness (`src/lib/__tests__/evaluation-benchmarks.test.ts`) that tests the AI review quality framework using curated bad PR diffs. The harness validates:

- **Sample Integrity** — All benchmark samples have required fields (name, diff, expectedCategories)
- **Uniqueness** — Sample names are unique to avoid double-counting
- **Diff Validity** — Each diff contains at least one added line (prefix `+`)
- **Category Coverage** — Security-related categories are present across the benchmark suite
- **Output Schema** — Valid overall scores (`approve`, `request_changes`, `comment`) and severity levels (`info`, `warning`, `error`, `critical`)
- **Hallucination Detection** — The guard logic is tested: comments with file paths not in the diff are rejected, line numbers exceeding diff range are flagged, and severity levels are validated against categories
- **Approval Suspicion** — A meta-test ensures the benchmark is not trivially approving all bad PRs

### Benchmark Categories

| Category | Example |
|---|---|
| SQL Injection | String interpolation in SQL queries |
| Hardcoded Secrets | API keys and passwords in source code |
| Prototype Pollution | `Object.assign` with untrusted input |
| Missing Error Handling | Unwrapped async/JSON.parse calls |
| Race Condition | Check-then-act without synchronization |
| Missing Input Validation | Direct `req.body` passthrough |

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
- **Timing-Safe Comparison** — GitHub signature verification and password hashing use `crypto.timingSafeEqual` to prevent timing attacks
- **JWT RS256** — GitHub App authentication uses RSA-SHA256 signed JWTs with 10-minute expiration
- **JWT HS256 Sessions** — Dashboard sessions use HMAC-SHA256 JWTs with timing-safe signature verification
- **Config Value Masking** — Sensitive configuration values (tokens, keys) are masked in API responses
- **DB-Backed Rate Limiting** — Rate limit counters are persisted in SQLite, working across serverless instances
- **Non-Root Container** — Docker production image runs as the `nextjs` user (UID 1001)
- **No Hardcoded Secrets** — All credentials are stored in the database and configured through the UI
- **Hallucination Guards** — Review output is validated against the diff to prevent the AI from referencing non-existent files or line numbers

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
| `npx vitest run` | Run all tests |
| `npx vitest` | Run tests in watch mode |
| `npx tsc --noEmit` | Type-check without emitting |

---

## Extending CodeSentinel

### Adding a New AI Provider

1. Add a new provider case in `src/lib/reviewer.ts` → `chatCompletion()` function
2. Update the `AIProviderConfig` interface with provider-specific fields
3. Add configuration keys to the whitelist in `/api/config`
4. Add UI fields in the Settings tab

### Adding a New Platform

1. Create a new integration library (e.g., `src/lib/bitbucket.ts`)
2. Create a new webhook route (e.g., `src/app/api/webhook/bitbucket/route.ts`)
3. Add platform-specific processing logic following the GitHub/GitLab patterns
4. Update the `ToolContext` interface and tool executors in `reviewer.ts`
5. Add platform option to the Manual Review UI

### Adding a New Agent Tool

1. Define the tool in the `AGENT_TOOLS` array in `reviewer.ts`
2. Add the tool execution logic to the `executeTool()` switch statement
3. Add pure function tests in `src/lib/__tests__/reviewer-tools.test.ts`
4. The agent automatically discovers available tools from the system prompt

### Adding Evaluation Benchmarks

1. Add new bad PR samples to `BAD_PR_SAMPLES` in `src/lib/__tests__/evaluation-benchmarks.test.ts`
2. Each sample needs `name`, `diff`, and `expectedCategories`
3. Add validation tests for any new categories

---

## License

MIT

---

## Acknowledgments

- Built with [Next.js](https://nextjs.org/), [Prisma](https://www.prisma.io/), [shadcn/ui](https://ui.shadcn.com/), and [Tailwind CSS](https://tailwindcss.com/)
- AI capabilities powered by [z-ai-web-dev-sdk](https://www.npmjs.com/package/z-ai-web-dev-sdk) and [Oencode](https://oencode.com/)
- Testing powered by [Vitest](https://vitest.dev/)

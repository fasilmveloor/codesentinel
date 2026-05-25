# CodeSentinel

**AI-powered code review for GitHub and GitLab pull requests.**

CodeSentinel is a self-hosted service that listens for PR/MR webhook events, runs a multi-turn AI review loop against a configurable AI backend, validates the output against the actual diff to prevent hallucinations, and posts structured inline review comments back to your PR.

It is not a linter. It is not a CI system. It is a configurable AI code reviewer that you self-host and control.

---

## Why this exists

Traditional linters catch formatting issues and known anti-patterns. They cannot evaluate architectural decisions, detect business logic errors, or understand intent.

Commercial AI review tools are opaque — you don't control the model, the data, or the cost. Your source code leaves your network.

CodeSentinel was built because:

- **Hallucination validation matters** — Most AI review tools post whatever the model outputs. CodeSentinel validates every comment against the actual diff before posting. If the model references a file path or line number that doesn't exist, the comment is filtered or corrected.
- **Self-hosting matters** — Your code never leaves your infrastructure. The AI provider call is the only external dependency, and you choose which provider.
- **Configurable review depth** — Some PRs need a quick scan, others need deep investigation with file fetching and symbol analysis. The agent loop depth is configurable per-instance.
- **Platform parity** — Most tools support only GitHub. CodeSentinel treats GitHub and GitLab as first-class platforms with the same feature set.

---

## How It Works

```
1. GitHub/GitLab sends a webhook (PR opened, synchronize, etc.)
2. CodeSentinel verifies the webhook signature (HMAC-SHA256 or token)
3. Fetches the PR diff and metadata from the platform API
4. Runs a multi-turn AI review loop against your configured AI provider
5. Validates the AI output against the actual diff (hallucination guard)
6. Posts inline review comments back to the PR with severity levels
7. Optionally creates Check Runs for merge protection
```

The full lifecycle is documented in detail at [docs/architecture.md](docs/architecture.md).

---

## Example Review

Here is what an actual review comment looks like on a GitHub PR:

```
⚠️ src/lib/database.ts:47-52 — Warning

Query method accepts raw user input via the `filter` parameter,
which is then interpolated directly into the SQL string.

Concerns:
- The `filter` object is spread into `WHERE` clauses with `.join(" AND ")`
- No parameterization or escaping is applied
- An attacker could inject SQL through crafted keys or values

Recommendation: Use the existing `queryBuilder.param()` method
for all user-supplied values, or validate the `filter` keys against
an allowlist of known column names.

Severity: warning
Score: request_changes
```

The AI model investigated the `database.ts` file (via the `get_file` tool), found the vulnerable query construction, and the hallucination guard confirmed the file path and line range exist in the actual diff before posting.

---

## Features

### Core Review Engine

| Feature | Implementation | Status |
|---------|---------------|--------|
| Multi-turn agent loop with 8 tools | `src/lib/reviewer.ts` | Complete. Tools add context: file fetching, symbol search, dependency analysis, relationship mapping, historical context, architectural impact scoring. |
| Structured output with severity levels | Parse → validate → build pipeline | Complete. Severity: `critical`/`error`/`warning`/`info`. Score: `approve`/`request_changes`/`comment`. |
| Configurable AI backend | z-ai-web-dev-sdk + OpenAI-compatible | Complete. Configurable per-instance: model, temperature, max agent steps (1–10). |
| Hallucination guard | `validateReviewAgainstDiff()` | Complete. Hunk-level line validation, fuzzy file path matching, severity validation. See [docs/agent-system.md](docs/agent-system.md). |

### Platform Support

| Feature | GitHub | GitLab |
|---------|--------|--------|
| PR/MR diff fetching | `GET /repos/:owner/:repo/pulls/:number` (Accept: diff) | `GET /api/v4/projects/:id/merge_requests/:iid/changes` |
| PR/MR metadata | Full PR info with stats | Full MR info with diff stats |
| Reviews | PR Review API (inline comments + body) | Note + Discussion API (inline + general) |
| Check Runs | Create + Update with annotations + pass/fail | N/A |
| Auth | JWT RS256 → installation token, or PAT | Personal Access Token (PRIVATE-TOKEN header) |
| Webhook events | HMAC-SHA256, delivery dedup | Token-based, timing-safe comparison |

### Slash Commands

All commands work on both GitHub (PR comments) and GitLab (MR notes):

| Command | Description |
|---------|-------------|
| `/review` | Trigger a full review |
| `/recheck` / `/check` | Re-review after changes |
| `/re-review` / `/review again` | Full re-review alias |
| `/fix` | Request fix suggestions |
| `/explain` | Request code explanation |
| `/ignore <pattern>` | Skip files matching glob pattern |
| `/config [key=value]` | View or update settings |
| `/help` | Show available commands |

### Merge Protection

When enabled (`block_merge=true`), CodeSentinel creates GitHub Check Runs that:
- Show `in_progress` during review
- Show `failure` if the review finds critical/error issues
- Show `success` if approved
- Map severity to annotation levels: `critical`/`error` → failure, `warning` → warning, `info` → notice

Merge protection is **opt-in per repository** and disabled by default. Enabling it requires also configuring GitHub branch protection rules to require the "AI Code Review" check.

### Dashboard

Single-page React application with:
- Stats overview (total reviews, pass rate, active repositories)
- Review table with filtering by status/platform/pagination
- Review detail dialog with agent step timeline and severity-tagged comments
- Manual review trigger
- Configuration panel (tokens, AI provider, merge protection)

---

## Project Structure

```
src/
├── app/
│   ├── api/                    # Next.js API routes
│   │   ├── route.ts            # Health check (with DB probe)
│   │   ├── webhook/            # GitHub + GitLab webhook handlers
│   │   ├── config/             # Configuration management
│   │   ├── reviews/            # Review listing, detail, trigger
│   │   ├── auth/               # Login, logout, setup, status
│   │   └── cleanup/            # Rate limit entry cleanup
│   ├── components/             # React UI components
│   └── lib/                    # Core engine
│       ├── reviewer.ts         # AI review loop + 8 tools + hallucination guard
│       ├── github.ts           # GitHub API client
│       ├── gitlab.ts           # GitLab API client
│       ├── auth.ts             # JWT sessions + password hashing
│       ├── rate-limit.ts       # DB-backed rate limiter
│       ├── queue.ts            # Persistent job queue
│       ├── secrets.ts          # AES-256-GCM encryption
│       ├── validation.ts       # Input sanitization
│       ├── logger.ts           # Structured logger
│       └── __tests__/          # 460 tests across 23 files
├── middleware.ts               # Route protection
└── prisma/
    └── schema.prisma           # 4 models: AppConfig, Repository, Review, ReviewComment
```

Full documentation at [docs/architecture.md](docs/architecture.md).

---

## Quick Start

### Prerequisites

- Node.js 20+ or Bun
- An AI provider API key (z-ai-web-dev-sdk or OpenAI-compatible)

### Local Development

```bash
git clone <repo-url> codesentinel
cd codesentinel
bun install
bun run db:push
bun run db:generate
bun run dev
```

Open `http://localhost:3000`, set up an admin password, then configure your credentials in Settings.

### Docker

```bash
docker-compose up -d
```

See [docs/deployment.md](docs/deployment.md) for production setup, environment variables, reverse proxy configuration, and scaling considerations.

---

## Configuration

All configuration is managed through the dashboard or API. Stored in the `AppConfig` table.

| Setting | Default | Description |
|---------|---------|-------------|
| `ai_provider` | `z-ai` | `z-ai` or `openai-compatible` |
| `ai_model` | `default` | Model name |
| `ai_temperature` | `0.3` | Sampling temperature |
| `ai_max_steps` | `5` | Agent loop iterations (1–10) |
| `block_merge` | `false` | Enable Check Run merge blocking |

See [docs/api-reference.md](docs/api-reference.md) for the full list of configurable keys.

---

## Security

| Layer | Mechanism |
|-------|-----------|
| Webhook auth | HMAC-SHA256 (GitHub) / token comparison (GitLab) — both timing-safe |
| Dashboard auth | JWT HS256 sessions in HttpOnly cookies, scrypt password hashing |
| Rate limiting | DB-backed, IP-based (30 req/min webhook, 5 req/min login) |
| Input validation | Path traversal prevention, null byte rejection, ReDoS protection |
| Output validation | Hallucination guard validates AI comments against actual diff |
| Secrets | AES-256-GCM encryption module, masked in API responses |
| HTTP headers | CSP, X-Content-Type-Options, X-Frame-Options, Referrer-Policy |
| Delivery dedup | `x-github-delivery` deduplication with 5-minute window |

See [docs/security.md](docs/security.md) for the full threat model and operational security considerations.

---

## Documentation

| Document | Audience | Contents |
|----------|----------|---------|
| [docs/architecture.md](docs/architecture.md) | Engineers | Full system architecture, data flow, component map, sequence diagrams |
| [docs/agent-system.md](docs/agent-system.md) | Engineers | How the AI loop works, tool system, hallucination guard, limitations |
| [docs/security.md](docs/security.md) | Operators | Threat model, auth flows, input validation, deployment hardening |
| [docs/deployment.md](docs/deployment.md) | Operators | Docker, env vars, reverse proxy, production hardening, scaling |
| [docs/api-reference.md](docs/api-reference.md) | Integrators | All API routes, request/response formats, auth requirements |
| [docs/testing.md](docs/testing.md) | Contributors | Test architecture, coverage, known gaps, how to add tests |
| [docs/contributing.md](docs/contributing.md) | Contributors | Setup, code style, PR workflow, how to add tools/providers |
| [docs/roadmap.md](docs/roadmap.md) | Everyone | Short/long-term improvements, explicitly non-goals |

---

## Limitations

- **SQLite single-writer** — The default database is SQLite. For multi-instance deployments, PostgreSQL is recommended.
- **No AST analysis** — All code analysis is regex-based. True semantic understanding depends on the AI model.
- **No AI quality evaluation harness** — Benchmarks test the evaluation framework, not the AI model's review quality. See [docs/roadmap.md](docs/roadmap.md) for planned evaluation harness.
- **No comment count cap** — The agent loop may generate more comments than ideal for very large PRs.
- **No summary fallback** — If the AI fails to generate a summary, there is no fallback content beyond an error message.
- **No UI test coverage** — All 460 tests are server-side logic. UI components are untested.
- **Secrets stored in plaintext** — Configuration secrets are stored in the DB without encryption at rest. The encryption module exists but is not wired into the config save/load path.
- **Not a true agent** — The review loop is a structured chat completion with tool availability, not an autonomous agent with planning or learning.

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Framework | Next.js 16 (App Router, standalone output) |
| Language | TypeScript 5 (strict, noImplicitAny) |
| Database | SQLite via Prisma ORM 6 |
| UI | React 19, Tailwind CSS 4, shadcn/ui |
| AI SDK | z-ai-web-dev-sdk + OpenAI-compatible |
| Testing | Vitest (460 tests) |

---

## License

MIT

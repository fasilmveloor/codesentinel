# CodeSentinel

AI-assisted code review for GitHub and GitLab pull requests. Self-hosted. Hallucination-validated output.

## Commands

```bash
bun run dev        # Dev server on port 3000
bun run build      # Production build (standalone output)
bun run start      # Start production server
bun run lint       # ESLint
bun run test       # Vitest (460 tests, 23 files)
bun run db:push    # Push Prisma schema
bun run db:generate # Generate Prisma client
bun run db:migrate # Run migrations
bun run db:reset   # Reset database
```

## Architecture

**Stack**: Next.js 16 (App Router), TypeScript 5 strict, Prisma (PostgreSQL), Tailwind CSS 4, shadcn/ui, z-ai-web-dev-sdk, Zustand

**Core flow**:
1. Webhook (GitHub/GitLab) → `src/app/api/webhook/route.ts` — HMAC verification, delivery dedup
2. Review queued → `src/lib/reviewer.ts` — multi-turn AI agent loop (configurable 1-10 steps)
3. 8 tools available to AI: file fetching, symbol search, dep analysis, relationship mapping, historical context, architectural scoring
4. Output validated → `validateReviewAgainstDiff()` hallucination guard checks file paths, line ranges, hunks
5. Results posted → `src/lib/github.ts` / `src/lib/gitlab.ts` — inline comments, check runs, severity tags

**Key modules**:
- `src/lib/reviewer.ts` — AI review loop (1777 lines, main refactoring target)
- `src/lib/github.ts` — GitHub API (REST + checks)
- `src/lib/gitlab.ts` — GitLab API
- `src/lib/auth.ts` — JWT HS256 sessions, scrypt password hashing
- `src/lib/rate-limit.ts` — DB-backed IP rate limiter
- `src/lib/logger.ts` — Structured logger (debug/info/warn/error)
- `src/lib/secrets.ts` — AES-256-GCM encryption (not yet wired to config path)
- `src/lib/validation.ts` — Input sanitization (ReDoS protection, path traversal prevention)
- `src/lib/queue.ts` — DB-backed persistent job queue
- `src/lib/tracer.ts` — Distributed tracing (span IDs)

**Database** (Prisma, 4 models): AppConfig (key-value config), Repository (repos being monitored), Review (review status/summary/scores), ReviewComment (line-level comments with severity)

**API routes**:
- `GET /api` — Health check with DB probe
- `POST /api/webhook` — GitHub webhook
- `POST /api/webhook/gitlab` — GitLab webhook
- `GET/POST /api/reviews` — List/create reviews
- `GET/DELETE /api/reviews/[id]` — Single review
- `POST /api/reviews/trigger` — Manual trigger
- `GET/PUT /api/config` — App configuration
- `POST /api/auth/setup` — Initial admin setup
- `POST /api/auth/login` — Login
- `POST /api/auth/logout` — Logout
- `GET /api/auth/status` — Session status
- `POST /api/auth/change-password` — Password change
- `DELETE /api/cleanup` — Rate limit entry cleanup
- `GET /api/cleanup/scheduled` — Cron-triggered cleanup

**Slash commands** (in PR/MR comments): `/review`, `/recheck`, `/fix`, `/explain`, `/ignore <pattern>`, `/config [key=value]`, `/help`

**Merge protection**: Opt-in GitHub Check Runs with pass/fail based on severity (critical/error → failure, warning → annotation, info → notice)

## Full docs (for deeper context)

| Doc | What it covers |
|-----|---------------|
| `docs/architecture.md` | System diagrams, data flow, sequence diagrams, ER model, failure modes |
| `docs/agent-system.md` | AI loop internals, tool limitations, hallucination guard, parsing fallback chain |
| `docs/security.md` | Threat model, auth flows, webhook verification, deployment hardening |
| `docs/deployment.md` | Docker, env vars, reverse proxy, production setup |
| `docs/api-reference.md` | All routes, request/response formats, config keys |
| `docs/testing.md` | Test architecture (460 tests), coverage map, known gaps |
| `docs/contributing.md` | Setup, code style, how to add tools/providers/platforms |
| `docs/roadmap.md` | Short/long-term improvements, non-goals |

## Known limitations

- reviewer.ts is 1777 lines — needs splitting into `review/` directory
- PostgreSQL is the primary database (Docker for local, Neon for serverless)
- Secrets at rest not encrypted (module exists, not wired)
- No AST analysis — regex-based
- No comment count cap, no summary fallback
- No AI quality evaluation harness
- No UI test coverage
- Middleware convention deprecated in Next.js 16 (should use `proxy`)

## Environment

- `DATABASE_URL` — PostgreSQL connection string (default: `postgresql://codesentinel:codesentinel@localhost:5432/codesentinel`)
- GitHub token, webhook secret, AI provider config stored in AppConfig table (via Settings UI)

# Contributing

---

## Local Setup

```bash
# Prerequisites: Node.js 20+ or Bun
git clone <repo-url> codesentinel
cd codesentinel

# Install dependencies
bun install

# Generate Prisma client
bun run db:generate

# Push schema to SQLite
bun run db:push

# Start dev server
bun run dev
```

The app will be available at `http://localhost:3000`. Database file will be created at `db/custom.db` or the path specified by `DATABASE_URL`.

---

## Code Organization

```
src/
├── app/
│   ├── api/                   # Next.js API routes
│   │   ├── route.ts           # Health check (GET /api)
│   │   ├── auth/              # Login, logout, setup, status
│   │   ├── config/            # GET/POST configuration
│   │   ├── reviews/           # List, detail, delete, trigger
│   │   ├── webhook/           # GitHub + GitLab webhook handlers
│   │   └── cleanup/           # Rate limit cleanup endpoints
│   ├── auth/login/            # Login page
│   ├── layout.tsx             # Root layout
│   └── page.tsx               # Dashboard SPA
├── components/
│   ├── ui/                    # shadcn/ui components (radix-based)
│   ├── dashboard/             # Dashboard tab components
│   ├── settings/              # Settings tab components
│   └── layout/                # Header, footer
├── hooks/                     # React hooks
├── lib/
│   ├── github.ts              # GitHub API client
│   ├── gitlab.ts              # GitLab API client
│   ├── reviewer.ts            # AI review engine
│   ├── auth.ts                # JWT auth, sessions
│   ├── rate-limit.ts          # DB-backed rate limiter
│   ├── queue.ts               # Job queue
│   ├── secrets.ts             # Encryption utilities
│   ├── validation.ts          # Input validation
│   ├── logger.ts              # Structured logger
│   ├── tracer.ts              # Distributed tracing context
│   ├── review-timeout.ts      # Promise timeout wrapper
│   ├── constants.ts           # App-wide constants
│   ├── db.ts                  # Prisma singleton
│   └── __tests__/             # Test files
├── types/
│   └── index.ts               # Shared type definitions
└── middleware.ts              # Route protection middleware
```

### Key Architectural Rules

1. **`lib/` modules are pure logic** — No Next.js API route dependencies. Should be testable without `NextRequest`/`NextResponse`.
2. **`app/api/` routes are thin handlers** — Parse request, call `lib/` module, return response. No business logic.
3. **State lives in SQLite** — No in-memory state except singleton caches (Prisma client, JWT secret). Everything else goes through Prisma.
4. **Auth is per-route** — Each API route calls `requireAuth()` explicitly. Middleware provides UX protection only.
5. **Sensitive config is masked** — Config GET endpoint masks values for keys in `SENSITIVE_KEYS`. Never return raw tokens.

---

## Testing Workflow

```bash
# Run all tests
bun run test

# Run tests in watch mode
bun run test:watch

# Run coverage
bun run test:coverage

# Run a specific test file
npx vitest run src/lib/__tests__/reviewer.test.ts

# Run evaluation benchmarks
npx vitest run src/lib/__tests__/evaluation-benchmarks.test.ts
```

### Before Submitting

```bash
bun run lint          # ESLint — all warnings must be addressed
bun run build         # Production build — must compile
```

---

## Commit Conventions

We follow [Conventional Commits](https://www.conventionalcommits.org/):

```
<type>(<scope>): <description>

[optional body]
```

**Types:** `feat`, `fix`, `docs`, `refactor`, `test`, `chore`
**Scopes:** `webhook`, `reviewer`, `github`, `gitlab`, `auth`, `rate-limit`, `ui`, `deps`, `docs`, etc.

Examples:
```
feat(webhook): add Bitbucket webhook endpoint
fix(auth): handle session token expiration edge case
docs(readme): update deployment instructions
test(reviewer): add tool execution edge case tests
```

---

## How to Add a New Agent Tool

1. **Add to the tool list** — `src/lib/reviewer.ts`, `AGENT_TOOLS` array:
   ```typescript
   { name: 'my_tool', description: 'What it does', parameters: ['param1', 'param2'] }
   ```
2. **Implement the handler** — Add a `case 'my_tool':` block in `executeTool()`:
   ```typescript
   case 'my_tool': {
     // Validate params, execute, return string result
     return 'Tool result';
   }
   ```
3. **Update the system prompt** — Add the tool description to the `AGENT_SYSTEM_PROMPT` section.
4. **Write tests** — `src/lib/__tests__/reviewer-tools.test.ts`
5. **Document** — Add to `docs/agent-system.md` and the README agent tools table.

---

## How to Add a New AI Provider

1. **Add provider case** — In `src/lib/reviewer.ts`, `chatCompletion()`:
   ```typescript
   if (config.provider === 'my-provider') {
     return await myProviderCompletion(config, messages);
   }
   ```
2. **Update config** — Add the provider key to `allowedKeys` in `src/app/api/config/route.ts`.
3. **Add UI fields** — `src/components/settings/ai-config-card.tsx`.
4. **Update documentation** — `docs/deployment.md` configuration section.

---

## How to Add a New Platform

1. **Create integration library** — `src/lib/bitbucket.ts` with fetch diff, fetch PR info, post review, etc.
2. **Create webhook route** — `src/app/api/webhook/bitbucket/route.ts`.
3. **Update `ToolContext`** — Add platform-specific fields in `src/lib/reviewer.ts`.
4. **Update tool executors** — Add platform cases in `executeTool()` for platform-specific API calls.
5. **Add trigger support** — Update `src/app/api/reviews/trigger/route.ts`.
6. **Add UI** — Platform selector in manual review tab, settings card.

---

## How to Add a New Slash Command

1. **Add to `COMMENT_COMMANDS`** — `src/app/api/webhook/route.ts:46`.
2. **Add handler logic** — In the GitHub webhook's issue_comment handler (~`:400-537`).
3. **Add GitLab handler** — In `src/app/api/webhook/gitlab/route.ts` Note Hook handler.
4. **Update help text** — The `/help` command response lists all available commands.
5. **Document** — Add to README slash commands table.

---

## Code Style Guide

- **TypeScript** — `strict: true`, `noImplicitAny: true`. All functions must have typed parameters and return types.
- **Error handling** — Use `try/catch` with `logger.error()` consistently. Avoid `catch { /* */ }` without at least a comment explaining why.
- **Async** — All database and API operations are async. Use `Promise.all()` for parallel requests. Use the `AbortController` pattern for timeouts.
- **Imports** — Use `@/` path aliases (e.g., `import { db } from '@/lib/db'`).
- **No barrel imports** — Import directly from the module file, not from index files.

---

## Documentation Expectations

- **README changes** — Must update `docs/` if adding features that change user-facing behavior.
- **API changes** — Must update `docs/api-reference.md`.
- **Architecture changes** — Must update `docs/architecture.md`.
- **Security changes** — Must update `docs/security.md`.
- **No feature should exist without documentation** — If it's not documented, it doesn't exist to users.

---

## Review Expectations

All PRs require:
1. Clean lint and typecheck
2. All tests passing (existing + new)
3. Documentation updates for any user-facing changes
4. No unexplained `catch { /* */ }` (silent error swallowing)
5. No hardcoded secrets or tokens
6. No `any` type without a justified reason

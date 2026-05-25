# Roadmap

This document outlines realistic short-term and long-term improvements for CodeSentinel. Items are prioritized by impact and feasibility.

---

## Short-Term (1–3 Months)

### Fix Documentation-VS-Code Discrepancies

The README claims features that don't exist in code:

- **Comment count cap** — Documented as "max 30 comments per review" but not implemented. Either implement a configurable cap in `validateReviewAgainstDiff()` or remove from docs.
- **Summary fallback** — Documented as "ensures summary is always present" but `buildReviewResult()` passes through `parsed.summary || ''` without generation. Implement a fallback that generates a summary from comments if missing.

### Split reviewer.ts (1777 lines)

Currently `src/lib/reviewer.ts` bundles:
- AI provider configuration
- Two chat completion backends (z-ai + OpenAI-compatible)
- 8 tool implementations
- Hallucination guard (extract + validate)
- Agent loop
- System prompts (4)
- Output parsing + building

**Proposed structure:**
```
src/lib/review/
├── agent-loop.ts       # Multi-turn loop orchestration
├── tools.ts            # All 8 tool implementations
├── hallucination-guard.ts  # Diff validation
├── prompts.ts          # System prompt constants
├── parse.ts            # JSON parsing + fallback
├── build.ts            # ReviewResult construction
└── index.ts            # Re-exports
```

### Split webhook/route.ts (689 lines)

Currently bundles signature verification, delivery dedup, event dispatch, process orchestration, and slash command handling. Proposed split:

```
src/app/api/webhook/
├── verify.ts           # HMAC verification
├── dedup.ts            # Delivery ID deduplication
├── process.ts          # processReview() orchestration
├── commands.ts         # Slash command handling
└── route.ts            # Thin route handler
```

### Convert Inline Test Implementations to Real Imports

Several test files replicate implementation logic instead of importing the real module:

| File | Currently | Should |
|------|-----------|--------|
| `reviewer-tools.test.ts` | Inlines `searchPattern()`, `symbolSearch()`, `architecturalImpact()` | Import from `@/lib/reviewer` after tool split |
| `gitlab.test.ts` | Inlines `encodeProjectPath()`, `formatMRChangesToDiff()` | Import from `@/lib/gitlab` (need to export internal functions) |
| `job-queue.test.ts` | Inlines `SimpleQueue` class | Import `PersistentQueue` from `@/lib/queue` (need DB mocking) |

---

## Medium-Term (3–6 Months)

### PostgreSQL Support

SQLite is the default and works for single-instance deployments. For multi-instance or high-throughput deployments, PostgreSQL should be a supported option.

**What's needed:**
- Prisma schema already uses generic Prisma types — `provider = "postgresql"` switch is the main change
- Rate limiting logic is already Prisma-generic
- Delivery dedup uses `AppConfig` table — works with any DB
- Queue module stores in `Review` table — works with any DB
- Need: migration guide, `DATABASE_URL` examples for hosted Postgres

### Persistent Queue

The current queue (`queue.ts`) uses the `Review` table with a `repositoryId: 'queue'` hack. A proper queue needs:

- Separate `Job` table with proper indexes on `status`, `type`, `priority`
- Exponential backoff with configurable base delay
- Dead-letter queue (jobs that exceed max retries)
- Job cancellation (for duplicate webhook events)
- Queue metrics endpoint (depth, latency, failure rate)

### Token Cost Tracking

The review engine tracks token usage per review but doesn't persist it in a queryable format. Needed:

- `TokenUsage` table (reviewId, model, prompt_tokens, completion_tokens, estimated flag)
- Dashboard widget showing cost per period
- Budget alerts

### Webhook UI Management

Currently, webhook secrets must be configured via the dashboard "Settings" page. A better UX would include:

- Webhook URL display (copy to clipboard)
- Test webhook button (send a test event)
- Delivery history log
- Last verification status

---

## Long-Term (6–12 Months)

### Semantic Repository Analysis

The current tool suite is regex-and-API-based. Deeper analysis would require:

- **AST-based code analysis** — Use language-specific parsers (TypeScript: `ts-morph`, Python: `tree-sitter`) to detect actual code patterns, not text patterns
- **Dependency graph** — Parse `package-lock.json` / `yarn.lock` / `go.sum` to build a full transitive dependency tree, then cross-reference against CVE databases
- **Data flow analysis** — Track taint propagation from user input to sensitive operations

### Evaluation Harness

The current evaluation benchmarks test the test infrastructure, not the AI model. A proper harness would:

- Run reviews against a curated test suite of PRs with known issues
- Compare review output against ground-truth annotations
- Track precision/recall per severity level
- Allow A/B testing of prompt changes
- Gate CI on review quality metrics

### Observability Stack

- **OpenTelemetry integration** — Trace webhook → review → post lifecycle
- **Structured metrics** — Review latency, tool call distribution, hallucination rate, token consumption
- **Alerting** — Failed review rate > threshold, rate limit saturation, AI provider timeout
- **Dashboard** — Pre-built Grafana dashboard for the above metrics

### Multi-Tenant Architecture

For organizations that want to host a single CodeSentinel instance for multiple teams:

- Organization-scoped repositories (already partially supported by `Repository` model)
- Team-based access control
- Per-organization AI provider configuration
- Shared rate limiting per organization

### Enterprise Hardening

- **Audit log** — Immutable log of all configuration changes, review triggers, and auth events
- **SCIM provisioning** — User management via Okta/Azure AD
- **Encryption at rest** — Full integration of the AES-256-GCM secrets module into config save/load
- **SIEM integration** — Structured logs pre-formatted for Splunk/Datadog/Loki

---

## Non-Goals (Explicit)

These are intentionally out of scope for Core CodeSentinel:

- **Replacing GitHub Actions / GitLab CI** — CodeSentinel is a review companion, not a CI system
- **Running user-submitted code** — No sandboxed code execution
- **Real-time collaboration** — Reviews are async; no live editing or multi-user cursors
- **PR merging** — CodeSentinel creates check run signals but does not merge PRs

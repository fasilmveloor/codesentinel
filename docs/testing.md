# Testing

---

## Philosophy

This project values **functional correctness** over coverage metrics. Tests focus on:

1. **Critical execution paths** — Webhook signature verification, review parsing, AI provider fallback, hallucination guard
2. **Edge cases in diff parsing** — Multi-hunk diffs, new files, deleted files, renamed files
3. **Security boundaries** — Path traversal rejection, ReDoS protection, signature verification
4. **Data integrity** — Review creation, comment storage, status transitions
5. **Constants validation** — Timeouts, limits, regex patterns are validated against known constraints

---

## Test Architecture

```
src/lib/__tests__/            ← Unit tests for lib modules
src/app/api/__tests__/        ← Integration tests for API routes
```

**Framework:** [Vitest](https://vitest.dev/) v4
**Runtime:** Node.js (all tests are server-side, no browser runner needed)
**Config:** `vitest.config.ts` with `@/` path alias resolution

```typescript
// vitest.config.ts
export default defineConfig({
  resolve: { alias: { '@': path.resolve(__dirname, './src') } },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
```

### Running Tests

```bash
# All tests
bun run test

# Watch mode
bun run test:watch

# Coverage
bun run test:coverage

# Single file
npx vitest run src/lib/__tests__/reviewer.test.ts

# Evaluation benchmarks only
npx vitest run src/lib/__tests__/evaluation-benchmarks.test.ts
```

---

## Test Breakdown (460 tests, 23 files)

### Unit Tests (19 files in `src/lib/__tests__/`)

| File | Tests | What it covers |
|------|-------|----------------|
| `reviewer.test.ts` | ~50 | Review parsing, fallback chain, `buildReviewResult()`, `extractDiffLineRanges()`, `validateReviewAgainstDiff()` |
| `reviewer-tools.test.ts` | ~80 | Tool execution logic: `searchPattern()`, `symbolSearch()`, `architecturalImpact()`, file relationship analysis |
| `hallucination-guard.test.ts` | ~40 | Diff range extraction, hunk-level validation, fuzzy path matching, inter-hunk gap detection |
| `auth.test.ts` | ~70 | Password hashing, JWT creation/verification, timing-safe comparison, session management |
| `rate-limit.test.ts` | ~50 | Rate limit window, cleanup, fail-open behavior |
| `github.test.ts` | ~30 | `validateRepoName()`, `generateJWT()` |
| `gitlab.test.ts` | ~30 | Project path encoding, MR diff formatting |
| `webhook-validation.test.ts` | ~20 | Signature verification, timing-safe comparison edge cases |
| `secrets.test.ts` | ~15 | AES-GCM encrypt/decrypt, masking, secret pattern detection |
| `validation.test.ts` | ~15 | Input sanitization, PR number validation, URL validation |
| `job-queue.test.ts` | ~15 | In-memory queue enqueue/dequeue/retry/stats |
| `logger.test.ts` | ~10 | Logger creation, child context propagation, tracer spans |
| `webhook-handler.test.ts` | ~40 | Event dispatch, slash command parsing, error responses |
| `format.test.ts` | ~10 | Date formatting |
| `evaluation-benchmarks.test.ts` | ~20 | Benchmark schema validation, category coverage |
| `middleware.test.ts` | ~10 | Route protection logic |
| `e2e-integration.test.ts` | ~60 | Full review lifecycle with mock data |
| `gitlab-integration.test.ts` | ~30 | GitLab API mocking |
| `constants.test.ts` | ~10 | Constant validity checks |

### API Tests (4 files in `src/app/api/__tests__/`)

| File | Tests | What it covers |
|------|-------|----------------|
| `health.test.ts` | ~10 | Health endpoint JSON structure, DB probe, rate limiter stats |
| `reviews.test.ts` | ~15 | Review listing, error handling |
| `config.test.ts` | ~15 | Config GET/POST, masking, key validation |
| `api-validation.test.ts` | ~15 | API request validation, error formats |

---

## Testing Notes

### The Hallucination Test Suite

The hallucination guard tests are the most technically interesting. They validate:

- **Hunk extraction** — Verifies that `extractDiffLineRanges()` correctly parses unified diff headers and produces accurate `HunkRange` objects
- **Hunk-level line validation** — Tests that comments referencing lines within ±2 of a hunk boundary are accepted, while lines in gaps between hunks are flagged
- **Fuzzy path matching** — Tests that comment file paths that don't exactly match the diff format (e.g., relative vs absolute) are still accepted
- **All-filtered recovery** — Tests the edge case where ALL comments fail validation, ensuring the guard preserves them with stripped line numbers instead of producing an empty review

### The Evaluation Benchmarks

The evaluation benchmark suite (`evaluation-benchmarks.test.ts`) tests the **framework** for evaluating AI review quality, not the AI model itself:

- 8 curated "bad PR" samples covering: SQL injection, hardcoded secrets, prototype pollution, missing error handling, race conditions, missing input validation, insecure deserialization
- Validates that samples have correct format (diff, expected categories)
- Validates that the hallucination guard rejects hallucinated comments
- Does **not** validate that the AI model actually catches these issues — it tests the test infrastructure

---

## Known Testing Gaps

1. **No AI model integration tests** — The chat completion and tool execution paths are tested with mocked AI responses. There are no integration tests that call a real AI provider. This means AI quality regressions are not caught by CI.

2. **Inline implementation replication** — Several test files (`reviewer-tools.test.ts`, `gitlab.test.ts`, `job-queue.test.ts`) replicate the implementation logic inline rather than importing the real module. This means tests can pass when the real implementation is broken. These should be converted to import the real modules.

3. **No UI component tests** — The React components (dashboard tabs, settings panels, dialog components) have no test coverage. All 460 tests are server-side logic tests.

4. **No E2E browser tests** — There are no Playwright or Cypress tests. The `e2e-integration.test.ts` file tests the full review lifecycle programmatically but does not run a browser.

5. **No load tests** — Rate limiting is unit-tested but there are no concurrency tests.

6. **No snapshot tests** — API response formats are asserted inline but not snapshotted.

---

## Adding Tests

### Unit test pattern

```typescript
import { describe, it, expect } from 'vitest';
import { yourFunction } from '@/lib/your-module';

describe('Your Function', () => {
  it('should handle normal input', () => {
    expect(yourFunction('input')).toBe('expected');
  });

  it('should handle edge case', () => {
    expect(yourFunction(null)).toBe('fallback');
  });
});
```

### Where to put tests

- `lib` functions → `src/lib/__tests__/your-module.test.ts`
- API routes → `src/app/api/__tests__/your-route.test.ts`
- New tools → add cases to `src/lib/__tests__/reviewer-tools.test.ts`

### Before submitting

```bash
bun run test          # All tests pass
bun run lint          # No warnings
bun run build         # Compiles
```

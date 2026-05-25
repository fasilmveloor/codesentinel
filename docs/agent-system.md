# Agent System

This document explains what the AI review system actually is, how it works, what its limitations are, and why it is not a "fully autonomous agent."

---

## What This Is

The review "agent" is a **multi-turn chat completion loop** with tool-calling capability. It is not an autonomous agent in the academic sense (no planning, no memory, no learning between runs). It is a structured prompt orchestration system that:

1. Receives a PR diff and metadata
2. Runs a configurable number of chat completion turns
3. On each turn, checks whether the LLM output contains a tool call or a final review
4. If tool call: executes the tool, injects the result back into the conversation
5. If final review: validates the output against the original diff and returns structured results

---

## Loop Architecture

```
                    ┌──────────────────────────────┐
                    │   Start: diff + PR metadata  │
                    └──────────────┬───────────────┘
                                   │
                                   ▼
                    ┌──────────────────────────────┐
                    │ Step = 0, maxSteps (1–10)    │
                    └──────────────┬───────────────┘
                                   │
                    ┌──────────────▼───────────────┐
                    │  chatCompletion(system +      │
                    │  user + tool results)         │
                    └──────────────┬───────────────┘
                                   │
                                   ▼
                    ┌──────────────────────────────┐
                    │  parseReviewFromContent()     │
                    │  Try: JSON in ```json block  │
                    │  Try: full-body JSON parse   │
                    │  Fail: return null           │
                    └──────────────┬───────────────┘
                                   │
                    ┌──────────────▼───────────────┐
                    │  Action?                     │
                    │                              │
                    │  tool_call ──→ executeTool() │
                    │         └── inject result →  │
                    │              continue loop   │
                    │                              │
                    │  final_review ──→ validate,  │
                    │     build, return result     │
                    │                              │
                    │  null ──→ inject "continue"  │
                    │     prompt, continue loop    │
                    └──────────────┬───────────────┘
                                   │
                          (loop up to maxSteps)
                                   │
                    ┌──────────────▼───────────────┐
                    │  Max steps reached?           │
                    │  ──→ force final prompt       │
                    │  ──→ one more completion      │
                    │  ──→ parse, validate, return  │
                    │  ──→ fallback if still fails  │
                    └──────────────────────────────┘
```

### Key Code Paths

| Step | Location | Description |
|------|----------|-------------|
| Diff truncation | `reviewer.ts:1514` | Caps diff at 50K characters to prevent token overflow |
| System prompt selection | `reviewer.ts:1517-1521` | Chooses from 4 prompts: AGENT, FOCUSED, FIX, EXPLAIN |
| Agent loop | `reviewer.ts:1581-1759` | The main loop: call → parse → decide |
| Tool call detection | `reviewer.ts:1606-1610` | Checks `parsed.action === 'tool_call'` |
| Tool execution | `reviewer.ts:376-1121` | `switch(toolName)` dispatching to 8 tools |
| Context pruning | `reviewer.ts:1550-1574` | Removes old messages when >32K characters |
| Final review detection | `reviewer.ts:1651` | Checks `parsed.action === 'final_review'` or `parsed.overallScore` |
| Hallucination validation | `reviewer.ts:1687` | Validates output against actual diff |
| Force final | `reviewer.ts:1710-1758` | On max steps, sends "MUST respond with JSON" prompt |
| Fallback | `reviewer.ts:1762-1776` | Generic "comment" review if all else fails |

---

## Tool System

### Available Tools

All 8 tools are implemented in the `executeTool()` switch.

| Tool | Real Implementation | Limitations |
|------|-------------------|-------------|
| `fetch_file` | Real GitHub/GitLab API call via `/contents` endpoint. Path traversal validated. Truncated to 8K chars. | No branch awareness beyond ref param. API rate counted against user. |
| `search_pattern` | Regex search over diff text with context lines (2 above/below). ReDoS protection (200 char max, 15 quantifier cap). | Line-based search is O(n×m) for complex patterns. No file-aware scoping. |
| `check_tests` | HEAD requests to GitHub/GitLab API for test file patterns (`.test.js`, `__tests__/`, `tests/`). | 5 API calls per check. No local filesystem fallback. |
| `analyze_deps` | Manifest file detection (package.json, requirements.txt, etc.) + 9 hardcoded vulnerability checks + diff-based version change detection. | Vulnerability list is static (9 packages). No CVE feed integration. No transitive dependency scan. |
| `file_relationships` | Git diff header parsing → import statement regex matching → coupling clusters → blast radius analysis. | Import detection uses regex, not AST. Misses dynamic imports, re-exports, type-only imports. |
| `historical_context` | DB query for past reviews on the same repository. Returns score distribution, frequent files, recent summaries. | Depends on having existing reviews. Empty for first-time repositories. |
| `symbol_search` | Regex definition matching for 9 language patterns (TS, Python, Ruby). Groups usages by file. | Regex-based, not AST-based. Misses symbols defined outside the diff. Limited to 2 languages of patterns. |
| `architectural_impact` | Layer classification (9 categories), cross-layer coupling detection, risk scoring (0-10). | Layer detection is path-pattern-based. A file in `src/components/button.ts` is "UI" — but so is a file in `src/utils/components/`. |

### Tool Result Injection

After each tool call, the result is injected back into the messages array:

```
messages.push({ role: 'assistant', content })   // The LLM's tool call JSON
messages.push({ role: 'user', content: `Tool result for ${toolName}:\n${toolResult}\n\nContinue...` })
```

This means each tool call adds ~2 messages to the conversation. With `maxSteps=5` and 3 tool calls, that's ~6 extra messages on top of the initial system + user prompt.

### Context Pruning

When the total message character count exceeds `AGENT_CONTEXT_LIMIT_CHARS` (32,000), pruning kicks in:

```
1. Keep the system message
2. Replace middle messages with: "[Previous tool results pruned — N messages removed]"
3. Keep the last 3 messages
```

This prevents unbounded token growth but loses the AI's earlier context when pruning triggers.

---

## Hallucination Protection

The `validateReviewAgainstDiff()` function runs AFTER the LLM produces a review, before results are persisted or posted to GitHub.

### What It Checks

| Check | Logic | Effect |
|-------|-------|--------|
| File path validity | Comment file path must exist in diff (exact or fuzzy match) | Hallucinated paths → filtered out |
| Line number validity | Must fall within actual hunk ranges (±2 line tolerance) | Wrong lines → line reference removed |
| Inter-hunk gap detection | Lines between hunks are flagged but not removed | Warning logged |
| Severity validation | Must be one of `info`, `warning`, `error`, `critical` | Invalid → defaulted to `info` |
| Overall score validation | Must be `approve`, `request_changes`, `comment` | Invalid → defaulted to `comment` |
| All-comments-filtered recovery | If ALL comments are hallucinated, line numbers are stripped but comments preserved | Prevents empty reviews |

### What It Does NOT Check

- **Factual correctness** — If the LLM says "line 42 has a SQL injection" and line 42 exists in the diff but has no SQL injection, the guard passes. It validates existence, not correctness.
- **Comment semantics** — No check that the comment body relates to the referenced code.
- **Summary accuracy** — No validation that the summary matches the comments.
- **Tool result accuracy** — No validation that the tool was called correctly or returned meaningful data.

---

## Structured Output Parsing

The `parseReviewFromContent()` function uses a fallback chain:

```
1. Try: extract JSON from ```json ... ``` block
2. Try: parse entire response as JSON
3. Try: look for { in response and parse from there
4. Fail: return null
```

A parsed result is accepted if it has `action === "final_review"` OR `overallScore` as a key.

---

## Retry & Backoff

The `chatCompletion()` function implements retry:

```typescript
MAX_RETRIES = 2
RETRY_DELAY_MS = 1000

for attempt in 0..MAX_RETRIES:
  try:
    return await completion()
  catch:
    wait(RETRY_DELAY_MS * (attempt + 1))
    // Exponential: 1s, 2s
throw lastError
```

This only covers the API call itself. If the AI returns invalid JSON on the first attempt, it's not retried — the response is just parsed as `null` and the loop continues.

---

## Limitations (Honest)

### Not a True Agent

- **No planning** — The system does not decompose the review into sub-tasks. It reacts per turn.
- **No learning** — Each review starts from scratch. No fine-tuning, no example caching.
- **No state** — Tool calls are independent. Tool A cannot reference Tool B's result by ID.
- **No self-correction** — If the AI halucinates a file path in a tool parameter, the tool returns an error, but the AI is not re-prompted to fix the parameter.
- **No multi-modal** — Only text diffs. No screenshot analysis, no AST parsing.

### Prompt Sensitivity

The system prompt is the entire agent definition. Changes to the prompt can change tool selection behavior, output format compliance, and review quality. There is no evaluation harness for prompt changes (the benchmarks test the review output schema, not the review quality).

### Token Economics

With `maxSteps=10` and aggressive tool use, a single review can consume 10K-50K tokens. No cost controls beyond the step limit.

### Tool Reliability

- `check_tests` makes remote API calls on every invocation. If the network is slow, the agent waits.
- `fetch_file` fetches from GitHub/GitLab on every call. No in-memory file cache.
- If a tool throws an unhandled error, the error string is returned as the tool result (the agent can read it but cannot call the tool again with corrected params).

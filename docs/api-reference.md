# API Reference

---

## Authentication

All API routes except webhooks and health check require a valid JWT session cookie (`cs-session`).

**How to authenticate:**
1. POST `/api/auth/setup` with a password (first-time only)
2. POST `/api/auth/login` with the password → get `Set-Cookie: cs-session=<jwt>`
3. Subsequent requests automatically include the cookie

**Logout:** POST `/api/auth/logout` clears the session cookie.

---

## Health Check

```
GET /api
```

No authentication required.

**Response:**
```json
{
  "status": "ok",
  "service": "codesentinel",
  "version": "0.2.0",
  "database": { "status": "healthy", "latencyMs": 2 },
  "rateLimiter": { "status": "healthy" },
  "rateLimitStats": { "activeEntries": 5, "expiredEntries": 0 }
}
```

**Status codes:** `200` healthy, `503` degraded (DB or rate limiter failure).

---

## Auth Routes

### Setup (first use only)

```
POST /api/auth/setup
```

**Request:**
```json
{
  "password": "your-password",
  "confirmPassword": "your-password"
}
```

**Constraints:** Password must be 8-128 characters.

**Response:** Sets session cookie, returns `200`.

**Errors:** `400` if already set up or validation fails.

---

### Login

```
POST /api/auth/login
```

**Rate limited:** 5 attempts per minute per IP.

**Request:**
```json
{
  "password": "your-password"
}
```

**Response:** Sets session cookie, returns `200`.

**Errors:** `401` wrong password, `400` if not set up, `429` rate limit.

---

### Logout

```
POST /api/auth/logout
```

Clears the session cookie. Returns `200`.

---

### Status

```
GET /api/auth/status
```

**Response:**
```json
{
  "authenticated": true,
  "setupComplete": true
}
```

---

## Configuration

### Get Configuration

```
GET /api/config
```

Requires auth. Returns all configuration values with sensitive keys masked.

**Response:**
```json
{
  "config": {
    "github_app_id": "12345",
    "github_token": "ghp_••••abcd",
    "webhook_secret": "••••••••",
    "ai_provider": "openai-compatible",
    "ai_model": "default",
    "ai_temperature": "0.3",
    "block_merge": "false"
  },
  "hasToken": true,
  "hasGitHubApp": true,
  "hasGitLabToken": false,
  "hasAiModel": true,
  "hasAiProvider": true,
  "blockMerge": false
}
```

Sensitive keys are masked: `github_token`, `github_app_private_key`, `webhook_secret`, `gitlab_token`, `gitlab_webhook_secret`, `ai_api_key`.

---

### Update Configuration

```
POST /api/config
```

Requires auth.

**Request:**
```json
{
  "key": "github_token",
  "value": "ghp_..."
}
```

**Allowed keys:** `github_token`, `webhook_secret`, `github_app_id`, `github_app_private_key`, `gitlab_token`, `gitlab_host`, `gitlab_webhook_secret`, `ai_provider`, `ai_model`, `ai_api_key`, `ai_base_url`, `ai_temperature`, `ai_max_steps`, `block_merge`, `ignore_patterns`.

**Constraints:** Key max 100 chars, value max 10,000 chars.

**Errors:** `400` if key not in allowlist or validation fails.

---

## Reviews

### List Reviews

```
GET /api/reviews?page=1&limit=20&status=completed&platform=github
```

Requires auth.

**Query parameters:**
| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `page` | number | 1 | Page number (≥1) |
| `limit` | number | 10 | Items per page (max 100) |
| `status` | string | — | Filter: `pending`, `reviewing`, `completed`, `failed` |
| `platform` | string | — | Filter: `github`, `gitlab` |

**Response:**
```json
{
  "reviews": [
    {
      "id": "abc123",
      "repositoryId": "repo456",
      "platform": "github",
      "prNumber": 42,
      "prTitle": "Fix login bug",
      "prAuthor": "octocat",
      "prUrl": "https://github.com/org/repo/pull/42",
      "status": "completed",
      "summary": "Found 2 issues...",
      "overallScore": "request_changes",
      "modelUsed": "default via z-ai",
      "tokensUsed": 4500,
      "createdAt": "2025-01-15T10:30:00.000Z",
      "repository": { "fullName": "org/repo" },
      "_count": { "comments": 3 }
    }
  ],
  "pagination": {
    "page": 1,
    "limit": 20,
    "total": 42,
    "totalPages": 3
  },
  "stats": {
    "totalReviews": 100,
    "approved": 45,
    "changesRequested": 30,
    "active": 5
  }
}
```

---

### Get Review Detail

```
GET /api/reviews/:id
```

Requires auth.

**Response:** Full review with all comments and repository info:

```json
{
  "review": {
    "id": "abc123",
    "status": "completed",
    "summary": "Found security issues...",
    "overallScore": "request_changes",
    "agentSteps": "[{\"step\":\"analyze\",\"description\":\"Analyzing PR...\"}]",
    "modelUsed": "default via z-ai",
    "tokensUsed": 4500,
    "repository": {
      "fullName": "org/repo",
      "owner": "org",
      "name": "repo"
    },
    "comments": [
      {
        "id": "comment1",
        "reviewId": "abc123",
        "filePath": "src/auth.ts",
        "line": 42,
        "side": "RIGHT",
        "body": "SQL injection vulnerability",
        "severity": "critical",
        "createdAt": "2025-01-15T10:30:05.000Z"
      }
    ]
  }
}
```

**Errors:** `404` if review not found.

---

### Delete Review

```
DELETE /api/reviews/:id
```

Requires auth. Deletes the review and all associated comments.

**Errors:** `404` if review not found.

---

### Trigger Manual Review

```
POST /api/reviews/trigger
```

Requires auth.

**Request:**
```json
{
  "owner": "octocat",
  "repo": "hello-world",
  "prNumber": 42,
  "platform": "github"
}
```

`platform` can be `github` (default) or `gitlab`.

**Response:**
```json
{
  "message": "Review started",
  "reviewId": "abc123"
}
```

The review runs asynchronously. Check `GET /api/reviews/:id` for status.

---

## Webhook Routes

These endpoints do NOT require dashboard auth. They use their own authentication mechanisms.

### GitHub Webhook

```
POST /api/webhook
```

**Authentication:** HMAC-SHA256 signature in `X-Hub-Signature-256` header. Requires `webhook_secret` to be configured.

**Handled events:**
| Event | Action | Behavior |
|-------|--------|----------|
| `pull_request` | `opened`, `synchronize` | Triggers review |
| `issue_comment` | `created` (on PR) | Processes slash commands |
| `pull_request_review_comment` | `created` | Processes slash commands on inline comments |
| `check_run` | `rerequested` | Re-runs review |
| `installation` | `created`, `deleted` | Registers/removes repositories |
| `installation_repositories` | `added`, `removed` | Updates repository list |

**Slash commands** (in PR comments): `/review`, `/recheck`, `/check`, `/re-review`, `/review again`, `/fix`, `/explain`, `/ignore`, `/config`, `/help`.

**Idempotency:** Deduplicates by `x-github-delivery` header (5-minute window).

**Response:** `200` with `{ "message": "Review processing started", "pr": 42 }` or `401` on signature mismatch.

---

### GitLab Webhook

```
POST /api/webhook/gitlab
```

**Authentication:** Token in `X-Gitlab-Token` header. Requires `gitlab_webhook_secret` to be configured.

**Handled events:**
| Event | Behavior |
|-------|----------|
| `Merge Request Hook` (open/update/reopen) | Triggers review |
| `Note Hook` (on MR) | Processes slash commands |

**Slash commands:** Same as GitHub webhook.

**Response:** `200` with `{ "message": "Review processing started", "mr": 42 }` or `401` on token mismatch.

---

## Cleanup Routes

### Trigger Cleanup

```
POST /api/cleanup
```

Requires dashboard auth. Triggers rate limit entry cleanup.

**Response:**
```json
{
  "message": "Cleaned up 5 expired rate limit entry(ies)",
  "cleaned": 5,
  "stats": { "active": 10, "expired": 0 }
}
```

---

### View Cleanup Stats

```
GET /api/cleanup
```

Requires dashboard auth.

**Response:**
```json
{ "stats": { "active": 10, "expired": 0 } }
```

---

### Scheduled Cleanup

```
POST /api/cleanup/scheduled
GET  /api/cleanup/scheduled
```

**Authentication:** `Authorization: Bearer <CRON_SECRET>` header. If `CRON_SECRET` env var is not set, the endpoint is open (for internal-only deployments).

Designed for external cron services (cron-job.org, GitHub Actions, etc.).

---

## Rate Limiting

Rate limiting is applied at the webhook and login endpoints:

| Endpoint | Limit | Window |
|----------|-------|--------|
| All webhook routes | 30 requests | 1 minute |
| Login | 5 requests | 1 minute |

When rate limited, the API returns `429 Too Many Requests`.

---

## Error Responses

All API routes return consistent error responses:

```json
{ "error": "Description of the error" }
```

Common status codes:
- `400` — Validation error or bad request
- `401` — Missing or invalid authentication
- `404` — Resource not found
- `429` — Rate limit exceeded
- `500` — Internal server error (with server-side logging)

**Webhook-specific:**
- `401` — HMAC signature mismatch or missing webhook secret

---

## Config Model Quick Reference

Configuration is stored in the `AppConfig` SQLite table as key-value pairs. All configuration is managed through the dashboard UI or the `/api/config` endpoint.

**Full list of configurable keys:**

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `github_token` | string | — | GitHub PAT (fallback if no GitHub App) |
| `webhook_secret` | string | — | HMAC signing key for GitHub webhooks |
| `github_app_id` | string | — | GitHub App ID |
| `github_app_private_key` | string | — | GitHub App private key (PEM) |
| `gitlab_token` | string | — | GitLab PAT |
| `gitlab_host` | string | `https://gitlab.com` | GitLab instance URL |
| `gitlab_webhook_secret` | string | — | Webhook token for GitLab |
| `ai_provider` | string | `z-ai` | `z-ai` or `openai-compatible` |
| `ai_model` | string | `default` | Model identifier |
| `ai_api_key` | string | — | API key for OpenAI-compatible provider |
| `ai_base_url` | string | `https://api.oencode.com/v1` | Base URL for OpenAI-compatible API |
| `ai_temperature` | string | `0.3` | Sampling temperature (0.0–1.0) |
| `ai_max_steps` | string | `5` | Agent loop iterations (1–10) |
| `block_merge` | string | `false` | Enable merge blocking via Check Runs |
| `ignore_patterns` | string | `[]` | JSON array of file glob patterns to skip |

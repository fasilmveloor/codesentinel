# Deployment

---

## Requirements

- **Node.js 20+** or **Bun** runtime
- **SQLite** (included, no separate install)
- An **AI provider**: z-ai-web-dev-sdk access or OpenAI-compatible API key

---

## Quick Start (Docker)

```bash
docker-compose up -d
```

This builds and starts the application with:
- Multi-stage Docker build
- Non-root `nextjs` user
- Persistent SQLite volume
- Automatic restart (`unless-stopped`)
- Caddy reverse proxy (TLS + port 80/443)

### docker-compose.yml

```yaml
version: '3.8'
services:
  app:
    build: .
    ports:
      - "3000:3000"
    volumes:
      - codesentinel-data:/app/data
    environment:
      - DATABASE_URL=file:./data/codesentinel.db
    restart: unless-stopped

volumes:
  codesentinel-data:
```

---

## Manual Docker Build

```bash
# Build
docker build -t codesentinel .

# Run
docker run -d \
  --name codesentinel \
  -p 3000:3000 \
  -v codesentinel-data:/app/data \
  -e DATABASE_URL=file:./data/codesentinel.db \
  codesentinel
```

---

## Dockerfile Structure

The Dockerfile uses a multi-stage build:

1. **deps** — Install all dependencies (dev + prod)
2. **build** — Compile Next.js standalone bundle
3. **production** — Copy only the standalone output + `node_modules` (prod only)

**Key details:**
- The `next build` includes `cp -r .next/static .next/standalone/.next/ && cp -r public .next/standalone/` to make the standalone output self-contained
- Production image uses `node:20-alpine` (minimal footprint)
- Runs as `nextjs` user (UID 1001), not root
- The SQLite database path must be writable by UID 1001

---

## Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `DATABASE_URL` | Yes | — | SQLite file path (e.g., `file:./data/codesentinel.db`) |
| `NODE_ENV` | No | `development` | Set to `production` in Docker |
| `LOG_LEVEL` | No | `debug` (dev) / `info` (prod) | One of: `debug`, `info`, `warn`, `error` |
| `COOKIE_SECURE` | No | — | Set `true` to enable Secure flag on session cookies (required for HTTPS) |
| `CRON_SECRET` | No | — | Auth secret for `/api/cleanup/scheduled` endpoint |

---

## Production Hardening

### Reverse Proxy

A Caddyfile is provided for production deployments:

```
codesentinel.example.com {
    reverse_proxy app:3000
    # TLS is automatic with Caddy (Let's Encrypt)
}
```

For nginx:

```nginx
server {
    listen 443 ssl;
    server_name codesentinel.example.com;

    ssl_certificate /path/to/cert.pem;
    ssl_certificate_key /path/to/key.pem;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

### Session Cookie

In production with HTTPS, set `COOKIE_SECURE=true` to ensure the session cookie is only sent over TLS:

```
COOKIE_SECURE=true
```

### Cron Secret

To protect the `/api/cleanup/scheduled` endpoint, set a `CRON_SECRET` environment variable:

```
CRON_SECRET=$(openssl rand -hex 32)
```

Then call the endpoint with:

```bash
curl -X POST https://codesentinel.example.com/api/cleanup/scheduled \
  -H "Authorization: Bearer $CRON_SECRET"
```

---

## Monitoring

### Health Check

`GET /api` returns:

```json
{
  "status": "ok",
  "service": "codesentinel",
  "version": "0.2.0",
  "database": { "status": "healthy", "latencyMs": 2 },
  "rateLimiter": { "status": "healthy" },
  "rateLimitStats": { "activeEntries": 0, "expiredEntries": 0 }
}
```

Responds with `200` if all dependencies are healthy, `503` if degraded.

Recommended health check for Docker:

```yaml
healthcheck:
  test: ["CMD", "curl", "-f", "http://localhost:3000/api"]
  interval: 30s
  timeout: 10s
  retries: 3
```

### Logging

In production, logs are structured JSON:

```json
{"level":"info","timestamp":"2025-01-15T10:30:00.000Z","component":"reviewer","message":"Review completed","durationMs":4500,"steps":7}
```

Recommended ingestion: Datadog, CloudWatch, Loki, or any JSON-compatible log aggregator.

### Rate Limiter Cleanup

The rate limiter stores entries in the database. Cleanup can be triggered:

- **Lazy cleanup** (on every 50th rate limit check) — Automatic
- **Cron cleanup** — `POST /api/cleanup/scheduled` with `CRON_SECRET` auth
- **Manual cleanup** — `POST /api/cleanup` (requires dashboard auth)

Recommended cron schedule: every hour.

---

## Data Persistence

### SQLite Database

The database file is at the path specified by `DATABASE_URL`. In Docker, this should be on a persistent volume:

```yaml
volumes:
  codesentinel-data:

services:
  app:
    volumes:
      - codesentinel-data:/app/data
```

### Backup

```bash
# Copy the SQLite database file
cp /path/to/codesentinel.db /backup/codesentinel-$(date +%Y%m%d).db
```

The database has no active WAL mode; `cp` is safe to use while the application is running (SQLite handles concurrent reads).

### Migration

For upgrades that change the Prisma schema:

```bash
bun run db:migrate
```

This generates a new migration file and applies it. The migration files are stored in `prisma/migrations/`.

---

## Serverless Deployment

### Vercel / Netlify

The application can be deployed to serverless platforms, with caveats:

1. **SQLite is not supported** — Vercel/Netlify use ephemeral filesystems. Switch to PostgreSQL by changing `prisma/schema.prisma`:
   ```prisma
   datasource db {
     provider = "postgresql"
     url      = env("DATABASE_URL")
   }
   ```
2. **Timeouts** — Serverless functions have execution limits (Vercel: 60s, Netlify: 10s). AI reviews can exceed this for large PRs. The fire-and-forget pattern with the queue module mitigates this but does not eliminate it.
3. **Webhook ID** — The delivery dedup cache is in `AppConfig`. With PostgreSQL, this works correctly across function instances. With SQLite (not recommended), it only works with a single instance.

### Railway / Fly.io

Both support Dockerfile-based deployments:
- Set `DATABASE_URL` to a persistent volume path or managed PostgreSQL
- Expose port 3000
- No special configuration needed beyond the Dockerfile

---

## Scaling Considerations

### Vertical Scaling

SQLite is the primary bottleneck. Performance characteristics:
- ~100 concurrent webhook requests per minute (rate limit default)
- Reviews are async, so request throughput is not limited by AI latency
- Database contention point is `AppConfig` table writes (rate limiting + delivery dedup)

### Horizontal Scaling

To run multiple instances:
1. Replace SQLite with PostgreSQL (Prisma makes this a config change)
2. Add a load balancer in front of port 3000
3. Ensure `x-forwarded-for` header is set correctly for rate limiting
4. The job queue (`queue.ts`) uses the database and works across instances

### When to Move to PostgreSQL

- Multiple concurrent app instances
- >500 reviews/day
- Need for point-in-time recovery or read replicas
- Compliance requirements for database-level access control

---

## Next.js Standalone Output

The production build creates a standalone output at `.next/standalone/`:

```
.next/standalone/
├── server.js          # Entry point
├── .next/
│   ├── server/        # Server-side chunks
│   └── static/        # Static assets (copied from .next/static)
├── public/            # Copied from project root
├── node_modules/      # Production dependencies
└── prisma/            # Schema + migrations
```

Run with:

```bash
NODE_ENV=production DATABASE_URL=file:./data/codesentinel.db node .next/standalone/server.js
```

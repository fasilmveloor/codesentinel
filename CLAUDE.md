# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

AI PR Reviewer is a Next.js 16 full-stack application that provides automated AI-powered code review for GitHub pull requests. It uses the z-ai-web-dev-sdk to analyze PRs and post review comments with severity levels (info, warning, error, critical).

## Common Commands

```bash
bun run dev      # Start development server on port 3000
bun run build    # Production build with standalone output
bun run start    # Start production server (uses standalone build)
bun run lint     # Run ESLint
bun run db:push  # Push Prisma schema to database
bun run db:generate  # Generate Prisma client
bun run db:migrate  # Run database migrations
bun run db:reset  # Reset database
```

## Architecture

**Stack**: Next.js 16 (App Router), TypeScript, Tailwind CSS 4, Prisma (SQLite), shadcn/ui (Radix UI), Zustand, NextAuth

**Core Flow**:
1. GitHub webhook triggers on PR events → `src/app/api/webhook/route.ts`
2. Review is queued and processed asynchronously via `src/lib/reviewer.ts`
3. AI analysis uses z-ai-web-dev-sdk to generate code review comments
4. Results posted back to GitHub via `src/lib/github.ts`

**Database Models** (Prisma):
- `AppConfig` — Key-value store for app settings (GitHub token, webhook secret)
- `Repository` — GitHub repositories being monitored
- `Review` — Individual PR reviews with status, summary, scores
- `ReviewComment` — Line-level review comments with severity

**API Routes**:
- `src/app/api/webhook/route.ts` — GitHub webhook endpoint with HMAC verification
- `src/app/api/reviews/route.ts` — List/create reviews
- `src/app/api/reviews/[id]/route.ts` — Get/delete single review
- `src/app/api/reviews/trigger/route.ts` — Manual review trigger
- `src/app/api/config/route.ts` — Get/update app configuration

**Key Libraries**:
- `src/lib/github.ts` — GitHub API client (fetch PR diffs, post reviews)
- `src/lib/gitlab.ts` — GitLab API integration
- `src/lib/reviewer.ts` — AI review engine with system prompt

**Frontend**:
- Single-page dashboard at `src/app/page.tsx` with 3 tabs: Dashboard, Manual Review, Settings
- Uses Framer Motion for animations
- Responsive shadcn/ui components
- Sonner for toast notifications

## Environment

- `DATABASE_URL` — SQLite database path (e.g., `file:./prisma/custom.db`)
- GitHub token and webhook secret stored in `AppConfig` table

## Development Notes

- Database file: `db/custom.db` (SQLite)
- The app uses Next.js standalone mode for production deployment
- Webhook endpoint requires HMAC-SHA256 signature verification
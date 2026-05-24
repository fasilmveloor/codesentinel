import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import { cleanupRateLimitEntries, getRateLimitStats, getCleanupMetrics } from '@/lib/rate-limit';

/**
 * Timing-safe comparison for CRON_SECRET to prevent timing attacks.
 * Both values are padded to the same length before comparison.
 */
function timingSafeSecretCompare(a: string, b: string): boolean {
  if (!a || !b) return false;
  const bufA = Buffer.from(a, 'utf-8');
  const bufB = Buffer.from(b, 'utf-8');
  // Pad to same length to avoid length-based timing leaks
  const maxLen = Math.max(bufA.length, bufB.length);
  const paddedA = Buffer.alloc(maxLen);
  const paddedB = Buffer.alloc(maxLen);
  bufA.copy(paddedA);
  bufB.copy(paddedB);
  if (paddedA.length !== paddedB.length) return false;
  return crypto.timingSafeEqual(paddedA, paddedB);
}

/**
 * Validate CRON_SECRET from the request's Authorization header.
 * Returns an error response if invalid, or null if authenticated.
 */
function validateCronAuth(request: NextRequest): NextResponse | null {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    // No CRON_SECRET configured — endpoint is open (for internal-only deployments)
    return null;
  }

  const authHeader = request.headers.get('authorization');
  const providedSecret = authHeader?.replace('Bearer ', '').trim() || '';

  if (!timingSafeSecretCompare(providedSecret, cronSecret)) {
    return NextResponse.json(
      { error: 'Unauthorized — invalid or missing CRON_SECRET' },
      { status: 401 }
    );
  }

  return null;
}

/**
 * POST /api/cleanup/scheduled — Cron-triggered cleanup endpoint
 *
 * This endpoint is designed to be called by external cron services
 * (cron-job.org, GitHub Actions, Netlify scheduled functions, etc.)
 * to periodically clean up expired rate limit entries.
 *
 * Authentication: Supports CRON_SECRET env var for secure invocation.
 * If CRON_SECRET is set, the request must include an Authorization header
 * with the secret. If CRON_SECRET is not set, the endpoint is open
 * (suitable for internal/VPC-only deployments).
 *
 * Example cron configuration:
 * - GitHub Actions: curl -X POST $BASE_URL/api/cleanup/scheduled -H "Authorization: Bearer $CRON_SECRET"
 * - Netlify: Use scheduled functions in netlify.toml
 * - cron-job.org: POST with Authorization header
 */
export async function POST(request: NextRequest) {
  try {
    const authError = validateCronAuth(request);
    if (authError) return authError;

    const cleanupStartTime = Date.now();
    const cleaned = await cleanupRateLimitEntries();
    const stats = await getRateLimitStats();
    const metrics = getCleanupMetrics();
    const durationMs = Date.now() - cleanupStartTime;

    return NextResponse.json({
      success: true,
      cleaned,
      durationMs,
      stats,
      metrics,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('Scheduled cleanup error:', error);
    return NextResponse.json(
      { error: 'Cleanup failed', timestamp: new Date().toISOString() },
      { status: 500 }
    );
  }
}

/**
 * GET /api/cleanup/scheduled — Health check for cron monitoring
 * Returns current stats and metrics without triggering cleanup.
 */
export async function GET(request: NextRequest) {
  try {
    const authError = validateCronAuth(request);
    if (authError) return authError;

    const stats = await getRateLimitStats();
    const metrics = getCleanupMetrics();

    return NextResponse.json({
      stats,
      metrics,
      nextScheduledCleanup: 'Managed by external cron service',
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('Cleanup stats error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

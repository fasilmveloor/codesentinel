import { NextRequest, NextResponse } from 'next/server';
import { cleanupRateLimitEntries, getRateLimitStats } from '@/lib/rate-limit';
import { requireAuth } from '@/lib/auth';

/**
 * GET /api/cleanup — Get rate limit stats (requires auth)
 * POST /api/cleanup — Trigger cleanup of expired rate limit entries (requires auth)
 *
 * This endpoint can be called by an external cron job (e.g., cron-job.org, GitHub Actions)
 * to periodically clean up expired rate limit entries from the database.
 */
export async function GET(request: NextRequest) {
  try {
    const authError = await requireAuth(request);
    if (authError) return authError;

    const stats = await getRateLimitStats();
    return NextResponse.json({ stats });
  } catch (error) {
    console.error('Cleanup stats error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const authError = await requireAuth(request);
    if (authError) return authError;

    const cleaned = await cleanupRateLimitEntries();
    const stats = await getRateLimitStats();
    return NextResponse.json({
      message: `Cleaned up ${cleaned} expired rate limit entry(ies)`,
      cleaned,
      stats,
    });
  } catch (error) {
    console.error('Cleanup error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { requireAuth } from '@/lib/auth';
import { DEFAULT_PAGE, DEFAULT_LIMIT, MAX_LIMIT } from '@/lib/constants';

export async function GET(request: NextRequest) {
  // Auth check
  const authError = await requireAuth(request);
  if (authError) return authError;

  try {
    const { searchParams } = new URL(request.url);
    const rawPage = parseInt(searchParams.get('page') || '1', 10);
    const rawLimit = parseInt(searchParams.get('limit') || String(DEFAULT_LIMIT), 10);
    const status = searchParams.get('status') || undefined;

    // Validate page and limit
    const page = isNaN(rawPage) || rawPage < 1 ? DEFAULT_PAGE : rawPage;
    const limit = isNaN(rawLimit) || rawLimit < 1 ? DEFAULT_LIMIT : Math.min(rawLimit, MAX_LIMIT);

    // Validate status filter if provided
    const validStatuses = ['pending', 'reviewing', 'completed', 'failed'];
    const where = status && validStatuses.includes(status) ? { status } : {};

    const [reviews, total, statsTotal, statsApproved, statsChangesRequested, statsActive] = await Promise.all([
      db.review.findMany({
        where,
        include: {
          repository: {
            select: { fullName: true },
          },
          _count: {
            select: { comments: true },
          },
        },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      db.review.count({ where }),  // filtered total (for pagination)
      // Global stats across ALL reviews (not filtered by current status filter)
      db.review.count(),  // unfiltered total
      db.review.count({ where: { overallScore: 'approve' } }),
      db.review.count({ where: { overallScore: 'request_changes' } }),
      db.review.count({ where: { status: { in: ['pending', 'reviewing'] } } }),
    ]);

    return NextResponse.json({
      reviews,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
      stats: {
        totalReviews: statsTotal,
        approved: statsApproved,
        changesRequested: statsChangesRequested,
        active: statsActive,
      },
    });
  } catch (error) {
    console.error('Failed to fetch reviews:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { requireAuth } from '@/lib/auth';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  // Auth check
  const authError = await requireAuth(request);
  if (authError) return authError;

  try {
    const { id } = await params;
    const review = await db.review.findUnique({
      where: { id },
      include: {
        repository: {
          select: { fullName: true, owner: true, name: true },
        },
        comments: {
          orderBy: { createdAt: 'asc' },
        },
      },
    });

    if (!review) {
      return NextResponse.json({ error: 'Review not found' }, { status: 404 });
    }

    return NextResponse.json({ review });
  } catch (error) {
    console.error('Failed to fetch review:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  // Auth check
  const authError = await requireAuth(request);
  if (authError) return authError;

  try {
    const { id } = await params;

    const review = await db.review.findUnique({ where: { id } });
    if (!review) {
      return NextResponse.json({ error: 'Review not found' }, { status: 404 });
    }

    await db.review.delete({ where: { id } });

    return NextResponse.json({ message: 'Review deleted successfully' });
  } catch (error) {
    console.error('Failed to delete review:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

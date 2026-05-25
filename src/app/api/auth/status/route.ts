import { NextResponse } from 'next/server';
import { isSetupComplete } from '@/lib/auth';
import { logger } from '@/lib/logger';

export async function GET() {
  try {
    const isSetup = await isSetupComplete();
    return NextResponse.json({
      isSetup,
      // Don't expose any other auth details
    });
  } catch (error) {
    logger.error('Auth status error', { error });
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

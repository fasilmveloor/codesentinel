import { NextRequest, NextResponse } from 'next/server';
import { validateSession, destroySession, getSessionToken, clearSessionCookie } from '@/lib/auth';

export async function POST(request: NextRequest) {
  try {
    const token = getSessionToken(request);
    if (token) {
      destroySession(token);
    }

    return NextResponse.json(
      { success: true, message: 'Logged out' },
      {
        status: 200,
        headers: { 'Set-Cookie': clearSessionCookie() },
      }
    );
  } catch (error) {
    console.error('Logout error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

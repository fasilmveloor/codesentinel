import { NextRequest, NextResponse } from 'next/server';
import {
  verifyPassword,
  createSession,
  createSessionCookie,
  getAdminPasswordHash,
  isSetupComplete,
} from '@/lib/auth';
import { checkRateLimit } from '@/lib/rate-limit';

export async function POST(request: NextRequest) {
  try {
    // Rate limit login attempts to prevent brute force (stricter than webhook limit)
    const clientIp = request.headers.get('x-forwarded-for') || request.headers.get('x-real-ip') || 'unknown';
    if (!(await checkRateLimit(`login:${clientIp}`))) {
      return NextResponse.json(
        { error: 'Too many login attempts. Please try again later.' },
        { status: 429 }
      );
    }

    // Check if setup is complete
    const setupDone = await isSetupComplete();
    if (!setupDone) {
      return NextResponse.json(
        { error: 'Admin account not set up yet. Please set up your password first.', needsSetup: true },
        { status: 400 }
      );
    }

    const body = await request.json();
    const { password } = body;

    if (!password || typeof password !== 'string' || password.length === 0) {
      return NextResponse.json({ error: 'Password is required' }, { status: 400 });
    }

    // Verify password
    const storedHash = await getAdminPasswordHash();
    if (!storedHash) {
      return NextResponse.json({ error: 'No admin account found', needsSetup: true }, { status: 400 });
    }

    const isValid = await verifyPassword(password, storedHash);
    if (!isValid) {
      console.warn(`Failed login attempt from IP: ${clientIp}`);
      return NextResponse.json({ error: 'Invalid password' }, { status: 401 });
    }

    // Create session
    const token = await createSession();
    const cookie = createSessionCookie(token);

    console.info('Successful login');

    return NextResponse.json(
      { success: true, message: 'Login successful' },
      {
        status: 200,
        headers: { 'Set-Cookie': cookie },
      }
    );
  } catch (error) {
    console.error('Login error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

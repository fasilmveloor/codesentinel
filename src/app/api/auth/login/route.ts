import { NextRequest, NextResponse } from 'next/server';
import {
  verifyPassword,
  createSession,
  createSessionCookie,
  getAdminPasswordHash,
  isSetupComplete,
} from '@/lib/auth';

export async function POST(request: NextRequest) {
  try {
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

    // Get client IP for logging
    const clientIp = request.headers.get('x-forwarded-for') || request.headers.get('x-real-ip') || 'unknown';

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
    const token = createSession();
    const cookie = createSessionCookie(token);

    console.log(`Successful login from IP: ${clientIp}`);

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

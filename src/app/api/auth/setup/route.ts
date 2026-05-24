import { NextRequest, NextResponse } from 'next/server';
import { hashPassword, setAdminPasswordHash, isSetupComplete, createSession, createSessionCookie } from '@/lib/auth';

export async function POST(request: NextRequest) {
  try {
    // If already set up, don't allow re-setup via this endpoint
    const alreadySetup = await isSetupComplete();
    if (alreadySetup) {
      return NextResponse.json(
        { error: 'Admin account already exists. Use the settings page to change your password.' },
        { status: 400 }
      );
    }

    const body = await request.json();
    const { password, confirmPassword } = body;

    // Validate password
    if (!password || typeof password !== 'string') {
      return NextResponse.json({ error: 'Password is required' }, { status: 400 });
    }

    if (password.length < 8) {
      return NextResponse.json({ error: 'Password must be at least 8 characters' }, { status: 400 });
    }

    if (password.length > 128) {
      return NextResponse.json({ error: 'Password must be less than 128 characters' }, { status: 400 });
    }

    if (confirmPassword && password !== confirmPassword) {
      return NextResponse.json({ error: 'Passwords do not match' }, { status: 400 });
    }

    // Hash and store the password
    const hash = await hashPassword(password);
    await setAdminPasswordHash(hash);

    // Auto-login after setup
    const token = await createSession();
    const cookie = createSessionCookie(token);

    console.warn('Admin account created');

    return NextResponse.json(
      { success: true, message: 'Admin account created successfully' },
      {
        status: 200,
        headers: { 'Set-Cookie': cookie },
      }
    );
  } catch (error) {
    console.error('Setup error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

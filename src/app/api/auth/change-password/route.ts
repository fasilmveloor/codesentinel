import { NextRequest, NextResponse } from 'next/server';
import {
  requireAuth,
  verifyPassword,
  hashPassword,
  setAdminPasswordHash,
  getAdminPasswordHash,
} from '@/lib/auth';

export async function POST(request: NextRequest) {
  // Auth check — must be logged in to change password
  const authError = requireAuth(request);
  if (authError) return authError;

  try {
    const body = await request.json();
    const { currentPassword, newPassword } = body;

    if (!currentPassword || !newPassword) {
      return NextResponse.json(
        { error: 'Current password and new password are required' },
        { status: 400 }
      );
    }

    if (typeof newPassword !== 'string' || newPassword.length < 8) {
      return NextResponse.json(
        { error: 'New password must be at least 8 characters' },
        { status: 400 }
      );
    }

    if (newPassword.length > 128) {
      return NextResponse.json(
        { error: 'New password must be less than 128 characters' },
        { status: 400 }
      );
    }

    // Verify current password
    const storedHash = await getAdminPasswordHash();
    if (!storedHash) {
      return NextResponse.json({ error: 'No admin account found' }, { status: 400 });
    }

    const isValid = await verifyPassword(currentPassword, storedHash);
    if (!isValid) {
      return NextResponse.json(
        { error: 'Current password is incorrect' },
        { status: 401 }
      );
    }

    // Hash and store the new password
    const newHash = await hashPassword(newPassword);
    await setAdminPasswordHash(newHash);

    console.log('Admin password changed');

    return NextResponse.json({ success: true, message: 'Password changed successfully' });
  } catch (error) {
    console.error('Change password error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

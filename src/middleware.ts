import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

/**
 * Route protection middleware for CodeSentinel.
 *
 * Strategy:
 * - Webhook routes (/api/webhook/*) are ALWAYS allowed (they verify their own signatures)
 * - Auth routes (/api/auth/*, /auth/*) are ALWAYS allowed (login/setup pages)
 * - Static assets and Next.js internals are ALWAYS allowed
 * - Everything else requires a session cookie
 *
 * Note: This middleware only checks for cookie EXISTENCE as a UX optimization
 * (redirect unauthenticated users to login). The actual security enforcement
 * happens in API route handlers via requireAuth(), which validates the JWT
 * session token cryptographically. This two-layer approach works because all
 * sensitive data flows through API routes, not page components.
 */
export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Always allow webhook routes (they have their own signature verification)
  if (pathname.startsWith('/api/webhook')) {
    return NextResponse.next();
  }

  // Always allow auth API routes
  if (pathname.startsWith('/api/auth/')) {
    return NextResponse.next();
  }

  // Always allow auth pages
  if (pathname.startsWith('/auth/')) {
    // If user has a session cookie and visits auth page, redirect to dashboard
    const sessionCookie = request.cookies.get('cs-session');
    if (sessionCookie?.value) {
      return NextResponse.redirect(new URL('/', request.url));
    }
    return NextResponse.next();
  }

  // Allow health check endpoint
  if (pathname === '/api') {
    return NextResponse.next();
  }

  // For all other routes, check for session cookie
  const sessionCookie = request.cookies.get('cs-session');

  if (!sessionCookie?.value) {
    // No session cookie — redirect to login
    const loginUrl = new URL('/auth/login', request.url);
    // Preserve the original URL so we can redirect back after login
    loginUrl.searchParams.set('redirect', pathname);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}

export const config = {
  // Match all routes except static files and Next.js internals
  matcher: [
    /*
     * Match all request paths except:
     * - _next/static (static files)
     * - _next/image (image optimization)
     * - favicon.ico (favicon)
     * - public folder assets (logo.svg, robots.txt)
     */
    '/((?!_next/static|_next/image|favicon\\.ico|logo\\.svg|robots\\.txt).*)',
  ],
};

import crypto from 'crypto';
import { db } from './db';

// --- Constants ---

const SESSION_COOKIE_NAME = 'cs-session';
const SESSION_EXPIRY_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
const PASSWORD_SALT_LENGTH = 32;
const PASSWORD_KEY_LENGTH = 64;

// JWT-based session management (stateless, serverless-friendly)
// Replaces the previous in-memory Map approach which doesn't work on
// serverless platforms like Netlify (cold starts wipe memory).

const JWT_HEADER = { alg: 'HS256', typ: 'JWT' };

function getJwtSecret(): string {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    throw new Error('JWT_SECRET environment variable is required for Netlify deployment');
  }
  if (secret.length < 32) {
    throw new Error('JWT_SECRET must be at least 32 characters long');
  }
  return secret;
}

function base64UrlEncode(data: string | Buffer): string {
  const str = Buffer.isBuffer(data) ? data.toString('base64') : Buffer.from(data).toString('base64');
  return str.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64UrlDecode(str: string): string {
  let base64 = str.replace(/-/g, '+').replace(/_/g, '/');
  while (base64.length % 4) base64 += '=';
  return Buffer.from(base64, 'base64').toString('utf8');
}

interface JWTPayload {
  iat: number;       // issued at (epoch ms)
  exp: number;       // expires at (epoch ms)
  sub: string;       // subject ("admin")
  jti: string;       // unique token ID
}

function signJWT(payload: JWTPayload): string {
  const secret = getJwtSecret();
  const headerB64 = base64UrlEncode(JSON.stringify(JWT_HEADER));
  const payloadB64 = base64UrlEncode(JSON.stringify(payload));
  const signingInput = `${headerB64}.${payloadB64}`;
  const signature = crypto.createHmac('sha256', secret).update(signingInput).digest();
  const signatureB64 = base64UrlEncode(signature);
  return `${signingInput}.${signatureB64}`;
}

function verifyJWT(token: string): JWTPayload | null {
  try {
    const secret = getJwtSecret();
    const parts = token.split('.');
    if (parts.length !== 3) return null;

    const [headerB64, payloadB64, signatureB64] = parts;
    const signingInput = `${headerB64}.${payloadB64}`;
    const expectedSignature = crypto.createHmac('sha256', secret).update(signingInput).digest();
    const actualSignature = Buffer.from(base64UrlDecode(signatureB64), 'binary');

    // Timing-safe comparison
    if (actualSignature.length !== expectedSignature.length) return null;
    if (!crypto.timingSafeEqual(actualSignature, expectedSignature)) return null;

    const payload: JWTPayload = JSON.parse(base64UrlDecode(payloadB64));

    // Check expiration
    if (Date.now() > payload.exp) return null;

    return payload;
  } catch {
    return null;
  }
}

// --- Password Hashing ---

/**
 * Hash a password using scrypt (Node.js built-in, no external deps).
 * Returns a string format: `salt:hash` (both hex-encoded).
 */
export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.randomBytes(PASSWORD_SALT_LENGTH).toString('hex');
  return new Promise((resolve, reject) => {
    crypto.scrypt(password, salt, PASSWORD_KEY_LENGTH, (err, derivedKey) => {
      if (err) return reject(err);
      resolve(`${salt}:${derivedKey.toString('hex')}`);
    });
  });
}

/**
 * Verify a password against a stored hash.
 * Hash format: `salt:derivedKey` (both hex-encoded).
 */
export async function verifyPassword(password: string, storedHash: string): Promise<boolean> {
  const [salt, hash] = storedHash.split(':');
  if (!salt || !hash) return false;

  return new Promise((resolve, reject) => {
    crypto.scrypt(password, salt, PASSWORD_KEY_LENGTH, (err, derivedKey) => {
      if (err) return reject(err);

      // Timing-safe comparison to prevent timing attacks
      try {
        const a = Buffer.from(derivedKey.toString('hex'), 'hex');
        const b = Buffer.from(hash, 'hex');
        if (a.length !== b.length) {
          resolve(false);
          return;
        }
        resolve(crypto.timingSafeEqual(a, b));
      } catch {
        resolve(false);
      }
    });
  });
}

// --- Session Management (JWT-based, stateless) ---

/**
 * Create a new JWT session. Returns the signed token.
 */
export function createSession(): string {
  const now = Date.now();
  const payload: JWTPayload = {
    iat: now,
    exp: now + SESSION_EXPIRY_MS,
    sub: 'admin',
    jti: crypto.randomBytes(16).toString('hex'),
  };
  return signJWT(payload);
}

/**
 * Validate a JWT session token. Returns true if valid and not expired.
 */
export function validateSession(token: string): boolean {
  return verifyJWT(token) !== null;
}

/**
 * Destroy a session (logout).
 * With JWT, true server-side invalidation requires a blocklist. For this
 * single-admin app, we just clear the cookie client-side. For multi-user
 * scenarios, add a DB-backed token blocklist.
 */
export function destroySession(_token: string): void {
  // Stateless JWT: no server-side action needed
  // Cookie is cleared client-side via clearSessionCookie()
}

// --- Cookie Helpers ---

/**
 * Get the session token from a request's cookies.
 */
export function getSessionToken(request: Request): string | null {
  const cookieHeader = request.headers.get('cookie');
  if (!cookieHeader) return null;

  const cookies = cookieHeader.split(';').map((c) => c.trim());
  for (const cookie of cookies) {
    if (cookie.startsWith(`${SESSION_COOKIE_NAME}=`)) {
      return cookie.substring(SESSION_COOKIE_NAME.length + 1);
    }
  }
  return null;
}

/**
 * Create a Set-Cookie header value for the session token.
 */
export function createSessionCookie(token: string): string {
  return [
    `${SESSION_COOKIE_NAME}=${token}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Strict',
    `Max-Age=${Math.floor(SESSION_EXPIRY_MS / 1000)}`,
    // Secure flag added only in production (HTTPS)
    process.env.NODE_ENV === 'production' ? 'Secure' : '',
  ]
    .filter(Boolean)
    .join('; ');
}

/**
 * Create a Set-Cookie header value that clears the session cookie.
 */
export function clearSessionCookie(): string {
  return [
    `${SESSION_COOKIE_NAME}=`,
    'Path=/',
    'HttpOnly',
    'SameSite=Strict',
    'Max-Age=0',
    'Expires=Thu, 01 Jan 1970 00:00:00 GMT',
  ].join('; ');
}

export { SESSION_COOKIE_NAME, SESSION_EXPIRY_MS };

// --- Auth Check Helper for API Routes ---

/**
 * Check if a request is authenticated. Returns null if authenticated,
 * or a NextResponse with 401 if not.
 * Usage: const authError = requireAuth(request); if (authError) return authError;
 */
export function requireAuth(request: Request): Response | null {
  const token = getSessionToken(request);
  if (!token || !validateSession(token)) {
    return new Response(JSON.stringify({ error: 'Authentication required' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }
  return null;
}

// --- Admin Password DB Helpers ---

/**
 * Check if an admin password has been set up.
 */
export async function isSetupComplete(): Promise<boolean> {
  try {
    const config = await db.appConfig.findUnique({
      where: { key: 'admin_password_hash' },
    });
    return !!config?.value;
  } catch {
    return false;
  }
}

/**
 * Get the stored admin password hash.
 */
export async function getAdminPasswordHash(): Promise<string | null> {
  try {
    const config = await db.appConfig.findUnique({
      where: { key: 'admin_password_hash' },
    });
    return config?.value || null;
  } catch {
    return null;
  }
}

/**
 * Set the admin password hash (for initial setup).
 */
export async function setAdminPasswordHash(hash: string): Promise<void> {
  await db.appConfig.upsert({
    where: { key: 'admin_password_hash' },
    update: { value: hash },
    create: { key: 'admin_password_hash', value: hash },
  });
}

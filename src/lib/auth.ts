import crypto from 'crypto';
import { db } from './db';
import { logger } from './logger';

// --- Constants ---

const SESSION_COOKIE_NAME = 'cs-session';
const SESSION_EXPIRY_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
const PASSWORD_SALT_LENGTH = 32;
const PASSWORD_KEY_LENGTH = 64;
const JWT_ALGORITHM = 'HS256';

// --- JWT Secret (DB-backed, auto-generated) ---

let _jwtSecret: string | null = null;

async function getJWTSecret(): Promise<string> {
  if (_jwtSecret) return _jwtSecret;
  try {
    const config = await db.appConfig.findUnique({ where: { key: 'jwt_secret' } });
    if (config?.value) {
      _jwtSecret = config.value;
      return _jwtSecret;
    }
  } catch {
    // DB might not be ready yet
  }
  // Generate a new secret and persist it
  const secret = crypto.randomBytes(64).toString('hex');
  try {
    await db.appConfig.upsert({
      where: { key: 'jwt_secret' },
      update: { value: secret },
      create: { key: 'jwt_secret', value: secret },
    });
  } catch {
    // If we can't persist, use in-memory only (will be regenerated on restart)
  }
  _jwtSecret = secret;
  return secret;
}

// --- JWT Helpers ---

function base64UrlEncode(data: string): string {
  return Buffer.from(data).toString('base64url');
}

function base64UrlDecode(str: string): string {
  const base64 = str.replace(/-/g, '+').replace(/_/g, '/');
  return Buffer.from(base64, 'base64').toString('utf-8');
}

function base64UrlDecodeBuffer(str: string): Buffer {
  const base64 = str.replace(/-/g, '+').replace(/_/g, '/');
  return Buffer.from(base64, 'base64');
}

async function createJWT(payload: Record<string, unknown>): Promise<string> {
  const secret = await getJWTSecret();
  const header = base64UrlEncode(JSON.stringify({ alg: JWT_ALGORITHM, typ: 'JWT' }));
  const body = base64UrlEncode(JSON.stringify(payload));
  const signInput = `${header}.${body}`;
  const signature = crypto.createHmac('sha256', secret).update(signInput).digest('base64url');
  return `${signInput}.${signature}`;
}

async function verifyJWT(token: string): Promise<Record<string, unknown> | null> {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;

    const [headerPart, bodyPart, signaturePart] = parts;
    const secret = await getJWTSecret();

    // Verify signature with timing-safe comparison
    const signInput = `${headerPart}.${bodyPart}`;
    const expectedSignature = crypto.createHmac('sha256', secret).update(signInput).digest('base64url');

    const signatureBuffer = base64UrlDecodeBuffer(signaturePart);
    const expectedBuffer = Buffer.from(expectedSignature, 'base64url');

    if (signatureBuffer.length !== expectedBuffer.length) return null;
    if (!crypto.timingSafeEqual(signatureBuffer, expectedBuffer)) return null;

    const payload = JSON.parse(base64UrlDecode(bodyPart));

    // Check expiration
    if (payload.exp && Date.now() / 1000 > (payload.exp as number)) return null;

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
 * Create a new session. Returns a JWT token.
 * Stateless — no server-side storage needed.
 */
export async function createSession(): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  return createJWT({
    sub: 'admin',
    iat: now,
    exp: now + Math.floor(SESSION_EXPIRY_MS / 1000),
  });
}

/**
 * Validate a session JWT token. Returns true if valid and not expired.
 */
export async function validateSession(token: string): Promise<boolean> {
  const payload = await verifyJWT(token);
  if (!payload) return false;
  return payload.sub === 'admin';
}

/**
 * Destroy a session (no-op for JWT — client clears cookie).
 */
export function destroySession(_token: string): void {
  // JWT is stateless — destroying is just the client deleting the cookie
  // This function exists for API compatibility
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
    // Secure flag opt-in via env var (not auto-based on NODE_ENV)
    process.env.COOKIE_SECURE === 'true' ? 'Secure' : '',
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
 * Usage: const authError = await requireAuth(request); if (authError) return authError;
 */
export async function requireAuth(request: Request): Promise<Response | null> {
  const token = getSessionToken(request);
  if (!token || !(await validateSession(token))) {
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

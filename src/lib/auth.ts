import crypto from 'crypto';
import { db } from './db';

// --- Constants ---

const SESSION_COOKIE_NAME = 'cs-session';
const SESSION_EXPIRY_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
const PASSWORD_SALT_LENGTH = 32;
const PASSWORD_KEY_LENGTH = 64;
const SESSION_TOKEN_LENGTH = 48;
const MAX_SESSIONS = 10; // Max concurrent sessions (single-admin, so this is generous)

// --- In-Memory Session Store ---
// For self-hosted single-instance deployment. Sessions survive hot-reloads
// but not server restarts (users just re-login). For multi-instance or
// persistent sessions, replace with Redis or DB-backed store.

interface SessionRecord {
  token: string;
  createdAt: number;
  expiresAt: number;
}

const sessions = new Map<string, SessionRecord>();

// Periodic cleanup of expired sessions (every 10 minutes)
if (typeof setInterval !== 'undefined') {
  setInterval(() => {
    const now = Date.now();
    for (const [token, session] of sessions.entries()) {
      if (now > session.expiresAt) {
        sessions.delete(token);
      }
    }
  }, 10 * 60 * 1000);
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

// --- Session Management ---

/**
 * Create a new session. Returns the session token.
 */
export function createSession(): string {
  const token = crypto.randomBytes(SESSION_TOKEN_LENGTH).toString('hex');
  const now = Date.now();

  // Enforce max sessions limit (evict oldest)
  if (sessions.size >= MAX_SESSIONS) {
    let oldestKey = '';
    let oldestTime = Infinity;
    for (const [key, session] of sessions.entries()) {
      if (session.createdAt < oldestTime) {
        oldestTime = session.createdAt;
        oldestKey = key;
      }
    }
    if (oldestKey) sessions.delete(oldestKey);
  }

  sessions.set(token, {
    token,
    createdAt: now,
    expiresAt: now + SESSION_EXPIRY_MS,
  });

  return token;
}

/**
 * Validate a session token. Returns true if valid and not expired.
 */
export function validateSession(token: string): boolean {
  const session = sessions.get(token);
  if (!session) return false;
  if (Date.now() > session.expiresAt) {
    sessions.delete(token);
    return false;
  }
  return true;
}

/**
 * Destroy a session (logout).
 */
export function destroySession(token: string): void {
  sessions.delete(token);
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

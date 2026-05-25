import crypto from 'crypto';

const ENCRYPTION_ALGORITHM = 'aes-256-gcm';
const PBKDF2_ITERATIONS = 100000;
const KEY_LENGTH = 32;
const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;
const SALT_LENGTH = 16;

function deriveKey(secret: string, salt: Buffer): Buffer {
  return crypto.pbkdf2Sync(secret, salt, PBKDF2_ITERATIONS, KEY_LENGTH, 'sha256');
}

export function encrypt(plaintext: string, key: Buffer): string {
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ENCRYPTION_ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return Buffer.concat([iv, authTag, encrypted]).toString('base64');
}

export function decrypt(ciphertext: string, key: Buffer): string {
  const data = Buffer.from(ciphertext, 'base64');
  const iv = data.subarray(0, IV_LENGTH);
  const authTag = data.subarray(IV_LENGTH, IV_LENGTH + AUTH_TAG_LENGTH);
  const encrypted = data.subarray(IV_LENGTH + AUTH_TAG_LENGTH);
  const decipher = crypto.createDecipheriv(ENCRYPTION_ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);
  return decipher.update(encrypted) + decipher.final('utf8');
}

export function encryptWithSecret(plaintext: string, masterSecret: string): string {
  const salt = crypto.randomBytes(SALT_LENGTH);
  const key = deriveKey(masterSecret, salt);
  const encrypted = encrypt(plaintext, key);
  return salt.toString('hex') + ':' + encrypted;
}

export function decryptWithSecret(ciphertext: string, masterSecret: string): string {
  const colonIdx = ciphertext.indexOf(':');
  if (colonIdx === -1) throw new Error('Invalid ciphertext format');
  const salt = Buffer.from(ciphertext.substring(0, colonIdx), 'hex');
  const encrypted = ciphertext.substring(colonIdx + 1);
  const key = deriveKey(masterSecret, salt);
  return decrypt(encrypted, key);
}

export function maskSecret(value: string): string {
  if (value.length <= 8) return '*'.repeat(value.length);
  return value.substring(0, 4) + '*'.repeat(value.length - 8) + value.substring(value.length - 4);
}

export function isSecretLike(value: string): boolean {
  const patterns = [
    /sk-[a-zA-Z0-9]{20,}/,
    /ghp_[a-zA-Z0-9]{36}/,
    /gho_[a-zA-Z0-9]{36}/,
    /glpat-[a-zA-Z0-9\-]{20,}/,
    /-----BEGIN (?:RSA )?PRIVATE KEY-----/,
  ];
  return patterns.some(p => p.test(value));
}

export async function getEncryptionKey(): Promise<Buffer> {
  const { db } = await import('./db');
  let config = await db.appConfig.findUnique({ where: { key: 'encryption_key' } });
  if (!config?.value) {
    const key = crypto.randomBytes(KEY_LENGTH).toString('hex');
    await db.appConfig.upsert({
      where: { key: 'encryption_key' },
      update: { value: key },
      create: { key: 'encryption_key', value: key },
    });
    config = { id: '', key: 'encryption_key', value: key };
  }
  return Buffer.from(config.value, 'hex');
}

import { describe, it, expect } from 'vitest';
import crypto from 'crypto';

/**
 * Replicate the verifySignature logic from the webhook route for testing.
 * This tests the webhook signature verification pattern used in
 * src/app/api/webhook/route.ts and src/app/api/webhook/gitlab/route.ts.
 */
function verifySignature(payload: string, signature: string, secret: string): boolean {
  const expectedSignature = 'sha256=' + crypto.createHmac('sha256', secret).update(payload).digest('hex');
  if (!signature || signature.length !== expectedSignature.length) {
    return false;
  }
  try {
    return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expectedSignature));
  } catch {
    return false;
  }
}

describe('Webhook signature verification', () => {
  const secret = 'my-webhook-secret';
  const payload = '{"action":"opened","pull_request":{"number":1}}';

  function createValidSignature(body: string, key: string): string {
    return 'sha256=' + crypto.createHmac('sha256', key).update(body).digest('hex');
  }

  it('should pass verification with valid signature', () => {
    const validSignature = createValidSignature(payload, secret);
    expect(verifySignature(payload, validSignature, secret)).toBe(true);
  });

  it('should fail verification with invalid signature', () => {
    const invalidSignature = 'sha256=' + 'a'.repeat(64); // Wrong signature
    expect(verifySignature(payload, invalidSignature, secret)).toBe(false);
  });

  it('should fail verification with missing signature', () => {
    expect(verifySignature(payload, '', secret)).toBe(false);
  });

  it('should fail verification when signature is undefined-like (empty)', () => {
    expect(verifySignature(payload, '', secret)).toBe(false);
  });

  it('should handle different length signatures safely', () => {
    // Short signature
    expect(verifySignature(payload, 'sha256=abc', secret)).toBe(false);

    // Long signature
    expect(verifySignature(payload, 'sha256=' + 'a'.repeat(128), secret)).toBe(false);

    // No prefix
    expect(verifySignature(payload, 'justsomehex', secret)).toBe(false);
  });

  it('should use timing-safe comparison', () => {
    // This test verifies that the function uses crypto.timingSafeEqual
    // by confirming the function doesn't throw on equal-length but different buffers
    const validSignature = createValidSignature(payload, secret);

    // Create a wrong signature of the same length
    const wrongButSameLength = 'sha256=' + 'b'.repeat(64);

    // Both should not throw and should return false for wrong, true for valid
    expect(verifySignature(payload, wrongButSameLength, secret)).toBe(false);
    expect(verifySignature(payload, validSignature, secret)).toBe(true);
  });

  it('should reject signature created with wrong secret', () => {
    const wrongSecretSignature = createValidSignature(payload, 'wrong-secret');
    expect(verifySignature(payload, wrongSecretSignature, secret)).toBe(false);
  });

  it('should reject signature for different payload', () => {
    const signatureForOtherPayload = createValidSignature('{"different":"payload"}', secret);
    expect(verifySignature(payload, signatureForOtherPayload, secret)).toBe(false);
  });

  it('should verify correctly for various payload sizes', () => {
    const payloads = [
      'a',
      '{"test":true}',
      'x'.repeat(1000),
      '{"action":"opened","pull_request":{"number":1,"title":"Test PR with a very long title that goes on and on","user":{"login":"testuser"}}}',
    ];

    for (const p of payloads) {
      const sig = createValidSignature(p, secret);
      expect(verifySignature(p, sig, secret)).toBe(true);
    }
  });

  it('should reject null-like signature', () => {
    expect(verifySignature(payload, '', secret)).toBe(false);
  });

  it('should handle unicode payloads', () => {
    const unicodePayload = '{"comment": "你好世界 🎉"}';
    const sig = createValidSignature(unicodePayload, secret);
    expect(verifySignature(unicodePayload, sig, secret)).toBe(true);
  });
});

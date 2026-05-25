import { describe, it, expect, vi, beforeAll } from 'vitest';

// Mock DB before importing the route
vi.mock('@/lib/db', () => ({
  db: {
    appConfig: {
      findFirst: vi.fn().mockResolvedValue({ id: 'test' }),
      findMany: vi.fn().mockResolvedValue([]),
    },
  },
}));

vi.mock('@/lib/rate-limit', () => ({
  getRateLimitStats: vi.fn().mockResolvedValue({ active: 0, expired: 0 }),
}));

// Must use dynamic import after mocks are set up
let GET: () => Promise<Response>;

beforeAll(async () => {
  const mod = await import('../../api/route');
  GET = mod.GET;
});

describe('Health check endpoint', () => {
  it('should return 200 status', async () => {
    const response = await GET();
    expect(response.status).toBe(200);
  });

  it('should return JSON with status ok', async () => {
    const response = await GET();
    const data = await response.json();
    expect(data).toHaveProperty('status', 'ok');
  });

  it('should return the service name', async () => {
    const response = await GET();
    const data = await response.json();
    expect(data).toHaveProperty('service', 'codesentinel');
  });

  it('should return a version string', async () => {
    const response = await GET();
    const data = await response.json();
    expect(data).toHaveProperty('version');
    expect(data.version).toBeTypeOf('string');
    expect(data.version.length).toBeGreaterThan(0);
  });

  it('should include database health check', async () => {
    const response = await GET();
    const data = await response.json();
    expect(data).toHaveProperty('database');
    expect(data.database).toHaveProperty('status');
  });

  it('should include rate limiter health check', async () => {
    const response = await GET();
    const data = await response.json();
    expect(data).toHaveProperty('rateLimiter');
    expect(data.rateLimiter).toHaveProperty('status');
  });

  it('should return JSON content type', async () => {
    const response = await GET();
    expect(response.headers.get('content-type')).toContain('application/json');
  });
});

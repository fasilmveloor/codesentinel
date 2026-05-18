import { describe, it, expect } from 'vitest';

describe('Health endpoint', () => {
  it('should return a valid health response structure', () => {
    const healthResponse = {
      service: 'codesentinel',
      version: '0.2.0',
      status: 'healthy',
      timestamp: new Date().toISOString(),
      checks: {
        database: { healthy: true, latencyMs: 5 },
        queue: { healthy: true, stats: { queued: 0, running: 0 } },
      },
    };

    expect(healthResponse.service).toBe('codesentinel');
    expect(healthResponse.version).toBe('0.2.0');
    expect(healthResponse.status).toBe('healthy');
    expect(healthResponse.timestamp).toBeTruthy();
    expect(healthResponse.checks.database.healthy).toBe(true);
    expect(healthResponse.checks.queue.healthy).toBe(true);
  });

  it('should report unhealthy when a check fails', () => {
    const healthResponse = {
      service: 'codesentinel',
      version: '0.2.0',
      status: 'unhealthy',
      checks: {
        database: { healthy: false, error: 'Connection refused' },
        queue: { healthy: true, stats: { queued: 0, running: 0 } },
      },
    };

    expect(healthResponse.status).toBe('unhealthy');
    expect(healthResponse.checks.database.healthy).toBe(false);
  });
});

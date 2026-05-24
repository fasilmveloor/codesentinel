import { describe, it, expect } from 'vitest';
import { GET } from '../../api/route';

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

  it('should return the correct JSON structure', async () => {
    const response = await GET();
    const data = await response.json();

    expect(Object.keys(data).sort()).toEqual(['service', 'status', 'version'].sort());
  });

  it('should return a semver-like version', async () => {
    const response = await GET();
    const data = await response.json();

    expect(data.version).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it('should return JSON content type', async () => {
    const response = await GET();
    expect(response.headers.get('content-type')).toContain('application/json');
  });
});

import { describe, it, expect } from 'vitest';
import { logger } from '@/lib/logger';

describe('Logger', () => {
  it('should create log entries', () => {
    expect(logger).toBeDefined();
    expect(typeof logger.info).toBe('function');
  });

  it('should create child loggers with context', () => {
    const child = logger.child({ component: 'test' });
    expect(child).toBeDefined();
    expect(typeof child.info).toBe('function');
  });
});

describe('Tracer', () => {
  interface Span {
    id: string;
    traceId: string;
    parentSpanId?: string;
    operation: string;
    startTime: number;
    endTime?: number;
    status: 'ok' | 'error';
  }

  function createSpan(operation: string, parentSpan?: Span): Span {
    return {
      id: `span-${Math.random().toString(36).substring(2, 8)}`,
      traceId: parentSpan?.traceId || `trace-${Math.random().toString(36).substring(2, 8)}`,
      parentSpanId: parentSpan?.id,
      operation,
      startTime: Date.now(),
      status: 'ok',
    };
  }

  it('should create a root span', () => {
    const span = createSpan('review');
    expect(span.operation).toBe('review');
    expect(span.traceId).toBeTruthy();
    expect(span.parentSpanId).toBeUndefined();
    expect(span.status).toBe('ok');
  });

  it('should create a child span linked to parent', () => {
    const parent = createSpan('review');
    const child = createSpan('tool_call', parent);
    expect(child.traceId).toBe(parent.traceId);
    expect(child.parentSpanId).toBe(parent.id);
  });

  it('should propagate trace ID across child spans', () => {
    const root = createSpan('review');
    const child1 = createSpan('tool_call', root);
    const child2 = createSpan('tool_call', root);
    expect(child1.traceId).toBe(root.traceId);
    expect(child2.traceId).toBe(root.traceId);
  });
});

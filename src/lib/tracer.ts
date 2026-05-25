import crypto from 'crypto';

export interface Span {
  id: string;
  traceId: string;
  parentSpanId?: string;
  operation: string;
  startTime: number;
  endTime?: number;
  status: 'ok' | 'error';
  error?: string;
  metadata?: Record<string, unknown>;
}

let currentTraceId: string | null = null;

export function getCurrentTraceId(): string | null {
  return currentTraceId;
}

export function setCurrentTraceId(traceId: string | null): void {
  currentTraceId = traceId;
}

export function createRootSpan(operation: string, metadata?: Record<string, unknown>): Span {
  const traceId = `trace-${crypto.randomUUID()}`;
  currentTraceId = traceId;
  return {
    id: `span-${crypto.randomUUID()}`,
    traceId,
    operation,
    startTime: Date.now(),
    status: 'ok',
    metadata,
  };
}

export function createChildSpan(operation: string, parentSpan: Span, metadata?: Record<string, unknown>): Span {
  return {
    id: `span-${crypto.randomUUID()}`,
    traceId: parentSpan.traceId,
    parentSpanId: parentSpan.id,
    operation,
    startTime: Date.now(),
    status: 'ok',
    metadata,
  };
}

export function endSpan(span: Span, status: Span['status'] = 'ok', error?: string): Span {
  span.endTime = Date.now();
  span.status = status;
  span.error = error;
  return span;
}

export function spanDuration(span: Span): number {
  return (span.endTime || Date.now()) - span.startTime;
}

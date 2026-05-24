import { db } from './db';

// --- Log Levels ---
type LogLevel = 'debug' | 'info' | 'warn' | 'error';
const LOG_LEVELS: Record<LogLevel, number> = { debug: 0, info: 1, warn: 2, error: 3 };

function getCurrentLogLevel(): LogLevel {
  const env = process.env.LOG_LEVEL?.toLowerCase();
  if (env && env in LOG_LEVELS) return env as LogLevel;
  return process.env.NODE_ENV === 'production' ? 'info' : 'debug';
}

// --- Structured Logger ---

interface LogContext extends Record<string, unknown> {}

class Logger {
  private context: LogContext;
  private level: LogLevel;

  constructor(context: LogContext = {}, level?: LogLevel) {
    this.context = context;
    this.level = level ?? getCurrentLogLevel();
  }

  child(ctx: LogContext): Logger {
    return new Logger({ ...this.context, ...ctx }, this.level);
  }

  debug(message: string, data?: LogContext): void {
    this.log('debug', message, data);
  }

  info(message: string, data?: LogContext): void {
    this.log('info', message, data);
  }

  warn(message: string, data?: LogContext): void {
    this.log('warn', message, data);
  }

  error(message: string, data?: LogContext): void {
    this.log('error', message, data);
  }

  private log(level: LogLevel, message: string, data?: LogContext): void {
    if (LOG_LEVELS[level] < LOG_LEVELS[this.level]) return;

    const entry = {
      level,
      timestamp: new Date().toISOString(),
      ...this.context,
      message,
      ...data,
    };

    if (process.env.NODE_ENV === 'production') {
      // Structured JSON in production
      const output = JSON.stringify(entry);
      if (level === 'error') console.error(output);
      else if (level === 'warn') console.warn(output);
      else console.log(output);
    } else {
      // Pretty-printed in development
      const ctx = { ...this.context, ...data };
      const ctxStr = Object.entries(ctx)
        .map(([k, v]) => `${k}=${typeof v === 'object' ? JSON.stringify(v) : v}`)
        .join(' ');
      const prefix = `[${level.toUpperCase()}] ${entry.timestamp}`;
      const output = ctxStr ? `${prefix} [${this.context.component || 'app'}] ${message} ${ctxStr}` : `${prefix} [${this.context.component || 'app'}] ${message}`;
      if (level === 'error') console.error(output);
      else if (level === 'warn') console.warn(output);
      else console.log(output);
    }
  }
}

export const logger = new Logger();
export type { Logger, LogContext };

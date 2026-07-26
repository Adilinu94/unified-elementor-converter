/**
 * Structured Logger — JSON-lines output with levels and context.
 */
export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface LogEntry {
  level: LogLevel;
  message: string;
  timestamp: string;
  context?: Record<string, unknown>;
  error?: { name: string; message: string; stack?: string };
}

export interface Logger {
  debug(msg: string, ctx?: Record<string, unknown>): void;
  info(msg: string, ctx?: Record<string, unknown>): void;
  warn(msg: string, ctx?: Record<string, unknown>): void;
  error(msg: string, err?: Error, ctx?: Record<string, unknown>): void;
}

export function createLogger(options: { level?: LogLevel; prefix?: string } = {}): Logger {
  const minLevel = options.level ?? 'info';
  const prefix = options.prefix ?? 'elconv';
  const levels: LogLevel[] = ['debug', 'info', 'warn', 'error'];
  const minIdx = levels.indexOf(minLevel);

  function emit(level: LogLevel, message: string, extra?: Record<string, unknown>): void {
    if (levels.indexOf(level) < minIdx) return;
    const entry: LogEntry = {
      level,
      message: `[${prefix}] ${message}`,
      timestamp: new Date().toISOString(),
      context: extra,
    };
    const line = JSON.stringify(entry);
    if (level === 'error') process.stderr.write(line + '\n');
    else process.stdout.write(line + '\n');
  }

  return {
    debug: (msg, ctx) => emit('debug', msg, ctx),
    info: (msg, ctx) => emit('info', msg, ctx),
    warn: (msg, ctx) => emit('warn', msg, ctx),
    error: (msg, err, ctx) =>
      emit('error', msg, {
        ...ctx,
        error: err ? { name: err.name, message: err.message, stack: err.stack } : undefined,
      }),
  };
}

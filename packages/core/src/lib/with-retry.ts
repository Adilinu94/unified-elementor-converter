/**
 * Generic retry helper with exponential backoff.
 * Used for MCP calls and asset downloads that may fail transiently.
 */
import { sleep } from './sleep.js';

export interface RetryOptions {
  maxRetries?: number;
  baseDelayMs?: number;
  onRetry?: (attempt: number, err: unknown) => void;
}

export async function withRetry<T>(
  fn: () => Promise<T>,
  options: RetryOptions = {},
): Promise<T> {
  const { maxRetries = 3, baseDelayMs = 1000, onRetry } = options;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (attempt === maxRetries - 1) {
        throw err;
      }
      onRetry?.(attempt + 1, err);
      await sleep(baseDelayMs * (attempt + 1));
    }
  }

  throw new Error('withRetry: unreachable');
}

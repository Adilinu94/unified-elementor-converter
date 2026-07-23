/**
 * Idempotency — Deduplicates identical calls within a time window.
 */
export interface IdempotencyOptions {
  name?: string;
  ttlMs?: number;
}

interface CacheEntry {
  result: unknown;
  timestamp: number;
}

export class Idempotency {
  readonly name: string;
  private readonly ttlMs: number;
  private cache = new Map<string, CacheEntry>();

  constructor(options: IdempotencyOptions = {}) {
    this.name = options.name ?? 'idempotency';
    this.ttlMs = options.ttlMs ?? 300_000;
  }

  private buildKey(method: string, params: Record<string, unknown>): string {
    return `${method}:${JSON.stringify(params, Object.keys(params).sort())}`;
  }

  async call<T>(
    fn: () => Promise<T>,
    method: string,
    params: Record<string, unknown> = {},
  ): Promise<T> {
    const key = this.buildKey(method, params);
    const cached = this.cache.get(key);

    if (cached && Date.now() - cached.timestamp < this.ttlMs) {
      return cached.result as T;
    }

    const result = await fn();
    this.cache.set(key, { result, timestamp: Date.now() });
    return result;
  }

  clear(): void {
    this.cache.clear();
  }

  get size(): number {
    return this.cache.size;
  }
}

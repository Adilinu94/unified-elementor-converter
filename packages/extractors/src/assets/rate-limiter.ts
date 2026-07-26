/**
 * Per-host Rate-Limiter — Token-bucket style.
 */
export interface RateLimiterOptions {
  minDelayMs?: number;
  onWait?: (host: string, waitedMs: number) => void;
}

interface Bucket {
  nextAllowedAt: number;
  pending?: Promise<void>;
}

export class RateLimiter {
  private readonly minDelayMs: number;
  private readonly onWait?: (host: string, waitedMs: number) => void;
  private readonly buckets = new Map<string, Bucket>();

  constructor(options: RateLimiterOptions = {}) {
    this.minDelayMs = Math.max(0, options.minDelayMs ?? 500);
    this.onWait = options.onWait;
  }

  private hostOf(url: string): string {
    try {
      return new URL(url).host;
    } catch {
      return url;
    }
  }

  async acquire(host: string): Promise<void> {
    const key = host || '*';
    const prev = this.buckets.get(key)?.pending ?? Promise.resolve();
    const next = prev.then(() => this.acquireOne(key));
    this.buckets.set(key, {
      nextAllowedAt: this.buckets.get(key)?.nextAllowedAt ?? 0,
      pending: next,
    });
    await next;
  }

  private async acquireOne(key: string): Promise<void> {
    const bucket = this.buckets.get(key) ?? { nextAllowedAt: 0 };
    const now = Date.now();
    const waitMs = bucket.nextAllowedAt - now;
    if (waitMs > 0) {
      this.onWait?.(key, waitMs);
      await new Promise<void>((resolve) => setTimeout(resolve, waitMs));
    }
    bucket.nextAllowedAt = Date.now() + this.minDelayMs;
    this.buckets.set(key, bucket);
  }

  async acquireUrl(url: string): Promise<void> {
    await this.acquire(this.hostOf(url));
  }

  peek(host: string): Bucket | undefined {
    return this.buckets.get(host);
  }

  reset(): void {
    this.buckets.clear();
  }
}

export function createDomainRateLimiter(options: RateLimiterOptions = {}): RateLimiter {
  return new RateLimiter({ minDelayMs: 500, ...options });
}

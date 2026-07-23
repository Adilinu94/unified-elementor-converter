/**
 * Simple in-memory + file-based cache for extraction results.
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';

export interface CacheOptions {
  cacheDir: string;
  ttlMs?: number;
}

export class ExtractionCache {
  private readonly cacheDir: string;
  private readonly ttlMs: number;
  private memory = new Map<string, { data: unknown; timestamp: number }>();

  constructor(options: CacheOptions) {
    this.cacheDir = options.cacheDir;
    this.ttlMs = options.ttlMs ?? 3600_000;
  }

  private keyFor(url: string, options: Record<string, unknown> = {}): string {
    const raw = `${url}:${JSON.stringify(options, Object.keys(options).sort())}`;
    return createHash('sha256').update(raw).digest('hex').slice(0, 16);
  }

  get<T>(url: string, options: Record<string, unknown> = {}): T | null {
    const key = this.keyFor(url, options);

    const mem = this.memory.get(key);
    if (mem && Date.now() - mem.timestamp < this.ttlMs) {
      return mem.data as T;
    }

    const filePath = join(this.cacheDir, `${key}.json`);
    if (existsSync(filePath)) {
      try {
        const raw = JSON.parse(readFileSync(filePath, 'utf8'));
        if (Date.now() - raw.timestamp < this.ttlMs) {
          this.memory.set(key, { data: raw.data, timestamp: raw.timestamp });
          return raw.data as T;
        }
      } catch {
        /* corrupt cache */
      }
    }

    return null;
  }

  set(url: string, data: unknown, options: Record<string, unknown> = {}): void {
    const key = this.keyFor(url, options);
    const timestamp = Date.now();
    this.memory.set(key, { data, timestamp });

    try {
      mkdirSync(this.cacheDir, { recursive: true });
      const filePath = join(this.cacheDir, `${key}.json`);
      writeFileSync(filePath, JSON.stringify({ data, timestamp }), 'utf8');
    } catch {
      /* non-critical */
    }
  }

  clear(): void {
    this.memory.clear();
  }
}

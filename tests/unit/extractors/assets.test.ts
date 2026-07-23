import { describe, it, expect } from 'vitest';
import {
  RateLimiter,
  createDomainRateLimiter,
  normalizeImageUrl,
  buildManifest,
} from '@elconv/extractors';

describe('Rate Limiter', () => {
  it('creates with default 500ms delay', () => {
    const limiter = createDomainRateLimiter();
    expect(limiter).toBeInstanceOf(RateLimiter);
  });

  it('acquire resolves immediately for new host', async () => {
    const limiter = new RateLimiter({ minDelayMs: 0 });
    await expect(limiter.acquire('example.com')).resolves.toBeUndefined();
  });

  it('reset clears buckets', async () => {
    const limiter = new RateLimiter({ minDelayMs: 0 });
    await limiter.acquire('test.com');
    limiter.reset();
    expect(limiter.peek('test.com')).toBeUndefined();
  });
});

describe('normalizeImageUrl', () => {
  it('strips hash and tracking params', () => {
    const result = normalizeImageUrl('https://example.com/img.jpg?utm_source=x#frag');
    expect(result).not.toContain('#frag');
    expect(result).not.toContain('utm_source');
  });
});

describe('buildManifest', () => {
  it('aggregates totals', () => {
    const manifest = buildManifest(
      'https://example.com',
      [{ local_path: 'a.jpg', mime: 'image/jpeg', filesize: 1000, downloaded_at: '' }],
      [{ local_path: 'b.woff2', url: '', type: 'woff2', filesize: 500, downloaded_at: '' }],
      [{ local_path: 'c.svg', kind: 'inline', filesize: 200 }],
    );
    expect(manifest.total_files).toBe(3);
    expect(manifest.total_bytes).toBe(1700);
    expect(manifest.version).toBe(1);
  });
});

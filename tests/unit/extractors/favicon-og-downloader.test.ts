import { describe, it, expect } from 'vitest';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createServer } from 'node:http';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { readdir } from 'node:fs/promises';
import {
  normalizeFaviconKind,
  downloadFavicons,
} from '@elconv/extractors';

function tmpDir(): string {
  return join(
    tmpdir(),
    'clone-v3-favicon-test-' + Math.random().toString(36).slice(2, 10),
  );
}

async function startTestServer(
  routes: Record<string, { body: Buffer; contentType?: string }>,
): Promise<{ url: string; close: () => Promise<void> }> {
  const server: Server = createServer((req, res) => {
    const path = new URL(req.url ?? '/', 'http://x').pathname;
    const route = routes[path];
    if (!route) {
      res.statusCode = 404;
      res.end();
      return;
    }
    if (route.contentType) res.setHeader('content-type', route.contentType);
    res.end(route.body);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const addr = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${addr.port}`,
    close: async () => {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}

describe('favicon-og-downloader: normalizeFaviconKind', () => {
  it('detects apple-touch-icon', () => {
    expect(normalizeFaviconKind('apple-touch-icon', null)).toBe('apple-touch-icon');
    expect(normalizeFaviconKind('apple-touch-icon-precomposed', null)).toBe('apple-touch-icon');
  });
  it('detects og:image variants', () => {
    expect(normalizeFaviconKind(null, 'og:image')).toBe('og-image');
    expect(normalizeFaviconKind(null, 'og:image:secure_url')).toBe('og-image-secure');
  });
  it('detects twitter image', () => {
    expect(normalizeFaviconKind(null, 'twitter:image')).toBe('twitter-image');
    expect(normalizeFaviconKind(null, 'twitter:image:src')).toBe('twitter-image');
  });
  it('falls back to icon / shortcut-icon', () => {
    expect(normalizeFaviconKind('icon', null)).toBe('icon');
    expect(normalizeFaviconKind('shortcut icon', null)).toBe('shortcut-icon');
  });
  it('returns favicon for unknown', () => {
    expect(normalizeFaviconKind(null, null)).toBe('favicon');
  });
});

describe('favicon-og-downloader: downloadFavicons', () => {
  it('skips empty arrays', async () => {
    const dir = tmpDir();
    const result = await downloadFavicons([], { hostname: 'x.com', outputRoot: dir });
    expect(Object.keys(result.manifest)).toHaveLength(0);
  });

  it('dedupes by kind+url', async () => {
    const dir = tmpDir();
    const sameUrl = 'https://example.com/icon.png';
    const result = await downloadFavicons(
      [
        { url: sameUrl, kind: 'icon' },
        { url: sameUrl, kind: 'icon' },
      ],
      { hostname: 'x.com', outputRoot: dir },
    );
    // dedup means only 1 attempt; result might be 0 or 1 entry depending on network
    // (we don't make a real fetch here — but the dedup logic means 1 attempt max)
    expect(result.errors.length + Object.keys(result.manifest).length).toBeLessThanOrEqual(1);
  });

  it('writes successfully fetched apple-touch-icon from local server', async () => {
    const dir = tmpDir();
    // 1x1 PNG header
    const png = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==',
      'base64',
    );
    const srv = await startTestServer({
      '/apple-touch-icon.png': { body: png, contentType: 'image/png' },
    });
    try {
      const result = await downloadFavicons(
        [
          {
            url: `${srv.url}/apple-touch-icon.png`,
            kind: 'apple-touch-icon',
            sizes: '180x180',
          },
        ],
        { hostname: 'google.com', outputRoot: dir },
      );
      expect(Object.keys(result.manifest)).toHaveLength(1);
      const key = `${srv.url}/apple-touch-icon.png`;
      const entry = result.manifest[key];
      expect(entry?.local_path).toBe('seo/apple-touch-icon-180x180.png');
      expect(entry?.sizes).toBe('180x180');
      const files = await readdir(join(dir, 'seo'));
      expect(files).toContain('apple-touch-icon-180x180.png');
    } finally {
      await srv.close();
    }
  });
});

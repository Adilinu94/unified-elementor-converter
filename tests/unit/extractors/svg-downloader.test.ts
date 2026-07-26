import { describe, it, expect } from 'vitest';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createServer } from 'node:http';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { readdir, stat } from 'node:fs/promises';
import {
  hashSvg,
  generateSvgFilename,
  looksLikeSvg,
  stripXmlDecl,
  downloadSvgs,
} from '@elconv/extractors';

function tmpDir(): string {
  return join(
    tmpdir(),
    'clone-v3-svg-test-' + Math.random().toString(36).slice(2, 10),
  );
}

async function startTestServer(
  routes: Record<string, { status?: number; body: string; contentType?: string }>,
): Promise<{ url: string; close: () => Promise<void> }> {
  const server: Server = createServer((req, res) => {
    const path = new URL(req.url ?? '/', 'http://x').pathname;
    const route = routes[path];
    if (!route) {
      res.statusCode = 404;
      res.end();
      return;
    }
    res.statusCode = route.status ?? 200;
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

const SIMPLE_SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><circle r="5"/></svg>';

describe('svg-downloader: hashSvg', () => {
  it('is stable across whitespace differences', () => {
    expect(hashSvg(SIMPLE_SVG)).toBe(
      hashSvg('<svg xmlns="http://www.w3.org/2000/svg"  viewBox="0 0 10 10">  <circle r="5"/>  </svg>'),
    );
  });
  it('is 16 hex chars', () => {
    expect(hashSvg(SIMPLE_SVG)).toMatch(/^[a-f0-9]{16}$/);
  });
  it('differs for different SVGs', () => {
    const a = hashSvg('<svg><circle/></svg>');
    const b = hashSvg('<svg><rect/></svg>');
    expect(a).not.toBe(b);
  });
});

describe('svg-downloader: generateSvgFilename', () => {
  it('uses id when present', () => {
    expect(generateSvgFilename(SIMPLE_SVG, 'logo')).toMatch(/^logo-[a-f0-9]{6}\.svg$/);
  });
  it('falls back to hash', () => {
    expect(generateSvgFilename(SIMPLE_SVG)).toMatch(/^[a-f0-9]{12}\.svg$/);
  });
});

describe('svg-downloader: looksLikeSvg + stripXmlDecl', () => {
  it('detects svg', () => {
    expect(looksLikeSvg('<svg></svg>')).toBe(true);
    expect(looksLikeSvg('<?xml version="1.0"?><svg></svg>')).toBe(true);
    expect(looksLikeSvg('<div>not svg</div>')).toBe(false);
  });
  it('strips xml decl', () => {
    expect(stripXmlDecl('<?xml version="1.0"?><svg></svg>')).toBe('<svg></svg>');
  });
});

describe('svg-downloader: downloadSvgs (inline)', () => {
  it('writes inline SVGs and dedupes by hash', async () => {
    const dir = tmpDir();
    const result = await downloadSvgs(
      [
        { kind: 'inline', markup: SIMPLE_SVG, sourceElement: 'header > .icon' },
        { kind: 'inline', markup: SIMPLE_SVG, sourceElement: 'footer > .icon' },
        { kind: 'inline', markup: '<svg><rect/></svg>', sourceElement: 'body' },
      ],
      { hostname: 'example.com', outputRoot: dir },
    );
    // 2 unique SVGs (deduped)
    const files = await readdir(join(dir, 'svgs'));
    expect(files).toHaveLength(2);
    expect(Object.keys(result.manifest)).toHaveLength(3); // all 3 sources recorded
    // The first inline source has the right kind
    expect(result.manifest['inline#0']?.source).toBe('inline');
    expect(result.manifest['inline#0']?.source_element).toBe('header > .icon');
  });

  it('rejects non-svg markup', async () => {
    const dir = tmpDir();
    const result = await downloadSvgs(
      [{ kind: 'inline', markup: '<div>not svg</div>' }],
      { hostname: 'example.com', outputRoot: dir },
    );
    expect(Object.keys(result.manifest)).toHaveLength(0);
    expect(result.errors[0].reason).toBe('not_svg_markup');
  });
});

describe('svg-downloader: downloadSvgs (external)', () => {
  it('fetches a real SVG from local server', async () => {
    const dir = tmpDir();
    const svgBody = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><circle cx="50" cy="50" r="40" fill="red"/></svg>';
    const srv = await startTestServer({
      '/icon.svg': { body: svgBody, contentType: 'image/svg+xml' },
    });
    try {
      const result = await downloadSvgs(
        [{ kind: 'external', url: `${srv.url}/icon.svg` }],
        { hostname: 'example.com', outputRoot: dir },
      );
      expect(Object.keys(result.manifest)).toHaveLength(1);
      const entry = result.manifest[`${srv.url}/icon.svg`];
      expect(entry?.local_path).toMatch(/\.svg$/);
      const st = await stat(join(dir, entry!.local_path));
      expect(st.size).toBeGreaterThan(50);
    } finally {
      await srv.close();
    }
  });

  it('records fetch error without throwing', async () => {
    const dir = tmpDir();
    const srv = await startTestServer({});
    try {
      const result = await downloadSvgs(
        [{ kind: 'external', url: `${srv.url}/missing.svg` }],
        { hostname: 'example.com', outputRoot: dir },
      );
      expect(result.errors).toHaveLength(1);
    } finally {
      await srv.close();
    }
  });
});

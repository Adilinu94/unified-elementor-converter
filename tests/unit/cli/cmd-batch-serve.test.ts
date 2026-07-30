import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { writeFileSync, rmSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { AddressInfo } from 'node:net';
import { parseBatchManifest, cmdBatch } from '../../../packages/cli/src/cmd-batch.js';
import { createElconvServer } from '../../../packages/cli/src/cmd-serve.js';

const SAMPLE_HTML = '<!doctype html><html><body><section><h1>Hello</h1><p>World</p></section></body></html>';

describe('parseBatchManifest', () => {
  it('parses a valid manifest', () => {
    const entries = parseBatchManifest(
      JSON.stringify([
        { target: 'v3', html: './a.html', out: './out/a.json' },
        { target: 'v4', xml: './b.xml', skipGuards: true },
      ]),
    );
    expect(entries).toHaveLength(2);
    expect(entries[0].target).toBe('v3');
    expect(entries[0].html).toBe('./a.html');
    expect(entries[1].skipGuards).toBe(true);
  });

  it('rejects non-JSON, non-array, empty, bad target, and sourceless entries', () => {
    expect(() => parseBatchManifest('{nope')).toThrow(/not valid JSON/);
    expect(() => parseBatchManifest('{}')).toThrow(/non-empty JSON array/);
    expect(() => parseBatchManifest('[]')).toThrow(/non-empty JSON array/);
    expect(() => parseBatchManifest('[{"target":"v5","html":"x"}]')).toThrow(/entry 0: "target"/);
    expect(() => parseBatchManifest('[{"target":"v3"}]')).toThrow(/entry 0: needs one of/);
  });
});

describe('cmdBatch', () => {
  const dir = join(tmpdir(), `elconv-batch-${Math.random().toString(36).slice(2)}`);

  beforeEach(() => {
    mkdirSync(dir, { recursive: true });
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
  });
  afterEach(() => {
    vi.restoreAllMocks();
    if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
  });

  it('returns 2 for an invalid manifest', async () => {
    const manifest = join(dir, 'bad.json');
    writeFileSync(manifest, '[{"target":"v3"}]', 'utf-8');
    const code = await cmdBatch({ manifest });
    expect(code).toBe(2);
  });

  it('converts each manifest entry and writes the outputs', async () => {
    const htmlA = join(dir, 'a.html');
    const htmlB = join(dir, 'b.html');
    writeFileSync(htmlA, SAMPLE_HTML, 'utf-8');
    writeFileSync(htmlB, SAMPLE_HTML, 'utf-8');
    const outA = join(dir, 'a-tree.json');
    const outB = join(dir, 'b-tree.json');
    const manifest = join(dir, 'ok.json');
    writeFileSync(
      manifest,
      JSON.stringify([
        { target: 'v3', html: htmlA, out: outA, skipGuards: true },
        { target: 'v3', html: htmlB, out: outB, skipGuards: true },
      ]),
      'utf-8',
    );

    const code = await cmdBatch({ manifest });
    expect(code).toBe(0);
    expect(existsSync(outA)).toBe(true);
    expect(existsSync(outB)).toBe(true);
    expect(() => JSON.parse(readFileSync(outA, 'utf-8'))).not.toThrow();
  });

  it('reports failure (exit 1) when an entry fails but continues the rest', async () => {
    const htmlOk = join(dir, 'ok.html');
    writeFileSync(htmlOk, SAMPLE_HTML, 'utf-8');
    const outOk = join(dir, 'ok-tree.json');
    const manifest = join(dir, 'mixed.json');
    writeFileSync(
      manifest,
      JSON.stringify([
        { target: 'v3', html: join(dir, 'missing.html'), out: join(dir, 'x.json') },
        { target: 'v3', html: htmlOk, out: outOk, skipGuards: true },
      ]),
      'utf-8',
    );

    const code = await cmdBatch({ manifest });
    expect(code).toBe(1);
    // Second entry still ran despite the first failing.
    expect(existsSync(outOk)).toBe(true);
  });
});

describe('elconv serve — HTTP API', () => {
  it('serves /health, validates /convert and /qa inputs, 404s unknown routes', async () => {
    const server = createElconvServer();
    await new Promise<void>((resolve) => server.listen(0, () => resolve()));
    const port = (server.address() as AddressInfo).port;
    const base = `http://127.0.0.1:${port}`;

    try {
      const health = await fetch(`${base}/health`);
      expect(health.status).toBe(200);
      const healthBody = (await health.json()) as { ok: boolean; commands: string[] };
      expect(healthBody.ok).toBe(true);
      expect(healthBody.commands).toContain('POST /convert');

      const badConvert = await fetch(`${base}/convert`, {
        method: 'POST',
        body: JSON.stringify({ target: 'v9' }),
      });
      expect(badConvert.status).toBe(400);

      const badQa = await fetch(`${base}/qa`, { method: 'POST', body: '{}' });
      expect(badQa.status).toBe(400);

      const nope = await fetch(`${base}/nope`);
      expect(nope.status).toBe(404);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it('runs a real conversion via POST /convert', async () => {
    const dir = join(tmpdir(), `elconv-serve-${Math.random().toString(36).slice(2)}`);
    mkdirSync(dir, { recursive: true });
    const html = join(dir, 'page.html');
    writeFileSync(html, SAMPLE_HTML, 'utf-8');
    const out = join(dir, 'tree.json');

    const writeSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const server = createElconvServer();
    await new Promise<void>((resolve) => server.listen(0, () => resolve()));
    const port = (server.address() as AddressInfo).port;

    try {
      const res = await fetch(`http://127.0.0.1:${port}/convert`, {
        method: 'POST',
        body: JSON.stringify({ target: 'v3', html, out, skipGuards: true }),
      });
      const body = (await res.json()) as { ok: boolean; exitCode: number };
      expect(res.status).toBe(200);
      expect(body.ok).toBe(true);
      expect(existsSync(out)).toBe(true);
    } finally {
      writeSpy.mockRestore();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

import { describe, expect, it } from 'vitest';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { cmdConvert } from '../../../packages/cli/src/cmd-convert.js';
import type { AnimationIR, VisualPageIR } from '@elconv/core';

/**
 * `elconv convert --ir` — the first CLI path that carries animations.
 *
 * Why this path exists at all: `SourceSpec` (the shape `--xml` and `--html`
 * produce) has no animation field, so those paths deploy a page with every
 * measured effect missing and no warning. Routing an IR through `buildV3Tree`
 * would have the same silent result, which is why `--ir` is separate rather
 * than folded into the existing flow.
 *
 * These tests exercise the real chain end-to-end against the committed control
 * snapshot — no mocked schema. A mocked schema would agree with whatever the
 * emitter did and prove nothing about the container/widget control-name split
 * that decides native-vs-fallback.
 */

const EVIDENCE = { sourceIds: ['x'], methods: ['dom' as const], confidence: 0.85, warnings: [] };

function entrance(overrides: Partial<AnimationIR> = {}): AnimationIR {
  return {
    id: 'a-entrance',
    kind: 'scroll',
    targetSourceId: 'node-1',
    intent: 'entrance:opacity+translateY',
    motionClass: 'entrance',
    durationMs: 600,
    effects: [
      { kind: 'opacity', from: 0, to: 1, range: 1, monotonic: true },
      { kind: 'translateY', from: 40, to: 0, range: 40, monotonic: true },
    ],
    evidence: EVIDENCE,
    ...overrides,
  };
}

function pageIr(animations: AnimationIR[] = []): VisualPageIR {
  return {
    schemaVersion: '1.0',
    source: {
      url: 'https://example.test/',
      route: '/',
      extractionMode: 'hybrid',
      capturedAt: new Date(0).toISOString(),
      pageId: 'home',
    },
    viewportProfiles: [{ label: 'desktop', width: 1440, height: 900 }],
    tokens: { colors: {}, fonts: [], textStyles: {}, spacing: {} },
    sections: [
      {
        sourceId: 'sec-1',
        role: 'hero',
        layoutArchetype: 'stacked',
        bboxByViewport: { desktop: { x: 0, y: 0, width: 1440, height: 700 } },
        styles: { 'background-color': '#101820', padding: '40px 24px' },
        nodes: [
          {
            sourceId: 'node-1',
            role: 'heading',
            tag: 'h1',
            text: 'Hero headline',
            styles: { color: '#ffffff' },
            children: [],
            evidence: EVIDENCE,
          },
          {
            sourceId: 'node-2',
            role: 'text',
            text: 'Body copy that is long enough to count as substance.',
            styles: { color: '#cccccc' },
            children: [],
            evidence: EVIDENCE,
          },
          {
            sourceId: 'node-3',
            role: 'button',
            text: 'Get started',
            href: '/start',
            styles: { 'background-color': '#ff4400' },
            children: [],
            evidence: EVIDENCE,
          },
        ],
        evidence: EVIDENCE,
      },
    ],
    assets: [],
    animations,
    warnings: [],
  };
}

async function withTempDir<T>(run: (dir: string) => Promise<T>): Promise<T> {
  const root = await mkdtemp(join(tmpdir(), 'elconv-convert-ir-'));
  try {
    return await run(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

describe('cmdConvert --ir usage', () => {
  it('rejects --ir together with another source', async () => {
    const code = await cmdConvert({ target: 'v3', ir: './a.json', html: './b.html' });
    expect(code).toBe(2);
  });

  it('rejects --ir for a V4 target instead of silently building V3', async () => {
    const code = await cmdConvert({ target: 'v4', ir: './a.json' });
    expect(code).toBe(2);
  });

  it('rejects a non-integer post id', async () => {
    const code = await cmdConvert({ target: 'v3', ir: './a.json', 'post-id': '0' });
    expect(code).toBe(2);
  });

  it('fails with a readable message when the IR file is missing', async () => {
    const code = await cmdConvert({ target: 'v3', ir: join(tmpdir(), 'does-not-exist-ir.json') });
    expect(code).toBe(1);
  });

  it('fails when the file is valid JSON but not a VisualPageIR', async () => {
    await withTempDir(async (dir) => {
      const irPath = join(dir, 'not-an-ir.json');
      await writeFile(irPath, JSON.stringify({ hello: 'world' }), 'utf8');
      expect(await cmdConvert({ target: 'v3', ir: irPath })).toBe(1);
    });
  });
});

describe('cmdConvert --ir build', () => {
  it('writes a V3 tree and no snippet file when every effect is native', async () => {
    await withTempDir(async (dir) => {
      const irPath = join(dir, 'page-ir.json');
      const outPath = join(dir, 'v3-tree.json');
      await writeFile(irPath, JSON.stringify(pageIr([entrance()])), 'utf8');

      const code = await cmdConvert({
        target: 'v3',
        ir: irPath,
        out: outPath,
        'post-id': '42',
      });

      expect(code).toBe(0);

      const tree = JSON.parse(await readFile(outPath, 'utf8')) as unknown[];
      expect(Array.isArray(tree)).toBe(true);
      expect(tree).toHaveLength(1);

      // The entrance is a Core feature, so it must land as a real setting rather
      // than as a snippet. Serialised and read back: a setting that does not
      // survive JSON is not deployable.
      const serialised = JSON.stringify(tree);
      expect(serialised).toContain('_animation');
      expect(serialised).toContain('fadeInUp');

      // No fallback means no sidecar file at all.
      await expect(readFile(`${outPath.replace(/\.json$/, '')}.snippets.json`, 'utf8')).rejects.toThrow();
    });
  });

  it('writes residual snippets beside the tree when an effect cannot be native', async () => {
    await withTempDir(async (dir) => {
      const irPath = join(dir, 'page-ir.json');
      const outPath = join(dir, 'v3-tree.json');
      // Scroll-linked motion needs Elementor Pro's motion-fx module. The
      // committed snapshot has it, so to force the fallback the effect is left
      // unclassifiable in a different way: a scroll class with a measured
      // amplitude no speed slider can reach.
      const huge: AnimationIR = {
        id: 'a-huge',
        kind: 'scroll',
        targetSourceId: 'node-2',
        intent: 'scroll:translateY',
        motionClass: 'scroll-linked',
        effects: [{ kind: 'translateY', from: 40000, to: -40000, range: 80000, monotonic: true }],
        evidence: EVIDENCE,
      };
      await writeFile(irPath, JSON.stringify(pageIr([huge])), 'utf8');

      const code = await cmdConvert({
        target: 'v3',
        ir: irPath,
        out: outPath,
        'post-id': '42',
      });

      expect(code).toBe(0);

      const snippets = JSON.parse(
        await readFile(`${outPath.replace(/\.json$/, '')}.snippets.json`, 'utf8'),
      ) as Array<{ code: string; location: string; type: string }>;

      expect(snippets.length).toBeGreaterThan(0);
      // Page-scoped, because --post-id was given. A site-wide snippet from a
      // single-page convert would leak motion onto every other page.
      expect(snippets.some((snippet) => snippet.code.includes('page-id-42'))).toBe(true);
      // WPCode only preserves inline scripts for html+footer.
      for (const snippet of snippets) {
        if (snippet.code.includes('<script')) {
          expect(snippet.type).toBe('html');
          expect(snippet.location).toBe('footer');
        }
      }
    });
  });

  it('builds a page with no animations at all without inventing snippets', async () => {
    await withTempDir(async (dir) => {
      const irPath = join(dir, 'page-ir.json');
      const outPath = join(dir, 'v3-tree.json');
      await writeFile(irPath, JSON.stringify(pageIr([])), 'utf8');

      expect(await cmdConvert({ target: 'v3', ir: irPath, out: outPath })).toBe(0);

      const serialised = await readFile(outPath, 'utf8');
      expect(serialised).not.toContain('_animation');
      await expect(readFile(`${outPath.replace(/\.json$/, '')}.snippets.json`, 'utf8')).rejects.toThrow();
    });
  });

  it('reports an unhandled effect instead of writing a tree that silently lost it', async () => {
    await withTempDir(async (dir) => {
      const irPath = join(dir, 'page-ir.json');
      const outPath = join(dir, 'v3-tree.json');
      // No `motionClass`: the source measured motion it could not classify.
      // Choosing an entrance here would be a guess, and Elementor hides an
      // entrance element until its handler fires — a wrong guess makes content
      // vanish. So this must stay an unhandled, reported gap.
      const unclassified: AnimationIR = {
        id: 'a-unknown',
        kind: 'scroll',
        targetSourceId: 'node-1',
        intent: 'unknown motion',
        effects: [{ kind: 'opacity', from: 0, to: 1, range: 1 }],
        evidence: EVIDENCE,
      };
      await writeFile(irPath, JSON.stringify(pageIr([unclassified])), 'utf8');

      // The parity guard is a warning, not critical, so the build still
      // completes — an unmappable effect is a documented fidelity loss, not a
      // broken tree.
      expect(await cmdConvert({ target: 'v3', ir: irPath, out: outPath, 'post-id': '42' })).toBe(0);

      const serialised = await readFile(outPath, 'utf8');
      expect(serialised).not.toContain('_animation');
      await expect(readFile(`${outPath.replace(/\.json$/, '')}.snippets.json`, 'utf8')).rejects.toThrow();
    });
  });

  it('does not write snippets to a guessed path when --out is omitted', async () => {
    await withTempDir(async (dir) => {
      const irPath = join(dir, 'page-ir.json');
      const huge: AnimationIR = {
        id: 'a-huge',
        kind: 'scroll',
        targetSourceId: 'node-2',
        intent: 'scroll:translateY',
        motionClass: 'scroll-linked',
        effects: [{ kind: 'translateY', from: 40000, to: -40000, range: 80000, monotonic: true }],
        evidence: EVIDENCE,
      };
      await writeFile(irPath, JSON.stringify(pageIr([huge])), 'utf8');

      // Without --out the tree goes to stdout; mixing snippet JSON into the same
      // stream would corrupt both, so the snippets are reported as unwritten.
      expect(await cmdConvert({ target: 'v3', ir: irPath, 'post-id': '42' })).toBe(0);
    });
  });
});

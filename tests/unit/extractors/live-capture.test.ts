import { describe, expect, it } from 'vitest';
import {
  assembleLiveCapture,
  formatLiveCaptureReport,
  viewportsFromWidths,
  type LiveDomNode,
  type LiveNodeTreeCapture,
} from '@elconv/extractors';
import type { Evidence, VisualNodeIR, VisualPageIR } from '@elconv/core';
import { validateVisualPageIR } from '@elconv/core';

/**
 * The live-capture orchestrator, exercised through its pure half.
 *
 * `assembleLiveCapture` is separated from the browser work precisely so the whole
 * decision path — align, expand, merge — is testable with fixture captures. The
 * ORDER of those three is the thing under test, because getting it wrong is
 * silent and was measurably costly: running the merge before expansion left 28 of
 * 31 measured effects unattributable on the real page, because motion attribution
 * matches on `sourceName` and the grafted nodes did not exist yet.
 */

const MCP: Evidence = { sourceIds: ['x'], methods: ['mcp', 'xml'], confidence: 0.92, warnings: [] };

function node(overrides: Partial<VisualNodeIR> = {}): VisualNodeIR {
  return { sourceId: 'n1', role: 'layout', children: [], evidence: MCP, ...overrides };
}

function ir(sections: VisualPageIR['sections'], animations: VisualPageIR['animations'] = []): VisualPageIR {
  return {
    schemaVersion: '1.0',
    source: {
      url: 'https://site.test/',
      route: '/',
      extractionMode: 'structural',
      capturedAt: new Date(0).toISOString(),
      pageId: 'home',
    },
    viewportProfiles: [{ label: 'desktop', width: 1440, height: 900 }],
    tokens: { colors: {}, fonts: [], textStyles: {}, spacing: {} },
    sections,
    assets: [],
    animations,
    warnings: ['structure-only extraction: bboxByViewport is empty and no animations were detected.'],
  };
}

function dom(framerName: string, children: LiveDomNode[] = [], extra: Partial<LiveDomNode> = {}): LiveDomNode {
  return {
    framerName,
    tag: 'div',
    bbox: { x: 0, y: 0, width: 1440, height: 500 },
    children,
    ...extra,
  };
}

function capture(roots: LiveDomNode[]): LiveNodeTreeCapture {
  const count = (n: LiveDomNode): number => 1 + n.children.reduce((t, c) => t + count(c), 0);
  return {
    roots,
    nodeCount: roots.reduce((t, r) => t + count(r), 0),
    namedNodeCount: roots.reduce((t, r) => t + count(r), 0),
    warnings: [],
  };
}

const HERO = {
  sourceId: 'hero',
  role: 'hero',
  sourceName: 'Hero Section',
  layoutArchetype: 'stacked',
  bboxByViewport: {},
  nodes: [node({ sourceId: 'cta', role: 'component', sourceName: 'Cta', componentId: 'btnDef' })],
  evidence: MCP,
};

describe('assembleLiveCapture', () => {
  it('aligns, expands and merges in one pass', () => {
    const result = assembleLiveCapture({
      ir: ir([HERO]),
      captures: { desktop: capture([dom('Hero Section', [dom('Cta', [dom('Text Wrapper')])])]) },
      viewports: [{ label: 'desktop', width: 1440, height: 900 }],
      viewportSource: 'source-breakpoints',
      options: { url: 'https://site.test/' },
    });

    expect(result.report.alignment.matched).toBe(1);
    expect(result.report.expansionTotals.expanded).toBe(1);
    expect(result.report.nodeCountAfter).toBeGreaterThan(result.report.nodeCountBefore);
    // Geometry landed too: the merge ran on the expanded tree.
    expect(result.ir.sections[0].bboxByViewport.desktop).toBeDefined();
  });

  it('produces an IR that still validates against the contract', () => {
    const result = assembleLiveCapture({
      ir: ir([HERO]),
      captures: { desktop: capture([dom('Hero Section', [dom('Cta', [dom('Label')])])]) },
      viewports: [{ label: 'desktop', width: 1440, height: 900 }],
      viewportSource: 'source-breakpoints',
      options: { url: 'https://site.test/' },
    });
    expect(validateVisualPageIR(result.ir).valid).toBe(true);
  });

  it('replaces the structure-only warning with a measured summary', () => {
    const result = assembleLiveCapture({
      ir: ir([HERO]),
      captures: { desktop: capture([dom('Hero Section', [dom('Cta')])]) },
      viewports: [{ label: 'desktop', width: 1440, height: 900 }],
      viewportSource: 'source-breakpoints',
      options: { url: 'https://site.test/' },
    });

    expect(result.ir.warnings.join(' ')).not.toContain('structure-only extraction');
    expect(result.ir.warnings.join(' ')).toContain('live capture:');
  });

  it('names the rendered roots it did not convert', () => {
    // The site header and footer are real content that no structural section
    // covers. Absorbing them silently would be the worse failure.
    const result = assembleLiveCapture({
      ir: ir([HERO]),
      captures: {
        desktop: capture([
          dom('Hero Section', [dom('Cta')]),
          dom('CTA & Footer', [], { bbox: { x: 0, y: 5000, width: 1440, height: 1200 } }),
        ]),
      },
      viewports: [{ label: 'desktop', width: 1440, height: 900 }],
      viewportSource: 'source-breakpoints',
      options: { url: 'https://site.test/' },
    });

    expect(result.report.alignment.extraDomRoots).toHaveLength(1);
    expect(result.ir.warnings.join(' ')).toContain('CTA & Footer');
  });

  it('registers a grafted image as an asset so it is not a blocking gap', () => {
    // An image node without a resolvable assetId is a blocking
    // UNSUPPORTED_IMAGE_ASSET in the V3 emitter. Measured on the live page: 4
    // such nodes refused the entire build.
    const result = assembleLiveCapture({
      ir: ir([HERO]),
      captures: {
        desktop: capture([
          dom('Hero Section', [dom('Cta', [dom('Photo', [], { mediaUrl: 'https://cdn.test/a.png' })])]),
        ]),
      },
      viewports: [{ label: 'desktop', width: 1440, height: 900 }],
      viewportSource: 'source-breakpoints',
      options: { url: 'https://site.test/' },
    });

    expect(result.ir.assets).toHaveLength(1);
    expect(result.ir.assets[0].sourceUrl).toBe('https://cdn.test/a.png');

    const grafted = result.ir.sections[0].nodes[0].children[0];
    expect(grafted.role).toBe('image');
    expect(grafted.assetId).toBe(result.ir.assets[0].id);
  });

  it('reuses one asset entry for the same URL in two instances', () => {
    const result = assembleLiveCapture({
      ir: ir([
        {
          ...HERO,
          nodes: [
            node({ sourceId: 'a', role: 'component', sourceName: 'Card', componentId: 'cardDef' }),
            node({ sourceId: 'b', role: 'component', sourceName: 'Card', componentId: 'cardDef' }),
          ],
        },
      ]),
      captures: {
        desktop: capture([
          dom('Hero Section', [
            dom('Card', [dom('Img', [], { mediaUrl: 'https://cdn.test/same.png' })]),
            dom('Card', [dom('Img', [], { mediaUrl: 'https://cdn.test/same.png' })]),
          ]),
        ]),
      },
      viewports: [{ label: 'desktop', width: 1440, height: 900 }],
      viewportSource: 'source-breakpoints',
      options: { url: 'https://site.test/' },
    });

    expect(result.ir.assets).toHaveLength(1);
  });

  it('skips expansion on request and still merges geometry', () => {
    const result = assembleLiveCapture({
      ir: ir([HERO]),
      captures: { desktop: capture([dom('Hero Section', [dom('Cta', [dom('Label')])])]) },
      viewports: [{ label: 'desktop', width: 1440, height: 900 }],
      viewportSource: 'source-breakpoints',
      options: { url: 'https://site.test/', skipExpansion: true },
    });

    expect(result.report.expansionTotals.expanded).toBe(0);
    expect(result.report.nodeCountAfter).toBe(result.report.nodeCountBefore);
    expect(result.ir.sections[0].bboxByViewport.desktop).toBeDefined();
  });

  it('does not mutate the input IR', () => {
    const input = ir([HERO]);
    assembleLiveCapture({
      ir: input,
      captures: { desktop: capture([dom('Hero Section', [dom('Cta', [dom('X')])])]) },
      viewports: [{ label: 'desktop', width: 1440, height: 900 }],
      viewportSource: 'source-breakpoints',
      options: { url: 'https://site.test/' },
    });

    expect(input.sections[0].nodes[0].children).toEqual([]);
    expect(input.sections[0].bboxByViewport).toEqual({});
  });

  it('applies boxes from every viewport whose capture aligns', () => {
    const result = assembleLiveCapture({
      ir: ir([HERO]),
      captures: {
        desktop: capture([dom('Hero Section', [dom('Cta')])]),
        mobile: capture([
          dom('Hero Section', [dom('Cta')], { bbox: { x: 0, y: 0, width: 390, height: 800 } }),
        ]),
      },
      viewports: [
        { label: 'desktop', width: 1440, height: 900 },
        { label: 'mobile', width: 390, height: 844 },
      ],
      viewportSource: 'source-breakpoints',
      options: { url: 'https://site.test/' },
    });

    expect(Object.keys(result.ir.sections[0].bboxByViewport).sort()).toEqual(['desktop', 'mobile']);
  });

  it('marks the IR as hybrid rather than leaving it structural', () => {
    const result = assembleLiveCapture({
      ir: ir([HERO]),
      captures: { desktop: capture([dom('Hero Section', [dom('Cta')])]) },
      viewports: [{ label: 'desktop', width: 1440, height: 900 }],
      viewportSource: 'source-breakpoints',
      options: { url: 'https://site.test/' },
    });
    expect(result.ir.source.extractionMode).toBe('hybrid');
  });

  it('handles a capture with no roots without inventing geometry', () => {
    const result = assembleLiveCapture({
      ir: ir([HERO]),
      captures: { desktop: capture([]) },
      viewports: [{ label: 'desktop', width: 1440, height: 900 }],
      viewportSource: 'fallback',
      options: { url: 'https://site.test/' },
    });

    expect(result.report.alignment.matched).toBe(0);
    expect(result.ir.sections[0].bboxByViewport).toEqual({});
    expect(result.report.expansionTotals.expanded).toBe(0);
  });
});

describe('viewportsFromWidths', () => {
  it('labels widths by Elementor breakpoint bands, widest first', () => {
    expect(viewportsFromWidths([390, 1440, 810])).toEqual([
      { label: 'desktop', width: 1440, height: expect.any(Number) },
      { label: 'tablet', width: 810, height: expect.any(Number) },
      { label: 'mobile', width: 390, height: expect.any(Number) },
    ]);
  });

  it('de-duplicates repeated widths', () => {
    expect(viewportsFromWidths([1440, 1440, 390])).toHaveLength(2);
  });
});

describe('formatLiveCaptureReport', () => {
  it('states the node delta and where the viewports came from', () => {
    const result = assembleLiveCapture({
      ir: ir([HERO]),
      captures: { desktop: capture([dom('Hero Section', [dom('Cta', [dom('L')])])]) },
      viewports: [{ label: 'desktop', width: 1440, height: 900 }],
      viewportSource: 'source-breakpoints',
      options: { url: 'https://site.test/' },
    });
    const text = formatLiveCaptureReport(result.report);

    expect(text).toContain('from source-breakpoints');
    expect(text).toContain('IR nodes:');
    expect(text).toContain('component instances:');
  });
});

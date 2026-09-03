import { describe, it, expect, beforeEach } from 'vitest';
import { buildV3Tree, buildV3PageData, resetIdCounter } from '../../../packages/target-v3/src/builder.ts';
import { normalizeV3ContainerTree, findNestedContainersMissingIsInner, findFlexRowStackRisks } from '../../../packages/target-v3/src/normalize.ts';
import { V3_GUARDS } from '../../../packages/target-v3/src/guards.ts';
import { runGuards, findContamination, EMPTY_DESIGN_TOKEN_SET, type SourceSpec } from '../../../packages/core/src/index.ts';
import type { V3Element } from '../../../packages/target-v3/src/types.ts';

function makeSpec(overrides?: Partial<SourceSpec>): SourceSpec {
  return {
    source: { type: 'url', url: 'https://example.com' },
    tokens: EMPTY_DESIGN_TOKEN_SET,
    sections: [
      {
        id: 'sec1',
        semanticRole: 'hero',
        layout: 'single-column',
        widgets: [
          { id: 'w1', type: 'heading', text: 'Hello World', styles: { 'font-size': '48px' } },
          { id: 'w2', type: 'text', text: 'Some paragraph', styles: {} },
          { id: 'w3', type: 'button', text: 'Click Me', href: 'https://example.com', styles: { 'background-color': '#333' } },
        ],
        styles: { 'background-color': '#f0f0f0' },
      },
    ],
    cssVars: {},
    warnings: [],
    ...overrides,
  };
}

describe('V3 Builder', () => {
  beforeEach(() => resetIdCounter());

  it('produces V3 elements from SourceSpec', () => {
    const tree = buildV3Tree(makeSpec());
    expect(tree.length).toBe(1);
    expect(tree[0].elType).toBe('container');
    expect(tree[0].elements!.length).toBe(3);
  });

  it('maps heading widget correctly', () => {
    const tree = buildV3Tree(makeSpec());
    const heading = tree[0].elements![0];
    expect(heading.elType).toBe('widget');
    expect(heading.widgetType).toBe('heading');
    expect(heading.settings!.title).toBe('Hello World');
  });

  it('maps button widget with link', () => {
    const tree = buildV3Tree(makeSpec());
    const btn = tree[0].elements![2];
    expect(btn.widgetType).toBe('button');
    expect((btn.settings!.link as Record<string, unknown>).url).toBe('https://example.com');
  });

  it('multi-column layout creates inner containers', () => {
    const spec = makeSpec({
      sections: [{
        id: 'sec2',
        layout: 'multi-column',
        columns: 3,
        widgets: [
          { id: 'w1', type: 'heading', text: 'A', styles: {} },
          { id: 'w2', type: 'heading', text: 'B', styles: {} },
          { id: 'w3', type: 'heading', text: 'C', styles: {} },
        ],
        styles: {},
      }],
    });
    const tree = buildV3Tree(spec);
    expect(tree[0].settings!.flex_direction).toBe('row');
    expect(tree[0].elements!.length).toBe(3);
    expect(tree[0].elements![0].isInner).toBe(true);
  });

  it('buildV3PageData includes metadata', () => {
    const page = buildV3PageData(makeSpec(), 'Test Page');
    expect(page.title).toBe('Test Page');
    expect(page.type).toBe('page');
    expect(page.metadata.sectionCount).toBe(1);
    expect(page.metadata.widgetCount).toBe(3);
  });

  it('output never contains V4 markers', () => {
    const tree = buildV3Tree(makeSpec());
    expect(findContamination(tree, 'v3')).toEqual([]);
  });
});

describe('V3 Normalize', () => {
  it('sets isInner on nested containers', () => {
    const tree: V3Element[] = [{
      id: 'root',
      elType: 'container',
      settings: { flex_direction: 'column' },
      elements: [{
        id: 'child',
        elType: 'container',
        settings: {},
        elements: [],
        isInner: undefined as unknown as boolean,
      }],
      isInner: true, // wrong: top-level should be false
    }];
    const normalized = normalizeV3ContainerTree(tree);
    expect(normalized[0].isInner).toBe(false);
    expect(normalized[0].elements![0].isInner).toBe(true);
  });

  it('gives a flex-row container child the container width control', () => {
    // `_inline_size` is a COLUMN control; the committed snapshot lists it nowhere
    // on `__container__`, and the schema gate rejects it as an unknown key —
    // which makes elementor-set-content reject the whole write.
    const tree: V3Element[] = [{
      id: 'row',
      elType: 'container',
      settings: { flex_direction: 'row' },
      elements: [
        { id: 'c1', elType: 'container', settings: {}, elements: [] },
        { id: 'c2', elType: 'container', settings: {}, elements: [] },
      ],
    }];
    const normalized = normalizeV3ContainerTree(tree);
    const c1 = normalized[0].elements![0].settings as Record<string, unknown>;
    expect(c1._inline_size).toBeUndefined();
    expect(c1.width).toEqual({ unit: '%', size: 50, sizes: [] });
    expect(c1.content_width).toBe('full');
  });

  it('keeps _inline_size for a COLUMN child, which is the element that declares it', () => {
    const tree: V3Element[] = [{
      id: 'row',
      elType: 'container',
      settings: { flex_direction: 'row' },
      elements: [
        { id: 'col1', elType: 'column', settings: {}, elements: [] },
        { id: 'col2', elType: 'column', settings: {}, elements: [] },
      ],
    }];
    const normalized = normalizeV3ContainerTree(tree);
    const col1 = normalized[0].elements![0].settings as Record<string, unknown>;
    expect(col1._inline_size).toEqual({ unit: '%', size: 50 });
    expect(col1.width).toBeUndefined();
  });

  it('findNestedContainersMissingIsInner detects issues', () => {
    const tree: V3Element[] = [{
      id: 'root',
      elType: 'container',
      elements: [{ id: 'nested', elType: 'container', elements: [] }],
    }];
    const issues = findNestedContainersMissingIsInner(tree);
    expect(issues).toContain('nested');
  });

  it('findFlexRowStackRisks ignores a lone row child, which has nothing to stack with', () => {
    // Stacking needs two or more in-flow children. Flagging a single
    // unconstrained child produced 4 false positives on precious-board-067119
    // (ir_yrdyZXt0z, ir_uq_Ynnj_i, ir_hDukq7znY, ir_Gw0V2BGHy-dom1-1) that the
    // normalizer cannot fix — its gate is `unconstrained.length >= 2`.
    const tree: V3Element[] = [{
      id: 'row',
      elType: 'container',
      settings: { flex_direction: 'row' },
      elements: [{ id: 'c1', elType: 'container', settings: {}, elements: [] }],
    }];
    expect(findFlexRowStackRisks(tree)).toEqual([]);
  });

  it('findFlexRowStackRisks ignores an out-of-flow child, which never joins the flex layout', () => {
    // Measured as ir_MR1faeDEt-dom2-1: `position: absolute` in the source and
    // carried as such, so it can neither push a sibling down nor be pushed.
    const tree: V3Element[] = [{
      id: 'row',
      elType: 'container',
      settings: { flex_direction: 'row' },
      elements: [
        { id: 'c1', elType: 'container', settings: { position: 'absolute' }, elements: [] },
        { id: 'c2', elType: 'container', settings: {}, elements: [] },
      ],
    }];
    expect(findFlexRowStackRisks(tree)).toEqual([]);
  });

  it('findFlexRowStackRisks still flags two unconstrained in-flow children', () => {
    const tree: V3Element[] = [{
      id: 'row',
      elType: 'container',
      settings: { flex_direction: 'row' },
      elements: [
        { id: 'c1', elType: 'container', settings: {}, elements: [] },
        { id: 'c2', elType: 'container', settings: {}, elements: [] },
      ],
    }];
    expect(findFlexRowStackRisks(tree)).toEqual(['c1', 'c2']);
  });
});

describe('V3 Guards', () => {
  beforeEach(() => resetIdCounter());

  it('clean tree passes all guards ≥85', () => {
    const tree = buildV3Tree(makeSpec());
    const report = runGuards(tree, V3_GUARDS);
    expect(report.score).toBeGreaterThanOrEqual(85);
    expect(report.passed).toBe(true);
  });

  it('G_NO_V4 catches V4 contamination', () => {
    const badTree: V3Element[] = [{
      id: '1',
      elType: 'widget',
      widgetType: 'heading',
      settings: { type: 'e-flexbox', '$$type': 'size' },
    }];
    const report = runGuards(badTree, V3_GUARDS);
    const noV4 = report.results.find((r) => r.name.includes('G_NO_V4'));
    expect(noV4!.result.passed).toBe(false);
    expect(report.passed).toBe(false);
  });

  it('G_HTML_HAS_IMG catches img in html widget', () => {
    const badTree: V3Element[] = [{
      id: '1',
      elType: 'widget',
      widgetType: 'html',
      settings: { html: '<div><img src="x.png"></div>' },
    }];
    const report = runGuards(badTree, V3_GUARDS);
    const imgGuard = report.results.find((r) => r.name.includes('G_HTML_HAS_IMG'));
    expect(imgGuard!.result.passed).toBe(false);
  });

  it('duplicate IDs fail G1', () => {
    const badTree: V3Element[] = [
      { id: 'dup', elType: 'container', elements: [] },
      { id: 'dup', elType: 'container', elements: [] },
    ];
    const report = runGuards(badTree, V3_GUARDS);
    const g1 = report.results.find((r) => r.name.includes('G1'));
    expect(g1!.result.passed).toBe(false);
  });
});

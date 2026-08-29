import { describe, expect, it } from 'vitest';
import { emitVisualIrToV3, runV3Guards, type V3Element } from '@elconv/target-v3';
import {
  SNAPSHOT_WIDGET_TYPES,
  validateSettingsAgainstSchema,
  type VisualNodeIR,
  type VisualPageIR,
} from '@elconv/core';
import { loadWidgetSchemaFromSnapshot } from '@elconv/mcp';

function makeIr(): VisualPageIR {
  const evidence = {
    sourceIds: ['source'],
    methods: ['dom'] as const,
    confidence: 0.95,
    warnings: [],
  };
  return {
    schemaVersion: '1.0',
    source: { route: '/', extractionMode: 'hybrid', capturedAt: new Date(0).toISOString(), pageId: 'home' },
    viewportProfiles: [
      { label: 'desktop', width: 1440, height: 900 },
      { label: 'mobile', width: 390, height: 844 },
    ],
    tokens: { colors: {}, fonts: [], textStyles: {}, spacing: {} },
    sections: [{
      sourceId: 'hero',
      role: 'hero',
      layoutArchetype: 'split-hero',
      bboxByViewport: { desktop: { x: 0, y: 0, width: 1440, height: 700 } },
      styles: { 'background-color': '#101820', padding: '40px 24px' },
      responsiveOverrides: { mobile: { padding: '24px 16px' } },
      nodes: [
        { sourceId: 'title', role: 'heading', tag: 'h1', text: 'Hero', children: [], evidence },
        { sourceId: 'copy', role: 'text', text: 'Body copy', children: [], evidence },
        { sourceId: 'cta', role: 'button', text: 'Join', href: '/join', children: [], evidence },
        { sourceId: 'photo', role: 'image', assetId: 'hero-image', children: [], evidence },
      ],
      evidence,
    }],
    assets: [{ id: 'hero-image', kind: 'image', sourceUrl: 'https://cdn.test/hero.jpg', evidence }],
    animations: [],
    warnings: [],
  };
}

describe('emitVisualIrToV3', () => {
  it('emits separate classic V3 sections and native widgets', () => {
    const result = emitVisualIrToV3(makeIr());
    const section = result.tree[0]!;
    const widgets = section.elements![0]!.elements!;
    expect(result.tree).toHaveLength(1);
    expect(result.blocked).toBe(false);
    expect(result.canContinue).toBe(true);
    expect(section.elType).toBe('section');
    expect(widgets.map((widget) => widget.widgetType)).toEqual(['heading', 'text-editor', 'button', 'image']);
    expect(widgets[0]!.settings?.header_size).toBe('h1');
    expect(widgets[2]!.settings?.link).toEqual({ url: '/join', is_external: '', nofollow: '' });
    expect((widgets[3]!.settings?.image as { url: string }).url).toBe('https://cdn.test/hero.jpg');
    // P5: Elementor requires the `_mobile` SUFFIX. The prefix form
    // (`mobile_padding`) is stored but never rendered — this assertion used to
    // lock in that bug. See BAUPLAN-v6.0 §11.1.
    // `isLinked` is part of the dimensions shape Elementor itself stores (its
    // own `def` carries `isLinked: true`); `false` is written because the four
    // sides differ here, which is what the editor's link toggle means.
    expect(section.settings?.padding_mobile).toEqual({
      top: 24, right: 16, bottom: 24, left: 16, unit: 'px', isLinked: false,
    });
    expect(section.settings?.mobile_padding).toBeUndefined();
  });

  it('never emits the invalid breakpoint prefix form', () => {
    const result = emitVisualIrToV3(makeIr());
    const report = runV3Guards(result.tree);
    const g4b = report.results.find((item) => item.name === 'G4b:breakpoint-prefix-misuse');
    expect(g4b?.result.passed).toBe(true);
  });

  it('never double-suffixes an override that already names a breakpoint', () => {
    const ir = makeIr();
    ir.sections[0]!.responsiveOverrides = { mobile: { padding_mobile: '24px 16px' } };
    const result = emitVisualIrToV3(ir);
    const keys = Object.keys(result.tree[0]!.settings ?? {});
    expect(keys.some((key) => key.includes('_mobile_mobile'))).toBe(false);
    // `padding_mobile` is a CONTROL id, not a CSS property, so it resolves to
    // nothing and is dropped. The message names the CSS property because that is
    // what the IR is supposed to carry at this boundary.
    expect(result.warnings.some((warning) =>
      warning.startsWith('hero: padding_mobile was dropped')
      && warning.includes('no control for CSS "padding_mobile"'),
    )).toBe(true);
  });

  it('passes V3 guards for native output', () => {
    const result = emitVisualIrToV3(makeIr());
    const report = runV3Guards(result.tree);
    expect(report.results.find((item) => item.name === 'G1:unique-ids')?.result.passed).toBe(true);
    expect(report.results.find((item) => item.name === 'G_NO_V4:no-v4-markers')?.result.passed).toBe(true);
  });

  it('records a blocking decision when a visible image asset cannot be resolved', () => {
    const ir = makeIr();
    ir.assets = [];
    const result = emitVisualIrToV3(ir);
    const decision = result.decisions.find((item) => item.sourceId === 'photo');
    expect(decision?.decision).toBe('unsupported');
    expect(decision?.blocking).toBe(true);
    expect(decision?.approval).toBe('pending');
    expect(result.blocked).toBe(true);
    expect(result.canContinue).toBe(false);
    expect(result.warnings).toContain('photo: image asset could not be resolved');
  });

  it('flattens over-deep wrappers without dropping visible descendants', () => {
    const ir = makeIr();
    ir.sections[0]!.nodes = [{
      sourceId: 'outer',
      role: 'layout',
      children: [{
        sourceId: 'inner',
        role: 'layout',
        children: [{ sourceId: 'kept-title', role: 'heading', tag: 'h2', text: 'Kept', children: [], evidence: ir.sections[0]!.evidence }],
        evidence: ir.sections[0]!.evidence,
      }],
      evidence: ir.sections[0]!.evidence,
    }];
    const result = emitVisualIrToV3(ir, { maxContainerDepth: 0 });
    const columnChildren = result.tree[0]!.elements![0]!.elements!;
    expect(columnChildren.map((element) => element.widgetType)).toEqual(['heading']);
    expect(result.warnings).toContain('outer: container depth 0 reached; wrapper flattened and descendants preserved');
  });

  it('rejects malformed IR before emitting any tree', () => {
    const invalid = { ...makeIr(), sections: [] };
    expect(() => emitVisualIrToV3(invalid)).toThrow('VisualPageIR validation failed');
  });
});

/**
 * Regression suite for the per-widget control resolution.
 *
 * Every case here corresponds to a real `unknown-key` measured against the LIVE
 * Elementor schema of a converted page (724 in total). The offline gate had
 * passed that same tree, so these are not hypotheticals — each one would have
 * made `elementor-set-content` reject the ENTIRE write.
 */
describe('emitVisualIrToV3 control resolution', () => {
  const evidence = { sourceIds: ['source'], methods: ['dom'] as const, confidence: 0.9, warnings: [] };

  function irWith(nodes: VisualNodeIR[], sectionStyles: Record<string, string> = {}): VisualPageIR {
    return {
      schemaVersion: '1.0',
      source: { route: '/', extractionMode: 'hybrid', capturedAt: new Date(0).toISOString(), pageId: 'p' },
      viewportProfiles: [{ label: 'desktop', width: 1440, height: 900 }],
      tokens: { colors: {}, fonts: [], textStyles: {}, spacing: {} },
      sections: [{
        sourceId: 'sec',
        role: 'content',
        layoutArchetype: 'stack',
        bboxByViewport: { desktop: { x: 0, y: 0, width: 1440, height: 400 } },
        styles: sectionStyles,
        nodes,
        evidence,
      }],
      assets: [],
      animations: [],
      warnings: [],
    };
  }

  const leaf = (sourceId: string, styles: Record<string, string>): VisualNodeIR =>
    ({ sourceId, role: 'layout', children: [], styles, evidence });

  function widgetsOf(ir: VisualPageIR): V3Element[] {
    return emitVisualIrToV3(ir).tree[0]!.elements![0]!.elements!;
  }

  it('writes no typography control on a widget that declares none', () => {
    // 75 of the measured errors were typography keys on spacers, 41 on
    // containers. A spacer has no `typography_*` control at all.
    const result = emitVisualIrToV3(irWith([
      leaf('gap', { height: '80px', 'font-size': '16px', 'font-family': 'Inter', color: '#fff' }),
    ]));
    const spacer = result.tree[0]!.elements![0]!.elements![0]!;
    expect(spacer.widgetType).toBe('spacer');
    const keys = Object.keys(spacer.settings ?? {});
    expect(keys.filter((key) => key.startsWith('typography_'))).toEqual([]);
    expect(keys).not.toContain('title_color');
    expect(spacer.settings?.space).toEqual({ size: 80, unit: 'px' });
    // …and it is NOT reported as a loss. Typography on a childless spacer styles
    // nothing, so a warning here would be noise. Measured: 136 such nodes on one
    // page, 570 declarations, zero of them with a text descendant.
    expect(result.warnings.some((w) => w.includes('font-size was dropped'))).toBe(false);
  });

  it('reports an inheritable property as lost when a text descendant relied on it', () => {
    // The distinction the childless-spacer case must not erase: a container that
    // sets a colour its heading does NOT set is a real loss, because the
    // container has no colour control to carry it.
    const result = emitVisualIrToV3(irWith([{
      sourceId: 'wrap',
      role: 'layout',
      styles: { color: '#ff0000', padding: '8px' },
      children: [
        { sourceId: 'inheriting-title', role: 'heading', tag: 'h2', text: 'T', children: [], evidence },
      ],
      evidence,
    }]));
    expect(result.warnings.some((w) =>
      w.startsWith('wrap: color was dropped') && w.includes('__container__ has no control'),
    )).toBe(true);
    expect(result.decisions.some((d) => d.sourceId === 'wrap' && d.capability === 'css-color')).toBe(true);
  });

  it('treats an unexpanded component as text-rendering, since html carries no style control', () => {
    // A component instance that was never expanded becomes an `html` widget, and
    // `html` declares no typography or colour control at all. Judging coverage by
    // role alone would call this "covered" and drop the only styling its text
    // could have had.
    const result = emitVisualIrToV3(irWith([{
      sourceId: 'wrap',
      role: 'layout',
      styles: { 'font-size': '18px' },
      children: [
        { sourceId: 'unexpanded', role: 'component', componentId: 'c1', text: 'Live text', children: [], evidence },
      ],
      evidence,
    }]));
    expect(result.warnings.some((w) => w.startsWith('wrap: font-size was dropped'))).toBe(true);
  });

  it('does not report the container default or a source-internal variable as a loss', () => {
    // 209 `display: flex` declarations and 80 `--framer-prop-*` properties on one
    // page. `container_type` defaults to `flex`, so the former changes nothing;
    // the latter is source plumbing already resolved into the computed styles.
    const result = emitVisualIrToV3(irWith([{
      sourceId: 'wrap',
      role: 'layout',
      styles: { display: 'flex', '--framer-prop-abc': '12px', padding: '8px' },
      children: [{ sourceId: 'child', role: 'heading', tag: 'h3', text: 'T', children: [], evidence }],
      evidence,
    }]));
    expect(result.warnings.some((w) => w.includes('display was dropped'))).toBe(false);
    expect(result.warnings.some((w) => w.includes('--framer-prop-abc'))).toBe(false);
    // `display: grid` is a real change and must keep being reported.
    const grid = emitVisualIrToV3(irWith([{
      sourceId: 'grid-wrap',
      role: 'layout',
      styles: { display: 'grid' },
      children: [{ sourceId: 'gc', role: 'heading', tag: 'h3', text: 'T', children: [], evidence }],
      evidence,
    }]));
    expect(grid.warnings.some((w) => w.includes('display was dropped'))).toBe(true);
  });

  it('maps the container flex group, which was silently dropped entirely', () => {
    // flex_gap / flex_align_items / flex_justify_content are gated on
    // `container_type: ['flex']`, which its own default satisfies — no companion
    // was ever needed, the properties were simply never looked up. 69 `gap`, 81
    // `align-items` and 63 `justify-content` declarations lost on one page.
    const container = widgetsOf(irWith([{
      sourceId: 'row',
      role: 'layout',
      styles: {
        'flex-direction': 'row',
        gap: '24px',
        'align-items': 'center',
        'justify-content': 'space-between',
      },
      children: [{ sourceId: 'rc', role: 'heading', tag: 'h3', text: 'T', children: [], evidence }],
      evidence,
    }]))[0]!;
    expect(container.elType).toBe('container');
    expect(container.settings?.flex_direction).toBe('row');
    expect(container.settings?.flex_gap).toEqual({ column: 24, row: 24, isLinked: true, unit: 'px' });
    expect(container.settings?.flex_align_items).toBe('center');
    expect(container.settings?.flex_justify_content).toBe('space-between');
  });

  it('uses the underscore-prefixed wrapper controls on a widget and the bare ones on a container', () => {
    const ir = irWith([{
      sourceId: 'box',
      role: 'layout',
      styles: { padding: '10px', 'border-radius': '8px', 'background-color': '#111' },
      children: [leaf('inner-title', { padding: '4px', 'border-radius': '2px', 'background-color': '#222' })],
      evidence,
    }]);
    // Give the child text so it becomes a heading rather than a spacer.
    (ir.sections[0]!.nodes[0]! as VisualNodeIR).children[0] = {
      sourceId: 'inner-title', role: 'heading', tag: 'h3', text: 'T', children: [], evidence,
      styles: { padding: '4px', 'border-radius': '2px', 'background-color': '#222' },
    };

    const container = widgetsOf(ir)[0]!;
    expect(container.elType).toBe('container');
    expect(container.settings?.padding).toEqual({ unit: 'px', top: 10, right: 10, bottom: 10, left: 10, isLinked: false });
    expect(container.settings?.border_radius).toBeDefined();
    expect(container.settings?.background_color).toBe('#111');
    expect(container.settings?.background_background).toBe('classic');
    expect(container.settings?._padding).toBeUndefined();

    const heading = container.elements![0]!;
    expect(heading.widgetType).toBe('heading');
    expect(heading.settings?._padding).toEqual({ unit: 'px', top: 4, right: 4, bottom: 4, left: 4, isLinked: false });
    expect(heading.settings?._border_radius).toBeDefined();
    expect(heading.settings?._background_color).toBe('#222');
    expect(heading.settings?._background_background).toBe('classic');
    // The bare forms are what the server rejects on a widget.
    expect(heading.settings?.padding).toBeUndefined();
    expect(heading.settings?.border_radius).toBeUndefined();
    expect(heading.settings?.background_color).toBeUndefined();
  });

  it('maps CSS color onto the control name the widget actually declares', () => {
    const nodes: VisualNodeIR[] = [
      { sourceId: 'h', role: 'heading', tag: 'h2', text: 'H', children: [], styles: { color: '#aaa' }, evidence },
      { sourceId: 't', role: 'text', text: 'T', children: [], styles: { color: '#bbb' }, evidence },
      { sourceId: 'b', role: 'button', text: 'B', href: '/x', children: [], styles: { color: '#ccc' }, evidence },
      { sourceId: 'i', role: 'icon', text: 'fas fa-star', children: [], styles: { color: '#ddd' }, evidence },
    ];
    const [heading, text, button, icon] = widgetsOf(irWith(nodes));
    expect(heading!.settings?.title_color).toBe('#aaa');
    expect(text!.settings?.text_color).toBe('#bbb');
    expect(button!.settings?.button_text_color).toBe('#ccc');
    expect(icon!.settings?.primary_color).toBe('#ddd');
    // The old emitter fell back to `title_color` for anything that was not a
    // button or text node, which no other widget declares.
    expect(text!.settings?.title_color).toBeUndefined();
    expect(icon!.settings?.title_color).toBeUndefined();
  });

  it('never writes image_alt, which is not a control of the image widget', () => {
    const ir = irWith([{ sourceId: 'pic', role: 'image', assetId: 'a', text: 'Alt text', children: [], evidence }]);
    ir.assets = [{ id: 'a', kind: 'image', sourceUrl: 'https://cdn.test/x.jpg', evidence }];
    const result = emitVisualIrToV3(ir);
    const image = result.tree[0]!.elements![0]!.elements![0]!;
    expect(image.widgetType).toBe('image');
    expect(image.settings).not.toHaveProperty('image_alt');
    // The loss is reported, not silently swallowed.
    expect(result.decisions.some((d) => d.sourceId === 'pic' && d.capability === 'image-alt')).toBe(true);
  });

  it('adds the typography companion so a font size actually renders', () => {
    const ir = irWith([
      { sourceId: 'h', role: 'heading', tag: 'h1', text: 'H', children: [], styles: { 'font-size': '48px', 'letter-spacing': '-0.03em' }, evidence },
    ]);
    const heading = widgetsOf(ir)[0]!;
    expect(heading.settings?.typography_typography).toBe('custom');
    expect(heading.settings?.typography_font_size).toEqual({ size: 48, unit: 'px' });
    // Negative em values must survive intact — they are routine in Framer output.
    expect(heading.settings?.typography_letter_spacing).toEqual({ size: -0.03, unit: 'em' });
  });

  it('drops a slider value that is a keyword rather than a length', () => {
    const ir = irWith([
      { sourceId: 'h', role: 'heading', tag: 'h2', text: 'H', children: [], styles: { 'line-height': 'normal' }, evidence },
    ]);
    const result = emitVisualIrToV3(ir);
    const heading = result.tree[0]!.elements![0]!.elements![0]!;
    expect(heading.settings?.typography_line_height).toBeUndefined();
    expect(result.warnings.some((w) => w.includes('line-height was dropped'))).toBe(true);
  });

  it('renames CSS text-align values the align control does not accept', () => {
    const ir = irWith([
      { sourceId: 'h', role: 'heading', tag: 'h2', text: 'H', children: [], styles: { 'text-align': 'left' }, evidence },
      { sourceId: 'h2', role: 'heading', tag: 'h2', text: 'H', children: [], styles: { 'text-align': 'right' }, evidence },
    ]);
    const [first, second] = widgetsOf(ir);
    // `align` declares opts ["start","center","end","justify"] — `left` is not one.
    expect(first!.settings?.align).toBe('start');
    expect(second!.settings?.align).toBe('end');
  });

  it('does not turn a plain divider into a line-with-text to apply a font size', () => {
    const result = emitVisualIrToV3(irWith([
      leaf('rule', { height: '1px', width: '190px', 'background-color': '#333', 'font-size': '14px' }),
    ]));
    const divider = result.tree[0]!.elements![0]!.elements![0]!;
    expect(divider.widgetType).toBe('divider');
    expect(divider.settings?.color).toBe('#333');
    expect(divider.settings?.weight).toEqual({ size: 1, unit: 'px' });
    // `look` selects what the divider RENDERS; satisfying it for a textless
    // divider would render a broken line-with-text.
    expect(divider.settings?.look).toBeUndefined();
    expect(divider.settings?.typography_font_size).toBeUndefined();
    // The wrapper background must not be painted instead of the rule.
    expect(divider.settings?._background_color).toBeUndefined();
  });

  it('produces a tree with no unknown key against the committed control snapshot', () => {
    // The end-to-end assertion: the gate, run non-degraded against the real
    // snapshot, must find zero errors. This is the check that would have caught
    // all 724.
    const ir = irWith([
      { sourceId: 'h', role: 'heading', tag: 'h1', text: 'H', children: [], styles: { color: '#fff', 'font-size': '40px', padding: '8px', 'text-align': 'left' }, evidence },
      { sourceId: 't', role: 'text', text: 'T', children: [], styles: { color: '#ccc', 'line-height': '1.5em', margin: '4px 8px' }, evidence },
      { sourceId: 'b', role: 'button', text: 'B', href: '/x', children: [], styles: { color: '#000', 'background-color': '#fff', 'border-radius': '6px' }, evidence },
      leaf('gap', { height: '60px', 'font-size': '12px' }),
      leaf('rule', { height: '1px', 'background-color': '#444' }),
      {
        sourceId: 'wrap',
        role: 'layout',
        styles: { padding: '20px', 'background-color': '#101010', 'flex-direction': 'row' },
        children: [{ sourceId: 'nested', role: 'heading', tag: 'h3', text: 'N', children: [], styles: { color: '#eee' }, evidence }],
        evidence,
      },
    ], { padding: '40px 24px', 'background-color': '#000' });

    const result = emitVisualIrToV3(ir);
    const snapshot = loadWidgetSchemaFromSnapshot(SNAPSHOT_WIDGET_TYPES);
    const report = validateSettingsAgainstSchema(result.tree, snapshot.schema, { degraded: false });
    const errors = report.violations.filter((violation) => violation.severity === 'error');
    expect(errors.map((violation) => `${violation.widgetType}.${violation.key}: ${violation.kind}`)).toEqual([]);
    expect(report.ok).toBe(true);
  });
});

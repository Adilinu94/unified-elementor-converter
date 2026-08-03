import { describe, expect, it } from 'vitest';
import { emitVisualIrToV3, runV3Guards, type VisualPageIR } from '@elconv/target-v3';

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
    expect(section.settings?.mobile_padding).toEqual({ top: 24, right: 16, bottom: 24, left: 16, unit: 'px' });
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

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

  it('maps an adopted overlay section onto Elementor positioning controls', () => {
    const ir = makeIr();
    ir.sections[0]!.styles = {
      ...ir.sections[0]!.styles,
      position: 'absolute',
      'z-index': '10',
    };
    const result = emitVisualIrToV3(ir);

    expect(result.tree[0]!.settings?.position).toBe('absolute');
    // Elementor's number control stores a number; the string form is a
    // `wrong-shape` schema-gate error.
    expect(result.tree[0]!.settings?.z_index).toBe(10);
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

  it('emits no image widget for a data URI WordPress cannot serve', () => {
    // `esc_url()` returns an EMPTY string for the `data:` scheme because `data`
    // is absent from `wp_allowed_protocols()` (verified live). Written into an
    // `image` control it renders `<img src="">` — a BROKEN image, not a missing
    // one, which on the deployed page made `elconv qa` refuse to score the whole
    // page ("1 scored image(s) failed").
    const ir = makeIr();
    const evidence = ir.sections[0]!.evidence;
    ir.assets = [{
      id: 'inline-svg',
      kind: 'svg',
      sourceUrl: 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg"/>',
      evidence,
    }];
    ir.sections[0]!.nodes = [
      { sourceId: 'icon', role: 'image', assetId: 'inline-svg', children: [], evidence },
      { sourceId: 'keep', role: 'text', text: 'Still here', children: [], evidence },
    ];

    const result = emitVisualIrToV3(ir);
    const widgets = result.tree[0]!.elements![0]!.elements!;

    // The unservable image is gone; everything else still emits.
    expect(widgets.map((widget) => widget.widgetType)).toEqual(['text-editor']);
    expect(result.decisions.some(
      (item) => item.sourceId === 'icon' && item.capability === 'media-url-unservable',
    )).toBe(true);
    expect(result.warnings.some((warning) => warning.includes('wp_allowed_protocols'))).toBe(true);
    // Reported, not fatal: one unservable decorative asset must not refuse a
    // build whose other 34 images are fine.
    expect(result.canContinue).toBe(true);
  });

  it('omits a container background whose URL cannot be served', () => {
    // Same rule one level up. A `background_image` with an empty url fails its
    // own `background_image[url]!` gate, so the companions would be stored and
    // never rendered — dead settings with a misleading read-back.
    const ir = makeIr();
    const evidence = ir.sections[0]!.evidence;
    ir.assets = [{
      id: 'inline-svg',
      kind: 'svg',
      sourceUrl: 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg"/>',
      evidence,
    }];
    ir.sections[0]!.nodes = [{
      sourceId: 'card',
      role: 'layout',
      assetId: 'inline-svg',
      children: [{ sourceId: 'label', role: 'text', text: 'Intro', children: [], evidence }],
      evidence,
    }];

    const result = emitVisualIrToV3(ir);
    const container = result.tree[0]!.elements![0]!.elements![0]!;

    expect(container.elType).toBe('container');
    expect(container.settings).not.toHaveProperty('background_image');
    expect(container.settings).not.toHaveProperty('background_position');
    expect(container.settings).not.toHaveProperty('background_size');
    // The children survive regardless.
    expect(container.elements?.map((child) => child.widgetType)).toEqual(['text-editor']);
  });

  it('rejects malformed IR before emitting any tree', () => {
    const invalid = { ...makeIr(), sections: [] };
    expect(() => emitVisualIrToV3(invalid)).toThrow('VisualPageIR validation failed');
  });

  it('writes a container background_image for a media node that has children', () => {
    // Such a node cannot become an image widget — that widget emits no children,
    // so the subtree would be discarded. Measured on the captured Humeen page:
    // 17 named nodes carry media AND authored children, and 6 image URLs are
    // reachable ONLY through one of them. Framer renders that shape as an
    // object-fit:cover image behind the content (101 of 107 `<img>`), which is
    // Elementor's `background_image` + `background_size: cover`.
    const ir = makeIr();
    const evidence = ir.sections[0]!.evidence;
    ir.sections[0]!.nodes = [{
      sourceId: 'card',
      role: 'layout',
      assetId: 'hero-image',
      children: [{ sourceId: 'label', role: 'text', text: 'Intro', children: [], evidence }],
      evidence,
    }];

    const result = emitVisualIrToV3(ir);
    const container = result.tree[0]!.elements![0]!.elements![0]!;

    expect(container.elType).toBe('container');
    expect(container.settings?.background_image).toEqual({ url: 'https://cdn.test/hero.jpg', id: '' });
    // The companions are mandatory: `background_image` is gated on
    // `background_background: ['classic']`, and position/size additionally on
    // `background_image[url]! : ''`. Without them the value is stored and never
    // rendered.
    expect(container.settings?.background_background).toBe('classic');
    expect(container.settings?.background_position).toBe('center center');
    expect(container.settings?.background_size).toBe('cover');
    // The children survive — that is the entire point of not emitting an image.
    expect(container.elements?.map((child) => child.widgetType)).toEqual(['text-editor']);
    expect(result.decisions.some(
      (item) => item.sourceId === 'card' && item.capability === 'container-background-image',
    )).toBe(true);
  });

  it('blocks when a container background asset cannot be resolved', () => {
    // Same honesty rule as the image widget: an unresolvable asset is a visible
    // loss, not something to write as an empty URL.
    const ir = makeIr();
    const evidence = ir.sections[0]!.evidence;
    ir.assets = [];
    ir.sections[0]!.nodes = [{
      sourceId: 'card',
      role: 'layout',
      assetId: 'hero-image',
      children: [{ sourceId: 'label', role: 'text', text: 'Intro', children: [], evidence }],
      evidence,
    }];

    const result = emitVisualIrToV3(ir);
    const container = result.tree[0]!.elements![0]!.elements![0]!;

    expect(container.settings?.background_image).toBeUndefined();
    expect(result.warnings).toContain('card: background asset could not be resolved');
    expect(result.blocked).toBe(true);
  });

  it('sizes an image from its measured box, since an external URL has no attachment', () => {
    // An external URL has no WordPress attachment, so Elementor emits a bare
    // `<img src>` with no width/height attributes and no intrinsic ratio for the
    // layout to reserve. Measured on the deployed page: 18 of 35 images computed
    // to 0x0 with `naturalWidth: 1507` and HTTP 200 — fully loaded, no box.
    // Total rendered image height was 5646px against the source's 29792px.
    const ir = makeIr();
    const evidence = ir.sections[0]!.evidence;
    ir.sections[0]!.nodes = [{
      sourceId: 'photo',
      role: 'image',
      assetId: 'hero-image',
      bboxByViewport: { desktop: { x: 0, y: 0, width: 706, height: 936 } },
      children: [],
      evidence,
    }];

    const result = emitVisualIrToV3(ir);
    const image = result.tree[0]!.elements![0]!.elements![0]!;

    expect(image.widgetType).toBe('image');
    expect(image.settings?.width).toEqual({ unit: 'px', size: 706 });
    expect(image.settings?.height).toEqual({ unit: 'px', size: 936 });
    // `object-fit` is gated on `height[size]! : ''`, so it may only be written
    // together with a height. `cover` is what Framer renders (85 of 108 imgs).
    expect(image.settings?.['object-fit']).toBe('cover');
    expect(result.decisions.some(
      (item) => item.sourceId === 'photo' && item.capability === 'image-measured-box',
    )).toBe(true);
  });

  it('sizes an image per viewport, not once for all of them', () => {
    // The desktop box applied unsuffixed survives into the mobile layout, where
    // the width collapses to the viewport but the pixel height does not —
    // measured as a 23 % taller page than the source. Each measured viewport
    // therefore writes its own suffixed control.
    const ir = makeIr();
    const evidence = ir.sections[0]!.evidence;
    ir.sections[0]!.nodes = [{
      sourceId: 'photo',
      role: 'image',
      assetId: 'hero-image',
      bboxByViewport: {
        desktop: { x: 0, y: 0, width: 706, height: 936 },
        mobile: { x: 0, y: 0, width: 358, height: 474 },
      },
      children: [],
      evidence,
    }];

    const result = emitVisualIrToV3(ir);
    const image = result.tree[0]!.elements![0]!.elements![0]!;

    expect(image.settings?.width).toEqual({ unit: 'px', size: 706 });
    expect(image.settings?.height).toEqual({ unit: 'px', size: 936 });
    expect(image.settings?.width_mobile).toEqual({ unit: 'px', size: 358 });
    expect(image.settings?.height_mobile).toEqual({ unit: 'px', size: 474 });
    expect(image.settings?.['object-fit_mobile']).toBe('cover');
    // Nothing is invented for a viewport that was never measured.
    expect(image.settings).not.toHaveProperty('width_tablet');
    expect(image.settings).not.toHaveProperty('height_tablet');
  });

  it('skips a measured box whose viewport label is not an Elementor breakpoint', () => {
    // A `_widescreen`-style label would produce `width_widescreen`, which is not
    // a control — the gate rejects the whole write. Reported, not written.
    const ir = makeIr();
    const evidence = ir.sections[0]!.evidence;
    ir.sections[0]!.nodes = [{
      sourceId: 'photo',
      role: 'image',
      assetId: 'hero-image',
      bboxByViewport: {
        desktop: { x: 0, y: 0, width: 706, height: 936 },
        ultrawide: { x: 0, y: 0, width: 1600, height: 900 },
      },
      children: [],
      evidence,
    }];

    const result = emitVisualIrToV3(ir);
    const image = result.tree[0]!.elements![0]!.elements![0]!;

    expect(image.settings?.width).toEqual({ unit: 'px', size: 706 });
    expect(image.settings).not.toHaveProperty('width_ultrawide');
    expect(result.warnings.some((warning) => warning.includes('"ultrawide"'))).toBe(true);
  });

  it('offsets an absolutely positioned container by its measured distance', () => {
    // `position: absolute` alone is not a position. Render-verified on Elementor
    // 4.2.1: written with no offsets the box lands at `left: 0px; top: 0px` —
    // the parent's corner, not the static position it kept in flow. The
    // containing block is the emitted container, because every `.e-con` is
    // `position: relative` (`--position: relative` in frontend.min.css).
    const ir = makeIr();
    const evidence = ir.sections[0]!.evidence;
    ir.sections[0]!.nodes = [{
      sourceId: 'card',
      role: 'layout',
      bboxByViewport: { desktop: { x: 100, y: 200, width: 400, height: 300 } },
      children: [{
        sourceId: 'badge',
        role: 'layout',
        styles: { position: 'absolute' },
        bboxByViewport: { desktop: { x: 242, y: 295, width: 80, height: 40 } },
        children: [{ sourceId: 'badge-text', role: 'text', text: 'New', children: [], evidence }],
        evidence,
      }],
      evidence,
    }];

    const result = emitVisualIrToV3(ir);
    const card = result.tree[0]!.elements![0]!.elements![0]!;
    const badge = card.elements![0]!;

    expect(badge.settings?.position).toBe('absolute');
    expect(badge.settings?._offset_x).toEqual({ unit: 'px', size: 142 });
    expect(badge.settings?._offset_y).toEqual({ unit: 'px', size: 95 });
    expect(result.decisions.some(
      (item) => item.sourceId === 'badge' && item.capability === 'absolute-position-offset'
        && item.decision === 'native',
    )).toBe(true);
  });

  it('writes no offset for an absolute element that really sits at the corner', () => {
    // 0/0 is what Elementor already renders, so writing it asserts nothing.
    // Measured on the emitted tree of precious-board-067119: 6 of the 12
    // absolute elements are genuinely at 0/0.
    const ir = makeIr();
    const evidence = ir.sections[0]!.evidence;
    ir.sections[0]!.nodes = [{
      sourceId: 'card',
      role: 'layout',
      bboxByViewport: { desktop: { x: 100, y: 200, width: 400, height: 300 } },
      children: [{
        sourceId: 'overlay',
        role: 'layout',
        styles: { position: 'absolute' },
        bboxByViewport: { desktop: { x: 100, y: 200, width: 400, height: 300 } },
        children: [{ sourceId: 'overlay-text', role: 'text', text: 'On top', children: [], evidence }],
        evidence,
      }],
      evidence,
    }];

    const result = emitVisualIrToV3(ir);
    const overlay = result.tree[0]!.elements![0]!.elements![0]!.elements![0]!;

    expect(overlay.settings?.position).toBe('absolute');
    expect(overlay.settings).not.toHaveProperty('_offset_x');
    expect(overlay.settings).not.toHaveProperty('_offset_y');
  });

  it('reports an absolute element whose containing block was never measured', () => {
    // A top-level node sits inside the section COLUMN, whose box the capture
    // never measures. Its offset is unknown, not zero — and Elementor will put
    // it in the corner, which is exactly what has to be reported.
    const ir = makeIr();
    const evidence = ir.sections[0]!.evidence;
    ir.sections[0]!.nodes = [{
      sourceId: 'floater',
      role: 'layout',
      styles: { position: 'absolute' },
      bboxByViewport: { desktop: { x: 300, y: 400, width: 200, height: 100 } },
      children: [{ sourceId: 'floater-text', role: 'text', text: 'Floating', children: [], evidence }],
      evidence,
    }];

    const result = emitVisualIrToV3(ir);
    const floater = result.tree[0]!.elements![0]!.elements![0]!;

    expect(floater.settings?.position).toBe('absolute');
    expect(floater.settings).not.toHaveProperty('_offset_x');
    expect(result.warnings.some((warning) => warning.startsWith('floater: is absolutely positioned'))).toBe(true);
    expect(result.decisions.some(
      (item) => item.sourceId === 'floater' && item.capability === 'absolute-position-offset'
        && item.decision === 'static-approximation',
    )).toBe(true);
  });

  it('reports a fixed element instead of offsetting it against its parent', () => {
    // `fixed` resolves against the VIEWPORT, so the parent box is the wrong
    // reference and the offset cannot be derived from this pair at all.
    const ir = makeIr();
    const evidence = ir.sections[0]!.evidence;
    ir.sections[0]!.nodes = [{
      sourceId: 'card',
      role: 'layout',
      bboxByViewport: { desktop: { x: 100, y: 200, width: 400, height: 300 } },
      children: [{
        sourceId: 'bar',
        role: 'layout',
        styles: { position: 'fixed' },
        bboxByViewport: { desktop: { x: 0, y: 0, width: 1440, height: 60 } },
        children: [{ sourceId: 'bar-text', role: 'text', text: 'Sticky bar', children: [], evidence }],
        evidence,
      }],
      evidence,
    }];

    const result = emitVisualIrToV3(ir);
    const bar = result.tree[0]!.elements![0]!.elements![0]!.elements![0]!;

    expect(bar.settings?.position).toBe('fixed');
    expect(bar.settings).not.toHaveProperty('_offset_x');
    expect(result.warnings.some((warning) => warning.includes('position "fixed" resolves against the viewport'))).toBe(true);
  });

  it('measures the offset against the surviving container, not a flattened wrapper', () => {
    // A wrapper past the depth cap emits NO element, so the nearest emitted
    // container is still the one above it. Measuring against the flattened box
    // would reference an element that does not exist in the tree.
    //
    // The badge carries an asset, which is what lets it survive the cap that
    // flattened its parent — otherwise every node below a flattened wrapper is
    // flattened too and no container could sit there at all.
    const ir = makeIr();
    const evidence = ir.sections[0]!.evidence;
    const leaf: VisualNodeIR = {
      sourceId: 'badge',
      role: 'layout',
      assetId: 'hero-image',
      styles: { position: 'absolute' },
      bboxByViewport: { desktop: { x: 150, y: 250, width: 80, height: 40 } },
      children: [{ sourceId: 'badge-text', role: 'text', text: 'New', children: [], evidence }],
      evidence,
    };
    ir.sections[0]!.nodes = [{
      sourceId: 'keeper',
      role: 'layout',
      bboxByViewport: { desktop: { x: 100, y: 200, width: 400, height: 300 } },
      children: [{
        sourceId: 'flattened',
        role: 'layout',
        bboxByViewport: { desktop: { x: 120, y: 220, width: 360, height: 260 } },
        children: [leaf],
        evidence,
      }],
      evidence,
    }];

    // Cap of 1: `keeper` is emitted at depth 0, `flattened` hits the cap.
    const result = emitVisualIrToV3(ir, { maxContainerDepth: 1 });
    const keeper = result.tree[0]!.elements![0]!.elements![0]!;
    const badge = keeper.elements![0]!;

    expect(badge.settings?.position).toBe('absolute');
    // Against `keeper` (100/200) → 50/50. Against the flattened wrapper
    // (120/220) it would have been 30/30.
    expect(badge.settings?._offset_x).toEqual({ unit: 'px', size: 50 });
    expect(badge.settings?._offset_y).toEqual({ unit: 'px', size: 50 });
  });

  it('offsets per viewport where both boxes were measured', () => {
    // `_offset_x` / `_offset_y` are both `add_responsive_control` (live-read
    // from container.php), so a narrower viewport carries its own distance.
    const ir = makeIr();
    const evidence = ir.sections[0]!.evidence;
    ir.sections[0]!.nodes = [{
      sourceId: 'card',
      role: 'layout',
      bboxByViewport: {
        desktop: { x: 100, y: 200, width: 400, height: 300 },
        mobile: { x: 10, y: 150, width: 370, height: 260 },
      },
      children: [{
        sourceId: 'badge',
        role: 'layout',
        styles: { position: 'absolute' },
        bboxByViewport: {
          desktop: { x: 242, y: 295, width: 80, height: 40 },
          mobile: { x: 30, y: 170, width: 80, height: 40 },
        },
        children: [{ sourceId: 'badge-text', role: 'text', text: 'New', children: [], evidence }],
        evidence,
      }],
      evidence,
    }];

    const result = emitVisualIrToV3(ir);
    const badge = result.tree[0]!.elements![0]!.elements![0]!.elements![0]!;

    expect(badge.settings?._offset_x).toEqual({ unit: 'px', size: 142 });
    expect(badge.settings?._offset_x_mobile).toEqual({ unit: 'px', size: 20 });
    expect(badge.settings?._offset_y_mobile).toEqual({ unit: 'px', size: 20 });
    // Nothing for a viewport that was never measured.
    expect(badge.settings).not.toHaveProperty('_offset_x_tablet');
  });

  it('writes no image box where nothing was measured', () => {
    // A fabricated size is worse than none: without a box Elementor keeps the
    // image at its natural ratio, which is at least not a wrong assertion.
    const ir = makeIr();
    const evidence = ir.sections[0]!.evidence;
    ir.sections[0]!.nodes = [
      { sourceId: 'no-box', role: 'image', assetId: 'hero-image', children: [], evidence },
      {
        sourceId: 'zero-box',
        role: 'image',
        assetId: 'hero-image',
        bboxByViewport: { desktop: { x: 0, y: 0, width: 0, height: 0 } },
        children: [],
        evidence,
      },
    ];

    const result = emitVisualIrToV3(ir);
    const widgets = result.tree[0]!.elements![0]!.elements!;

    for (const widget of widgets) {
      expect(widget.widgetType).toBe('image');
      expect(widget.settings).not.toHaveProperty('width');
      expect(widget.settings).not.toHaveProperty('height');
      expect(widget.settings).not.toHaveProperty('object-fit');
    }
  });

  it('writes overflow hidden for a clipped container', () => {
    // The measured page-break: an 11-card Ticker row at 1000px per card in a
    // `nowrap` row renders the page 11340px wide, because the source clips it
    // two levels up (`Container` and `Integrations Section`, both
    // `overflow: clip`) and the clone had no clipping at all.
    const ir = makeIr();
    const evidence = ir.sections[0]!.evidence;
    const child = { sourceId: 'label', role: 'text', text: 'Intro', children: [], evidence } as const;
    ir.sections[0]!.nodes = [{
      sourceId: 'mask',
      role: 'layout',
      styles: { overflow: 'clip' },
      children: [{ ...child }],
      evidence,
    }];

    const result = emitVisualIrToV3(ir);
    const container = result.tree[0]!.elements![0]!.elements![0]!;

    expect(container.elType).toBe('container');
    expect(container.settings?.overflow).toBe('hidden');
    // `clip` is not an allowed value of the control, so the approximation is
    // recorded rather than written verbatim (which the gate would reject).
    const decision = result.decisions.find(
      (item) => item.sourceId === 'mask' && item.capability === 'container-overflow',
    );
    expect(decision?.decision).toBe('static-approximation');
  });

  it('passes overflow hidden through and omits what the control cannot express', () => {
    const ir = makeIr();
    const evidence = ir.sections[0]!.evidence;
    const layout = (sourceId: string, styles: Record<string, string>) => ({
      sourceId,
      role: 'layout',
      styles,
      children: [{ sourceId: `${sourceId}-t`, role: 'text', text: 'T', children: [], evidence }],
      evidence,
    });
    ir.sections[0]!.nodes = [
      layout('a', { overflow: 'hidden' }),
      layout('b', { overflow: 'visible' }),
      layout('c', { overflow: 'scroll' }),
      layout('d', { overflow: 'hidden visible' }),
    ];

    const result = emitVisualIrToV3(ir);
    const containers = result.tree[0]!.elements![0]!.elements!;
    const byId = new Map(containers.map((element) => [element.id, element]));

    expect(byId.get('ir_a')?.settings?.overflow).toBe('hidden');
    const nativeDecision = result.decisions.find(
      (item) => item.sourceId === 'a' && item.capability === 'container-overflow',
    );
    expect(nativeDecision?.decision).toBe('native');

    // `visible` is the default: no setting, no overflow decision, no warning.
    expect(byId.get('ir_b')?.settings).not.toHaveProperty('overflow');
    expect(result.decisions.some(
      (item) => item.sourceId === 'b' && item.capability === 'container-overflow',
    )).toBe(false);

    // `scroll` is not an allowed value — omitted and reported, never coerced
    // into `auto` (which would hide scrollbars the source shows).
    expect(byId.get('ir_c')?.settings).not.toHaveProperty('overflow');
    expect(result.decisions.find(
      (item) => item.sourceId === 'c' && item.capability === 'container-overflow',
    )?.decision).toBe('unsupported');

    // A mixed pair cannot be expressed with the single-axis control.
    // Measured: zero occurrences on the page, so this branch is honest dead
    // code with a report rather than a guess.
    expect(byId.get('ir_d')?.settings).not.toHaveProperty('overflow');
    expect(result.decisions.find(
      (item) => item.sourceId === 'd' && item.capability === 'container-overflow',
    )?.decision).toBe('unsupported');
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

  it('omits flex_direction when the capture measured none, rather than guessing column', () => {
    // Elementor's container stylesheet already sets
    // `.e-con.e-flex { --flex-direction: column }`, so omitting the key is the
    // same outcome for a genuine column. Writing `column` on every layout node
    // was a fabrication wherever the capture had no measurement — measured on
    // precious-board-067119 as 72 forced columns against 188 rendered rows.
    const container = widgetsOf(irWith([{
      sourceId: 'nodir',
      role: 'layout',
      styles: { padding: '20px' },
      children: [{ sourceId: 'nc', role: 'heading', tag: 'h3', text: 'T', children: [], evidence }],
      evidence,
    }]))[0]!;
    expect(container.elType).toBe('container');
    expect(container.settings).not.toHaveProperty('flex_direction');
  });

  it('sizes a spacer from its measured box when the source set no CSS height', () => {
    // Framer sizes these nodes by flex layout, not by an explicit `height`, so
    // `styles.height` is absent on nearly all of them. Without the measured box
    // every one collapsed to Elementor's 50px default — measured on
    // precious-board-067119 as 142 nodes, and the Statement section alone lost
    // 2244px of 3690px.
    const spacer = widgetsOf(irWith([{
      sourceId: 'widget-1',
      role: 'unknown',
      children: [],
      bboxByViewport: { desktop: { x: 0, y: 0, width: 1200, height: 180 } },
      evidence,
    }]))[0]!;
    expect(spacer.widgetType).toBe('spacer');
    expect(spacer.settings?.space).toEqual({ unit: 'px', size: 180 });
  });

  it('prefers a declared CSS height over the measured box', () => {
    // A declared height is the author's instruction; the box is only evidence of
    // what it produced. When both exist the instruction wins.
    const spacer = widgetsOf(irWith([{
      sourceId: 'declared',
      role: 'unknown',
      children: [],
      styles: { height: '32px' },
      bboxByViewport: { desktop: { x: 0, y: 0, width: 1200, height: 180 } },
      evidence,
    }]))[0]!;
    expect(spacer.settings?.space).toEqual({ unit: 'px', size: 32 });
  });

  it('writes no space for a zero-height box rather than asserting 0px', () => {
    // A spacer occupying no space is a node the source did not render. Writing
    // `space: 0` would claim something the measurement does not support.
    const spacer = widgetsOf(irWith([{
      sourceId: 'invisible',
      role: 'unknown',
      children: [],
      bboxByViewport: { desktop: { x: 0, y: 0, width: 1200, height: 0 } },
      evidence,
    }]))[0]!;
    expect(spacer.widgetType).toBe('spacer');
    expect(spacer.settings).not.toHaveProperty('space');
  });

  it('takes the widest viewport box, which is what an unsuffixed setting describes', () => {
    // The narrower viewports arrive as `_tablet` / `_mobile` overrides; taking a
    // mobile height for the base setting would ship the phone layout to desktop.
    const spacer = widgetsOf(irWith([{
      sourceId: 'multi',
      role: 'unknown',
      children: [],
      bboxByViewport: {
        mobile: { x: 0, y: 0, width: 390, height: 60 },
        desktop: { x: 0, y: 0, width: 1200, height: 200 },
      },
      evidence,
    }]))[0]!;
    expect(spacer.settings?.space).toEqual({ unit: 'px', size: 200 });
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

  it('sizes a flex child from the measured grow/shrink pair, not from the box', () => {
    // Framer has no width control on a flex child — it states `flex: 1 0 0px`
    // (fill) or leaves `0 0 auto` (hug), and Elementor's `_flex_size` carries the
    // same pair natively. Measured on precious-board-067119: without this, all 36
    // fill children rendered at content width, and hug children were exposed to
    // their parent's made-up share (column containers default their widgets to
    // `width: 100%`).
    const [fill, hug, custom] = widgetsOf(irWith([
      { sourceId: 'fill', role: 'heading', tag: 'h3', text: 'F', children: [], styles: { 'flex-grow': '1', 'flex-shrink': '0' }, evidence },
      { sourceId: 'hug', role: 'heading', tag: 'h3', text: 'H', children: [], styles: { 'flex-grow': '0', 'flex-shrink': '0' }, evidence },
      { sourceId: 'wide', role: 'heading', tag: 'h3', text: 'W', children: [], styles: { 'flex-grow': '3', 'flex-shrink': '0' }, evidence },
    ]));
    expect(fill!.settings?._flex_size).toBe('grow');
    expect(hug!.settings?._flex_size).toBe('none');
    // `_flex_size: 'grow'` means `--flex-shrink: 0` via the selectors
    // dictionary, so there is no second key to assert; a `custom` pair needs
    // both numbers AND the enabler that unlocks them.
    expect(custom!.settings?._flex_size).toBe('custom');
    expect(custom!.settings?._flex_grow).toBe(3);
    expect(custom!.settings?._flex_shrink).toBe(0);
  });

  it('emits no flex sizing when only one axis was measured', () => {
    // Every `_flex_size` option fixes BOTH `--flex-grow` and `--flex-shrink`, so a
    // lone `flex-grow` cannot pick one — assuming the other axis is its CSS
    // initial would state an instruction the source never gave.
    const [lonely] = widgetsOf(irWith([
      { sourceId: 'lonely', role: 'heading', tag: 'h3', text: 'L', children: [], styles: { 'flex-grow': '1' }, evidence },
    ]));
    expect(lonely!.settings?._flex_size).toBeUndefined();
    expect(lonely!.settings?._flex_grow).toBeUndefined();
    expect(lonely!.settings?._flex_shrink).toBeUndefined();
  });

  it('writes no flex sizing on a section, which is never a flex item', () => {
    // A section renders at the root of the document (and the column wrapper
    // beside it is classic, not flex), so the pair has no layout to act in. The
    // generic path would report it as a dropped `no-control` loss on every one
    // of the page's sections — noise that buries the genuine gaps.
    const result = emitVisualIrToV3(
      irWith([], {}),
    );
    const sections = result.tree.map((element) => element.settings ?? {});
    expect(sections.every((settings) => settings._flex_size === undefined)).toBe(true);
    expect(result.warnings.some((w) => w.includes('flex sizing was dropped'))).toBe(false);
  });

  it('carries a flex-sizing override at the valid breakpoint suffix', () => {
    // `_flex_size` declares `r: 1`, so `_tablet` / `_mobile` are legal controls
    // and the override must not be dropped. Only one node of the measured page
    // needed it, but legality is decided by the schema, not by frequency.
    const ir = irWith([
      { sourceId: 'flexy', role: 'heading', tag: 'h3', text: 'F', children: [], styles: { 'flex-grow': '0', 'flex-shrink': '0' }, evidence },
    ]);
    ir.sections[0]!.nodes[0]!.responsiveOverrides = { mobile: { 'flex-grow': '1', 'flex-shrink': '0' } };
    const [flexy] = widgetsOf(ir);
    expect(flexy!.settings?._flex_size).toBe('none');
    expect(flexy!.settings?._flex_size_mobile).toBe('grow');
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
      {
        // A media container: covers background_image and its three companions,
        // which are the keys most likely to be rejected as unknown.
        sourceId: 'media-wrap',
        role: 'layout',
        assetId: 'bg-1',
        styles: { padding: '12px' },
        children: [{ sourceId: 'caption', role: 'text', text: 'C', children: [], evidence }],
        evidence,
      },
    ], { padding: '40px 24px', 'background-color': '#000' });
    ir.assets = [{ id: 'bg-1', kind: 'image', sourceUrl: 'https://cdn.test/bg.webp', evidence }];

    const result = emitVisualIrToV3(ir);
    const snapshot = loadWidgetSchemaFromSnapshot(SNAPSHOT_WIDGET_TYPES);
    const report = validateSettingsAgainstSchema(result.tree, snapshot.schema, { degraded: false });
    const errors = report.violations.filter((violation) => violation.severity === 'error');
    expect(errors.map((violation) => `${violation.widgetType}.${violation.key}: ${violation.kind}`)).toEqual([]);
    expect(report.ok).toBe(true);
  });
});

import { describe, it, expect } from 'vitest';
import { autoTextEditor, convertFramerTree, framerXmlToV3, type FramerNode } from '@elconv/target-v3';

function fnode(id: string, type: FramerNode['type'], name: string, props: Record<string, unknown> = {}, children: FramerNode[] = []): FramerNode {
  return { id, type, name, props, children };
}

describe('convertFramerTree — node-type inference', () => {
  it('converts a large-font text node to a heading widget', () => {
    const result = convertFramerTree([fnode('a', 'text', 'Title', { fontSize: 40, text: 'Hi' })]);
    expect(result.elements[0]!.widgetType).toBe('heading');
    expect(result.elements[0]!.settings.title).toBe('Hi');
  });

  it('converts a small-font text node to a text-editor widget', () => {
    const result = convertFramerTree([fnode('a', 'text', 'Body', { fontSize: 14 })]);
    expect(result.elements[0]!.widgetType).toBe('text-editor');
  });

  it('converts an image node to an image widget with its src', () => {
    const result = convertFramerTree([fnode('a', 'image', 'Photo', { src: 'https://x/img.png' })]);
    expect(result.elements[0]).toMatchObject({ widgetType: 'image' });
    expect((result.elements[0]!.settings.image as { url: string }).url).toBe('https://x/img.png');
  });

  it('converts a name containing "button"/"btn"/"cta" to a button widget even with no children', () => {
    for (const name of ['Buy Button', 'submit-btn', 'Signup CTA']) {
      const result = convertFramerTree([fnode('a', 'frame', name, { text: 'Click', href: '/go' })]);
      expect(result.elements[0]!.widgetType).toBe('button');
    }
  });

  it('a name matching BOTH a section pattern and a button pattern resolves as a section (known heuristic collision)', () => {
    // "Hero CTA" contains both 'hero' (section pattern) and 'cta' (button
    // pattern) — isSectionNode is checked first, so section wins. Documented
    // as a real limitation, not fixed: correctly disambiguating "this is a
    // hero section with a CTA in it" from "this is a CTA styled as a hero"
    // needs more than name-substring matching.
    const result = convertFramerTree([fnode('a', 'frame', 'Hero CTA', { text: 'Click' })]);
    expect(result.elements[0]!.elType).toBe('section');
  });

  it('a childless, non-button frame becomes a spacer (documented behavior — see settings-mapping note below)', () => {
    const result = convertFramerTree([fnode('a', 'frame', 'Divider', { height: 40 })]);
    expect(result.elements[0]!.widgetType).toBe('spacer');
    expect((result.elements[0]!.settings.space as { size: number }).size).toBe(40);
  });

  it('converts a code node to an html widget', () => {
    const result = convertFramerTree([fnode('a', 'code', 'Embed', {})]);
    expect(result.elements[0]!.widgetType).toBe('html');
  });

  it('decodes XML entities in text and attributes', () => {
    const result = framerXmlToV3(
      '<button id="cta" text="Read &amp; Learn" href="/docs?a=1&amp;b=2">Body &lt;copy&gt;</button>',
    );
    expect(result[0]!.widgetType).toBe('button');
    expect(result[0]!.settings.text).toBe('Read & Learn Body <copy>');
    expect((result[0]!.settings.link as { url: string }).url).toBe('/docs?a=1&b=2');
  });

  it('keeps the legacy style hook and autoTextEditor as explicit no-ops', () => {
    const tree = framerXmlToV3('<text style="font-size: 20px">Body</text>');
    expect(autoTextEditor(tree)).toBe(tree);
    expect(framerXmlToV3('<text style="font-size: 20px">Body</text>', {
      textStyles: { body: { fontSize: 99 } },
      colorStyles: { ink: '#000' },
    })[0]!.settings.typography_font_size).toEqual({ size: 20, unit: 'px' });
  });

  it('handles mixed tag casing, single-quoted attributes, self-closing nodes and mismatched closing tags', () => {
    const result = framerXmlToV3(
      "<FRAME name='Hero Section'><TEXT>Hi &amp; there</wrong></TEXT><IMAGE src='hero.png'/></FRAME><FRAME name='Next'><TEXT>Later</TEXT>",
    );
    expect(result).toHaveLength(2);
    expect(result[0]!.elType).toBe('section');
    expect(result[0]!.elements![0]!.elements).toHaveLength(2);
    expect(result[0]!.elements![0]!.elements![0]!.settings.editor).toBe('Hi & there');
    expect(result[1]!.elements![0]!.settings.editor).toBe('Later');
  });
});

describe('convertFramerTree — section detection', () => {
  it('treats a depth-0 frame named "Hero Section" as a section, not a container', () => {
    const result = convertFramerTree([fnode('a', 'frame', 'Hero Section', {})]);
    expect(result.elements[0]!.elType).toBe('section');
    expect(result.stats.sections).toBe(1);
  });

  it('treats a depth-0 frame with >2 children as a section even without a matching name', () => {
    const kids = [fnode('c1', 'text', 'X'), fnode('c2', 'text', 'Y'), fnode('c3', 'text', 'Z')];
    const result = convertFramerTree([fnode('a', 'frame', 'RandomName', {}, kids)]);
    expect(result.elements[0]!.elType).toBe('section');
  });

  it('does NOT treat a nested (depth > 0) node as a section, even if named "hero"', () => {
    const inner = fnode('b', 'frame', 'hero', {}, [fnode('c', 'text', 'X', { text: 'hi' })]);
    const result = convertFramerTree([fnode('a', 'frame', 'Wrapper', {}, [inner])]);
    const child = result.elements[0]!.elements![0]!; // 'a' is a plain container (not a section), 'inner' is its direct child
    expect(child.elType).not.toBe('section');
  });

  it('a section always gets exactly one full-width column wrapping its children', () => {
    const result = convertFramerTree([fnode('a', 'frame', 'Hero Section', {}, [fnode('t', 'text', 'X', { text: 'hi' })])]);
    const section = result.elements[0]!;
    expect(section.elements).toHaveLength(1);
    expect(section.elements![0]!.elType).toBe('column');
    expect(section.elements![0]!.settings._column_size).toBe(100);
  });
});

describe('convertFramerTree — settings mapping', () => {
  it('maps backgroundColor, skipping the literal "transparent" value', () => {
    const child = [fnode('c', 'text', 'X', { text: 'hi' })];
    const withBg = convertFramerTree([fnode('a', 'frame', 'Container', { backgroundColor: '#fff' }, child)]);
    expect(withBg.elements[0]!.settings.background_color).toBe('#fff');
    const transparent = convertFramerTree([fnode('a', 'frame', 'Container', { backgroundColor: 'transparent' }, child)]);
    expect(transparent.elements[0]!.settings.background_color).toBeUndefined();
  });

  it('maps padding only when at least one side is truthy', () => {
    const child = [fnode('c', 'text', 'X', { text: 'hi' })];
    const result = convertFramerTree([fnode('a', 'frame', 'X', { paddingTop: 10, paddingLeft: 20 }, child)]);
    expect(result.elements[0]!.settings.padding).toEqual({ top: 10, right: 0, bottom: 0, left: 20, unit: 'px', isLinked: false });
  });

  it('maps stack direction: horizontal -> row, otherwise -> column', () => {
    const child = [fnode('c', 'text', 'X', { text: 'hi' })];
    const row = convertFramerTree([fnode('a', 'stack', 'X', { stackDirection: 'horizontal' }, child)]);
    expect(row.elements[0]!.settings.flex_direction).toBe('row');
    const col = convertFramerTree([fnode('a', 'stack', 'X', { stackDirection: 'vertical' }, child)]);
    expect(col.elements[0]!.settings.flex_direction).toBe('column');
  });

  it('sets typography_typography:custom for every text node, with font-size/family/weight/align mapped', () => {
    const result = convertFramerTree([fnode('a', 'text', 'X', {
      fontSize: 20, fontFamily: 'Inter', fontWeight: 700, textAlign: 'center', text: 'hi',
    })]);
    const s = result.elements[0]!.settings;
    expect(s.typography_typography).toBe('custom');
    expect(s.typography_font_family).toBe('Inter');
    expect(s.typography_font_weight).toBe('700');
    expect(s.align).toBe('center');
  });

  it('every converted node gets a stable _element_id from its Framer node id', () => {
    const result = convertFramerTree([fnode('abc123', 'text', 'X', { text: 'hi' })]);
    expect(result.elements[0]!.settings._element_id).toBe('framer-abc123');
  });
});

describe('convertFramerTree — depth limit, skip patterns, warnings', () => {
  it('skips nodes matching a skipPattern (case-insensitive) and counts them', () => {
    const result = convertFramerTree(
      [fnode('a', 'frame', 'Debug Overlay', {}, [fnode('b', 'text', 'X', { text: 'hi' })])],
      { skipPatterns: ['debug'] },
    );
    expect(result.elements).toEqual([]);
    expect(result.stats.skippedNodes).toBeGreaterThanOrEqual(1);
  });

  it('stops converting past maxDepth and records a warning', () => {
    const deep = fnode('d3', 'text', 'Deep', { text: 'x' });
    const l2 = fnode('d2', 'frame', 'L2', {}, [deep]);
    const l1 = fnode('d1', 'frame', 'L1', {}, [l2]);
    const result = convertFramerTree([l1], { maxDepth: 1 });
    expect(result.warnings.some((w) => w.includes('exceeds max depth'))).toBe(true);
  });
});

describe('convertFramerTree — stats accuracy', () => {
  it('convertedNodes should account for every successfully converted node, including sections', () => {
    // 1 section + 1 widget child = 2 successfully converted nodes, 0 skipped.
    const tree = [fnode('a', 'frame', 'Hero Section', {}, [fnode('b', 'text', 'X', { text: 'hi', fontSize: 30 })])];
    const result = convertFramerTree(tree);
    expect(result.stats.skippedNodes).toBe(0);
    expect(result.stats.totalNodes).toBe(2);
    // If this fails, convertedNodes only counts widgets/containers, not sections —
    // a real stats-accuracy bug, not a test-authoring mistake (totalNodes and
    // skippedNodes above are asserted independently and are correct).
    expect(result.stats.convertedNodes).toBe(result.stats.totalNodes - result.stats.skippedNodes);
  });
});


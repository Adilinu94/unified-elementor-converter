import { describe, it, expect } from 'vitest';
import { autoTextEditor, convertFramerTree, framerXmlToV3, normalizeLegacyXmlPayload, runV3Guards, type FramerNode } from '@elconv/target-v3';
import legacyComponentFixture from './fixtures/post-644-legacy-components.xml?raw';

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

  it('keeps an explicit image node as an image despite a button-like name', () => {
    const result = convertFramerTree([fnode('a', 'image', 'Button Icon', { src: 'https://x/icon.png' })]);
    expect(result.elements[0]!.widgetType).toBe('image');
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
    expect(result.elements[0]!.settings._element_id).toBe('framer-a');
  });

  it('converts a code node to an html widget', () => {
    const result = convertFramerTree([fnode('a', 'code', 'Embed', {})]);
    expect(result.elements[0]!.widgetType).toBe('html');
  });

  it('parses underscore-prefixed component tags instead of rendering raw XML as text', () => {
    const tree = framerXmlToV3(
      '<Frame name="Wrapper"><_01 nodeId="component-01" height="40" controls="{}" /></Frame>',
    );
    expect(tree[0]!.elType).toBe('container');
    expect(tree[0]!.settings.editor).toBeUndefined();
    expect(tree[0]!.elements![0]!.widgetType).toBe('spacer');
    expect(tree[0]!.elements![0]!.settings.editor).toBeUndefined();
  });

  it('keeps an underscore-component link visible when its label is absent', () => {
    const tree = framerXmlToV3(
      '<Frame name="Wrapper"><_link nodeId="component-link" controls="{&quot;href&quot;:&quot;/services/indoor&quot;}" /></Frame>',
    );
    const button = tree[0]!.elements![0]!.elements![0]!;
    expect(button.widgetType).toBe('button');
    expect(button.settings.text).toBe('Open');
    expect((button.settings.link as { url: string }).url).toBe('/services/indoor');
  });

  it('preserves underscore-component image, label, and link controls as native V3 widgets', () => {
    const tree = framerXmlToV3(
      '<Frame name="Wrapper"><_01 nodeId="component-01" controls="{&quot;label&quot;:&quot;Indoor Golf Simulator&quot;,&quot;href&quot;:&quot;/services/indoor&quot;,&quot;image&quot;:{&quot;url&quot;:&quot;https://example.test/indoor.png&quot;}}" /></Frame>',
    );
    const component = tree[0]!.elements![0]!;
    expect(component.elType).toBe('container');
    expect(component.elements).toHaveLength(2);
    expect(component.elements![0]!.widgetType).toBe('image');
    expect((component.elements![0]!.settings.image as { url: string }).url).toBe('https://example.test/indoor.png');
    expect(component.elements![1]!.widgetType).toBe('button');
    expect(component.elements![1]!.settings.text).toBe('Indoor Golf Simulator');
    expect((component.elements![1]!.settings.link as { url: string }).url).toBe('/services/indoor');
    expect(JSON.stringify(component)).not.toMatch(/<\/?_01|controls=|componentId/);
  });

  it('recovers JSON-stringified legacy component XML without placeholders or raw markers', () => {
    const legacyXml = JSON.stringify([
      '<_01 nodeId="one" controls="{&quot;label&quot;:&quot;Indoor Golf Simulator&quot;,&quot;image&quot;:{&quot;url&quot;:&quot;https://example.test/one.png&quot;}}" />',
      '<_02 nodeId="two" controls="{&quot;label&quot;:&quot;Locker Rooms&quot;,&quot;image&quot;:{&quot;url&quot;:&quot;https://example.test/two.png&quot;}}" />',
    ].join('\\n'));
    expect(normalizeLegacyXmlPayload(legacyXml)).toContain('<_01');
    const components = framerXmlToV3(legacyXml);
    expect(components).toHaveLength(2);
    expect(components.map((component) => component.elements![1]!.settings.editor)).toEqual([
      'Indoor Golf Simulator',
      'Locker Rooms',
    ]);
    expect(components.map((component) => (component.elements![0]!.settings.image as { url: string }).url)).toEqual([
      'https://example.test/one.png',
      'https://example.test/two.png',
    ]);
    expect(JSON.stringify(components)).not.toMatch(/<\/?_\d|controls=|componentId=|nodeId=|\{(?:one|two)\}/);
  });

  it('recovers six legacy components as native V3 widgets without placeholders or raw markers', () => {
    const tree = framerXmlToV3(legacyComponentFixture);
    const section = tree[0]!;
    const components = section.elements![0]!.elements!;
    expect(components).toHaveLength(6);
    expect(components.every((component) => component.elType === 'container')).toBe(true);
    expect(components.map((component) => component.elements![0]!.widgetType)).toEqual([
      'image', 'image', 'image', 'image', 'image', 'image',
    ]);
    expect(components.map((component) => component.elements![1]!.settings.editor)).toEqual([
      'Indoor Golf Simulator',
      'Locker Rooms',
      'Clubhouse Dining',
      'Practice Facilities',
      'Golf Lessons',
      'Events & Tournaments',
    ]);
    expect(JSON.stringify(components)).not.toMatch(/<\/?_\d|controls=|componentId=|nodeId=|\{0\d\}/);
  });

  it('normalizes escaped XML attributes without changing visible text', () => {
    const escapedXml = String.raw`<Frame name=\"Wrapper\"><_01 nodeId=\"one\" controls=\"{&quot;label&quot;:&quot;Keep Text&quot;,&quot;image&quot;:{&quot;url&quot;:&quot;https://example.test/escaped.png&quot;}}\" /></Frame>`;
    const tree = framerXmlToV3(escapedXml);
    expect(tree[0]!.elType).toBe('container');
    expect(tree[0]!.elements![0]!.elements![1]!.settings.editor).toBe('Keep Text');
    expect((tree[0]!.elements![0]!.elements![0]!.settings.image as { url: string }).url).toBe('https://example.test/escaped.png');
  });

  it('terminates on malformed attributes and still parses a following child node', () => {
    const tree = framerXmlToV3('<Frame name="Wrapper"><_01 broken controls="{}"><Text>After</Text></_01></Frame>');
    expect(tree).toHaveLength(1);
    expect(tree[0]!.elements![0]!.elements![0]!.settings.editor).toBe('After');
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
    expect(section.elements![0]!.settings._element_id).toBe('framer-a-column');
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

describe('convertFramerTree — Proofly component controls', () => {
  it('maps component controls to button text and links', () => {
    const tree = framerXmlToV3(
      '<Frame name="Wrapper"><Button controls="{&quot;label&quot;:&quot;Join Our Club&quot;,&quot;href&quot;:&quot;/contact&quot;}" /></Frame>',
    );
    const button = tree[0]!.elements![0]!;
    expect(button.widgetType).toBe('button');
    expect(button.settings.text).toBe('Join Our Club');
    expect((button.settings.link as { url: string }).url).toBe('/contact');
  });

  it('maps nested component image controls to an Elementor image URL', () => {
    const tree = framerXmlToV3(
      '<Frame name="Wrapper"><Image_Drop_Animation controls="{&quot;image&quot;:{&quot;url&quot;:&quot;https://example.test/image.png&quot;}}" /></Frame>',
    );
    const image = tree[0]!.elements![0]!;
    expect(image.widgetType).toBe('image');
    expect((image.settings.image as { url: string }).url).toBe('https://example.test/image.png');
  });

  it('keeps a button as a button when its controls also contain an image', () => {
    const tree = framerXmlToV3(
      '<Frame name="Wrapper"><Button controls="{&quot;label&quot;:&quot;Join&quot;,&quot;url&quot;:&quot;/wrong&quot;,&quot;href&quot;:&quot;/right&quot;,&quot;image&quot;:{&quot;url&quot;:&quot;https://example.test/icon.png&quot;}}" /></Frame>',
    );
    const button = tree[0]!.elements![0]!;
    expect(button.widgetType).toBe('button');
    expect(button.settings.text).toBe('Join');
    expect((button.settings.link as { url: string }).url).toBe('/right');
  });

  it('uses Proofly nodeId as the stable Elementor CSS id source', () => {
    const tree = framerXmlToV3('<Text nodeId="proofly-node-123">Hello</Text>');
    expect(tree[0]!.settings._element_id).toBe('framer-proofly-node-123');
  });

  it('normalizes inline Proofly typography dimensions to Elementor numeric settings', () => {
    const tree = framerXmlToV3(
      '<Text inlineTextStyle="{&quot;fontSize&quot;:&quot;66px&quot;,&quot;lineHeight&quot;:&quot;115%&quot;}">Large</Text>',
    );
    const settings = tree[0]!.settings;
    expect(tree[0]!.widgetType).toBe('heading');
    expect(settings.typography_font_size).toEqual({ size: 66, unit: 'px' });
    expect(settings.typography_line_height).toEqual({ size: 115, unit: '%' });
  });

  it('keeps generated Elementor IDs unique when source IDs repeat', () => {
    const tree = framerXmlToV3(
      '<Frame name="Wrapper"><Frame id="same"><Text>One</Text></Frame><Frame id="same"><Text>Two</Text></Frame></Frame>',
    );
    const ids: string[] = [];
    const walk = (elements: typeof tree): void => {
      for (const element of elements) {
        ids.push(element.id);
        if (element.elements) walk(element.elements as typeof tree);
      }
    };
    walk(tree);
    expect(new Set(ids).size).toBe(ids.length);
    expect(runV3Guards(tree).results.find((result) => result.name === 'G1:unique-ids')?.result.passed).toBe(true);
  });

  it('marks nested containers as inner containers', () => {
    const tree = convertFramerTree([
      fnode('outer', 'frame', 'Wrapper', {}, [fnode('inner', 'frame', 'Inner', {}, [fnode('text', 'text', 'Body')])]),
    ]);
    expect(tree.elements[0]!.isInner).toBe(false);
    expect(tree.elements[0]!.elements![0]!.isInner).toBe(true);
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


import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  parseUnframerXml,
  decodeEntities,
  normalizeText,
  countUnframerNodes,
  parseUnframerProject,
  parseFramerFontSelector,
  toTextStyleIR,
  resolveStyleTokens,
  resolveColorReference,
  buildUnframerIr,
  walkIrNodes,
  countIrNodes,
  UnframerSourceAdapter,
  SourceIncompleteError,
  assertPageEvidenceIsSubstantial,
  toXmlString,
  type UnframerTransport,
} from '@elconv/extractors';

const FIXTURES = resolve(__dirname, 'fixtures/framer');
const PAGE_XML = readFileSync(resolve(FIXTURES, 'unframer-home-page.xml'), 'utf8');
const PROJECT_XML = readFileSync(resolve(FIXTURES, 'unframer-project.xml'), 'utf8');

const HOME_PAGE_NODE_ID = 'augiA20Il';

/** Fixture-backed transport: no live MCP, no credentials. */
function makeTransport(overrides: Partial<Record<string, unknown>> = {}): UnframerTransport {
  return {
    async callTool(tool, args) {
      if (tool in overrides) {
        const value = overrides[tool];
        if (value instanceof Error) throw value;
        return value;
      }
      if (tool === 'getProjectXml') return PROJECT_XML;
      if (tool === 'getNodeXml') {
        const nodeId = (args as { nodeId: string }).nodeId;
        if (nodeId === HOME_PAGE_NODE_ID) return { content: [{ type: 'text', text: PAGE_XML }] };
        // Framer's documented empty-wrapper response for anything else.
        return `<WebPageNode nodeId="${nodeId}"></WebPageNode>`;
      }
      throw new Error(`unexpected tool ${tool}`);
    },
  };
}

// ============================================================================
// XML dialect parser
// ============================================================================

describe('parseUnframerXml', () => {
  it('parses attributes that are interrupted by an HTML comment', () => {
    // The measured reason a standard XML parser cannot be used: comments sit
    // INSIDE the attribute list (96 times in the real home page).
    const parsed = parseUnframerXml(
      '<Hero nodeId="a"\n  <!-- background color string -->\n  backgroundColor="/Dark" width="1fr">\n</Hero>',
    );
    expect(parsed.roots).toHaveLength(1);
    expect(parsed.roots[0]!.attributes).toMatchObject({
      nodeId: 'a',
      backgroundColor: '/Dark',
      width: '1fr',
    });
  });

  it('accepts a tag name that starts with a digit', () => {
    // Framer derives the tag from the layer name; a layer called "04" is legal
    // in Framer and illegal in XML.
    const parsed = parseUnframerXml('<Wrap nodeId="w"><04 nodeId="d" inlineTextStyle="/Heading 3">04</04></Wrap>');
    const child = parsed.roots[0]!.children[0]!;
    expect(child.tag).toBe('04');
    expect(child.text).toBe('04');
  });

  it('separates the primary breakpoint root from non-primary variant stubs', () => {
    const parsed = parseUnframerXml(PAGE_XML);
    expect(parsed.roots.map((root) => root.tag)).toEqual(['Desktop', 'Tablet', 'Phone']);
    expect(parsed.primaryRoot?.tag).toBe('Desktop');
    expect(parsed.variantRoots.map((root) => root.tag)).toEqual(['Tablet', 'Phone']);
  });

  it('does not mistake an empty variant stub for the primary root', () => {
    const parsed = parseUnframerXml(
      '<!-- This is a non-primary variant --><Tablet nodeId="t" width="810px" /><Desktop nodeId="d" width="1200px"><A nodeId="a" /></Desktop>',
    );
    expect(parsed.primaryRoot?.tag).toBe('Desktop');
  });

  it('parses the real 60kB home page without warnings', () => {
    const parsed = parseUnframerXml(PAGE_XML);
    expect(parsed.warnings).toEqual([]);
    expect(countUnframerNodes(parsed.primaryRoot!)).toBeGreaterThan(150);
  });

  it('reports unclosed elements instead of silently accepting them', () => {
    const parsed = parseUnframerXml('<A nodeId="a"><B nodeId="b">');
    expect(parsed.warnings.some((w) => w.includes('never closed'))).toBe(true);
  });

  it('reports a closing tag that has no matching open tag', () => {
    const parsed = parseUnframerXml('<A nodeId="a"></A></B>');
    expect(parsed.warnings.some((w) => w.includes('no matching open tag'))).toBe(true);
  });

  it('keeps a bare "<" in text content rather than dropping it', () => {
    const parsed = parseUnframerXml('<A nodeId="a">5 < 10</A>');
    expect(parsed.roots[0]!.text).toBe('5 < 10');
  });

  it('does not let a comment inside text content split the text', () => {
    // A comment introduces no whitespace, so the two runs are one word.
    const parsed = parseUnframerXml('<A nodeId="a">first<!-- c -->second</A>');
    expect(parsed.roots[0]!.text).toBe('firstsecond');
  });

  it('joins two text runs that a child element separates', () => {
    const parsed = parseUnframerXml('<A nodeId="a">first<B nodeId="b" />second</A>');
    expect(parsed.roots[0]!.text).toBe('first second');
  });
});

describe('decodeEntities / normalizeText', () => {
  it('decodes the named entities Framer emits', () => {
    expect(decodeEntities('Q &amp; A &apos;x&apos; &mdash; &hellip;')).toBe("Q & A 'x' \u2014 \u2026");
  });

  it('decodes decimal and hex numeric references', () => {
    expect(decodeEntities('&#65;&#x42;')).toBe('AB');
  });

  it('leaves an unknown entity untouched rather than corrupting the text', () => {
    expect(decodeEntities('&notanentity;')).toBe('&notanentity;');
  });

  it('collapses non-semantic indentation into single spaces', () => {
    expect(normalizeText('\n   We build\n   brands   \n')).toBe('We build brands');
  });
});

// ============================================================================
// Project styles
// ============================================================================

describe('parseUnframerProject', () => {
  const project = parseUnframerProject(PROJECT_XML);

  it('extracts every page with its nodeId', () => {
    expect(project.pages).toHaveLength(10);
    expect(project.pages[0]).toEqual({ nodeId: HOME_PAGE_NODE_ID, path: '/' });
  });

  it('extracts design components and code components separately', () => {
    expect(project.components).toHaveLength(55);
    expect(project.codeComponents).toEqual([
      { codeFileId: 'U6Xf06Z', path: 'Counter_FX.tsx' },
      { codeFileId: 'YnOVYmZ', path: 'CarouselControl.tsx' },
    ]);
  });

  it('decodes entities in a component name', () => {
    expect(project.components.some((c) => c.name === 'Q & A Box')).toBe(true);
  });

  it('warns about the duplicated /White color style instead of hiding it', () => {
    // The Humeen project genuinely declares /White twice. Last-write-wins would
    // be invisible; a warning is not.
    expect(project.colorStyles).toHaveLength(14);
    expect(project.warnings.some((w) => w.includes('"/White" is declared more than once'))).toBe(true);
  });

  it('captures the tag of each text style — the only reliable heading signal', () => {
    const heading3 = project.textStyles.find((s) => s.path === '/Heading 3');
    expect(heading3).toMatchObject({ tag: 'h3', fontSize: '68px', lineHeight: '1.1em' });
    const paragraph = project.textStyles.find((s) => s.path === '/Paragraph-20-regular');
    expect(paragraph!.tag).toBe('p');
  });
});

describe('parseFramerFontSelector', () => {
  it('splits the source prefix off a custom font and derives the weight from the name', () => {
    expect(parseFramerFontSelector('CUSTOMV2;Creato Display Regular')).toEqual({
      family: 'Creato Display',
      weight: 400,
    });
    expect(parseFramerFontSelector('CUSTOMV2;Creato Display Medium')).toEqual({
      family: 'Creato Display',
      weight: 500,
    });
  });

  it('reads the numeric weight of a Google-Fonts selector', () => {
    expect(parseFramerFontSelector('GF;Inter-600')).toEqual({ family: 'Inter', weight: 600 });
  });

  it('prefers semibold over bold when both substrings match', () => {
    expect(parseFramerFontSelector('CUSTOM;Acme SemiBold').weight).toBe(600);
  });

  it('defaults to 400 when the name carries no weight', () => {
    expect(parseFramerFontSelector('Acme Display')).toEqual({ family: 'Acme Display', weight: 400 });
  });
});

describe('toTextStyleIR', () => {
  it('keeps an em line-height verbatim rather than guessing a px value', () => {
    const ir = toTextStyleIR({ path: '/Heading 3', font: 'GF;Inter-600', fontSize: '68px', lineHeight: '1.1em' });
    expect(ir).toEqual({ family: 'Inter', weight: 600, size: '68px', lineHeight: '1.1em' });
  });

  it('omits absent fields instead of emitting undefined', () => {
    expect(toTextStyleIR({ path: '/Bare' })).toEqual({});
  });
});

describe('resolveStyleTokens', () => {
  const tokens = resolveStyleTokens(parseUnframerProject(PROJECT_XML));

  it('collapses the duplicate color path to a single first-wins entry', () => {
    expect(Object.keys(tokens.colors)).toHaveLength(13);
    expect(tokens.colors['/White']).toBe('rgb(255, 255, 255)');
  });

  it('deduplicates fonts by family and weight', () => {
    expect(tokens.fonts).toEqual([
      { family: 'Creato Display', weight: 400, style: 'normal' },
      { family: 'Creato Display', weight: 500, style: 'normal' },
    ]);
  });

  it('maps each text style path to its tag', () => {
    expect(tokens.tagByTextStyle['/Heading 1']).toBe('h1');
    expect(tokens.tagByTextStyle['/Paragraph-16-regular']).toBe('p');
  });
});

describe('resolveColorReference', () => {
  it('looks up a style path instead of emitting it as a CSS color', () => {
    expect(resolveColorReference('/Dark', { '/Dark': 'rgb(13, 13, 13)' })).toEqual({ color: 'rgb(13, 13, 13)' });
  });

  it('passes a literal color through untouched', () => {
    expect(resolveColorReference('rgb(1, 2, 3)', {})).toEqual({ color: 'rgb(1, 2, 3)' });
  });

  it('reports an unresolvable path rather than leaking "/Missing" into CSS', () => {
    expect(resolveColorReference('/Missing', {})).toEqual({ unresolvedPath: '/Missing' });
  });

  it('returns an empty result for an absent attribute', () => {
    expect(resolveColorReference(undefined, {})).toEqual({});
  });
});

// ============================================================================
// IR builder
// ============================================================================

describe('buildUnframerIr', () => {
  const project = parseUnframerProject(PROJECT_XML);
  const parsed = parseUnframerXml(PAGE_XML);
  const { ir, stats } = buildUnframerIr(parsed, { route: '/', pageId: HOME_PAGE_NODE_ID, project });

  it('emits one section per Framer section layer', () => {
    // 11 matches the 11 <section data-framer-name> elements in the rendered DOM.
    expect(stats.sectionsEmitted).toBe(11);
    expect(ir.sections.map((section) => section.role)).toEqual([
      'hero', 'about', 'projects', 'partners', 'services',
      'awards', 'testimonials', 'stats', 'cta', 'faq', 'blog',
    ]);
  });

  it('reassembles the fragmented one-word text run into a single node', () => {
    // The About section is a stackWrap horizontal stack of 25 one-word
    // /Heading 3 leaves. Emitting 25 headings is the documented failure mode.
    expect(stats.textRunsMerged).toBeGreaterThan(0);
    expect(stats.textLeavesMerged).toBe(25);

    const merged: string[] = [];
    walkIrNodes(ir, (node) => {
      if (node.textStylePath === '/Heading 3' && node.text && node.text.split(' ').length > 5) {
        merged.push(node.text);
      }
    });
    expect(merged.length).toBeGreaterThan(0);
  });

  it('produces fewer nodes with merging than without — and the same content', () => {
    const raw = buildUnframerIr(parsed, {
      route: '/',
      pageId: HOME_PAGE_NODE_ID,
      project,
      mergeTextRuns: false,
    });
    expect(raw.stats.nodesParsed).toBeGreaterThan(stats.nodesParsed);
    expect(raw.stats.textRunsMerged).toBe(0);
  });

  it('breaks a text run at a component instance instead of swallowing it', () => {
    const xml =
      '<Desktop nodeId="d" width="1200px"><Main nodeId="m"><About nodeId="s" layout="stack" ' +
      'stackDirection="horizontal" stackWrap="true">' +
      '<a nodeId="t1" inlineTextStyle="/Heading 3">We</a>' +
      '<b nodeId="t2" inlineTextStyle="/Heading 3">build</b>' +
      '<Title nodeId="c1" componentId="SH3I1GdGW" />' +
      '<c nodeId="t3" inlineTextStyle="/Heading 3">for</c>' +
      '<d nodeId="t4" inlineTextStyle="/Heading 3">brands</d>' +
      '</About><Other nodeId="o2" /></Main></Desktop>';
    const result = buildUnframerIr(parseUnframerXml(xml), {
      route: '/',
      pageId: 'p',
      project,
    });
    const section = result.ir.sections[0]!;
    // /Heading 3 carries tag="h3", so the merged runs are headings — and the
    // component between them is preserved rather than swallowed by the merge.
    expect(section.nodes.map((node) => node.role)).toEqual(['heading', 'component', 'heading']);
    expect(section.nodes[0]!.text).toBe('We build');
    expect(section.nodes[2]!.text).toBe('for brands');
  });

  it('does not merge across differing text styles', () => {
    const xml =
      '<Desktop nodeId="d" width="1200px"><Main nodeId="m"><S nodeId="s" layout="stack" ' +
      'stackDirection="horizontal" stackWrap="true">' +
      '<a nodeId="t1" inlineTextStyle="/Heading 3">Big</a>' +
      '<b nodeId="t2" inlineTextStyle="/Paragraph-16-regular">small</b>' +
      '</S><Other nodeId="o2" /></Main></Desktop>';
    const section = buildUnframerIr(parseUnframerXml(xml), { route: '/', pageId: 'p', project }).ir.sections[0]!;
    expect(section.nodes.map((node) => node.text)).toEqual(['Big', 'small']);
  });

  it('only merges inside a wrapping horizontal stack, not a deliberate column', () => {
    const xml =
      '<Desktop nodeId="d" width="1200px"><Main nodeId="m"><S nodeId="s" layout="stack" ' +
      'stackDirection="vertical">' +
      '<a nodeId="t1" inlineTextStyle="/Heading 3">One</a>' +
      '<b nodeId="t2" inlineTextStyle="/Heading 3">Two</b>' +
      '</S><Other nodeId="o2" /></Main></Desktop>';
    const result = buildUnframerIr(parseUnframerXml(xml), { route: '/', pageId: 'p', project });
    expect(result.stats.textRunsMerged).toBe(0);
    expect(result.ir.sections[0]!.nodes.map((node) => node.text)).toEqual(['One', 'Two']);
  });

  it('classifies role from attributes, never from the layer name', () => {
    // <Text> here is a layout wrapper and <Image> a background frame — the two
    // cases where trusting the tag name produces the wrong widget.
    const xml =
      '<Desktop nodeId="d" width="1200px"><Main nodeId="m"><S nodeId="s">' +
      '<Text nodeId="n1" layout="stack"><x nodeId="n1a" inlineTextStyle="/Heading 1">Hi</x></Text>' +
      '<Image nodeId="n2" backgroundImage="https://cdn.example/a.png" />' +
      '<Icon nodeId="n3" svg="&lt;svg/&gt;" />' +
      '<Link nodeId="n4" link="/contact" inlineTextStyle="/Paragraph-16-regular">Contact</Link>' +
      '<Cmp nodeId="n5" componentId="VXAnZVXE8" />' +
      '</S><Other nodeId="o2" /></Main></Desktop>';
    const nodes = buildUnframerIr(parseUnframerXml(xml), { route: '/', pageId: 'p', project }).ir.sections[0]!.nodes;
    expect(nodes.map((node) => node.role)).toEqual(['layout', 'image', 'icon', 'button', 'component']);
    // The heading level comes from the text style's tag, not the font size.
    expect(nodes[0]!.children[0]).toMatchObject({ role: 'heading', tag: 'h1' });
  });

  it('resolves a color style path into a real CSS color', () => {
    const hero = ir.sections[0]!;
    expect(hero.background?.color).toBe('rgb(13, 13, 13)');
    expect(hero.styles?.['background-color']).toBe('rgb(13, 13, 13)');
  });

  it('translates stack attributes into CSS the target can map', () => {
    const hero = ir.sections[0]!;
    expect(hero.styles).toMatchObject({
      display: 'flex',
      'flex-direction': 'row',
      'justify-content': 'center',
      'align-items': 'center',
    });
  });

  it('derives viewport profiles from the real breakpoint widths', () => {
    // 1200/810/390 — not the repo default 1440/768/390, which would probe 768px
    // on the wrong side of this project's 810px boundary.
    expect(ir.viewportProfiles).toEqual([
      { label: 'desktop', width: 1200, height: 900 },
      { label: 'tablet', width: 810, height: 1024 },
      { label: 'phone', width: 390, height: 844 },
    ]);
  });

  it('leaves bboxByViewport empty instead of fabricating geometry', () => {
    for (const section of ir.sections) expect(section.bboxByViewport).toEqual({});
    expect(ir.animations).toEqual([]);
    expect(ir.warnings.some((w) => w.includes('structure-only extraction'))).toBe(true);
  });

  it('targets sections by stable Framer node id, not a hashed class', () => {
    expect(ir.sections[0]!.selector).toBe('[data-framer-node-id="pFAxpVIvb"]');
  });

  it('keeps a component instance unexpanded and flags it as lower confidence', () => {
    expect(stats.componentInstances).toBeGreaterThan(0);
    const instances: Array<{ confidence: number; warnings: string[] }> = [];
    walkIrNodes(ir, (node) => {
      if (node.role === 'component') {
        instances.push({ confidence: node.evidence.confidence, warnings: node.evidence.warnings });
        expect(node.children).toEqual([]);
      }
    });
    expect(instances[0]!.confidence).toBe(0.7);
    expect(instances[0]!.warnings[0]).toContain('definition not expanded');
  });

  it('preserves component props as prefixed custom properties', () => {
    const xml =
      '<Desktop nodeId="d" width="1200px"><Main nodeId="m"><S nodeId="s">' +
      '<Btn nodeId="n1" componentId="DKFzfpC5U" label="Get in touch" width="1fr" />' +
      '<Other nodeId="n2" /></S><X nodeId="o2" /></Main></Desktop>';
    const node = buildUnframerIr(parseUnframerXml(xml), { route: '/', pageId: 'p', project }).ir.sections[0]!.nodes[0]!;
    expect(node.styles?.['--framer-prop-label']).toBe('Get in touch');
    // `width` is structural, not a prop, so it must not be leaked as one.
    expect(node.styles?.['--framer-prop-width']).toBeUndefined();
  });

  it('registers background images as assets and reuses one id per url', () => {
    expect(ir.assets.length).toBeGreaterThan(0);
    const urls = ir.assets.map((asset) => asset.sourceUrl);
    expect(new Set(urls).size).toBe(urls.length);
  });

  it('classifies an .svg asset as svg rather than image', () => {
    const xml =
      '<Desktop nodeId="d" width="1200px"><Main nodeId="m"><S nodeId="s">' +
      '<A nodeId="n1" backgroundImage="https://cdn.example/logo.SVG" />' +
      '<B nodeId="n2" backgroundImage="https://cdn.example/photo.png" />' +
      '</S><X nodeId="o2" /></Main></Desktop>';
    const assets = buildUnframerIr(parseUnframerXml(xml), { route: '/', pageId: 'p', project }).ir.assets;
    expect(assets.map((asset) => asset.kind)).toEqual(['svg', 'image']);
  });

  it('allocates unique sourceIds even when a nodeId repeats', () => {
    const seen = new Set<string>();
    walkIrNodes(ir, (node) => {
      expect(seen.has(node.sourceId)).toBe(false);
      seen.add(node.sourceId);
    });
    expect(seen.size).toBeGreaterThan(100);
  });

  it('reports an unresolvable color path in the stats and the warnings', () => {
    const xml =
      '<Desktop nodeId="d" width="1200px"><Main nodeId="m"><S nodeId="s" backgroundColor="/Nope">' +
      '<A nodeId="n1" /></S><X nodeId="o2" /></Main></Desktop>';
    const result = buildUnframerIr(parseUnframerXml(xml), { route: '/', pageId: 'p', project });
    expect(result.stats.unresolvedColorPaths).toEqual(['/Nope']);
    expect(result.ir.warnings.some((w) => w.includes('/Nope'))).toBe(true);
  });

  it('warns when a node references a text style the project does not declare', () => {
    const xml =
      '<Desktop nodeId="d" width="1200px"><Main nodeId="m"><S nodeId="s">' +
      '<A nodeId="n1" inlineTextStyle="/Ghost">x</A><B nodeId="n2" /></S><X nodeId="o2" /></Main></Desktop>';
    const result = buildUnframerIr(parseUnframerXml(xml), { route: '/', pageId: 'p', project });
    expect(result.ir.warnings.some((w) => w.includes('"/Ghost" is not in the project'))).toBe(true);
  });

  it('throws when there is no primary breakpoint root', () => {
    expect(() => buildUnframerIr({ roots: [], variantRoots: [], warnings: [] }, {
      route: '/',
      pageId: 'p',
      project,
    })).toThrow(/no primary breakpoint root/);
  });

  it('falls back to a single desktop profile when no breakpoint width is present', () => {
    const xml = '<Desktop nodeId="d"><Main nodeId="m"><S nodeId="s" /><T nodeId="t" /></Main></Desktop>';
    const result = buildUnframerIr(parseUnframerXml(xml), { route: '/', pageId: 'p', project });
    expect(result.ir.viewportProfiles).toEqual([{ label: 'desktop', width: 1440, height: 900 }]);
    expect(result.ir.warnings.some((w) => w.includes('no breakpoint widths'))).toBe(true);
  });

  it('counts the nodes of a section', () => {
    expect(countIrNodes(ir.sections[0]!)).toBeGreaterThan(0);
  });
});

// ============================================================================
// Source adapter
// ============================================================================

describe('UnframerSourceAdapter.canHandle', () => {
  const adapter = new UnframerSourceAdapter({ transport: makeTransport() });

  it('treats an explicit projectId as a stronger signal than a domain match', async () => {
    const byId = await adapter.canHandle({ projectId: 'abc' });
    const byDomain = await adapter.canHandle({ url: 'https://humeen.framer.website/' });
    expect(byId.confidence).toBeGreaterThan(byDomain.confidence);
    expect(byId.supported && byDomain.supported).toBe(true);
  });

  it('declares the capability gap instead of implying full fidelity', async () => {
    const result = await adapter.canHandle({ projectId: 'abc' });
    expect(result.warnings.join(' ')).toMatch(/NO geometry and NO animations/);
  });

  it('declines a non-Framer url with no projectId', async () => {
    const result = await adapter.canHandle({ url: 'https://example.com/' });
    expect(result).toMatchObject({ supported: false, confidence: 0 });
  });

  it('declines when adapterHint names another adapter', async () => {
    const result = await adapter.canHandle({ projectId: 'abc', adapterHint: 'playwright' });
    expect(result.supported).toBe(false);
    expect(result.reasons[0]).toContain('playwright');
  });
});

describe('UnframerSourceAdapter.discover', () => {
  it('classifies routes as static, dynamic-template or 404', async () => {
    const manifest = await new UnframerSourceAdapter({ transport: makeTransport() }).discover({ projectId: 'x' });
    const byRoute = new Map(manifest.pages.map((page) => [page.route, page.kind]));
    expect(byRoute.get('/')).toBe('static');
    expect(byRoute.get('/blogs')).toBe('static');
    // A ":slug" route is a collection template; converting it as static would
    // emit a single page for the whole collection.
    expect(byRoute.get('/blogs/:slug')).toBe('dynamic-template');
    expect(byRoute.get('/projects/:slug')).toBe('dynamic-template');
    expect(byRoute.get('/404')).toBe('404');
  });

  it('lists design and code components together as componentIds', async () => {
    const manifest = await new UnframerSourceAdapter({ transport: makeTransport() }).discover({ projectId: 'x' });
    expect(manifest.componentIds).toHaveLength(57);
    expect(manifest.componentIds).toContain('VXAnZVXE8');
    expect(manifest.componentIds).toContain('U6Xf06Z');
  });

  it('propagates the project parse warnings', async () => {
    const manifest = await new UnframerSourceAdapter({ transport: makeTransport() }).discover({ projectId: 'x' });
    expect(manifest.warnings.some((w) => w.includes('/White'))).toBe(true);
  });

  it('warns when the project reports no pages at all', async () => {
    const transport = makeTransport({ getProjectXml: '<Project><Pages /></Project>' });
    const manifest = await new UnframerSourceAdapter({ transport }).discover({ projectId: 'x' });
    expect(manifest.pages).toEqual([]);
    expect(manifest.warnings.some((w) => w.includes('no pages'))).toBe(true);
  });

  it('fetches the project XML once and serves later calls from cache', async () => {
    let calls = 0;
    const transport: UnframerTransport = {
      async callTool(tool) {
        if (tool === 'getProjectXml') {
          calls++;
          return PROJECT_XML;
        }
        throw new Error('unexpected');
      },
    };
    const adapter = new UnframerSourceAdapter({ transport });
    await adapter.discover({ projectId: 'x' });
    await adapter.discover({ projectId: 'x' });
    expect(calls).toBe(1);
  });

  it('drops the cache on close', async () => {
    let calls = 0;
    const transport: UnframerTransport = {
      async callTool(tool) {
        if (tool === 'getProjectXml') {
          calls++;
          return PROJECT_XML;
        }
        throw new Error('unexpected');
      },
    };
    const adapter = new UnframerSourceAdapter({ transport });
    await adapter.discover({ projectId: 'x' });
    await adapter.close();
    await adapter.discover({ projectId: 'x' });
    expect(calls).toBe(2);
  });

  it('throws when getProjectXml answers with no XML payload', async () => {
    const transport = makeTransport({ getProjectXml: { unexpected: 1 } });
    await expect(new UnframerSourceAdapter({ transport }).discover({ projectId: 'x' }))
      .rejects.toThrow(/returned no XML payload/);
  });
});

// ============================================================================
// Empty-wrapper guard — a 200 is not proof of extraction
// ============================================================================

describe('assertPageEvidenceIsSubstantial', () => {
  it('rejects the documented empty <WebPageNode> wrapper', () => {
    // getNodeXml answers HTTP 200 with a 71-89 byte empty wrapper for pages it
    // cannot render (9 of 10 routes in the measured run).
    expect(() => assertPageEvidenceIsSubstantial('<WebPageNode nodeId="pg6tmsFMk"></WebPageNode>', '/about'))
      .toThrow(SourceIncompleteError);
  });

  it('names the route and the byte count in the error', () => {
    try {
      assertPageEvidenceIsSubstantial('<WebPageNode></WebPageNode>', '/about');
      expect.unreachable('should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(SourceIncompleteError);
      const incomplete = error as SourceIncompleteError;
      expect(incomplete.route).toBe('/about');
      expect(incomplete.byteLength).toBe(27);
      expect(incomplete.message).toContain('200 response with an empty wrapper is NOT a successful extraction');
    }
  });

  it('rejects a long payload that contains no element tags', () => {
    expect(() => assertPageEvidenceIsSubstantial('x'.repeat(1000), '/about', 500))
      .toThrow(/no element tags/);
  });

  it('rejects a large wrapper that has no children', () => {
    const padded = `<WebPageNode nodeId="p" data-note="${'x'.repeat(600)}"></WebPageNode>`;
    expect(() => assertPageEvidenceIsSubstantial(padded, '/about')).toThrow(/empty wrapper/);
  });

  it('accepts the real home page', () => {
    expect(() => assertPageEvidenceIsSubstantial(PAGE_XML, '/')).not.toThrow();
  });
});

describe('UnframerSourceAdapter.extractPage / resolveComponent', () => {
  it('returns the page payload with honest evidence for a real page', async () => {
    const adapter = new UnframerSourceAdapter({ transport: makeTransport() });
    const manifest = await adapter.discover({ projectId: 'x' });
    const page = manifest.pages.find((candidate) => candidate.route === '/')!;
    const evidence = await adapter.extractPage(manifest, page);
    expect((evidence.payload as string).length).toBe(PAGE_XML.length);
    expect(evidence.evidence.methods).toEqual(['mcp', 'xml']);
    expect(evidence.evidence.warnings.join(' ')).toContain('no geometry');
  });

  it('throws SourceIncompleteError for a route that returns an empty wrapper', async () => {
    const adapter = new UnframerSourceAdapter({ transport: makeTransport() });
    const manifest = await adapter.discover({ projectId: 'x' });
    const about = manifest.pages.find((candidate) => candidate.route === '/about')!;
    await expect(adapter.extractPage(manifest, about)).rejects.toThrow(SourceIncompleteError);
  });

  it('reports a failed component fetch as zero confidence instead of guessing', async () => {
    const transport = makeTransport({ getNodeXml: new Error('boom') });
    const adapter = new UnframerSourceAdapter({ transport });
    const manifest = await adapter.discover({ projectId: 'x' });
    const result = await adapter.resolveComponent(manifest, 'VXAnZVXE8');
    expect(result).toMatchObject({ payload: null });
    expect(result.evidence.confidence).toBe(0);
    expect(result.evidence.warnings[0]).toContain('boom');
  });

  it('flags a suspiciously small component definition as half confidence', async () => {
    const adapter = new UnframerSourceAdapter({ transport: makeTransport() });
    const manifest = await adapter.discover({ projectId: 'x' });
    const result = await adapter.resolveComponent(manifest, 'VXAnZVXE8');
    expect(result.evidence.confidence).toBe(0.5);
    expect(result.evidence.warnings[0]).toContain('empty wrapper');
  });

  it('serves a second resolveComponent call from cache', async () => {
    let calls = 0;
    const transport: UnframerTransport = {
      async callTool(tool, args) {
        if (tool === 'getProjectXml') return PROJECT_XML;
        calls++;
        return `<Navbar nodeId="${(args as { nodeId: string }).nodeId}">${'x'.repeat(300)}</Navbar>`;
      },
    };
    const adapter = new UnframerSourceAdapter({ transport });
    const manifest = await adapter.discover({ projectId: 'x' });
    await adapter.resolveComponent(manifest, 'VXAnZVXE8');
    const second = await adapter.resolveComponent(manifest, 'VXAnZVXE8');
    expect(calls).toBe(1);
    expect(second.evidence.warnings).toContain('served from cache');
  });
});

describe('UnframerSourceAdapter.buildIrForRoute', () => {
  it('builds a validated IR for a static route', async () => {
    const adapter = new UnframerSourceAdapter({ transport: makeTransport() });
    const ir = await adapter.buildIrForRoute({ projectId: 'x' }, '/');
    expect(ir.schemaVersion).toBe('1.0');
    expect(ir.source).toMatchObject({ route: '/', extractionMode: 'unframer', pageId: HOME_PAGE_NODE_ID });
    expect(ir.sections).toHaveLength(11);
  });

  it('refuses a CMS template route rather than emitting one page for a collection', async () => {
    const adapter = new UnframerSourceAdapter({ transport: makeTransport() });
    await expect(adapter.buildIrForRoute({ projectId: 'x' }, '/blogs/:slug'))
      .rejects.toThrow(/CMS template, not a static page/);
  });

  it('lists the available routes when the requested one does not exist', async () => {
    const adapter = new UnframerSourceAdapter({ transport: makeTransport() });
    await expect(adapter.buildIrForRoute({ projectId: 'x' }, '/nope'))
      .rejects.toThrow(/not in the project; available: \//);
  });
});

describe('toXmlString', () => {
  it('unwraps a nested MCP content block', () => {
    expect(toXmlString({ content: [{ type: 'text', text: '<A/>' }] })).toBe('<A/>');
  });

  it('passes a bare string through', () => {
    expect(toXmlString('<A/>')).toBe('<A/>');
  });

  it('joins multiple blocks in order', () => {
    expect(toXmlString(['<A/>', '<B/>'])).toBe('<A/>\n<B/>');
  });

  it('returns null when there is no XML anywhere in the payload', () => {
    expect(toXmlString({ status: 'ok' })).toBeNull();
    expect(toXmlString(null)).toBeNull();
    expect(toXmlString([])).toBeNull();
  });
});

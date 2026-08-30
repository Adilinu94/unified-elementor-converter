import { describe, expect, it } from 'vitest';
import {
  classifyDomRole,
  expandComponentInstances,
  formatExpansionReport,
  type LiveDomNode,
} from '@elconv/extractors';
import type { Evidence, VisualNodeIR, VisualSectionIR } from '@elconv/core';

/**
 * Node-level component expansion (v7.0 A4, node half).
 *
 * The numbers in these tests are measured, not invented. On the live project
 * (mcp.unframer.co, 2026-08-28): 59 of 161 IR nodes on `/` are component
 * instances across 23 definitions, `getNodeXml` can expand NONE of them, and the
 * rendered page carries 690 named nodes where the structural IR had 161. That is
 * the whole reason this module reads the DOM rather than the source.
 */

const MCP_EVIDENCE: Evidence = {
  sourceIds: ['n1'],
  methods: ['mcp', 'xml'],
  confidence: 0.92,
  warnings: [],
};

/** An unexpanded component instance, exactly as the IR builder emits one. */
function instance(overrides: Partial<VisualNodeIR> = {}): VisualNodeIR {
  return {
    sourceId: 'btn1',
    role: 'component',
    sourceName: 'Cta',
    componentId: 'qrtE7TDjw',
    children: [],
    evidence: {
      ...MCP_EVIDENCE,
      confidence: 0.7,
      warnings: ['component instance of qrtE7TDjw; definition not expanded in this pass'],
    },
    ...overrides,
  };
}

function section(nodes: VisualNodeIR[]): VisualSectionIR {
  return {
    sourceId: 'sec-1',
    role: 'hero',
    sourceName: 'Hero Section',
    layoutArchetype: 'stacked',
    bboxByViewport: { desktop: { x: 0, y: 0, width: 1440, height: 1194 } },
    nodes,
    evidence: MCP_EVIDENCE,
  };
}

function dom(overrides: Partial<LiveDomNode> = {}): LiveDomNode {
  return {
    framerName: 'Cta',
    tag: 'div',
    bbox: { x: 0, y: 0, width: 300, height: 41 },
    children: [],
    ...overrides,
  };
}

const OPTS = { viewportLabel: 'desktop' } as const;

describe('expandComponentInstances — grafting', () => {
  it('fills an empty instance subtree from the matched DOM node', () => {
    const domSection = dom({
      framerName: 'Hero Section',
      children: [
        dom({
          framerName: 'Cta',
          children: [
            dom({ framerName: 'Text Wrapper', tag: 'div', text: 'Get started', children: [] }),
            dom({ framerName: 'Icon Wrapper', tag: 'svg', children: [] }),
          ],
        }),
      ],
    });

    const result = expandComponentInstances(section([instance()]), domSection, OPTS);

    expect(result.report.expanded).toBe(1);
    expect(result.report.blocked).toBe(0);
    expect(result.report.nodesGrafted).toBe(2);

    const expanded = result.section.nodes[0];
    expect(expanded.children).toHaveLength(2);
    expect(expanded.children[0].text).toBe('Get started');
    expect(expanded.children[1].role).toBe('icon');
    // Identity survives: only the structural side knows this is a Button.
    expect(expanded.componentId).toBe('qrtE7TDjw');
  });

  it('does not mutate the input section', () => {
    const original = section([instance()]);
    const domSection = dom({ framerName: 'Hero Section', children: [dom({ children: [dom()] })] });

    expandComponentInstances(original, domSection, OPTS);

    expect(original.nodes[0].children).toEqual([]);
  });

  it('marks a name-verified graft with higher confidence than an order-only one', () => {
    const verified = expandComponentInstances(
      section([instance({ sourceName: 'Cta' })]),
      dom({ children: [dom({ framerName: 'Cta', children: [dom()] })] }),
      OPTS,
    );
    // A rendered instance is named after its active VARIANT, so this is the
    // common case, not an error.
    const renamed = expandComponentInstances(
      section([instance({ sourceName: 'Cta' })]),
      dom({ children: [dom({ framerName: 'Desktop', children: [dom()] })] }),
      OPTS,
    );

    expect(verified.report.instances[0].method).toBe('name+order');
    expect(renamed.report.instances[0].method).toBe('order-variant-rename');
    expect(verified.section.nodes[0].evidence.confidence).toBeGreaterThan(
      renamed.section.nodes[0].evidence.confidence,
    );
  });

  it('records dom and computed-style as evidence methods and drops the stale warning', () => {
    const result = expandComponentInstances(
      section([instance()]),
      dom({ children: [dom({ children: [dom()] })] }),
      OPTS,
    );
    const evidence = result.section.nodes[0].evidence;

    expect(evidence.methods).toContain('mcp');
    expect(evidence.methods).toContain('dom');
    // "definition not expanded" is no longer true and must not linger.
    expect(evidence.warnings.join(' ')).not.toContain('definition not expanded');
    expect(evidence.warnings.join(' ')).toContain('expanded from the live DOM');
  });

  it('applies the instance box under the given viewport label', () => {
    const result = expandComponentInstances(
      section([instance()]),
      dom({ children: [dom({ bbox: { x: 10, y: 20, width: 300, height: 41 } })] }),
      { viewportLabel: 'mobile' },
    );
    expect(result.section.nodes[0].bboxByViewport?.mobile).toEqual({ x: 10, y: 20, width: 300, height: 41 });
  });

  it('lets a structural style win over the computed literal', () => {
    // A named color style is the author's intent and can be emitted as a token;
    // a computed value is always a literal. Overwriting trades reuse for a
    // hard-coded value.
    const result = expandComponentInstances(
      section([instance({ styles: { 'background-color': 'rgb(1, 40, 60)' } })]),
      dom({ children: [dom({ styles: { 'background-color': 'rgb(2, 41, 61)', padding: '12px' } })] }),
      OPTS,
    );
    const styles = result.section.nodes[0].styles;

    expect(styles?.['background-color']).toBe('rgb(1, 40, 60)');
    // The computed side still contributes what the structural side did not have.
    expect(styles?.padding).toBe('12px');
  });

  it('expands an instance nested below the top level', () => {
    // Measured: instances sit at depth 0..11. Only expanding the top level would
    // miss most of them.
    const wrapper: VisualNodeIR = {
      sourceId: 'ctas',
      role: 'layout',
      sourceName: 'CTAs',
      children: [instance()],
      evidence: MCP_EVIDENCE,
    };
    const domSection = dom({
      children: [dom({ framerName: 'CTAs', children: [dom({ framerName: 'Cta', children: [dom(), dom()] })] })],
    });

    const result = expandComponentInstances(section([wrapper]), domSection, OPTS);

    expect(result.report.expanded).toBe(1);
    expect(result.section.nodes[0].children[0].children).toHaveLength(2);
  });

  it('pairs the only component with the only rendered variant beside structural text', () => {
    const result = expandComponentInstances(
      section([
        instance({ sourceName: 'Badge', componentId: 'badgeDef' }),
        {
          sourceId: 'heading',
          role: 'heading',
          sourceName: 'Section Heading',
          text: 'Heading',
          children: [],
          evidence: MCP_EVIDENCE,
        },
      ]),
      dom({ children: [dom({ framerName: 'Big - White', children: [dom({ text: 'Badge' })] })] }),
      OPTS,
    );

    expect(result.report.expanded).toBe(1);
    expect(result.report.blocked).toBe(0);
    expect(result.section.nodes[0].children[0].text).toBe('Badge');
  });
});

describe('expandComponentInstances — refusals', () => {
  it('grafts all rendered children when one instance is the only structural node', () => {
    // Position i on the left is then not position i on the right, so every
    // subtree below would attach to the wrong node.
    const result = expandComponentInstances(
      section([instance()]),
      dom({ children: [dom({ framerName: 'Something' }), dom({ framerName: 'Else' })] }),
      OPTS,
    );

    expect(result.report.expanded).toBe(1);
    expect(result.report.blocked).toBe(0);
    expect(result.report.instances[0].method).toBe('children-of-single-instance');
    expect(result.section.nodes[0].children).toHaveLength(2);
  });

  it('still blocks an ambiguous mismatch when structural siblings compete', () => {
    const result = expandComponentInstances(
      section([
        instance(),
        { sourceId: 'copy', role: 'text', sourceName: 'Copy', text: 'Copy', children: [], evidence: MCP_EVIDENCE },
      ]),
      dom({ children: [dom({ framerName: 'Something' }), dom({ framerName: 'Else' }), dom({ framerName: 'Third' })] }),
      OPTS,
    );

    expect(result.report.blocked).toBe(1);
    expect(result.report.instances[0].method).toBe('blocked-count-mismatch');
    expect(result.report.conflicts[0]).toContain('structural=[Cta, Copy]');
  });

  it('records a component with no named rendered children as a verified leaf', () => {
    const result = expandComponentInstances(
      section([{
        sourceId: 'wrapper',
        role: 'layout',
        sourceName: 'Wrapper',
        children: [instance()],
        evidence: MCP_EVIDENCE,
      }]),
      dom({ children: [dom({ framerName: 'Wrapper', children: [] })] }),
      OPTS,
    );

    expect(result.report.blocked).toBe(0);
    expect(result.report.instances[0].method).toBe('leaf-no-named-children');
  });

  it('leaves an already-expanded instance alone', () => {
    // A structural source that DID supply children must not be overwritten by a
    // measured tree: the structural one carries token references.
    const already = instance({
      children: [{ sourceId: 'inner', role: 'text', text: 'from source', children: [], evidence: MCP_EVIDENCE }],
    });
    const result = expandComponentInstances(
      section([already]),
      dom({ children: [dom({ children: [dom({ text: 'from dom' })] })] }),
      OPTS,
    );

    expect(result.report.instances).toEqual([]);
    expect(result.section.nodes[0].children[0].text).toBe('from source');
  });

  it('warns when the matched DOM node genuinely has no named children', () => {
    // Not a failure — a Button often renders as one element — but the caller
    // must not read `expanded` as "this now has content".
    const result = expandComponentInstances(section([instance()]), dom({ children: [dom()] }), OPTS);

    expect(result.report.expanded).toBe(1);
    expect(result.report.nodesGrafted).toBe(0);
    expect(result.report.warnings.join(' ')).toContain('stays a leaf');
  });

  it('stops grafting at the depth limit and says how much was left', () => {
    const deep = (depth: number): LiveDomNode =>
      depth === 0 ? dom({ framerName: `L${depth}` }) : dom({ framerName: `L${depth}`, children: [deep(depth - 1)] });

    const result = expandComponentInstances(
      section([instance()]),
      dom({ children: [deep(5)] }),
      { viewportLabel: 'desktop', maxDepth: 2 },
    );

    expect(result.report.warnings.join(' ')).toContain('depth limit 2');
    expect(result.report.nodesGrafted).toBeLessThan(6);
  });

  it('allocates collision-free source ids for grafted nodes', () => {
    const result = expandComponentInstances(
      section([instance()]),
      dom({ children: [dom({ children: [dom(), dom(), dom()] })] }),
      OPTS,
    );

    const ids: string[] = [];
    const walk = (nodes: readonly VisualNodeIR[]): void => {
      for (const node of nodes) {
        ids.push(node.sourceId);
        walk(node.children);
      }
    };
    walk(result.section.nodes);

    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('classifyDomRole', () => {
  it('classifies only on signals the DOM actually carries', () => {
    expect(classifyDomRole(dom({ mediaUrl: 'x.png' }), 0)).toBe('image');
    expect(classifyDomRole(dom({ backgroundImage: 'x.jpg' }), 0)).toBe('image');
    expect(classifyDomRole(dom({ tag: 'svg' }), 0)).toBe('icon');
    expect(classifyDomRole(dom({ text: 'Hi', href: '/go' }), 0)).toBe('button');
    expect(classifyDomRole(dom({ text: 'Body' }), 0)).toBe('text');
    expect(classifyDomRole(dom({ tag: 'h1', text: 'Title' }), 0)).toBe('heading');
    expect(classifyDomRole(dom(), 3)).toBe('layout');
    expect(classifyDomRole(dom(), 0)).toBe('unknown');
  });

  it('does not infer a heading from anything but the tag', () => {
    // Framer renders headings as plain divs with a text style, and a large div is
    // routinely body copy at hero scale. Guessing here produces an h1 that was
    // never one.
    expect(classifyDomRole(dom({ tag: 'div', text: 'Huge', styles: { 'font-size': '68px' } }), 0)).toBe('text');
  });

  it('reads the heading tag from the element that renders the text', () => {
    // Framer names a WRAPPER and puts the text below it, so `tag` is `div` for
    // something that renders as an <h2>. Measured on a real page: all 151 named
    // text leaves held their text in a deeper element, so trusting `tag` alone
    // classified every grafted heading as body copy.
    expect(classifyDomRole(dom({ tag: 'div', text: 'Title', textHolderTag: 'h2' }), 0)).toBe('heading');
  });

  it('still refuses a heading when the deeper element is not one', () => {
    // The measured distribution of deepest text holders is <p> 147x and <span>
    // 4x — never a heading. A non-heading holder must not promote the node.
    expect(classifyDomRole(dom({ tag: 'div', text: 'Body', textHolderTag: 'p' }), 0)).toBe('text');
    expect(classifyDomRole(dom({ tag: 'div', text: 'Body', textHolderTag: 'span' }), 0)).toBe('text');
  });

  it('prefers the node\'s own heading tag over the holder\'s', () => {
    // A node that IS an <h1> is a heading regardless of what is nested inside it.
    expect(classifyDomRole(dom({ tag: 'h1', text: 'Title', textHolderTag: 'span' }), 0)).toBe('heading');
  });

  it('treats a link wrapping ONE text element as a button', () => {
    // The shape Framer produces for a CTA: <a> around a single label wrapper.
    // The label is recoverable, so the button widget gets a caption.
    expect(classifyDomRole(dom({ tag: 'a', href: '/start', children: [dom({ text: 'Go' })] }), 1)).toBe('button');
  });

  it('keeps a link with several children as a layout, not an empty button', () => {
    // A V3 `button` widget reads its caption off this node's own `text`, and a
    // node with children has none. Measured on the live page: one such node
    // produced an empty button and failed G_SUBSTANCE_TEXT. Staying a container
    // keeps the children, which is what actually renders the CTA.
    const cta = dom({
      tag: 'a',
      href: '/start',
      children: [dom({ text: 'Go' }), dom({ tag: 'svg' })],
    });
    expect(classifyDomRole(cta, 2)).toBe('layout');
  });
});

describe('formatExpansionReport', () => {
  it('says plainly when there was nothing to expand', () => {
    const result = expandComponentInstances(
      section([{ sourceId: 'plain', role: 'text', text: 'Hi', children: [], evidence: MCP_EVIDENCE }]),
      dom({ children: [dom()] }),
      OPTS,
    );
    expect(formatExpansionReport(result.report)).toContain('no component instances');
  });

  it('names each instance with its method and node count', () => {
    const result = expandComponentInstances(
      section([instance()]),
      dom({ children: [dom({ children: [dom(), dom()] })] }),
      OPTS,
    );
    const text = formatExpansionReport(result.report);

    expect(text).toContain('btn1');
    expect(text).toContain('qrtE7TDjw');
    expect(text).toContain('+2');
  });
});

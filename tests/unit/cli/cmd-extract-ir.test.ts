import { describe, expect, it } from 'vitest';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { cmdExtractIr } from '../../../packages/cli/src/cmd-extract-ir.js';
import type { UnframerTransport } from '@elconv/extractors';
import type { VisualPageIR } from '@elconv/core';

/**
 * `elconv extract-ir` — the producer for `convert --ir`.
 *
 * The fixtures below are trimmed from a REAL Unframer MCP response
 * (mcp.unframer.co, 2026-08-28). That matters for one specific reason: the
 * `getNodeXml` dialect is not well-formed XML — comments sit inside attribute
 * lists, several roots follow each other, and non-primary breakpoints come back
 * as empty stubs. A hand-written well-formed fixture would pass while the live
 * response fails.
 */

/** Trimmed `getProjectXml`: the parts the adapter actually reads. */
const PROJECT_XML = `
<Pages>
    <Page nodeId="augiA20Il" path="/" />
    <Page nodeId="Ds59y_keB" path="/pricing" />
    <Page nodeId="isimFK9Dt" path="/blog/:slug" />
    <Page nodeId="lIKBsa3lk" path="/404" />
  </Pages>
  <Components>
    <Component nodeId="qrtE7TDjw" name="Button" />
    <Component nodeId="dUE3IkJ5U" name="Header" />
  </Components>
  <CodeComponents />
  <ColorStyles>
    <ColorStyle
        path="/Primary/900"
        light="rgb(1, 40, 60)"
        dark=""
     />
    <ColorStyle
        path="/Black and White/White"
        light="rgb(255, 255, 255)"
        dark=""
     />
  </ColorStyles>
  <TextStyles>
    <TextStyle path="/Heading 1" tag="h1" font="GF;Inter-700" fontSize="64px" lineHeight="1.1em" />
    <TextStyle path="/Body" tag="p" font="GF;Inter-400" fontSize="18px" lineHeight="1.5em" />
  </TextStyles>
`;

/**
 * Trimmed page XML in the real dialect: a comment inside the attribute list,
 * a component instance, and a text node carrying an entity.
 */
const PAGE_XML = `Node xml:
<Desktop
    nodeId="WQLkyLRf1"
    position="absolute"
    width="1200px"
    height="fit-content"
    <!-- background color string or project color style path (if starts with /) -->
    backgroundColor="white"
    layout="stack"
    stackDirection="vertical"
>
  <HeroSection
      nodeId="efkLdpMzs"
      width="1fr"
      height="fit-content"
      backgroundColor="/Primary/900"
      layout="stack"
      gap="60px"
      padding="200px 40px 120px 40px"
      stackDirection="vertical"
  >
    <Heading nodeId="RCqJooFxi" inlineTextStyle="/Heading 1" width="1fr">Let&apos;s build</Heading>
    <Copy nodeId="k1lPmQz00" inlineTextStyle="/Body" width="1fr">Body copy that is long enough to count.</Copy>
    <Cta nodeId="btn1" componentId="qrtE7TDjw" width="fit-content" title="Get started" />
  </HeroSection>
  <FooterSection
      nodeId="ftr1"
      width="1fr"
      backgroundColor="/Primary/900"
      layout="stack"
      stackDirection="vertical"
  >
    <FooterText nodeId="ftrTxt" inlineTextStyle="/Body" width="1fr">All rights reserved.</FooterText>
  </FooterSection>
</Desktop>
<!-- This is a non-primary variant -->
<Tablet nodeId="tabletRoot" width="810px" />
`;

/** A transport that answers from the fixtures and records what was asked. */
function fakeTransport(overrides: Record<string, string> = {}): UnframerTransport & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    async callTool(tool: string, args: Record<string, unknown> = {}): Promise<unknown> {
      const nodeId = typeof args.nodeId === 'string' ? args.nodeId : '';
      calls.push(nodeId ? `${tool}:${nodeId}` : tool);
      if (tool === 'getProjectXml') return overrides.project ?? PROJECT_XML;
      if (tool === 'getNodeXml') {
        if (overrides[nodeId] !== undefined) return overrides[nodeId];
        if (nodeId === 'augiA20Il') return PAGE_XML;
        // The real server's answer for a Component nodeId. Not an exception —
        // an ordinary string that happens to be an error message.
        return 'Encountered an error: Node is not a text node';
      }
      throw new Error(`unexpected tool ${tool}`);
    },
  };
}

async function withTempDir<T>(run: (dir: string) => Promise<T>): Promise<T> {
  const root = await mkdtemp(join(tmpdir(), 'elconv-extract-ir-'));
  try {
    return await run(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

describe('cmdExtractIr usage', () => {
  it('requires --route unless --list is given', async () => {
    const transport = fakeTransport();
    expect(await cmdExtractIr({}, { transport })).toBe(2);
    // Nothing was fetched: the check happens before any network call.
    expect(transport.calls).toEqual([]);
  });

  it('rejects a partial credential set instead of falling back to the environment', async () => {
    // Silently using env credentials here would extract a DIFFERENT project than
    // the one the flags name — a wrong result that looks like a success.
    expect(await cmdExtractIr({ 'unframer-url': 'https://mcp.example/mcp', route: '/' })).toBe(2);
  });

  it('lists the project routes and marks CMS templates', async () => {
    const transport = fakeTransport();
    expect(await cmdExtractIr({ list: true }, { transport })).toBe(0);
    expect(transport.calls).toEqual(['getProjectXml']);
  });

  it('refuses an unknown route', async () => {
    const transport = fakeTransport();
    expect(await cmdExtractIr({ route: '/nope' }, { transport })).toBe(2);
  });

  it('refuses a CMS template route rather than emitting one page for a collection', async () => {
    const transport = fakeTransport();
    expect(await cmdExtractIr({ route: '/blog/:slug' }, { transport })).toBe(2);
    // The page itself was never fetched — the refusal is structural.
    expect(transport.calls).toEqual(['getProjectXml']);
  });
});

describe('cmdExtractIr extraction', () => {
  it('writes a valid VisualPageIR from the real XML dialect', async () => {
    await withTempDir(async (dir) => {
      const out = join(dir, 'home-ir.json');
      const transport = fakeTransport();

      expect(await cmdExtractIr({ route: '/', out }, { transport })).toBe(0);

      const ir = JSON.parse(await readFile(out, 'utf8')) as VisualPageIR;
      expect(ir.schemaVersion).toBe('1.0');
      expect(ir.source.route).toBe('/');
      expect(ir.sections).toHaveLength(2);

      // The entity in the source text must arrive decoded — `Let&apos;s` in a
      // heading would render literally on the page.
      const heading = ir.sections[0].nodes.find((node) => node.role === 'heading');
      expect(heading?.text).toBe("Let's build");

      // The color style path resolved to its value, not carried as a path.
      expect(ir.sections[0].background?.color).toBe('rgb(1, 40, 60)');
    });
  });

  it('records a component instance as a reference, not as an empty node', async () => {
    await withTempDir(async (dir) => {
      const out = join(dir, 'home-ir.json');
      expect(await cmdExtractIr({ route: '/', out }, { transport: fakeTransport() })).toBe(0);

      const ir = JSON.parse(await readFile(out, 'utf8')) as VisualPageIR;
      const instance = ir.sections[0].nodes.find((node) => node.componentId !== undefined);

      expect(instance?.componentId).toBe('qrtE7TDjw');
      expect(instance?.role).toBe('component');
      // Lower confidence than a plain node, and the reason is on the record —
      // an unexpanded definition is a known gap, not an ordinary leaf.
      expect(instance?.evidence.confidence).toBeLessThan(0.92);
      expect(instance?.evidence.warnings.join(' ')).toContain('not expanded');
    });
  });

  it('reports zero animations as "not measured here", not as "none exist"', async () => {
    await withTempDir(async (dir) => {
      const out = join(dir, 'home-ir.json');
      expect(await cmdExtractIr({ route: '/', out }, { transport: fakeTransport() })).toBe(0);

      const ir = JSON.parse(await readFile(out, 'utf8')) as VisualPageIR;
      expect(ir.animations).toEqual([]);
      // The IR itself must carry the caveat, because a downstream reader sees the
      // file and not this command's stderr.
      expect(ir.warnings.join(' ')).toContain('structure-only extraction');
    });
  });

  it('does not fetch component definitions during a page extraction', async () => {
    // Measured live: getNodeXml answers "Node is not a text node" for 13 of 23
    // Component ids and returns a flat attribute dump for the rest — never a
    // child tree. Fetching them per page would cost 23 round trips for nothing.
    const transport = fakeTransport();
    await withTempDir(async (dir) => {
      await cmdExtractIr({ route: '/', out: join(dir, 'ir.json') }, { transport });
    });
    expect(transport.calls).toEqual(['getProjectXml', 'getNodeXml:augiA20Il']);
  });

  it('fails rather than writing an IR when the page payload is an empty wrapper', async () => {
    // A 200 response with a 71-89 byte empty wrapper is NOT a successful
    // extraction; writing it would put a file on disk that looks like one.
    const transport = fakeTransport({ augiA20Il: 'Node xml:\n<WebPageNode nodeId="x" />' });
    await withTempDir(async (dir) => {
      const out = join(dir, 'ir.json');
      expect(await cmdExtractIr({ route: '/', out }, { transport })).toBe(1);
      await expect(readFile(out, 'utf8')).rejects.toThrow();
    });
  });

  it('fails when the project reports no pages at all', async () => {
    const transport = fakeTransport({ project: '<Pages></Pages>' });
    expect(await cmdExtractIr({ route: '/', out: join(tmpdir(), 'unused.json') }, { transport })).toBe(2);
  });
});

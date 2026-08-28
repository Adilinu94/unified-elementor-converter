/**
 * Parser for the Unframer `getNodeXml` dialect.
 *
 * This is NOT well-formed XML and no standard parser accepts it. Verified
 * against the real response for the Humeen project home page (60,340 bytes):
 *
 *   1. HTML comments appear INSIDE an element's attribute list (96 of them):
 *
 *        <Hero nodeId="pFAxpVIvb" width="1fr"
 *            <!-- background color string or project color style path -->
 *            backgroundColor="/Dark" ...>
 *
 *   2. Tag names may start with a digit, which XML forbids: `<5>`, `<04>`,
 *      `<021>`. Framer derives the tag from the layer name, and a layer called
 *      "04" is legal in Framer.
 *
 *   3. The document has several roots plus comments between them — the primary
 *      breakpoint (`Desktop`) followed by non-primary `Tablet` / `Phone` stubs.
 *
 *   4. Text content carries HTML entities (`&apos;`, `&amp;`) and leading
 *      indentation that is not semantic.
 *
 * The tag name is a layer NAME, not a type. Structure comes from the
 * attributes (`layout`, `componentId`, `inlineTextStyle`, …), never from the
 * tag. `<Text>`, `<Image>` and `<Button>` are user-chosen labels that may sit
 * on any kind of node.
 *
 * @module extractors/framer/unframer-xml-parser
 */

/** A parsed Unframer node. `tag` is the layer name, never a type. */
export interface UnframerNode {
  /** Layer name as written in the XML. Not semantic. */
  tag: string;
  /** Stable Framer node id. Absent only on malformed input. */
  nodeId?: string;
  attributes: Record<string, string>;
  /** Decoded, trimmed text content. Empty when the node has no own text. */
  text: string;
  children: UnframerNode[];
}

export interface UnframerParseResult {
  /** Top-level nodes in document order. */
  roots: UnframerNode[];
  /**
   * The primary breakpoint root — the one carrying children.
   *
   * Framer returns non-primary breakpoints as empty stubs preceded by
   * "This is a non-primary variant" comments; those must not be mistaken for
   * an empty page.
   */
  primaryRoot?: UnframerNode;
  /** Roots that are declared non-primary variants (empty stubs). */
  variantRoots: UnframerNode[];
  warnings: string[];
}

const VARIANT_COMMENT = /non-primary variant/i;

/** Entities Framer emits in text content. */
const ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: '\u00a0',
  rsquo: '\u2019',
  lsquo: '\u2018',
  ldquo: '\u201c',
  rdquo: '\u201d',
  mdash: '\u2014',
  ndash: '\u2013',
  hellip: '\u2026',
};

export function decodeEntities(input: string): string {
  return input.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (match, body: string) => {
    if (body.startsWith('#x') || body.startsWith('#X')) {
      const code = Number.parseInt(body.slice(2), 16);
      return Number.isFinite(code) ? String.fromCodePoint(code) : match;
    }
    if (body.startsWith('#')) {
      const code = Number.parseInt(body.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : match;
    }
    const named = ENTITIES[body.toLowerCase()];
    return named ?? match;
  });
}

/** Normalize text content: decode entities, collapse whitespace, trim. */
export function normalizeText(raw: string): string {
  return decodeEntities(raw).replace(/\s+/g, ' ').trim();
}

interface OpenTag {
  tag: string;
  attributes: Record<string, string>;
  selfClosing: boolean;
}

/**
 * Parse the Unframer XML dialect.
 *
 * Deliberately hand-written: see the module docstring for the four measured
 * reasons a standard XML parser cannot be used here.
 */
export function parseUnframerXml(source: string): UnframerParseResult {
  const warnings: string[] = [];
  const roots: UnframerNode[] = [];
  const stack: UnframerNode[] = [];
  /** Roots preceded by a "non-primary variant" comment. */
  const variantRoots: UnframerNode[] = [];
  let pendingVariantMarker = false;

  let cursor = 0;
  let pendingText = '';

  const flushText = (): void => {
    const text = normalizeText(pendingText);
    pendingText = '';
    if (!text) return;
    const parent = stack[stack.length - 1];
    if (!parent) return; // text outside any element — Framer never emits this
    // A node's own text and its children are mutually exclusive in practice;
    // append rather than overwrite so a split text run is not silently lost.
    parent.text = parent.text ? `${parent.text} ${text}` : text;
  };

  const attach = (node: UnframerNode): void => {
    const parent = stack[stack.length - 1];
    if (parent) {
      parent.children.push(node);
      return;
    }
    roots.push(node);
    if (pendingVariantMarker) variantRoots.push(node);
    pendingVariantMarker = false;
  };

  while (cursor < source.length) {
    const lt = source.indexOf('<', cursor);
    if (lt === -1) {
      pendingText += source.slice(cursor);
      break;
    }
    pendingText += source.slice(cursor, lt);

    // Comment — may sit between elements OR inside an attribute list. Both are
    // handled the same way: skip it and keep parsing.
    if (source.startsWith('<!--', lt)) {
      const end = source.indexOf('-->', lt + 4);
      if (end === -1) {
        warnings.push('unterminated comment; ignored the remainder');
        break;
      }
      const body = source.slice(lt + 4, end);
      if (stack.length === 0 && VARIANT_COMMENT.test(body)) pendingVariantMarker = true;
      cursor = end + 3;
      continue;
    }

    if (source.startsWith('</', lt)) {
      flushText();
      const end = source.indexOf('>', lt);
      if (end === -1) {
        warnings.push('unterminated closing tag; ignored the remainder');
        break;
      }
      const name = source.slice(lt + 2, end).trim();
      closeTag(stack, name, warnings);
      cursor = end + 1;
      continue;
    }

    const parsed = readOpenTag(source, lt);
    if (!parsed) {
      // A bare `<` in text content. Keep it and move on.
      pendingText += '<';
      cursor = lt + 1;
      continue;
    }
    flushText();
    const node: UnframerNode = {
      tag: parsed.tag.tag,
      attributes: parsed.tag.attributes,
      text: '',
      children: [],
    };
    const nodeId = parsed.tag.attributes.nodeId;
    if (nodeId) node.nodeId = nodeId;
    attach(node);
    if (!parsed.tag.selfClosing) stack.push(node);
    cursor = parsed.end;
  }

  flushText();
  if (stack.length > 0) {
    warnings.push(`${stack.length} element(s) were never closed: ${stack.map((n) => n.tag).join(', ')}`);
  }

  const variantSet = new Set(variantRoots);
  const primaryRoot = roots.find((root) => !variantSet.has(root) && root.children.length > 0)
    ?? roots.find((root) => !variantSet.has(root));

  return { roots, primaryRoot, variantRoots, warnings };
}

function closeTag(stack: UnframerNode[], name: string, warnings: string[]): void {
  for (let i = stack.length - 1; i >= 0; i--) {
    if (stack[i]!.tag === name) {
      if (i !== stack.length - 1) {
        warnings.push(`closing </${name}> skipped ${stack.length - 1 - i} unclosed element(s)`);
      }
      stack.length = i;
      return;
    }
  }
  warnings.push(`closing </${name}> has no matching open tag; ignored`);
}

/**
 * Read one open tag starting at `start`, tolerating comments between
 * attributes. Returns null when this is not a tag at all.
 */
function readOpenTag(source: string, start: number): { tag: OpenTag; end: number } | null {
  // The tag name may start with a digit (`<5>`), which XML forbids but Framer
  // emits for a layer literally named "5".
  const nameMatch = /^<([A-Za-z0-9_][A-Za-z0-9_.:-]*)/.exec(source.slice(start, start + 200));
  if (!nameMatch) return null;

  const tag = nameMatch[1]!;
  let cursor = start + nameMatch[0].length;
  const attributes: Record<string, string> = {};
  let selfClosing = false;

  while (cursor < source.length) {
    // Skip whitespace.
    while (cursor < source.length && /\s/.test(source[cursor]!)) cursor++;
    if (cursor >= source.length) break;

    // A comment inside the attribute list — the reason this parser exists.
    if (source.startsWith('<!--', cursor)) {
      const end = source.indexOf('-->', cursor + 4);
      if (end === -1) break;
      cursor = end + 3;
      continue;
    }

    if (source.startsWith('/>', cursor)) {
      selfClosing = true;
      cursor += 2;
      break;
    }
    if (source[cursor] === '>') {
      cursor += 1;
      break;
    }

    const attrMatch = /^([A-Za-z_][A-Za-z0-9_.:-]*)\s*(=\s*)?/.exec(source.slice(cursor));
    if (!attrMatch) {
      cursor++; // unexpected character; do not spin
      continue;
    }
    const attrName = attrMatch[1]!;
    cursor += attrMatch[0].length;

    if (!attrMatch[2]) {
      // Valueless attribute. Framer does not emit these, but treat as boolean.
      attributes[attrName] = '';
      continue;
    }

    const quote = source[cursor];
    if (quote === '"' || quote === "'") {
      const end = source.indexOf(quote, cursor + 1);
      if (end === -1) break;
      attributes[attrName] = decodeEntities(source.slice(cursor + 1, end));
      cursor = end + 1;
      continue;
    }
    // Unquoted value — read to the next whitespace or tag end.
    const unquoted = /^[^\s>]*/.exec(source.slice(cursor))![0];
    attributes[attrName] = decodeEntities(unquoted);
    cursor += unquoted.length;
  }

  return { tag: { tag, attributes, selfClosing }, end: cursor };
}

// ============================================================================
// Tree helpers
// ============================================================================

/** Depth-first walk over a node and its descendants. */
export function walkUnframerNodes(
  node: UnframerNode,
  visit: (node: UnframerNode, depth: number, parent?: UnframerNode) => void,
  depth = 0,
  parent?: UnframerNode,
): void {
  visit(node, depth, parent);
  for (const child of node.children) walkUnframerNodes(child, visit, depth + 1, node);
}

/** Count all nodes in a subtree, inclusive. */
export function countUnframerNodes(node: UnframerNode): number {
  let count = 0;
  walkUnframerNodes(node, () => { count++; });
  return count;
}

/**
 * structuralHash — deterministic structural signature of a tree (or forest).
 *
 * Two node arrays that share the same nesting shape (and, when `includeTag`
 * is set, the same element tags/types at each position) produce the same
 * hash. Used to detect repeated container patterns (e.g. Framer component
 * candidates) without comparing content or props.
 *
 * Dependency-free (DJB2 → hex) so the hash is stable across runs and processes.
 */

export interface StructuralHashOptions {
  /** Include each node's tag/type in the signature (default: false). */
  includeTag?: boolean;
  /** Stop descending below this depth (default: unlimited). */
  maxDepth?: number;
}

interface HashableNode {
  tag?: unknown;
  elType?: unknown;
  widgetType?: unknown;
  type?: unknown;
  elements?: unknown;
  children?: unknown;
  [key: string]: unknown;
}

function nodeTag(node: HashableNode): string {
  const tag = node.tag ?? node.elType ?? node.widgetType ?? node.type;
  return tag === undefined || tag === null ? '' : String(tag);
}

function childrenOf(node: HashableNode): HashableNode[] {
  const raw = node.elements ?? node.children;
  return Array.isArray(raw) ? (raw as HashableNode[]) : [];
}

function signature(node: HashableNode, options: StructuralHashOptions, depth: number): string {
  const tag = options.includeTag ? nodeTag(node) : '';
  const atMaxDepth = options.maxDepth !== undefined && depth >= options.maxDepth;
  const kids = atMaxDepth ? [] : childrenOf(node);
  const childSig = kids.map((child) => signature(child ?? {}, options, depth + 1)).join(',');
  return `${tag}(${childSig})`;
}

/** DJB2 string hash rendered as zero-padded hex. */
function djb2(input: string): string {
  let hash = 5381;
  for (let i = 0; i < input.length; i++) {
    hash = ((hash << 5) + hash + input.charCodeAt(i)) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

/**
 * Compute a structural hash for a single node or a forest (array of nodes).
 * The result is a non-empty hex string, so callers can treat it as truthy.
 */
export function structuralHash(input: unknown, options: StructuralHashOptions = {}): string {
  const nodes: HashableNode[] = Array.isArray(input)
    ? (input as HashableNode[])
    : [input as HashableNode];
  const forest = nodes.map((node) => signature(node ?? {}, options, 0)).join('|');
  return djb2(forest);
}

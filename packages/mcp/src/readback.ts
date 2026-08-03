/**
 * Elementor read-back verification.
 *
 * A successful mutation response is not proof that WordPress persisted the
 * intended tree. This module reads the saved Elementor content and compares a
 * canonical semantic representation that ignores server-generated identifiers
 * while retaining element kinds, nesting, and settings/content.
 */

import type { McpAdapter } from './adapter.js';

export interface ElementorReadBack {
  postId: number;
  content: unknown[];
  elementCount?: number;
}

export interface TreeVerificationResult {
  verified: boolean;
  expectedElementCount: number;
  actualElementCount: number;
  expectedSignature: string;
  actualSignature: string;
  issues: string[];
}

interface RawElementorContent {
  success?: boolean;
  post_id?: number;
  content?: unknown[];
  element_count?: number;
  error?: string;
}

interface MutationResult {
  success?: boolean;
  error?: string;
  message?: string;
}

/**
 * Unwrap the response shape returned by different MCP transports.
 *
 * The adapter normally returns the decoded ability payload directly, while
 * REST/legacy bridges may retain a `data` or `result` envelope. We only unwrap
 * when the current object does not contain the field the caller requires;
 * explicit root-level failures therefore remain visible and cannot turn into
 * false-positive deploys.
 */
export function unwrapMcpPayload<T>(response: unknown, requiredKey: string): T {
  let current: unknown = response;

  for (let depth = 0; depth < 3; depth++) {
    if (!isRecord(current)) return current as T;
    if (Object.prototype.hasOwnProperty.call(current, requiredKey)) return current as T;
    if (current.success === false) return current as T;

    const nested = current.data ?? current.result;
    if (!isRecord(nested)) return current as T;
    current = nested;
  }

  return current as T;
}

const READ_CONTENT_ABILITY = 'novamira/elementor-get-content';
const CLEAR_CACHE_ABILITY = 'novamira/elementor-clear-document-cache';

/** Read the complete persisted Elementor tree for a post. */
export async function readElementorContent(
  adapter: McpAdapter,
  postId: number,
): Promise<ElementorReadBack> {
  const rawResponse = await adapter.executeAbility<RawElementorContent>(READ_CONTENT_ABILITY, {
    post_id: postId,
    full_dump: true,
  });
  const response = unwrapMcpPayload<RawElementorContent>(rawResponse, 'content');

  // A complete content array is the semantic success signal for this
  // read-only operation. Some live bridges omit `success` in the data wrapper;
  // explicit failures are still rejected by the check below.
  if (!response || response.success === false) {
    throw new Error(`readElementorContent(${postId}) failed: ${response?.error ?? 'MCP did not confirm success'}`);
  }
  if (!Array.isArray(response.content)) {
    throw new Error(`readElementorContent(${postId}) returned no element tree`);
  }

  return {
    postId: response.post_id ?? postId,
    content: response.content,
    elementCount: response.element_count,
  };
}

/** Clear the canonical Elementor document cache for a post. */
export async function clearElementorDocumentCache(
  adapter: McpAdapter,
  postId: number,
): Promise<void> {
  const rawResponse = await adapter.executeAbility<MutationResult>(CLEAR_CACHE_ABILITY, {
    post_ids: [postId],
  });
  const response = unwrapMcpPayload<MutationResult>(rawResponse, 'success');
  if (!response || response.success !== true) {
    throw new Error(`clear Elementor cache failed: ${response?.error ?? response?.message ?? 'MCP did not confirm success'}`);
  }
}

/** Clear cache, read back the page, and compare it to the expected tree. */
export async function verifyPersistedTree(
  adapter: McpAdapter,
  postId: number,
  expected: unknown[],
): Promise<TreeVerificationResult> {
  await clearElementorDocumentCache(adapter, postId);
  const readBack = await readElementorContent(adapter, postId);
  return verifyElementTree(expected, readBack.content);
}

/**
 * Compare expected and persisted trees while ignoring generated IDs.
 *
 * Elementor/WordPress may add IDs during persistence. Those IDs are not part
 * of the source contract, but element type, widget type, nesting and settings
 * are. The canonical JSON representation makes object-key ordering irrelevant.
 */
export function verifyElementTree(
  expected: unknown[],
  actual: unknown[],
): TreeVerificationResult {
  const expectedSignature = semanticSignature(expected);
  const actualSignature = semanticSignature(actual);
  const expectedElementCount = countElements(expected);
  const actualElementCount = countElements(actual);
  const issues: string[] = [];

  if (expectedElementCount !== actualElementCount) {
    issues.push(`element count mismatch: expected ${expectedElementCount}, actual ${actualElementCount}`);
  }
  if (expectedSignature !== actualSignature) {
    issues.push('semantic tree mismatch: element types, nesting, settings, or content differ');
  }

  return {
    verified: issues.length === 0,
    expectedElementCount,
    actualElementCount,
    expectedSignature,
    actualSignature,
    issues,
  };
}

/** Count element objects recursively, including root elements. */
export function countElements(input: unknown): number {
  if (Array.isArray(input)) return input.reduce((sum, item) => sum + countElements(item), 0);
  if (!isRecord(input)) return 0;

  const children = Array.isArray(input.elements)
    ? input.elements.reduce((sum, item) => sum + countElements(item), 0)
    : 0;
  return 1 + children;
}

function semanticSignature(input: unknown): string {
  return JSON.stringify(canonicalize(input));
}

function canonicalize(input: unknown): unknown {
  if (Array.isArray(input)) return input.map(canonicalize);
  if (!isRecord(input)) return input;

  const output: Record<string, unknown> = {};
  for (const key of Object.keys(input).sort()) {
    if (isGeneratedIdentifier(key)) continue;
    output[key] = canonicalize(input[key]);
  }
  return output;
}

function isGeneratedIdentifier(key: string): boolean {
  return key === 'id'
    || key === '_id'
    || key === 'element_id'
    || key === '_element_id'
    || key === 'widget_id'
    || key === '_widget_id';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

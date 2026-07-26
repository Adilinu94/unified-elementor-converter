/**
 * Branded types prevent accidental mixing of V3 and V4 trees at compile time.
 * A function accepting V3ElementTree CANNOT receive a V4ElementTree.
 *
 * KRITISCH: Diese Datei ist die wichtigste Anti-Contamination-Maßnahme.
 * NIEMALS ändern ohne Phase "Breaking".
 */

// Unique symbols for branding (exist only at type level)
declare const __v3Brand: unique symbol;
declare const __v4Brand: unique symbol;

/**
 * V3ElementTree is a validated and branded V3 element array.
 * You CANNOT pass a raw array — you must call brandV3Tree() first.
 */
export type V3ElementTree = unknown[] & { readonly [__v3Brand]: true };

/**
 * V4ElementTree is a validated and branded V4 element array.
 * You CANNOT pass a raw array — you must call brandV4Tree() first.
 */
export type V4ElementTree = unknown[] & { readonly [__v4Brand]: true };

/**
 * Target discriminator — used throughout the system to route logic.
 */
export type ElementorTarget = 'v3' | 'v4';

/**
 * Brand a validated V3 tree. Call ONLY after guards pass.
 */
export function brandV3Tree(tree: unknown[]): V3ElementTree {
  return tree as V3ElementTree;
}

/**
 * Brand a validated V4 tree. Call ONLY after guards pass.
 */
export function brandV4Tree(tree: unknown[]): V4ElementTree {
  return tree as V4ElementTree;
}

/**
 * Type guard: check if a value is a V3ElementTree (runtime check via brand symbol presence).
 * Note: At runtime, branded types are just arrays. This checks structural hints.
 */
export function isV3Tree(tree: unknown): tree is V3ElementTree {
  if (!Array.isArray(tree)) return false;
  // Heuristic: V3 trees have elType with container/section/column/widget
  return tree.every(
    (el: unknown) =>
      typeof el === 'object' &&
      el !== null &&
      'elType' in el &&
      ['section', 'column', 'widget', 'container'].includes(
        (el as Record<string, unknown>).elType as string,
      ),
  );
}

/**
 * Type guard: check if a value is a V4ElementTree (runtime check via structural hints).
 */
export function isV4Tree(tree: unknown): tree is V4ElementTree {
  if (!Array.isArray(tree)) return false;
  // Heuristic: V4 trees have type starting with 'e-'
  return tree.every(
    (el: unknown) =>
      typeof el === 'object' &&
      el !== null &&
      'type' in el &&
      typeof (el as Record<string, unknown>).type === 'string' &&
      ((el as Record<string, unknown>).type as string).startsWith('e-'),
  );
}

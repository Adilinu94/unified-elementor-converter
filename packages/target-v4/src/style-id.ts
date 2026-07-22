/**
 * Style-ID generation and validation for Elementor V4.
 * KRITISCH: Style-IDs dürfen KEINE Bindestriche enthalten.
 * Format: /^[a-z][a-z0-9_]*$/
 */

const STYLE_ID_REGEX = /^[a-z][a-z0-9_]*$/;

/**
 * Validate a style ID. Must match /^[a-z][a-z0-9_]*$/
 */
export function isValidStyleId(id: string): boolean {
  return STYLE_ID_REGEX.test(id);
}

/**
 * Sanitize a string into a valid style ID.
 * Replaces hyphens and invalid chars with underscores.
 */
export function sanitizeStyleId(input: string): string {
  let id = input
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '');

  // Must start with a letter
  if (!id || /^[0-9_]/.test(id)) {
    id = `s_${id}`;
  }

  return id;
}

let styleIdCounter = 0;

/**
 * Generate a unique style ID from a label.
 */
export function generateStyleId(label: string): string {
  const base = sanitizeStyleId(label);
  return `${base}_${(++styleIdCounter).toString(36)}`;
}

/** Reset counter for deterministic tests */
export function resetStyleIdCounter(): void {
  styleIdCounter = 0;
}

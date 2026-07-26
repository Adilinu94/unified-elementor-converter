/**
 * Generates a V3-compatible 7-character hex element ID.
 * V3-IDs are 7-stellige Hex-Strings (e.g. "a3f8d2c").
 * nanoid would produce URL-safe base64-like strings with invalid characters.
 */
import { randomBytes } from 'node:crypto';

export function v3Id(): string {
  return randomBytes(4).toString('hex').substring(0, 7);
}

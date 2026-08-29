/**
 * `esc_url()`-safe media URLs — a reproduced silent-loss class.
 *
 * The values in these tests are not invented. A real converted page deployed
 * cleanly to a live WordPress (MCP write successful, read-back showing all 11
 * sections and 102,885 bytes, schema gate 0 errors against Elementor 4.2.3) and
 * four of six images still rendered blank. `esc_url()` was called on the live
 * server to find out why:
 *
 * ```
 * esc_url('data:image/svg+xml,<svg display="block" …>')
 *   → 'data:image/svg+xml,svg%20display=block%20role=presentation%20viewBox=0'   raw_survives: false
 * esc_url('data:image/svg+xml;base64,PHN2Zy…')                                   b64_survives: true
 * esc_url('data:image/svg+xml,%3Csvg%20xmlns…')                                  pct_survives: true
 * ```
 */

import { describe, expect, it } from 'vitest';
import { normalizeMediaUrlForWordPress } from '@elconv/core';

/**
 * A local stand-in for WordPress `esc_url()`'s destructive behaviour.
 *
 * Only the part that matters is modelled: the characters it STRIPS rather than
 * encodes, confirmed against the live server. This lets every assertion below
 * state the real property — "the URL survives escaping" — instead of merely
 * checking that a string starts with `;base64,`.
 */
function escUrlStrip(url: string): string {
  return url.replace(/[<>"'`\s]/g, '');
}

describe('normalizeMediaUrlForWordPress', () => {
  const RAW_SVG = 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect width="10" height="10"/></svg>';

  it('rewrites a raw SVG data URI, which does NOT survive esc_url', () => {
    // Prove the premise first: without the rewrite the URI is destroyed.
    expect(escUrlStrip(RAW_SVG)).not.toBe(RAW_SVG);
    expect(escUrlStrip(RAW_SVG)).not.toContain('<svg');

    const result = normalizeMediaUrlForWordPress(RAW_SVG);
    expect(result.rewritten).toBe(true);
    expect(result.reason).toContain('esc_url');
    // And the rewritten form does survive.
    expect(escUrlStrip(result.url)).toBe(result.url);
  });

  it('produces a base64 payload that decodes back to the original markup', () => {
    // A rewrite that changed the bytes would be a silent corruption of its own.
    const result = normalizeMediaUrlForWordPress(RAW_SVG);
    const [meta, payload] = result.url.split(',');
    expect(meta).toBe('data:image/svg+xml;base64');
    expect(Buffer.from(payload!, 'base64').toString('utf8'))
      .toBe('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect width="10" height="10"/></svg>');
  });

  it('leaves an https URL untouched', () => {
    const url = 'https://framerusercontent.com/images/AMwgF9Crfb6QMJYduglXzstULM.jpg';
    const result = normalizeMediaUrlForWordPress(url);
    expect(result).toEqual({ url, rewritten: false });
    expect(escUrlStrip(url)).toBe(url);
  });

  it('leaves an already-base64 data URI untouched', () => {
    const url = 'data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=';
    expect(normalizeMediaUrlForWordPress(url)).toEqual({ url, rewritten: false });
  });

  it('leaves an already percent-encoded data URI untouched', () => {
    // It survives esc_url as-is, so re-encoding it would be a change with no
    // purpose — and would alter an asset the author wrote deliberately.
    const url = 'data:image/svg+xml,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%2F%3E';
    const result = normalizeMediaUrlForWordPress(url);
    expect(result.rewritten).toBe(false);
    expect(escUrlStrip(url)).toBe(url);
  });

  it('decodes a mixed raw/percent-encoded payload before re-encoding', () => {
    // A DOM-captured URI is often half-encoded. Base64-encoding it verbatim
    // would preserve the literal `%3C`, so the browser would receive it as text
    // inside the SVG rather than as a tag.
    const mixed = 'data:image/svg+xml,%3Csvg viewBox="0 0 1 1"%3E%3C/svg%3E';
    const result = normalizeMediaUrlForWordPress(mixed);
    expect(result.rewritten).toBe(true);
    const decoded = Buffer.from(result.url.split(',')[1]!, 'base64').toString('utf8');
    expect(decoded).toBe('<svg viewBox="0 0 1 1"></svg>');
    expect(decoded).not.toContain('%3C');
  });

  it('keeps a malformed percent escape rather than corrupting the asset', () => {
    // `decodeURIComponent` throws on `%zz`. Guessing which `%` was literal would
    // silently change the payload, so the raw bytes are the honest input.
    const malformed = 'data:image/svg+xml,<svg>100%zz</svg>';
    const result = normalizeMediaUrlForWordPress(malformed);
    expect(result.rewritten).toBe(true);
    expect(Buffer.from(result.url.split(',')[1]!, 'base64').toString('utf8'))
      .toBe('<svg>100%zz</svg>');
  });

  it('leaves a data URI with no unsafe character alone', () => {
    // The check is for characters that actually break, not for the encoding
    // label — so a clean payload is not re-encoded for symmetry.
    const url = 'data:text/plain,hello-world';
    expect(normalizeMediaUrlForWordPress(url)).toEqual({ url, rewritten: false });
  });

  it('preserves media-type parameters when it rewrites', () => {
    // `data:image/svg+xml;charset=utf-8,<svg/>` is a legal and common form.
    // Dropping the charset would be a change to the asset's declaration, so the
    // base64 marker is appended AFTER the existing parameters, per RFC 2397.
    const result = normalizeMediaUrlForWordPress('data:image/svg+xml;charset=utf-8,<svg/>');
    expect(result.rewritten).toBe(true);
    expect(result.url.startsWith('data:image/svg+xml;charset=utf-8;base64,')).toBe(true);
    expect(Buffer.from(result.url.split(',')[1]!, 'base64').toString('utf8')).toBe('<svg/>');
  });

  it('does not treat a non-data string as a data URI', () => {
    expect(normalizeMediaUrlForWordPress('').rewritten).toBe(false);
    expect(normalizeMediaUrlForWordPress('data:').rewritten).toBe(false);
    expect(normalizeMediaUrlForWordPress('/wp-content/uploads/x.svg').rewritten).toBe(false);
  });
});

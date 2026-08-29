/**
 * Make a media URL survive WordPress's `esc_url()` — a reproduced silent-loss
 * class, not a theoretical hardening step.
 *
 * ## What was measured
 *
 * A real converted page deployed cleanly to a live WordPress: the MCP write
 * succeeded, the read-back showed all 11 sections and 102,885 bytes of
 * `_elementor_data`, `_elementor_edit_mode` was `builder`, and the schema gate
 * reported 0 errors against the live Elementor 4.2.3 schema. Four of six images
 * still did not render.
 *
 * The cause, verified by calling `esc_url()` on the live server:
 *
 * ```
 * esc_url('data:image/svg+xml,<svg display="block" …>')
 *   → 'data:image/svg+xml,svg%20display=block%20role=presentation%20viewBox=0'
 * ```
 *
 * `esc_url()` strips `<`, `>`, `"` and `'` outright rather than encoding them.
 * A raw-SVG data URI therefore loses the very characters that make it SVG, and
 * what reaches the browser is a valid-looking URI containing no markup at all.
 * There is no error anywhere: WordPress reports a successful write, Elementor
 * renders an `<img>`, and the image is simply blank.
 *
 * Two forms DO survive, both verified on the same server in the same call:
 *
 * ```
 * esc_url('data:image/svg+xml;base64,PHN2Zy…')      → unchanged
 * esc_url('data:image/svg+xml,%3Csvg%20xmlns…')     → unchanged
 * ```
 *
 * base64 is chosen over percent-encoding because it is shorter for SVG payloads
 * (the measured assets are 2.3–3.9 KB of markup, which percent-encodes to
 * roughly 1.6× while base64 is a fixed 1.33×) and because it contains no
 * characters `esc_url` has an opinion about at all.
 *
 * ## Why this is not the extractor's job
 *
 * The IR is target-neutral: a data URI is a perfectly good asset reference, and
 * a different target might prefer the raw form. The transformation belongs at
 * the boundary where the target's escaping behaviour is known, which is here.
 */

/**
 * A data URI, split into media type (with any parameters), the base64 marker and
 * the payload.
 *
 * The parameter group is not decoration: `data:image/svg+xml;charset=utf-8,<svg/>`
 * is a legal and common form, and a pattern that only allowed `;base64` after
 * the type failed to match it entirely — so the URI fell through unrewritten and
 * `esc_url()` destroyed it, which is the exact failure this module exists to
 * prevent. The base64 marker must be recognised only in LAST position, because
 * that is where RFC 2397 puts it.
 */
const DATA_URI_PATTERN = /^data:([^,]*?)(;base64)?,(.*)$/s;

/**
 * Characters `esc_url()` removes rather than encodes, verified live.
 *
 * The list is deliberately the ones that BREAK markup, not every character
 * `esc_url` touches: a URI containing none of these round-trips unchanged, so
 * testing for them is what decides whether a rewrite is needed at all.
 */
const ESC_URL_STRIPPED = /[<>"'`\s]/;

export interface MediaUrlNormalization {
  /** The URL to write. Unchanged when no rewrite was needed. */
  url: string;
  /**
   * True when the URL was rewritten to survive `esc_url()`. Reported so a run
   * report can state that an asset was re-encoded rather than passed through.
   */
  rewritten: boolean;
  /** Why the rewrite happened, for the report. Absent when none did. */
  reason?: string;
}

/**
 * Rewrite a media URL into a form `esc_url()` preserves.
 *
 * Non-data URLs pass through untouched: an `https://` URL has no characters
 * `esc_url` strips, and rewriting it would be a change with no purpose.
 *
 * A data URI that is already base64 or already percent-encoded also passes
 * through — the check is for the characters that actually break, not for the
 * encoding label, so an SVG that happens to contain no unsafe character is left
 * alone rather than re-encoded for symmetry.
 */
export function normalizeMediaUrlForWordPress(url: string): MediaUrlNormalization {
  if (!url.startsWith('data:')) return { url, rewritten: false };

  const match = DATA_URI_PATTERN.exec(url);
  if (match === null) return { url, rewritten: false };

  const [, mediaType, base64Marker, payload] = match;
  // Already base64: nothing esc_url objects to.
  if (base64Marker !== undefined) return { url, rewritten: false };
  // Percent-encoded or otherwise clean: leave it as the author wrote it.
  if (!ESC_URL_STRIPPED.test(payload!)) return { url, rewritten: false };

  const encoded = Buffer.from(decodePayload(payload!), 'utf8').toString('base64');
  return {
    url: `data:${mediaType};base64,${encoded}`,
    rewritten: true,
    reason:
      'raw data URI re-encoded as base64 because esc_url() STRIPS <, >, " and \' rather than '
      + 'encoding them, which silently turns an inline SVG into a blank image',
  };
}

/**
 * Decode a partially percent-encoded payload before re-encoding as base64.
 *
 * A DOM-captured data URI is often mixed: some characters percent-encoded by the
 * source, the rest raw. Base64-encoding that verbatim would preserve the `%xx`
 * sequences literally, so the browser would receive `%3Csvg` as text inside the
 * SVG rather than as a tag. Decoding first is what makes the two forms
 * equivalent.
 *
 * A malformed escape makes `decodeURIComponent` throw; the raw payload is then
 * the honest input, because guessing which `%` was meant literally would corrupt
 * the asset.
 */
function decodePayload(payload: string): string {
  try {
    return decodeURIComponent(payload);
  } catch {
    return payload;
  }
}

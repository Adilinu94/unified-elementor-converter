/**
 * QA viewports come from the reference, not from a repo-wide guess.
 *
 * The payload and the widths in these tests are the real ones. The reference
 * `https://loud-alternative-352151.framer.app/` server-renders:
 *
 * ```
 * [{"mediaQuery":"(min-width: 1200px)"},
 *  {"mediaQuery":"(min-width: 810px) and (max-width: 1199.98px)"},
 *  {"mediaQuery":"(max-width: 809.98px)"}]
 * ```
 *
 * and driving it across that boundary gives two different layouts:
 *
 * | width | documentHeight | h1 font-size |
 * |-------|----------------|--------------|
 * | 1440  | 16612          | 150px        |
 * | 810   | 17529          | 120px        |
 * | 809   | 10190          |  52px        |
 * | 768   | 10060          |  52px        |
 *
 * The old default of 768px therefore compared the reference's PHONE variant
 * against the target's desktop layout and reported it as a "tablet" score of 41.
 */

import { describe, expect, it } from 'vitest';
import {
  labelWidths,
  parseViewportWidths,
  readFramerBreakpointsFromHtml,
  resolveQaViewports,
  QA_FALLBACK_VIEWPORTS,
} from '../../../packages/cli/src/qa-viewports.js';

/** The verbatim payload from the live reference. */
const REAL_PAYLOAD =
  '[{"hash":"72rtr7","mediaQuery":"(min-width: 1200px)"},'
  + '{"hash":"5umvoy","mediaQuery":"(min-width: 810px) and (max-width: 1199.98px)"},'
  + '{"hash":"5a698","mediaQuery":"(max-width: 809.98px)"},'
  + '{"hash":"1ecbl2r","mediaQuery":"(max-width: 809.98px)"},'
  + '{"hash":"irub8b","mediaQuery":"(min-width: 810px) and (max-width: 1199.98px)"},'
  + '{"hash":"wnh5e0","mediaQuery":"(min-width: 1200px)"}]';

function framerDocument(payload: string): string {
  return `<!DOCTYPE html><html><head>
    <script type="framer/appear" id="__framer__breakpoints">${payload}</script>
  </head><body><div id="main"></div></body></html>`;
}

describe('readFramerBreakpointsFromHtml', () => {
  it('finds the payload in a server-rendered Framer document', () => {
    expect(readFramerBreakpointsFromHtml(framerDocument(REAL_PAYLOAD))).toBe(REAL_PAYLOAD);
  });

  it('returns null for a document that is not a Framer render', () => {
    expect(readFramerBreakpointsFromHtml('<html><body><h1>hello</h1></body></html>')).toBeNull();
  });

  it('does not confuse a different Framer script for the breakpoint payload', () => {
    const html = '<script id="__framer__appearAnimationsContent">{"a":1}</script>';
    expect(readFramerBreakpointsFromHtml(html)).toBeNull();
  });
});

describe('resolveQaViewports', () => {
  it('derives 1200/810/390 from the real reference payload, NOT the 1440/768/390 default', async () => {
    const resolved = await resolveQaViewports({
      refUrl: 'https://loud-alternative-352151.framer.app/',
      fetchHtml: async () => framerDocument(REAL_PAYLOAD),
    });

    expect(resolved.source).toBe('source-breakpoints');
    expect(resolved.viewports.map((v) => v.width)).toEqual([1200, 810, 390]);
    // The whole point: 768 lands on the phone side of the 810px boundary.
    expect(resolved.viewports.map((v) => v.width)).not.toContain(768);
  });

  it('labels the derived bands widest-first and names the middle band tablet', async () => {
    const resolved = await resolveQaViewports({
      refUrl: 'https://x.example',
      fetchHtml: async () => framerDocument(REAL_PAYLOAD),
    });
    expect(resolved.viewports.map((v) => v.label)).toEqual(['desktop', 'tablet', 'mobile']);
  });

  it('reports the max-width-only band as a convention, not as measured data', async () => {
    // The 390px width is NOT in the payload — the third band only declares
    // max-width: 809.98px. The probe picks 390 by convention and must say so.
    const resolved = await resolveQaViewports({
      refUrl: 'https://x.example',
      fetchHtml: async () => framerDocument(REAL_PAYLOAD),
    });
    expect(resolved.warnings.some((w) => w.includes('convention'))).toBe(true);
  });

  it('treats explicit --viewports as an instruction that overrides the source', async () => {
    let fetched = false;
    const resolved = await resolveQaViewports({
      refUrl: 'https://x.example',
      explicitWidths: [1600, 900],
      fetchHtml: async () => {
        fetched = true;
        return framerDocument(REAL_PAYLOAD);
      },
    });
    expect(resolved.source).toBe('caller');
    expect(resolved.viewports.map((v) => v.width)).toEqual([1600, 900]);
    // No point paying for a fetch whose answer is discarded.
    expect(fetched).toBe(false);
  });

  it('falls back with a warning when the reference declares no breakpoints', async () => {
    const resolved = await resolveQaViewports({
      refUrl: 'https://not-framer.example',
      fetchHtml: async () => '<html><body>plain</body></html>',
    });
    expect(resolved.source).toBe('fallback');
    expect(resolved.viewports).toEqual([...QA_FALLBACK_VIEWPORTS]);
    expect(resolved.warnings.length).toBeGreaterThan(0);
  });

  it('falls back with the fetch error in the warning, never silently', async () => {
    const resolved = await resolveQaViewports({
      refUrl: 'https://unreachable.example',
      fetchHtml: async () => {
        throw new Error('ENOTFOUND');
      },
    });
    expect(resolved.source).toBe('fallback');
    expect(resolved.warnings.join(' ')).toContain('ENOTFOUND');
  });

  it('falls back when there is no reference at all', async () => {
    const resolved = await resolveQaViewports({});
    expect(resolved.source).toBe('fallback');
    expect(resolved.warnings.join(' ')).toContain('no reference URL');
  });
});

describe('labelWidths', () => {
  it('sorts widest-first and de-duplicates', () => {
    const { viewports } = labelWidths([390, 1200, 390, 810]);
    expect(viewports.map((v) => v.width)).toEqual([1200, 810, 390]);
  });

  it('names a two-band source desktop/mobile, not desktop/tablet', () => {
    // A single breakpoint is a phone split far more often than a tablet one, and
    // a wrong name here puts a phone capture in a directory called "tablet".
    const { viewports } = labelWidths([1200, 390]);
    expect(viewports.map((v) => v.label)).toEqual(['desktop', 'mobile']);
  });

  it('names a four-band source wide/desktop/tablet/mobile', () => {
    const { viewports } = labelWidths([1920, 1200, 810, 390]);
    expect(viewports.map((v) => v.label)).toEqual(['wide', 'desktop', 'tablet', 'mobile']);
  });

  it('reports the widths it SKIPS when a source declares more bands than the pipeline carries', () => {
    // The diff pipeline's viewport field is a four-value union. Dropping a band
    // narrows the measured surface, so it must be stated, not swallowed.
    const { viewports, warnings } = labelWidths([1920, 1400, 1200, 810, 390]);
    expect(viewports).toHaveLength(4);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('SKIPPED');
    expect(warnings[0]).toContain('390');
  });

  it('assigns heights by the shared convention, not per-call guesses', () => {
    const { viewports } = labelWidths([1200, 810, 390]);
    expect(viewports.map((v) => v.height)).toEqual([900, 1024, 844]);
  });
});

describe('parseViewportWidths', () => {
  it('parses a comma list', () => {
    expect(parseViewportWidths('1200,810,390')).toEqual([1200, 810, 390]);
  });

  it('tolerates surrounding whitespace', () => {
    expect(parseViewportWidths(' 1200 , 810 ')).toEqual([1200, 810]);
  });

  it('returns undefined for an absent or empty flag', () => {
    expect(parseViewportWidths(undefined)).toBeUndefined();
    expect(parseViewportWidths('   ')).toBeUndefined();
  });

  it('rejects a malformed entry instead of dropping it', () => {
    // Silently skipping "81O" (letter O) would shrink the measured surface
    // without telling anyone.
    expect(() => parseViewportWidths('1200,81O,390')).toThrow(/not a positive integer/);
    expect(() => parseViewportWidths('1200,-390')).toThrow(/not a positive integer/);
    expect(() => parseViewportWidths('1200,390.5')).toThrow(/not a positive integer/);
  });
});

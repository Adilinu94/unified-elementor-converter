/**
 * `captureLiveNodeTree` against a real browser, on Framer's actual DOM shape.
 *
 * ## Why this needs a browser rather than a unit test
 *
 * The whole behaviour under test is computed-style resolution: which ELEMENT a
 * value is read from, and what the cascade produces there. A fake `Page` would
 * return whatever the fake decided, so the assertion would be about the fake.
 *
 * ## The shape being reproduced
 *
 * Measured on a real Framer render (precious-board-067119, 2026-08-29): Framer
 * puts `data-framer-name` on a WRAPPER and the text one or more levels below it.
 * All 151 named text leaves on that page held their text in a deeper element,
 * and 125 of them had a wrapper whose computed `font-size` differed from it —
 * the wrapper reporting the inherited page default of 12px while the text
 * rendered at 72px.
 *
 * The consequence was a silent, uniform corruption: every text node in the IR
 * carried 12px. A responsive diff built on it found ZERO font-size changes
 * across breakpoints on a page whose headings scale 72 → 56 → 40px.
 *
 * The tag distribution matters too. The deepest text holder was `<p>` 147 times
 * and `<span>` 4 times — never a heading — because Framer emits
 * `<h1><span>text</span></h1>`. So the heading level has to come from BETWEEN
 * the wrapper and the holder, not from the holder itself.
 */

import { describe, it, expect } from 'vitest';

async function hasBrowserRuntime(): Promise<boolean> {
  try {
    const { chromium } = await import('playwright');
    const browser = await chromium.launch({ headless: true });
    await browser.close();
    return true;
  } catch {
    return false;
  }
}

const HAS_BROWSER = await hasBrowserRuntime();

/**
 * A page in Framer's measured shape.
 *
 * `body { font-size: 12px }` is the inherited default that made the bug silent:
 * the named wrapper has no font-size of its own, so it computes to 12px and
 * looks like a legitimate value.
 */
const FRAMER_SHAPED_PAGE = `<!DOCTYPE html>
<html><head><style>
  body { font-size: 12px; margin: 0; font-family: sans-serif; }
  .hero { padding: 40px 24px; display: flex; flex-direction: column; gap: 16px; }
  .title-text { font-size: 72px; line-height: 105%; letter-spacing: -0.03em; }
  .body-text { font-size: 16px; line-height: 140%; }
  .label-text { font-size: 14px; }
</style></head>
<body>
  <div data-framer-name="Hero Section" class="hero">
    <div data-framer-name="The workspace for clear, connected workflows.">
      <h1><span class="title-text">The workspace for clear, connected workflows.</span></h1>
    </div>
    <div data-framer-name="Ordina helps teams organize information.">
      <p class="body-text">Ordina helps teams organize information.</p>
    </div>
    <div data-framer-name="Button Text">
      <p class="label-text">Start building</p>
    </div>
  </div>
</body></html>`;

/** Capture the fixture page and return its named nodes keyed by layer name. */
async function captureFixture(html: string): Promise<Map<string, {
  tag: string;
  text?: string;
  textHolderTag?: string;
  styles?: Record<string, string>;
}>> {
  const { chromium } = await import('playwright');
  const { captureLiveNodeTree } = await import('@elconv/extractors');
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
    await page.setContent(html, { waitUntil: 'load' });
    const capture = await captureLiveNodeTree(page as never);
    const byName = new Map<string, {
      tag: string;
      text?: string;
      textHolderTag?: string;
      styles?: Record<string, string>;
    }>();
    const walk = (nodes: readonly {
      framerName?: string;
      tag: string;
      text?: string;
      textHolderTag?: string;
      styles?: Record<string, string>;
      children: readonly unknown[];
    }[]): void => {
      for (const node of nodes) {
        if (node.framerName !== undefined) {
          byName.set(node.framerName, {
            tag: node.tag,
            ...(node.text !== undefined ? { text: node.text } : {}),
            ...(node.textHolderTag !== undefined ? { textHolderTag: node.textHolderTag } : {}),
            ...(node.styles !== undefined ? { styles: node.styles } : {}),
          });
        }
        walk(node.children as never);
      }
    };
    walk(capture.roots as never);
    return byName;
  } finally {
    await browser.close();
  }
}

describe.skipIf(!HAS_BROWSER)('captureLiveNodeTree — typography comes from the element that renders the text', () => {
  it('reads font-size from the text holder, not from Framer\'s named wrapper', async () => {
    const nodes = await captureFixture(FRAMER_SHAPED_PAGE);

    const title = nodes.get('The workspace for clear, connected workflows.');
    expect(title).toBeDefined();
    // The wrapper is a plain div inheriting 12px from body. Reading it there is
    // exactly the bug: every heading in the IR became 12px.
    expect(title!.tag).toBe('div');
    expect(title!.styles?.['font-size']).toBe('72px');
    expect(title!.styles?.['font-size']).not.toBe('12px');
  }, 30_000);

  it('reads the heading tag from between the wrapper and the holder', async () => {
    const nodes = await captureFixture(FRAMER_SHAPED_PAGE);
    const title = nodes.get('The workspace for clear, connected workflows.');
    // The deepest holder is the <span>. The heading level lives on the <h1>
    // above it, which is why the tag cannot be taken from the holder.
    expect(title!.textHolderTag).toBe('h1');
  }, 30_000);

  it('leaves a non-heading text node without a heading tag', async () => {
    const nodes = await captureFixture(FRAMER_SHAPED_PAGE);
    const body = nodes.get('Ordina helps teams organize information.');
    expect(body!.styles?.['font-size']).toBe('16px');
    // No <h1>..<h6> between wrapper and holder, so nothing may be reported —
    // otherwise every <p> would be promoted to a heading.
    expect(body!.textHolderTag).toBeUndefined();
  }, 30_000);

  it('distinguishes text sizes that the wrapper would have flattened to one value', async () => {
    const nodes = await captureFixture(FRAMER_SHAPED_PAGE);
    const sizes = ['The workspace for clear, connected workflows.', 'Ordina helps teams organize information.', 'Button Text']
      .map((name) => nodes.get(name)?.styles?.['font-size']);
    // Three different sizes. Read from the wrappers, all three are 12px — which
    // is what made the loss invisible in every report.
    expect(sizes).toEqual(['72px', '16px', '14px']);
    expect(new Set(sizes).size).toBe(3);
  }, 30_000);

  it('still reads BOX properties from the named wrapper', async () => {
    const nodes = await captureFixture(FRAMER_SHAPED_PAGE);
    const hero = nodes.get('Hero Section');
    // The split is the point: typography from the holder, layout from the
    // wrapper. Taking everything from one element is wrong in one direction.
    expect(hero!.styles?.padding).toBe('40px 24px');
    expect(hero!.styles?.['flex-direction']).toBe('column');
    expect(hero!.styles?.gap).toBe('16px');
  }, 30_000);

  it('does not invent a text holder for a container', async () => {
    const nodes = await captureFixture(FRAMER_SHAPED_PAGE);
    const hero = nodes.get('Hero Section');
    // A container's `textContent` is its descendants' text concatenated, so
    // searching inside it would attribute one child's font size to the subtree.
    expect(hero!.text).toBeUndefined();
    expect(hero!.textHolderTag).toBeUndefined();
  }, 30_000);
});

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

/**
 * A page in Framer's measured marquee shape.
 *
 * Reproduces the Integrations ticker: an authored list of 3 cards inside a
 * `ul`, plus a runtime-cloned copy the page marks `aria-hidden="true"` for the
 * loop animation. Two sibling `ssr-variant` branches, exactly as measured.
 *
 * Kept minimal on purpose — 3 cards instead of 11 — because the count is not what
 * is under test; the clone/authored distinction is.
 */
const MARQUEE_SHAPED_PAGE = `<!DOCTYPE html>
<html><head><style>
  body { margin: 0; font-family: sans-serif; }
  ul { display: flex; list-style: none; margin: 0; padding: 0; }
  li { width: 80px; height: 80px; }
</style></head>
<body>
  <div data-framer-name="Integrations Section">
    <div data-framer-name="Container">
      <div class="ssr-variant" style="display: contents">
        <div class="framer-abc">
          <ul>
            <li class="ticker-item"><div class="framer-x-container"><div data-framer-name="Desktop - Filled">A</div></div></li>
            <li class="ticker-item"><div class="framer-x-container"><div data-framer-name="Desktop - Empty">B</div></div></li>
            <li class="ticker-item"><div class="framer-x-container"><div data-framer-name="Desktop - Empty">C</div></div></li>
            <li class="ticker-item" aria-hidden="true"><div class="framer-x-container"><div data-framer-name="Desktop - Filled">A</div></div></li>
            <li class="ticker-item" aria-hidden="true"><div class="framer-x-container"><div data-framer-name="Desktop - Empty">B</div></div></li>
            <li class="ticker-item" aria-hidden="true"><div class="framer-x-container"><div data-framer-name="Desktop - Empty">C</div></div></li>
          </ul>
        </div>
      </div>
      <div class="ssr-variant" style="display: contents">
        <div class="framer-def">
          <ul>
            <li class="ticker-item"><div class="framer-y-container"><div data-framer-name="Desktop - Empty">D</div></div></li>
            <li class="ticker-item"><div class="framer-y-container"><div data-framer-name="Desktop - Filled">E</div></div></li>
            <li class="ticker-item" aria-hidden="true"><div class="framer-y-container"><div data-framer-name="Desktop - Empty">D</div></div></li>
            <li class="ticker-item" aria-hidden="true"><div class="framer-y-container"><div data-framer-name="Desktop - Filled">E</div></div></li>
          </ul>
        </div>
      </div>
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

  it('reports a rendered row, which is a default in CSS but not in Elementor', async () => {
    // `.e-con.e-flex { --flex-direction: column }` is Elementor's container
    // default, so a filtered `row` is indistinguishable from an unset value and
    // the V3 emitter shipped the row as a column — measured on
    // precious-board-067119 as 188 rendered rows arriving as 72 forced columns.
    const nodes = await captureFixture(`<!DOCTYPE html><html><body>
      <div data-framer-name="Nav Row" style="display:flex;flex-direction:row">
        <div data-framer-name="Logo">L</div>
        <div data-framer-name="Menu">M</div>
      </div>
    </body></html>`);
    expect(nodes.get('Nav Row')!.styles?.['flex-direction']).toBe('row');
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

/**
 * Runtime marquee clones must not enter the captured tree.
 *
 * Measured on precious-board-067119: the Integrations ticker holds 11 authored
 * `<li>` before its section scrolls into view and 22 afterwards, with exactly the
 * added 11 carrying `aria-hidden="true"`. Kept, they double a level the structural
 * side has once — and every component instance in that level then loses its DOM
 * counterpart and emits as an HTML placeholder. That was 22 of the 37 `html`
 * widgets in the measured build.
 */
describe.skipIf(!HAS_BROWSER)('captureLiveNodeTree — aria-hidden runtime clones are not structure', () => {
  /** Capture and return the raw root list, which the keyed helper flattens away. */
  async function captureRoots(html: string): Promise<{
    roots: readonly { framerName?: string; children: readonly unknown[] }[];
    namedNodeCount: number;
    warnings: readonly string[];
  }> {
    const { chromium } = await import('playwright');
    const { captureLiveNodeTree } = await import('@elconv/extractors');
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
      await page.setContent(html, { waitUntil: 'load' });
      return await captureLiveNodeTree(page as never) as never;
    } finally {
      await browser.close();
    }
  }

  it('keeps only the authored cards per marquee branch', async () => {
    const capture = await captureRoots(MARQUEE_SHAPED_PAGE);
    const section = capture.roots[0] as {
      framerName?: string;
      children: readonly {
        framerName?: string;
        children: readonly { framerName?: string; children: readonly { framerName?: string }[] }[];
      }[];
    };
    expect(section.framerName).toBe('Integrations Section');

    const container = section.children[0];
    expect(container.framerName).toBe('Container');

    // Per branch: 3 authored and 2 authored. With the clones it would be 6 and 4,
    // and the structural side has no layer to pair the extra ones against.
    const perBranch = container.children.map((branch) =>
      branch.children.map((card) => card.framerName),
    );
    expect(perBranch).toEqual([
      ['Desktop - Filled', 'Desktop - Empty', 'Desktop - Empty'],
      ['Desktop - Empty', 'Desktop - Filled'],
    ]);
  }, 30_000);

  it('reports the authored named count, not the rendered one', async () => {
    const capture = await captureRoots(MARQUEE_SHAPED_PAGE);
    // 2 wrappers + 5 authored cards. The 5 clones are excluded: a count that
    // included them would make the capture look richer than the layer tree it
    // has to align against.
    expect(capture.namedNodeCount).toBe(7);
  }, 30_000);

  it('states how many clones it skipped instead of dropping them silently', async () => {
    const capture = await captureRoots(MARQUEE_SHAPED_PAGE);
    const notice = capture.warnings.find((warning) => warning.includes('runtime clone'));
    expect(notice).toBeDefined();
    expect(notice).toContain('5 named node(s)');
  }, 30_000);

  it('does not promote a clone to a top-level root', async () => {
    const capture = await captureRoots(MARQUEE_SHAPED_PAGE);
    // The filter runs on the root list too. Without it a skipped subtree
    // reappears as its own root and the section alignment sees a phantom section.
    expect(capture.roots).toHaveLength(1);
  }, 30_000);

  it('preserves the level the two marquee branches stand for', async () => {
    const capture = await captureRoots(MARQUEE_SHAPED_PAGE);
    const container = (capture.roots[0] as {
      children: readonly { framerName?: string; children: readonly { framerName?: string; children: readonly unknown[] }[] }[];
    }).children[0];

    // Two branches, not five flattened cards. The structural side has two Ticker
    // layers here; a flat run of 5 leaves both without a DOM counterpart, which is
    // what turned every ToolCard instance into an HTML placeholder.
    expect(container.children).toHaveLength(2);
    // The branches are unnamed in the DOM, so the capture reports no name rather
    // than inventing "Ticker" — the alignment pairs them positionally.
    expect(container.children.every((branch) => branch.framerName === undefined)).toBe(true);
    expect(container.children.map((branch) => branch.children.length)).toEqual([3, 2]);
  }, 30_000);

  it('leaves a Framer pass-through wrapper level flattened', async () => {
    // Every branch contributes exactly one named node — the measured shape of
    // Framer's own `*-container` instance wrapper, 14 of 15 sites on the real page.
    // Reshaping it would double a level that the layer tree has once.
    const page = `<!DOCTYPE html><html><body>
      <div data-framer-name="Nav Links">
        <div class="framer-a-container"><div data-framer-name="Item 1">A</div></div>
        <div class="framer-b-container"><div data-framer-name="Item 2">B</div></div>
        <div class="framer-c-container"><div data-framer-name="Item 3">C</div></div>
      </div>
    </body></html>`;
    const capture = await captureRoots(page);
    const nav = capture.roots[0] as { children: readonly { framerName?: string }[] };
    expect(nav.children.map((child) => child.framerName)).toEqual(['Item 1', 'Item 2', 'Item 3']);
  }, 30_000);

  it('leaves a mixed site flattened rather than guessing', async () => {
    // Branches contributing 2 and 1 — the measured `Content Wrapper` shape. Its
    // flattened result was verified to equal the structural children, so the
    // narrow rule deliberately does not fire here.
    const page = `<!DOCTYPE html><html><body>
      <div data-framer-name="Content Wrapper">
        <div class="framer-plain">
          <div data-framer-name="Date Wrapper">D</div>
          <div data-framer-name="Reading Time Wrapper">R</div>
        </div>
        <div class="framer-x-container"><div data-framer-name="Small">S</div></div>
      </div>
    </body></html>`;
    const capture = await captureRoots(page);
    const wrapper = capture.roots[0] as { children: readonly { framerName?: string }[] };
    expect(wrapper.children.map((child) => child.framerName)).toEqual([
      'Date Wrapper', 'Reading Time Wrapper', 'Small',
    ]);
  }, 30_000);

  it('carries positioning from an unnamed wrapper around a named root', async () => {
    const page = `<!DOCTYPE html><html><body>
      <div class="framer-header-container" style="position:absolute;top:0;left:0;right:0;z-index:10">
        <header data-framer-name="Desktop" style="position:relative;height:84px">
          <div data-framer-name="Nav">Navigation</div>
        </header>
      </div>
      <section data-framer-name="Hero Section">Hero</section>
    </body></html>`;
    const capture = await captureRoots(page);
    const header = capture.roots.find((root) => root.framerName === 'Desktop') as {
      styles?: Record<string, string>;
    };

    expect(header.styles?.position).toBe('absolute');
    expect(header.styles?.top).toBe('0px');
    expect(header.styles?.left).toBe('0px');
    expect(header.styles?.right).toBe('0px');
    expect(header.styles?.['z-index']).toBe('10');
  }, 30_000);
});

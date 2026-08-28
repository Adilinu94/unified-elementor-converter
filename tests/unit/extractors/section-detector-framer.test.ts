/**
 * detectSections() against a frozen real-Framer DOM.
 *
 * The fixture (`framer-live-section-candidates.json`) was captured with
 * Playwright from loud-alternative-352151.framer.app at 1440x900. It holds
 * every section-candidate node with its tag, attributes, geometry, computed
 * display and containment relationships — exactly the inputs the in-page
 * callback of detectSections() reads.
 *
 * Why this fixture exists: the `--url` conversion of that page produced
 * 2 sections and 0 widgets. The cause was the selector list, not the widget
 * mapper — Framer emits `<section class="framer-gemdf9" data-framer-name="Hero">`
 * with no id, no "section" in the class name and no data-section attribute.
 *
 * See docs/BAUPLAN-v7.0-FRAMER-GENERIC-2026-08-26.md §3.2.
 */

import { describe, it, expect } from 'vitest';
import { detectSections } from '@elconv/extractors';
import fixture from './fixtures/framer-live-section-candidates.json';

interface FixtureNode {
  idx: number;
  tag: string;
  id?: string;
  className: string;
  framerName?: string;
  hasDataSection: boolean;
  role?: string;
  top: number;
  bottom: number;
  height: number;
  display: string;
  childCount: number;
  ancestorIdx: number[];
}

const NODES = fixture.nodes as FixtureNode[];

/**
 * The selector forms that appear in the detector's SECTION_SELECTORS list:
 * `tag`, `tag[attr]`, `tag[attr="v"]`, `tag[class*="v"]`, `[attr]`, `[attr="v"]`.
 * Anything else throws, so a future selector cannot silently pass untested.
 */
function matchesOne(node: FixtureNode, selector: string): boolean {
  const parsed = /^([a-z]*)(?:\[([a-z-]+)(?:(\*?=)"([^"]*)")?\])?$/.exec(selector.trim());
  if (!parsed) throw new Error(`Unsupported selector in test shim: "${selector}"`);
  const [, tag, attr, op, value] = parsed;

  if (tag && node.tag !== tag) return false;
  if (!attr) return true;

  const attrValue = ((): string | undefined => {
    switch (attr) {
      case 'id': return node.id;
      case 'class': return node.className;
      case 'role': return node.role;
      case 'data-framer-name': return node.framerName;
      case 'data-section': return node.hasDataSection ? '' : undefined;
      default: throw new Error(`Unsupported attribute in test shim: "${attr}"`);
    }
  })();

  if (attrValue === undefined) return false;
  if (!op) return attr === 'data-section' ? true : attrValue.length > 0;
  if (op === '=') return attrValue === value;
  return attrValue.includes(value!);
}

function queryAll(selectorList: string): FixtureNode[] {
  const selectors = selectorList.split(',').map((s) => s.trim()).filter(Boolean);
  return NODES
    // Approximate document order: top-most first, outer before inner.
    .slice()
    .sort((a, b) => a.top - b.top || a.ancestorIdx.length - b.ancestorIdx.length)
    .filter((node) => selectors.some((sel) => matchesOne(node, sel)));
}

/** A Page stand-in that runs the real in-page callback against the fixture. */
function makeFixturePage() {
  return {
    async evaluate<A, R>(fn: (arg: A) => R, arg: A): Promise<R> {
      const shim = (node: FixtureNode) => ({
        __node: node,
        tagName: node.tag.toUpperCase(),
        id: node.id ?? '',
        className: node.className,
        children: { length: node.childCount },
        getAttribute: (name: string) =>
          name === 'data-framer-name' ? (node.framerName ?? null) : null,
        hasAttribute: (name: string) => name === 'data-section' && node.hasDataSection,
        getBoundingClientRect: () => ({
          top: node.top, bottom: node.bottom, height: node.height, width: 1440,
        }),
        contains: (other: { __node: FixtureNode }) =>
          other.__node.ancestorIdx.includes(node.idx),
      });

      const shims = new Map(NODES.map((n) => [n.idx, shim(n)]));
      const resolve = (n: FixtureNode) => shims.get(n.idx)!;

      const previous = {
        document: (globalThis as Record<string, unknown>).document,
        window: (globalThis as Record<string, unknown>).window,
      };
      (globalThis as Record<string, unknown>).document = {
        querySelectorAll: (sel: string) => queryAll(sel).map(resolve),
      };
      (globalThis as Record<string, unknown>).window = {
        scrollY: 0,
        getComputedStyle: (el: { __node: FixtureNode }) => ({ display: el.__node.display }),
      };
      try {
        return fn(arg);
      } finally {
        (globalThis as Record<string, unknown>).document = previous.document;
        (globalThis as Record<string, unknown>).window = previous.window;
      }
    },
  } as unknown as Parameters<typeof detectSections>[0];
}

describe('detectSections against a frozen Framer DOM', () => {
  it('the fixture reflects what Framer actually emits', () => {
    // Guards the fixture itself: if a recapture loses these properties the
    // assertions below would pass for the wrong reason.
    const sections = NODES.filter((n) => n.tag === 'section');
    expect(sections.length).toBeGreaterThanOrEqual(11);
    expect(sections.every((s) => !s.id)).toBe(true);
    expect(sections.every((s) => !/section/.test(s.className))).toBe(true);
    expect(sections.every((s) => !s.hasDataSection)).toBe(true);
    expect(sections.filter((s) => s.framerName).length).toBeGreaterThanOrEqual(11);
  });

  it('finds the named Framer sections, not just main + footer', async () => {
    const sections = await detectSections(makeFixturePage());
    const names = sections.map((s) => s.framerName);
    expect(sections.length).toBeGreaterThanOrEqual(10);
    for (const expected of ['Hero', 'About', 'Projects', 'Partners', 'Services', 'Awards', 'Rating', 'CTA', 'Blogs']) {
      expect(names).toContain(expected);
    }
  });

  it('drops <main>, which wraps every section — no double counting', async () => {
    const sections = await detectSections(makeFixturePage());
    expect(sections.some((s) => s.tag === 'main')).toBe(false);
    // The footer is a sibling of main, so it survives.
    expect(sections.some((s) => s.tag === 'footer')).toBe(true);
  });

  it('the surviving sections tile the page without overlapping', async () => {
    const sections = await detectSections(makeFixturePage());
    for (let i = 1; i < sections.length; i++) {
      expect(sections[i]!.y_range[0]).toBeGreaterThanOrEqual(sections[i - 1]!.y_range[0]);
      // No section may start before its predecessor ends by more than 2px.
      expect(sections[i]!.y_range[0] + 2).toBeGreaterThanOrEqual(sections[i - 1]!.y_range[1]);
    }
  });

  it('prefers the stable data-framer-name over the hashed class in the selector', async () => {
    const hero = (await detectSections(makeFixturePage())).find((s) => s.framerName === 'Hero')!;
    // `.framer-gemdf9` changes on every republish; the name does not.
    expect(hero.selector).toBe('section[data-framer-name="Hero"]');
    expect(hero.selector).not.toContain('framer-gemdf9');
  });

  it('carries the Framer layout through (Framer sections are flex)', async () => {
    const sections = await detectSections(makeFixturePage());
    expect(sections.find((s) => s.framerName === 'Hero')!.layout).toBe('flex');
  });

  it('keeping ancestors instead re-introduces the overlap', async () => {
    const withAncestors = await detectSections(makeFixturePage(), { dropAncestorSections: false });
    const withoutAncestors = await detectSections(makeFixturePage());
    expect(withAncestors.some((s) => s.tag === 'main')).toBe(true);
    expect(withAncestors.length).toBeGreaterThan(withoutAncestors.length);
  });

  it('respects maxSections', async () => {
    const sections = await detectSections(makeFixturePage(), { maxSections: 3 });
    expect(sections).toHaveLength(3);
  });

  it('minHeightPx filters small sections out', async () => {
    const tall = await detectSections(makeFixturePage(), { minHeightPx: 1000 });
    expect(tall.every((s) => s.y_range[1] - s.y_range[0] >= 1000)).toBe(true);
    // Partners (292px) and the footer (612px) drop out at this threshold.
    expect(tall.map((s) => s.framerName)).not.toContain('Partners');
  });
});

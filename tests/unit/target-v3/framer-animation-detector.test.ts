import { describe, it, expect } from 'vitest';
import { detectAnimations, buildAnimationSnippet, formatAnimationInventory } from '@elconv/target-v3';

describe('framer-animation-detector / detectAnimations', () => {
  it('detects a motion code component by file name', () => {
    const inventory = detectAnimations({
      codeFiles: { abc: { name: 'TextReveal.tsx', content: 'export default function TextReveal(){}' } },
    });
    expect(inventory.needsGsap).toBe(true);
    expect(inventory.types).toContain('text-reveal');
    expect(inventory.signals[0].source).toBe('code-file');
  });

  it('reports nothing for a page with no motion signal', () => {
    const inventory = detectAnimations({ codeFiles: { a: { name: 'Button.tsx', content: 'const x = 1;' } } });
    expect(inventory.signals).toHaveLength(0);
    expect(inventory.needsGsap).toBe(false);
  });

  it('deduplicates the same effect on the same section', () => {
    const inventory = detectAnimations({
      v3TreeClasses: ['oc-reveal', 'oc-reveal'],
    });
    expect(inventory.signals).toHaveLength(1);
  });
});

describe('framer-animation-detector / buildAnimationSnippet', () => {
  const inventory = detectAnimations({ v3TreeClasses: ['oc-hero-reveal'] });

  it('animates the element own word spans instead of a selector string', () => {
    const snippet = buildAnimationSnippet(inventory, { pageId: 4956 });

    // The old line was:
    //   gsap.from("."+el.classList[0] ? ".<section> .oc-word" : ".oc-word", ...)
    // `"." + el.classList[0]` is a non-empty string even for a class-less
    // element ("."), so the condition was always truthy and the second branch
    // was unreachable. Passing the spans removes the dead branch and stops the
    // per-iteration re-stagger of every sibling heading in the same section.
    expect(snippet).toContain('gsap.from(el.querySelectorAll(".oc-word")');
    expect(snippet).not.toContain('el.classList[0] ?');
    expect(snippet).not.toContain('"."+el.classList[0]');
  });

  it('still scopes the reveal to the section it was detected on', () => {
    const snippet = buildAnimationSnippet(inventory, { pageId: 4956 });
    expect(snippet).toContain('.oc-hero-reveal .elementor-heading-title');
  });

  it('guards on the page id so a site-wide footer snippet cannot leak', () => {
    const snippet = buildAnimationSnippet(inventory, { pageId: 4956 });
    expect(snippet).toContain("page-id-4956");
  });

  it('respects prefers-reduced-motion by default and can be opted out', () => {
    expect(buildAnimationSnippet(inventory, { pageId: 1 })).toContain('prefers-reduced-motion');
    expect(buildAnimationSnippet(inventory, { pageId: 1, respectReducedMotion: false }))
      .not.toContain('prefers-reduced-motion');
  });

  it('omits the CDN tags when asked', () => {
    expect(buildAnimationSnippet(inventory, { pageId: 1, includeCdn: false })).not.toContain('cdnjs.cloudflare.com');
  });
});

describe('framer-animation-detector / formatAnimationInventory', () => {
  it('names every signal with its evidence', () => {
    const inventory = detectAnimations({ v3TreeClasses: ['oc-parallax'] });
    const report = formatAnimationInventory(inventory);
    expect(report).toContain('oc-parallax');
    expect(report).toContain('css-class:oc-parallax');
  });
});

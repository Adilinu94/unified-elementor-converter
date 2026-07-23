/**
 * Style-Classifier — Classifies sections into V3 layout patterns.
 */
import type { V3LayoutPattern, ClassifierInput } from './types.js';

export interface ClassifierOptions {
  heroMinVh?: number;
  footerMinPaddingPx?: number;
  gridMinCards?: number;
}

export function classifySection(
  section: ClassifierInput,
  childSnapshots: ClassifierInput[],
  options: ClassifierOptions = {},
): V3LayoutPattern {
  const footerMinPadding = options.footerMinPaddingPx ?? 64;
  const gridMinCards = options.gridMinCards ?? 3;

  if (section.tag === 'header' && /sticky|fixed/.test(section.styles['position'] ?? '')) {
    return 'sticky-header';
  }

  if (section.tag === 'footer') {
    const pt = parsePx(section.styles['padding-top']) ?? 0;
    const pb = parsePx(section.styles['padding-bottom']) ?? 0;
    if (Math.max(pt, pb) >= footerMinPadding) return 'footer';
  }

  if (section.yRange) {
    const height = section.yRange[1] - section.yRange[0];
    if (height > 600 && childSnapshots.some((c) => /^h[1-6]$/.test(c.tag))) {
      return 'hero';
    }
  }

  const display = section.styles['display'] ?? '';
  if ((display === 'grid' || display === 'flex') && childSnapshots.length >= gridMinCards) {
    const tags = childSnapshots.map((c) => c.tag);
    const uniqueTags = new Set(tags);
    if (uniqueTags.size <= 2) return 'card-grid';
  }

  if (display === 'flex' && childSnapshots.length === 2) {
    const hasImg = childSnapshots.some((c) => c.tag === 'img' || c.tag === 'picture');
    const hasText = childSnapshots.some((c) => c.tag === 'p' || /^h[1-6]$/.test(c.tag));
    if (hasImg && hasText) return 'image-text-sbs';
  }

  return 'content';
}

function parsePx(value: string | undefined): number | null {
  if (!value) return null;
  const match = value.match(/^([\d.]+)px$/);
  return match ? parseFloat(match[1]) : null;
}

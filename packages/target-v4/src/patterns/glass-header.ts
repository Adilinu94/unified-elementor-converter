/**
 * V4 Pattern: Glass Header (Atomic)
 * EIGENE Implementierung — NICHT von V3 kopieren!
 * Uses e-flexbox + $$type styles + GC candidates.
 */

import type { V4TreeNode, V4StyleClass } from '../types.js';
import { wrapSize, wrapColor, wrapDimensions, wrapBorderRadius } from '../framer-utils.js';

let idCounter = 0;
function nextId(): string {
  return `v4p_gh_${(++idCounter).toString(36)}`;
}

export function resetV4GlassHeaderIds(): void {
  idCounter = 0;
}

export interface V4GlassHeaderOptions {
  title: string;
  subtitle?: string;
  logoUrl?: string;
  ctaText?: string;
  ctaHref?: string;
  blurAmount?: number;
  bgColor?: string;
  accentColor?: string;
}

/**
 * Build a V4 Atomic glassmorphism header.
 * Structure: e-flexbox > [e-image, e-heading, e-paragraph, e-button]
 */
export function buildV4GlassHeader(options: V4GlassHeaderOptions): V4TreeNode {
  const {
    title,
    subtitle,
    logoUrl,
    ctaText = 'Get Started',
    ctaHref = '#',
    blurAmount = 10,
    bgColor = '#ffffff1a',
    accentColor = '#ffffff',
  } = options;

  const elements: V4TreeNode[] = [];
  const styles: Record<string, V4StyleClass> = {};

  // Logo (optional)
  if (logoUrl) {
    const logoStyleId = nextId();
    styles[logoStyleId] = createStyleClass(logoStyleId, 'Logo', {
      width: wrapSize(120),
    });
    elements.push({
      type: 'e-image',
      elType: 'widget',
      widgetType: 'e-image',
      id: nextId(),
      settings: { image_src: { '$$type': 'image-src', value: { url: logoUrl, id: '' } } },
      styles: { [logoStyleId]: styles[logoStyleId] },
    });
  }

  // Title
  const titleStyleId = nextId();
  styles[titleStyleId] = createStyleClass(titleStyleId, 'Title', {
    font_size: wrapSize(48),
    font_weight: '700',
    color: wrapColor(accentColor),
  });
  elements.push({
    type: 'e-heading',
    elType: 'widget',
    widgetType: 'e-heading',
    id: nextId(),
    settings: { title, tag: 'h1' },
    styles: { [titleStyleId]: styles[titleStyleId] },
  });

  // Subtitle (optional)
  if (subtitle) {
    const subStyleId = nextId();
    styles[subStyleId] = createStyleClass(subStyleId, 'Subtitle', {
      font_size: wrapSize(20),
      color: wrapColor('#ffffffcc'),
    });
    elements.push({
      type: 'e-paragraph',
      elType: 'widget',
      widgetType: 'e-paragraph',
      id: nextId(),
      settings: { content: subtitle },
      styles: { [subStyleId]: styles[subStyleId] },
    });
  }

  // CTA Button
  const btnStyleId = nextId();
  styles[btnStyleId] = createStyleClass(btnStyleId, 'CTAButton', {
    background_color: wrapColor('#ffffff'),
    color: wrapColor('#000000'),
    padding: wrapDimensions(12, 24, 12, 24),
    border_radius: wrapBorderRadius(8, 8, 8, 8),
  });
  elements.push({
    type: 'e-button',
    elType: 'widget',
    widgetType: 'e-button',
    id: nextId(),
    settings: { text: ctaText, link: { url: ctaHref } },
    styles: { [btnStyleId]: styles[btnStyleId] },
  });

  // Container style
  const containerStyleId = nextId();
  styles[containerStyleId] = createStyleClass(containerStyleId, 'GlassContainer', {
    display: 'flex',
    flex_direction: 'column',
    align_items: 'center',
    justify_content: 'center',
    min_height: wrapSize(60, 'vh'),
    padding: wrapDimensions(80, 40, 80, 40),
    background_color: wrapColor(bgColor),
    backdrop_filter: `blur(${blurAmount}px)`,
    border_radius: wrapBorderRadius(16, 16, 16, 16),
  });

  return {
    type: 'e-flexbox',
    elType: 'e-flexbox',
    widgetType: 'e-flexbox',
    id: nextId(),
    settings: {},
    styles: { [containerStyleId]: styles[containerStyleId] },
    elements,
  };
}

function createStyleClass(id: string, label: string, props: Record<string, unknown>): V4StyleClass {
  return {
    id,
    label,
    type: 'class',
    variants: [{
      meta: { breakpoint: null, state: null },
      props,
      custom_css: null,
    }],
  };
}

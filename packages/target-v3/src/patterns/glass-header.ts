/**
 * V3 Pattern: Glass Header
 * Glassmorphism-style header with blur effect.
 * Uses native widgets only (heading, button, image).
 */

import type { V3Element } from '../types.js';

let idCounter = 0;
function nextId(): string {
  return `v3p_gh_${(++idCounter).toString(36)}`;
}

export function resetGlassHeaderIds(): void {
  idCounter = 0;
}

export interface GlassHeaderOptions {
  title: string;
  subtitle?: string;
  logoUrl?: string;
  ctaText?: string;
  ctaHref?: string;
  blurAmount?: number;
  bgColor?: string;
}

/**
 * Build a glassmorphism header section.
 * Structure: container > [logo, heading, subtitle, button]
 */
export function buildGlassHeader(options: GlassHeaderOptions): V3Element {
  const {
    title,
    subtitle,
    logoUrl,
    ctaText = 'Get Started',
    ctaHref = '#',
    blurAmount = 10,
    bgColor = 'rgba(255,255,255,0.1)',
  } = options;

  const widgets: V3Element[] = [];

  // Logo (optional)
  if (logoUrl) {
    widgets.push({
      id: nextId(),
      elType: 'widget',
      widgetType: 'image',
      settings: {
        image: { url: logoUrl },
        image_size: 'custom',
        custom_image_width: { unit: 'px', size: 120 },
      },
    });
  }

  // Title
  widgets.push({
    id: nextId(),
    elType: 'widget',
    widgetType: 'heading',
    settings: {
      title,
      header_size: 'h1',
      title_color: '#FFFFFF',
      typography_typography: 'custom',
      typography_font_size: { unit: 'px', size: 48 },
      typography_font_weight: '700',
    },
  });

  // Subtitle (optional)
  if (subtitle) {
    widgets.push({
      id: nextId(),
      elType: 'widget',
      widgetType: 'text-editor',
      settings: {
        editor: `<p>${subtitle}</p>`,
        text_color: 'rgba(255,255,255,0.8)',
        typography_typography: 'custom',
        typography_font_size: { unit: 'px', size: 20 },
      },
    });
  }

  // CTA Button
  widgets.push({
    id: nextId(),
    elType: 'widget',
    widgetType: 'button',
    settings: {
      text: ctaText,
      link: { url: ctaHref },
      background_color: '#FFFFFF',
      button_text_color: '#000000',
      border_radius: { unit: 'px', top: 8, right: 8, bottom: 8, left: 8 },
      hover_animation: 'grow',
    },
  });

  return {
    id: nextId(),
    elType: 'container',
    settings: {
      content_width: 'boxed',
      flex_direction: 'column',
      align_items: 'center',
      justify_content: 'center',
      min_height: { unit: 'vh', size: 60 },
      padding: { unit: 'px', top: 80, right: 40, bottom: 80, left: 40 },
      background_background: 'classic',
      background_color: bgColor,
      backdrop_filter_blur: { unit: 'px', size: blurAmount },
      border_radius: { unit: 'px', top: 16, right: 16, bottom: 16, left: 16 },
    },
    elements: widgets,
  };
}

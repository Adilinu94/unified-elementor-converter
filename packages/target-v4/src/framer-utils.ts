/**
 * $$type wrapper utilities for Elementor V4 Atomic.
 * Ported from Framer-to-Elementor-V4-Pipeline/src/converter/framer-utils.ts
 */

import type { TypedSize, TypedColor, TypedClasses, TypedDimensions, TypedBorderRadius, TypedImageSrc } from './types.js';

// --- $$type Wrappers ---

export function wrapSize(size: number, unit = 'px'): TypedSize {
  return { '$$type': 'size', value: { size, unit } };
}

export function wrapColor(hex: string): TypedColor {
  return { '$$type': 'color', value: normalizeHex(hex) };
}

export function wrapClasses(classes: string[]): TypedClasses {
  return { '$$type': 'classes', value: classes };
}

export function wrapDimensions(top: number, right: number, bottom: number, left: number, unit = 'px'): TypedDimensions {
  return { '$$type': 'dimensions', value: { top, right, bottom, left, unit } };
}

export function wrapBorderRadius(tl: number, tr: number, br: number, bl: number, unit = 'px'): TypedBorderRadius {
  return { '$$type': 'border-radius', value: { top_left: tl, top_right: tr, bottom_right: br, bottom_left: bl, unit } };
}

export function wrapImageSrc(url: string, id: number | string = ''): TypedImageSrc {
  return { '$$type': 'image-src', value: { url, id } };
}

export function wrapGvColor(gvId: string): { '$$type': 'global-color-variable'; value: string } {
  return { '$$type': 'global-color-variable', value: gvId };
}

export function wrapGvFont(gvId: string): { '$$type': 'global-font-variable'; value: string } {
  return { '$$type': 'global-font-variable', value: gvId };
}

export function wrapHtmlContent(html: string): { '$$type': 'html-content'; value: string } {
  return { '$$type': 'html-content', value: html };
}

// --- Color Utilities ---

export function normalizeHex(color: string): string {
  const hex = color.trim();
  if (/^#[0-9a-fA-F]{6}$/.test(hex)) return hex.toLowerCase();
  if (/^#[0-9a-fA-F]{3}$/.test(hex)) {
    const [r, g, b] = hex.slice(1).split('');
    return `#${r}${r}${g}${g}${b}${b}`.toLowerCase();
  }
  if (hex.startsWith('rgb')) {
    return rgbToHex(hex);
  }
  return hex.toLowerCase();
}

export function rgbToHex(rgb: string): string {
  const match = rgb.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
  if (!match) return '#000000';
  const r = parseInt(match[1], 10);
  const g = parseInt(match[2], 10);
  const b = parseInt(match[3], 10);
  return `#${((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1)}`;
}

export function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const clean = hex.replace('#', '');
  return {
    r: parseInt(clean.slice(0, 2), 16),
    g: parseInt(clean.slice(2, 4), 16),
    b: parseInt(clean.slice(4, 6), 16),
  };
}

export function hexDistance(a: string, b: string): number {
  const ca = hexToRgb(a);
  const cb = hexToRgb(b);
  return Math.sqrt((ca.r - cb.r) ** 2 + (ca.g - cb.g) ** 2 + (ca.b - cb.b) ** 2);
}

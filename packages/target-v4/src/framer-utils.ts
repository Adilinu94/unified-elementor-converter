/**
 * $$type wrapper utilities for Elementor V4 Atomic.
 * Ported from Framer-to-Elementor-V4-Pipeline/src/converter/framer-utils.ts
 */

import type { TypedSize, TypedColor, TypedClasses, TypedDimensions, TypedBorderRadius, TypedImageSrc, TypedValue } from './types.js';


/** Generic $$type wrapper used by Elementor V4 scalar properties. */
export function wrapType(type: string, value: unknown): TypedValue {
  return { '$$type': type, value };
}

// --- $$type Wrappers ---

export function wrapSize(size: number | string, unit = 'px'): TypedSize {
  if (typeof size === 'string') {
    const match = size.trim().match(/^(-?[\\d.]+)\\s*([a-z%]+)?$/i);
    if (match) {
      return { '$$type': 'size', value: { size: Number(match[1]), unit: match[2] ?? unit } };
    }
  }
  return { '$$type': 'size', value: { size: typeof size === 'number' ? size : Number(size) || 0, unit } };
}

export function wrapColor(hex: string): TypedColor {
  return { '$$type': 'color', value: normalizeHex(hex) };
}

export function wrapClasses(classes: string[]): TypedClasses {
  return { '$$type': 'classes', value: classes };
}

export function wrapDimensions(top: number | string, right?: number, bottom?: number, left?: number, unit = 'px'): TypedDimensions {
  if (typeof top === 'string' && right === undefined) {
    const values = top.trim().split(/\\s+/).map((value) => wrapSize(value));
    const [a, b = a, c = a, d = b] = values;
    return {
      '$$type': 'dimensions',
      value: {
        top: a.value.size,
        right: b.value.size,
        bottom: c.value.size,
        left: d.value.size,
        unit: a.value.unit,
      },
    };
  }
  return { '$$type': 'dimensions', value: { top: Number(top) || 0, right: right ?? 0, bottom: bottom ?? 0, left: left ?? 0, unit } };
}

export function wrapBorderRadius(tl: number | string, tr?: number, br?: number, bl?: number, unit = 'px'): TypedBorderRadius {
  if (typeof tl === 'string' && tr === undefined) {
    const values = tl.trim().split(/\\s+/).map((value) => wrapSize(value));
    const [a, b = a, c = a, d = b] = values;
    return {
      '$$type': 'border-radius',
      value: { top_left: a.value.size, top_right: b.value.size, bottom_right: c.value.size, bottom_left: d.value.size, unit: a.value.unit },
    };
  }
  return { '$$type': 'border-radius', value: { top_left: Number(tl) || 0, top_right: tr ?? 0, bottom_right: br ?? 0, bottom_left: bl ?? 0, unit } };
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

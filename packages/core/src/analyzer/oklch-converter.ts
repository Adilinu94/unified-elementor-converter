/**
 * oklch-Converter (Phase 6 — V2-Pixel-Perfekt).
 *
 * Konvertiert sRGB ↔ Oklch (perceptual uniform color space).
 *
 * Pipeline: sRGB → linear-sRGB → Oklab → Oklch (and back).
 *
 * Hintergrund (Plan §10.4):
 * V3-Elementor Settings akzeptieren hex/rgb direkt; oklch()-Werte werden
 * via custom_css als CSS-Variable injiziert (`:root { --brand: oklch(...) }`).
 *
 * Mathematik: W3C/css-color-4 Referenz-Implementation (Björn Ottosson).
 * Round-trip-Genauigkeit: < 0.5 in 8-bit-Kanälen (gut genug für Pixel-Diff).
 */

// `Rgb` and `Oklch` are canonically defined in @elconv/core contracts
// (tokens.contract.ts). Re-exported here so analyzer consumers keep importing
// them from this module, and so the core barrel sees a single (identical)
// declaration — no `export *` ambiguity. `Oklab` stays analyzer-local.
import type { Rgb, Oklch } from '../contracts/index.js';
export type { Rgb, Oklch };

export interface Oklab {
  L: number; // 0..1 (lightness)
  a: number; // -0.4..0.4 (green-red axis)
  b: number; // -0.4..0.4 (blue-yellow axis)
}

/** Clamp a number into [min, max]. */
export function clamp(value: number, min: number, max: number): number {
  if (value < min) return min;
  if (value > max) return max;
  return value;
}

/** sRGB channel (0..255) → linear-light (0..1). */
export function srgbToLinear(c: number): number {
  const s = c / 255;
  return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
}

/** Linear-light (0..1) → sRGB channel (0..255). */
export function linearToSrgb(c: number): number {
  const s = c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
  return Math.round(clamp(s * 255, 0, 255));
}

/** linear-sRGB → Oklab. */
export function linearRgbToOklab(r: number, g: number, b: number): Oklab {
  const l = 0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b;
  const m = 0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b;
  const s = 0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b;

  const l_ = Math.cbrt(l);
  const m_ = Math.cbrt(m);
  const s_ = Math.cbrt(s);

  return {
    L: 0.2104542553 * l_ + 0.793617785 * m_ - 0.0040720468 * s_,
    a: 1.9779984951 * l_ - 2.428592205 * m_ + 0.4505937099 * s_,
    b: 0.0259040371 * l_ + 0.7827717662 * m_ - 0.808675766 * s_,
  };
}

/** Oklab → linear-sRGB. */
export function oklabToLinearRgb(L: number, a: number, b: number): Rgb {
  const l_ = L + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = L - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = L - 0.0894841775 * a - 1.291485548 * b;

  const l = l_ * l_ * l_;
  const m = m_ * m_ * m_;
  const s = s_ * s_ * s_;

  return {
    r: 4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    g: -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    b: -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  };
}

/** Oklab → Oklch. */
export function oklabToOklch({ L, a, b }: Oklab): Oklch {
  const C = Math.sqrt(a * a + b * b);
  let h = (Math.atan2(b, a) * 180) / Math.PI;
  if (h < 0) h += 360;
  return { L, C, h };
}

/** Oklch → Oklab. */
export function oklchToOklab({ L, C, h }: Oklch): Oklab {
  const rad = (h * Math.PI) / 180;
  return { L, a: Math.cos(rad) * C, b: Math.sin(rad) * C };
}

/** Parse a hex color (#rgb, #rgba, #rrggbb, #rrggbbaa) to Rgb (alpha ignored). */
export function hexToRgb(hex: string): Rgb | null {
  const h = hex.trim().replace(/^#/, '');
  let r: number, g: number, b: number;
  if (h.length === 3) {
    r = parseInt(h[0] + h[0], 16);
    g = parseInt(h[1] + h[1], 16);
    b = parseInt(h[2] + h[2], 16);
  } else if (h.length === 6) {
    r = parseInt(h.slice(0, 2), 16);
    g = parseInt(h.slice(2, 4), 16);
    b = parseInt(h.slice(4, 6), 16);
  } else if (h.length === 8) {
    r = parseInt(h.slice(0, 2), 16);
    g = parseInt(h.slice(2, 4), 16);
    b = parseInt(h.slice(4, 6), 16);
  } else {
    return null;
  }
  if (Number.isNaN(r) || Number.isNaN(g) || Number.isNaN(b)) return null;
  return { r, g, b };
}

/** Convert Rgb to hex string (#rrggbb). */
export function rgbToHex({ r, g, b }: Rgb): string {
  const h = (n: number) => clamp(n, 0, 255).toString(16).padStart(2, '0');
  return '#' + h(r) + h(g) + h(b);
}

/** Rgb → Oklch (linear: sRGB → linear → Oklab → Oklch). */
export function rgbToOklch(rgb: Rgb): Oklch {
  const lin = {
    r: srgbToLinear(rgb.r),
    g: srgbToLinear(rgb.g),
    b: srgbToLinear(rgb.b),
  };
  const lab = linearRgbToOklab(lin.r, lin.g, lin.b);
  return oklabToOklch(lab);
}

/** Oklch → Rgb (Oklch → Oklab → linear-sRGB → sRGB). */
export function oklchToRgb({ L, C, h }: Oklch): Rgb {
  const lab = oklchToOklab({ L, C, h });
  const lin = oklabToLinearRgb(lab.L, lab.a, lab.b);
  return {
    r: linearToSrgb(lin.r),
    g: linearToSrgb(lin.g),
    b: linearToSrgb(lin.b),
  };
}

/** Round-trip-Genauigkeit für Hex-Werte (max delta in 8-bit-Kanälen). */
export function oklchRoundTripDelta(hex: string): number {
  const original = hexToRgb(hex);
  if (!original) return Infinity;
  const oklch = rgbToOklch(original);
  const roundTrip = oklchToRgb(oklch);
  return Math.max(
    Math.abs(original.r - roundTrip.r),
    Math.abs(original.g - roundTrip.g),
    Math.abs(original.b - roundTrip.b),
  );
}

/** Format Oklch als CSS-Wert: "oklch(L% C H)" — Plan §10.4 nutzt dies in custom_css. */
export function formatOklchCss({ L, C, h }: Oklch, precision = 3): string {
  const lPct = (L * 100).toFixed(precision);
  const cFmt = C.toFixed(precision);
  const hFmt = h.toFixed(precision === 3 ? 1 : 0);
  return `oklch(${lPct}% ${cFmt} ${hFmt})`;
}

/** Parse einen oklch()-CSS-String zurück zu Oklch (Lossy-toleranter Parser). */
export function parseOklch(value: string): Oklch | null {
  const m = value
    .trim()
    .match(/^oklch\(\s*([\d.]+)%?\s+([\d.]+)(?:deg)?\s+([\d.]+)(?:deg)?\s*\)$/i);
  if (!m) return null;
  const L = parseFloat(m[1]) / (m[1].includes('.') ? 100 : 100);
  const C = parseFloat(m[2]);
  const h = parseFloat(m[3]);
  if (Number.isNaN(L) || Number.isNaN(C) || Number.isNaN(h)) return null;
  return { L, C, h };
}
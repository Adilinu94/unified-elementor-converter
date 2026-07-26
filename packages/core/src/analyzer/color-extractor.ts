/**
 * Color Frequency + Clustering + Semantic-Naming (Phase 2.5).
 *
 * Step 1: Build a frequency map of all colors used in the styles.json output.
 * Step 2: Cluster near-duplicate colors (RGB distance < 15).
 * Step 3: Assign semantic names using CSS-variable hints first, then
 *         luminance + frequency + saturation heuristics as fallback.
 *
 * Based on BAUPLAN §Phase 2.5 Steps 1-3.
 */

const COLOR_PROPS = [
  'color',
  'background-color',
  'border-color',
  'outline-color',
  'fill',
  'stroke',
] as const;

export { COLOR_PROPS };

/** A single computed-style node from styles.json. */
export interface StyleNode {
  selector: string;
  tag: string;
  styles: Record<string, string>;
}

/** A cluster of near-duplicate colors. */
export interface ColorCluster {
  canonical: string;
  count: number;
  variants: string[];
}

/** Semantic color tokens (one slot per role). */
export interface SemanticColors {
  primary: string | null;
  secondary: string | null;
  background: string | null;
  surface: string | null;
  text: string | null;
  'text-muted': string | null;
  border: string | null;
  accent: string | null;
}

/** Convert a CSS color string to a normalized hex string. */
export function toHex(cssColor: string | undefined | null): string | null {
  if (!cssColor) return null;
  const trimmed = cssColor.trim();
  // Already hex
  if (/^#[0-9a-f]{3,8}$/i.test(trimmed)) {
    return normalizeHex(trimmed);
  }
  // rgb()/rgba()
  const rgba = trimmed.match(
    /rgba?\((\d+)\s*,\s*(\d+)\s*,\s*(\d+)(?:\s*,\s*([\d.]+))?\)/i,
  );
  if (rgba) {
    const alpha = parseFloat(rgba[4] ?? '1');
    if (alpha < 0.1) return null; // skip fully transparent
    return rgbToHex(parseInt(rgba[1]), parseInt(rgba[2]), parseInt(rgba[3]));
  }
  return null;
}

function normalizeHex(hex: string): string {
  // Expand #abc -> #aabbcc
  const h = hex.toLowerCase();
  if (/^#[0-9a-f]{3}$/.test(h)) {
    return '#' + h[1] + h[1] + h[2] + h[2] + h[3] + h[3];
  }
  // Strip alpha channel for 8-digit hex
  if (/^#[0-9a-f]{8}$/.test(h)) {
    return h.slice(0, 7);
  }
  return h;
}

function rgbToHex(r: number, g: number, b: number): string {
  return (
    '#' +
    r.toString(16).padStart(2, '0') +
    g.toString(16).padStart(2, '0') +
    b.toString(16).padStart(2, '0')
  );
}

/** Convert hex to [r, g, b] triple. */
export function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  return [
    parseInt(h.slice(0, 2), 16),
    parseInt(h.slice(2, 4), 16),
    parseInt(h.slice(4, 6), 16),
  ];
}

/** Euclidean distance between two hex colors in RGB space. */
export function hexDistance(a: string, b: string): number {
  const [ar, ag, ab] = hexToRgb(a);
  const [br, bg, bb] = hexToRgb(b);
  return Math.sqrt((ar - br) ** 2 + (ag - bg) ** 2 + (ab - bb) ** 2);
}

/** WCAG 2.1 relative luminance (0..1). */
export function luminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex).map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** HSV saturation (0..1). */
export function saturation(hex: string): number {
  const [r, g, b] = hexToRgb(hex);
  const max = Math.max(r, g, b) / 255;
  const min = Math.min(r, g, b) / 255;
  if (max === 0) return 0;
  return (max - min) / max;
}

/** Build a frequency map of all colors used in the style nodes. */
export function extractColorFrequency(styles: StyleNode[]): Map<string, number> {
  const freq = new Map<string, number>();
  for (const node of styles) {
    for (const prop of COLOR_PROPS) {
      const raw = node.styles[prop];
      const hex = toHex(raw);
      if (!hex) continue;
      freq.set(hex, (freq.get(hex) ?? 0) + 1);
    }
  }
  return freq;
}

/** Cluster near-duplicate colors (RGB distance < 15). Returns top N clusters. */
export function clusterColors(
  freq: Map<string, number>,
  options: { maxClusters?: number; clusterThreshold?: number } = {},
): ColorCluster[] {
  const maxClusters = options.maxClusters ?? 20;
  const threshold = options.clusterThreshold ?? 15;
  const sorted = [...freq.entries()].sort((a, b) => b[1] - a[1]);
  const clusters: ColorCluster[] = [];

  for (const [hex, count] of sorted) {
    const existing = clusters.find((c) => hexDistance(c.canonical, hex) < threshold);
    if (existing) {
      existing.count += count;
      existing.variants.push(hex);
    } else {
      clusters.push({ canonical: hex, count, variants: [hex] });
    }
  }
  return clusters.slice(0, maxClusters);
}

/**
 * Assign semantic names to color clusters.
 *
 * Strategy 1 (priority): CSS-variable-name hint mapping.
 * Strategy 2 (fallback): luminance + frequency + saturation heuristics.
 */
export function assignSemanticNames(
  clusters: ColorCluster[],
  cssVars: Record<string, string>,
): SemanticColors {
  const tokens: SemanticColors = {
    primary: null,
    secondary: null,
    background: null,
    surface: null,
    text: null,
    'text-muted': null,
    border: null,
    accent: null,
  };

  // Strategy 1: CSS-Variable name hints
  for (const [varName, value] of Object.entries(cssVars)) {
    const hex = toHex(value);
    if (!hex) continue;
    const ln = varName.toLowerCase();
    if (/primary|brand|cta/.test(ln) && !tokens.primary) tokens.primary = hex;
    else if (/secondary/.test(ln) && !tokens.secondary) tokens.secondary = hex;
    else if (/background|\bbg\b(?!-)/.test(ln) && !tokens.background) tokens.background = hex;
    else if (/surface|card|panel/.test(ln) && !tokens.surface) tokens.surface = hex;
    else if (/text(?!-)/.test(ln) && !tokens.text) tokens.text = hex;
    else if (/muted|subtle|placeholder/.test(ln) && !tokens['text-muted']) tokens['text-muted'] = hex;
    else if (/border|divider|separator/.test(ln) && !tokens.border) tokens.border = hex;
    else if (/accent/.test(ln) && !tokens.accent) tokens.accent = hex;
  }

  // Strategy 2: Heuristics on clusters
  const sorted = [...clusters].sort((a, b) => b.count - a.count);
  for (const cluster of sorted) {
    const lum = luminance(cluster.canonical);
    const sat = saturation(cluster.canonical);
    if (!tokens.background && lum > 0.85) { tokens.background = cluster.canonical; continue; }
    if (!tokens.text && lum < 0.1) { tokens.text = cluster.canonical; continue; }
    if (!tokens.surface && lum > 0.7 && lum < 0.9 && cluster.count < 50) { tokens.surface = cluster.canonical; continue; }
    if (!tokens.primary && sat > 0.4) { tokens.primary = cluster.canonical; continue; }
    if (!tokens.secondary && sat > 0.2 && lum < 0.4) { tokens.secondary = cluster.canonical; continue; }
    if (!tokens['text-muted'] && lum > 0.2 && lum < 0.5 && sat < 0.2) { tokens['text-muted'] = cluster.canonical; continue; }
    if (!tokens.border && lum > 0.85 && cluster.count < 80) { tokens.border = cluster.canonical; continue; }
  }
  return tokens;
}

/** Build a frequency lookup of { hex: count } for cross-validation. */
export function buildFrequencyLookup(freq: Map<string, number>): Record<string, number> {
  const obj: Record<string, number> = {};
  for (const [k, v] of freq) obj[k] = v;
  return obj;
}

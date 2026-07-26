#!/usr/bin/env node
/**
 * Intelligent Responsive Auto-Scaling (Anti-Slop)
 * 
 * Injiziert automatisch Mobile/Tablet-Varianten für Typography und Spacing,
 * wenn Desktop-Werte bestimmte Schwellenwerte überschreiten.
 * Verhindert, dass mobile Ansichten standardmäßig zerbrechen (Browser skaliert px nicht automatisch).
 *
 * Migrated to TypeScript — UMBAUPLAN Phase 6.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { getWrappedSizeNumber, scaleWrappedSize } from './lib/framer-utils.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');

// ── Types ──────────────────────────────────────────────────────────────────

interface FramerStyleVariant {
  meta?: { breakpoint: string | null; state: string | null };
  props?: Record<string, unknown>;
}

interface FramerStyle {
  variants?: FramerStyleVariant[];
  props?: Record<string, unknown>;
}

interface FramerNode {
  id?: string;
  styles?: Record<string, FramerStyle>;
  [key: string]: unknown;
}

interface BreakpointNode {
  selector?: string;
  name?: string;
  variants?: Array<{
    meta?: { breakpoint?: string | null };
    props?: Record<string, unknown>;
  }>;
}

interface BreakpointsData {
  nodes?: BreakpointNode[];
  [key: string]: unknown;
}

interface ScaleFactors {
  tablet: number;
  mobile: number;
}

interface CliArgs {
  tree: string | null;
  output: string | null;
  breakpoints: string | null;
}

// RC-19 + RC-14 Fix: Extended thresholds and properties for comprehensive responsive scaling.
// V4 enforces strict breakpoint management; Framer's absolute px values must be
// scaled to avoid broken mobile layouts. RC-14 adds gap, grid-columns, and border-radius.
const THRESHOLDS: Record<string, number> = {
  fontSize: 28,     // px
  padding: 20,      // px
  margin: 20,       // px
  widthPx: 300,     // px -- wide desktop elements break mobile viewports
  heightPx: 200,    // px -- tall desktop sections need mobile scaling
  minHeightPx: 200, // px
  letterSpacing: 2, // px
  gap: 24,          // px -- RC-14: large gaps break mobile layouts
  borderRadius: 12, // px -- RC-14: large border radii look out of place on mobile
};

// C5: Skalierungsfaktoren — werden aus breakpoints.json geladen wenn verfuegbar
// Fallback: Pauschalfaktoren fuer den Fall ohne breakpoints.json
const DEFAULT_SCALE_FACTORS: ScaleFactors = {
  tablet: 0.75,
  mobile: 0.6,
};

let breakpointsData: BreakpointsData | null = null;

// ── Helpers ────────────────────────────────────────────────────────────────

function getPxValue(wrapped: unknown): number {
  return getWrappedSizeNumber(wrapped) ?? NaN;
}

function getElementScaleFactors(elementId: string, styleId: string): ScaleFactors {
  if (!breakpointsData) return { ...DEFAULT_SCALE_FACTORS };

  const node = (breakpointsData.nodes || []).find(n =>
    (n.selector && (n.selector.includes(elementId) || n.selector.includes(styleId))) ||
    (n.name && (n.name.includes(elementId) || n.name.includes(styleId)))
  );

  if (!node?.variants) return { ...DEFAULT_SCALE_FACTORS };

  const base = node.variants.find(v => !v.meta?.breakpoint || v.meta?.breakpoint === null)?.props || {};
  const tabletV = node.variants.find(v => v.meta?.breakpoint === 'tablet')?.props || {};
  const mobileV = node.variants.find(v => v.meta?.breakpoint === 'mobile')?.props || {};

  const baseFs = getPxValue(base['font-size']);
  if (baseFs && baseFs > 0) {
    const tabletPx = getPxValue(tabletV['font-size']);
    const mobilePx = getPxValue(mobileV['font-size']);
    return {
      tablet: isNaN(tabletPx) ? DEFAULT_SCALE_FACTORS.tablet : tabletPx / baseFs,
      mobile: isNaN(mobilePx) ? DEFAULT_SCALE_FACTORS.mobile : mobilePx / baseFs,
    };
  }

  return { ...DEFAULT_SCALE_FACTORS };
}

function walkTree(obj: unknown, callback: (node: Record<string, unknown>) => void): void {
  if (typeof obj !== 'object' || obj === null) return;
  callback(obj as Record<string, unknown>);
  for (const key in obj as Record<string, unknown>) {
    if (Object.prototype.hasOwnProperty.call(obj, key)) {
      walkTree((obj as Record<string, unknown>)[key], callback);
    }
  }
}

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function scaleDimensions(dimensions: unknown, factor: number): unknown {
  if (!dimensions || (dimensions as Record<string, unknown>)['$$type'] !== 'dimensions') return dimensions;
  const d = dimensions as { '$$type': string; value: Record<string, unknown> };
  const value: Record<string, unknown> = {};
  for (const [side, wrapped] of Object.entries(d.value || {})) {
    value[side] = scaleWrappedSize(wrapped, factor);
  }
  return { ...d, value };
}

function scaleProp(prop: string, value: unknown, factor: number): unknown {
  if (prop === 'font-size') return scaleWrappedSize(value, factor);
  if (prop === 'padding' || prop === 'margin') return scaleDimensions(value, factor);
  if (prop.includes('padding') || prop.includes('margin') || prop === 'gap') return scaleWrappedSize(value, factor);
  // RC-19 Fix: Scale width/height/min-height/letter-spacing for responsive breakpoints
  if (prop === 'width' || prop === 'height' || prop === 'min-height' || prop === 'letter-spacing') {
    return scaleWrappedSize(value, factor);
  }
  // RC-14 Fix: Scale border-radius for responsive breakpoints
  if (prop === 'border-radius') return scaleWrappedSize(value, factor);
  // RC-14 Fix: Handle grid-template-columns — collapse multi-column grids responsively.
  // Tablet (factor ~0.75): half columns. Mobile (factor ~0.6): single column.
  if (prop === 'grid-template-columns') {
    const v = value as Record<string, unknown> | undefined;
    if (v && v['$$type'] === 'string') {
      const cols = String(v.value || '').trim();
      const parts = cols.split(/\s+/);
      if (parts.length >= 2) {
        // Tablet: half the columns (min 1). Mobile: full collapse to 1fr.
        const targetCols = factor > 0.65 ? Math.max(1, Math.floor(parts.length / 2)) : 1;
        const newValue = targetCols === 1 ? '1fr' : Array(targetCols).fill('1fr').join(' ');
        return { ...v, value: newValue };
      }
    }
    return cloneJson(value);
  }
  return cloneJson(value);
}

function propNeedsScaling(prop: string, value: unknown, factor?: number): boolean {
  // RC-19 Fix: Extended responsive scaling for all dimension properties
  if (prop === 'font-size' || prop === 'letter-spacing') {
    const size = getWrappedSizeNumber(value);
    if (prop === 'font-size') return size !== null && size > THRESHOLDS.fontSize;
    if (prop === 'letter-spacing') return size !== null && size > THRESHOLDS.letterSpacing;
  }
  if (prop === 'padding' || prop === 'margin') {
    const v = value as { value?: Record<string, unknown> } | undefined;
    const sides = Object.values(v?.value || {});
    return sides.some(side => {
      const size = getWrappedSizeNumber(side);
      return size !== null && size > THRESHOLDS.padding;
    });
  }
  if (prop.includes('padding') || prop.includes('margin') || prop === 'gap') {
    const size = getWrappedSizeNumber(value);
    if (prop === 'gap') return size !== null && size > THRESHOLDS.gap;
    return size !== null && size > THRESHOLDS.padding;
  }
  // RC-19: Auto-scale width/height/min-height for responsive breakpoints
  if (prop === 'width' || prop === 'height' || prop === 'min-height') {
    const size = getWrappedSizeNumber(value);
    if (size === null) return false;
    if (prop === 'width') return size > THRESHOLDS.widthPx;
    if (prop === 'height') return size > THRESHOLDS.heightPx;
    if (prop === 'min-height') return size > THRESHOLDS.minHeightPx;
  }
  // RC-14: Auto-scale border-radius for responsive breakpoints
  if (prop === 'border-radius') {
    const size = getWrappedSizeNumber(value);
    return size !== null && size > THRESHOLDS.borderRadius;
  }
  // RC-14: Grid-template-columns always need responsive scaling.
  // Tablet: only trigger for 3+ columns. Mobile: trigger for 2+ columns.
  if (prop === 'grid-template-columns') {
    const v = value as Record<string, unknown> | undefined;
    if (v && v['$$type'] === 'string') {
      const cols = String(v.value || '').trim().split(/\s+/);
      const f = factor ?? 0.6;
      // Tablet (factor ~0.75): scale 3+ column grids. Mobile (~0.6): scale 2+ column grids.
      return cols.length >= (f > 0.65 ? 3 : 2);
    }
    return false;
  }
  return false;
}

function findBaseVariant(style: FramerStyle): FramerStyleVariant | null {
  if (Array.isArray(style.variants)) {
    return style.variants.find(v => v?.meta?.breakpoint === null) || style.variants[0];
  }
  if (style.props) {
    return { meta: { breakpoint: null, state: null }, props: style.props };
  }
  return null;
}

function hasBreakpoint(style: FramerStyle, breakpoint: string): boolean {
  return (style.variants || []).some(v => v?.meta?.breakpoint === breakpoint);
}

function buildScaledVariant(
  baseVariant: FramerStyleVariant,
  breakpoint: string,
  factor: number,
): FramerStyleVariant | null {
  const props: Record<string, unknown> = {};
  for (const [prop, value] of Object.entries(baseVariant.props || {})) {
    if (propNeedsScaling(prop, value, factor)) props[prop] = scaleProp(prop, value, factor);
  }
  if (Object.keys(props).length === 0) return null;
  return { meta: { breakpoint, state: baseVariant.meta?.state ?? null }, props };
}

interface ScaleResult {
  tree: unknown;
  modifiedCount: number;
}

function autoScaleResponsive(tree: unknown): ScaleResult {
  let modifiedCount = 0;

  walkTree(tree, (node: Record<string, unknown>) => {
    if (node && node.styles && typeof node.styles === 'object') {
      for (const styleId in node.styles as Record<string, FramerStyle>) {
        const style = (node.styles as Record<string, FramerStyle>)[styleId];
        const baseVariant = findBaseVariant(style);
        if (!baseVariant?.props) continue;

        // C5: Element-spezifische Breakpoint-Faktoren
        const factors = getElementScaleFactors((node.id as string) || styleId, styleId);

        const newVariants: FramerStyleVariant[] = [];

        if (!hasBreakpoint(style, 'tablet')) {
          const tablet = buildScaledVariant(baseVariant, 'tablet', factors.tablet);
          if (tablet) newVariants.push(tablet);
        }
        if (!hasBreakpoint(style, 'mobile')) {
          const mobile = buildScaledVariant(baseVariant, 'mobile', factors.mobile);
          if (mobile) newVariants.push(mobile);
        }

        if (newVariants.length > 0) {
          style.variants = [...(style.variants || []), ...newVariants];
          modifiedCount++;
        }
      }
    }
  });

  return { tree, modifiedCount };
}

// ── Main ───────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const cliArgs: CliArgs = (() => {
    const a: CliArgs = { tree: null, output: null, breakpoints: null };
    const argv = process.argv.slice(2);
    for (let i = 0; i < argv.length; i++) {
      if (argv[i] === '--tree'   && argv[i+1]) { a.tree   = argv[++i]; }
      else if (argv[i] === '--output' && argv[i+1]) { a.output = argv[++i]; }
      else if (argv[i] === '--breakpoints' && argv[i+1]) { a.breakpoints = argv[++i]; }
      else if (!argv[i].startsWith('--') && !a.tree)   { a.tree   = argv[i]; }
      else if (!argv[i].startsWith('--') && !a.output) { a.output = argv[i]; }
    }
    return a;
  })();
  const treePath   = cliArgs.tree   || path.join(rootDir, 'v4-tree.json');
  const outputPath = cliArgs.output || treePath;

  // C5: Load breakpoints.json for element-specific scale factors
  if (cliArgs.breakpoints && fs.existsSync(cliArgs.breakpoints)) {
    breakpointsData = JSON.parse(fs.readFileSync(cliArgs.breakpoints, 'utf8')) as BreakpointsData;
    console.log(`📐 Breakpoint-Daten geladen: ${(breakpointsData.nodes || []).length} Selectoren`);
  }

  if (!fs.existsSync(treePath)) {
    console.error(`Datei nicht gefunden: ${treePath}`);
    process.exit(1);
  }

  console.log(`▶️  Lade Tree von: ${treePath}`);
  const tree = JSON.parse(fs.readFileSync(treePath, 'utf8')) as unknown;

  console.log('▶️  Führe intelligente Responsive Auto-Skalierung durch...');
  const result = autoScaleResponsive(tree);

  console.log(`✅ ${result.modifiedCount} Style-Blöcke mit automatischen Mobile/Tablet-Varianten erweitert.`);
  
  fs.writeFileSync(outputPath, JSON.stringify(result.tree, null, 2), 'utf8');
  console.log(`💾 Gespeichert unter: ${outputPath}`);
}

main();

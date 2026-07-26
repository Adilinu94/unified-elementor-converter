/**
 * V4 Responsive Auto-Scaling (Phase 52).
 * Automatically injects Mobile/Tablet variants for Typography and Spacing
 * when Desktop values exceed thresholds. Prevents broken mobile layouts.
 * KRITISCH: V4-only — uses V4 breakpoint variants. NEVER V3 responsive settings.
 * Ported from Framer-to-Elementor-V4-Pipeline/scripts/auto-scale-responsive.ts
 */

// ============================================================================
// Types
// ============================================================================

export interface ScaleFactors {
  tablet: number;
  mobile: number;
}

export interface StyleVariant {
  meta?: { breakpoint: string | null; state: string | null };
  props?: Record<string, unknown>;
}

export interface StyleDef {
  variants?: StyleVariant[];
  props?: Record<string, unknown>;
}

export interface V4Node {
  id?: string;
  styles?: Record<string, StyleDef>;
  [key: string]: unknown;
}

export interface ScaledProperty {
  property: string;
  desktopValue: number;
  tabletValue: number;
  mobileValue: number;
  unit: string;
}

export interface ScaleResult {
  elementId: string;
  styleId: string;
  scaledProperties: ScaledProperty[];
  injectedVariants: {
    tablet: Record<string, unknown>;
    mobile: Record<string, unknown>;
  };
}

export interface AutoScaleReport {
  meta: {
    generatedAt: string;
    totalElements: number;
    scaledElements: number;
    totalPropertiesScaled: number;
  };
  results: ScaleResult[];
}

// ============================================================================
// Thresholds
// ============================================================================

/**
 * Thresholds for auto-scaling. Values above these trigger responsive variants.
 * RC-19 + RC-14: Extended for comprehensive responsive scaling.
 */
export const SCALE_THRESHOLDS: Record<string, number> = {
  fontSize: 28,      // px
  padding: 20,       // px
  margin: 20,        // px
  widthPx: 300,      // px — wide desktop elements break mobile viewports
  heightPx: 200,     // px — tall desktop sections need mobile scaling
  minHeightPx: 200,  // px
  letterSpacing: 2,  // px
  gap: 24,           // px — RC-14: large gaps break mobile layouts
  borderRadius: 12,  // px — RC-14: large border radii look out of place on mobile
};

export const DEFAULT_SCALE_FACTORS: ScaleFactors = {
  tablet: 0.75,
  mobile: 0.6,
};

// Properties that should be scaled
const SCALABLE_PROPS = new Set([
  'font-size',
  'padding', 'padding-top', 'padding-right', 'padding-bottom', 'padding-left',
  'margin', 'margin-top', 'margin-right', 'margin-bottom', 'margin-left',
  'gap', 'row-gap', 'column-gap',
  'width', 'height', 'min-height', 'max-width',
  'letter-spacing',
  'border-radius',
]);

// ============================================================================
// Helpers
// ============================================================================

/**
 * Extract numeric px value from a wrapped V4 size value.
 */
export function getWrappedSizeNumber(wrapped: unknown): number | null {
  if (wrapped == null) return null;
  if (typeof wrapped === 'number') return wrapped;
  if (typeof wrapped === 'string') {
    const match = wrapped.match(/([\d.]+)\s*px/);
    return match ? parseFloat(match[1]) : null;
  }
  if (typeof wrapped === 'object') {
    const obj = wrapped as Record<string, unknown>;
    // V4 wrapped: { value: { size: N, unit: 'px' } }
    if (obj.value && typeof obj.value === 'object') {
      const inner = obj.value as Record<string, unknown>;
      if (typeof inner.size === 'number') return inner.size;
    }
    // Direct: { size: N, unit: 'px' }
    if (typeof obj.size === 'number') return obj.size;
  }
  return null;
}

/**
 * Scale a wrapped size value by a factor.
 */
export function scaleWrappedSize(wrapped: unknown, factor: number): unknown {
  const num = getWrappedSizeNumber(wrapped);
  if (num == null) return wrapped;

  const scaled = Math.round(num * factor * 100) / 100;

  if (typeof wrapped === 'object' && wrapped !== null) {
    const obj = wrapped as Record<string, unknown>;
    if (obj.value && typeof obj.value === 'object') {
      return { ...obj, value: { ...(obj.value as Record<string, unknown>), size: scaled } };
    }
    if (typeof obj.size === 'number') {
      return { ...obj, size: scaled };
    }
  }

  return `${scaled}px`;
}

function getThresholdForProp(prop: string): number | undefined {
  const normalized = prop.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
  return SCALE_THRESHOLDS[normalized] ?? SCALE_THRESHOLDS[prop];
}

// ============================================================================
// Main Auto-Scaling
// ============================================================================

/**
 * Determine if a property value exceeds its threshold.
 */
export function exceedsThreshold(prop: string, value: unknown): boolean {
  const threshold = getThresholdForProp(prop);
  if (threshold == null) return false;
  const num = getWrappedSizeNumber(value);
  return num != null && num > threshold;
}

/**
 * Auto-scale a single element's styles.
 */
export function autoScaleElement(
  elementId: string,
  styles: Record<string, StyleDef>,
  scaleFactors: ScaleFactors = DEFAULT_SCALE_FACTORS,
): ScaleResult | null {
  const scaledProperties: ScaledProperty[] = [];
  const tabletProps: Record<string, unknown> = {};
  const mobileProps: Record<string, unknown> = {};

  for (const [styleId, styleDef] of Object.entries(styles)) {
    const props = styleDef.props ?? {};

    for (const [prop, value] of Object.entries(props)) {
      if (!SCALABLE_PROPS.has(prop)) continue;
      if (!exceedsThreshold(prop, value)) continue;

      const desktopValue = getWrappedSizeNumber(value);
      if (desktopValue == null) continue;

      const tabletValue = Math.round(desktopValue * scaleFactors.tablet * 100) / 100;
      const mobileValue = Math.round(desktopValue * scaleFactors.mobile * 100) / 100;

      scaledProperties.push({
        property: prop,
        desktopValue,
        tabletValue,
        mobileValue,
        unit: 'px',
      });

      tabletProps[prop] = scaleWrappedSize(value, scaleFactors.tablet);
      mobileProps[prop] = scaleWrappedSize(value, scaleFactors.mobile);
    }
  }

  if (scaledProperties.length === 0) return null;

  return {
    elementId,
    styleId: Object.keys(styles)[0] || '',
    scaledProperties,
    injectedVariants: {
      tablet: tabletProps,
      mobile: mobileProps,
    },
  };
}

/**
 * Auto-scale all elements in a V4 tree.
 */
export function autoScaleTree(
  tree: V4Node[],
  scaleFactors: ScaleFactors = DEFAULT_SCALE_FACTORS,
): AutoScaleReport {
  const results: ScaleResult[] = [];

  function walk(node: V4Node): void {
    if (node.styles && node.id) {
      const result = autoScaleElement(node.id, node.styles, scaleFactors);
      if (result) results.push(result);
    }

    // Recurse into children
    const children = (node.elements || node.children || []) as V4Node[];
    for (const child of children) walk(child);
  }

  for (const root of tree) walk(root);

  return {
    meta: {
      generatedAt: new Date().toISOString(),
      totalElements: countElements(tree),
      scaledElements: results.length,
      totalPropertiesScaled: results.reduce((sum, r) => sum + r.scaledProperties.length, 0),
    },
    results,
  };
}

/**
 * Apply auto-scale results back to a V4 tree (injects breakpoint variants).
 */
export function applyAutoScaleToTree(
  tree: V4Node[],
  report: AutoScaleReport,
): V4Node[] {
  const resultsByElement = new Map(report.results.map((r) => [r.elementId, r]));

  function walk(node: V4Node): V4Node {
    const result = node.id ? resultsByElement.get(node.id) : undefined;

    if (result && node.styles) {
      const newStyles = { ...node.styles };
      for (const [styleId, styleDef] of Object.entries(newStyles)) {
        const variants = [...(styleDef.variants ?? [])];

        // Add tablet variant
        variants.push({
          meta: { breakpoint: 'tablet', state: null },
          props: result.injectedVariants.tablet,
        });

        // Add mobile variant
        variants.push({
          meta: { breakpoint: 'mobile', state: null },
          props: result.injectedVariants.mobile,
        });

        newStyles[styleId] = { ...styleDef, variants };
      }

      node = { ...node, styles: newStyles };
    }

    // Recurse
    const children = (node.elements || node.children || []) as V4Node[];
    if (children.length > 0) {
      const newChildren = children.map(walk);
      if (node.elements) node = { ...node, elements: newChildren };
      else if (node.children) node = { ...node, children: newChildren };
    }

    return node;
  }

  return tree.map(walk);
}

function countElements(tree: V4Node[]): number {
  let count = 0;
  function walk(node: V4Node): void {
    count++;
    const children = (node.elements || node.children || []) as V4Node[];
    for (const child of children) walk(child);
  }
  for (const root of tree) walk(root);
  return count;
}

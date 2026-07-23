/**
 * Bridge V3→V4 — Converts V3 element trees to V4 Atomic format.
 * Maps: section/column → e-flexbox, heading → e-heading, text-editor → e-paragraph, etc.
 */

import type { V3Element } from '@elconv/target-v3';
import type { V4TreeNode, V4StyleClass } from './types.js';

/** V3 widgetType → V4 type mapping */
const WIDGET_MAP: Record<string, string> = {
  'heading': 'e-heading',
  'text-editor': 'e-paragraph',
  'image': 'e-image',
  'button': 'e-button',
  'icon': 'e-icon',
  'icon-box': 'e-div-block',
  'video': 'e-video',
  'divider': 'e-divider',
  'spacer': 'e-spacer',
  'html': 'e-html',
  'form': 'e-form',
  'accordion': 'e-div-block',
  'container': 'e-flexbox',
};

/** V3 elType → V4 type mapping */
const ELTYPE_MAP: Record<string, string> = {
  'section': 'e-flexbox',
  'column': 'e-flexbox',
  'container': 'e-flexbox',
  'widget': 'e-div-block',
};

let bridgeIdCounter = 0;
function nextBridgeId(): string {
  return `br_${(++bridgeIdCounter).toString(36)}`;
}

export function resetBridgeIds(): void {
  bridgeIdCounter = 0;
}

export interface BridgeOptions {
  /** Preserve original IDs (default: true) */
  preserveIds?: boolean;
  /** Generate style classes from settings (default: true) */
  generateStyles?: boolean;
  /** Strict mode: throw on unmappable types (default: false) */
  strict?: boolean;
}

export interface BridgeResult {
  tree: V4TreeNode[];
  warnings: string[];
  mappedCount: number;
  skippedCount: number;
}

/**
 * Map V3 widget type to V4 atomic type.
 */
export function mapWidgetType(v3WidgetType: string, strict = false): string {
  const mapped = WIDGET_MAP[v3WidgetType];
  if (!mapped) {
    if (strict) throw new Error(`Unmappable V3 widget type: ${v3WidgetType}`);
    return 'e-div-block';
  }
  return mapped;
}

/**
 * Map V3 elType to V4 type.
 */
export function mapElType(v3ElType: string): string {
  return ELTYPE_MAP[v3ElType] ?? 'e-flexbox';
}

/**
 * Convert V3 settings to V4 settings with $$type wrappers where applicable.
 */
export function convertSettings(settings: Record<string, unknown> | undefined): Record<string, unknown> {
  if (!settings) return {};

  const result: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(settings)) {
    if (value === undefined || value === null) continue;

    // Wrap known size properties
    if (['font_size', 'width', 'height', 'gap'].includes(key) && typeof value === 'number') {
      result[key] = { '$$type': 'size', value: { size: value, unit: 'px' } };
    }
    // Wrap color properties
    else if (key.startsWith('_color') || key === 'color' || key === 'background_color') {
      result[key] = { '$$type': 'color', value };
    }
    // Wrap padding/margin
    else if (['padding', 'margin'].includes(key) && typeof value === 'object' && value !== null) {
      const v = value as Record<string, unknown>;
      result[key] = {
        '$$type': 'dimensions',
        value: {
          top: v.top ?? 0,
          right: v.right ?? 0,
          bottom: v.bottom ?? 0,
          left: v.left ?? 0,
          unit: v.unit ?? 'px',
        },
      };
    }
    // Pass through everything else
    else {
      result[key] = value;
    }
  }

  return result;
}

/**
 * Generate a V4 style class from V3 settings.
 */
export function generateStyleClass(id: string, settings: Record<string, unknown>): V4StyleClass | null {
  const props: Record<string, unknown> = {};

  // Extract style-relevant props
  for (const [key, value] of Object.entries(settings)) {
    if (key.startsWith('_') || ['padding', 'margin', 'background_color', 'border_radius'].includes(key)) {
      props[key] = value;
    }
  }

  if (Object.keys(props).length === 0) return null;

  return {
    id: `style_${id}`,
    label: `Style ${id}`,
    type: 'class',
    variants: [{
      meta: { breakpoint: null, state: null },
      props,
      custom_css: null,
    }],
  };
}

/**
 * Convert a single V3 element to V4 tree node.
 */
export function convertElement(
  el: V3Element,
  options: BridgeOptions = {},
  warnings: string[] = [],
): V4TreeNode {
  const { preserveIds = true, generateStyles = true, strict = false } = options;

  // Determine V4 type
  let v4Type: string;
  if (el.elType === 'widget' && el.widgetType) {
    v4Type = mapWidgetType(el.widgetType, strict);
  } else {
    v4Type = mapElType(el.elType);
  }

  // Convert settings
  const settings = convertSettings(el.settings);

  // Generate styles
  const styles: Record<string, V4StyleClass> = {};
  if (generateStyles && el.settings) {
    const styleClass = generateStyleClass(el.id, convertSettings(el.settings));
    if (styleClass) {
      styles[styleClass.id] = styleClass;
    }
  }

  // Convert children
  const elements = el.elements?.map((child) => convertElement(child, options, warnings));

  const node: V4TreeNode = {
    type: v4Type,
    elType: v4Type.startsWith('e-') && ['e-flexbox', 'e-div-block', 'e-grid'].includes(v4Type) ? v4Type : 'widget',
    widgetType: v4Type,
    id: preserveIds ? el.id : nextBridgeId(),
    settings,
    styles,
  };

  if (elements && elements.length > 0) {
    node.elements = elements;
  }

  return node;
}

/**
 * Bridge an entire V3 element tree to V4.
 */
export function bridgeV3toV4(elements: V3Element[], options: BridgeOptions = {}): BridgeResult {
  const warnings: string[] = [];
  let mappedCount = 0;
  let skippedCount = 0;

  function countElements(els: V3Element[]): void {
    for (const el of els) {
      mappedCount++;
      if (el.elements) countElements(el.elements);
    }
  }

  countElements(elements);
  const tree = elements.map((el) => convertElement(el, options, warnings));

  return { tree, warnings, mappedCount, skippedCount };
}

/**
 * Validate that a bridged tree contains no V3 contamination.
 */
export function validateBridgeOutput(tree: V4TreeNode[]): { valid: boolean; issues: string[] } {
  const issues: string[] = [];

  function walk(nodes: V4TreeNode[]): void {
    for (const node of nodes) {
      // Check for V3-only elTypes
      if (['section', 'column'].includes(node.elType)) {
        issues.push(`Node ${node.id}: V3 elType "${node.elType}" found in V4 tree`);
      }
      // Check for V3-only widget types
      if (node.widgetType && ['text-editor', 'icon-box'].includes(node.widgetType)) {
        issues.push(`Node ${node.id}: V3 widgetType "${node.widgetType}" found in V4 tree`);
      }
      // Check type starts with e-
      if (!node.type.startsWith('e-')) {
        issues.push(`Node ${node.id}: type "${node.type}" doesn't follow V4 naming (e-*)`);
      }
      if (node.elements) walk(node.elements);
    }
  }

  walk(tree);
  return { valid: issues.length === 0, issues };
}

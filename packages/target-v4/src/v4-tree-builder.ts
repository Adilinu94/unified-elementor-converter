/**
 * src/converter/v4-tree-builder.ts
 * UMBAUPLAN v2.0 Phase 1.1 + 1.4 — Atomic-Tree-Builder Helpers.
 *
 * Verschoben von scripts/lib/v4-tree-builder.ts (UMBAUPLAN Phase 1.2)
 *
 * Kapselt die V4-Atomic-Tree-Konstruktion in 3 Pure-Functions:
 *   - buildAtomicContainer() — e-flexbox / e-div-block (elType = widgetType)
 *   - buildAtomicWidget()    — e-heading / e-paragraph / e-button / e-image etc.
 *   - buildStyleClass()      — Style-Variants-Objekt mit class-id-Struktur
 */

import {
  wrapType, wrapColor, wrapSize, wrapDimensions, wrapBorderRadius,
  wrapClasses, isValidStyleId,
} from './framer-utils.js';

// Types are imported from src/types/elementor-v4.ts to avoid duplication.
// Re-export so the Strangler-Fig proxy in scripts/lib/ still forwards them.
import type {
  AtomicContainerOptions,
  AtomicWidgetOptions,
  StyleClassOptions,
  MapStyleOptions,
  BuildDesktopVariantOptions,
} from '../types/elementor-v4.js';

export type {
  AtomicContainerOptions,
  AtomicWidgetOptions,
  StyleClassOptions,
  MapStyleOptions,
  BuildDesktopVariantOptions,
};

const ATOMIC_ELEMENT_TYPES = new Set(['e-flexbox', 'e-div-block']);

// ── Core Functions ───────────────────────────────────────────────────────────

export function buildAtomicContainer({
  id, tag, styleId, widgetType = 'e-flexbox', label, children = [],
}: AtomicContainerOptions): Record<string, unknown> {
  if (!isValidStyleId(styleId)) {
    throw new Error(`buildAtomicContainer: invalid styleId "${styleId}" (Invariant III)`);
  }
  const node: Record<string, unknown> = {
    type: widgetType,
    elType: widgetType,
    widgetType,
    id,
    settings: {
      classes: wrapClasses([styleId]),
      tag: wrapType('string', tag || 'div'),
    },
    styles: {
      [styleId]: buildStyleClass({ id: styleId, label: label || widgetType }),
    },
  };
  if (children.length > 0) node.elements = children;
  return node;
}

export function buildAtomicWidget({
  id, widgetType, styleId, settings = {}, label,
}: AtomicWidgetOptions): Record<string, unknown> {
  if (!isValidStyleId(styleId)) {
    throw new Error(`buildAtomicWidget: invalid styleId "${styleId}" (Invariant III)`);
  }
  if (ATOMIC_ELEMENT_TYPES.has(widgetType)) {
    throw new Error(`buildAtomicWidget: widgetType "${widgetType}" is a container — use buildAtomicContainer()`);
  }
  const finalSettings = { classes: wrapClasses([styleId]), ...settings };
  return {
    type: widgetType,
    elType: 'widget',
    widgetType,
    id,
    settings: finalSettings,
    styles: {
      [styleId]: buildStyleClass({ id: styleId, label: label || widgetType }),
    },
  };
}

export function buildStyleClass({
  id, label, type = 'class', variants,
}: StyleClassOptions): Record<string, unknown> {
  if (!isValidStyleId(id)) {
    throw new Error(`buildStyleClass: invalid id "${id}" (Invariant III)`);
  }
  const finalVariants = variants && variants.length > 0
    ? variants
    : [{
        meta: { breakpoint: null, state: null },
        props: {},
        custom_css: null,
      }];
  return {
    id,
    label: label || id,
    type,
    variants: finalVariants,
  };
}

export function mapFramerStyleToV4Props(
  attrs: Record<string, unknown>,
  widgetType: string,
  opts: MapStyleOptions = {},
): Record<string, unknown> {
  const {
    stackDirection, stackGap, padding, maxWidth, width, height,
    backgroundColor, 'background-color': bgColor,
    borderRadius, 'border-radius': borderRadiusAlt,
    position, top, right, bottom, left,
    color, 'font-family': fontFamily, 'font-size': fontSize,
    'font-weight': fontWeight, 'line-height': lineHeight,
    'letter-spacing': letterSpacing, opacity,
  } = attrs as Record<string, string | undefined>;
  const props: Record<string, unknown> = {};

  if (widgetType === 'e-flexbox' || widgetType === 'e-button') {
    props['display'] = wrapType('string', 'flex');
    if (stackDirection) {
      props['flex-direction'] = wrapType('string', stackDirection === 'vertical' ? 'column' : 'row');
    }
    if (stackGap) props['gap'] = wrapSize(stackGap);
    if (padding) props['padding'] = wrapDimensions(padding);
    if (maxWidth && /^[-0-9.]/.test(maxWidth)) props['max-width'] = wrapSize(maxWidth);
  }

  if (widgetType === 'e-div-block') {
    props['display'] = wrapType('string', 'grid');
  }

  if (widgetType === 'e-heading' || widgetType === 'e-paragraph') {
    if (fontSize) props['font-size'] = wrapSize(fontSize);
    if (fontWeight) props['font-weight'] = wrapType('string', fontWeight);
    if (fontFamily) props['font-family'] = wrapType('string', fontFamily.split(',')[0].trim().replace(/['"]/g, ''));
    if (color) {
      const hex = String(color).trim();
      if (hex.startsWith('#')) props['color'] = wrapColor(hex);
    }
  }

  const br = borderRadius || borderRadiusAlt;
  if (br) props['border-radius'] = wrapBorderRadius(br);

  if (position) {
    const hasExplicitOffsets = top !== undefined || right !== undefined || bottom !== undefined || left !== undefined;
    if (position !== 'absolute' || hasExplicitOffsets) {
      props['position'] = wrapType('string', position);
    }
  }

  if (opacity !== undefined) props['opacity'] = wrapType('string', String(opacity));

  return props;
}

export function buildDesktopVariant(
  attrs: Record<string, unknown>,
  widgetType: string,
  opts?: MapStyleOptions,
): Record<string, unknown> {
  return {
    meta: { breakpoint: null, state: null },
    props: mapFramerStyleToV4Props(attrs, widgetType, opts),
    custom_css: null,
  };
}

export { wrapClasses } from './framer-utils.js';

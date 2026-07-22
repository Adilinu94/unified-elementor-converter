/**
 * Elementor V4 Atomic types.
 * KRITISCH: Diese Types verwenden $$type Envelopes und styles{} maps.
 * NIEMALS elType: 'container' oder 'section' als finaler V4-Output.
 */

export interface V4TreeNode {
  type: string;           // e-flexbox, e-heading, e-button, etc.
  elType: string;         // same as type for containers, 'widget' for widgets
  widgetType: string;     // same as type
  id: string;
  settings: Record<string, unknown>;  // contains $$type wrapped values
  styles: Record<string, V4StyleClass>;  // style-id → class definition
  elements?: V4TreeNode[];
}

export interface V4StyleClass {
  id: string;
  label: string;
  type: string;  // 'class'
  variants: V4StyleVariant[];
}

export interface V4StyleVariant {
  meta: { breakpoint: string | null; state: string | null };
  props: Record<string, unknown>;  // $$type wrapped CSS props
  custom_css: unknown;
}

// $$type wrapper types
export interface TypedValue { '$$type': string; value: unknown; }
export interface TypedSize { '$$type': 'size'; value: { size: number; unit: string }; }
export interface TypedColor { '$$type': 'color'; value: string; }
export interface TypedClasses { '$$type': 'classes'; value: string[]; }
export interface TypedDimensions {
  '$$type': 'dimensions';
  value: { top: number; right: number; bottom: number; left: number; unit: string };
}
export interface TypedBorderRadius {
  '$$type': 'border-radius';
  value: { top_left: number; top_right: number; bottom_right: number; bottom_left: number; unit: string };
}
export interface TypedImageSrc {
  '$$type': 'image-src';
  value: { url: string; id: number | string };
}

/** Valid V4 atomic element types */
export const V4_ATOMIC_TYPES = [
  'e-flexbox',
  'e-div-block',
  'e-grid',
  'e-heading',
  'e-paragraph',
  'e-text',
  'e-button',
  'e-image',
  'e-icon',
  'e-video',
  'e-divider',
  'e-spacer',
  'e-html',
  'e-form',
  'e-link',
] as const;

export type V4AtomicType = (typeof V4_ATOMIC_TYPES)[number];

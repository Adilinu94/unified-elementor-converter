/**
 * src/types/elementor-v4.ts
 * Elementor V4 Atomic Widget & Tree Typdefinitionen.
 *
 * Deckt ab:
 *   - AtomicContainerOptions / AtomicWidgetOptions / StyleClassOptions
 *   - V4 $$type Wrapper-Typen
 *   - V4 Tree Node-Strukturen
 */

// ── Atomic Builder Types ─────────────────────────────────────────────────────

export interface AtomicContainerOptions {
  id: string;
  tag: string;
  styleId: string;
  widgetType?: string;
  label?: string;
  children?: unknown[];
}

export interface AtomicWidgetOptions {
  id: string;
  widgetType: string;
  styleId: string;
  settings?: Record<string, unknown>;
  label?: string;
}

export interface StyleClassOptions {
  id: string;
  label?: string;
  type?: string;
  variants?: Record<string, unknown>[];
}

export interface MapStyleOptions {
  tokenMapping?: Record<string, unknown> | null;
  fontResolution?: Record<string, unknown> | null;
  imageMap?: Record<string, unknown> | null;
}

export interface BuildDesktopVariantOptions {
  tokenMapping?: Record<string, unknown> | null;
  fontResolution?: Record<string, unknown> | null;
  imageMap?: Record<string, unknown> | null;
}

// ── V4 $$type Wrapper Types ──────────────────────────────────────────────────

/** Typed AST Value — z.B. { $$type: 'size', value: { size: 16, unit: 'px' } } */
export interface TypedValue {
  '$$type': string;
  value: unknown;
}

export interface TypedSize extends TypedValue {
  '$$type': 'size';
  value: { size: number; unit: string };
}

export interface TypedColor extends TypedValue {
  '$$type': 'color';
  value: string;
}

export interface TypedGvColor extends TypedValue {
  '$$type': 'global-color-variable';
  value: string;
}

export interface TypedGvFont extends TypedValue {
  '$$type': 'global-font-variable';
  value: string;
}

export interface TypedClasses extends TypedValue {
  '$$type': 'classes';
  value: string[];
}

export interface TypedDimensions extends TypedValue {
  '$$type': 'dimensions';
  value: {
    'block-start': TypedValue;
    'block-end': TypedValue;
    'inline-start': TypedValue;
    'inline-end': TypedValue;
  };
}

export interface TypedBorderRadius extends TypedValue {
  '$$type': 'border-radius';
  value: {
    'start-start': TypedValue;
    'start-end': TypedValue;
    'end-end': TypedValue;
    'end-start': TypedValue;
  };
}

export interface TypedImageSrc extends TypedValue {
  '$$type': 'image-src';
  value: { id?: string; url?: TypedValue };
}

export interface TypedImage extends TypedValue {
  '$$type': 'image';
  value: {
    src: TypedValue;
    size: TypedValue;
  };
}

export interface TypedHtmlV3 extends TypedValue {
  '$$type': 'html-v3';
  value: { content: TypedValue };
}

// ── V4 Tree Node ─────────────────────────────────────────────────────────────

export interface V4StyleClass {
  id: string;
  label: string;
  type: string;
  variants: V4StyleVariant[];
}

export interface V4StyleVariant {
  meta: { breakpoint: string | null; state: string | null };
  props: Record<string, unknown>;
  custom_css: unknown;
}

export interface V4TreeNode {
  type: string;
  elType: string;
  widgetType: string;
  id: string;
  settings: Record<string, unknown>;
  styles: Record<string, V4StyleClass>;
  elements?: V4TreeNode[];
}

// ── Validation Types ─────────────────────────────────────────────────────────

export interface GuardResult {
  guardId: string;
  severity: 'error' | 'warning' | 'info';
  errors: string[];
  warnings: string[];
  score: number;
}

export interface GuardContext {
  tree: V4TreeNode;
  reportWarning: (message: string) => void;
  reportError: (message: string) => void;
}

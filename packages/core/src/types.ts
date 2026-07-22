/**
 * Version-agnostic source specification.
 * Extractors produce this; target builders consume it.
 */

export type SourceType = 'url' | 'framer-xml' | 'html-export';

export interface SourceSpec {
  /** Where the content came from */
  source: {
    type: SourceType;
    url?: string;
    xmlPath?: string;
    htmlPath?: string;
  };
  /** Extracted design tokens */
  tokens: DesignTokenSet;
  /** Page sections in order */
  sections: SectionSpec[];
  /** Raw CSS variables discovered */
  cssVars: Record<string, string>;
  /** Warnings from extraction */
  warnings: string[];
}

export interface SectionSpec {
  id: string;
  /** Semantic hint: hero, header, stats, services, footer, etc. */
  semanticRole?: string;
  /** CSS class prefix for this section */
  cssClass?: string;
  /** Layout type */
  layout: 'single-column' | 'multi-column' | 'grid' | 'flex-row';
  columns?: number;
  /** Child widgets in order */
  widgets: WidgetSpec[];
  /** Section-level styles (background, padding, etc.) */
  styles: Record<string, string>;
  /** Animation hints */
  animations?: AnimationHint[];
}

export interface WidgetSpec {
  id: string;
  /** Semantic widget type (version-agnostic) */
  type: WidgetType;
  /** Text content (for heading, text, button) */
  text?: string;
  /** Image source URL */
  imageUrl?: string;
  /** Link href (for buttons, links) */
  href?: string;
  /** Computed styles from source */
  styles: Record<string, string>;
  /** Child widgets (for nested structures) */
  children?: WidgetSpec[];
}

export type WidgetType =
  | 'heading'
  | 'text'
  | 'image'
  | 'button'
  | 'icon'
  | 'video'
  | 'divider'
  | 'spacer'
  | 'html'
  | 'form'
  | 'accordion'
  | 'container';

export interface AnimationHint {
  type: 'fade-up' | 'fade-in' | 'slide-left' | 'slide-right' | 'scale' | 'custom';
  selector?: string;
  duration?: number;
  delay?: number;
}

export interface DesignTokenSet {
  colors: DesignToken[];
  fonts: DesignToken[];
  sizes: DesignToken[];
}

export interface DesignToken {
  id: string;
  hex?: string;
  family?: string;
  weight?: number;
  px?: number;
  occurrences: number;
  gv_id: string | null;
  label?: string;
  role?: SemanticRole;
  css_var?: string | null;
}

export type SemanticRole =
  | 'primary' | 'secondary' | 'accent'
  | 'background' | 'surface'
  | 'text' | 'text-muted'
  | 'border' | 'heading' | 'body';

export const EMPTY_DESIGN_TOKEN_SET: DesignTokenSet = {
  colors: [], fonts: [], sizes: [],
};

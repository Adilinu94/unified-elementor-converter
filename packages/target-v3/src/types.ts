/**
 * Elementor V3 element types.
 * KRITISCH: Diese Types dürfen NIEMALS $$type, e-flexbox, etc. enthalten.
 */

export interface V3Element {
  id: string;
  elType: 'section' | 'column' | 'widget' | 'container';
  settings?: Record<string, unknown>;
  elements?: V3Element[];
  widgetType?: string;
  isInner?: boolean;
}

export interface V3PageData {
  title: string;
  status: 'publish' | 'draft';
  type: 'page';
  content: V3Element[];
  version: string;
  metadata: {
    generatedAt: string;
    sourceUrl: string;
    sectionCount: number;
    widgetCount: number;
  };
}

/** Valid V3 widget types */
export const V3_WIDGET_TYPES = [
  'heading',
  'text-editor',
  'image',
  'button',
  'icon',
  'icon-box',
  'video',
  'divider',
  'spacer',
  'html',
  'form',
  'accordion',
  'container',
] as const;

export type V3WidgetType = (typeof V3_WIDGET_TYPES)[number];

/** Valid V3 elType values */
export const V3_EL_TYPES = ['section', 'column', 'widget', 'container'] as const;

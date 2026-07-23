export type V3LayoutPattern =
  | 'hero'
  | 'image-text-sbs'
  | 'card-grid'
  | 'sticky-header'
  | 'footer'
  | 'content'
  | 'stats'
  | 'faq'
  | 'testimonials'
  | 'pricing'
  | 'timeline'
  | 'tabs'
  | 'accordion';

export interface V3Widget {
  type: string;
  source_selector: string;
  source_tag: string;
  content?: string;
  settings: Record<string, unknown>;
}

export interface WidgetMappingResult extends V3Widget {
  warnings: string[];
}

export interface ClassifierInput {
  selector: string;
  tag: string;
  styles: Record<string, string>;
  content?: string;
  childCount?: number;
  yRange?: [number, number];
}

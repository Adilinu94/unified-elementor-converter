/**
 * Classifier Types — V3 layout patterns, widget specs, section specs.
 * Merged from site-clone-to-v3/src/classifier/types.ts (Phase 45).
 */

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
  | 'accordion'
  | 'feature-list'
  | 'stat-row'
  | 'logo-grid';

export type V3WidgetType =
  | 'heading'
  | 'text-editor'
  | 'button'
  | 'image'
  | 'video'
  | 'form'
  | 'icon'
  | 'divider'
  | 'spacer'
  | 'html';

export interface V3Widget {
  type: string;
  source_selector: string;
  source_tag: string;
  content?: string;
  settings: Record<string, unknown>;
}

export interface WidgetSpec extends V3Widget {
  classes?: string[];
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

// ─── Section-Picker Types (Phase 45) ─────────────────────────────────────────

export type PickerDecisionType = 'approve' | 'skip' | 'review';

export interface PickerDecision {
  section_id: string;
  decision: PickerDecisionType;
  reviewed_at?: string;
  notes?: string;
}

export interface SelectedSections {
  url: string;
  extracted_at: string;
  decisions: PickerDecision[];
  approved_count: number;
  skipped_count: number;
}

export interface V3Column {
  width: string;
  widgets: V3Widget[];
}

export interface V3Section {
  pattern: V3LayoutPattern;
  columns: V3Column[];
  settings: Record<string, unknown>;
  animations: unknown[];
}

export interface SettingsProvenanceEntry {
  source: 'design-token' | 'computed-style' | 'css-var';
  value: string;
  token_name?: string;
}

export interface SectionSpec {
  $schema: string;
  section_id: string;
  source: {
    url: string;
    selector: string;
    y_range: [number, number];
  };
  pattern: V3LayoutPattern;
  v3_section: V3Section;
  settings_provenance: Record<string, SettingsProvenanceEntry>;
  assets_required: unknown[];
  animations_required: unknown[];
  user_overrides: Record<string, unknown>;
  /** Modul P1: vision-enhanced semantic type (optional). */
  semanticType?: string;
  /** Modul P1: vision layout description (optional). */
  layoutDescription?: string;
  /** Modul P1: vision confidence (optional). */
  visionConfidence?: number;
}

/**
 * Widget-Validator — V2 Phase 5
 * Pre-build validation for V3 widgets. Catches missing required settings,
 * unknown widget types, Pro-only widgets in non-Pro targets.
 *
 * Portiert aus site-clone-to-v3/src/classifier/widget-validator.ts (Phase 45).
 */
import type { V3Widget, ClassifierV3WidgetType as V3WidgetType, WidgetSpec } from './types.js';
import type { ProWidgetSuggestion, ProWidgetType } from './widget-mapper.js';
import type { ProState } from './widget-degradation.js';

export type WidgetIssueSeverity = 'error' | 'warning' | 'info';

export interface WidgetIssue {
  severity: WidgetIssueSeverity;
  widget_type: V3WidgetType | ProWidgetType;
  source_selector?: string;
  code: string;
  message: string;
  suggestion?: string;
}

export interface WidgetValidationOptions {
  proState: ProState;
  disallowedProWidgets?: ReadonlySet<ProWidgetType>;
}

export interface WidgetValidationResult {
  ok: boolean;
  issues: WidgetIssue[];
  errors: number;
  warnings: number;
  info: number;
}

const REQUIRED_V3_SETTINGS: Readonly<Record<V3WidgetType, readonly string[]>> = {
  heading: ['title', 'header_size'],
  'text-editor': ['editor'],
  button: ['text'],
  image: [],
  video: [],
  form: [],
  icon: [],
  divider: [],
  spacer: [],
  html: [],
};

export const KNOWN_V3_WIDGET_TYPES: ReadonlySet<V3WidgetType> = new Set<V3WidgetType>([
  'heading', 'text-editor', 'button', 'image', 'video', 'form', 'icon', 'divider', 'spacer', 'html',
]);

export const KNOWN_PRO_WIDGET_TYPES: ReadonlySet<ProWidgetType> = new Set<ProWidgetType>([
  'slider', 'accordion', 'tabs', 'counter', 'testimonial-carousel', 'price-table',
  'animated-headline', 'progress-bar', 'forms', 'posts', 'share-buttons', 'gallery', 'image-box', 'icon-box',
]);

export function isKnownV3WidgetType(value: string): value is V3WidgetType {
  return (KNOWN_V3_WIDGET_TYPES as ReadonlySet<string>).has(value);
}

export function isKnownProWidgetType(value: string): value is ProWidgetType {
  return (KNOWN_PRO_WIDGET_TYPES as ReadonlySet<string>).has(value);
}

export function validateV3Widget(widget: V3Widget | WidgetSpec, options: WidgetValidationOptions): WidgetIssue[] {
  const issues: WidgetIssue[] = [];

  if (!isKnownV3WidgetType(widget.type)) {
    issues.push({
      severity: 'error', widget_type: widget.type as V3WidgetType, source_selector: widget.source_selector,
      code: 'unknown_widget_type', message: `Unknown V3 widget type: ${widget.type}`,
      suggestion: 'Use one of: heading, text-editor, button, image, video, form, icon, divider, spacer, html',
    });
    return issues;
  }

  if (isKnownProWidgetType(widget.type)) {
    issues.push({
      severity: 'error', widget_type: widget.type as ProWidgetType, source_selector: widget.source_selector,
      code: 'pro_widget_in_v3_run',
      message: `Pro-only widget "${widget.type}" present in V3 build but Pro state is ${options.proState}`,
      suggestion: 'Run degradeProWidgets() before building',
    });
  }

  if (options.disallowedProWidgets?.has(widget.type as ProWidgetType)) {
    issues.push({
      severity: 'error', widget_type: widget.type as ProWidgetType, source_selector: widget.source_selector,
      code: 'disallowed_pro_widget', message: `Widget "${widget.type}" is explicitly disallowed in this run`,
    });
  }

  const required = REQUIRED_V3_SETTINGS[widget.type as V3WidgetType] ?? [];
  for (const key of required) {
    if (!Object.prototype.hasOwnProperty.call(widget.settings, key)) {
      issues.push({
        severity: 'error', widget_type: widget.type as V3WidgetType, source_selector: widget.source_selector,
        code: 'missing_required_setting', message: `Widget "${widget.type}" is missing required setting "${key}"`,
        suggestion: `Provide "${key}" in settings`,
      });
    }
  }

  if (widget.type === 'image' && !hasImageUrl(widget.settings)) {
    issues.push({
      severity: 'warning', widget_type: 'image', source_selector: widget.source_selector,
      code: 'missing_image_url', message: 'Image widget has no URL — will render as empty placeholder',
    });
  }

  if (widget.type === 'button') {
    const text = widget.settings['text'];
    if (typeof text !== 'string' || text.trim().length === 0) {
      issues.push({
        severity: 'warning', widget_type: 'button', source_selector: widget.source_selector,
        code: 'empty_button_text', message: 'Button widget has empty text',
      });
    }
  }

  return issues;
}

export function validateProWidget(widget: ProWidgetSuggestion, options: WidgetValidationOptions): WidgetIssue[] {
  const issues: WidgetIssue[] = [];

  if (!isKnownProWidgetType(widget.type)) {
    issues.push({
      severity: 'error', widget_type: widget.type, source_selector: widget.source_selector,
      code: 'unknown_pro_widget_type', message: `Unknown Pro widget type: ${widget.type}`,
    });
  }

  if (options.proState === 'absent') {
    issues.push({
      severity: 'error', widget_type: widget.type, source_selector: widget.source_selector,
      code: 'pro_widget_without_pro', message: `Pro widget "${widget.type}" passed to build but target has no Pro`,
      suggestion: 'Run degradeProWidgets() with proState="absent"',
    });
  }

  if (options.proState === 'unknown') {
    issues.push({
      severity: 'info', widget_type: widget.type, source_selector: widget.source_selector,
      code: 'pro_widget_pro_state_unknown', message: `Pro widget "${widget.type}" with unknown Pro state`,
    });
  }

  if (options.disallowedProWidgets?.has(widget.type)) {
    issues.push({
      severity: 'error', widget_type: widget.type, source_selector: widget.source_selector,
      code: 'disallowed_pro_widget', message: `Pro widget "${widget.type}" is explicitly disallowed`,
    });
  }

  const contentRequired: ReadonlySet<ProWidgetType> = new Set<ProWidgetType>(['counter', 'animated-headline', 'image-box', 'icon-box']);
  if (contentRequired.has(widget.type) && (!widget.content || widget.content.trim().length === 0)) {
    issues.push({
      severity: 'warning', widget_type: widget.type, source_selector: widget.source_selector,
      code: 'missing_content', message: `Pro widget "${widget.type}" has empty content`,
    });
  }

  return issues;
}

export function validateWidgets(
  widgets: ReadonlyArray<V3Widget | WidgetSpec | ProWidgetSuggestion>,
  options: WidgetValidationOptions,
): WidgetValidationResult {
  const issues: WidgetIssue[] = [];

  for (const widget of widgets) {
    if (isProWidgetSuggestion(widget)) {
      issues.push(...validateProWidget(widget, options));
    } else {
      issues.push(...validateV3Widget(widget, options));
    }
  }

  const errors = issues.filter((i) => i.severity === 'error').length;
  const warnings = issues.filter((i) => i.severity === 'warning').length;
  const info = issues.filter((i) => i.severity === 'info').length;

  return { ok: errors === 0, issues, errors, warnings, info };
}

function isProWidgetSuggestion(widget: V3Widget | WidgetSpec | ProWidgetSuggestion): widget is ProWidgetSuggestion {
  return (widget as ProWidgetSuggestion).requires_pro === true;
}

function hasImageUrl(settings: Record<string, unknown>): boolean {
  const url = settings['url'] ?? settings['image'] ?? settings['src'];
  if (typeof url === 'string') return url.trim().length > 0;
  if (url && typeof url === 'object') {
    const nested = (url as Record<string, unknown>)['url'];
    return typeof nested === 'string' && nested.trim().length > 0;
  }
  return false;
}

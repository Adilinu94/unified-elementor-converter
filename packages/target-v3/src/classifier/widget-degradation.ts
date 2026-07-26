/**
 * Widget-Degradation — V2 Phase 5
 * Resolves Pro-only widgets to free fallback widgets when Elementor Pro
 * is not available on the target.
 *
 * Portiert aus site-clone-to-v3/src/classifier/widget-degradation.ts (Phase 45).
 */
import type { ProWidgetSuggestion, ProWidgetType } from './widget-mapper.js';
import type { V3Widget, WidgetSpec } from './types.js';

export type FallbackWidgetType = 'text-editor' | 'html';
export type ProState = 'present' | 'absent' | 'unknown';

export interface DegradationRecord {
  source_selector: string;
  pro_widget: ProWidgetType;
  fallback_widget: FallbackWidgetType;
  reason: string;
  preserved_assets: number;
}

export interface DegradationResult {
  fallbacks: V3Widget[];
  kept: ProWidgetSuggestion[];
  records: DegradationRecord[];
  degraded_count: number;
}

export function degradeProWidget(pro: ProWidgetSuggestion, proState: ProState): V3Widget {
  if (proState === 'present') {
    return {
      type: 'html',
      source_selector: pro.source_selector,
      source_tag: pro.source_tag,
      content: undefined,
      settings: { _pro_widget: pro.type, _pro_settings: pro.settings },
    };
  }
  if (pro.fallback === 'html') return degradeToHtml(pro);
  return degradeToTextEditor(pro);
}

function degradeToTextEditor(pro: ProWidgetSuggestion): V3Widget {
  const editor = renderProAsEditor(pro);
  return {
    type: 'text-editor',
    source_selector: pro.source_selector,
    source_tag: pro.source_tag,
    content: editor,
    settings: { editor, _degraded_from: pro.type, _reason: pro.warnings.join(' | ') },
  };
}

function degradeToHtml(pro: ProWidgetSuggestion): V3Widget {
  const html = renderProAsHtml(pro);
  return {
    type: 'html',
    source_selector: pro.source_selector,
    source_tag: pro.source_tag,
    content: html,
    settings: { html, _degraded_from: pro.type, _reason: pro.warnings.join(' | ') },
  };
}

export function renderProAsHtml(pro: ProWidgetSuggestion): string {
  switch (pro.type) {
    case 'forms':
      return `<form class="elementor-form-fallback" data-clone-source="${pro.source_selector}">${pro.content ?? ''}</form>`;
    case 'gallery':
      return `<div class="elementor-gallery-fallback" data-clone-source="${pro.source_selector}">${pro.content ?? ''}</div>`;
    case 'posts':
      return `<div class="elementor-posts-fallback" data-clone-source="${pro.source_selector}">${pro.content ?? ''}</div>`;
    default:
      return renderProAsEditor(pro);
  }
}

export function renderProAsEditor(pro: ProWidgetSuggestion): string {
  if (pro.content && pro.content.trim().length > 0) return pro.content;
  switch (pro.type) {
    case 'counter': return '0';
    case 'progress-bar': return '0%';
    default: return '';
  }
}

export function countPreservedAssets(html: string): number {
  if (!html) return 0;
  const matches = html.match(/<(img|iframe|video|picture)\b/gi);
  return matches ? matches.length : 0;
}

export function degradeProWidgets(
  pros: readonly ProWidgetSuggestion[],
  proState: ProState,
): DegradationResult {
  const fallbacks: V3Widget[] = [];
  const kept: ProWidgetSuggestion[] = [];
  const records: DegradationRecord[] = [];

  for (const pro of pros) {
    if (proState === 'present') {
      kept.push(pro);
      records.push({
        source_selector: pro.source_selector,
        pro_widget: pro.type,
        fallback_widget: pro.fallback,
        reason: 'Pro present — kept as Pro widget',
        preserved_assets: 0,
      });
      continue;
    }

    const fallback = degradeProWidget(pro, proState);
    const html = fallback.settings['html'];
    const preserved_assets = typeof html === 'string' ? countPreservedAssets(html) : 0;

    fallbacks.push(fallback);
    records.push({
      source_selector: pro.source_selector,
      pro_widget: pro.type,
      fallback_widget: pro.fallback,
      reason: proState === 'unknown'
        ? `Pro state unknown — degraded conservatively to ${pro.fallback}`
        : `Pro absent — degraded to ${pro.fallback}`,
      preserved_assets,
    });
  }

  return { fallbacks, kept, records, degraded_count: fallbacks.length };
}

export function toWidgetSpec(widget: V3Widget): WidgetSpec {
  return {
    type: widget.type,
    source_selector: widget.source_selector,
    source_tag: widget.source_tag,
    content: widget.content,
    settings: widget.settings,
    classes: undefined,
  };
}

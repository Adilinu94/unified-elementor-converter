/**
 * Widget-Mapper — Maps DOM elements to V3 widget suggestions.
 */
import type { WidgetMappingResult } from './types.js';

export interface WidgetMappingOptions {
  warnOnPro?: boolean;
}

export function mapElementToWidget(
  tag: string,
  selector: string,
  styles: Record<string, string>,
  content?: string,
  options: WidgetMappingOptions = {},
): WidgetMappingResult {
  const tagLower = tag.toLowerCase();
  const warnings: string[] = [];

  if (/^h[1-6]$/.test(tagLower)) {
    return {
      type: 'heading',
      source_selector: selector,
      source_tag: tagLower,
      content,
      settings: buildHeadingSettings(tagLower, styles),
      warnings,
    };
  }

  if (tagLower === 'p') {
    return {
      type: 'text-editor',
      source_selector: selector,
      source_tag: tagLower,
      content,
      settings: buildTextSettings(styles),
      warnings,
    };
  }

  if (tagLower === 'button' || (tagLower === 'a' && hasButtonClass(selector))) {
    return {
      type: 'button',
      source_selector: selector,
      source_tag: tagLower,
      content,
      settings: buildButtonSettings(styles),
      warnings,
    };
  }

  if (tagLower === 'img' || tagLower === 'picture') {
    return {
      type: 'image',
      source_selector: selector,
      source_tag: tagLower,
      content: undefined,
      settings: { image_size: 'full' },
      warnings,
    };
  }

  if (tagLower === 'video' || tagLower === 'iframe') {
    return {
      type: 'video',
      source_selector: selector,
      source_tag: tagLower,
      settings: {},
      warnings,
    };
  }

  if (tagLower === 'form') {
    if (options.warnOnPro !== false) warnings.push('form widget requires Elementor Pro');
    return {
      type: 'form',
      source_selector: selector,
      source_tag: tagLower,
      settings: {},
      warnings,
    };
  }

  if (tagLower === 'svg' || selector.includes('icon')) {
    return {
      type: 'icon',
      source_selector: selector,
      source_tag: tagLower,
      settings: {},
      warnings,
    };
  }

  if (tagLower === 'hr') {
    return {
      type: 'divider',
      source_selector: selector,
      source_tag: tagLower,
      settings: {},
      warnings,
    };
  }

  return {
    type: 'html',
    source_selector: selector,
    source_tag: tagLower,
    content,
    settings: {},
    warnings: ['Unmapped element — using html fallback'],
  };
}

function hasButtonClass(selector: string): boolean {
  return /btn|button|cta|action/i.test(selector);
}

function buildHeadingSettings(tag: string, styles: Record<string, string>): Record<string, unknown> {
  const settings: Record<string, unknown> = { header_size: tag };
  if (styles['font-size']) settings.title_font_size = styles['font-size'];
  if (styles['font-weight']) settings.title_font_weight = styles['font-weight'];
  if (styles['color']) settings.title_color = styles['color'];
  if (styles['text-align']) settings.align = styles['text-align'];
  return settings;
}

function buildTextSettings(styles: Record<string, string>): Record<string, unknown> {
  const settings: Record<string, unknown> = {};
  if (styles['font-size']) settings.font_size = styles['font-size'];
  if (styles['color']) settings.text_color = styles['color'];
  if (styles['text-align']) settings.align = styles['text-align'];
  if (styles['line-height']) settings.line_height = styles['line-height'];
  return settings;
}

function buildButtonSettings(styles: Record<string, string>): Record<string, unknown> {
  const settings: Record<string, unknown> = {};
  if (styles['background-color']) settings.background_color = styles['background-color'];
  if (styles['color']) settings.button_text_color = styles['color'];
  if (styles['border-top-left-radius']) settings.border_radius = styles['border-top-left-radius'];
  if (styles['padding-top']) settings.button_padding = styles['padding-top'];
  return settings;
}

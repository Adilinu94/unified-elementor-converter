/**
 * Widget-Mapper — Phase 3 Sprint 3B + V2 Phase 5 (Pro-Widget mapping)
 * Maps DOM elements to V3 widget suggestions based on tag + classes + computed
 * styles. Each widget carries source-provenance for downstream editability.
 *
 * Merged from site-clone-to-v3/src/classifier/widget-mapper.ts (Phase 45).
 *
 * Mapping:
 *   h1-h6                       -> heading
 *   p                           -> text-editor
 *   a.btn / a.button / a[class] -> button
 *   img / picture               -> image
 *   video                       -> video
 *   form                        -> form (warn if Pro-only)
 *   svg / icon-*                -> icon
 *   hr                          -> divider
 *   unknown                     -> html (fallback)
 */
import type { V3Widget } from './types.js';

export interface WidgetMappingOptions {
  /** Warn (don't throw) when encountering a Pro-only widget. */
  warnOnPro?: boolean;
}

export interface WidgetMappingResult extends V3Widget {
  warnings: string[];
}

/**
 * Map a single DOM element to a V3 widget suggestion.
 */
export function mapElementToWidget(
  tag: string,
  selector: string,
  styles: Record<string, string>,
  content?: string,
  options: WidgetMappingOptions = {},
): WidgetMappingResult {
  const tagLower = tag.toLowerCase();
  const warnings: string[] = [];

  // 1. Headings
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

  // 2. Paragraphs
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

  // 3. Buttons (anchors with btn class, or <button>)
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

  // 4. Images
  if (tagLower === 'img' || tagLower === 'picture') {
    return {
      type: 'image',
      source_selector: selector,
      source_tag: tagLower,
      content,
      settings: buildImageSettings(styles),
      warnings,
    };
  }

  // 5. Video
  if (tagLower === 'video') {
    return {
      type: 'video',
      source_selector: selector,
      source_tag: tagLower,
      content,
      settings: buildVideoSettings(styles),
      warnings,
    };
  }

  // 6. Form (Pro-only in V3)
  if (tagLower === 'form') {
    if (options.warnOnPro !== false) {
      warnings.push('form widget requires Elementor Pro — will fallback to html');
    }
    return {
      type: 'form',
      source_selector: selector,
      source_tag: tagLower,
      content,
      settings: {},
      warnings,
    };
  }

  // 7. SVG / icon classes
  if (tagLower === 'svg' || /icon/.test(selector)) {
    return {
      type: 'icon',
      source_selector: selector,
      source_tag: tagLower,
      content,
      settings: buildIconSettings(styles),
      warnings,
    };
  }

  // 8. Horizontal rule
  if (tagLower === 'hr') {
    return {
      type: 'divider',
      source_selector: selector,
      source_tag: tagLower,
      content: undefined,
      settings: buildDividerSettings(styles),
      warnings,
    };
  }

  // 9. Fallback: html widget
  return {
    type: 'html',
    source_selector: selector,
    source_tag: tagLower,
    content,
    settings: {},
    warnings: [`No specific widget mapping for <${tagLower}> — using html fallback`],
  };
}

/**
 * Walk a list of (tag, selector, styles) tuples and return widget suggestions.
 * Preserves order of input.
 */
export function mapElementsToWidgets(
  elements: Array<{
    tag: string;
    selector: string;
    styles: Record<string, string>;
    content?: string;
  }>,
  options: WidgetMappingOptions = {},
): WidgetMappingResult[] {
  return elements.map((el) =>
    mapElementToWidget(el.tag, el.selector, el.styles, el.content, options),
  );
}

function hasButtonClass(selector: string): boolean {
  return /(^|[\s.#])(btn|button|cta)([-_\s.#:]|$)/i.test(selector);
}

function buildHeadingSettings(
  tag: string,
  styles: Record<string, string>,
): Record<string, unknown> {
  const settings: Record<string, unknown> = {
    title: '',
    header_size: tag.toLowerCase(),
  };
  if (styles['font-size']) {
    const px = parsePx(styles['font-size']);
    if (px !== null) {
      settings.typography_font_size = { size: px, unit: 'px' };
      settings.typography_typography = 'custom';
    }
  }
  if (styles['font-weight']) {
    settings.typography_font_weight = parseInt(styles['font-weight'], 10) || 400;
  }
  if (styles['color']) settings.title_color = styles['color'];
  if (styles['line-height']) settings.typography_line_height = { size: styles['line-height'], unit: 'px' };
  if (styles['text-align']) settings.align = styles['text-align'];
  return settings;
}

function buildTextSettings(styles: Record<string, string>): Record<string, unknown> {
  const settings: Record<string, unknown> = { editor: '' };
  if (styles['font-size']) {
    const px = parsePx(styles['font-size']);
    if (px !== null) {
      settings.typography_font_size = { size: px, unit: 'px' };
      settings.typography_typography = 'custom';
    }
  }
  if (styles['color']) settings.text_color = styles['color'];
  if (styles['line-height']) settings.typography_line_height = { size: styles['line-height'], unit: 'px' };
  return settings;
}

function buildButtonSettings(styles: Record<string, string>): Record<string, unknown> {
  const settings: Record<string, unknown> = {
    text: '',
    align: 'left',
  };
  if (styles['background-color'] && !isTransparent(styles['background-color'])) {
    settings.background_color = styles['background-color'];
  }
  if (styles['color']) settings.text_color = styles['color'];
  if (styles['border-top-left-radius']) {
    const r = parsePx(styles['border-top-left-radius']);
    if (r !== null) {
      settings.border_radius = {
        top: `${r}px`,
        right: `${r}px`,
        bottom: `${r}px`,
        left: `${r}px`,
      };
    }
  }
  if (styles['padding-top'] || styles['padding-left']) {
    const pt = parsePx(styles['padding-top']) ?? 12;
    const pl = parsePx(styles['padding-left']) ?? 24;
    settings.text_padding = {
      top: `${pt}px`,
      right: `${pl}px`,
      bottom: `${pt}px`,
      left: `${pl}px`,
      unit: 'px',
    };
  }
  return settings;
}

function buildImageSettings(styles: Record<string, string>): Record<string, unknown> {
  const settings: Record<string, unknown> = {};
  if (styles['width']) {
    const px = parsePx(styles['width']);
    if (px !== null) settings.width = { size: px, unit: 'px' };
  }
  if (styles['height']) {
    const px = parsePx(styles['height']);
    if (px !== null) settings.height = { size: px, unit: 'px' };
  }
  if (styles['object-fit']) settings.object_fit = styles['object-fit'];
  if (styles['border-radius']) {
    const px = parsePx(styles['border-radius']);
    if (px !== null) settings.image_border_radius = `${px}px`;
  }
  return settings;
}

function buildVideoSettings(styles: Record<string, string>): Record<string, unknown> {
  return {
    video_type: 'hosted',
    ...(styles['width'] ? { width: styles['width'] } : {}),
    ...(styles['aspect-ratio'] ? { aspect_ratio: styles['aspect-ratio'] } : {}),
  };
}

function buildIconSettings(styles: Record<string, string>): Record<string, unknown> {
  const settings: Record<string, unknown> = {};
  if (styles['color']) settings.primary_color = styles['color'];
  if (styles['width']) {
    const px = parsePx(styles['width']);
    if (px !== null) settings.size = { size: px, unit: 'px' };
  }
  return settings;
}

function buildDividerSettings(styles: Record<string, string>): Record<string, unknown> {
  const settings: Record<string, unknown> = {};
  if (styles['border-top-color']) settings.color = styles['border-top-color'];
  if (styles['border-top-width']) {
    const px = parsePx(styles['border-top-width']);
    if (px !== null) settings.weight = { size: px, unit: 'px' };
  }
  return settings;
}

function parsePx(value: string | undefined): number | null {
  if (!value) return null;
  const match = value.match(/^(-?\d+(?:\.\d+)?)px$/);
  return match ? parseFloat(match[1]) : null;
}

function isTransparent(value: string): boolean {
  return /rgba\([^)]+,\s*0\)|transparent/.test(value);
}

// ─────────────────────────────────────────────────────────────────────────────
// V2 Phase 5: Pro-Widget mapping (14 widgets)
// ─────────────────────────────────────────────────────────────────────────────

/** All Pro widget names recognised by Phase 5. */
export type ProWidgetType =
  | 'slider'
  | 'accordion'
  | 'tabs'
  | 'counter'
  | 'testimonial-carousel'
  | 'price-table'
  | 'animated-headline'
  | 'progress-bar'
  | 'forms'
  | 'posts'
  | 'share-buttons'
  | 'gallery'
  | 'image-box'
  | 'icon-box';

/** A V3 widget suggestion for a Pro-only widget. */
export interface ProWidgetSuggestion {
  type: ProWidgetType;
  source_selector: string;
  source_tag: string;
  content?: string;
  settings: Record<string, unknown>;
  requires_pro: true;
  detection: ProDetectionSource;
  fallback: 'text-editor' | 'html';
  warnings: string[];
}

export type ProDetectionSource =
  | 'pro-css-class'
  | 'data-attr'
  | 'structure'
  | 'data-settings'
  | 'testimonial-pattern'
  | 'price-pattern'
  | 'counter-pattern';

/** Inputs for detectProWidget. */
export interface ProWidgetInput {
  tag: string;
  selector: string;
  classes?: readonly string[];
  attributes?: Readonly<Record<string, string>>;
  childStructure?: ReadonlyArray<{ tag: string; selector: string }>;
  content?: string;
  styles?: Record<string, string>;
}

/** Detect if a DOM element is a Pro-only widget. Returns null if not. */
export function detectProWidget(input: ProWidgetInput): ProWidgetSuggestion | null {
  const { tag, selector, classes = [], attributes = {}, childStructure = [], content, styles = {} } = input;

  if (hasProClass(classes, ['elementor-widget-slider', 'swiper'])) {
    return buildSuggestion({ type: 'slider', selector, tag, content, detection: 'pro-css-class', settings: buildSliderSettings(attributes, childStructure) });
  }
  if (hasProClass(classes, ['elementor-widget-accordion']) || hasAttribute(attributes, 'data-accordion')) {
    return buildSuggestion({ type: 'accordion', selector, tag, content, detection: hasAttribute(attributes, 'data-accordion') ? 'data-attr' : 'pro-css-class', settings: buildAccordionSettings(attributes, childStructure) });
  }
  if (hasProClass(classes, ['elementor-widget-tabs']) || hasAttribute(attributes, 'data-tabs')) {
    return buildSuggestion({ type: 'tabs', selector, tag, content, detection: hasAttribute(attributes, 'data-tabs') ? 'data-attr' : 'pro-css-class', settings: buildTabsSettings(attributes, childStructure) });
  }
  if (hasProClass(classes, ['elementor-widget-counter']) || (tag === 'div' && hasClassPrefix(classes, 'counter-'))) {
    return buildSuggestion({ type: 'counter', selector, tag, content, detection: 'counter-pattern', settings: buildCounterSettings(content, attributes) });
  }
  if (hasProClass(classes, ['elementor-widget-testimonial', 'elementor-widget-testimonial-carousel']) || (hasProClass(classes, ['elementor-widget-testimonial']) && hasSwiperSlides(childStructure))) {
    return buildSuggestion({ type: 'testimonial-carousel', selector, tag, content, detection: 'testimonial-pattern', settings: buildTestimonialCarouselSettings(content, childStructure) });
  }
  if (hasProClass(classes, ['elementor-widget-price-table']) || isPriceTableStructure(childStructure)) {
    return buildSuggestion({ type: 'price-table', selector, tag, content, detection: hasProClass(classes, ['elementor-widget-price-table']) ? 'pro-css-class' : 'price-pattern', settings: buildPriceTableSettings(childStructure) });
  }
  if (hasProClass(classes, ['elementor-widget-animated-headline', 'elementor-headline'])) {
    return buildSuggestion({ type: 'animated-headline', selector, tag, content, detection: 'data-settings', settings: buildAnimatedHeadlineSettings(content, attributes, styles) });
  }
  if (hasProClass(classes, ['elementor-widget-progress-bar', 'elementor-progress-bar'])) {
    return buildSuggestion({ type: 'progress-bar', selector, tag, content, detection: 'pro-css-class', settings: buildProgressBarSettings(attributes) });
  }
  if ((tag === 'form' && hasClassPrefix(classes, 'elementor-form')) || hasClassPrefix(classes, 'e-form-')) {
    return buildSuggestion({ type: 'forms', selector, tag, content, detection: 'pro-css-class', settings: buildFormsSettings(attributes, childStructure) });
  }
  if (hasProClass(classes, ['elementor-widget-posts', 'elementor-widget-posts-grid']) || hasClassPrefix(classes, 'loop-grid-')) {
    return buildSuggestion({ type: 'posts', selector, tag, content, detection: 'pro-css-class', settings: buildPostsSettings(attributes) });
  }
  if (hasProClass(classes, ['elementor-widget-share-buttons'])) {
    return buildSuggestion({ type: 'share-buttons', selector, tag, content, detection: 'pro-css-class', settings: { share_buttons: parseShareNetworks(classes) } });
  }
  if (hasProClass(classes, ['elementor-widget-gallery', 'elementor-gallery'])) {
    return buildSuggestion({ type: 'gallery', selector, tag, content, detection: 'pro-css-class', settings: buildGallerySettings(childStructure) });
  }
  if (hasProClass(classes, ['elementor-widget-image-box'])) {
    return buildSuggestion({ type: 'image-box', selector, tag, content, detection: 'pro-css-class', settings: buildImageBoxSettings(content, attributes) });
  }
  if (hasProClass(classes, ['elementor-widget-icon-box'])) {
    return buildSuggestion({ type: 'icon-box', selector, tag, content, detection: 'pro-css-class', settings: buildIconBoxSettings(content, attributes) });
  }

  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Helper predicates + builders
// ─────────────────────────────────────────────────────────────────────────────

function hasProClass(classes: readonly string[], needles: readonly string[]): boolean {
  for (const c of classes) {
    if (!c) continue;
    for (const n of needles) {
      if (c === n || c.startsWith(`${n} `)) return true;
    }
  }
  return false;
}

function hasClassPrefix(classes: readonly string[], prefix: string): boolean {
  return classes.some((c) => c === prefix || c.startsWith(prefix) || c.startsWith(`${prefix}-`) || c.startsWith(`${prefix}_`));
}

function hasAttribute(attributes: Readonly<Record<string, string>>, name: string): boolean {
  return Object.prototype.hasOwnProperty.call(attributes, name);
}

function hasSwiperSlides(childStructure: ReadonlyArray<{ tag: string; selector: string }>): boolean {
  return childStructure.some((c) => /swiper-slide/i.test(c.selector) || /swiper-slide/i.test(c.tag));
}

function isPriceTableStructure(childStructure: ReadonlyArray<{ tag: string; selector: string }>): boolean {
  const tags = childStructure.map((c) => c.tag.toLowerCase());
  const headingPresent = tags.some((t) => /^h[1-6]$/.test(t));
  const buttonPresent = tags.some((t) => t === 'a' || t === 'button');
  const listPresent = tags.some((t) => t === 'ul' || t === 'ol');
  return headingPresent && buttonPresent && listPresent;
}

interface SuggestionInput {
  type: ProWidgetType;
  selector: string;
  tag: string;
  content?: string;
  detection: ProDetectionSource;
  settings: Record<string, unknown>;
}

function buildSuggestion(input: SuggestionInput): ProWidgetSuggestion {
  return {
    type: input.type,
    source_selector: input.selector,
    source_tag: input.tag.toLowerCase(),
    content: input.content,
    settings: input.settings,
    requires_pro: true,
    detection: input.detection,
    fallback: chooseFallback(input.type),
    warnings: [`Widget "${input.type}" requires Elementor Pro — fallback: ${chooseFallback(input.type)}`],
  };
}

function chooseFallback(type: ProWidgetType): 'text-editor' | 'html' {
  switch (type) {
    case 'forms':
    case 'gallery':
    case 'posts':
      return 'html';
    default:
      return 'text-editor';
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Per-widget settings builders
// ─────────────────────────────────────────────────────────────────────────────

function buildSliderSettings(attributes: Readonly<Record<string, string>>, childStructure: ReadonlyArray<{ tag: string; selector: string }>): Record<string, unknown> {
  const slideCount = childStructure.filter((c) => /swiper-slide/i.test(c.selector)).length;
  return {
    slides: childStructure.filter((c) => /swiper-slide/i.test(c.selector)).map((c) => ({ _ref: c.selector })),
    slides_count: slideCount,
    autoplay: hasAttribute(attributes, 'data-autoplay') ? attributes['data-autoplay'] : 'yes',
    arrows: hasAttribute(attributes, 'data-arrows') ? attributes['data-arrows'] : 'yes',
    pagination: hasAttribute(attributes, 'data-pagination') ? attributes['data-pagination'] : 'bullets',
  };
}

function buildAccordionSettings(attributes: Readonly<Record<string, string>>, childStructure: ReadonlyArray<{ tag: string; selector: string }>): Record<string, unknown> {
  return {
    tabs: childStructure.filter((c) => /^h[1-6]$/i.test(c.tag) || c.tag.toLowerCase() === 'details').map((c) => ({ tab_title: c.selector })),
    default_state: hasAttribute(attributes, 'data-default-state') ? attributes['data-default-state'] : 'expanded-first',
  };
}

function buildTabsSettings(attributes: Readonly<Record<string, string>>, childStructure: ReadonlyArray<{ tag: string; selector: string }>): Record<string, unknown> {
  return {
    tabs: childStructure.filter((c) => /tab-title|tab-content/i.test(c.selector)).map((c) => ({ tab_title: c.selector, tab_content: c.selector })),
    type: hasAttribute(attributes, 'data-tab-type') ? attributes['data-tab-type'] : 'horizontal',
  };
}

function buildCounterSettings(content: string | undefined, attributes: Readonly<Record<string, string>>): Record<string, unknown> {
  const numericPart = content?.match(/-?\d[\d.,]*/)?.[0] ?? '0';
  return {
    ending_number: parseFloat(numericPart.replace(',', '.')) || 0,
    prefix: content?.match(/^\D*/)?.[0] ?? '',
    suffix: content?.match(/\D*$/)?.[0] ?? '',
    duration: hasAttribute(attributes, 'data-duration') ? attributes['data-duration'] : '2000',
    title: '',
  };
}

function buildTestimonialCarouselSettings(content: string | undefined, childStructure: ReadonlyArray<{ tag: string; selector: string }>): Record<string, unknown> {
  return {
    slides: childStructure.filter((c) => /swiper-slide/i.test(c.selector)).map((c) => ({ content: c.selector, image: c.selector, name: '', title: '' })),
    slides_count: childStructure.filter((c) => /swiper-slide/i.test(c.selector)).length,
    body_text: content ?? '',
  };
}

function buildPriceTableSettings(childStructure: ReadonlyArray<{ tag: string; selector: string }>): Record<string, unknown> {
  const tags = childStructure.map((c) => c.tag.toLowerCase());
  return {
    heading: tags.some((t) => /^h[1-6]$/.test(t)),
    features_list: tags.some((t) => t === 'ul' || t === 'ol'),
    button: tags.some((t) => t === 'a' || t === 'button'),
    price: tags.some((t) => t === 'span' || t === 'div'),
  };
}

function buildAnimatedHeadlineSettings(content: string | undefined, attributes: Readonly<Record<string, string>>, styles: Record<string, string>): Record<string, unknown> {
  return {
    headline_text: content ?? '',
    animation_style: hasAttribute(attributes, 'data-animation') ? attributes['data-animation'] : 'highlight',
    before_text: '',
    highlighted_text: '',
    after_text: '',
    animation_duration: styles['animation-duration'] ?? '1200ms',
  };
}

function buildProgressBarSettings(attributes: Readonly<Record<string, string>>): Record<string, unknown> {
  return {
    title: '',
    percent: hasAttribute(attributes, 'data-percent') ? { size: parseFloat(attributes['data-percent']) || 0, unit: '%' } : { size: 50, unit: '%' },
    inner_text: hasAttribute(attributes, 'data-inner-text') ? attributes['data-inner-text'] : '',
    display_percentage: hasAttribute(attributes, 'data-show-percent') ? attributes['data-show-percent'] : 'show',
  };
}

function buildFormsSettings(attributes: Readonly<Record<string, string>>, childStructure: ReadonlyArray<{ tag: string; selector: string }>): Record<string, unknown> {
  return {
    form_name: hasAttribute(attributes, 'name') ? attributes['name'] : 'clone-form',
    form_fields: childStructure.filter((c) => /input|textarea|select/i.test(c.tag)).map((c) => ({ _type: c.tag.toLowerCase(), _ref: c.selector })),
    submit_text: 'Submit',
  };
}

function buildPostsSettings(attributes: Readonly<Record<string, string>>): Record<string, unknown> {
  return {
    posts_per_page: hasAttribute(attributes, 'data-posts-per-page') ? parseInt(attributes['data-posts-per-page'], 10) || 6 : 6,
    layout: hasAttribute(attributes, 'data-layout') ? attributes['data-layout'] : 'grid',
  };
}

function parseShareNetworks(classes: readonly string[]): string[] {
  const networks = new Set<string>();
  for (const c of classes) {
    const m = c.match(/^share-([a-z]+)/i);
    if (m) networks.add(m[1].toLowerCase());
  }
  return Array.from(networks);
}

function buildGallerySettings(childStructure: ReadonlyArray<{ tag: string; selector: string }>): Record<string, unknown> {
  return {
    gallery_items: childStructure.filter((c) => c.tag.toLowerCase() === 'img' || /gallery-item/i.test(c.selector)).map((c) => ({ _ref: c.selector })),
    gallery_layout: 'grid',
  };
}

function buildImageBoxSettings(content: string | undefined, attributes: Readonly<Record<string, string>>): Record<string, unknown> {
  return {
    title_text: content ?? '',
    description_text: hasAttribute(attributes, 'data-description') ? attributes['data-description'] : '',
    image: hasAttribute(attributes, 'data-image') ? { url: attributes['data-image'] } : { url: '' },
  };
}

function buildIconBoxSettings(content: string | undefined, attributes: Readonly<Record<string, string>>): Record<string, unknown> {
  return {
    title_text: content ?? '',
    description_text: hasAttribute(attributes, 'data-description') ? attributes['data-description'] : '',
    icon: hasAttribute(attributes, 'data-icon') ? attributes['data-icon'] : '',
  };
}

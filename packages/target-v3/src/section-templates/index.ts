/**
 * Section Template Library — V3 (Phase 69).
 *
 * Pre-tested section templates for common page patterns.
 * Each template: v3-tree + css + config (parametrizable).
 * STRIKT V3 — no V4 types.
 *
 * @module target-v3/section-templates
 */

import type { V3Element } from '../types.js';

// ============================================================================
// Types
// ============================================================================

export interface SectionTemplate {
  id: string;
  name: string;
  category: string;
  description: string;
  /** Parametrizable V3 tree generator. */
  generate: (params: TemplateParams) => V3Element[];
  /** Companion CSS (page-scoped). */
  css: string;
  /** Default parameters. */
  defaults: TemplateParams;
}

export interface TemplateParams {
  sectionId?: string;
  heading?: string;
  subheading?: string;
  items?: TemplateItem[];
  backgroundColor?: string;
  padding?: { top: number; bottom: number };
  [key: string]: unknown;
}

export interface TemplateItem {
  title: string;
  description?: string;
  imageUrl?: string;
  icon?: string;
  link?: string;
}

// ============================================================================
// Section Classifier
// ============================================================================

export type SectionType =
  | 'hero' | 'stats' | 'services' | 'process'
  | 'team' | 'contact' | 'floating-header' | 'generic';

/**
 * Classify a Framer section XML/node into a section type.
 */
export function classifyTemplateSection(name: string, childCount: number, _props: Record<string, unknown>): SectionType {
  const lower = name.toLowerCase();
  if (lower.includes('hero') || lower.includes('banner')) return 'hero';
  if (lower.includes('stat') || lower.includes('metric') || lower.includes('counter')) return 'stats';
  if (lower.includes('service') || lower.includes('feature')) return 'services';
  if (lower.includes('process') || lower.includes('step') || lower.includes('how')) return 'process';
  if (lower.includes('team') || lower.includes('member')) return 'team';
  if (lower.includes('contact') || lower.includes('cta') || lower.includes('form')) return 'contact';
  if (lower.includes('header') || lower.includes('nav')) return 'floating-header';
  if (childCount > 3) return 'services'; // heuristic: many children = grid
  return 'generic';
}

/**
 * Select the best template for a classified section type.
 */
export function selectTemplate(type: SectionType): SectionTemplate {
  return TEMPLATE_REGISTRY.get(type) ?? TEMPLATE_REGISTRY.get('generic')!;
}

// ============================================================================
// Template generators
// ============================================================================

function heroTemplate(params: TemplateParams): V3Element[] {
  const id = params.sectionId ?? 'hero';
  return [{
    id,
    elType: 'section',
    settings: {
      content_width: 'boxed',
      background_color: params.backgroundColor ?? '#0a0a0a',
      padding: { top: params.padding?.top ?? 120, bottom: params.padding?.bottom ?? 120, unit: 'px', isLinked: false },
      _element_id: id,
    },
    elements: [{
      id: `${id}_col`,
      elType: 'column',
      settings: { _column_size: 100 },
      elements: [
        {
          id: `${id}_heading`,
          elType: 'widget',
          widgetType: 'heading',
          settings: {
            title: params.heading ?? 'Hero Title',
            typography_typography: 'custom',
            typography_font_size: { size: 56, unit: 'px' },
            typography_font_weight: '700',
            title_color: '#ffffff',
            align: 'center',
          },
        },
        {
          id: `${id}_sub`,
          elType: 'widget',
          widgetType: 'text-editor',
          settings: {
            editor: params.subheading ?? 'Subtitle text',
            typography_typography: 'custom',
            typography_font_size: { size: 20, unit: 'px' },
            text_color: '#cccccc',
            align: 'center',
          },
        },
      ],
    }],
  }];
}

function statsTemplate(params: TemplateParams): V3Element[] {
  const id = params.sectionId ?? 'stats';
  const items = params.items ?? [
    { title: '100+', description: 'Projects' },
    { title: '50+', description: 'Clients' },
    { title: '10+', description: 'Years' },
  ];

  const statWidgets: V3Element[] = items.map((item, i) => ({
    id: `${id}_stat_${i}`,
    elType: 'widget',
    widgetType: 'heading',
    settings: {
      title: item.title,
      typography_typography: 'custom',
      typography_font_size: { size: 48, unit: 'px' },
      typography_font_weight: '700',
      title_color: params.backgroundColor === '#ffffff' ? '#1a1a1a' : '#ffffff',
      align: 'center',
    },
  }));

  return [{
    id,
    elType: 'section',
    settings: {
      content_width: 'boxed',
      background_color: params.backgroundColor ?? '#1a1a2e',
      padding: { top: params.padding?.top ?? 80, bottom: params.padding?.bottom ?? 80, unit: 'px', isLinked: false },
      _element_id: id,
    },
    elements: [{
      id: `${id}_col`,
      elType: 'column',
      settings: { _column_size: 100 },
      elements: statWidgets,
    }],
  }];
}

function servicesTemplate(params: TemplateParams): V3Element[] {
  const id = params.sectionId ?? 'services';
  const items = params.items ?? [
    { title: 'Service 1', description: 'Description 1' },
    { title: 'Service 2', description: 'Description 2' },
    { title: 'Service 3', description: 'Description 3' },
  ];

  const cards: V3Element[] = items.map((item, i) => ({
    id: `${id}_card_${i}`,
    elType: 'container',
    settings: {
      flex_direction: 'column',
      flex_gap: { column: '16', row: '16', isLinked: true },
      padding: { top: 32, right: 24, bottom: 32, left: 24, unit: 'px', isLinked: false },
      border_radius: { top: '12', right: '12', bottom: '12', left: '12', unit: 'px', isLinked: true },
      background_color: '#f8f9fa',
    },
    elements: [
      {
        id: `${id}_card_${i}_title`,
        elType: 'widget',
        widgetType: 'heading',
        settings: { title: item.title, typography_typography: 'custom', typography_font_size: { size: 22, unit: 'px' } },
      },
      {
        id: `${id}_card_${i}_desc`,
        elType: 'widget',
        widgetType: 'text-editor',
        settings: { editor: item.description ?? '' },
      },
    ],
  }));

  return [{
    id,
    elType: 'section',
    settings: {
      content_width: 'boxed',
      padding: { top: params.padding?.top ?? 100, bottom: params.padding?.bottom ?? 100, unit: 'px', isLinked: false },
      _element_id: id,
    },
    elements: [{
      id: `${id}_col`,
      elType: 'column',
      settings: { _column_size: 100 },
      elements: [
        {
          id: `${id}_heading`,
          elType: 'widget',
          widgetType: 'heading',
          settings: { title: params.heading ?? 'Our Services', align: 'center', typography_typography: 'custom', typography_font_size: { size: 40, unit: 'px' } },
        },
        {
          id: `${id}_grid`,
          elType: 'container',
          settings: { flex_direction: 'row', flex_gap: { column: '24', row: '24', isLinked: true } },
          elements: cards,
        },
      ],
    }],
  }];
}

function genericTemplate(params: TemplateParams): V3Element[] {
  const id = params.sectionId ?? 'section';
  return [{
    id,
    elType: 'section',
    settings: {
      content_width: 'boxed',
      padding: { top: params.padding?.top ?? 80, bottom: params.padding?.bottom ?? 80, unit: 'px', isLinked: false },
      _element_id: id,
    },
    elements: [{
      id: `${id}_col`,
      elType: 'column',
      settings: { _column_size: 100 },
      elements: [{
        id: `${id}_heading`,
        elType: 'widget',
        widgetType: 'heading',
        settings: { title: params.heading ?? 'Section', align: 'center' },
      }],
    }],
  }];
}

// ============================================================================
// Registry
// ============================================================================

const TEMPLATE_REGISTRY = new Map<SectionType, SectionTemplate>([
  ['hero', { id: 'tpl-hero', name: 'Hero BG Image', category: 'hero', description: 'Full-width hero with heading + subtitle', generate: heroTemplate, css: '', defaults: {} }],
  ['stats', { id: 'tpl-stats', name: 'Stats Row', category: 'stats', description: 'Centered statistics counters', generate: statsTemplate, css: '', defaults: {} }],
  ['services', { id: 'tpl-services', name: 'Service Cards Grid', category: 'services', description: 'Grid of service/feature cards', generate: servicesTemplate, css: '', defaults: {} }],
  ['process', { id: 'tpl-process', name: 'Process Steps', category: 'process', description: 'Numbered process steps', generate: servicesTemplate, css: '', defaults: {} }],
  ['team', { id: 'tpl-team', name: 'Team Grid', category: 'team', description: 'Team member cards', generate: servicesTemplate, css: '', defaults: {} }],
  ['contact', { id: 'tpl-contact', name: 'Contact CTA', category: 'contact', description: 'Contact/CTA section', generate: heroTemplate, css: '', defaults: {} }],
  ['floating-header', { id: 'tpl-header', name: 'Floating Header', category: 'header', description: 'Fixed transparent header', generate: genericTemplate, css: 'header{position:fixed;top:0;width:100%;z-index:999}', defaults: {} }],
  ['generic', { id: 'tpl-generic', name: 'Generic Section', category: 'generic', description: 'Basic section with heading', generate: genericTemplate, css: '', defaults: {} }],
]);

/** Get all available templates. */
export function getAllTemplates(): SectionTemplate[] {
  return [...TEMPLATE_REGISTRY.values()];
}

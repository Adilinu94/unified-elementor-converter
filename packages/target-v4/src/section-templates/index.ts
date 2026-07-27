/**
 * Section Template Library — V4 Atomic (Phase 69, completes target-v3/section-templates
 * counterpart). EIGENE Implementierung — nicht von V3 kopiert, e-flexbox + $$type styles.
 * STRIKT V4 — no V3 types.
 *
 * @module target-v4/section-templates
 */

import type { V4TreeNode, V4StyleClass } from '../types.js';
import { wrapSize, wrapColor, wrapDimensions } from '../framer-utils.js';
import { generateStyleId } from '../style-id.js';

// ============================================================================
// Types
// ============================================================================

export interface SectionTemplate {
  id: string;
  name: string;
  category: string;
  description: string;
  /** Parametrizable V4 tree generator. */
  generate: (params: TemplateParams) => V4TreeNode[];
  defaults: TemplateParams;
}

export interface TemplateParams {
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
// Section Classifier — same categories as target-v3, own V4 output
// ============================================================================

export type SectionType =
  | 'hero' | 'stats' | 'services' | 'process'
  | 'team' | 'contact' | 'floating-header' | 'generic';

/**
 * Classify a Framer section XML/node into a section type.
 */
export function classifySection(name: string, childCount: number, _props: Record<string, unknown>): SectionType {
  const lower = name.toLowerCase();
  if (lower.includes('hero') || lower.includes('banner')) return 'hero';
  if (lower.includes('stat') || lower.includes('metric') || lower.includes('counter')) return 'stats';
  if (lower.includes('service') || lower.includes('feature')) return 'services';
  if (lower.includes('process') || lower.includes('step') || lower.includes('how')) return 'process';
  if (lower.includes('team') || lower.includes('member')) return 'team';
  if (lower.includes('contact') || lower.includes('cta') || lower.includes('form')) return 'contact';
  if (lower.includes('header') || lower.includes('nav')) return 'floating-header';
  if (childCount > 3) return 'services';
  return 'generic';
}

/**
 * Select the best template for a classified section type.
 */
export function selectTemplate(type: SectionType): SectionTemplate {
  return TEMPLATE_REGISTRY.get(type) ?? TEMPLATE_REGISTRY.get('generic')!;
}

// ============================================================================
// Style helper
// ============================================================================

function styleClass(label: string, props: Record<string, unknown>): V4StyleClass {
  return {
    id: generateStyleId(label),
    label,
    type: 'class',
    variants: [{ meta: { breakpoint: null, state: null }, props, custom_css: null }],
  };
}

let idCounter = 0;
function nextId(): string {
  return `v4t_${(++idCounter).toString(36)}`;
}

/** Reset counters for deterministic tests. */
export function resetV4SectionTemplateIds(): void {
  idCounter = 0;
}

// ============================================================================
// Template generators
// ============================================================================

function heroTemplate(params: TemplateParams): V4TreeNode[] {
  const containerStyle = styleClass('HeroContainer', {
    display: 'flex',
    flex_direction: 'column',
    align_items: 'center',
    background_color: wrapColor(params.backgroundColor ?? '#0a0a0a'),
    padding: wrapDimensions(params.padding?.top ?? 120, 40, params.padding?.bottom ?? 120, 40),
  });
  const headingStyle = styleClass('HeroHeading', {
    font_size: wrapSize(56),
    font_weight: '700',
    color: wrapColor('#ffffff'),
    text_align: 'center',
  });
  const subStyle = styleClass('HeroSubheading', {
    font_size: wrapSize(20),
    color: wrapColor('#cccccc'),
    text_align: 'center',
  });

  return [{
    type: 'e-flexbox',
    elType: 'e-flexbox',
    widgetType: 'e-flexbox',
    id: nextId(),
    settings: {},
    styles: { [containerStyle.id]: containerStyle },
    elements: [
      {
        type: 'e-heading', elType: 'widget', widgetType: 'e-heading', id: nextId(),
        settings: { title: params.heading ?? 'Hero Title', tag: 'h1' },
        styles: { [headingStyle.id]: headingStyle },
      },
      {
        type: 'e-paragraph', elType: 'widget', widgetType: 'e-paragraph', id: nextId(),
        settings: { content: params.subheading ?? 'Subtitle text' },
        styles: { [subStyle.id]: subStyle },
      },
    ],
  }];
}

function statsTemplate(params: TemplateParams): V4TreeNode[] {
  const items = params.items ?? [
    { title: '100+', description: 'Projects' },
    { title: '50+', description: 'Clients' },
    { title: '10+', description: 'Years' },
  ];
  const isLight = params.backgroundColor === '#ffffff';

  const containerStyle = styleClass('StatsContainer', {
    display: 'flex',
    flex_direction: 'row',
    flex_wrap: 'wrap',
    justify_content: 'center',
    gap: wrapSize(32),
    background_color: wrapColor(params.backgroundColor ?? '#1a1a2e'),
    padding: wrapDimensions(params.padding?.top ?? 80, 40, params.padding?.bottom ?? 80, 40),
  });

  const statNodes: V4TreeNode[] = items.map((item, i) => {
    const style = styleClass(`StatValue${i}`, {
      font_size: wrapSize(48),
      font_weight: '700',
      color: wrapColor(isLight ? '#1a1a1a' : '#ffffff'),
      text_align: 'center',
    });
    return {
      type: 'e-heading', elType: 'widget', widgetType: 'e-heading', id: nextId(),
      settings: { title: item.title, tag: 'h2' },
      styles: { [style.id]: style },
    };
  });

  return [{
    type: 'e-flexbox',
    elType: 'e-flexbox',
    widgetType: 'e-flexbox',
    id: nextId(),
    settings: {},
    styles: { [containerStyle.id]: containerStyle },
    elements: statNodes,
  }];
}

function servicesTemplate(params: TemplateParams): V4TreeNode[] {
  const items = params.items ?? [
    { title: 'Service 1', description: 'Description 1' },
    { title: 'Service 2', description: 'Description 2' },
    { title: 'Service 3', description: 'Description 3' },
  ];

  const outerStyle = styleClass('ServicesOuter', {
    display: 'flex',
    flex_direction: 'column',
    gap: wrapSize(40),
    padding: wrapDimensions(params.padding?.top ?? 100, 40, params.padding?.bottom ?? 100, 40),
  });
  const headingStyle = styleClass('ServicesHeading', {
    font_size: wrapSize(40),
    text_align: 'center',
  });
  const gridStyle = styleClass('ServicesGrid', {
    display: 'flex',
    flex_direction: 'row',
    flex_wrap: 'wrap',
    gap: wrapSize(24),
    justify_content: 'center',
  });

  const cards: V4TreeNode[] = items.map((item, i) => {
    const cardStyle = styleClass(`ServiceCard${i}`, {
      display: 'flex',
      flex_direction: 'column',
      gap: wrapSize(16),
      padding: wrapDimensions(32, 24, 32, 24),
      border_radius: wrapSize(12),
      background_color: wrapColor('#f8f9fa'),
    });
    const titleStyle = styleClass(`ServiceCardTitle${i}`, { font_size: wrapSize(22) });

    return {
      type: 'e-flexbox', elType: 'e-flexbox', widgetType: 'e-flexbox', id: nextId(),
      settings: {},
      styles: { [cardStyle.id]: cardStyle },
      elements: [
        {
          type: 'e-heading', elType: 'widget', widgetType: 'e-heading', id: nextId(),
          settings: { title: item.title, tag: 'h3' },
          styles: { [titleStyle.id]: titleStyle },
        },
        {
          type: 'e-paragraph', elType: 'widget', widgetType: 'e-paragraph', id: nextId(),
          settings: { content: item.description ?? '' },
          styles: {},
        },
      ],
    };
  });

  return [{
    type: 'e-flexbox',
    elType: 'e-flexbox',
    widgetType: 'e-flexbox',
    id: nextId(),
    settings: {},
    styles: { [outerStyle.id]: outerStyle },
    elements: [
      {
        type: 'e-heading', elType: 'widget', widgetType: 'e-heading', id: nextId(),
        settings: { title: params.heading ?? 'Our Services', tag: 'h2' },
        styles: { [headingStyle.id]: headingStyle },
      },
      {
        type: 'e-flexbox', elType: 'e-flexbox', widgetType: 'e-flexbox', id: nextId(),
        settings: {},
        styles: { [gridStyle.id]: gridStyle },
        elements: cards,
      },
    ],
  }];
}

function genericTemplate(params: TemplateParams): V4TreeNode[] {
  const outerStyle = styleClass('GenericOuter', {
    display: 'flex',
    flex_direction: 'column',
    padding: wrapDimensions(params.padding?.top ?? 80, 40, params.padding?.bottom ?? 80, 40),
  });
  const headingStyle = styleClass('GenericHeading', { text_align: 'center' });

  return [{
    type: 'e-flexbox',
    elType: 'e-flexbox',
    widgetType: 'e-flexbox',
    id: nextId(),
    settings: {},
    styles: { [outerStyle.id]: outerStyle },
    elements: [{
      type: 'e-heading', elType: 'widget', widgetType: 'e-heading', id: nextId(),
      settings: { title: params.heading ?? 'Section', tag: 'h2' },
      styles: { [headingStyle.id]: headingStyle },
    }],
  }];
}

function floatingHeaderTemplate(params: TemplateParams): V4TreeNode[] {
  const style = styleClass('FloatingHeader', {
    display: 'flex',
    position: 'fixed',
    background_color: wrapColor('transparent'),
  });
  return [{
    type: 'e-flexbox', elType: 'e-flexbox', widgetType: 'e-flexbox', id: nextId(),
    settings: {},
    styles: { [style.id]: style },
    elements: [{
      type: 'e-heading', elType: 'widget', widgetType: 'e-heading', id: nextId(),
      settings: { title: params.heading ?? 'Header', tag: 'div' },
      styles: {},
    }],
  }];
}

// ============================================================================
// Registry
// ============================================================================

const TEMPLATE_REGISTRY = new Map<SectionType, SectionTemplate>([
  ['hero', { id: 'tpl-v4-hero', name: 'Hero BG Image', category: 'hero', description: 'Full-width hero with heading + subtitle', generate: heroTemplate, defaults: {} }],
  ['stats', { id: 'tpl-v4-stats', name: 'Stats Row', category: 'stats', description: 'Centered statistics counters', generate: statsTemplate, defaults: {} }],
  ['services', { id: 'tpl-v4-services', name: 'Service Cards Grid', category: 'services', description: 'Grid of service/feature cards', generate: servicesTemplate, defaults: {} }],
  ['process', { id: 'tpl-v4-process', name: 'Process Steps', category: 'process', description: 'Numbered process steps', generate: servicesTemplate, defaults: {} }],
  ['team', { id: 'tpl-v4-team', name: 'Team Grid', category: 'team', description: 'Team member cards', generate: servicesTemplate, defaults: {} }],
  ['contact', { id: 'tpl-v4-contact', name: 'Contact CTA', category: 'contact', description: 'Contact/CTA section', generate: heroTemplate, defaults: {} }],
  ['floating-header', { id: 'tpl-v4-header', name: 'Floating Header', category: 'header', description: 'Fixed transparent header', generate: floatingHeaderTemplate, defaults: {} }],
  ['generic', { id: 'tpl-v4-generic', name: 'Generic Section', category: 'generic', description: 'Basic section with heading', generate: genericTemplate, defaults: {} }],
]);

/** Get all available templates. */
export function getAllTemplates(): SectionTemplate[] {
  return [...TEMPLATE_REGISTRY.values()];
}

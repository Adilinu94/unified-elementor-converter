/**
 * V3 Pattern: Service Cards
 * Grid of service/feature cards with icons, titles, and descriptions.
 * Uses native widgets (icon-box, heading, text-editor, button).
 */

import type { V3Element } from '../types.js';

let idCounter = 0;
function nextId(): string {
  return `v3p_sc_${(++idCounter).toString(36)}`;
}

export function resetServiceCardsIds(): void {
  idCounter = 0;
}

export interface ServiceCard {
  icon?: string;
  title: string;
  description: string;
  linkText?: string;
  linkHref?: string;
}

export interface ServiceCardsOptions {
  cards: ServiceCard[];
  columns?: number;
  accentColor?: string;
  bgColor?: string;
  sectionTitle?: string;
}

/**
 * Build a service cards grid section.
 * Structure: container > [card, card, ...]
 */
export function buildServiceCards(options: ServiceCardsOptions): V3Element {
  const {
    cards,
    columns = 3,
    accentColor = '#2563EB',
    bgColor = '#FFFFFF',
    sectionTitle,
  } = options;

  const elements: V3Element[] = [];

  // Optional section title
  if (sectionTitle) {
    elements.push({
      id: nextId(),
      elType: 'widget',
      widgetType: 'heading',
      settings: {
        title: sectionTitle,
        header_size: 'h2',
        align: 'center',
        title_color: '#1E293B',
        typography_typography: 'custom',
        typography_font_size: { unit: 'px', size: 36 },
        typography_font_weight: '700',
      },
    });
  }

  // Cards grid container
  const cardElements = cards.map((card) => buildCard(card, accentColor));

  elements.push({
    id: nextId(),
    elType: 'container',
    settings: {
      flex_direction: 'row',
      flex_wrap: 'wrap',
      gap: { unit: 'px', size: 24 },
      justify_content: 'center',
    },
    elements: cardElements,
  });

  return {
    id: nextId(),
    elType: 'container',
    settings: {
      content_width: 'boxed',
      flex_direction: 'column',
      gap: { unit: 'px', size: 40 },
      padding: { unit: 'px', top: 80, right: 40, bottom: 80, left: 40 },
      background_background: 'classic',
      background_color: bgColor,
    },
    elements,
  };
}

function buildCard(card: ServiceCard, accentColor: string): V3Element {
  const widgets: V3Element[] = [];

  // Icon (if provided)
  if (card.icon) {
    widgets.push({
      id: nextId(),
      elType: 'widget',
      widgetType: 'icon',
      settings: {
        selected_icon: { value: card.icon, library: 'fa-solid' },
        primary_color: accentColor,
        size: { unit: 'px', size: 40 },
      },
    });
  }

  // Title
  widgets.push({
    id: nextId(),
    elType: 'widget',
    widgetType: 'heading',
    settings: {
      title: card.title,
      header_size: 'h3',
      title_color: '#1E293B',
      typography_typography: 'custom',
      typography_font_size: { unit: 'px', size: 22 },
      typography_font_weight: '600',
    },
  });

  // Description
  widgets.push({
    id: nextId(),
    elType: 'widget',
    widgetType: 'text-editor',
    settings: {
      editor: `<p>${card.description}</p>`,
      text_color: '#64748B',
      typography_typography: 'custom',
      typography_font_size: { unit: 'px', size: 15 },
    },
  });

  // Link (optional)
  if (card.linkText && card.linkHref) {
    widgets.push({
      id: nextId(),
      elType: 'widget',
      widgetType: 'button',
      settings: {
        text: card.linkText,
        link: { url: card.linkHref },
        background_color: 'transparent',
        button_text_color: accentColor,
        border_border: 'solid',
        border_width: { unit: 'px', top: 1, right: 1, bottom: 1, left: 1 },
        border_color: accentColor,
        border_radius: { unit: 'px', top: 6, right: 6, bottom: 6, left: 6 },
      },
    });
  }

  return {
    id: nextId(),
    elType: 'container',
    settings: {
      flex_direction: 'column',
      gap: { unit: 'px', size: 16 },
      padding: { unit: 'px', top: 32, right: 28, bottom: 32, left: 28 },
      background_background: 'classic',
      background_color: '#F8FAFC',
      border_radius: { unit: 'px', top: 12, right: 12, bottom: 12, left: 12 },
      flex_basis: { unit: '%', size: 30 },
    },
    elements: widgets,
  };
}

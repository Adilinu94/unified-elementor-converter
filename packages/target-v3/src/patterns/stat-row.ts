/**
 * V3 Pattern: Stat Row
 * Horizontal row of statistics with numbers and labels.
 * Uses native widgets (heading, text-editor).
 */

import type { V3Element } from '../types.js';

let idCounter = 0;
function nextId(): string {
  return `v3p_sr_${(++idCounter).toString(36)}`;
}

export function resetStatRowIds(): void {
  idCounter = 0;
}

export interface StatItem {
  value: string;
  label: string;
  prefix?: string;
  suffix?: string;
}

export interface StatRowOptions {
  stats: StatItem[];
  columns?: number;
  accentColor?: string;
  bgColor?: string;
}

/**
 * Build a statistics row section.
 * Structure: container > [stat-card, stat-card, ...]
 */
export function buildStatRow(options: StatRowOptions): V3Element {
  const {
    stats,
    columns = stats.length,
    accentColor = '#2563EB',
    bgColor = '#F8FAFC',
  } = options;

  const statCards = stats.map((stat) => buildStatCard(stat, accentColor));

  return {
    id: nextId(),
    elType: 'container',
    settings: {
      content_width: 'boxed',
      flex_direction: 'row',
      flex_wrap: 'wrap',
      justify_content: 'center',
      gap: { unit: 'px', size: 32 },
      padding: { unit: 'px', top: 60, right: 40, bottom: 60, left: 40 },
      background_background: 'classic',
      background_color: bgColor,
    },
    elements: statCards,
  };
}

function buildStatCard(stat: StatItem, accentColor: string): V3Element {
  const displayValue = `${stat.prefix ?? ''}${stat.value}${stat.suffix ?? ''}`;

  return {
    id: nextId(),
    elType: 'container',
    settings: {
      flex_direction: 'column',
      align_items: 'center',
      padding: { unit: 'px', top: 24, right: 32, bottom: 24, left: 32 },
      background_background: 'classic',
      background_color: '#FFFFFF',
      border_radius: { unit: 'px', top: 12, right: 12, bottom: 12, left: 12 },
      box_shadow_box_shadow_type: 'yes',
      box_shadow_box_shadow: { horizontal: 0, vertical: 4, blur: 12, spread: 0, color: 'rgba(0,0,0,0.08)' },
    },
    elements: [
      {
        id: nextId(),
        elType: 'widget',
        widgetType: 'heading',
        settings: {
          title: displayValue,
          header_size: 'h2',
          title_color: accentColor,
          typography_typography: 'custom',
          typography_font_size: { unit: 'px', size: 42 },
          typography_font_weight: '800',
        },
      },
      {
        id: nextId(),
        elType: 'widget',
        widgetType: 'text-editor',
        settings: {
          editor: `<p>${stat.label}</p>`,
          text_color: '#64748B',
          typography_typography: 'custom',
          typography_font_size: { unit: 'px', size: 16 },
          typography_font_weight: '500',
        },
      },
    ],
  };
}

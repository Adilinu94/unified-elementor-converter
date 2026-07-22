/**
 * V4 Pattern: Stat Row (Atomic)
 * EIGENE Implementierung — NICHT von V3 kopieren!
 * Uses e-flexbox + $$type styles.
 */

import type { V4TreeNode, V4StyleClass } from '../types.ts';
import { wrapSize, wrapColor, wrapDimensions, wrapBorderRadius } from '../framer-utils.ts';

let idCounter = 0;
function nextId(): string {
  return `v4p_sr_${(++idCounter).toString(36)}`;
}

export function resetV4StatRowIds(): void {
  idCounter = 0;
}

export interface V4StatItem {
  value: string;
  label: string;
  prefix?: string;
  suffix?: string;
}

export interface V4StatRowOptions {
  stats: V4StatItem[];
  accentColor?: string;
  bgColor?: string;
}

/**
 * Build a V4 Atomic statistics row.
 * Structure: e-flexbox > [stat-card, stat-card, ...]
 */
export function buildV4StatRow(options: V4StatRowOptions): V4TreeNode {
  const {
    stats,
    accentColor = '#2563eb',
    bgColor = '#f8fafc',
  } = options;

  const styles: Record<string, V4StyleClass> = {};
  const statCards = stats.map((stat) => buildV4StatCard(stat, accentColor, styles));

  // Container style
  const containerStyleId = nextId();
  styles[containerStyleId] = createStyleClass(containerStyleId, 'StatRowContainer', {
    display: 'flex',
    flex_direction: 'row',
    flex_wrap: 'wrap',
    justify_content: 'center',
    gap: wrapSize(32),
    padding: wrapDimensions(60, 40, 60, 40),
    background_color: wrapColor(bgColor),
  });

  return {
    type: 'e-flexbox',
    elType: 'e-flexbox',
    widgetType: 'e-flexbox',
    id: nextId(),
    settings: {},
    styles: { [containerStyleId]: styles[containerStyleId] },
    elements: statCards,
  };
}

function buildV4StatCard(
  stat: V4StatItem,
  accentColor: string,
  styles: Record<string, V4StyleClass>,
): V4TreeNode {
  const displayValue = `${stat.prefix ?? ''}${stat.value}${stat.suffix ?? ''}`;

  // Card container style
  const cardStyleId = nextId();
  styles[cardStyleId] = createStyleClass(cardStyleId, 'StatCard', {
    display: 'flex',
    flex_direction: 'column',
    align_items: 'center',
    padding: wrapDimensions(24, 32, 24, 32),
    background_color: wrapColor('#ffffff'),
    border_radius: wrapBorderRadius(12, 12, 12, 12),
    box_shadow: '0 4px 12px rgba(0,0,0,0.08)',
  });

  // Value style
  const valueStyleId = nextId();
  styles[valueStyleId] = createStyleClass(valueStyleId, 'StatValue', {
    font_size: wrapSize(42),
    font_weight: '800',
    color: wrapColor(accentColor),
  });

  // Label style
  const labelStyleId = nextId();
  styles[labelStyleId] = createStyleClass(labelStyleId, 'StatLabel', {
    font_size: wrapSize(16),
    font_weight: '500',
    color: wrapColor('#64748b'),
  });

  return {
    type: 'e-flexbox',
    elType: 'e-flexbox',
    widgetType: 'e-flexbox',
    id: nextId(),
    settings: {},
    styles: { [cardStyleId]: styles[cardStyleId] },
    elements: [
      {
        type: 'e-heading',
        elType: 'widget',
        widgetType: 'e-heading',
        id: nextId(),
        settings: { title: displayValue, tag: 'h2' },
        styles: { [valueStyleId]: styles[valueStyleId] },
      },
      {
        type: 'e-paragraph',
        elType: 'widget',
        widgetType: 'e-paragraph',
        id: nextId(),
        settings: { content: stat.label },
        styles: { [labelStyleId]: styles[labelStyleId] },
      },
    ],
  };
}

function createStyleClass(id: string, label: string, props: Record<string, unknown>): V4StyleClass {
  return {
    id,
    label,
    type: 'class',
    variants: [{
      meta: { breakpoint: null, state: null },
      props,
      custom_css: null,
    }],
  };
}

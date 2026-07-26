/**
 * Setting-First Policy (Phase 62).
 *
 * Enforces that every visual attribute is expressed FIRST as an Elementor
 * widget setting. CSS is only used as a proven fallback when a setting
 * demonstrably does not render.
 *
 * Produces a css-budget that justifies every CSS rule.
 *
 * @module target-v3/setting-first-policy
 */

import type { V3Element } from './types.js';

// ============================================================================
// Types
// ============================================================================

export interface SettingFirstDecision {
  attribute: string;
  elementId: string;
  method: 'setting' | 'css-fallback';
  settingKey?: string;
  settingValue?: unknown;
  cssRule?: string;
  justification: string;
}

export interface CssBudgetEntry {
  selector: string;
  property: string;
  value: string;
  reason: string;
  settingAttempted: boolean;
  settingFailedBecause: string | null;
}

export interface CssBudget {
  pageId: number;
  totalRules: number;
  justifiedRules: number;
  unjustifiedRules: number;
  entries: CssBudgetEntry[];
  editabilityImpact: number; // estimated % loss per unjustified rule
}

export interface SettingFirstReport {
  totalAttributes: number;
  settingDriven: number;
  cssFallback: number;
  editabilityScore: number; // 0-100
  decisions: SettingFirstDecision[];
  cssBudget: CssBudget;
}

// ============================================================================
// Setting-First mapping (attribute → Elementor setting)
// ============================================================================

const ATTRIBUTE_TO_SETTING: Record<string, { settingKey: string; reliable: boolean }> = {
  'font-size': { settingKey: 'typography_font_size', reliable: true },
  'font-family': { settingKey: 'typography_font_family', reliable: true },
  'font-weight': { settingKey: 'typography_font_weight', reliable: true },
  'line-height': { settingKey: 'typography_line_height', reliable: true },
  'letter-spacing': { settingKey: 'typography_letter_spacing', reliable: true },
  'color': { settingKey: 'title_color', reliable: true },
  'text-color': { settingKey: 'text_color', reliable: true },
  'background-color': { settingKey: 'background_color', reliable: true },
  'padding': { settingKey: 'padding', reliable: true },
  'margin': { settingKey: 'margin', reliable: true },
  'border-radius': { settingKey: 'border_radius', reliable: true },
  'box-shadow': { settingKey: 'box_shadow', reliable: true },
  'text-align': { settingKey: 'align', reliable: true },
  'gap': { settingKey: 'flex_gap', reliable: true },
  'flex-direction': { settingKey: 'flex_direction', reliable: true },
  'justify-content': { settingKey: 'flex_justify_content', reliable: true },
  'align-items': { settingKey: 'flex_align_items', reliable: true },
  'width': { settingKey: 'width', reliable: true },
  'min-height': { settingKey: 'min_height', reliable: true },
  // Known unreliable under V4:
  'background-image': { settingKey: 'background_image', reliable: false },
  'css-classes': { settingKey: 'css_classes', reliable: false },
};

// ============================================================================
// Core policy engine
// ============================================================================

/**
 * Apply setting-first policy to a V3 element tree.
 * Analyzes each element and determines whether visual attributes
 * should use settings or CSS fallback.
 */
export function applySettingFirstPolicy(
  elements: V3Element[],
  cssRules: Array<{ selector: string; property: string; value: string }>,
  pageId: number,
): SettingFirstReport {
  const decisions: SettingFirstDecision[] = [];
  const budgetEntries: CssBudgetEntry[] = [];

  // Walk tree and record setting-driven attributes
  function walk(el: V3Element): void {
    const settings = el.settings ?? {};
    for (const [key, value] of Object.entries(settings)) {
      if (value === undefined || value === null || value === '') continue;
      const mappedAttr = Object.entries(ATTRIBUTE_TO_SETTING).find(
        ([, v]) => v.settingKey === key,
      );
      if (mappedAttr) {
        decisions.push({
          attribute: mappedAttr[0],
          elementId: el.id,
          method: 'setting',
          settingKey: key,
          settingValue: value,
          justification: `Setting "${key}" renders reliably in Elementor`,
        });
      }
    }
    if (el.elements) {
      for (const child of el.elements) walk(child);
    }
  }

  for (const el of elements) walk(el);

  // Evaluate CSS rules — each needs justification
  for (const rule of cssRules) {
    const mapping = ATTRIBUTE_TO_SETTING[rule.property];
    let settingAttempted = false;
    let settingFailedBecause: string | null = null;
    let method: 'setting' | 'css-fallback' = 'css-fallback';
    let justification = '';

    if (mapping) {
      settingAttempted = true;
      if (mapping.reliable) {
        // This SHOULD be a setting, CSS is unjustified
        settingFailedBecause = null;
        justification = `WARNING: "${rule.property}" should use setting "${mapping.settingKey}" instead of CSS`;
        method = 'css-fallback';
      } else {
        // Setting exists but is unreliable — CSS justified
        settingFailedBecause = `Setting "${mapping.settingKey}" does not render reliably under V4 engine`;
        justification = `CSS fallback justified: ${settingFailedBecause}`;
        method = 'css-fallback';
      }
    } else {
      // No Elementor setting exists for this property — CSS is the only option
      justification = `No Elementor setting exists for "${rule.property}" — CSS is the only method`;
      method = 'css-fallback';
    }

    budgetEntries.push({
      selector: rule.selector,
      property: rule.property,
      value: rule.value,
      reason: justification,
      settingAttempted,
      settingFailedBecause,
    });

    decisions.push({
      attribute: rule.property,
      elementId: rule.selector,
      method,
      cssRule: `${rule.selector} { ${rule.property}: ${rule.value}; }`,
      justification,
    });
  }

  const settingDriven = decisions.filter((d) => d.method === 'setting').length;
  const cssFallback = decisions.filter((d) => d.method === 'css-fallback').length;
  const total = settingDriven + cssFallback;
  const editabilityScore = total > 0 ? Math.round((settingDriven / total) * 100) : 100;

  const justifiedRules = budgetEntries.filter(
    (e) => e.settingFailedBecause !== null || !e.settingAttempted,
  ).length;

  return {
    totalAttributes: total,
    settingDriven,
    cssFallback,
    editabilityScore,
    decisions,
    cssBudget: {
      pageId,
      totalRules: budgetEntries.length,
      justifiedRules,
      unjustifiedRules: budgetEntries.length - justifiedRules,
      entries: budgetEntries,
      editabilityImpact: budgetEntries.length - justifiedRules > 0
        ? Math.round(((budgetEntries.length - justifiedRules) / Math.max(total, 1)) * 100)
        : 0,
    },
  };
}

// ============================================================================
// Widget-first Guards
// ============================================================================

export interface WidgetFirstGuardResult {
  guardId: string;
  passed: boolean;
  message: string;
  value: number;
  threshold: number;
}

/**
 * Run widget-first guards on a V3 tree.
 * G_HTML_BUDGET: html widgets / total widgets ≤ 0.15
 * G_HTML_HAS_IMG: no <img> tags inside html widgets
 */
export function runWidgetFirstGuards(elements: V3Element[]): WidgetFirstGuardResult[] {
  let totalWidgets = 0;
  let htmlWidgets = 0;
  let htmlWithImg = 0;

  function walk(el: V3Element): void {
    if (el.elType === 'widget') {
      totalWidgets++;
      if (el.widgetType === 'html') {
        htmlWidgets++;
        const htmlContent = (el.settings?.['html'] as string) ?? '';
        if (htmlContent.includes('<img')) htmlWithImg++;
      }
    }
    if (el.elements) {
      for (const child of el.elements) walk(child);
    }
  }

  for (const el of elements) walk(el);

  const htmlRatio = totalWidgets > 0 ? htmlWidgets / totalWidgets : 0;

  return [
    {
      guardId: 'G_HTML_BUDGET',
      passed: htmlRatio <= 0.15,
      message: htmlRatio <= 0.15
        ? `HTML widget ratio ${(htmlRatio * 100).toFixed(1)}% within budget (≤15%)`
        : `HTML widget ratio ${(htmlRatio * 100).toFixed(1)}% EXCEEDS budget (≤15%). Convert to native widgets.`,
      value: htmlRatio,
      threshold: 0.15,
    },
    {
      guardId: 'G_HTML_HAS_IMG',
      passed: htmlWithImg === 0,
      message: htmlWithImg === 0
        ? 'No <img> tags found in HTML widgets'
        : `${htmlWithImg} HTML widget(s) contain <img> tags. Use image widget instead.`,
      value: htmlWithImg,
      threshold: 0,
    },
  ];
}

/**
 * Phase 8: Extended Issue-Type Catalog (28 total — 8 V1 + 20 Phase 8).
 *
 * Phase 8 introduces 20 new Issue-Types beyond V1's 8 covering typography,
 * contrast, motion, layout, Elementor-specific, and theme-related issues.
 * Each new type comes with:
 * - a stable string identifier (IssueType union member)
 * - default severity
 * - detector-hint metadata (bbox-tolerance, ssim-threshold, region-min-size)
 * - suggested-fix-template with { selector } placeholder substitution
 */

import type { IssueSeverity } from './strictness.js';

/**
 * All 28 Issue-Types (8 V1 + 20 Phase 8).
 *
 * V1: color-mismatch, layout-shift, font-missing, size-mismatch,
 *     image-broken, animation-inactive, blank-region, size-different.
 *
 * Phase 8 NEW (20):
 * - Typography: line-height-mismatch, letter-spacing-mismatch, font-weight-mismatch,
 *               font-style-mismatch, text-transform-mismatch, text-decoration-mismatch
 * - Contrast/Color: contrast-violation, color-oklch-fallback, theme-not-applied
 * - Motion: animation-duration-mismatch, transition-property-mismatch,
 *           transform-3d-lost, keyframes-missing
 * - Layout: flex-direction-changed, gap-mismatch, padding-mismatch, margin-mismatch,
 *           grid-template-mismatch
 * - Elementor-specific: pro-widget-degraded, custom-css-missing, global-class-missing
 */
export type Phase8IssueType =
  | 'line-height-mismatch'
  | 'letter-spacing-mismatch'
  | 'font-weight-mismatch'
  | 'font-style-mismatch'
  | 'text-transform-mismatch'
  | 'contrast-violation'
  | 'color-oklch-fallback'
  | 'theme-not-applied'
  | 'animation-duration-mismatch'
  | 'transition-property-mismatch'
  | 'transform-3d-lost'
  | 'keyframes-missing'
  | 'flex-direction-changed'
  | 'gap-mismatch'
  | 'padding-mismatch'
  | 'margin-mismatch'
  | 'grid-template-mismatch'
  | 'pro-widget-degraded'
  | 'custom-css-missing'
  | 'global-class-missing';

export type ExtendedIssueType =
  | 'color-mismatch'
  | 'layout-shift'
  | 'font-missing'
  | 'size-mismatch'
  | 'image-broken'
  | 'animation-inactive'
  | 'blank-region'
  | 'size-different'
  | Phase8IssueType;

export type IssueCategory =
  | 'typography'
  | 'color'
  | 'motion'
  | 'layout'
  | 'elementor'
  | 'image'
  | 'size'
  | 'other';

/**
 * Detector hint metadata for an Issue-Type.
 * Used by batched-fix scheduler and per-type tolerance configuration.
 */
export interface IssueTypeHint {
  type: ExtendedIssueType;
  category: IssueCategory;
  defaultSeverity: IssueSeverity;
  bboxTolerancePx: number;
  ssimThreshold: number;
  regionMinSize: number;
  description: string;
  suggestedFixTemplate: string;
}

const SEVERITY_LOW: IssueSeverity = 'low';
const SEVERITY_MEDIUM: IssueSeverity = 'medium';
const SEVERITY_HIGH: IssueSeverity = 'high';

export const PHASE8_ISSUE_TYPE_HINTS: Record<Phase8IssueType, IssueTypeHint> = {
  'line-height-mismatch': {
    type: 'line-height-mismatch',
    category: 'typography',
    defaultSeverity: SEVERITY_LOW,
    bboxTolerancePx: 1,
    ssimThreshold: 0.95,
    regionMinSize: 16,
    description: 'Line-height differs from source (typographic rhythm broken).',
    suggestedFixTemplate:
      'Update Elementor typography line-height for {selector} to match source computed line-height value.',
  },
  'letter-spacing-mismatch': {
    type: 'letter-spacing-mismatch',
    category: 'typography',
    defaultSeverity: SEVERITY_LOW,
    bboxTolerancePx: 1,
    ssimThreshold: 0.95,
    regionMinSize: 16,
    description: 'Letter-spacing differs from source (text density wrong).',
    suggestedFixTemplate:
      'Set Elementor typography letter-spacing for {selector} to the source value (in px or em).',
  },
  'font-weight-mismatch': {
    type: 'font-weight-mismatch',
    category: 'typography',
    defaultSeverity: SEVERITY_MEDIUM,
    bboxTolerancePx: 1,
    ssimThreshold: 0.93,
    regionMinSize: 16,
    description: 'Font-weight differs from source (bold/regular wrong).',
    suggestedFixTemplate:
      'Apply the correct font-weight for {selector} via Elementor typography widget control.',
  },
  'font-style-mismatch': {
    type: 'font-style-mismatch',
    category: 'typography',
    defaultSeverity: SEVERITY_LOW,
    bboxTolerancePx: 1,
    ssimThreshold: 0.95,
    regionMinSize: 16,
    description: 'Font-style differs from source (italic/normal wrong).',
    suggestedFixTemplate: 'Switch font-style for {selector} to match source (italic/normal).',
  },
  'text-transform-mismatch': {
    type: 'text-transform-mismatch',
    category: 'typography',
    defaultSeverity: SEVERITY_LOW,
    bboxTolerancePx: 1,
    ssimThreshold: 0.97,
    regionMinSize: 8,
    description: 'Text-transform differs from source (uppercase/capitalize wrong).',
    suggestedFixTemplate: 'Apply text-transform for {selector} (uppercase/lowercase/capitalize/none).',
  },
  'contrast-violation': {
    type: 'contrast-violation',
    category: 'color',
    defaultSeverity: SEVERITY_HIGH,
    bboxTolerancePx: 2,
    ssimThreshold: 0.9,
    regionMinSize: 32,
    description: 'Foreground/background contrast ratio below WCAG AA (4.5:1).',
    suggestedFixTemplate:
      'Adjust foreground or background color for {selector} to meet WCAG AA contrast ratio (>=4.5:1).',
  },
  'color-oklch-fallback': {
    type: 'color-oklch-fallback',
    category: 'color',
    defaultSeverity: SEVERITY_MEDIUM,
    bboxTolerancePx: 3,
    ssimThreshold: 0.94,
    regionMinSize: 8,
    description: 'oklch() color was converted to nearest sRGB hex (slight hue shift).',
    suggestedFixTemplate:
      'Inject original oklch() value via custom_css for {selector} since Elementor V3 _background_color accepts only hex/rgb.',
  },
  'theme-not-applied': {
    type: 'theme-not-applied',
    category: 'color',
    defaultSeverity: SEVERITY_MEDIUM,
    bboxTolerancePx: 2,
    ssimThreshold: 0.9,
    regionMinSize: 32,
    description: 'Dark/light theme variant detected in source but not applied in clone.',
    suggestedFixTemplate:
      'Apply prefers-color-scheme media query for {selector} or set Elementor theme-style variant.',
  },
  'animation-duration-mismatch': {
    type: 'animation-duration-mismatch',
    category: 'motion',
    defaultSeverity: SEVERITY_LOW,
    bboxTolerancePx: 1,
    ssimThreshold: 0.95,
    regionMinSize: 16,
    description: 'Animation duration differs from source (timing off).',
    suggestedFixTemplate: 'Set animation-duration for {selector} to match source value (in ms or s).',
  },
  'transition-property-mismatch': {
    type: 'transition-property-mismatch',
    category: 'motion',
    defaultSeverity: SEVERITY_LOW,
    bboxTolerancePx: 1,
    ssimThreshold: 0.95,
    regionMinSize: 16,
    description: 'Transition-property differs from source (wrong property animated).',
    suggestedFixTemplate: 'Update transition-property for {selector} to match source list.',
  },
  'transform-3d-lost': {
    type: 'transform-3d-lost',
    category: 'motion',
    defaultSeverity: SEVERITY_MEDIUM,
    bboxTolerancePx: 3,
    ssimThreshold: 0.9,
    regionMinSize: 32,
    description: '3D transform (rotateX/rotateY/perspective) dropped in clone (V3 limitation).',
    suggestedFixTemplate:
      'Inject transform3d via custom_css for {selector} since Elementor V3 transform is 2D-only.',
  },
  'keyframes-missing': {
    type: 'keyframes-missing',
    category: 'motion',
    defaultSeverity: SEVERITY_MEDIUM,
    bboxTolerancePx: 1,
    ssimThreshold: 0.9,
    regionMinSize: 16,
    description: 'CSS @keyframes from source missing in clone (custom animation lost).',
    suggestedFixTemplate:
      'Inject @keyframes for {selector} via custom_css or upload to global Elementor custom CSS.',
  },
  'flex-direction-changed': {
    type: 'flex-direction-changed',
    category: 'layout',
    defaultSeverity: SEVERITY_HIGH,
    bboxTolerancePx: 2,
    ssimThreshold: 0.9,
    regionMinSize: 32,
    description: 'Flex-direction differs from source (row/column reversed).',
    suggestedFixTemplate:
      'Set flex-direction for {selector} (row/column/row-reverse/column-reverse) in Elementor parent container.',
  },
  'gap-mismatch': {
    type: 'gap-mismatch',
    category: 'layout',
    defaultSeverity: SEVERITY_LOW,
    bboxTolerancePx: 2,
    ssimThreshold: 0.95,
    regionMinSize: 16,
    description: 'Gap between flex/grid children differs from source.',
    suggestedFixTemplate: 'Set gap for {selector} to match source value (in px/rem/em).',
  },
  'padding-mismatch': {
    type: 'padding-mismatch',
    category: 'layout',
    defaultSeverity: SEVERITY_LOW,
    bboxTolerancePx: 2,
    ssimThreshold: 0.95,
    regionMinSize: 16,
    description: 'Padding differs from source (inner spacing wrong).',
    suggestedFixTemplate: 'Adjust padding-{top,right,bottom,left} for {selector} to match source.',
  },
  'margin-mismatch': {
    type: 'margin-mismatch',
    category: 'layout',
    defaultSeverity: SEVERITY_LOW,
    bboxTolerancePx: 2,
    ssimThreshold: 0.95,
    regionMinSize: 16,
    description: 'Margin differs from source (outer spacing wrong).',
    suggestedFixTemplate: 'Adjust margin-{top,right,bottom,left} for {selector} to match source.',
  },
  'grid-template-mismatch': {
    type: 'grid-template-mismatch',
    category: 'layout',
    defaultSeverity: SEVERITY_HIGH,
    bboxTolerancePx: 2,
    ssimThreshold: 0.9,
    regionMinSize: 32,
    description: 'CSS grid-template-columns/rows differs from source.',
    suggestedFixTemplate:
      'Inject grid-template-columns/rows via custom_css for {selector} (Elementor V3 native grid is limited).',
  },
  'pro-widget-degraded': {
    type: 'pro-widget-degraded',
    category: 'elementor',
    defaultSeverity: SEVERITY_MEDIUM,
    bboxTolerancePx: 2,
    ssimThreshold: 0.92,
    regionMinSize: 32,
    description:
      'Elementor Pro widget (slider/accordion/tabs/counter) degraded to text-editor fallback.',
    suggestedFixTemplate:
      'Activate Elementor Pro license on target WP or replace degraded widget with custom HTML/CSS for {selector}.',
  },
  'custom-css-missing': {
    type: 'custom-css-missing',
    category: 'elementor',
    defaultSeverity: SEVERITY_MEDIUM,
    bboxTolerancePx: 2,
    ssimThreshold: 0.9,
    regionMinSize: 16,
    description: 'Custom CSS from source not injected into clone (style override lost).',
    suggestedFixTemplate: 'Inject custom CSS for {selector} via Elementor widget advanced > custom_css field.',
  },
  'global-class-missing': {
    type: 'global-class-missing',
    category: 'elementor',
    defaultSeverity: SEVERITY_MEDIUM,
    bboxTolerancePx: 2,
    ssimThreshold: 0.9,
    regionMinSize: 32,
    description: 'Elementor global class (V4) referenced in source not found in clone.',
    suggestedFixTemplate:
      'Create the missing global class on target WP (Elementor > Site Settings > Global Classes) and re-apply to {selector}.',
  },
};

/**
 * Lookup hint by type (works for both V1 types with default hints and Phase 8 types).
 */
export function getIssueTypeHint(type: ExtendedIssueType): IssueTypeHint | null {
  if (type in PHASE8_ISSUE_TYPE_HINTS) {
    return PHASE8_ISSUE_TYPE_HINTS[type as Phase8IssueType];
  }
  // V1 types: return conservative defaults (medium severity, 2px tolerance)
  return {
    type,
    category: 'other',
    defaultSeverity: SEVERITY_MEDIUM,
    bboxTolerancePx: 2,
    ssimThreshold: 0.92,
    regionMinSize: 32,
    description: `V1 Issue-Type: ${type}`,
    suggestedFixTemplate: `Review V1 issue for {selector} and apply appropriate fix.`,
  };
}

/**
 * All 28 Issue-Types as array (for iteration, e.g., for batched-fix scheduler).
 */
export const ALL_ISSUE_TYPES: readonly ExtendedIssueType[] = [
  // V1 (8)
  'color-mismatch',
  'layout-shift',
  'font-missing',
  'size-mismatch',
  'image-broken',
  'animation-inactive',
  'blank-region',
  'size-different',
  // Phase 8 (20)
  'line-height-mismatch',
  'letter-spacing-mismatch',
  'font-weight-mismatch',
  'font-style-mismatch',
  'text-transform-mismatch',
  'contrast-violation',
  'color-oklch-fallback',
  'theme-not-applied',
  'animation-duration-mismatch',
  'transition-property-mismatch',
  'transform-3d-lost',
  'keyframes-missing',
  'flex-direction-changed',
  'gap-mismatch',
  'padding-mismatch',
  'margin-mismatch',
  'grid-template-mismatch',
  'pro-widget-degraded',
  'custom-css-missing',
  'global-class-missing',
];

export const PHASE8_ISSUE_TYPE_COUNT = 20;
export const TOTAL_ISSUE_TYPE_COUNT = 28;

/**
 * Group Issue-Types by category for batched-fix scheduling.
 */
export function groupByCategory(types: readonly ExtendedIssueType[]): Map<IssueCategory, ExtendedIssueType[]> {
  const groups = new Map<IssueCategory, ExtendedIssueType[]>();
  for (const type of types) {
    const hint = getIssueTypeHint(type);
    if (!hint) continue;
    const list = groups.get(hint.category) ?? [];
    list.push(type);
    groups.set(hint.category, list);
  }
  return groups;
}
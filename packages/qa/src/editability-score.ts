/**
 * Editability Score (Phase 62).
 *
 * Scans rendered HTML / V3 tree and computes "Setting-Driven Visuals %" —
 * the percentage of visual properties controlled by Elementor settings
 * rather than external CSS.
 *
 * Target: ≥ 70% as hard floor in QA.
 *
 * @module qa/editability-score
 */

// ============================================================================
// Types
// ============================================================================

export interface EditabilityInput {
  /** Total visual attributes detected in the page. */
  totalVisualAttributes: number;
  /** Attributes driven by Elementor widget settings. */
  settingDrivenAttributes: number;
  /** Attributes driven by external CSS (WPCode snippets). */
  cssDrivenAttributes: number;
  /** Attributes driven by inline styles. */
  inlineStyleAttributes: number;
  /** Number of HTML widgets used for layout (should be 0). */
  htmlLayoutWidgets: number;
  /** Total widget count. */
  totalWidgets: number;
}

export interface EditabilityBreakdown {
  category: string;
  count: number;
  percentage: number;
  editable: boolean;
}

export interface EditabilityReport {
  score: number; // 0-100, target ≥ 70
  grade: 'A' | 'B' | 'C' | 'D' | 'F';
  passed: boolean;
  threshold: number;
  breakdown: EditabilityBreakdown[];
  recommendations: string[];
  timestamp: string;
}

// ============================================================================
// Score computation
// ============================================================================

const EDITABILITY_THRESHOLD = 70;

/**
 * Compute editability score from visual attribute analysis.
 */
export function computeEditabilityScore(input: EditabilityInput): EditabilityReport {
  const total = input.totalVisualAttributes || 1;

  const breakdown: EditabilityBreakdown[] = [
    {
      category: 'Elementor Settings',
      count: input.settingDrivenAttributes,
      percentage: Math.round((input.settingDrivenAttributes / total) * 100),
      editable: true,
    },
    {
      category: 'External CSS (WPCode)',
      count: input.cssDrivenAttributes,
      percentage: Math.round((input.cssDrivenAttributes / total) * 100),
      editable: false,
    },
    {
      category: 'Inline Styles',
      count: input.inlineStyleAttributes,
      percentage: Math.round((input.inlineStyleAttributes / total) * 100),
      editable: false,
    },
  ];

  const score = Math.round((input.settingDrivenAttributes / total) * 100);
  const grade = scoreToGrade(score);
  const passed = score >= EDITABILITY_THRESHOLD;

  const recommendations: string[] = [];
  if (input.cssDrivenAttributes > input.settingDrivenAttributes) {
    recommendations.push(
      'CSS-driven visuals exceed setting-driven. Migrate CSS rules to Elementor settings where possible.',
    );
  }
  if (input.htmlLayoutWidgets > 0) {
    recommendations.push(
      `${input.htmlLayoutWidgets} HTML widget(s) used for layout. Convert to native Elementor widgets.`,
    );
  }
  if (input.inlineStyleAttributes > total * 0.1) {
    recommendations.push(
      'High inline-style usage detected. Move to widget settings for editability.',
    );
  }
  if (score < EDITABILITY_THRESHOLD) {
    recommendations.push(
      `Editability ${score}% is below threshold ${EDITABILITY_THRESHOLD}%. Prioritize setting-first policy.`,
    );
  }

  return {
    score,
    grade,
    passed,
    threshold: EDITABILITY_THRESHOLD,
    breakdown,
    recommendations,
    timestamp: new Date().toISOString(),
  };
}

/**
 * Analyze a rendered HTML string to estimate editability.
 * Counts style attributes, class-based styling, and widget structure.
 */
export function analyzeHtmlEditability(html: string): EditabilityInput {
  // Count inline style attributes
  const inlineStyles = (html.match(/style="[^"]*"/g) ?? []).length;
  const inlineStyleAttributes = inlineStyles; // approximate: 1 attr per style block

  // Count Elementor widget markers (data-settings indicates setting-driven)
  const dataSettings = (html.match(/data-settings="[^"]*"/g) ?? []).length;
  const settingDrivenAttributes = dataSettings * 3; // approximate: 3 visual attrs per widget settings block

  // Count CSS class references that suggest external CSS dependency
  const customClasses = (html.match(/class="[^"]*(?:custom-|css-|wpcode-)[^"]*"/g) ?? []).length;
  const cssDrivenAttributes = customClasses * 2; // approximate

  // Count HTML widgets (elementor-widget-html)
  const htmlWidgets = (html.match(/elementor-widget-html/g) ?? []).length;

  // Count total widgets
  const totalWidgets = (html.match(/elementor-widget-/g) ?? []).length;

  const totalVisualAttributes = settingDrivenAttributes + cssDrivenAttributes + inlineStyleAttributes;

  return {
    totalVisualAttributes: Math.max(totalVisualAttributes, 1),
    settingDrivenAttributes,
    cssDrivenAttributes,
    inlineStyleAttributes,
    htmlLayoutWidgets: htmlWidgets,
    totalWidgets,
  };
}

// ============================================================================
// Helpers
// ============================================================================

function scoreToGrade(score: number): 'A' | 'B' | 'C' | 'D' | 'F' {
  if (score >= 90) return 'A';
  if (score >= 70) return 'B';
  if (score >= 50) return 'C';
  if (score >= 30) return 'D';
  return 'F';
}

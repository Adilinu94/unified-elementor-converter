/**
 * Structured Visual Diff — DOM-based comparison (Phase 64).
 *
 * Compares two URLs (e.g. Framer reference vs Elementor output) at the DOM
 * level rather than pixel level. Produces structured issues that can be
 * fed directly into the healing loop.
 *
 * @module qa/visual-diff-structured
 */

// ============================================================================
// Types
// ============================================================================

export interface DomSnapshot {
  url: string;
  sections: DomSection[];
  globalStyles: Record<string, string>;
  viewport: { width: number; height: number };
}

export interface DomSection {
  id: string;
  selector: string;
  role: string; // hero, nav, stats, services, footer, etc.
  boundingBox: { x: number; y: number; width: number; height: number };
  computedStyles: Record<string, string>;
  childCount: number;
  textContent: string;
  hasImages: boolean;
  hasButtons: boolean;
}

export interface StructuredDiffIssue {
  id: string;
  section: string;
  category: 'layout' | 'typography' | 'color' | 'spacing' | 'missing' | 'extra';
  severity: 'critical' | 'major' | 'minor';
  description: string;
  referenceValue: string;
  actualValue: string;
  selector: string;
  suggestedFix: string;
}

export interface StructuredDiffReport {
  referenceUrl: string;
  targetUrl: string;
  timestamp: string;
  totalIssues: number;
  criticalCount: number;
  majorCount: number;
  minorCount: number;
  issues: StructuredDiffIssue[];
  sectionMatchScore: number; // 0-100
}

// ============================================================================
// Diff engine
// ============================================================================

const STYLE_PROPERTIES_TO_COMPARE = [
  'font-size', 'font-family', 'font-weight', 'line-height',
  'color', 'background-color',
  'padding-top', 'padding-bottom', 'padding-left', 'padding-right',
  'margin-top', 'margin-bottom',
  'gap', 'flex-direction', 'justify-content', 'align-items',
  'width', 'max-width', 'height', 'min-height',
  'border-radius', 'text-align',
];

/**
 * Compare two DOM snapshots and produce structured diff issues.
 */
export function computeStructuredDiff(
  reference: DomSnapshot,
  target: DomSnapshot,
): StructuredDiffReport {
  const issues: StructuredDiffIssue[] = [];
  let issueCounter = 0;

  // Match sections by role
  const refByRole = new Map(reference.sections.map((s) => [s.role, s]));
  const targetByRole = new Map(target.sections.map((s) => [s.role, s]));

  // Check for missing sections
  for (const [role, refSection] of refByRole) {
    const targetSection = targetByRole.get(role);
    if (!targetSection) {
      issues.push({
        id: `DIFF-${++issueCounter}`,
        section: role,
        category: 'missing',
        severity: 'critical',
        description: `Section "${role}" exists in reference but is MISSING in target`,
        referenceValue: refSection.selector,
        actualValue: 'NOT_FOUND',
        selector: refSection.selector,
        suggestedFix: `Add ${role} section to target page`,
      });
      continue;
    }

    // Compare styles
    for (const prop of STYLE_PROPERTIES_TO_COMPARE) {
      const refVal = refSection.computedStyles[prop];
      const targetVal = targetSection.computedStyles[prop];
      if (!refVal || !targetVal) continue;
      if (refVal === targetVal) continue;

      const category = categorizeProperty(prop);
      const severity = getSeverity(prop, refVal, targetVal);

      issues.push({
        id: `DIFF-${++issueCounter}`,
        section: role,
        category,
        severity,
        description: `${prop} mismatch in ${role}: expected "${refVal}", got "${targetVal}"`,
        referenceValue: refVal,
        actualValue: targetVal,
        selector: targetSection.selector,
        suggestedFix: `${targetSection.selector} { ${prop}: ${refVal}; }`,
      });
    }

    // Compare bounding box (layout)
    const widthDiff = Math.abs(refSection.boundingBox.width - targetSection.boundingBox.width);
    if (widthDiff > 20) {
      issues.push({
        id: `DIFF-${++issueCounter}`,
        section: role,
        category: 'layout',
        severity: widthDiff > 100 ? 'critical' : 'major',
        description: `Width mismatch in ${role}: expected ${refSection.boundingBox.width}px, got ${targetSection.boundingBox.width}px`,
        referenceValue: `${refSection.boundingBox.width}px`,
        actualValue: `${targetSection.boundingBox.width}px`,
        selector: targetSection.selector,
        suggestedFix: `${targetSection.selector} { max-width: ${refSection.boundingBox.width}px; }`,
      });
    }

    // Check content presence
    if (refSection.hasImages && !targetSection.hasImages) {
      issues.push({
        id: `DIFF-${++issueCounter}`,
        section: role,
        category: 'missing',
        severity: 'major',
        description: `Images present in reference ${role} but missing in target`,
        referenceValue: 'has images',
        actualValue: 'no images',
        selector: targetSection.selector,
        suggestedFix: `Add image widgets to ${role} section`,
      });
    }

    if (refSection.hasButtons && !targetSection.hasButtons) {
      issues.push({
        id: `DIFF-${++issueCounter}`,
        section: role,
        category: 'missing',
        severity: 'major',
        description: `Buttons present in reference ${role} but missing in target`,
        referenceValue: 'has buttons',
        actualValue: 'no buttons',
        selector: targetSection.selector,
        suggestedFix: `Add button widgets to ${role} section`,
      });
    }
  }

  // Check for extra sections in target
  for (const [role] of targetByRole) {
    if (!refByRole.has(role)) {
      issues.push({
        id: `DIFF-${++issueCounter}`,
        section: role,
        category: 'extra',
        severity: 'minor',
        description: `Section "${role}" exists in target but NOT in reference`,
        referenceValue: 'NOT_IN_REFERENCE',
        actualValue: role,
        selector: targetByRole.get(role)!.selector,
        suggestedFix: `Verify if ${role} section is intentional`,
      });
    }
  }

  const criticalCount = issues.filter((i) => i.severity === 'critical').length;
  const majorCount = issues.filter((i) => i.severity === 'major').length;
  const minorCount = issues.filter((i) => i.severity === 'minor').length;

  const matchedSections = [...refByRole.keys()].filter((r) => targetByRole.has(r)).length;
  const sectionMatchScore = refByRole.size > 0
    ? Math.round((matchedSections / refByRole.size) * 100)
    : 100;

  return {
    referenceUrl: reference.url,
    targetUrl: target.url,
    timestamp: new Date().toISOString(),
    totalIssues: issues.length,
    criticalCount,
    majorCount,
    minorCount,
    issues,
    sectionMatchScore,
  };
}

// ============================================================================
// MCP call builder for DOM snapshot collection
// ============================================================================

/**
 * Build the MCP call to collect a DOM snapshot from a live URL.
 */
export function buildDomSnapshotCall(url: string, viewport = { width: 1440, height: 900 }): {
  ability: string;
  params: Record<string, unknown>;
} {
  return {
    ability: 'novamira/execute-js',
    params: {
      url,
      viewport,
      code: `
        const sections = [];
        const sectionEls = document.querySelectorAll('[class*="elementor-section"], [class*="e-con"], section, header, footer');
        for (const el of sectionEls) {
          const rect = el.getBoundingClientRect();
          const cs = window.getComputedStyle(el);
          sections.push({
            id: el.id || el.className.split(' ')[0],
            selector: el.id ? '#' + el.id : '.' + el.className.split(' ')[0],
            role: inferRole(el),
            boundingBox: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
            computedStyles: Object.fromEntries(Array.from(cs).map(p => [p, cs.getPropertyValue(p)])),
            childCount: el.children.length,
            textContent: el.textContent?.slice(0, 200) || '',
            hasImages: !!el.querySelector('img'),
            hasButtons: !!el.querySelector('a[class*="button"], button, .elementor-button'),
          });
        }
        function inferRole(el) {
          const cls = (el.className || '').toLowerCase();
          const id = (el.id || '').toLowerCase();
          const combined = cls + ' ' + id;
          if (combined.includes('hero')) return 'hero';
          if (combined.includes('nav') || combined.includes('header')) return 'nav';
          if (combined.includes('stat')) return 'stats';
          if (combined.includes('service')) return 'services';
          if (combined.includes('footer')) return 'footer';
          if (combined.includes('contact') || combined.includes('cta')) return 'contact';
          if (combined.includes('team')) return 'team';
          if (combined.includes('about')) return 'about';
          return 'section-' + sections.length;
        }
        const bodyCs = window.getComputedStyle(document.body);
        return {
          url: location.href,
          sections,
          globalStyles: { 'font-size': bodyCs.fontSize, 'font-family': bodyCs.fontFamily, 'color': bodyCs.color, 'background-color': bodyCs.backgroundColor },
          viewport: { width: window.innerWidth, height: window.innerHeight },
        };
      `,
    },
  };
}

// ============================================================================
// Helpers
// ============================================================================

function categorizeProperty(prop: string): StructuredDiffIssue['category'] {
  if (prop.startsWith('font') || prop === 'line-height' || prop === 'text-align') return 'typography';
  if (prop.includes('color') || prop.includes('background')) return 'color';
  if (prop.includes('padding') || prop.includes('margin') || prop === 'gap') return 'spacing';
  return 'layout';
}

function getSeverity(prop: string, _ref: string, _actual: string): StructuredDiffIssue['severity'] {
  if (prop === 'font-size' || prop === 'font-family') return 'major';
  if (prop === 'color' || prop === 'background-color') return 'major';
  if (prop.includes('padding') || prop.includes('margin')) return 'minor';
  return 'minor';
}

/**
 * Design Critic Orchestrator (Phase 67).
 *
 * Coordinates the 3-layer QA system:
 * L1: Rules (computed styles, no reference needed)
 * L2: Diff (paired geometry vs reference URL)
 * L3: Vision (LLM screenshot analysis)
 *
 * @module qa/design-critic/orchestrator
 */

import type {
  ComputedStyleEntry,
  CriticLayer,
  CriticThresholds,
  DesignCritiqueReport,
  DesignFinding,
} from './types.js';
import { DEFAULT_THRESHOLDS } from './types.js';
import { runAllL1Rules } from './rules.js';

// ============================================================================
// Configuration
// ============================================================================

export interface OrchestratorOptions {
  url: string;
  referenceUrl?: string;
  layers: CriticLayer[];
  thresholds?: Partial<CriticThresholds>;
  viewportWidth?: number;
}

// ============================================================================
// Orchestrator
// ============================================================================

/**
 * Run the Design Critic with specified layers.
 * L1 runs synchronously on computed styles.
 * L2 and L3 require external data (reference styles / vision analysis).
 */
export function runDesignCritic(
  options: OrchestratorOptions,
  computedStyles: ComputedStyleEntry[],
  referenceStyles?: ComputedStyleEntry[],
  visionFindings?: DesignFinding[],
): DesignCritiqueReport {
  const thresholds = { ...DEFAULT_THRESHOLDS, ...options.thresholds };
  const allFindings: DesignFinding[] = [];
  const layerScores: Record<CriticLayer, number> = {
    'L1-rules': 100,
    'L2-diff': 100,
    'L3-vision': 100,
  };

  // L1: Rules
  if (options.layers.includes('L1-rules')) {
    const l1Findings = runAllL1Rules(computedStyles, thresholds, options.viewportWidth ?? 1440);
    allFindings.push(...l1Findings);
    layerScores['L1-rules'] = computeLayerScore(l1Findings);
  }

  // L2: Diff against reference
  if (options.layers.includes('L2-diff') && referenceStyles) {
    const l2Findings = runL2Diff(computedStyles, referenceStyles);
    allFindings.push(...l2Findings);
    layerScores['L2-diff'] = computeLayerScore(l2Findings);
  }

  // L3: Vision (external findings passed in)
  if (options.layers.includes('L3-vision') && visionFindings) {
    allFindings.push(...visionFindings);
    layerScores['L3-vision'] = computeLayerScore(visionFindings);
  }

  const criticalCount = allFindings.filter((f) => f.severity === 'critical').length;
  const majorCount = allFindings.filter((f) => f.severity === 'major').length;
  const minorCount = allFindings.filter((f) => f.severity === 'minor').length;

  // Overall score: weighted average of active layers
  const activeLayers = options.layers.filter((l) => layerScores[l] < 100 || allFindings.some((f) => f.layer === l));
  const score = activeLayers.length > 0
    ? Math.round(activeLayers.reduce((sum, l) => sum + layerScores[l], 0) / activeLayers.length)
    : 100;

  return {
    url: options.url,
    referenceUrl: options.referenceUrl,
    timestamp: new Date().toISOString(),
    layers: options.layers,
    totalFindings: allFindings.length,
    criticalCount,
    majorCount,
    minorCount,
    score,
    passed: score >= 85 && criticalCount === 0,
    findings: allFindings,
    layerScores,
  };
}

// ============================================================================
// L2 Diff logic
// ============================================================================

let l2Counter = 0;

function runL2Diff(
  target: ComputedStyleEntry[],
  reference: ComputedStyleEntry[],
): DesignFinding[] {
  const findings: DesignFinding[] = [];
  const refBySelector = new Map(reference.map((e) => [e.selector, e]));

  const COMPARE_PROPS = [
    'font-size', 'font-family', 'color', 'background-color',
    'padding-top', 'padding-bottom', 'gap', 'width', 'height',
  ];

  for (const targetEntry of target) {
    const refEntry = refBySelector.get(targetEntry.selector);
    if (!refEntry) continue;

    for (const prop of COMPARE_PROPS) {
      const targetVal = targetEntry.styles[prop];
      const refVal = refEntry.styles[prop];
      if (!targetVal || !refVal || targetVal === refVal) continue;

      // Numeric tolerance
      const tNum = parseFloat(targetVal);
      const rNum = parseFloat(refVal);
      if (!isNaN(tNum) && !isNaN(rNum) && Math.abs(tNum - rNum) <= 4) continue;

      findings.push({
        id: `DC-L2-${String(++l2Counter).padStart(3, '0')}`,
        layer: 'L2-diff',
        severity: prop.includes('color') || prop === 'font-size' ? 'major' : 'minor',
        principle: prop.includes('color') ? 'color' : prop.includes('font') ? 'typography' : 'spacing',
        section: targetEntry.selector,
        selector: targetEntry.selector,
        expected: `${prop}: ${refVal} (reference)`,
        actual: `${prop}: ${targetVal}`,
        fixHint: `Match reference: ${targetEntry.selector} { ${prop}: ${refVal}; }`,
        confidence: 0.95,
      });
    }
  }

  return findings;
}

// ============================================================================
// Scoring
// ============================================================================

function computeLayerScore(findings: DesignFinding[]): number {
  if (findings.length === 0) return 100;
  const penalty = findings.reduce((sum, f) => {
    switch (f.severity) {
      case 'critical': return sum + 20;
      case 'major': return sum + 10;
      case 'minor': return sum + 3;
      default: return sum + 1;
    }
  }, 0);
  return Math.max(0, 100 - penalty);
}

/**
 * Build MCP call to collect computed styles for Design Critic.
 */
export function buildCriticCollectionCall(url: string, selectors: string[]): {
  ability: string;
  params: Record<string, unknown>;
} {
  return {
    ability: 'browser/execute-js',
    params: {
      url,
      code: `
        const selectors = ${JSON.stringify(selectors)};
        const results = [];
        for (const sel of selectors) {
          const els = document.querySelectorAll(sel);
          for (const el of els) {
            const rect = el.getBoundingClientRect();
            const cs = window.getComputedStyle(el);
            results.push({
              selector: sel,
              styles: Object.fromEntries(Array.from(cs).map(p => [p, cs.getPropertyValue(p)])),
              boundingBox: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
              textContent: (el.textContent || '').slice(0, 100),
            });
          }
        }
        return results;
      `,
    },
  };
}

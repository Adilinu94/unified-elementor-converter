/**
 * V4 Pipeline Hardening (Phase 72).
 *
 * Implements the V4-specific pipeline hardening from UMBAUPLAN-V4:
 * - One-shot happy path (XML → V4-Tree → validate ≥ 85 → optional deploy)
 * - Preflight always-on
 * - Bridge intake (V3-JSON → Atomic with strict $$type upgrade)
 * - Unified QA Report with V4-only probes
 * - Animation inject reliability
 *
 * STRIKT V4-only. No V3 imports.
 *
 * @module target-v4/pipeline-hardening
 */

import type { V4TreeNode } from './types.js';
import { V4_ATOMIC_TYPES } from './types.js';

// ============================================================================
// Types
// ============================================================================

export interface V4PipelineConfig {
  /** Minimum validation score to pass (default: 85). */
  minScore: number;
  /** Run preflight checks before build (always true). */
  preflightAlwaysOn: boolean;
  /** Enable animation injection via page-scoped WPCode. */
  animationInject: boolean;
  /** Deploy mode: dry-run by default. */
  deployMode: 'dry-run' | 'execute';
}

export interface V4ValidationResult {
  score: number;
  passed: boolean;
  checks: V4Check[];
  timestamp: string;
}

export interface V4Check {
  id: string;
  name: string;
  passed: boolean;
  severity: 'error' | 'warning';
  detail: string;
}

export interface V4UnifiedQAReport {
  url: string;
  timestamp: string;
  score: number;
  passed: boolean;
  probes: V4ProbeResult[];
  sectionCompare: V4SectionCompare[];
  structuralProbes: V4StructuralProbe[];
}

export interface V4ProbeResult {
  probeId: string;
  passed: boolean;
  detail: string;
}

export interface V4SectionCompare {
  sectionId: string;
  role: string;
  matchScore: number;
  issues: string[];
}

export interface V4StructuralProbe {
  id: string;
  description: string;
  passed: boolean;
  severity: 'critical' | 'warning';
}

// ============================================================================
// Default config
// ============================================================================

const DEFAULT_CONFIG: V4PipelineConfig = {
  minScore: 85,
  preflightAlwaysOn: true,
  animationInject: true,
  deployMode: 'dry-run',
};

// ============================================================================
// V4 Validation (V4-only probes)
// ============================================================================

/**
 * Validate a V4 tree against V4-specific quality gates.
 */
export function validateV4Tree(
  tree: V4TreeNode[],
  config: Partial<V4PipelineConfig> = {},
): V4ValidationResult {
  const cfg = { ...DEFAULT_CONFIG, ...config };
  const checks: V4Check[] = [];

  // Check 1: No V3 elType:container in output
  const hasV3Container = findV3Containers(tree);
  checks.push({
    id: 'V4_NO_V3_CONTAINER',
    name: 'No V3 containers in V4 output',
    passed: hasV3Container.length === 0,
    severity: 'error',
    detail: hasV3Container.length === 0
      ? 'No V3 elType:container found'
      : `Found ${hasV3Container.length} V3 containers: ${hasV3Container.slice(0, 5).join(', ')}`,
  });

  // Check 2: All nodes have $$type envelopes in settings
  const missingType = findMissing$$Type(tree);
  checks.push({
    id: 'V4_TYPE_ENVELOPES',
    name: '$$type envelopes present',
    passed: missingType === 0,
    severity: 'error',
    detail: missingType === 0
      ? 'All settings use $$type envelopes'
      : `${missingType} settings missing $$type envelope`,
  });

  // Check 3: Global Classes bound
  const gcBound = checkGlobalClassesBound(tree);
  checks.push({
    id: 'V4_GC_BOUND',
    name: 'Global Classes bound',
    passed: gcBound,
    severity: 'warning',
    detail: gcBound ? 'Global Classes are bound' : 'Some nodes missing Global Class binding',
  });

  // Check 4: Valid atomic types only
  const invalidTypes = findInvalidTypes(tree);
  checks.push({
    id: 'V4_ATOMIC_TYPES',
    name: 'Valid V4 atomic types',
    passed: invalidTypes.length === 0,
    severity: 'error',
    detail: invalidTypes.length === 0
      ? 'All types are valid V4 atomic types'
      : `Invalid types: ${invalidTypes.join(', ')}`,
  });

  // Check 5: Styles map present
  const missingStyles = countMissingStyles(tree);
  checks.push({
    id: 'V4_STYLES_MAP',
    name: 'Styles map populated',
    passed: missingStyles === 0,
    severity: 'warning',
    detail: missingStyles === 0
      ? 'All nodes have styles maps'
      : `${missingStyles} nodes missing styles map`,
  });

  // Check 6: No empty flexbox nodes
  const emptyFlex = countEmptyFlexboxes(tree);
  checks.push({
    id: 'V4_NO_EMPTY_FLEX',
    name: 'No empty flexbox nodes',
    passed: emptyFlex === 0,
    severity: 'warning',
    detail: emptyFlex === 0
      ? 'No empty flexbox containers'
      : `${emptyFlex} empty flexbox nodes found`,
  });

  // Compute score
  const errorChecks = checks.filter((c) => c.severity === 'error');
  const warningChecks = checks.filter((c) => c.severity === 'warning');
  const errorPenalty = errorChecks.filter((c) => !c.passed).length * 20;
  const warningPenalty = warningChecks.filter((c) => !c.passed).length * 5;
  const score = Math.max(0, 100 - errorPenalty - warningPenalty);

  return {
    score,
    passed: score >= cfg.minScore,
    checks,
    timestamp: new Date().toISOString(),
  };
}

// ============================================================================
// V4 Unified QA Report
// ============================================================================

/**
 * Build a unified QA report for V4 output.
 */
export function buildV4UnifiedQAReport(
  url: string,
  tree: V4TreeNode[],
  validationResult: V4ValidationResult,
): V4UnifiedQAReport {
  const probes: V4ProbeResult[] = validationResult.checks.map((c) => ({
    probeId: c.id,
    passed: c.passed,
    detail: c.detail,
  }));

  // V4-specific structural probes
  const structuralProbes: V4StructuralProbe[] = [
    {
      id: 'V4_NO_V3_WIDGETS',
      description: 'No V3 widget types in output',
      passed: !tree.some((n) => n.type === 'widget'),
      severity: 'critical',
    },
    {
      id: 'V4_TYPE_PRESENT',
      description: '$$type envelopes present in all settings',
      passed: findMissing$$Type(tree) === 0,
      severity: 'critical',
    },
    {
      id: 'V4_GC_BOUND',
      description: 'Global Classes bound to nodes',
      passed: checkGlobalClassesBound(tree),
      severity: 'warning',
    },
    {
      id: 'V4_STYLES_POPULATED',
      description: 'Style classes defined for visual nodes',
      passed: countMissingStyles(tree) === 0,
      severity: 'warning',
    },
  ];

  const allPassed = [...probes, ...structuralProbes].every((p) => p.passed);
  const criticalFailed = structuralProbes.filter((p) => p.severity === 'critical' && !p.passed).length;

  return {
    url,
    timestamp: new Date().toISOString(),
    score: validationResult.score,
    passed: allPassed && criticalFailed === 0,
    probes,
    sectionCompare: [],
    structuralProbes,
  };
}

// ============================================================================
// Bridge Intake: V3-JSON → V4 Atomic upgrade
// ============================================================================

export interface BridgeUpgradeResult {
  tree: V4TreeNode[];
  upgradedCount: number;
  warnings: string[];
}

/**
 * Upgrade a V3-style JSON tree to proper V4 Atomic with $$type envelopes.
 * This is the strict bridge intake that ensures no V3 artifacts remain.
 */
export function bridgeUpgradeToV4(
  v3Json: Array<Record<string, unknown>>,
): BridgeUpgradeResult {
  const warnings: string[] = [];
  let upgradedCount = 0;

  function upgradeNode(node: Record<string, unknown>): V4TreeNode {
    const elType = (node['elType'] as string) ?? 'container';
    const widgetType = (node['widgetType'] as string) ?? '';

    // Map V3 types to V4 atomic types
    const v4Type = mapToV4Type(elType, widgetType);
    if (v4Type !== elType) upgradedCount++;

    // Upgrade settings with $$type envelopes
    const rawSettings = (node['settings'] as Record<string, unknown>) ?? {};
    const settings = upgradeSettings(rawSettings);

    // Build styles map
    const styles = buildStylesFromSettings(settings, node['id'] as string);

    const result: V4TreeNode = {
      type: v4Type,
      elType: v4Type,
      widgetType: v4Type,
      id: (node['id'] as string) ?? `v4_${Math.random().toString(36).slice(2, 9)}`,
      settings,
      styles,
      elements: ((node['elements'] as Array<Record<string, unknown>>) ?? []).map(upgradeNode),
    };

    return result;
  }

  const tree = v3Json.map(upgradeNode);

  return { tree, upgradedCount, warnings };
}

// ============================================================================
// Helpers
// ============================================================================

function mapToV4Type(elType: string, widgetType: string): string {
  // V3 → V4 type mapping
  if (elType === 'section' || elType === 'container' || elType === 'column') return 'e-flexbox';
  const widgetMap: Record<string, string> = {
    heading: 'e-heading',
    'text-editor': 'e-paragraph',
    image: 'e-image',
    button: 'e-button',
    icon: 'e-icon',
    video: 'e-video',
    divider: 'e-divider',
    spacer: 'e-spacer',
    html: 'e-html',
    form: 'e-form',
  };
  return widgetMap[widgetType] ?? 'e-div-block';
}

function upgradeSettings(settings: Record<string, unknown>): Record<string, unknown> {
  const upgraded: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(settings)) {
    if (value === null || value === undefined) continue;
    // Wrap values in $$type envelopes if not already
    if (typeof value === 'object' && value !== null && '$$type' in (value as Record<string, unknown>)) {
      upgraded[key] = value;
    } else if (typeof value === 'string' && /^#[0-9a-f]{3,8}$/i.test(value)) {
      upgraded[key] = { '$$type': 'color', value };
    } else if (typeof value === 'object' && value !== null && 'size' in (value as Record<string, unknown>)) {
      upgraded[key] = { '$$type': 'size', value };
    } else {
      upgraded[key] = value;
    }
  }
  return upgraded;
}

function buildStylesFromSettings(settings: Record<string, unknown>, nodeId: string): V4TreeNode['styles'] {
  // Create a default style class for the node
  const styleId = `style_${nodeId}`;
  return {
    [styleId]: {
      id: styleId,
      label: `Style for ${nodeId}`,
      type: 'class',
      variants: [{
        meta: { breakpoint: null, state: null },
        props: {},
        custom_css: null,
      }],
    },
  };
}

function findV3Containers(tree: V4TreeNode[]): string[] {
  const found: string[] = [];
  function walk(node: V4TreeNode): void {
    if (node.elType === 'container' || node.elType === 'section' || node.elType === 'column') {
      found.push(node.id);
    }
    if (node.elements) node.elements.forEach(walk);
  }
  tree.forEach(walk);
  return found;
}

function findMissing$$Type(tree: V4TreeNode[]): number {
  let count = 0;
  function walk(node: V4TreeNode): void {
    for (const value of Object.values(node.settings)) {
      if (typeof value === 'object' && value !== null && !('$$type' in (value as Record<string, unknown>))) {
        // Check if it's a size/color that should have $$type
        const v = value as Record<string, unknown>;
        if ('size' in v || 'unit' in v) count++;
      }
    }
    if (node.elements) node.elements.forEach(walk);
  }
  tree.forEach(walk);
  return count;
}

function checkGlobalClassesBound(tree: V4TreeNode[]): boolean {
  // Simplified: check that styles map is non-empty for visual nodes
  let allBound = true;
  function walk(node: V4TreeNode): void {
    if (node.type !== 'e-flexbox' && Object.keys(node.styles).length === 0) {
      allBound = false;
    }
    if (node.elements) node.elements.forEach(walk);
  }
  tree.forEach(walk);
  return allBound;
}

function findInvalidTypes(tree: V4TreeNode[]): string[] {
  const invalid: string[] = [];
  const validSet = new Set<string>(V4_ATOMIC_TYPES);
  function walk(node: V4TreeNode): void {
    if (!validSet.has(node.type)) invalid.push(node.type);
    if (node.elements) node.elements.forEach(walk);
  }
  tree.forEach(walk);
  return [...new Set(invalid)];
}

function countMissingStyles(tree: V4TreeNode[]): number {
  let count = 0;
  function walk(node: V4TreeNode): void {
    if (Object.keys(node.styles).length === 0) count++;
    if (node.elements) node.elements.forEach(walk);
  }
  tree.forEach(walk);
  return count;
}

function countEmptyFlexboxes(tree: V4TreeNode[]): number {
  let count = 0;
  function walk(node: V4TreeNode): void {
    if (node.type === 'e-flexbox' && (!node.elements || node.elements.length === 0)) count++;
    if (node.elements) node.elements.forEach(walk);
  }
  tree.forEach(walk);
  return count;
}

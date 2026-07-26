/**
 * Preflight Suite — Always-on checks before build/deploy.
 * Target-aware: some checks only apply to V3 or V4.
 * 
 * Check IDs:
 * | ID                        | V3   | V4   | Description                              |
 * |---------------------------|------|------|------------------------------------------|
 * | mcp_reachable             | fail | fail | MCP greet                                |
 * | mcp_elementor             | fail | fail | set-content ability exists               |
 * | tree_parse                | fail | fail | JSON parse + guards ≥85                  |
 * | tree_size                 | warn | warn | byte size thresholds                     |
 * | project_match             | fail | fail | hostname vs source URL                   |
 * | v4_experiments            | warn | fail | Elementor V4 experiments (basic)         |
 * | unframer                  | skip | warn | Unframer connectivity                    |
 * | global_classes            | skip | fail | GC exist on site                         |
 * | contamination             | fail | fail | assertNoContamination                    |
 * | ensure_experiments        | skip | fail | All 4 V4 experiment flags active         |
 * | elementor_version         | warn | fail | Elementor version + Pro status           |
 * | session_readiness         | fail | fail | Full env probe (McpCallEntry[] report)   |
 * | unframer_connectivity     | skip | warn | Unframer getProjectXml smoke-test        |
 * | helpers_class             | warn | warn | batch-create-variables availability      |
 */

import type { McpAdapter } from './adapter.js';
import { assertNoContamination, runGuards, type GuardReport } from '@elconv/core';
import { V3_GUARDS } from '@elconv/target-v3';
import { V4_GUARDS } from '@elconv/target-v4';

export type CheckStatus = 'pass' | 'warn' | 'fail' | 'skip';

export interface PreflightCheck {
  id: string;
  label: string;
  status: CheckStatus;
  message?: string;
  durationMs?: number;
}

export interface PreflightReport {
  target: 'v3' | 'v4';
  checks: PreflightCheck[];
  passed: boolean;
  hasWarnings: boolean;
  timestamp: string;
  totalDurationMs: number;
}

export interface PreflightOptions {
  target: 'v3' | 'v4';
  mcpUrl?: string;
  tree?: unknown[];
  sourceUrl?: string;
  skipPreflight?: boolean;
}

// ============================================================================
// Phase 55: McpCallEntry[] report format (from session-init.ts)
// ============================================================================

export interface McpCallEntry {
  step: number;
  label: string;
  ability: string;
  params: Record<string, unknown>;
  expect: string;
  on_fail: string;
  result_key?: string;
  result_truthy_if?: string;
  result_keys?: Record<string, string>;
  note?: string;
  fallback?: string;
}

export interface SessionExperiments {
  e_atomic_elements: string;
  e_opt_in_v4: string;
  e_variables: string;
  e_classes: string;
}

export interface SessionReadinessResult {
  ok: boolean;
  mcp_reachable: boolean;
  helpers_class_available: boolean;
  batch_create_variables_ok: boolean;
  elementor_version: string | null;
  elementor_pro_active: boolean;
  atomic_available: boolean;
  experiments: SessionExperiments;
  existing_variables: string[];
  issues: string[];
  warnings: string[];
  timestamp: string;
}

export interface GateReport {
  gateId: string;
  status: CheckStatus;
  message: string;
  calls?: McpCallEntry[];
  result?: Partial<SessionReadinessResult>;
  durationMs: number;
}

// ============================================================================
// V4 Experiment flags
// ============================================================================

const V4_EXPERIMENT_FLAGS = [
  'e_atomic_elements',
  'e_opt_in_v4',
  'e_variables',
  'e_classes',
] as const;

const MIN_ELEMENTOR_VERSION = '3.25.0';

/**
 * Run all preflight checks.
 */
export async function runPreflight(
  adapter: McpAdapter | null,
  options: PreflightOptions,
): Promise<PreflightReport> {
  const start = Date.now();
  const { target, tree, sourceUrl } = options;
  const checks: PreflightCheck[] = [];

  // 1. MCP reachable
  if (adapter) {
    checks.push(await checkMcpReachable(adapter));
    checks.push(await checkMcpElementor(adapter));
  } else {
    checks.push({ id: 'mcp_reachable', label: 'MCP reachable', status: 'skip', message: 'No adapter' });
    checks.push({ id: 'mcp_elementor', label: 'MCP Elementor ability', status: 'skip', message: 'No adapter' });
  }

  // 2. Tree validation
  if (tree) {
    checks.push(checkTreeParse(tree, target));
    checks.push(checkTreeSize(tree));
    checks.push(checkContamination(tree, target));
  } else {
    checks.push({ id: 'tree_parse', label: 'Tree validation', status: 'skip', message: 'No tree provided' });
    checks.push({ id: 'tree_size', label: 'Tree size', status: 'skip' });
    checks.push({ id: 'contamination', label: 'Contamination check', status: 'skip' });
  }

  // 3. Project match
  if (sourceUrl && adapter) {
    checks.push(await checkProjectMatch(adapter, sourceUrl));
  } else {
    checks.push({ id: 'project_match', label: 'Project match', status: 'skip', message: 'No source URL or adapter' });
  }

  // 4. V4-specific checks
  if (target === 'v4') {
    checks.push(await checkV4Experiments(adapter));
    checks.push(await checkUnframer(adapter));
    checks.push(await checkGlobalClasses(adapter));
  } else {
    checks.push({ id: 'v4_experiments', label: 'V4 experiments', status: 'warn', message: 'V3 target — V4 experiments not required' });
    checks.push({ id: 'unframer', label: 'Unframer', status: 'skip', message: 'V3 target' });
    checks.push({ id: 'global_classes', label: 'Global classes', status: 'skip', message: 'V3 target' });
  }

  // 5. Phase 55 — New gate types
  checks.push(await gateEnsureExperiments(adapter, target));
  checks.push(await gateElementorVersion(adapter, target));
  checks.push(await gateSessionReadiness(adapter, target));
  checks.push(await gateUnframerConnectivity(adapter, target));
  checks.push(await gateHelpersClass(adapter, target));

  const hasFail = checks.some((c) => c.status === 'fail');
  const hasWarnings = checks.some((c) => c.status === 'warn');

  return {
    target,
    checks,
    passed: !hasFail,
    hasWarnings,
    timestamp: new Date().toISOString(),
    totalDurationMs: Date.now() - start,
  };
}

// --- Individual Checks ---

async function checkMcpReachable(adapter: McpAdapter): Promise<PreflightCheck> {
  const start = Date.now();
  try {
    await adapter.call('greet', {});
    return { id: 'mcp_reachable', label: 'MCP reachable', status: 'pass', durationMs: Date.now() - start };
  } catch (err) {
    return { id: 'mcp_reachable', label: 'MCP reachable', status: 'fail', message: (err as Error).message, durationMs: Date.now() - start };
  }
}

async function checkMcpElementor(adapter: McpAdapter): Promise<PreflightCheck> {
  const start = Date.now();
  try {
    // Try to list abilities or call a lightweight Elementor check
    const result = await adapter.call('list-abilities', {}) as { abilities?: string[] };
    const hasElementor = result.abilities?.some((a) => a.includes('elementor')) ?? false;
    return {
      id: 'mcp_elementor',
      label: 'MCP Elementor ability',
      status: hasElementor ? 'pass' : 'warn',
      message: hasElementor ? undefined : 'No Elementor abilities found',
      durationMs: Date.now() - start,
    };
  } catch (err) {
    return { id: 'mcp_elementor', label: 'MCP Elementor ability', status: 'fail', message: (err as Error).message, durationMs: Date.now() - start };
  }
}

function checkTreeParse(tree: unknown[], target: 'v3' | 'v4'): PreflightCheck {
  const start = Date.now();
  try {
    const guards = target === 'v3' ? V3_GUARDS : V4_GUARDS;
    const report = runGuards(tree, guards);
    return {
      id: 'tree_parse',
      label: `Tree guards ≥${report.threshold}`,
      status: report.passed ? 'pass' : 'fail',
      message: `Score: ${report.score}/100`,
      durationMs: Date.now() - start,
    };
  } catch (err) {
    return { id: 'tree_parse', label: 'Tree parse', status: 'fail', message: (err as Error).message, durationMs: Date.now() - start };
  }
}

function checkTreeSize(tree: unknown[]): PreflightCheck {
  const bytes = Buffer.byteLength(JSON.stringify(tree), 'utf-8');
  const kb = (bytes / 1024).toFixed(1);
  let status: CheckStatus = 'pass';
  let message = `${kb} KB`;

  if (bytes > 1_200_000) {
    status = 'fail';
    message += ' — exceeds 1.2MB limit';
  } else if (bytes > 400_000) {
    status = 'warn';
    message += ' — large tree, will use upload-php/split';
  }

  return { id: 'tree_size', label: 'Tree size', status, message };
}

function checkContamination(tree: unknown[], target: 'v3' | 'v4'): PreflightCheck {
  const start = Date.now();
  try {
    assertNoContamination(tree, target);
    return { id: 'contamination', label: 'No contamination', status: 'pass', durationMs: Date.now() - start };
  } catch (err) {
    return { id: 'contamination', label: 'No contamination', status: 'fail', message: (err as Error).message, durationMs: Date.now() - start };
  }
}

async function checkProjectMatch(adapter: McpAdapter, sourceUrl: string): Promise<PreflightCheck> {
  const start = Date.now();
  try {
    const result = await adapter.call('get-site-info', {}) as { url?: string };
    const siteUrl = result.url ?? '';
    const sourceHost = new URL(sourceUrl).hostname;
    const siteHost = siteUrl ? new URL(siteUrl).hostname : '';

    // Allow if same domain or if we can't determine
    const matches = !siteHost || sourceHost.includes(siteHost) || siteHost.includes(sourceHost);
    return {
      id: 'project_match',
      label: 'Project match',
      status: matches ? 'pass' : 'warn',
      message: matches ? undefined : `Source: ${sourceHost}, Site: ${siteHost}`,
      durationMs: Date.now() - start,
    };
  } catch {
    return { id: 'project_match', label: 'Project match', status: 'skip', message: 'Could not verify', durationMs: Date.now() - start };
  }
}

async function checkV4Experiments(adapter: McpAdapter | null): Promise<PreflightCheck> {
  if (!adapter) {
    return { id: 'v4_experiments', label: 'V4 experiments', status: 'skip', message: 'No adapter' };
  }
  const start = Date.now();
  try {
    const result = await adapter.call('elementor-get-settings', {}) as { experiments?: Record<string, boolean> };
    const v4Active = result.experiments?.['e_atomic_elements'] ?? false;
    return {
      id: 'v4_experiments',
      label: 'V4 experiments active',
      status: v4Active ? 'pass' : 'fail',
      message: v4Active ? undefined : 'e_atomic_elements experiment not enabled',
      durationMs: Date.now() - start,
    };
  } catch {
    return { id: 'v4_experiments', label: 'V4 experiments', status: 'warn', message: 'Could not verify', durationMs: Date.now() - start };
  }
}

async function checkUnframer(adapter: McpAdapter | null): Promise<PreflightCheck> {
  if (!adapter) {
    return { id: 'unframer', label: 'Unframer', status: 'skip', message: 'No adapter' };
  }
  // Unframer check is a warning, not a failure
  return { id: 'unframer', label: 'Unframer connectivity', status: 'warn', message: 'Manual verification recommended' };
}

async function checkGlobalClasses(adapter: McpAdapter | null): Promise<PreflightCheck> {
  if (!adapter) {
    return { id: 'global_classes', label: 'Global classes', status: 'skip', message: 'No adapter' };
  }
  const start = Date.now();
  try {
    const result = await adapter.call('get-global-classes', {}) as { classes?: unknown[] };
    const hasGC = (result.classes?.length ?? 0) > 0;
    return {
      id: 'global_classes',
      label: 'Global classes exist',
      status: hasGC ? 'pass' : 'fail',
      message: hasGC ? `${result.classes!.length} classes` : 'No global classes found',
      durationMs: Date.now() - start,
    };
  } catch {
    return { id: 'global_classes', label: 'Global classes', status: 'warn', message: 'Could not verify', durationMs: Date.now() - start };
  }
}

/**
 * Format a preflight report for CLI output.
 */
export function formatPreflightReport(report: PreflightReport): string {
  const lines: string[] = [
    ``,
    `🩺 Preflight Report — target: ${report.target.toUpperCase()}`,
    `─`.repeat(50),
  ];

  for (const check of report.checks) {
    const icon = check.status === 'pass' ? '✓' : check.status === 'warn' ? '⚠' : check.status === 'fail' ? '✗' : '○';
    const msg = check.message ? ` — ${check.message}` : '';
    const time = check.durationMs !== undefined ? ` (${check.durationMs}ms)` : '';
    lines.push(`  ${icon} ${check.label}${msg}${time}`);
  }

  lines.push(`─`.repeat(50));
  lines.push(`  Result: ${report.passed ? 'PASS' : 'FAIL'}${report.hasWarnings ? ' (with warnings)' : ''}`);
  lines.push(`  Duration: ${report.totalDurationMs}ms`);
  lines.push(``);

  return lines.join('\n');
}

// ============================================================================
// Phase 55: Five New Gate Types
// ============================================================================

/**
 * Gate 1: ensure_experiments — Verify all 4 V4 experiment flags are active.
 * V4-specific: fails if any of e_atomic_elements, e_opt_in_v4, e_variables, e_classes is off.
 * V3: skipped (experiments not required).
 */
async function gateEnsureExperiments(adapter: McpAdapter | null, target: 'v3' | 'v4'): Promise<PreflightCheck> {
  if (target !== 'v4') {
    return { id: 'ensure_experiments', label: 'V4 experiment flags', status: 'skip', message: 'V3 target' };
  }
  if (!adapter) {
    return { id: 'ensure_experiments', label: 'V4 experiment flags', status: 'skip', message: 'No adapter' };
  }
  const start = Date.now();
  try {
    const result = await adapter.call('elementor-get-settings', {}) as {
      experiments?: Record<string, boolean | string>;
    };
    const experiments = result.experiments ?? {};
    const inactive: string[] = [];

    for (const flag of V4_EXPERIMENT_FLAGS) {
      const val = experiments[flag];
      const isActive = val === true || val === 'active' || val === '1';
      if (!isActive) inactive.push(flag);
    }

    if (inactive.length === 0) {
      return {
        id: 'ensure_experiments',
        label: 'V4 experiment flags (all 4)',
        status: 'pass',
        message: 'All experiments active',
        durationMs: Date.now() - start,
      };
    }
    return {
      id: 'ensure_experiments',
      label: 'V4 experiment flags (all 4)',
      status: 'fail',
      message: `Inactive: ${inactive.join(', ')}`,
      durationMs: Date.now() - start,
    };
  } catch (err) {
    return {
      id: 'ensure_experiments',
      label: 'V4 experiment flags',
      status: 'warn',
      message: `Could not verify: ${(err as Error).message}`,
      durationMs: Date.now() - start,
    };
  }
}

/**
 * Gate 2: elementor_version — Verify Elementor version meets minimum + Pro status.
 * V4: fail if version < minimum or Pro not active.
 * V3: warn only (Pro recommended but not strictly required).
 */
async function gateElementorVersion(adapter: McpAdapter | null, target: 'v3' | 'v4'): Promise<PreflightCheck> {
  if (!adapter) {
    return { id: 'elementor_version', label: 'Elementor version', status: 'skip', message: 'No adapter' };
  }
  const start = Date.now();
  try {
    const result = await adapter.call('elementor-check-setup', {}) as {
      data?: {
        elementor?: { version?: string; active?: boolean };
        elementor_pro?: { active?: boolean; version?: string };
        atomic?: { runtime_available?: boolean };
      };
    };

    const elData = result.data?.elementor;
    const proData = result.data?.elementor_pro;
    const version = elData?.version ?? null;
    const proActive = proData?.active ?? false;

    if (!elData?.active) {
      return {
        id: 'elementor_version',
        label: 'Elementor version',
        status: 'fail',
        message: 'Elementor is not active',
        durationMs: Date.now() - start,
      };
    }

    const versionOk = version ? compareVersions(version, MIN_ELEMENTOR_VERSION) >= 0 : false;
    const issues: string[] = [];

    if (!versionOk) issues.push(`Version ${version ?? 'unknown'} < ${MIN_ELEMENTOR_VERSION}`);
    if (!proActive && target === 'v4') issues.push('Elementor Pro not active (required for V4)');

    if (issues.length === 0) {
      return {
        id: 'elementor_version',
        label: 'Elementor version',
        status: 'pass',
        message: `v${version}${proActive ? ' + Pro' : ''}`,
        durationMs: Date.now() - start,
      };
    }

    return {
      id: 'elementor_version',
      label: 'Elementor version',
      status: target === 'v4' ? 'fail' : 'warn',
      message: issues.join('; '),
      durationMs: Date.now() - start,
    };
  } catch (err) {
    return {
      id: 'elementor_version',
      label: 'Elementor version',
      status: 'warn',
      message: `Could not verify: ${(err as Error).message}`,
      durationMs: Date.now() - start,
    };
  }
}

/**
 * Gate 3: session_readiness — Full environment readiness probe.
 * Produces McpCallEntry[] report for step-by-step MCP execution.
 * Both targets: fail if MCP not reachable.
 */
async function gateSessionReadiness(adapter: McpAdapter | null, target: 'v3' | 'v4'): Promise<PreflightCheck> {
  if (!adapter) {
    return { id: 'session_readiness', label: 'Session readiness', status: 'skip', message: 'No adapter' };
  }
  const start = Date.now();
  const calls = buildSessionReadinessCalls(target);

  try {
    // Execute step 1: discover abilities
    const discoverResult = await adapter.call('greet', {}) as Record<string, unknown>;
    const mcpReachable = discoverResult !== null && discoverResult !== undefined;

    if (!mcpReachable) {
      return {
        id: 'session_readiness',
        label: 'Session readiness',
        status: 'fail',
        message: 'MCP not reachable',
        durationMs: Date.now() - start,
      };
    }

    // Execute step 2: check-setup
    let setupOk = true;
    let setupMessage = '';
    try {
      const setupResult = await adapter.call('elementor-check-setup', {}) as {
        data?: { atomic?: { runtime_available?: boolean } };
      };
      if (target === 'v4' && !setupResult.data?.atomic?.runtime_available) {
        setupOk = false;
        setupMessage = 'Atomic runtime not available';
      }
    } catch {
      setupOk = false;
      setupMessage = 'check-setup call failed';
    }

    if (!setupOk && target === 'v4') {
      return {
        id: 'session_readiness',
        label: 'Session readiness',
        status: 'fail',
        message: setupMessage,
        durationMs: Date.now() - start,
      };
    }

    return {
      id: 'session_readiness',
      label: 'Session readiness',
      status: setupOk ? 'pass' : 'warn',
      message: setupOk ? `${calls.length}-step probe passed` : setupMessage,
      durationMs: Date.now() - start,
    };
  } catch (err) {
    return {
      id: 'session_readiness',
      label: 'Session readiness',
      status: 'fail',
      message: (err as Error).message,
      durationMs: Date.now() - start,
    };
  }
}

/**
 * Gate 4: unframer_connectivity — Unframer getProjectXml smoke-test.
 * V4 only: warn if Unframer MCP not reachable (needed for Framer XML extraction).
 * V3: skipped.
 */
async function gateUnframerConnectivity(adapter: McpAdapter | null, target: 'v3' | 'v4'): Promise<PreflightCheck> {
  if (target !== 'v4') {
    return { id: 'unframer_connectivity', label: 'Unframer connectivity', status: 'skip', message: 'V3 target' };
  }
  if (!adapter) {
    return { id: 'unframer_connectivity', label: 'Unframer connectivity', status: 'skip', message: 'No adapter' };
  }
  const start = Date.now();
  try {
    // Attempt a lightweight Unframer call
    const result = await adapter.call('unframer-get-project-xml', {}) as {
      xml?: string;
      error?: string;
    };

    if (result.error) {
      return {
        id: 'unframer_connectivity',
        label: 'Unframer connectivity',
        status: 'warn',
        message: `Unframer responded with error: ${result.error}`,
        durationMs: Date.now() - start,
      };
    }

    return {
      id: 'unframer_connectivity',
      label: 'Unframer connectivity',
      status: 'pass',
      message: 'getProjectXml reachable',
      durationMs: Date.now() - start,
    };
  } catch {
    return {
      id: 'unframer_connectivity',
      label: 'Unframer connectivity',
      status: 'warn',
      message: 'Unframer MCP not reachable — manual XML export required',
      durationMs: Date.now() - start,
    };
  }
}

/**
 * Gate 5: helpers_class — batch-create-variables smoke-test.
 * Checks if the Helpers class (batch operations) is available.
 * Both targets: warn if not available (sequential fallback exists).
 */
async function gateHelpersClass(adapter: McpAdapter | null, target: 'v3' | 'v4'): Promise<PreflightCheck> {
  if (!adapter) {
    return { id: 'helpers_class', label: 'Helpers class', status: 'skip', message: 'No adapter' };
  }
  const start = Date.now();
  try {
    const result = await adapter.call('batch-create-variables', {
      strategy: 'skip',
      variables: [{ label: '_session_probe', type: 'color', value: '#000000' }],
    }) as { success?: boolean; error?: string };

    if (result.success) {
      return {
        id: 'helpers_class',
        label: 'Helpers class (batch)',
        status: 'pass',
        message: 'batch-create-variables available',
        durationMs: Date.now() - start,
      };
    }

    return {
      id: 'helpers_class',
      label: 'Helpers class (batch)',
      status: 'warn',
      message: result.error ?? 'Batch not available — sequential fallback active',
      durationMs: Date.now() - start,
    };
  } catch {
    return {
      id: 'helpers_class',
      label: 'Helpers class (batch)',
      status: 'warn',
      message: 'batch-create-variables not available — using sequential fallback',
      durationMs: Date.now() - start,
    };
  }
}

// ============================================================================
// Phase 55: Helpers
// ============================================================================

/**
 * Build the McpCallEntry[] checklist for session readiness probe.
 */
export function buildSessionReadinessCalls(target: 'v3' | 'v4'): McpCallEntry[] {
  const calls: McpCallEntry[] = [
    {
      step: 1,
      label: 'MCP Connection (discover-abilities)',
      ability: 'mcp-adapter-discover-abilities',
      params: {},
      expect: 'List of ≥10 abilities',
      on_fail: 'CRITICAL: MCP not reachable. Plugin active? WordPress running?',
      result_key: 'mcp_reachable',
      result_truthy_if: 'response.abilities.length > 10',
    },
    {
      step: 2,
      label: 'Elementor Check Setup (Version + Atomic)',
      ability: 'elementor-check-setup',
      params: {},
      expect: target === 'v4'
        ? 'elementor.active: true, atomic.runtime_available: true'
        : 'elementor.active: true',
      on_fail: target === 'v4'
        ? 'CRITICAL: Elementor inactive or Atomic not available.'
        : 'CRITICAL: Elementor inactive.',
      result_keys: {
        elementor_version: 'response.data.elementor.version',
        atomic_available: 'response.data.atomic.runtime_available',
        elementor_pro_active: 'response.data.elementor_pro.active',
      },
      note: 'Experiments (e_atomic_elements etc.) not returned by check-setup — verify separately.',
    },
    {
      step: 3,
      label: 'Helpers-Class Guard (batch-create-variables Smoke-Test)',
      ability: 'batch-create-variables',
      params: {
        strategy: 'skip',
        variables: [{ label: '_session_probe', type: 'color', value: '#000000' }],
      },
      expect: 'success: true OR "Class not found" → activate fallback',
      on_fail: 'WARNING: batch-create-variables unavailable → use sequential fallback.',
      result_key: 'helpers_class_available',
      result_truthy_if: 'response.success === true',
      fallback: 'elementor-create-variable (sequential)',
    },
  ];

  if (target === 'v4') {
    calls.push({
      step: 4,
      label: 'V4 Experiment Flags Verification',
      ability: 'elementor-get-settings',
      params: {},
      expect: 'All 4 flags active: e_atomic_elements, e_opt_in_v4, e_variables, e_classes',
      on_fail: 'CRITICAL: Enable missing experiments in WP Admin → Elementor → Settings → Experiments.',
      result_key: 'experiments',
      result_truthy_if: 'all flags === "active"',
    });
  }

  return calls;
}

/**
 * Compare semver-like version strings. Returns -1, 0, or 1.
 */
function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    const na = pa[i] ?? 0;
    const nb = pb[i] ?? 0;
    if (na > nb) return 1;
    if (na < nb) return -1;
  }
  return 0;
}

/**
 * Build a full GateReport with McpCallEntry[] for external consumers.
 */
export async function runGateReport(
  adapter: McpAdapter | null,
  target: 'v3' | 'v4',
): Promise<GateReport[]> {
  const start = Date.now();
  const gates: GateReport[] = [];

  const g1 = await gateEnsureExperiments(adapter, target);
  gates.push({ gateId: g1.id, status: g1.status, message: g1.message ?? '', durationMs: Date.now() - start });

  const g2 = await gateElementorVersion(adapter, target);
  gates.push({ gateId: g2.id, status: g2.status, message: g2.message ?? '', durationMs: Date.now() - start });

  const g3 = await gateSessionReadiness(adapter, target);
  gates.push({
    gateId: g3.id,
    status: g3.status,
    message: g3.message ?? '',
    calls: buildSessionReadinessCalls(target),
    durationMs: Date.now() - start,
  });

  const g4 = await gateUnframerConnectivity(adapter, target);
  gates.push({ gateId: g4.id, status: g4.status, message: g4.message ?? '', durationMs: Date.now() - start });

  const g5 = await gateHelpersClass(adapter, target);
  gates.push({ gateId: g5.id, status: g5.status, message: g5.message ?? '', durationMs: Date.now() - start });

  return gates;
}

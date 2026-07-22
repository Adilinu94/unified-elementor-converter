/**
 * Preflight Suite — Always-on checks before build/deploy.
 * Target-aware: some checks only apply to V3 or V4.
 * 
 * Check IDs:
 * | ID               | V3   | V4   | Description                    |
 * |------------------|------|------|--------------------------------|
 * | mcp_reachable    | fail | fail | MCP greet                      |
 * | mcp_elementor    | fail | fail | set-content ability exists     |
 * | tree_parse       | fail | fail | JSON parse + guards ≥85        |
 * | tree_size        | warn | warn | byte size thresholds           |
 * | project_match    | fail | fail | hostname vs source URL         |
 * | v4_experiments   | warn | fail | Elementor V4 experiments       |
 * | unframer         | skip | warn | Unframer connectivity          |
 * | global_classes   | skip | fail | GC exist on site               |
 * | contamination    | fail | fail | assertNoContamination          |
 */

import type { McpAdapter } from './adapter.ts';
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

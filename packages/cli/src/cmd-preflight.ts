/**
 * elconv preflight — Plugin/environment compatibility pre-flight (Phase 115,
 * BAUPLAN v4.0 V7, Phase 95).
 *
 * Runs read-only PHP on the target WordPress (via the novamira/execute-php
 * ability) to detect installed plugins + PHP/WP versions, checks them against
 * @elconv/core's PLUGIN_MATRIX, and prints a human or `--json` report. Exits 1
 * when the pipeline may not start; `--fix` attempts to install missing plugins.
 */
import { optionalFlag, boolFlag } from './args.js';
import { McpAdapter } from '@elconv/mcp';
import {
  PluginDetector,
  buildInstallPluginPhp,
  type CompatibilityReport,
  type PhpExecutor,
} from '@elconv/core';

interface ExecutePhpResult {
  success?: boolean;
  return_value?: unknown;
  output?: unknown;
  error_message?: string;
  error?: string;
  data?: {
    success?: boolean;
    return_value?: unknown;
    output?: unknown;
    error_message?: string;
    error?: string;
  };
}

/** Wrap the MCP adapter as a PhpExecutor via the novamira/execute-php ability. */
export function mcpPhpExecutor(adapter: McpAdapter): PhpExecutor {
  return {
    async executePhp(code: string): Promise<string> {
      const raw = await adapter.executeAbility<ExecutePhpResult>('novamira/execute-php', { code });
      const res = raw.data ?? raw;
      if (res.success === false || raw.success === false) {
        throw new Error(res.error_message ?? res.error ?? raw.error_message ?? raw.error ?? 'execute-php failed');
      }
      const value = res.return_value ?? res.output ?? raw.return_value ?? raw.output;
      if (value === undefined) throw new Error('execute-php returned no return_value or output');
      return typeof value === 'string' ? value : JSON.stringify(value);
    },
  };
}

function renderReport(report: CompatibilityReport): void {
  process.stdout.write(`\n🔍 Pre-Flight Check (${report.mode.toUpperCase()})\n`);
  for (const r of report.results) {
    const icon = r.status === 'ok' ? '✓' : r.status === 'missing' ? '✗' : '⚠';
    process.stdout.write(`  ${icon} ${r.message}\n`);
    if (r.action) process.stdout.write(`    → ${r.action}\n`);
  }
  const env = report.environment;
  process.stdout.write(`\n  PHP: ${env.phpVersion} ${env.phpOk ? '✓' : '✗'}\n`);
  process.stdout.write(`  WP:  ${env.wordpressVersion} ${env.wpOk ? '✓' : '✗'}\n`);
  for (const w of env.warnings) process.stdout.write(`  ⚠ ${w}\n`);
}

async function autoInstall(executor: PhpExecutor, report: CompatibilityReport): Promise<void> {
  process.stdout.write('\n🔧 Auto-Fix: installiere fehlende Plugins...\n');
  for (const r of report.results) {
    if (r.status === 'missing' && r.requirement.installUrl) {
      try {
        await executor.executePhp(buildInstallPluginPhp(r.requirement.slug));
        process.stdout.write(`  ✓ ${r.requirement.name} installiert und aktiviert\n`);
      } catch (err) {
        process.stderr.write(`  ✗ ${r.requirement.name}: ${err instanceof Error ? err.message : err}\n`);
      }
    }
  }
}

export interface ElementorSetupData {
  elementor?: { active?: boolean; version?: string };
  elementor_pro?: { active?: boolean; version?: string };
  atomic?: { runtime_available?: boolean };
}

export interface ElementorSetupResponse extends ElementorSetupData {
  success?: boolean;
  data?: ElementorSetupData;
  return_value?: ElementorSetupData;
  issues?: string[];
}

export interface LivePreflightResult {
  passed: boolean;
  message: string;
  compatibility?: CompatibilityReport;
}

/**
 * Run the complete read-only target preflight used by real wizard deploys.
 *
 * This deliberately does not mutate WordPress: it discovers the live ability
 * surface, checks Elementor/Atomic setup, and evaluates plugin/PHP/WP
 * compatibility through the existing PluginDetector.
 */
export async function runLivePreflight(
  adapter: McpAdapter,
  mode: 'v3' | 'v4',
): Promise<LivePreflightResult> {
  const abilities = await adapter.listAbilities();
  const requiredAbilities = [
    'mcp-adapter/discover-abilities',
    'novamira/elementor-check-setup',
    'novamira/execute-php',
    mode === 'v4'
      ? 'novamira-adrianv2/batch-build-page'
      : 'novamira-adrianv2/elementor-inject-calibrated-page',
  ];
  const missingAbilities = requiredAbilities.filter(
    (required) => !abilities.includes(required) && !abilities.includes(required.replace('/', '-')),
  );
  if (missingAbilities.length > 0) {
    return { passed: false, message: `MCP discovery is missing required abilities: ${missingAbilities.join(', ')}.` };
  }

  const setup = await adapter.executeAbility<ElementorSetupResponse>('novamira/elementor-check-setup', {});
  if (setup.success === false) {
    return { passed: false, message: setup.issues?.join('; ') ?? 'Elementor setup check failed.' };
  }

  const setupData = setup.return_value ?? setup.data ?? setup;
  const issues: string[] = [];
  if (setupData.elementor?.active !== true) issues.push('Elementor is not active.');
  if (mode === 'v4' && setupData.atomic?.runtime_available !== true) {
    issues.push('V4 Atomic runtime is not available.');
  }
  if (issues.length > 0) return { passed: false, message: issues.join(' ') };

  const compatibility = await new PluginDetector(mcpPhpExecutor(adapter)).checkCompatibility(mode);
  if (!compatibility.passed) {
    const failed = compatibility.results
      .filter((result) => result.requirement.required && result.status !== 'ok')
      .map((result) => result.message);
    if (!compatibility.environment.phpOk) failed.push(`PHP ${compatibility.environment.phpVersion} is below the supported minimum.`);
    if (!compatibility.environment.wpOk) failed.push(`WordPress ${compatibility.environment.wordpressVersion} is below the supported minimum.`);
    return {
      passed: false,
      message: failed.length > 0 ? failed.join(' ') : 'Target compatibility preflight failed.',
      compatibility,
    };
  }

  return {
    passed: true,
    message: `Live preflight passed (${abilities.length} abilities; Elementor ${setupData.elementor?.version ?? 'version unknown'}).`,
    compatibility,
  };
}

/**
 * `executorFactory` is injectable so tests can supply a fake PhpExecutor without
 * a live MCP; production wires the real novamira/execute-php ability.
 */
export async function cmdPreflight(
  flags: Record<string, string | boolean>,
  executorFactory: (adapter: McpAdapter) => PhpExecutor = mcpPhpExecutor,
): Promise<number> {
  const modeRaw = optionalFlag(flags, 'mode') ?? 'v3';
  if (modeRaw !== 'v3' && modeRaw !== 'v4') {
    process.stderr.write(`Error: --mode must be "v3" or "v4" (got "${modeRaw}").\n`);
    return 2;
  }
  const asJson = boolFlag(flags, 'json');

  const mcpUrl = optionalFlag(flags, 'mcp-url');
  const authEnv = optionalFlag(flags, 'auth-env');
  const creds = authEnv ? process.env[authEnv] : undefined;
  if (!mcpUrl || !creds) {
    process.stderr.write(
      'Error: preflight needs --mcp-url <url> and --auth-env <ENV_VAR> (env holds "user:app-password").\n',
    );
    return 2;
  }

  const adapter = new McpAdapter({
    baseUrl: mcpUrl,
    authHeader: `Basic ${Buffer.from(creds).toString('base64')}`,
  });
  const executor = executorFactory(adapter);
  const detector = new PluginDetector(executor);

  let report: CompatibilityReport;
  try {
    report = await detector.checkCompatibility(modeRaw);
  } catch (err) {
    process.stderr.write(`Error: preflight failed: ${err instanceof Error ? err.message : err}\n`);
    return 1;
  }

  if (asJson) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else {
    renderReport(report);
  }

  if (!report.passed) {
    if (!asJson) {
      process.stdout.write('\n❌ Pre-Flight FEHLGESCHLAGEN — Pipeline kann nicht starten.\n');
    }
    if (boolFlag(flags, 'fix')) await autoInstall(executor, report);
    return 1;
  }
  if (!asJson) process.stdout.write('\n✅ Pre-Flight BESTANDEN — Pipeline kann starten.\n');
  return 0;
}

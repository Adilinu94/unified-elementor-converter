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
  success: boolean;
  return_value: unknown;
  error_message?: string;
}

/** Wrap the MCP adapter as a PhpExecutor via the novamira/execute-php ability. */
export function mcpPhpExecutor(adapter: McpAdapter): PhpExecutor {
  return {
    async executePhp(code: string): Promise<string> {
      const res = await adapter.executeAbility<ExecutePhpResult>('novamira/execute-php', { code });
      if (!res.success) throw new Error(res.error_message ?? 'execute-php failed');
      const rv = res.return_value;
      return typeof rv === 'string' ? rv : JSON.stringify(rv);
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

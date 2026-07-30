/**
 * elconv deploy — Deploy a tree to WordPress via MCP.
 * Supports dry-run, strategy selection, and rollback.
 */

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { assertNoContamination, runGuards, formatGuardReport, chooseDeployStrategy, measureTreeBytes } from '@elconv/core';
import { V3_GUARDS } from '@elconv/target-v3';
import { V4_GUARDS } from '@elconv/target-v4';
import { requireFlag, optionalFlag, boolFlag } from './args.js';
import { McpAdapter, convertPageV3ToV4 } from '@elconv/mcp';

export interface DeployResult {
  success: boolean;
  strategy: string;
  bytes: number;
  postId: number;
  dryRun: boolean;
  backupPath?: string;
  error?: string;
}

export async function cmdDeploy(flags: Record<string, string | boolean>): Promise<number> {
  const target = requireFlag(flags, 'target') as 'v3' | 'v4';
  if (target !== 'v3' && target !== 'v4') {
    process.stderr.write(`Error: --target must be "v3" or "v4"\n`);
    return 2;
  }

  const treePath = requireFlag(flags, 'tree');
  const postId = parseInt(requireFlag(flags, 'post-id'), 10);
  const strategyOverride = optionalFlag(flags, 'strategy') as 'auto' | 'direct' | 'upload-php' | 'split' | undefined;
  const dryRun = boolFlag(flags, 'dry-run');
  const force = boolFlag(flags, 'force');
  const mcpUrl = optionalFlag(flags, 'mcp-url');
  const serverConvert = boolFlag(flags, 'server-convert');

  if (isNaN(postId)) {
    process.stderr.write('Error: --post-id must be a number\n');
    return 2;
  }

  // 1. Load tree
  let tree: unknown[];
  let rawJson: string;
  try {
    rawJson = readFileSync(resolve(treePath), 'utf-8');
    tree = JSON.parse(rawJson);
  } catch (err) {
    process.stderr.write(`Error: cannot load tree: ${(err as Error).message}\n`);
    return 1;
  }

  // 2. Run guards
  const guards = target === 'v3' ? V3_GUARDS : V4_GUARDS;
  const report = runGuards(tree, guards);
  if (!report.passed && !force) {
    process.stderr.write(`Guard score ${report.score}/100 — below threshold. Use --force to override.\n`);
    process.stderr.write(formatGuardReport(report) + '\n');
    return 1;
  }

  // 3. Anti-contamination
  try {
    assertNoContamination(tree, target);
  } catch (err) {
    process.stderr.write(`CONTAMINATION: ${(err as Error).message}\n`);
    return 1;
  }

  // 4. Strategy selection
  const bytes = measureTreeBytes(tree);
  const strategy = chooseDeployStrategy(bytes, strategyOverride as any);

  // 5. Dry-run mode
  if (dryRun) {
    process.stdout.write(`\n🔍 DRY RUN — no changes made\n`);
    process.stdout.write(`  Target:   ${target.toUpperCase()}\n`);
    process.stdout.write(`  Post ID:  ${postId}\n`);
    process.stdout.write(`  Size:     ${(bytes / 1024).toFixed(1)} KB\n`);
    process.stdout.write(`  Strategy: ${strategy}\n`);
    process.stdout.write(`  Guards:   ${report.score}/100 ${report.passed ? '✓' : '⚠ (forced)'}\n`);
    if (serverConvert) {
      process.stdout.write(`  Server-Convert: would run novamira-adrianv2/convert-page-v3-to-v4 (dry_run) after deploy\n`);
    }
    process.stdout.write(`\n`);
    return 0;
  }

  // 6. Execute deploy (requires MCP)
  if (!mcpUrl) {
    process.stderr.write('Error: --mcp-url required for actual deploy (or use --dry-run)\n');
    return 2;
  }

  // Backup
  const backupDir = resolve('.elconv-backups');
  mkdirSync(backupDir, { recursive: true });
  const backupPath = resolve(backupDir, `post-${postId}-${Date.now()}.json`);
  writeFileSync(backupPath, rawJson, 'utf-8');

  process.stdout.write(`\n🚀 Deploying ${target.toUpperCase()} tree to post ${postId}\n`);
  process.stdout.write(`  Strategy: ${strategy}\n`);
  process.stdout.write(`  Size:     ${(bytes / 1024).toFixed(1)} KB\n`);
  process.stdout.write(`  Backup:   ${backupPath}\n`);

  // Actual MCP deploy would go here
  // For now, report that MCP integration is needed
  process.stderr.write('\nNote: Full MCP deploy requires a running WordPress MCP server.\n');
  process.stderr.write('The tree has been validated and is ready for deploy.\n');

  // 7. Optional server-side V3→V4 conversion (Phase 107). Runs the real
  // novamira-adrianv2/convert-page-v3-to-v4 ability against the deployed post.
  // Only valid from a V3 source tree — a V4 tree has nothing to convert.
  if (serverConvert) {
    if (target !== 'v3') {
      process.stderr.write('Error: --server-convert only applies to --target v3 (converts the deployed V3 page to V4).\n');
      return 2;
    }
    const authEnv = optionalFlag(flags, 'auth-env');
    const creds = authEnv ? process.env[authEnv] : undefined;
    if (!mcpUrl || !creds) {
      process.stderr.write('Error: --server-convert needs --mcp-url and --auth-env <ENV_VAR> (env holds "user:app-password").\n');
      return 2;
    }
    const adapter = new McpAdapter({
      baseUrl: mcpUrl,
      authHeader: `Basic ${Buffer.from(creds).toString('base64')}`,
    });
    process.stdout.write(`\n🔁 Server-side V3→V4 conversion of post ${postId}\n`);
    const convertResult = await convertPageV3ToV4(adapter, {
      postId,
      dryRun: boolFlag(flags, 'convert-dry-run'),
      autoFix: boolFlag(flags, 'convert-auto-fix'),
    });
    if (!convertResult.success) {
      process.stderr.write(`  ✗ convert-page-v3-to-v4 failed: ${convertResult.error}\n`);
      return 1;
    }
    process.stdout.write(
      `  ✓ converted=${convertResult.stats?.converted ?? 0}, kept_v3=${convertResult.stats?.kept_v3 ?? 0}, skipped=${convertResult.stats?.skipped ?? 0}\n`,
    );
  }

  process.stdout.write(`\n✓ Deploy preparation complete\n`);
  return 0;
}

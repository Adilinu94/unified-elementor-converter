/**
 * elconv deploy — Deploy a tree to WordPress via MCP.
 * Supports dry-run, strategy selection, and rollback.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  assertNoContamination,
  runGuards,
  formatGuardReport,
  chooseDeployStrategy,
  measureTreeBytes,
  STRATEGY_THRESHOLDS,
} from '@elconv/core';
import { V3_GUARDS } from '@elconv/target-v3';
import { V4_GUARDS } from '@elconv/target-v4';
import { requireFlag, optionalFlag, boolFlag } from './args.js';
import {
  McpAdapter,
  convertPageV3ToV4,
  capturePageSnapshot,
  writeSnapshotFile,
  SNAPSHOT_DIR,
  pushToWordPress,
  executeDeploy,
  transactionManager,
  restorePageSnapshot,
  type DeployReport,
  type WpPushResult,
} from '@elconv/mcp';

export interface DeployResult {
  success: boolean;
  strategy: string;
  bytes: number;
  postId: number;
  dryRun: boolean;
  snapshotPath?: string;
  error?: string;
}

export interface DeployDependencies {
  createAdapter?: (options: { baseUrl: string; authHeader: string }) => McpAdapter;
  pushPage?: typeof pushToWordPress;
  executeStrategy?: typeof executeDeploy;
  captureSnapshot?: typeof capturePageSnapshot;
  saveSnapshot?: typeof writeSnapshotFile;
  restoreSnapshot?: typeof restorePageSnapshot;
  convertPage?: typeof convertPageV3ToV4;
}

export async function cmdDeploy(
  flags: Record<string, string | boolean>,
  dependencies: DeployDependencies = {},
): Promise<number> {
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
  const forceLargeDirect = boolFlag(flags, 'force-large-direct');
  const mcpUrl = optionalFlag(flags, 'mcp-url');
  const authEnv = optionalFlag(flags, 'auth-env');
  const credentials = authEnv ? process.env[authEnv] : undefined;
  const serverConvert = boolFlag(flags, 'server-convert');

  if (serverConvert && target !== 'v3') {
    process.stderr.write('Error: --server-convert only applies to --target v3 (converts the deployed V3 page to V4).\n');
    return 2;
  }

  if (isNaN(postId)) {
    process.stderr.write('Error: --post-id must be a number\n');
    return 2;
  }

  // 1. Load tree
  let tree: unknown[];
  try {
    const rawJson = readFileSync(resolve(treePath), 'utf-8');
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
  const selectedStrategy = chooseDeployStrategy(
    bytes,
    strategyOverride === 'auto' ? undefined : strategyOverride,
  );
  const strategy = selectedStrategy;
  if (
    !dryRun &&
    strategyOverride === 'direct' &&
    bytes >= STRATEGY_THRESHOLDS.directMaxBytes &&
    !forceLargeDirect
  ) {
    process.stderr.write(
      `Error: direct deployment is restricted to trees below ${(STRATEGY_THRESHOLDS.directMaxBytes / 1024).toFixed(0)} KB. Use --force-large-direct to explicitly accept this large payload, or use --dry-run.\n`,
    );
    return 2;
  }

  // 5. Dry-run mode
  if (dryRun) {
    process.stdout.write(`\n🔍 DRY RUN — no changes made\n`);
    process.stdout.write(`  Target:   ${target.toUpperCase()}\n`);
    process.stdout.write(`  Post ID:  ${postId}\n`);
    process.stdout.write(`  Size:     ${(bytes / 1024).toFixed(1)} KB\n`);
    process.stdout.write(`  Strategy: ${strategy}\n`);
    if (strategy === 'upload-php') {
      process.stdout.write('  Capability: unavailable live — no verified upload/PHP-inject schema\n');
    } else if (strategy === 'split') {
      process.stdout.write('  Capability: unavailable live — append/chunk schema is not verified\n');
    }
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

  if (!credentials) {
    process.stderr.write('Error: --auth-env <ENV_VAR> is required for actual deploy (env holds "user:app-password")\n');
    return 2;
  }

  const adapter = (dependencies.createAdapter ?? ((options) => new McpAdapter(options)))({
    baseUrl: mcpUrl,
    authHeader: `Basic ${Buffer.from(credentials).toString('base64')}`,
  });

  process.stdout.write(`\n🚀 Deploying ${target.toUpperCase()} tree to post ${postId}\n`);
  process.stdout.write(`  Strategy: ${strategy}\n`);
  process.stdout.write(`  Size:     ${(bytes / 1024).toFixed(1)} KB\n`);

  // Capture the live page before mutating it. The incoming tree is not a
  // rollback backup; only the current WordPress content is restorable.
  const snapshot = await (dependencies.captureSnapshot ?? capturePageSnapshot)(adapter, postId).catch((err: unknown) => {
    process.stderr.write(`Error: could not capture pre-deploy snapshot: ${err instanceof Error ? err.message : String(err)}\n`);
    return null;
  });
  if (!snapshot) return 1;

  let snapshotPath: string;
  try {
    snapshotPath = (dependencies.saveSnapshot ?? writeSnapshotFile)(
      resolve(optionalFlag(flags, 'snapshot-dir') ?? SNAPSHOT_DIR),
      snapshot,
    );
  } catch (err) {
    process.stderr.write(`Error: could not save pre-deploy snapshot: ${err instanceof Error ? err.message : String(err)}\n`);
    return 1;
  }
  process.stdout.write(`  Snapshot: ${snapshotPath}\n`);

  const restoreSnapshotSafely = async (): Promise<void> => {
    try {
      const restored = await (dependencies.restoreSnapshot ?? restorePageSnapshot)(adapter, snapshot);
      if (restored.success) {
        process.stderr.write('  ✓ Pre-deploy snapshot restored\n');
      } else {
        process.stderr.write(`  ✗ Snapshot restore failed: ${restored.error ?? 'unknown error'}\n`);
      }
    } catch (restoreErr) {
      process.stderr.write(`  ✗ Snapshot restore failed: ${restoreErr instanceof Error ? restoreErr.message : String(restoreErr)}\n`);
    }
  };

  let pushResult: WpPushResult | undefined;
  let orchestratedResult: DeployReport | undefined;
  try {
    if (strategy === 'direct') {
      pushResult = await (dependencies.pushPage ?? pushToWordPress)(adapter, tree, {
        postId,
        title: optionalFlag(flags, 'title') ?? `Converted ${target.toUpperCase()} page`,
        status: optionalFlag(flags, 'status') === 'publish' ? 'publish' : 'draft',
        pageTemplate: optionalFlag(flags, 'page-template') === 'default'
          ? 'default'
          : optionalFlag(flags, 'page-template') === 'elementor_header_footer'
            ? 'elementor_header_footer'
            : 'elementor_canvas',
        target,
      });
    } else {
      orchestratedResult = await (dependencies.executeStrategy ?? executeDeploy)(adapter, transactionManager, {
        target,
        postId,
        tree,
        strategy,
        skipVerify: boolFlag(flags, 'skip-verify'),
      });
      if (!orchestratedResult.success) {
        const error = new Error(orchestratedResult.errors.join('; ') || `strategy ${strategy} failed`);
        (error as Error & { failureKind?: DeployReport['failureKind'] }).failureKind = orchestratedResult.failureKind;
        throw error;
      }
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    process.stderr.write(`Deploy failed: ${message}\n`);
    const failureKind = (err as Error & { failureKind?: DeployReport['failureKind'] }).failureKind;
    if (failureKind !== 'capability-unavailable') await restoreSnapshotSafely();
    process.stderr.write(`Rollback is available with: elconv rollback --snapshot "${snapshotPath}" --mcp-url <url> --auth-env <ENV_VAR>\n`);
    return 1;
  }

  if (pushResult) {
    process.stdout.write(`  Permalink: ${pushResult.permalink || '(not returned)'}\n`);
  }
  if (orchestratedResult) {
    process.stdout.write(`  Transaction: ${orchestratedResult.transactionId}\n`);
    if (orchestratedResult.chunks !== undefined) process.stdout.write(`  Chunks:     ${orchestratedResult.chunks}\n`);
  }
  process.stdout.write('  ✓ WordPress content updated\n');

  // 7. Optional server-side V3→V4 conversion (Phase 107). Runs the real
  // novamira-adrianv2/convert-page-v3-to-v4 ability against the deployed post.
  // Only valid from a V3 source tree — a V4 tree has nothing to convert.
  if (serverConvert) {
    const creds = credentials;
    if (!mcpUrl || !creds) {
      process.stderr.write('Error: --server-convert needs --mcp-url and --auth-env <ENV_VAR> (env holds "user:app-password").\n');
      return 2;
    }
    process.stdout.write(`\n🔁 Server-side V3→V4 conversion of post ${postId}\n`);
    try {
      const convertResult = await (dependencies.convertPage ?? convertPageV3ToV4)(adapter, {
        postId,
        dryRun: boolFlag(flags, 'convert-dry-run'),
        autoFix: boolFlag(flags, 'convert-auto-fix'),
      });
      if (!convertResult.success) {
        process.stderr.write(`  ✗ convert-page-v3-to-v4 failed: ${convertResult.error}\n`);
        await restoreSnapshotSafely();
        process.stderr.write(`  Restore the pre-deploy snapshot with: elconv rollback --snapshot "${snapshotPath}" --mcp-url <url> --auth-env <ENV_VAR>\n`);
        return 1;
      }
      process.stdout.write(
        `  ✓ converted=${convertResult.stats?.converted ?? 0}, kept_v3=${convertResult.stats?.kept_v3 ?? 0}, skipped=${convertResult.stats?.skipped ?? 0}\n`,
      );
    } catch (err) {
      process.stderr.write(`  ✗ convert-page-v3-to-v4 failed: ${err instanceof Error ? err.message : String(err)}\n`);
      await restoreSnapshotSafely();
      process.stderr.write(`  Restore the pre-deploy snapshot with: elconv rollback --snapshot "${snapshotPath}" --mcp-url <url> --auth-env <ENV_VAR>\n`);
      return 1;
    }
  }

  process.stdout.write(`\n✓ Deploy complete\n`);
  return 0;
}

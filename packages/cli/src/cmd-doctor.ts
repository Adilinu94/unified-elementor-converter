/**
 * elconv doctor — Run preflight checks against a target.
 * Validates MCP connectivity, tree integrity, and target-specific requirements.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { assertNoContamination, runGuards } from '@elconv/core';
import { V3_GUARDS } from '@elconv/target-v3';
import { V4_GUARDS } from '@elconv/target-v4';
import {
  McpAdapter,
  diffAbilityRegistry,
  getTarget,
  buildAuthHeader,
} from '@elconv/mcp';
import { requireFlag, optionalFlag } from './args.js';

export interface PreflightCheck {
  id: string;
  label: string;
  status: 'pass' | 'warn' | 'fail' | 'skip';
  message?: string;
}

export interface PreflightReport {
  target: 'v3' | 'v4';
  checks: PreflightCheck[];
  passed: boolean;
  timestamp: string;
}

export async function cmdDoctor(flags: Record<string, string | boolean>): Promise<number> {
  // --sync-abilities: diff the live server against the frozen registry snapshot.
  if (flags['sync-abilities']) {
    return syncAbilities(flags);
  }

  const target = requireFlag(flags, 'target') as 'v3' | 'v4';
  if (target !== 'v3' && target !== 'v4') {
    process.stderr.write(`Error: --target must be "v3" or "v4"\n`);
    return 2;
  }

  const mcpUrl = optionalFlag(flags, 'mcp-url');
  const treePath = optionalFlag(flags, 'tree');

  const checks: PreflightCheck[] = [];

  // Check 1: MCP reachable (skip if no URL)
  if (mcpUrl) {
    try {
      const res = await fetch(mcpUrl, { method: 'POST', body: JSON.stringify({ jsonrpc: '2.0', method: 'greet', id: 1 }), headers: { 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(5000) });
      checks.push({ id: 'mcp_reachable', label: 'MCP reachable', status: res.ok ? 'pass' : 'fail', message: `HTTP ${res.status}` });
    } catch (err) {
      checks.push({ id: 'mcp_reachable', label: 'MCP reachable', status: 'fail', message: (err as Error).message });
    }
  } else {
    checks.push({ id: 'mcp_reachable', label: 'MCP reachable', status: 'skip', message: 'No --mcp-url provided' });
  }

  // Check 2: Tree validation (if provided)
  if (treePath) {
    try {
      const raw = readFileSync(resolve(treePath), 'utf-8');
      const tree = JSON.parse(raw);

      // Contamination check
      try {
        assertNoContamination(tree, target);
        checks.push({ id: 'contamination', label: 'No cross-contamination', status: 'pass' });
      } catch (err) {
        checks.push({ id: 'contamination', label: 'No cross-contamination', status: 'fail', message: (err as Error).message });
      }

      // Guard score
      const guards = target === 'v3' ? V3_GUARDS : V4_GUARDS;
      const report = runGuards(tree, guards);
      checks.push({
        id: 'tree_guards',
        label: `Guard score ≥ ${report.threshold}`,
        status: report.passed ? 'pass' : 'fail',
        message: `Score: ${report.score}/100`,
      });

      // Tree size
      const bytes = Buffer.byteLength(raw);
      const sizeStatus = bytes > 1_200_000 ? 'fail' : bytes > 400_000 ? 'warn' : 'pass';
      checks.push({ id: 'tree_size', label: 'Tree size', status: sizeStatus, message: `${(bytes / 1024).toFixed(1)} KB` });
    } catch (err) {
      checks.push({ id: 'tree_parse', label: 'Tree JSON parse', status: 'fail', message: (err as Error).message });
    }
  } else {
    checks.push({ id: 'tree_parse', label: 'Tree validation', status: 'skip', message: 'No --tree provided' });
  }

  // Check 3: V4-specific — experiments active
  if (target === 'v4') {
    if (mcpUrl) {
      checks.push({ id: 'v4_experiments', label: 'V4 experiments active', status: 'warn', message: 'Cannot verify without MCP elementor-get-settings' });
    } else {
      checks.push({ id: 'v4_experiments', label: 'V4 experiments active', status: 'skip' });
    }
  }

  // Build report
  const hasFail = checks.some((c) => c.status === 'fail');
  const report: PreflightReport = {
    target,
    checks,
    passed: !hasFail,
    timestamp: new Date().toISOString(),
  };

  // Output
  process.stdout.write(`\n🩺 elconv doctor — target: ${target.toUpperCase()}\n${'─'.repeat(50)}\n`);
  for (const check of checks) {
    const icon = check.status === 'pass' ? '✓' : check.status === 'warn' ? '⚠' : check.status === 'fail' ? '✗' : '○';
    const msg = check.message ? ` — ${check.message}` : '';
    process.stdout.write(`  ${icon} ${check.label}${msg}\n`);
  }
  process.stdout.write(`${'─'.repeat(50)}\n`);
  process.stdout.write(`  Result: ${report.passed ? 'PASS' : 'FAIL'}\n\n`);

  return hasFail ? 1 : 0;
}

/**
 * elconv doctor --sync-abilities — call the live server's discover-abilities
 * and diff it against the frozen KNOWN_ABILITIES snapshot, surfacing drift.
 *
 * Auth: --target-name <name> (uses the stored target's authEnv) OR
 *       --mcp-url <url> --auth-env <ENV_VAR_NAME> (env holds "user:app-password").
 */
export async function syncAbilities(flags: Record<string, string | boolean>): Promise<number> {
  let baseUrl: string;
  let authHeader: string;

  const targetName = optionalFlag(flags, 'target-name');
  try {
    if (targetName) {
      const t = getTarget(targetName);
      baseUrl = t.mcpEndpoint;
      authHeader = buildAuthHeader(t);
    } else {
      const mcpUrl = optionalFlag(flags, 'mcp-url');
      const authEnv = optionalFlag(flags, 'auth-env');
      if (!mcpUrl || !authEnv) {
        process.stderr.write(
          'Error: --sync-abilities needs either --target-name <name> or ' +
            '--mcp-url <url> --auth-env <ENV_VAR>.\n',
        );
        return 2;
      }
      const creds = process.env[authEnv];
      if (!creds) {
        process.stderr.write(`Error: env var "${authEnv}" is not set (expected "user:app-password").\n`);
        return 2;
      }
      baseUrl = mcpUrl;
      authHeader = `Basic ${Buffer.from(creds).toString('base64')}`;
    }
  } catch (err) {
    process.stderr.write(`Error: ${(err as Error).message}\n`);
    return 2;
  }

  const adapter = new McpAdapter({ baseUrl, authHeader });
  let live: string[];
  try {
    live = await adapter.listAbilities();
  } catch (err) {
    process.stderr.write(`Error: discover-abilities failed: ${(err as Error).message}\n`);
    return 1;
  }

  const drift = diffAbilityRegistry(live);
  process.stdout.write(`\n🔄 Novamira ability sync\n${'─'.repeat(50)}\n`);
  process.stdout.write(`  Live: ${drift.liveCount}   Snapshot: ${drift.snapshotCount}\n`);
  if (drift.inSync) {
    process.stdout.write('  ✓ Registry is in sync with the live server.\n');
  } else {
    if (drift.addedOnServer.length > 0) {
      process.stdout.write(`\n  + New on server (add to KNOWN_ABILITIES): ${drift.addedOnServer.length}\n`);
      for (const n of drift.addedOnServer) process.stdout.write(`      + ${n}\n`);
    }
    if (drift.removedFromServer.length > 0) {
      process.stdout.write(`\n  - Removed from server (stale in snapshot): ${drift.removedFromServer.length}\n`);
      for (const n of drift.removedFromServer) process.stdout.write(`      - ${n}\n`);
    }
  }
  if (drift.nowAvailable.length > 0) {
    process.stdout.write(`\n  ★ Previously-unavailable, now live (close the gap): ${drift.nowAvailable.length}\n`);
    for (const n of drift.nowAvailable) process.stdout.write(`      ★ ${n}\n`);
  }
  process.stdout.write(`${'─'.repeat(50)}\n\n`);

  return drift.inSync ? 0 : 1;
}

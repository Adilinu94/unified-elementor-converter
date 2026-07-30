/**
 * elconv rollback — restore a WordPress page from a snapshot (Phase 110).
 *
 * Snapshots are captured (e.g. before a deploy) by @elconv/mcp's snapshot
 * module. This command lists them and restores one back onto its post via
 * novamira/elementor-set-content.
 */
import { resolve } from 'node:path';
import { optionalFlag, boolFlag } from './args.js';
import {
  McpAdapter,
  listSnapshots,
  readSnapshotFile,
  restorePageSnapshot,
  SNAPSHOT_DIR,
  type PageSnapshot,
} from '@elconv/mcp';

export async function cmdRollback(flags: Record<string, string | boolean>): Promise<number> {
  const postIdRaw = optionalFlag(flags, 'post-id');
  const postId = postIdRaw !== undefined ? Number(postIdRaw) : NaN;
  const hasPostId = Number.isFinite(postId) && postId > 0;
  const dir = resolve(optionalFlag(flags, 'snapshot-dir') ?? SNAPSHOT_DIR);
  const explicitSnapshot = optionalFlag(flags, 'snapshot');
  const dryRun = boolFlag(flags, 'dry-run');

  // ── --list: show available snapshots ──
  if (boolFlag(flags, 'list')) {
    const snaps = listSnapshots(dir, hasPostId ? postId : undefined);
    if (snaps.length === 0) {
      process.stdout.write(`No snapshots found in ${dir}${hasPostId ? ` for post ${postId}` : ''}.\n`);
      return 0;
    }
    process.stdout.write(`\n📚 Snapshots in ${dir}${hasPostId ? ` for post ${postId}` : ''}:\n`);
    for (const s of snaps) {
      process.stdout.write(`  post ${s.postId}  ${s.path}\n`);
    }
    return 0;
  }

  // ── Resolve which snapshot to restore ──
  let snapshot: PageSnapshot;
  if (explicitSnapshot) {
    try {
      snapshot = readSnapshotFile(explicitSnapshot);
    } catch (err) {
      process.stderr.write(`Error: ${err instanceof Error ? err.message : err}\n`);
      return 1;
    }
  } else {
    if (!hasPostId) {
      process.stderr.write('Error: rollback needs --post-id <id> (newest snapshot) or --snapshot <path>. Use --list to browse.\n');
      return 2;
    }
    const snaps = listSnapshots(dir, postId);
    if (snaps.length === 0) {
      process.stderr.write(`Error: no snapshot for post ${postId} in ${dir}.\n`);
      return 1;
    }
    try {
      snapshot = readSnapshotFile(snaps[0].path); // newest first
    } catch (err) {
      process.stderr.write(`Error: ${err instanceof Error ? err.message : err}\n`);
      return 1;
    }
  }

  process.stdout.write(
    `\n↩️  Rollback post ${snapshot.postId} — snapshot ${snapshot.timestamp} (${snapshot.content.length} top-level elements)\n`,
  );

  if (dryRun) {
    process.stdout.write('  DRY RUN — no changes made\n\n');
    return 0;
  }

  // ── Restore via MCP ──
  const mcpUrl = optionalFlag(flags, 'mcp-url');
  const authEnv = optionalFlag(flags, 'auth-env');
  const creds = authEnv ? process.env[authEnv] : undefined;
  if (!mcpUrl || !creds) {
    process.stderr.write('Error: rollback restore needs --mcp-url <url> and --auth-env <ENV_VAR> (env holds "user:app-password"), or use --dry-run.\n');
    return 2;
  }

  const adapter = new McpAdapter({
    baseUrl: mcpUrl,
    authHeader: `Basic ${Buffer.from(creds).toString('base64')}`,
  });

  try {
    const res = await restorePageSnapshot(adapter, snapshot);
    if (!res.success) {
      process.stderr.write(`  ✗ rollback failed: ${res.error ?? 'unknown error'}\n`);
      return 1;
    }
    process.stdout.write(`  ✓ restored post ${res.postId}${res.editUrl ? ` (${res.editUrl})` : ''}\n\n`);
    return 0;
  } catch (err) {
    process.stderr.write(`Error: rollback restore failed: ${err instanceof Error ? err.message : err}\n`);
    return 1;
  }
}

import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { cmdRollback } from '../../../packages/cli/src/cmd-rollback.js';
import { writeSnapshotFile } from '@elconv/mcp';

const tmpDirs: string[] = [];
function freshDir(): string {
  const d = mkdtempSync(join(tmpdir(), 'elconv-rb-'));
  tmpDirs.push(d);
  return d;
}
afterAll(() => {
  for (const d of tmpDirs) rmSync(d, { recursive: true, force: true });
});

describe('cmdRollback', () => {
  beforeEach(() => {
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
  });

  it('returns 2 when neither --post-id nor --snapshot nor --list is given', async () => {
    const code = await cmdRollback({ 'snapshot-dir': freshDir() });
    expect(code).toBe(2);
  });

  it('--list on an empty directory returns 0', async () => {
    const code = await cmdRollback({ list: true, 'snapshot-dir': freshDir() });
    expect(code).toBe(0);
  });

  it('dry-run restore of the newest snapshot for a post returns 0 (no MCP)', async () => {
    const dir = freshDir();
    writeSnapshotFile(dir, { postId: 42, timestamp: '2026-07-30T10:00:00.000Z', content: [{ id: 'a' }] });
    const code = await cmdRollback({ 'post-id': '42', 'snapshot-dir': dir, 'dry-run': true });
    expect(code).toBe(0);
  });

  it('returns 1 when no snapshot exists for the requested post', async () => {
    const dir = freshDir();
    writeSnapshotFile(dir, { postId: 42, timestamp: '2026-07-30T10:00:00.000Z', content: [] });
    const code = await cmdRollback({ 'post-id': '999', 'snapshot-dir': dir });
    expect(code).toBe(1);
  });

  it('returns 2 for a real restore without --mcp-url/--auth-env', async () => {
    const dir = freshDir();
    writeSnapshotFile(dir, { postId: 42, timestamp: '2026-07-30T10:00:00.000Z', content: [{ id: 'a' }] });
    const code = await cmdRollback({ 'post-id': '42', 'snapshot-dir': dir });
    expect(code).toBe(2);
  });
});

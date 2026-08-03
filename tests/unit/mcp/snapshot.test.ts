import { describe, it, expect, afterAll } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  capturePageSnapshot,
  restorePageSnapshot,
  writeSnapshotFile,
  readSnapshotFile,
  listSnapshots,
  snapshotFileName,
  type PageSnapshot,
  type McpAdapter,
} from '@elconv/mcp';

function fakeAdapter(response: unknown): {
  adapter: McpAdapter;
  calls: Array<{ name: string; params: Record<string, unknown> }>;
} {
  const calls: Array<{ name: string; params: Record<string, unknown> }> = [];
  const adapter = {
    executeAbility: async (name: string, params: Record<string, unknown> = {}) => {
      calls.push({ name, params });
      return response;
    },
  } as unknown as McpAdapter;
  return { adapter, calls };
}

const tmpDirs: string[] = [];
function freshDir(): string {
  const d = mkdtempSync(join(tmpdir(), 'elconv-snap-'));
  tmpDirs.push(d);
  return d;
}
afterAll(() => {
  for (const d of tmpDirs) rmSync(d, { recursive: true, force: true });
});

describe('capturePageSnapshot', () => {
  it('requests a full dump and maps the live get-content response', async () => {
    const { adapter, calls } = fakeAdapter({
      success: true,
      post_id: 42,
      post_title: 'Home',
      template_type: 'wp-page',
      element_count: 7,
      content: [{ id: 'a', elType: 'container' }],
    });
    const snap = await capturePageSnapshot(adapter, 42);
    expect(calls).toEqual([
      { name: 'novamira/elementor-get-content', params: { post_id: 42, full_dump: true } },
    ]);
    expect(snap.postId).toBe(42);
    expect(snap.postTitle).toBe('Home');
    expect(snap.templateType).toBe('wp-page');
    expect(snap.elementCount).toBe(7);
    expect(snap.content).toHaveLength(1);
    expect(typeof snap.timestamp).toBe('string');
  });

  it('supports the data wrapper returned by legacy/live bridges', async () => {
    const { adapter } = fakeAdapter({
      data: {
        content: [{ id: 'wrapped', elType: 'section' }],
        element_count: 1,
      },
    });
    await expect(capturePageSnapshot(adapter, 5)).resolves.toMatchObject({
      postId: 5,
      content: [{ id: 'wrapped', elType: 'section' }],
      elementCount: 1,
    });
  });

  it('throws when the server reports failure', async () => {
    const { adapter } = fakeAdapter({ success: false, error: 'no such post' });
    await expect(capturePageSnapshot(adapter, 5)).rejects.toThrow(/no such post/);
  });
});

describe('restorePageSnapshot', () => {
  const snap: PageSnapshot = {
    postId: 42,
    timestamp: '2026-07-30T10:00:00.000Z',
    templateType: 'wp-page',
    content: [{ id: 'a', elType: 'container' }],
  };

  it('writes the snapshot content back via set-content with template_type', async () => {
    const { adapter, calls } = fakeAdapter({ success: true, post_id: 42, edit_url: 'https://x/edit' });
    const res = await restorePageSnapshot(adapter, snap);
    expect(calls[0]!.name).toBe('novamira/elementor-set-content');
    expect(calls[0]!.params).toEqual({
      post_id: 42,
      content: snap.content,
      template_type: 'wp-page',
    });
    expect(res.success).toBe(true);
    expect(res.editUrl).toBe('https://x/edit');
  });

  it('omits template_type when the snapshot has none', async () => {
    const { adapter, calls } = fakeAdapter({ success: true });
    await restorePageSnapshot(adapter, { postId: 9, timestamp: 't', content: [] });
    expect(calls[0]!.params).toEqual({ post_id: 9, content: [] });
  });
});

describe('snapshot file store', () => {
  it('snapshotFileName makes a filesystem-safe name', () => {
    expect(snapshotFileName(42, '2026-07-30T10:00:00.000Z')).toBe('post-42-2026-07-30T10-00-00-000Z.json');
  });

  it('round-trips a snapshot through write/read', () => {
    const dir = freshDir();
    const snap: PageSnapshot = {
      postId: 42,
      timestamp: '2026-07-30T10:00:00.000Z',
      content: [{ id: 'a' }],
    };
    const path = writeSnapshotFile(dir, snap);
    const back = readSnapshotFile(path);
    expect(back).toEqual(snap);
  });

  it('readSnapshotFile rejects a JSON file that is not a snapshot', () => {
    const dir = freshDir();
    const junk = join(dir, 'not-a-snapshot.json');
    writeFileSync(junk, JSON.stringify({ foo: 1 }), 'utf-8');
    expect(() => readSnapshotFile(junk)).toThrow(/valid snapshot/);
  });

  it('lists snapshots newest-first and filters by postId', () => {
    const dir = freshDir();
    writeSnapshotFile(dir, { postId: 42, timestamp: '2026-07-30T10:00:00.000Z', content: [] });
    writeSnapshotFile(dir, { postId: 42, timestamp: '2026-07-30T12:00:00.000Z', content: [] });
    writeSnapshotFile(dir, { postId: 7, timestamp: '2026-07-30T11:00:00.000Z', content: [] });

    const all = listSnapshots(dir);
    expect(all).toHaveLength(3);

    const forty2 = listSnapshots(dir, 42);
    expect(forty2).toHaveLength(2);
    // newest (12:00) before older (10:00)
    expect(forty2[0]!.stamp > forty2[1]!.stamp).toBe(true);
  });

  it('returns [] for a missing directory', () => {
    expect(listSnapshots(join(tmpdir(), 'definitely-not-there-elconv'))).toEqual([]);
  });
});

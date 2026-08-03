/**
 * WordPress page snapshot + rollback (Phase 110, BAUPLAN v4.0 item V3).
 *
 * Captures the CURRENT live Elementor content of a post as a restorable
 * JSON snapshot before a mutating operation, and restores it on rollback.
 *
 * Uses two live abilities (I/O verified against the server 2026-07-30):
 *   - novamira/elementor-get-content  (full_dump=true → complete element tree)
 *   - novamira/elementor-set-content  (writes the tree back, destructive)
 *
 * Note: the pre-existing cmd-deploy "backup" wrote the *incoming* tree, which
 * is useless for rollback — a real snapshot must capture the tree that is
 * about to be overwritten. That is what capturePageSnapshot does.
 */
import { readFileSync, writeFileSync, mkdirSync, readdirSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import type { McpAdapter } from './adapter.js';
import { unwrapMcpPayload } from './readback.js';

/** Default directory (relative to cwd) where snapshots are stored. */
export const SNAPSHOT_DIR = '.elconv-snapshots';

export interface PageSnapshot {
  postId: number;
  /** ISO-8601 capture time. */
  timestamp: string;
  postTitle?: string;
  templateType?: string;
  elementCount?: number;
  /** Full Elementor element tree (captured with full_dump=true). */
  content: unknown[];
}

interface GetContentRaw {
  success?: boolean;
  post_id?: number;
  post_title?: string;
  template_type?: string;
  element_count?: number;
  content?: unknown[];
  error?: string;
}

/**
 * Capture the current live Elementor content of a post as a restorable
 * snapshot. Requests a full dump so every widget's settings are preserved.
 */
export async function capturePageSnapshot(adapter: McpAdapter, postId: number): Promise<PageSnapshot> {
  const rawResponse = await adapter.executeAbility<GetContentRaw>('novamira/elementor-get-content', {
    post_id: postId,
    full_dump: true,
  });
  const res = unwrapMcpPayload<GetContentRaw>(rawResponse, 'content');
  if (!res || res.success === false) {
    throw new Error(`capturePageSnapshot(${postId}) failed: ${res?.error ?? 'MCP did not confirm success'}`);
  }
  if (!Array.isArray(res.content)) {
    throw new Error(`capturePageSnapshot(${postId}) returned no element tree`);
  }
  return {
    postId: res.post_id ?? postId,
    timestamp: new Date().toISOString(),
    postTitle: res.post_title,
    templateType: res.template_type,
    elementCount: res.element_count,
    content: res.content ?? [],
  };
}

interface SetContentRaw {
  success: boolean;
  post_id?: number;
  edit_url?: string;
  error?: string;
}

export interface RestoreResult {
  success: boolean;
  postId: number;
  editUrl?: string;
  error?: string;
}

/** Restore a previously-captured snapshot back onto its post (rollback). */
export async function restorePageSnapshot(
  adapter: McpAdapter,
  snapshot: PageSnapshot,
): Promise<RestoreResult> {
  const params: Record<string, unknown> = {
    post_id: snapshot.postId,
    content: snapshot.content,
  };
  if (snapshot.templateType) params.template_type = snapshot.templateType;

  const res = await adapter.executeAbility<SetContentRaw>('novamira/elementor-set-content', params);
  return {
    success: res.success,
    postId: res.post_id ?? snapshot.postId,
    editUrl: res.edit_url,
    error: res.error,
  };
}

// ── Local snapshot store (file-based, pure/testable) ────────────────────────

export interface SnapshotFileInfo {
  path: string;
  postId: number;
  /** Raw timestamp token parsed from the filename (colons/dots → dashes). */
  stamp: string;
}

/** Build a filesystem-safe snapshot filename: post-<id>-<iso-ish>.json */
export function snapshotFileName(postId: number, timestamp: string): string {
  const safe = timestamp.replace(/[:.]/g, '-');
  return `post-${postId}-${safe}.json`;
}

/** Write a snapshot to `dir` (created if missing); returns the absolute path. */
export function writeSnapshotFile(dir: string, snapshot: PageSnapshot): string {
  mkdirSync(dir, { recursive: true });
  const path = resolve(dir, snapshotFileName(snapshot.postId, snapshot.timestamp));
  writeFileSync(path, JSON.stringify(snapshot, null, 2), 'utf-8');
  return path;
}

/** Read and minimally validate a snapshot file. */
export function readSnapshotFile(path: string): PageSnapshot {
  const parsed = JSON.parse(readFileSync(resolve(path), 'utf-8')) as PageSnapshot;
  if (typeof parsed.postId !== 'number' || !Array.isArray(parsed.content)) {
    throw new Error(`Not a valid snapshot file: ${path}`);
  }
  return parsed;
}

/**
 * List snapshots in `dir`, newest first. Filenames embed an ISO-ish timestamp,
 * so a descending lexical sort is chronological. Optionally filter by postId.
 */
export function listSnapshots(dir: string, postId?: number): SnapshotFileInfo[] {
  if (!existsSync(dir)) return [];
  const out: SnapshotFileInfo[] = [];
  for (const f of readdirSync(dir)) {
    const m = /^post-(\d+)-(.+)\.json$/.exec(f);
    if (!m) continue;
    const pid = parseInt(m[1], 10);
    if (postId !== undefined && pid !== postId) continue;
    out.push({ path: resolve(dir, f), postId: pid, stamp: m[2] });
  }
  return out.sort((a, b) => (a.stamp < b.stamp ? 1 : a.stamp > b.stamp ? -1 : 0));
}

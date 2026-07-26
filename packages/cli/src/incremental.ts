/**
 * Incremental Build Mode (Phase 9B — BAUPLAN §4, Task 6)
 *
 * When the source site changes, only rebuild the changed sections.
 * Uses section content-hashes from diff-only.ts to identify what changed.
 * Writes an incremental-build.json with the list of sections to rebuild
 * plus their current state hashes.
 *
 * Pure filesystem + JSON — no MCP, no Playwright.
 */
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { loadExtractionResult, snapshotSections, type SectionSnapshot } from './diff-only.js';

export interface IncrementalBuildOptions {
  researchDir: string;
  url: string;
  postId?: number;
}

export interface IncrementalBuildReport {
  url: string;
  researchDir: string;
  postId?: number;
  timestamp: string;
  rebuildSections: string[];
  keepSections: string[];
  newSections: string[];
  removedSections: string[];
  skipped: boolean;
  reason?: string;
}

const PREVIOUS_HASHES_FILE = 'previous-sections.json';
const INCREMENTAL_BUILD_FILE = 'incremental-build.json';

export async function loadIncrementalState(
  researchDir: string,
): Promise<{ previousHashes: Record<string, string>; lastBuild?: IncrementalBuildReport }> {
  const prevPath = path.join(researchDir, PREVIOUS_HASHES_FILE);
  const lastPath = path.join(researchDir, INCREMENTAL_BUILD_FILE);
  let previousHashes: Record<string, string> = {};
  let lastBuild: IncrementalBuildReport | undefined;
  try {
    const raw = await fs.readFile(prevPath, 'utf8');
    const parsed = JSON.parse(raw) as Record<string, SectionSnapshot>;
    previousHashes = Object.fromEntries(
      Object.entries(parsed).map(([k, v]) => [k, v.contentHash]),
    );
  } catch {
    /* no previous hashes */
  }
  try {
    const raw = await fs.readFile(lastPath, 'utf8');
    lastBuild = JSON.parse(raw) as IncrementalBuildReport;
  } catch {
    /* no last build */
  }
  return { previousHashes, lastBuild };
}

export interface IncrementalDiff {
  rebuild: string[];
  keep: string[];
  newSections: string[];
  removed: string[];
  skipped: boolean;
  reason?: string;
}

export function diffForIncremental(
  previousHashes: Record<string, string>,
  currentHashes: Record<string, string>,
): IncrementalDiff {
  if (Object.keys(previousHashes).length === 0) {
    return {
      rebuild: [],
      keep: [],
      newSections: Object.keys(currentHashes),
      removed: [],
      skipped: true,
      reason: 'no previous build on disk — full build required',
    };
  }

  const rebuild: string[] = [];
  const keep: string[] = [];
  const newSections: string[] = [];

  for (const [id, hash] of Object.entries(currentHashes)) {
    if (!(id in previousHashes)) {
      newSections.push(id);
      rebuild.push(id);
    } else if (previousHashes[id] !== hash) {
      rebuild.push(id);
    } else {
      keep.push(id);
    }
  }

  const removed = Object.keys(previousHashes).filter((id) => !(id in currentHashes));

  if (rebuild.length === 0) {
    return {
      rebuild,
      keep,
      newSections,
      removed,
      skipped: true,
      reason: 'no changes detected — skipping build',
    };
  }

  return { rebuild, keep, newSections, removed, skipped: false };
}

export async function runIncremental(
  options: IncrementalBuildOptions,
): Promise<IncrementalBuildReport> {
  const extraction = await loadExtractionResult(options.researchDir);
  const currentSnapshots = snapshotSections(extraction);
  const currentHashes = Object.fromEntries(
    Object.entries(currentSnapshots).map(([k, v]) => [k, v.contentHash]),
  );

  const { previousHashes } = await loadIncrementalState(options.researchDir);
  const diff = diffForIncremental(previousHashes, currentHashes);

  const report: IncrementalBuildReport = {
    url: options.url,
    researchDir: options.researchDir,
    postId: options.postId,
    timestamp: new Date().toISOString(),
    rebuildSections: diff.rebuild,
    keepSections: diff.keep,
    newSections: diff.newSections,
    removedSections: diff.removed,
    skipped: diff.skipped,
    reason: diff.reason,
  };

  await fs.writeFile(
    path.join(options.researchDir, INCREMENTAL_BUILD_FILE),
    JSON.stringify(report, null, 2),
    'utf8',
  );

  return report;
}

export function formatIncrementalReport(report: IncrementalBuildReport): string {
  const lines: string[] = [];
  lines.push('=== Incremental Build Plan ===');
  lines.push(`URL:        ${report.url}`);
  lines.push(`Research:   ${report.researchDir}`);
  if (report.postId !== undefined) lines.push(`Post ID:    ${report.postId}`);
  lines.push(`Timestamp:  ${report.timestamp}`);
  lines.push('');
  if (report.skipped) {
    lines.push(`Status:     SKIPPED — ${report.reason ?? 'unknown reason'}`);
    return lines.join('\n');
  }
  lines.push(`Rebuild:    ${report.rebuildSections.length} section(s)`);
  for (const s of report.rebuildSections) lines.push(`  ↻ ${s}`);
  lines.push(`Keep:       ${report.keepSections.length} section(s)`);
  for (const s of report.keepSections) lines.push(`  = ${s}`);
  lines.push(`New:        ${report.newSections.length} section(s)`);
  for (const s of report.newSections) lines.push(`  + ${s}`);
  lines.push(`Removed:    ${report.removedSections.length} section(s)`);
  for (const s of report.removedSections) lines.push(`  - ${s}`);
  return lines.join('\n');
}

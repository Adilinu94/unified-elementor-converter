/**
 * Diff-Only Mode (Phase 9B — BAUPLAN §4, Task 5)
 *
 * Compares a previously-built V3 page (state.json + artifacts on disk) against the
 * current source extraction-result.json. Produces a structured diff (which sections
 * are new, modified, removed) WITHOUT rebuilding.
 *
 * Use-case: "has the source site changed since the last build?"
 * No MCP calls, no Playwright, no asset downloads — pure filesystem + JSON compare.
 */
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import type { ExtractionResult, SectionInfo } from '../extractor/types.js';

export interface SectionSnapshot {
  sectionId: string;
  selector?: string;
  tag?: string;
  /** MD5 hash of the section's serialised content (deep). */
  contentHash: string;
}

export interface DiffReport {
  url: string;
  researchDir: string;
  timestamp: string;
  current: {
    sectionCount: number;
    sectionHashes: Record<string, string>;
  };
  previous: {
    sectionCount: number;
    sectionHashes: Record<string, string>;
  };
  added: SectionSnapshot[];
  removed: SectionSnapshot[];
  modified: Array<{
    sectionId: string;
    previousHash: string;
    currentHash: string;
  }>;
  unchanged: string[];
}

export interface DiffOnlyOptions {
  researchDir: string;
  url: string;
}

function hashSectionContent(section: SectionInfo): string {
  const payload = JSON.stringify({
    selector: section.selector,
    layout: section.layout,
    child_count: section.child_count,
    tag: section.tag,
    id: section.id,
    classes: section.classes,
    y_range: section.y_range,
  });
  return createHash('md5').update(payload).digest('hex');
}

export async function loadExtractionResult(researchDir: string): Promise<ExtractionResult> {
  const extractionPath = path.join(researchDir, 'extraction-result.json');
  const raw = await fs.readFile(extractionPath, 'utf8');
  return JSON.parse(raw) as ExtractionResult;
}

export function snapshotSections(extraction: ExtractionResult): Record<string, SectionSnapshot> {
  const out: Record<string, SectionSnapshot> = {};
  for (const section of extraction.sections) {
    const id = section.section_id;
    out[id] = {
      sectionId: id,
      selector: section.selector,
      tag: section.tag,
      contentHash: hashSectionContent(section),
    };
  }
  return out;
}

export async function loadPreviousSnapshots(
  researchDir: string,
): Promise<Record<string, SectionSnapshot>> {
  const snapshotsPath = path.join(researchDir, 'previous-sections.json');
  try {
    const raw = await fs.readFile(snapshotsPath, 'utf8');
    return JSON.parse(raw) as Record<string, SectionSnapshot>;
  } catch {
    return {};
  }
}

export async function saveSnapshots(
  researchDir: string,
  snapshots: Record<string, SectionSnapshot>,
): Promise<string> {
  const out = path.join(researchDir, 'previous-sections.json');
  await fs.writeFile(out, JSON.stringify(snapshots, null, 2), 'utf8');
  return out;
}

export function computeDiff(
  previous: Record<string, SectionSnapshot>,
  current: Record<string, SectionSnapshot>,
): {
  added: SectionSnapshot[];
  removed: SectionSnapshot[];
  modified: Array<{ sectionId: string; previousHash: string; currentHash: string }>;
  unchanged: string[];
} {
  const added: SectionSnapshot[] = [];
  const removed: SectionSnapshot[] = [];
  const modified: Array<{ sectionId: string; previousHash: string; currentHash: string }> = [];
  const unchanged: string[] = [];

  for (const [id, snap] of Object.entries(current)) {
    if (!(id in previous)) {
      added.push(snap);
    } else if (previous[id].contentHash !== snap.contentHash) {
      modified.push({
        sectionId: id,
        previousHash: previous[id].contentHash,
        currentHash: snap.contentHash,
      });
    } else {
      unchanged.push(id);
    }
  }

  for (const [id, snap] of Object.entries(previous)) {
    if (!(id in current)) removed.push(snap);
  }

  return { added, removed, modified, unchanged };
}

export async function runDiffOnly(options: DiffOnlyOptions): Promise<DiffReport> {
  const extraction = await loadExtractionResult(options.researchDir);
  const current = snapshotSections(extraction);
  const previous = await loadPreviousSnapshots(options.researchDir);

  const { added, removed, modified, unchanged } = computeDiff(previous, current);

  return {
    url: options.url,
    researchDir: options.researchDir,
    timestamp: new Date().toISOString(),
    current: {
      sectionCount: Object.keys(current).length,
      sectionHashes: Object.fromEntries(Object.entries(current).map(([k, v]) => [k, v.contentHash])),
    },
    previous: {
      sectionCount: Object.keys(previous).length,
      sectionHashes: Object.fromEntries(Object.entries(previous).map(([k, v]) => [k, v.contentHash])),
    },
    added,
    removed,
    modified,
    unchanged,
  };
}

export function formatDiffReport(report: DiffReport): string {
  const lines: string[] = [];
  lines.push('=== Source-Change Diff (no build) ===');
  lines.push(`URL:        ${report.url}`);
  lines.push(`Research:   ${report.researchDir}`);
  lines.push(`Timestamp:  ${report.timestamp}`);
  lines.push('');
  lines.push(`Previous:   ${report.previous.sectionCount} section(s) on disk`);
  lines.push(`Current:    ${report.current.sectionCount} section(s) in extraction`);
  lines.push('');
  lines.push(`Added:      ${report.added.length}`);
  for (const a of report.added) lines.push(`  + ${a.sectionId} (${a.tag ?? a.selector ?? ''})`);
  lines.push(`Modified:   ${report.modified.length}`);
  for (const m of report.modified) {
    lines.push(`  ~ ${m.sectionId}  ${m.previousHash.slice(0, 8)} → ${m.currentHash.slice(0, 8)}`);
  }
  lines.push(`Removed:    ${report.removed.length}`);
  for (const r of report.removed) lines.push(`  - ${r.sectionId}`);
  lines.push(`Unchanged:  ${report.unchanged.length}`);
  for (const u of report.unchanged) lines.push(`  = ${u}`);
  return lines.join('\n');
}

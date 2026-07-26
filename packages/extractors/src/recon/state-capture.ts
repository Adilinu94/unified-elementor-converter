/**
 * recon/state-capture.ts
 *
 * State-Capture orchestrator (Phase 3 V2 §6).
 * Converts collected MutationObserver + animation-event records into
 * structured StateSnapshots, including before/after attribute values
 * and computed-style property diffs.
 */

import type {
  CapturedAnimationEvent,
} from './animation-events.js';
import type { MockElement, MockWindow, MutationRecord } from './mock-types.js';
import type {
  StateSnapshot,
  StyleBaseline,
  CaptureTrigger,
} from './types.js';

export interface BuildSnapshotInput {
  window: MockWindow;
  mutations: MutationRecord[];
  animationEvents: CapturedAnimationEvent[];
  baselineStyles: StyleBaseline[];
}

const GROUP_WINDOW_MS = 50;

function buildSelector(el: MockElement): string {
  if (el.id) return `#${el.id}`;
  if (el.className) {
    const cls = el.className.split(/\s+/)[0];
    if (cls) return `.${cls}`;
  }
  return el.tagName.toLowerCase();
}

/**
 * Collect baseline computed styles for the given selectors.
 */
export function collectBaselineStyles(
  win: MockWindow,
  selectors: string[],
): StyleBaseline[] {
  const out: StyleBaseline[] = [];
  const seen = new Set<string>();
  for (const sel of selectors) {
    if (seen.has(sel)) continue;
    seen.add(sel);
    const el = win.document.querySelector(sel);
    if (!el) continue;
    out.push({
      selector: sel,
      styles: el.getComputedStyle(),
      collectedAt: win.performance.now(),
    });
  }
  return out;
}

/**
 * Compute property-diff between baseline styles and the element's current styles.
 */
function computePropertyDiff(
  baseline: Record<string, string>,
  current: Record<string, string>,
): Record<string, { before: string; after: string }> | undefined {
  const diff: Record<string, { before: string; after: string }> = {};
  let count = 0;
  for (const key of Object.keys(current)) {
    const before = baseline[key];
    const after = current[key];
    if (before !== after) {
      diff[key] = { before: before ?? '', after: after ?? '' };
      count += 1;
    }
  }
  return count > 0 ? diff : undefined;
}

function mutationTrigger(record: MutationRecord): CaptureTrigger {
  return record.type === 'attributes' ? 'attribute' : 'child-list';
}

function animationTrigger(
  type: CapturedAnimationEvent['type'],
): CaptureTrigger {
  if (type === 'animationstart') return 'animation-start';
  if (type === 'animationend') return 'animation-end';
  if (type === 'transitionrun') return 'transition-run';
  if (type === 'transitionend') return 'transition-end';
  return 'time-based';
}

/**
 * Build StateSnapshots from collected mutations + animation events.
 *
 * Rules:
 * - Attribute mutations on the same element within GROUP_WINDOW_MS are
 *   grouped into a single `attribute-batch` snapshot.
 * - Standalone attribute mutations become `attribute` snapshots.
 * - childList mutations become `child-list` snapshots.
 * - Animation events become `animation-start` / `animation-end` / ...
 *   snapshots. For animationend, durationMs is computed from start time.
 */
export function buildStateSnapshots(input: BuildSnapshotInput): StateSnapshot[] {
  const { window: win, mutations, animationEvents, baselineStyles } = input;
  const snapshots: StateSnapshot[] = [];
  const baselineBySelector = new Map<string, StyleBaseline>();
  for (const b of baselineStyles) baselineBySelector.set(b.selector, b);

  // Group attribute mutations by selector
  const grouped = new Map<
    string,
    { records: MutationRecord[]; startTs: number }
  >();
  for (const record of mutations) {
    if (record.type !== 'attributes') continue;
    const sel = buildSelector(record.target);
    const g = grouped.get(sel);
    if (g && Math.abs(win.performance.now() - g.startTs) < GROUP_WINDOW_MS) {
      g.records.push(record);
    } else {
      grouped.set(sel, { records: [record], startTs: win.performance.now() });
    }
  }

  for (const [selector, group] of grouped) {
    const isBatch = group.records.length > 1;
    const attributesAfter: Record<string, string> = { ...group.records[0]!.target.attributes };
    const attributesBefore: Record<string, string> = {};
    for (const r of group.records) {
      if (r.attributeName) {
        if (r.oldValue !== undefined) {
          attributesBefore[r.attributeName] = r.oldValue;
        } else {
          attributesBefore[r.attributeName] = '';
        }
      }
    }
    const baseline = baselineBySelector.get(selector);
    const propertyDiff = baseline
      ? computePropertyDiff(baseline.styles, group.records[0]!.target.getComputedStyle())
      : undefined;
    snapshots.push({
      selector,
      trigger: isBatch ? 'attribute-batch' : mutationTrigger(group.records[0]!),
      timestamp: win.performance.now(),
      attributesBefore,
      attributesAfter,
      ...(propertyDiff ? { propertyDiff } : {}),
    });
  }

  // Non-attribute mutations → child-list
  for (const record of mutations) {
    if (record.type === 'attributes') continue;
    const sel = buildSelector(record.target);
    snapshots.push({
      selector: sel,
      trigger: 'child-list',
      timestamp: win.performance.now(),
      addedNodeCount: record.addedNodes?.length ?? 0,
      removedNodeCount: record.removedNodes?.length ?? 0,
    });
  }

  // Animation events
  const startTimes = new Map<string, number>();
  for (const ev of animationEvents) {
    const key = `${ev.selector}::${ev.animationName}`;
    if (ev.type === 'animationstart') {
      startTimes.set(key, ev.timestamp);
      snapshots.push({
        selector: ev.selector,
        trigger: animationTrigger(ev.type),
        timestamp: ev.timestamp,
        animationName: ev.animationName,
      });
    } else if (ev.type === 'animationend') {
      const startTs = startTimes.get(key);
      snapshots.push({
        selector: ev.selector,
        trigger: animationTrigger(ev.type),
        timestamp: ev.timestamp,
        animationName: ev.animationName,
        ...(startTs != null ? { durationMs: ev.timestamp - startTs } : {}),
      });
    } else {
      snapshots.push({
        selector: ev.selector,
        trigger: animationTrigger(ev.type),
        timestamp: ev.timestamp,
        animationName: ev.animationName || (ev.propertyName ?? ''),
      });
    }
  }

  return snapshots;
}

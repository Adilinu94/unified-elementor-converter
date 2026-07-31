/**
 * determineOutcome — Phase 114 (BAUPLAN v4.0 V6, Phase 93).
 *
 * Classifies a fix by comparing the geometry-probe quality signal before and
 * after applying it. `score` (0-100, higher is better) is the primary signal;
 * `failCount` breaks ties. A null "after" snapshot means the fix threw.
 */

import type { FixOutcome, ProbeSnapshot } from './fix-types.js';

export function determineOutcome(before: ProbeSnapshot, after: ProbeSnapshot | null): FixOutcome {
  if (!after) return 'error';
  // Fully clean afterwards → the issue is gone.
  if (after.failCount <= 0 || after.score >= 100) return 'resolved';
  if (after.score > before.score) return 'improved';
  if (after.score < before.score) return 'regressed';
  // Score unchanged → decide on the number of failing probes.
  if (after.failCount < before.failCount) return 'improved';
  if (after.failCount > before.failCount) return 'regressed';
  return 'no-change';
}

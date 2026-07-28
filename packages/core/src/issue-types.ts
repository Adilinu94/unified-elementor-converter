/**
 * Canonical QA issue taxonomy — single source of truth (point 8 of the
 * 10-item follow-up). Was independently defined three times:
 * core/src/ai/tasks/vision-qa.task.ts, qa/src/issue-detector.ts (IssueType),
 * and qa/src/strictness.ts (IssueSeverity) — all three used the exact same
 * string unions, just copy-pasted rather than shared. Lives in core because
 * qa already depends on core (not the reverse), so core is the only package
 * both sides can import from without a cycle.
 */

export type IssueType =
  | 'color-mismatch'
  | 'layout-shift'
  | 'font-missing'
  | 'size-mismatch'
  | 'image-broken'
  | 'animation-inactive'
  | 'blank-region'
  | 'size-different'
  | 'missing-texture';

export type IssueSeverity = 'low' | 'medium' | 'high';

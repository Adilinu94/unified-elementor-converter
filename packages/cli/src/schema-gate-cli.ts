/**
 * CLI wiring for the Elementor control-schema gate (work package P2).
 *
 * One helper shared by `convert`, `deploy`, `doctor` and `wizard` so all four
 * commands judge a tree by the same rules and print the same report. Two entry
 * points, one verdict shape: `runSchemaGateOffline` (snapshot only, used where
 * the pipeline must stay offline) and `runSchemaGateLive` (cache → live →
 * snapshot, used by `doctor --schema-check`).
 *
 * Scope: V3 only. The snapshot holds V3 widget controls; a V4 atomic tree uses
 * `$$type` settings and a different schema family, so applying this gate to V4
 * would manufacture false unknown-key findings. The V4 path keeps its own
 * `validate-v4-tree` server ability.
 */

import {
  collectSchemaKeys,
  formatSchemaGateReport,
  validateSettingsAgainstSchema,
  type SchemaGateElement,
  type SchemaGateReport,
  type ResolvedWidgetSchema,
} from '@elconv/core';
import {
  loadWidgetSchemaFromSnapshot,
  fetchWidgetSchema,
  type McpAdapter,
  type FetchWidgetSchemaOptions,
} from '@elconv/mcp';

export interface SchemaGateOutcome {
  /** True when the gate found no error-severity violation, or did not apply. */
  ok: boolean;
  /** Why the gate did not run, when it did not. */
  skipped?: 'target-v4' | 'no-schema';
  report?: SchemaGateReport;
  /** Where the schema came from — `snapshot` on every offline path. */
  source?: 'live' | 'cache' | 'snapshot';
  /** True when the schema could not back hard unknown-key verdicts. */
  degraded?: boolean;
  degradedReasons?: string[];
  /** Single-line summary suitable for a failure report field. */
  summary: string;
}

/**
 * Decide whether a gate outcome may be overridden, and say why not.
 *
 * `--skip-schema-gate` and `--force` are legitimate for a stale snapshot or a
 * judgement-call threshold. They are NOT legitimate for a control Elementor
 * stores and never renders: the user would see "deploy successful" and a page
 * with no animations, with no error anywhere to explain it. See
 * `isUnskippableViolation` for the exact class and the source evidence.
 *
 * Returns `null` when overriding is fine.
 */
export function overrideRefusal(outcome: SchemaGateOutcome): string | null {
  const count = outcome.report?.unskippableCount ?? 0;
  if (count === 0) return null;
  const keys = [...new Set(
    (outcome.report?.violations ?? [])
      .filter((violation) => violation.unskippable === true)
      .map((violation) => `${violation.widgetType}.${violation.key}`),
  )];
  return (
    `${count} finding(s) cannot be overridden — ${keys.slice(0, 5).join(', ')}` +
    `${keys.length > 5 ? `, +${keys.length - 5} more` : ''}. ` +
    'Elementor drops an animation, motion-fx or sticky control whose companion is missing ' +
    'without any error, so the deploy would report success and the effect would simply be absent. ' +
    'Fix the reported companion instead.'
  );
}

/**
 * Validate a V3 tree against the committed schema snapshot. Fully offline.
 *
 * Returns `ok: true` with `skipped` when the gate does not apply — a V4 target
 * or a missing snapshot must never fail a build for something it did not check.
 */
export function runSchemaGateOffline(
  tree: readonly unknown[],
  target: 'v3' | 'v4',
  options: { snapshotPath?: string } = {},
): SchemaGateOutcome {
  if (target !== 'v3') {
    return { ok: true, skipped: 'target-v4', summary: 'schema gate skipped (V4 uses the atomic schema)' };
  }

  const elements = tree as readonly SchemaGateElement[];
  const keys = collectSchemaKeys(elements);
  const resolved = loadWidgetSchemaFromSnapshot(keys, options.snapshotPath);
  return judge(elements, resolved);
}

/**
 * Same gate, but against the LIVE server schema (cache → live → snapshot).
 *
 * This is the authoritative form: only a live schema can turn an unrecognized
 * control id into a hard `unknown-key` error without risking a false positive
 * from a stale snapshot. Used by `elconv doctor --schema-check`.
 *
 * Never throws — a transport failure degrades to the snapshot and is reported
 * through `source`/`degraded`, so the caller can state what was actually checked.
 */
export async function runSchemaGateLive(
  tree: readonly unknown[],
  target: 'v3' | 'v4',
  adapter: McpAdapter,
  options: Pick<FetchWidgetSchemaOptions, 'snapshotPath' | 'forceRefresh' | 'cacheDir' | 'executeAbility'> = {},
): Promise<SchemaGateOutcome> {
  if (target !== 'v3') {
    return { ok: true, skipped: 'target-v4', summary: 'schema gate skipped (V4 uses the atomic schema)' };
  }

  const elements = tree as readonly SchemaGateElement[];
  const keys = collectSchemaKeys(elements);
  const resolved = await fetchWidgetSchema(adapter, keys, options);
  return judge(elements, resolved);
}

/** Shared verdict shaping so the offline and live paths cannot diverge. */
function judge(
  elements: readonly SchemaGateElement[],
  resolved: ResolvedWidgetSchema,
): SchemaGateOutcome {
  if (Object.keys(resolved.schema).length === 0) {
    return {
      ok: true,
      skipped: 'no-schema',
      source: resolved.source,
      degraded: true,
      degradedReasons: resolved.degradedReasons,
      summary: `schema gate not scored — ${resolved.degradedReasons.join('; ')}`,
    };
  }

  const report = validateSettingsAgainstSchema(elements, resolved.schema, {
    degraded: resolved.degraded,
  });
  return {
    ok: report.ok,
    report,
    source: resolved.source,
    degraded: resolved.degraded,
    degradedReasons: resolved.degradedReasons,
    summary: report.ok
      ? `schema gate passed (${report.settingsChecked} setting(s), ${report.warningCount} warning(s), source: ${resolved.source})`
      : `schema gate failed: ${report.errorCount} error(s) across ${report.elementsChecked} element(s)`,
  };
}

/** Write the outcome to stderr in the shape every command uses. */
export function printSchemaGateOutcome(outcome: SchemaGateOutcome): void {
  if (outcome.skipped !== undefined) {
    process.stderr.write(`Schema gate: ${outcome.summary}\n`);
    return;
  }
  if (outcome.report === undefined) return;

  if (!outcome.ok) {
    process.stderr.write(`${formatSchemaGateReport(outcome.report)}\n`);
    return;
  }
  process.stderr.write(`${outcome.summary}\n`);
  if (outcome.degraded === true && outcome.degradedReasons !== undefined) {
    for (const reason of outcome.degradedReasons) {
      process.stderr.write(`  ⚠ ${reason}\n`);
    }
  }
}

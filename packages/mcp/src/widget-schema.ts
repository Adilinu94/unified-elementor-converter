/**
 * Live Elementor control-schema retrieval with cache and committed-snapshot
 * fallback (work package P2).
 *
 * The server ability `novamira/elementor-get-schema` returns the authoritative
 * control set per widget type. `docs/NOVAMIRA-ABILITY-PLAYBOOK.md` §29 declared
 * it OPTIONAL because "validation runs server-side anyway" — that reasoning is
 * exactly backwards: server-side validation REJECTS the whole write and
 * persists nothing. Fetching the schema turns a deploy failure into a build
 * failure with a suggestion.
 *
 * Live-verified behaviour of the ability (2026-08-24, Elementor 4.2.1 + Pro
 * 4.1.0 on testseite.nick-webdesign.de):
 *  - `include_styles: true` WITHOUT narrowing returns the complete control set
 *    (content + style + advanced + responsive) — this is the only call shape
 *    that can back a hard `unknown-key` verdict.
 *  - Narrowing by `tab` or `section` alone returns `controls: []` (an ARRAY,
 *    not an object) for v3 widgets — a shape the parser must reject rather
 *    than read as "zero controls".
 *  - `section`, `column` and `container` are reported in `missing`; only
 *    `__container__` resolves for the flexbox container.
 *
 * See docs/BAUPLAN-v6.0-FRAMER-FIDELITY-2026-08.md §8.2.
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { homedir } from 'node:os';
import {
  CONTAINER_SCHEMA_KEY,
  type ResolvedWidgetSchema,
  type WidgetControlMap,
  type WidgetControlSchema,
  type WidgetSchemaEntry,
  type WidgetSchemaMap,
  type WidgetSchemaSource,
} from '@elconv/core';
import type { McpAdapter } from './adapter.js';

/** The ability that serves the schema. Must exist in the registry. */
export const SCHEMA_ABILITY = 'novamira/elementor-get-schema';

/** Default cache lifetime. A plugin update is the only thing that moves controls. */
export const DEFAULT_SCHEMA_TTL_HOURS = 24;

/** Committed offline fallback, relative to the repository root. */
export const SNAPSHOT_RELATIVE_PATH = 'schemas/elementor-v3-controls.snapshot.json';

/** Schema-snapshot artifact `$id`, matching the ability/wizard schema family. */
export const WIDGET_SCHEMA_SNAPSHOT_ID = 'elconv/elementor-v3-controls/v1';

/** Shape of the committed snapshot file. */
export interface WidgetSchemaSnapshotFile {
  schemaVersion: 1;
  $schema: typeof WIDGET_SCHEMA_SNAPSHOT_ID;
  /** Host the snapshot was captured from — provenance, not a runtime input. */
  capturedFrom: string;
  capturedAt: string;
  elementor: { version: string; pro?: string };
  /** Widget types the server reported as missing at capture time. */
  missing: string[];
  widgets: WidgetSchemaMap;
}

// ============================================================================
// Response parsing (defensive — the wrapper shape is not assumed)
// ============================================================================

export interface ParsedSchemaResponse {
  widgets: WidgetSchemaMap;
  missing: string[];
  /** False when no recognizable `widgets` object was found anywhere. */
  recognized: boolean;
}

/**
 * Read `{ widgets, missing }` out of a live payload.
 *
 * The response travels through two wrappers (`mcp-adapter-execute-ability` →
 * ability result), so the `widgets` object can sit at the root or under `data`.
 * Both are accepted; anything else reports `recognized: false` instead of
 * silently yielding an empty schema that would make the gate pass everything.
 *
 * @param complete Whether the request was made without narrowing, which decides
 *                 if entries may back a hard `unknown-key` verdict.
 */
export function parseSchemaResponse(payload: unknown, complete: boolean): ParsedSchemaResponse {
  const candidates: Record<string, unknown>[] = [];
  const pushIfObject = (v: unknown): void => {
    if (v !== null && typeof v === 'object' && !Array.isArray(v)) {
      candidates.push(v as Record<string, unknown>);
    }
  };
  pushIfObject(payload);
  if (payload !== null && typeof payload === 'object' && !Array.isArray(payload)) {
    const record = payload as Record<string, unknown>;
    pushIfObject(record.data);
    pushIfObject(record.result);
  }

  for (const candidate of candidates) {
    const raw = candidate.widgets;
    if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) continue;
    const widgets: WidgetSchemaMap = {};
    for (const [widgetType, value] of Object.entries(raw as Record<string, unknown>)) {
      const entry = parseWidgetEntry(widgetType, value, complete);
      if (entry !== null) widgets[widgetType] = entry;
    }
    const missing = Array.isArray(candidate.missing)
      ? (candidate.missing as unknown[]).filter((m): m is string => typeof m === 'string')
      : [];
    return { widgets, missing, recognized: true };
  }
  return { widgets: {}, missing: [], recognized: false };
}

function parseWidgetEntry(
  widgetType: string,
  value: unknown,
  complete: boolean,
): WidgetSchemaEntry | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const rawControls = record.controls;
  // A narrowed request yields `controls: []`. An empty array is NOT an empty
  // control set — it means the narrowing matched nothing, and treating it as
  // "this widget has no controls" would make every key look unknown.
  if (rawControls === null || typeof rawControls !== 'object' || Array.isArray(rawControls)) {
    return null;
  }
  const controls: WidgetControlMap = {};
  for (const [id, ctrl] of Object.entries(rawControls as Record<string, unknown>)) {
    const parsed = parseControl(ctrl);
    if (parsed !== null) controls[id] = parsed;
  }
  if (Object.keys(controls).length === 0) return null;
  return {
    widgetType: typeof record.widgetType === 'string' ? record.widgetType : widgetType,
    controls,
    complete,
  };
}

function parseControl(value: unknown): WidgetControlSchema | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (typeof record.t !== 'string') return null;

  const control: WidgetControlSchema = { t: record.t };
  if (Array.isArray(record.opts)) control.opts = record.opts as unknown[];
  if ('def' in record) control.def = record.def;
  if (record.if !== null && typeof record.if === 'object' && !Array.isArray(record.if)) {
    control.if = record.if as Record<string, unknown>;
  }
  if (record.r === 1) {
    control.r = 1;
  } else if (record.r !== null && typeof record.r === 'object' && !Array.isArray(record.r)) {
    const r = record.r as Record<string, unknown>;
    control.r = {
      ...(typeof r.min === 'string' ? { min: r.min } : {}),
      ...(typeof r.max === 'string' ? { max: r.max } : {}),
    };
  }
  if (record.arr === true) control.arr = true;
  if (typeof record.rv === 'string') control.rv = record.rv;
  if (record.fields !== null && typeof record.fields === 'object' && !Array.isArray(record.fields)) {
    const fields: WidgetControlMap = {};
    for (const [id, f] of Object.entries(record.fields as Record<string, unknown>)) {
      const parsed = parseControl(f);
      if (parsed !== null) fields[id] = parsed;
    }
    if (Object.keys(fields).length > 0) control.fields = fields;
  }
  return control;
}

// ============================================================================
// Cache
// ============================================================================

/** Cache directory for schema artifacts (Windows-safe: never a literal `~/`). */
export function defaultSchemaCacheDir(): string {
  return join(homedir(), '.clone-v3', 'cache', 'elementor-schema');
}

/** Deterministic cache filename per host. */
export function schemaCachePath(cacheDir: string, host: string): string {
  const safeHost = host.replace(/[^a-z0-9.-]/gi, '_').toLowerCase() || 'unknown-host';
  return join(cacheDir, `elementor-schema-${safeHost}.json`);
}

interface SchemaCacheFile {
  capturedAt: string;
  widgets: WidgetSchemaMap;
  missing: string[];
}

function readCache(path: string, ttlMs: number): SchemaCacheFile | null {
  if (!existsSync(path)) return null;
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as SchemaCacheFile;
    const age = Date.now() - Date.parse(parsed.capturedAt);
    if (!Number.isFinite(age) || age > ttlMs) return null;
    if (parsed.widgets === null || typeof parsed.widgets !== 'object') return null;
    return parsed;
  } catch {
    return null;
  }
}

function writeCache(path: string, file: SchemaCacheFile): void {
  try {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, JSON.stringify(file, null, 2), 'utf8');
  } catch {
    // A non-writable cache must never fail a build.
  }
}

// ============================================================================
// Snapshot
// ============================================================================

/** Read the committed snapshot; returns null when absent or unreadable. */
export function readWidgetSchemaSnapshot(path: string): WidgetSchemaSnapshotFile | null {
  if (!existsSync(path)) return null;
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as WidgetSchemaSnapshotFile;
    if (parsed.widgets === null || typeof parsed.widgets !== 'object') return null;
    return parsed;
  } catch {
    return null;
  }
}

// ============================================================================
// Public API
// ============================================================================

export interface FetchWidgetSchemaOptions {
  cacheDir?: string;
  ttlHours?: number;
  forceRefresh?: boolean;
  /** Host key for the cache file. Defaults to the adapter's base URL host. */
  host?: string;
  /** Path to the committed snapshot used when live and cache both fail. */
  snapshotPath?: string;
  /** Injectable transport so tests run fully offline. */
  executeAbility?: (
    adapter: McpAdapter,
    ability: string,
    params: Record<string, unknown>,
  ) => Promise<unknown>;
}

/**
 * Resolve the control schema for the given widget types.
 *
 * Order: fresh cache → live fetch → committed snapshot. The result always
 * reports its `source` and, when it cannot back hard verdicts, `degraded` with
 * the reasons — so `elconv doctor`/`deploy` can state the truth instead of
 * implying a verification that did not happen.
 *
 * Never throws: a live failure degrades to snapshot with a recorded reason.
 */
export async function fetchWidgetSchema(
  adapter: McpAdapter,
  widgetTypes: readonly string[],
  options: FetchWidgetSchemaOptions = {},
): Promise<ResolvedWidgetSchema> {
  const requested = normalizeWidgetTypes(widgetTypes);
  const cacheDir = options.cacheDir ?? defaultSchemaCacheDir();
  const ttlMs = (options.ttlHours ?? DEFAULT_SCHEMA_TTL_HOURS) * 3_600_000;
  const host = options.host ?? hostOf(adapter);
  const cachePath = schemaCachePath(cacheDir, host);
  const degradedReasons: string[] = [];

  if (options.forceRefresh !== true) {
    const cached = readCache(cachePath, ttlMs);
    if (cached !== null && coversAll(cached.widgets, requested)) {
      return finalize(cached.widgets, 'cache', requested, cached.missing, degradedReasons);
    }
  }

  let liveError: string | undefined;
  try {
    const execute =
      options.executeAbility ??
      ((a: McpAdapter, ability: string, params: Record<string, unknown>) =>
        a.executeAbility(ability, params));
    // `include_styles: true` WITHOUT control_names/tab/section is the only call
    // shape that returns the complete control set — see the module header.
    const payload = await execute(adapter, SCHEMA_ABILITY, {
      action: 'get',
      widget_types: [...requested],
      include_styles: true,
    });
    const parsed = parseSchemaResponse(payload, true);
    if (!parsed.recognized) {
      liveError = 'live payload contained no recognizable "widgets" object';
    } else {
      writeCache(cachePath, {
        capturedAt: new Date().toISOString(),
        widgets: parsed.widgets,
        missing: parsed.missing,
      });
      return finalize(parsed.widgets, 'live', requested, parsed.missing, degradedReasons);
    }
  } catch (err) {
    liveError = err instanceof Error ? err.message : String(err);
  }

  degradedReasons.push(`live schema fetch failed: ${liveError ?? 'unknown error'}`);
  const snapshotPath = options.snapshotPath ?? defaultSnapshotPath();
  const snapshot = readWidgetSchemaSnapshot(snapshotPath);
  if (snapshot === null) {
    degradedReasons.push(`no committed snapshot at ${snapshotPath}`);
    return { schema: {}, source: 'snapshot', degraded: true, degradedReasons };
  }
  degradedReasons.push(
    `using committed snapshot captured ${snapshot.capturedAt} from ${snapshot.capturedFrom} ` +
      `(Elementor ${snapshot.elementor.version}) — control ids may have moved since`,
  );
  return finalize(snapshot.widgets, 'snapshot', requested, snapshot.missing, degradedReasons);
}

/**
 * Resolve the schema without any transport — snapshot only.
 * Used by `elconv convert`, which must stay offline-capable.
 */
export function loadWidgetSchemaFromSnapshot(
  widgetTypes: readonly string[],
  snapshotPath?: string,
): ResolvedWidgetSchema {
  const requested = normalizeWidgetTypes(widgetTypes);
  const path = snapshotPath ?? defaultSnapshotPath();
  const snapshot = readWidgetSchemaSnapshot(path);
  if (snapshot === null) {
    return {
      schema: {},
      source: 'snapshot',
      degraded: true,
      degradedReasons: [`no committed schema snapshot at ${path}`],
    };
  }
  return finalize(snapshot.widgets, 'snapshot', requested, snapshot.missing, [
    `offline validation against the committed snapshot captured ${snapshot.capturedAt} ` +
      `(Elementor ${snapshot.elementor.version}); run "elconv doctor --schema-check --mcp-url …" to verify live`,
  ]);
}

function finalize(
  widgets: WidgetSchemaMap,
  source: WidgetSchemaSource,
  requested: readonly string[],
  missing: readonly string[],
  reasons: string[],
): ResolvedWidgetSchema {
  const schema: WidgetSchemaMap = {};
  const notCovered: string[] = [];
  for (const type of requested) {
    const entry = widgets[type];
    if (entry === undefined) {
      // A type the server itself reports as missing is a known Elementor fact,
      // not a retrieval gap — it must not be blamed on the schema source.
      if (!missing.includes(type)) notCovered.push(type);
      continue;
    }
    schema[type] = entry;
  }
  if (notCovered.length > 0) {
    reasons.push(`schema has no entry for: ${notCovered.sort().join(', ')}`);
  }
  const incomplete = Object.values(schema)
    .filter((e) => !e.complete)
    .map((e) => e.widgetType);
  if (incomplete.length > 0) {
    reasons.push(`incomplete control set for: ${incomplete.sort().join(', ')}`);
  }
  return { schema, source, degraded: reasons.length > 0, degradedReasons: reasons };
}

function coversAll(widgets: WidgetSchemaMap, requested: readonly string[]): boolean {
  return requested.every((type) => widgets[type] !== undefined);
}

function normalizeWidgetTypes(widgetTypes: readonly string[]): string[] {
  const set = new Set(widgetTypes.filter((t) => t.length > 0));
  // The container element is needed by virtually every tree; request it always
  // so a caller cannot accidentally validate widgets while skipping layout.
  set.add(CONTAINER_SCHEMA_KEY);
  return [...set].sort();
}

function hostOf(adapter: McpAdapter): string {
  const baseUrl = (adapter as unknown as { options?: { baseUrl?: string } }).options?.baseUrl;
  if (typeof baseUrl !== 'string') return 'unknown-host';
  try {
    return new URL(baseUrl).host;
  } catch {
    return 'unknown-host';
  }
}

/**
 * Locate the committed snapshot from this module's own location.
 * Works both from `src` (vitest alias) and `dist` (built output).
 */
export function defaultSnapshotPath(): string {
  const here = dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
  // packages/mcp/src → repo root is three levels up; dist has the same depth.
  return join(here, '..', '..', '..', SNAPSHOT_RELATIVE_PATH);
}

/**
 * WPCode Safe-Interaction-Layer (Phase 60).
 *
 * Encapsulates ALL WPCode interactions with correct settings, preventing
 * the 5 known failure modes discovered during Oral Care build:
 * 1. Wrong location slug (site_footer vs site_wide_footer)
 * 2. Priority field (private property crash)
 * 3. kses stripping inline <script>
 * 4. bypass_kses conflict
 * 5. Missing dual-write (post_content + wpcode_snippets option)
 *
 * @module core/wpcode-helper
 */

import type { WpcodeLocation, WpcodeSnippetSpec } from './wpcode.js';
import { WPCODE_SAFE_COMBINATIONS } from './wpcode.js';

// ============================================================================
// Location mapping (friendly → WPCode taxonomy slug)
// ============================================================================

const LOCATION_MAP: Record<WpcodeLocation, string> = {
  header: 'site_wide_header',
  footer: 'site_wide_footer',
  body: 'site_wide_body',
};

/** Map a friendly location to the actual WPCode taxonomy slug. */
export function resolveLocation(location: WpcodeLocation): string {
  return LOCATION_MAP[location];
}

// ============================================================================
// Validation
// ============================================================================

export interface WpcodeValidationIssue {
  field: string;
  severity: 'error' | 'warning';
  message: string;
  fix?: string;
}

export interface WpcodeValidationResult {
  valid: boolean;
  issues: WpcodeValidationIssue[];
}

/**
 * Validate a snippet spec BEFORE sending to WPCode.
 * Catches all 5 known pitfalls proactively.
 */
export function validateSnippet(spec: WpcodeSnippetSpec): WpcodeValidationResult {
  const issues: WpcodeValidationIssue[] = [];

  // Check location safety
  const combo = WPCODE_SAFE_COMBINATIONS[spec.type]?.[spec.location];
  if (combo && !combo.safe) {
    issues.push({
      field: 'location',
      severity: 'error',
      message: `Combination type:${spec.type} + location:${spec.location} is NOT safe. ${combo.notes}`,
      fix: spec.type === 'js'
        ? "Use type:'html' with inline <script> and location:'footer' instead."
        : "Use location:'header' or 'footer'.",
    });
  }

  // Check for inline scripts in non-html type
  if (spec.type === 'js' && spec.code.includes('<script')) {
    issues.push({
      field: 'type',
      severity: 'warning',
      message: 'Inline <script> tags in code_type:js may not load reliably.',
      fix: "Use type:'html' with location:'footer' for inline scripts.",
    });
  }

  // Check for kses-sensitive content in header
  if (spec.location === 'header' && spec.type === 'html' && spec.code.includes('<script')) {
    issues.push({
      field: 'location',
      severity: 'warning',
      message: 'Inline <script> in header may be stripped by kses on some configurations.',
      fix: "Move scripts to location:'footer' (site_wide_footer preserves inline scripts).",
    });
  }

  // Check title
  if (!spec.title || spec.title.trim().length === 0) {
    issues.push({ field: 'title', severity: 'error', message: 'Snippet title is required.' });
  }

  // Check code
  if (!spec.code || spec.code.trim().length === 0) {
    issues.push({ field: 'code', severity: 'error', message: 'Snippet code is required.' });
  }

  return { valid: issues.every((i) => i.severity !== 'error'), issues };
}

// ============================================================================
// Safe snippet builder
// ============================================================================

export interface SafeWpcodePayload {
  /** Snippet title. */
  title: string;
  /** The code content (CSS, HTML, or JS). */
  code: string;
  /** WPCode code_type — mapped to safe value. */
  code_type: 'css' | 'html';
  /** WPCode location taxonomy slug — always site_wide_*. */
  location: string;
  /**
   * Whether the snippet should be active on save.
   *
   * This is the ONLY activation field in the live input schema (verified
   * against `novamira-adrianv2/create-wpcode-snippet`, Default: false).
   * `status` is OUTPUT-only — sending it was a silent no-op that left every
   * snippet as an invisible draft.
   */
  active: boolean;
  /**
   * Whether WPCode auto-inserts at `location`.
   *
   * Live schema: "`location` … only meaningful when `auto_insert=true`".
   * Without it the snippet is treated as shortcode-only and never emitted.
   */
  auto_insert: boolean;
  /** Tags for organization. */
  tags: string[];
  /** Optional build id appended as `?v=` to CDN URLs (cache invalidation). */
  cache_bust_token?: string;
  /** NOTE: priority is intentionally OMITTED (private property crash). */
}

/**
 * Fields the live input schema does NOT accept. Sending them is either a
 * silent no-op (`status`) or a hard crash (`priority`).
 */
export const WPCODE_FORBIDDEN_PAYLOAD_FIELDS: readonly string[] = [
  // OUTPUT-only. The input field is `active: boolean`.
  'status',
  // "Cannot access private property WPCode_Snippet::$priority"
  'priority',
];

/**
 * Assert a payload carries nothing the live input schema rejects.
 * Used by the payload regression test and by callers building raw params.
 */
export function assertWpcodePayloadShape(payload: Record<string, unknown>): void {
  const offenders = WPCODE_FORBIDDEN_PAYLOAD_FIELDS.filter((f) =>
    Object.prototype.hasOwnProperty.call(payload, f),
  );
  if (offenders.length > 0) {
    throw new Error(
      `WPCode payload carries fields the live input schema rejects: ${offenders.join(', ')}. ` +
        `Use \`active: boolean\` instead of \`status\`; never send \`priority\`.`,
    );
  }
}

/**
 * Build a safe WPCode payload from a spec.
 * Applies all known workarounds automatically:
 * - Maps location to correct taxonomy slug
 * - Omits priority field
 * - Converts js → html for inline scripts (kses workaround)
 * - Applies page guard
 * - Sends `active` (schema field) and `auto_insert` (required for `location`)
 */
export function buildSafePayload(spec: WpcodeSnippetSpec): SafeWpcodePayload {
  let codeType: 'css' | 'html' = spec.type === 'css' ? 'css' : 'html';
  let code = spec.code;

  // kses workaround: js with inline script → html type
  if (spec.type === 'js') {
    codeType = 'html';
    if (!code.includes('<script')) {
      code = `<script>\n${code}\n</script>`;
    }
  }

  // Apply page guard
  if (spec.pageId) {
    code = applyPageGuardSafe(code, spec.pageId, codeType);
  }

  const payload: SafeWpcodePayload = {
    title: spec.title,
    code,
    code_type: codeType,
    location: resolveLocation(spec.location),
    active: spec.active !== false,
    // `location` is inert without this — see WPCODE_PITFALLS.
    auto_insert: spec.autoInsert !== false,
    tags: spec.tags ?? ['elconv'],
    // priority: INTENTIONALLY OMITTED
    // status: INTENTIONALLY OMITTED (output-only field)
  };
  if (spec.cacheBustToken) payload.cache_bust_token = spec.cacheBustToken;
  return payload;
}

// ============================================================================
// Read-back verification
// ============================================================================

/** Shape of the create/update response fields we verify against. */
export interface WpcodeWriteResponse {
  snippet_id?: number;
  active?: boolean;
  status?: string;
  auto_insert?: boolean;
  last_error?: unknown;
}

export interface WpcodeReadBackResult {
  ok: boolean;
  snippetId?: number;
  /** Human-readable reasons the write did not do what was asked. */
  problems: string[];
}

/**
 * Compare what was requested against what WPCode actually stored.
 *
 * WPCode runs activation checks on save and silently auto-demotes a snippet
 * to draft when they fail, reporting it only in `last_error`. A raw MCP
 * success is therefore NOT proof the snippet is live — this closes the
 * "write succeeded, nothing visible" failure class.
 */
export function verifyWpcodeWrite(
  requested: SafeWpcodePayload,
  response: WpcodeWriteResponse,
): WpcodeReadBackResult {
  const problems: string[] = [];

  if (requested.active && response.active === false) {
    problems.push(
      'requested active:true but WPCode stored active:false (auto-demoted to draft — check last_error)',
    );
  }
  if (requested.active && response.status !== undefined && response.status !== 'publish') {
    problems.push(`expected status "publish" for an active snippet, got "${response.status}"`);
  }
  if (requested.auto_insert && response.auto_insert === false) {
    problems.push(
      `requested auto_insert:true for location "${requested.location}" but WPCode stored auto_insert:false ` +
        '(the snippet is shortcode-only and will never be emitted)',
    );
  }
  if (response.last_error !== undefined && response.last_error !== null) {
    problems.push(`WPCode reported last_error: ${JSON.stringify(response.last_error)}`);
  }

  return { ok: problems.length === 0, snippetId: response.snippet_id, problems };
}

/**
 * Apply page-scoped guard to code.
 * CSS: wraps selectors with body.page-id-N
 * JS/HTML: adds early-return guard
 */
function applyPageGuardSafe(code: string, pageId: number, type: 'css' | 'html'): string {
  if (type === 'css') {
    // CSS nesting: the rules in `code` are genuinely scoped as descendants
    // of body.page-id-N (native nesting, broadly supported). Previously this
    // emitted an empty `body.page-id-N { }` block followed by `code`
    // completely unscoped — the guard was a visual no-op.
    return `body.page-id-${pageId} {\n${code}\n}`;
  }
  // HTML/JS: add guard at top of script
  if (code.includes('<script')) {
    return code.replace(
      /<script([^>]*)>/,
      `<script$1>\nif(!document.body.classList.contains('page-id-${pageId}'))throw new Error('skip');`,
    );
  }
  return `if(!document.body.classList.contains('page-id-${pageId}'))return;\n${code}`;
}

// ============================================================================
// Dual-Write support
// ============================================================================

export interface DualWriteResult {
  snippetId: number;
  postContentUpdated: boolean;
  optionSynced: boolean;
}

/** The canonical live ability name. `novamira-adrianv2/execute-php` does not exist. */
const EXECUTE_PHP_ABILITY = 'novamira/execute-php';

/**
 * Generate the MCP call sequence for a dual-write snippet operation.
 *
 * Dual-write exists because updating only the post row leaves WPCode's
 * compiled asset cache stale — the live site keeps serving the old CSS/JS.
 *
 * The previous implementation hand-rolled `update_option('wpcode_snippets')`
 * PHP with `payload.title` interpolated into the source via a single
 * `replace(/'/g, "\\'")` — an injection surface for any title coming from a
 * Framer project name, and it had no caller and no test.
 *
 * The live update schema offers the supported equivalent: `bypass_kses: true`
 * routes through `WPCode_Kses_Bypass::edit_post`, described as "post row +
 * compiled-asset cache purge". In that mode ONLY `snippet_id`, `title` and
 * `code` are honoured — every meta field is rejected. Hence two calls:
 *
 *   1. normal update  → meta (code_type, location, auto_insert, active, tags)
 *   2. bypass_kses    → post row + cache purge, raw bytes preserved
 */
export function buildDualWriteCalls(
  snippetId: number,
  payload: SafeWpcodePayload,
): Array<{ ability: string; params: Record<string, unknown> }> {
  return [
    {
      ability: 'novamira-adrianv2/update-wpcode-snippet',
      params: { snippet_id: snippetId, ...payload },
    },
    {
      // bypass_kses mode rejects meta fields — send only what it honours.
      ability: 'novamira-adrianv2/update-wpcode-snippet',
      params: {
        snippet_id: snippetId,
        bypass_kses: true,
        title: payload.title,
        code: payload.code,
      },
    },
  ];
}

/**
 * Generate the MCP call sequence for creating a new snippet with dual-write.
 */
export function buildCreateCalls(
  payload: SafeWpcodePayload,
): Array<{ ability: string; params: Record<string, unknown> }> {
  return [
    {
      ability: 'novamira-adrianv2/create-wpcode-snippet',
      params: { ...payload },
    },
  ];
}

/**
 * Build the cache-flush call to run after a snippet write.
 *
 * Uses the canonical ability name. Five call sites used to send
 * `novamira-adrianv2/execute-php`, which the live server does not expose —
 * the registry alias silently rewrote it, hiding the drift.
 */
export function buildWpcodeCacheFlushCall(): { ability: string; params: Record<string, unknown> } {
  return {
    ability: EXECUTE_PHP_ABILITY,
    params: {
      code: [
        `if (function_exists('wp_cache_flush')) wp_cache_flush();`,
        `return ['flushed' => true];`,
      ].join('\n'),
      description: 'Flush object cache after a WPCode snippet write',
    },
  };
}

// ============================================================================
// Convenience builders
// ============================================================================

/** Build a page-scoped CSS snippet spec. */
export function cssSnippet(title: string, css: string, pageId?: number): WpcodeSnippetSpec {
  return { title, code: css, type: 'css', location: 'header', pageId, active: true, tags: ['elconv', 'css'] };
}

/** Build a page-scoped JS snippet spec (auto-converted to html type for kses safety). */
export function jsSnippet(title: string, js: string, pageId?: number): WpcodeSnippetSpec {
  return { title, code: js, type: 'js', location: 'footer', pageId, active: true, tags: ['elconv', 'js'] };
}

/** Build a font-link HTML snippet spec. */
export function fontLinkSnippet(fonts: string[], title = 'Elconv Google Fonts'): WpcodeSnippetSpec {
  const links = fonts
    .map((f) => `<link rel="preconnect" href="https://fonts.googleapis.com">\n<link href="${f}" rel="stylesheet">`)
    .join('\n');
  return { title, code: links, type: 'html', location: 'header', active: true, tags: ['elconv', 'fonts'] };
}

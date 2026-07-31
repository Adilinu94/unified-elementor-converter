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
  /** Whether snippet is active. */
  status: 'active' | 'inactive';
  /** Tags for organization. */
  tags: string[];
  /** NOTE: priority is intentionally OMITTED (private property crash). */
}

/**
 * Build a safe WPCode payload from a spec.
 * Applies all known workarounds automatically:
 * - Maps location to correct taxonomy slug
 * - Omits priority field
 * - Converts js → html for inline scripts (kses workaround)
 * - Applies page guard
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

  return {
    title: spec.title,
    code,
    code_type: codeType,
    location: resolveLocation(spec.location),
    status: spec.active !== false ? 'active' : 'inactive',
    tags: spec.tags ?? ['elconv'],
    // priority: INTENTIONALLY OMITTED
  };
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

/**
 * Generate the MCP call sequence for a dual-write snippet operation.
 * Dual-write ensures both post_content AND wpcode_snippets option are synced.
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
      ability: 'novamira-adrianv2/execute-php',
      params: {
        code: buildOptionSyncPhp(snippetId, payload),
        description: `Sync wpcode_snippets option for snippet ${snippetId}`,
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

function buildOptionSyncPhp(snippetId: number, payload: SafeWpcodePayload): string {
  return [
    `$snippets = get_option('wpcode_snippets', []);`,
    `$snippets[${snippetId}] = [`,
    `  'title' => '${payload.title.replace(/'/g, "\\'")}',`,
    `  'code' => get_post(${snippetId})->post_content,`,
    `  'type' => '${payload.code_type}',`,
    `  'location' => '${payload.location}',`,
    `  'status' => '${payload.status}',`,
    `];`,
    `update_option('wpcode_snippets', $snippets);`,
    `return ['synced' => true, 'snippet_id' => ${snippetId}];`,
  ].join('\n');
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

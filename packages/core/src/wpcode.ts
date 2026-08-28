/**
 * WPCode shared types and utilities (version-agnostic).
 *
 * Contains the safe-combinations table, pitfalls registry, and shared
 * snippet formatting used by both target-v3 and target-v4.
 * Ported from site-clone-to-v3/src/builder/wpcode-helper.ts
 */

export type WpcodeLocation = 'header' | 'footer' | 'body';
export type WpcodeType = 'css' | 'html' | 'js' | 'php' | 'universal';

export interface WpCodeSnippet {
  title: string;
  type: 'php' | 'css' | 'js';
  code: string;
  location: 'header' | 'footer' | 'functions';
  priority: number;
  tags: string[];
}

export interface WpcodeSnippetSpec {
  title: string;
  code: string;
  type: WpcodeType;
  location: WpcodeLocation;
  /** Page ID for the body.page-id-N guard (JS) or selector scoping (CSS). */
  pageId?: number;
  active?: boolean;
  tags?: string[];
  /**
   * Whether WPCode should auto-insert the snippet at `location`.
   *
   * The live input schema states `location` is "only meaningful when
   * auto_insert=true". Omitting it makes the snippet a shortcode-only
   * snippet that is never emitted — a silent no-op. Defaults to true.
   */
  autoInsert?: boolean;
  /**
   * Build id / semver appended as `?v={token}` to CDN URLs in the code.
   * Live-schema field `cache_bust_token`. Use after a versioned deploy so
   * browsers do not serve a stale GSAP/Lenis bundle.
   */
  cacheBustToken?: string;
}

export interface WpcodeSnippetRecord {
  snippet_id: number;
  title: string;
  location: WpcodeLocation;
  type: WpcodeType;
  active: boolean;
}

// ============================================================================
// WPCODE SAFE-COMBINATIONS TABLE (authoritative — single source of truth)
// ============================================================================

export const WPCODE_SAFE_COMBINATIONS: Record<
  WpcodeType,
  Record<WpcodeLocation, { safe: boolean; notes: string }>
> = {
  css: {
    header: { safe: true, notes: 'site_wide_header — standard CSS injection' },
    footer: { safe: true, notes: 'site_wide_footer — standard CSS injection' },
    body: { safe: true, notes: 'site_wide_body' },
  },
  html: {
    header: {
      safe: true,
      notes: 'site_wide_header — Google Fonts <link> + <style> blocks. WORKS.',
    },
    footer: {
      safe: true,
      notes: 'site_wide_footer — inline <script> PRESERVED at this location+type combo. CDN <script src> also works.',
    },
    body: { safe: true, notes: 'site_wide_body' },
  },
  js: {
    header: { safe: false, notes: 'JS in header blocks rendering — avoid' },
    footer: {
      safe: true,
      notes: 'site_wide_footer — but inline <script> in code_type:html is MORE RELIABLE than code_type:js. Prefer html for GSAP init.',
    },
    body: { safe: false, notes: 'avoid' },
  },
  php: {
    header: { safe: false, notes: 'use novamira/execute-php instead' },
    footer: { safe: false, notes: 'use novamira/execute-php instead' },
    body: { safe: false, notes: 'use novamira/execute-php instead' },
  },
  universal: {
    header: { safe: true, notes: '' },
    footer: { safe: true, notes: '' },
    body: { safe: true, notes: '' },
  },
};

// ============================================================================
// KNOWN PITFALLS (do not reproduce)
// ============================================================================

export const WPCODE_PITFALLS = [
  {
    pitfall: 'priority field',
    symptom: 'Cannot access private property WPCode_Snippet::$priority',
    fix: 'Omit the priority field entirely from create-wpcode-snippet params.',
  },
  {
    pitfall: "location 'site_footer'",
    symptom: 'Snippet created + active but NOT injected into page HTML',
    fix: "Use 'site_wide_footer' (not 'site_footer'). The taxonomy slugs are site_wide_header / site_wide_footer / site_wide_body.",
  },
  {
    pitfall: 'kses strips inline <script>',
    symptom: 'CDN <script src> renders but inline <script>code</script> is removed',
    fix: "Use code_type:'html' + location:'site_wide_footer' — this combo preserves inline scripts. code_type:'js' uses a different injection path that may not load.",
  },
  {
    pitfall: 'bypass_kses:true on create',
    symptom: 'Post X is a wpcode, not a wpcode_snippet',
    fix: "Do not use bypass_kses when creating. Use the html+site_wide_footer combo instead. On UPDATE the live schema does support bypass_kses, but only snippet_id/title/code are honoured — meta fields (code_type, location, tags, active) are rejected in that mode.",
  },
  {
    pitfall: "sending status:'active'",
    symptom: 'Snippet is created but stays a draft and never renders',
    fix: "`status` is an OUTPUT-only field. The input schema field is `active: boolean` (Default: false). Send `active: true`, then read back `status === 'publish'`.",
  },
  {
    pitfall: 'auto_insert omitted',
    symptom: 'Snippet is active but never injected, despite a correct location',
    fix: "Per the live schema, `location` is only meaningful when `auto_insert: true`. Without it WPCode treats the snippet as shortcode-only.",
  },
  {
    pitfall: 'trusting the create response',
    symptom: 'Deploy reports success; the page has no CSS/JS',
    fix: "WPCode auto-demotes to draft when activation checks fail and reports it in `last_error`. Compare the requested `active` against the returned `active`/`status` and fail loudly on a mismatch.",
  },
  {
    pitfall: 'dual-write not done',
    symptom: 'Snippet post_content updated but live site shows old CSS/JS',
    fix: 'Prefer `update-wpcode-snippet` with `bypass_kses: true` — per the live schema that path purges the compiled-asset cache. Hand-rolled update_option PHP is a last resort.',
  },
] as const;

// ============================================================================
// Shared formatting utilities
// ============================================================================

/**
 * Format snippet for WPCode plugin import (JSON).
 */
export function formatForWpCodeImport(snippets: WpCodeSnippet[]): string {
  return JSON.stringify(
    snippets.map((s) => ({
      title: s.title,
      code: s.code,
      type: s.type === 'css' ? 'add_css_snippet' : s.type === 'js' ? 'add_js_snippet' : 'add_php_snippet',
      location: s.location === 'header' ? 'wp_head' : s.location === 'footer' ? 'wp_footer' : 'functions_file',
      priority: s.priority,
      tags: s.tags,
      status: 'active',
    })),
    null,
    2,
  );
}

/**
 * Generate custom CSS snippet for design tokens not supported by Elementor.
 */
export function generateCustomCssSnippet(
  cssRules: Record<string, string>,
  title = 'Elconv Custom Styles',
): WpCodeSnippet {
  const code = Object.entries(cssRules)
    .map(([selector, props]) => `${selector} {\n${props}\n}`)
    .join('\n\n');

  return {
    title,
    type: 'css',
    code,
    location: 'header',
    priority: 25,
    tags: ['elconv', 'custom-css', 'elementor'],
  };
}

/**
 * Apply a body.page-id-N guard to JS, or scope CSS selectors.
 */
export function applyPageGuard(code: string, pageId: number | undefined, type: WpcodeType): string {
  if (!pageId) return code;
  if (type === 'js') {
    return `if(!document.body.classList.contains('page-id-${pageId}'))return;\n${code}`;
  }
  return code;
}

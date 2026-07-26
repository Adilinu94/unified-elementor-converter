/**
 * WPCode-Lite CPT-Adapter (verifiziert auf test4.nick-webdesign.de, WPCode v2.3.6).
 *
 * Erkenntnisse aus Phase 0.1 (live-verified 2026-06-16):
 *   - CPT-Slug ist `wpcode` (nicht `wpcode_snippet` wie in der WPCode-Doku suggeriert)
 *   - Lite-Version: keine WPCode-Block-Editor-Library, nur Custom-Snippet-Storage
 *   - Pflicht-Meta-Keys (alle bestätigt): _wpcode_code, _wpcode_type, _wpcode_location,
 *     _wpcode_auto_insert, _wpcode_priority
 *   - Optionale Meta-Keys (laut Live-Scan): _wpcode_compiled_code, _wpcode_snippet_version,
 *     _wpcode_library_version, _wpcode_device_type, _wpcode_schedule, _wpcode_conditional_logic,
 *     _wpcode_conditional_logic_enabled, _wpcode_load_as_file, _wpcode_compress_output,
 *     _wpcode_library_id, _wpcode_location_extra, _wpcode_note, _wpcode_shortcode_attributes,
 *     _wpcode_auto_insert_number
 *
 * Plan-Referenz: BAUPLAN-SITE-CLONE-TO-V3.md §Phase 0.1, §Phase 7
 */
import { withRetry } from './with-retry.js';

export type WPCodeType = 'php' | 'js' | 'css' | 'html';

export type WPCodeLocation =
  | 'site-wide-header'
  | 'site-wide-footer'
  | 'everywhere'
  | 'page-specific'
  | 'admin-only'
  | 'frontend-only';

export interface WPCodeCreateOptions {
  title: string;
  code: string;
  type: WPCodeType;
  location: WPCodeLocation;
  priority?: number;
  autoInsert?: boolean;
  note?: string;
}

export interface WPCodeAdapter {
  detectCptSlug(): Promise<string | null>;
  createSnippet(opts: WPCodeCreateOptions): Promise<number>;
  deleteSnippet(id: number): Promise<void>;
  activateSnippet(id: number): Promise<void>;
  getSnippetMeta(id: number): Promise<Record<string, unknown> | null>;
}

interface McpCallFn {
  (ability_name: string, parameters: Record<string, unknown>): Promise<unknown>;
}

/**
 * Generates the PHP snippet that creates one WPCode snippet via wp_insert_post.
 * Returns the new post ID; PHP is executed by novamira/execute-php.
 */
function buildInsertPhp(opts: WPCodeCreateOptions, slug: string): string {
  const title = opts.title.replace(/'/g, "\\'");
  const code = opts.code;
  const meta = {
    _wpcode_code: code,
    _wpcode_type: opts.type,
    _wpcode_location: opts.location,
    _wpcode_auto_insert: opts.autoInsert === false ? '0' : '1',
    _wpcode_priority: String(opts.priority ?? 10),
    ...(opts.note ? { _wpcode_note: opts.note } : {}),
  };

  const metaLines = Object.entries(meta)
    .map(([k, v]) => `update_post_meta($pid, '${k}', ${JSON.stringify(v)});`)
    .join('\n');

  return `
$pid = wp_insert_post([
  'post_type'   => ${JSON.stringify(slug)},
  'post_status' => 'draft',
  'post_title'  => '${title}',
]);
if (is_wp_error($pid)) { return ['error' => $pid->get_error_message()]; }
${metaLines}
return ['id' => $pid];
`;
}

function buildDeletePhp(id: number): string {
  return `
$deleted = wp_delete_post(${id}, true);
return ['deleted' => (bool) $deleted];
`;
}

function buildActivatePhp(id: number): string {
  return `
update_post_meta(${id}, '_wpcode_auto_insert', '1');
return ['activated' => true, 'id' => ${id}];
`;
}

function buildDetectPhp(): string {
  return `
$candidates = ['wpcode', 'wpcode_snippet', 'wpcode-snippets', 'wpcodes'];
foreach ($candidates as $s) {
  if (post_type_exists($s)) {
    return [
      'slug' => $s,
      'version' => defined('WPCODE_VERSION') ? WPCODE_VERSION : null,
      'count' => (array) wp_count_posts($s),
    ];
  }
}
return null;
`;
}

export function createWPCodeAdapter(mcp: McpCallFn): WPCodeAdapter {
  return {
    async detectCptSlug(): Promise<string | null> {
      const result = (await mcp('novamira/execute-php', {
        code: buildDetectPhp(),
      })) as { return_value: { slug: string } | null } | null;
      return result?.return_value?.slug ?? null;
    },

    async createSnippet(opts: WPCodeCreateOptions): Promise<number> {
      const detected = await this.detectCptSlug();
      if (!detected) {
        throw new Error('WPCode plugin not detected on target');
      }
      const result = (await withRetry(() =>
        mcp('novamira/execute-php', { code: buildInsertPhp(opts, detected) }),
      )) as { return_value: { id: number } | { error: string } };
      const rv = result?.return_value;
      const id = rv && 'id' in rv ? rv.id : undefined;
      if (typeof id !== 'number') {
        throw new Error(
          `WPCode create failed: ${JSON.stringify(rv ?? 'no return')}`,
        );
      }
      return id;
    },

    async deleteSnippet(id: number): Promise<void> {
      await withRetry(() => mcp('novamira/execute-php', { code: buildDeletePhp(id) }));
    },

    async activateSnippet(id: number): Promise<void> {
      await withRetry(() => mcp('novamira/execute-php', { code: buildActivatePhp(id) }));
    },

    async getSnippetMeta(id: number): Promise<Record<string, unknown> | null> {
      const result = (await mcp('novamira/execute-php', {
        code: `return get_post_meta(${id});`,
      })) as { return_value: Record<string, unknown> | null };
      return result?.return_value ?? null;
    },
  };
}

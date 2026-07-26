/**
 * Fonts-Plugin (olympus-google-fonts) Adapter.
 *
 * Erkenntnisse aus Phase 0.2 (live-verified 2026-06-16 auf test4):
 *   - Plugin-Datei: olympus-google-fonts/olympus-google-fonts.php
 *   - Plugin-Version: 4.1.3 (auf test4)
 *   - Custom-Taxonomy: ogf_custom_fonts
 *   - Storage: option_key = `taxonomy_ogf_custom_fonts_<term_id>`
 *   - Meta-Felder der Option: woff, woff2, ttf, otf, weight, style, family, preload
 *   - WICHTIG: `family` bleibt im Storage leer — wird aus dem Term-Namen abgeleitet
 *   - Slug-Konvention: `<term-name-slug>` (z.B. "sf-pro", "sf-pro_regular")
 *   - Cache-Clear: KEIN delete_transient() mit Wildcard — direkter $wpdb->query mit LIKE
 *
 * Plan-Referenz: BAUPLAN-SITE-CLONE-TO-V3.md §Phase 0.2, §Phase 5
 */
import { withRetry } from './with-retry.js';

export interface FontsPluginInfo {
  active: boolean;
  version: string | null;
  fontCount: number;
  taxonomy: string;
}

export interface CustomFontInput {
  family: string;       // wird zum Term-Namen (slug)
  weight: number;
  style?: 'normal' | 'italic';
  woff2Url: string;
  preload?: boolean;
}

export interface FontsPluginAdapter {
  detectFontsPlugin(): Promise<FontsPluginInfo>;
  registerGoogleFont(opts: { family: string; weights: number[] }): Promise<void>;
  uploadCustomFont(opts: CustomFontInput): Promise<{ termSlug: string; termId: number }>;
  registerSystemFont(family: string): Promise<void>;
  deleteFont(termSlug: string): Promise<void>;
}

interface McpCallFn {
  (ability_name: string, parameters: Record<string, unknown>): Promise<unknown>;
}

const PLUGIN_FILE = 'olympus-google-fonts/olympus-google-fonts.php';
const TAXONOMY = 'ogf_custom_fonts';

function buildDetectPhp(): string {
  return `
global $wpdb;
return [
  'active'   => is_plugin_active(${JSON.stringify(PLUGIN_FILE)}),
  'version'  => defined('OGF_VERSION') ? OGF_VERSION : null,
  'taxonomy' => ${JSON.stringify(TAXONOMY)},
  'count'    => taxonomy_exists(${JSON.stringify(TAXONOMY)})
    ? (int) wp_count_terms(['taxonomy' => ${JSON.stringify(TAXONOMY)}, 'hide_empty' => false, 'number' => 0])
    : 0,
  'theme_mods' => [
    'ogf_load_fonts'  => get_theme_mod('ogf_load_fonts', []),
    'ogf_font_display' => get_theme_mod('ogf_font_display', null),
  ],
];
`;
}

function buildRegisterGooglePhp(family: string, weights: number[]): string {
  const fontSpec = `${family}:${weights.join(',')}`;
  return `
$mods = get_theme_mod('ogf_load_fonts', []);
if (!is_array($mods)) $mods = [];
$exists = false;
foreach ($mods as $entry) {
  if (str_starts_with($entry, ${JSON.stringify(family + ':')})) { $exists = true; break; }
}
if (!$exists) {
  $mods[] = ${JSON.stringify(fontSpec)};
  set_theme_mod('ogf_load_fonts', $mods);
}
set_theme_mod('ogf_font_display', 'swap');
return ['theme_mods' => get_theme_mod('ogf_load_fonts', [])];
`;
}

function buildUploadCustomPhp(input: CustomFontInput): string {
  const { family, weight, style = 'normal', woff2Url, preload = false } = input;
  const slugBase = `${family}-${weight}`.toLowerCase().replace(/\s+/g, '-');
  return `
global $wpdb;
$existing = get_term_by('slug', ${JSON.stringify(slugBase)}, ${JSON.stringify(TAXONOMY)});
if ($existing) {
  $term_id = $existing->term_id;
} else {
  $result = wp_insert_term(${JSON.stringify(`${family} ${weight}`)}, ${JSON.stringify(TAXONOMY)}, [
    'slug' => ${JSON.stringify(slugBase)},
  ]);
  if (is_wp_error($result)) {
    return ['error' => $result->get_error_message()];
  }
  $term_id = $result['term_id'];
}

update_option('taxonomy_ogf_custom_fonts_' . $term_id, [
  'woff2'   => ${JSON.stringify(woff2Url)},
  'weight'  => ${JSON.stringify(String(weight))},
  'style'   => ${JSON.stringify(style)},
  'family'  => '',   // Fonts-Plugin leitet family aus Term-Namen ab
  'preload' => ${JSON.stringify(preload ? '1' : '0')},
]);

// Cache leeren — kein delete_transient mit Wildcard!
$wpdb->query(
  "DELETE FROM {\$wpdb->options}
   WHERE option_name LIKE '_transient_ogf_%'
      OR option_name LIKE '_transient_timeout_ogf_%'"
);

return [
  'term_id' => $term_id,
  'term_slug' => ${JSON.stringify(slugBase)},
  'storage_keys' => array_keys(get_option('taxonomy_ogf_custom_fonts_' . $term_id, [])),
];
`;
}

function buildDeletePhp(termSlug: string): string {
  return `
global $wpdb;
$term = get_term_by('slug', ${JSON.stringify(termSlug)}, ${JSON.stringify(TAXONOMY)});
if (!$term) return ['deleted' => false, 'reason' => 'not_found'];
delete_option('taxonomy_ogf_custom_fonts_' . $term->term_id);
$ok = wp_delete_term($term->term_id, ${JSON.stringify(TAXONOMY)});
$wpdb->query(
  "DELETE FROM {\$wpdb->options}
   WHERE option_name LIKE '_transient_ogf_%'
      OR option_name LIKE '_transient_timeout_ogf_%'"
);
return ['deleted' => (bool) $ok];
`;
}

function buildSystemFontPhp(family: string): string {
  return `
$mods = get_theme_mod('ogf_system_fonts', []);
if (!is_array($mods)) $mods = [];
if (!in_array(${JSON.stringify(family)}, $mods, true)) {
  $mods[] = ${JSON.stringify(family)};
  set_theme_mod('ogf_system_fonts', $mods);
}
return ['system_fonts' => $mods];
`;
}

export function createFontsPluginAdapter(mcp: McpCallFn): FontsPluginAdapter {
  return {
    async detectFontsPlugin(): Promise<FontsPluginInfo> {
      const result = (await mcp('novamira/execute-php', {
        code: buildDetectPhp(),
      })) as { return_value: { active: boolean; version: string | null; taxonomy: string; count: number } };
      const r = result?.return_value;
      return {
        active: r?.active ?? false,
        version: r?.version ?? null,
        fontCount: r?.count ?? 0,
        taxonomy: r?.taxonomy ?? TAXONOMY,
      };
    },

    async registerGoogleFont(opts): Promise<void> {
      await withRetry(() =>
        mcp('novamira/execute-php', { code: buildRegisterGooglePhp(opts.family, opts.weights) }),
      );
    },

    async uploadCustomFont(opts: CustomFontInput) {
      const result = (await withRetry(() =>
        mcp('novamira/execute-php', { code: buildUploadCustomPhp(opts) }),
      )) as { return_value: { term_id: number; term_slug: string } | { error: string } };
      const r = result?.return_value;
      if (!r || 'error' in r) {
        throw new Error(`Font upload failed: ${JSON.stringify(r ?? 'no return')}`);
      }
      return { termId: r.term_id, termSlug: r.term_slug };
    },

    async registerSystemFont(family: string): Promise<void> {
      await withRetry(() => mcp('novamira/execute-php', { code: buildSystemFontPhp(family) }));
    },

    async deleteFont(termSlug: string): Promise<void> {
      await withRetry(() => mcp('novamira/execute-php', { code: buildDeletePhp(termSlug) }));
    },
  };
}

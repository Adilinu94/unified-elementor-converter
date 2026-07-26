/**
 * Font-to-Kit Bridge — Phase 4 Extension
 *
 * Bridges the gap between Stage 1 (fonts-detected.json / FontIntercept[])
 * and the Elementor Kit's system_typography settings.
 *
 * Stage 4 (token-sync) already pushes design tokens (colors, spacing) to the
 * Kit. This module adds the font families on top of that — automatically,
 * without manual copy-paste between fonts-detected.json and the Kit editor.
 *
 * The Kit typography update uses execute-php to:
 *   1. Get the active Kit ID via the Elementor PHP API
 *   2. Read current system_typography from _elementor_page_settings
 *   3. Append missing font families (skip duplicates)
 *   4. Save via update_post_meta
 *
 * Each new Kit typography item follows the Elementor V4 structure:
 *   { _id, title, typography_typography, typography_font_family, typography_font_weight }
 */
import type { McpAdapter } from '../mcp/mcp-adapter.js';
import type { FontIntercept } from '../extractor/types.js';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface FontKitOptions {
  dryRun?: boolean;
}

export interface FontKitResult {
  /** Font families successfully added to the Kit. */
  added: string[];
  /** Font families already present in the Kit (skipped). */
  skipped: string[];
  dryRun: boolean;
}

// ---------------------------------------------------------------------------
// Internal types
// ---------------------------------------------------------------------------

interface FontFamily {
  name: string;
  /** Dominant weight across all intercepts for this family. */
  weight: number;
}

interface ExecutePhpResponse {
  success: boolean;
  data?: { output?: string };
  output?: string;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Sync detected font families into the active Elementor Kit's system_typography.
 *
 * Idempotent: families already in the Kit are skipped. Only unique new families
 * are added. Uses execute-php so it works with any Novamira installation.
 *
 * @param fonts  - FontIntercept[] from extraction (fontsIntercepted field)
 * @param mcp    - Configured MCP adapter pointing at the target WordPress
 * @param options - dryRun: skip MCP call, return what would be added
 */
export async function syncFontsToKit(
  fonts: FontIntercept[],
  mcp: McpAdapter,
  options: FontKitOptions = {},
): Promise<FontKitResult> {
  const families = extractFamilies(fonts);

  if (families.length === 0) {
    return { added: [], skipped: [], dryRun: options.dryRun ?? false };
  }

  if (options.dryRun) {
    console.log(`[font-kit-bridge] DRY-RUN — would sync ${families.length} font families to Kit`);
    return { added: families.map((f) => f.name), skipped: [], dryRun: true };
  }

  // Build the PHP families array as a JSON literal for safe embedding
  const familiesJson = JSON.stringify(
    families.map((f) => ({ family: f.name, weight: f.weight })),
  );

  const php = buildSyncPhp(familiesJson);
  const res = await mcp.executeAbility<ExecutePhpResponse>('novamira/execute-php', { code: php });
  const raw = (res.data?.output ?? res.output ?? '').trim();

  if (!raw) {
    throw new Error('[font-kit-bridge] execute-php returned empty output');
  }

  const parsed = JSON.parse(raw) as { added: string[]; skipped: string[] };
  console.log(
    `[font-kit-bridge] ✓ ${parsed.added.length} added, ${parsed.skipped.length} skipped`,
  );
  return { added: parsed.added, skipped: parsed.skipped, dryRun: false };
}

// ---------------------------------------------------------------------------
// Font family extraction
// ---------------------------------------------------------------------------

/**
 * Extract unique font families from a FontIntercept list.
 * - Skips entries without a resolvable family name
 * - Groups duplicates, picks dominant weight (most common, default 400)
 * - Returns in descending frequency order (most-used fonts first)
 */
export function extractFamilies(fonts: FontIntercept[]): FontFamily[] {
  const map = new Map<string, number[]>(); // normalised name → weight list

  for (const f of fonts) {
    const name = resolveFamilyName(f);
    if (!name) continue;
    const key = name.toLowerCase();
    const weights = map.get(key) ?? [];
    weights.push(f.weight ?? 400);
    map.set(key, weights);
  }

  return [...map.entries()]
    .map(([key, weights]) => {
      // Derive a correctly-cased name from the original font entries
      const original = fonts.find((f) => (resolveFamilyName(f) ?? '').toLowerCase() === key);
      const name = original ? (resolveFamilyName(original) ?? key) : key;
      const weight = dominantWeight(weights);
      return { name, weight };
    })
    .sort((a, b) => b.weight - a.weight); // arbitrary stable sort
}

function resolveFamilyName(f: FontIntercept): string | null {
  if (f.family) return f.family.trim();

  // Parse Google Fonts CSS URLs: ...?family=Manrope:wght@400;700...
  if (f.type === 'google-fonts-css') {
    const match = f.url.match(/[?&]family=([^:&,]+)/i);
    if (match) return decodeURIComponent(match[1]).replace(/\+/g, ' ').trim();
  }

  // Heuristic: extract from woff/woff2 URL path (e.g. /fonts/Manrope-Bold.woff2)
  if (f.type === 'woff2' || f.type === 'woff') {
    const filename = f.url.split('/').pop()?.split('?')[0] ?? '';
    const nameMatch = filename.match(/^([A-Z][A-Za-z0-9-]+?)(?:[-_][A-Za-z0-9]+)?\.woff2?$/);
    if (nameMatch) return nameMatch[1].replace(/-/g, ' ').trim();
  }

  return null;
}

function dominantWeight(weights: number[]): number {
  if (weights.length === 0) return 400;
  const freq = new Map<number, number>();
  for (const w of weights) freq.set(w, (freq.get(w) ?? 0) + 1);
  let top = 400;
  let topCount = 0;
  for (const [w, c] of freq) {
    if (c > topCount || (c === topCount && w < top)) {
      top = w;
      topCount = c;
    }
  }
  return top;
}

// ---------------------------------------------------------------------------
// PHP code generation
// ---------------------------------------------------------------------------

function buildSyncPhp(familiesJson: string): string {
  return `
$families = json_decode(${JSON.stringify(familiesJson)}, true);
$kit_id   = Elementor\\Plugin::$instance->kits_manager->get_active_id();
$settings = get_post_meta($kit_id, '_elementor_page_settings', true);
if (!is_array($settings)) { $settings = []; }

$existing_families = array_column($settings['system_typography'] ?? [], 'typography_font_family');
$existing_lower    = array_map('strtolower', $existing_families);

$added   = [];
$skipped = [];

foreach ($families as $fam) {
  if (in_array(strtolower($fam['family']), $existing_lower, true)) {
    $skipped[] = $fam['family'];
    continue;
  }
  $settings['system_typography'][] = [
    '_id'                    => 'sf' . substr(md5($fam['family']), 0, 7),
    'title'                  => $fam['family'],
    'typography_typography'  => 'custom',
    'typography_font_family' => $fam['family'],
    'typography_font_weight' => (string) $fam['weight'],
  ];
  $existing_lower[] = strtolower($fam['family']);
  $added[]          = $fam['family'];
}

update_post_meta($kit_id, '_elementor_page_settings', $settings);
echo json_encode(['added' => $added, 'skipped' => $skipped]);
`;
}

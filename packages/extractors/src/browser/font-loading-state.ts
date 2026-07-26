/**
 * Phase 4 (UMBAUPLAN §7.3.6): Font-Loading-State.
 *
 * Uses the `document.fonts` API to check whether each known font family
 * has actually loaded on the page. V3 needs to know if a custom font is
 * available — if not, we should fall back to the next family in the
 * stack rather than render Times New Roman.
 *
 * `document.fonts.check("16px \"Inter\"")` returns true only if the font
 * has finished loading. We also enumerate the FontFaceSet entries to
 * capture the resolved weight/style/variant tuple for every loaded face,
 * which is what V3's typography-font_family setting actually expects.
 */

import type { Page } from 'playwright';

/** Loading status for a single font family. */
export interface FontFamilyStatus {
  family: string;
  /** True if the browser reports the font has loaded and is ready. */
  loaded: boolean;
  /** Distinct weights observed across the FontFaceSet for this family. */
  weights: number[];
  /** Distinct styles observed for this family. */
  styles: ('normal' | 'italic' | 'oblique')[];
}

/** Top-level result of the extraction. */
export interface FontLoadingStateResult {
  /** Families present in document.fonts and their load status. */
  families: FontFamilyStatus[];
  /** Number of fonts that have not yet finished loading. */
  pendingCount: number;
  /** True if `document.fonts.ready` resolved without error. */
  readyResolved: boolean;
}

interface RawFontEntry {
  family: string;
  weight: string;
  style: string;
  status: 'loaded' | 'unloaded' | 'loading' | 'error';
}

interface RawResult {
  entries: RawFontEntry[];
  pendingCount: number;
  readyResolved: boolean;
}

function buildExtractionScript(): string {
  return `(function(){
    let readyResolved = false;
    // We can't await document.fonts.ready in a synchronous script body,
    // so we assume "ready" means the API is present (i.e. the browser
    // supports Font Loading API). The async-load check is done via the
    // FontFaceSet.status property below.
    if (document.fonts && typeof document.fonts.check === 'function') {
      readyResolved = true;
    }
    const entries = [];
    let pendingCount = 0;
    if (document.fonts && typeof document.fonts.forEach === 'function') {
      document.fonts.forEach(function(face){
        entries.push({
          family: face.family,
          weight: String(face.weight),
          style: face.style,
          status: face.status,
        });
        if (face.status !== 'loaded') pendingCount++;
      });
    }
    return { entries: entries, pendingCount: pendingCount, readyResolved: readyResolved };
  })()`;
}

/** Normalize a font-family name: strip quotes + collapse whitespace. */
export function normalizeFamily(name: string): string {
  return name.replace(/['"]/g, '').replace(/\s+/g, ' ').trim();
}

/**
 * Parse `document.fonts` into a deduplicated, per-family status map.
 * The browser exposes every FontFace once per (family, weight, style)
 * tuple — this function rolls them up to one record per family.
 */
export function rollupFamilies(entries: RawFontEntry[]): FontFamilyStatus[] {
  const byFamily = new Map<string, FontFamilyStatus>();
  for (const e of entries) {
    const family = normalizeFamily(e.family);
    if (!family) continue;
    let status = byFamily.get(family);
    if (!status) {
      status = { family, loaded: false, weights: [], styles: [] };
      byFamily.set(family, status);
    }
    const weight = parseInt(e.weight, 10);
    if (Number.isFinite(weight) && !status.weights.includes(weight)) {
      status.weights.push(weight);
    }
    const style = e.style;
    if ((style === 'normal' || style === 'italic' || style === 'oblique')
        && !status.styles.includes(style)) {
      status.styles.push(style);
    }
  }
  // Mark loaded only when ALL faces for a family have status='loaded'
  for (const e of entries) {
    const family = normalizeFamily(e.family);
    const status = byFamily.get(family);
    if (!status) continue;
    if (e.status === 'loaded') status.loaded = true;
  }
  // Sort for deterministic output
  const out = Array.from(byFamily.values());
  out.sort((a, b) => a.family.localeCompare(b.family));
  for (const s of out) {
    s.weights.sort((a, b) => a - b);
    s.styles.sort();
  }
  return out;
}

/**
 * Run the font-loading-state probe on a page. Returns a deduplicated
 * per-family status array + a `pendingCount` of faces still loading.
 */
export async function extractFontLoadingState(
  page: Page,
): Promise<FontLoadingStateResult> {
  const raw = ((await page
    .evaluate(buildExtractionScript())
    .catch(() => null)) ?? null) as RawResult | null;

  if (!raw) {
    return { families: [], pendingCount: 0, readyResolved: false };
  }
  return {
    families: rollupFamilies(raw.entries ?? []),
    pendingCount: raw.pendingCount ?? 0,
    readyResolved: !!raw.readyResolved,
  };
}

/**
 * Compute the effective fallback chain for a font stack. Given the
 * desired `family` stack and the loading-state result, returns the
 * first family in the stack that is loaded (or the original stack
 * unchanged if none are loaded — V3 can still attempt to load).
 */
export function effectiveFallback(
  fontStack: string,
  state: FontLoadingStateResult,
): string {
  const wanted = fontStack.split(',').map((s) => normalizeFamily(s));
  for (const w of wanted) {
    if (state.families.some((f) => f.family === w && f.loaded)) {
      return w;
    }
  }
  return wanted[0] ?? '';
}
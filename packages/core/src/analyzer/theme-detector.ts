/**
 * Theme-Detector (Phase 6 — V2-Pixel-Perfekt).
 *
 * Erkennt aktives Farbschema (light / dark / auto) einer Source-Page.
 *
 * Detection-Sources (Priorität absteigend):
 *   1. data-theme / data-mode Attribut auf <html> oder <body>
 *   2. CSS class "dark" / "theme-dark" / "dark-mode" auf <html>/<body>
 *   3. media-query prefers-color-scheme (window.matchMedia)
 *   4. V3-Default: light
 *
 * V3-Mapping:
 *   - light → nur light-Tokens resolven
 *   - dark  → nur dark-Tokens (tokens-dark.json wenn vorhanden)
 *   - auto  → beide Token-Sets, Conditional-CSS via media-query
 *
 * Pure function über Document-API; Test-Fixtures liefern mock-DOM.
 *
 * Plan-Referenz: UMBAUPLAN §10.2.
 */

export type ThemeMode = 'light' | 'dark' | 'auto';

export interface ThemeDetection {
  mode: ThemeMode;
  /** Resolved sub-mode when mode === 'auto' (light or dark based on system pref). */
  resolvedMode: 'light' | 'dark';
  /** True if detection-source was an explicit data-attribute. */
  isExplicit: boolean;
  /** Detection-source for QA-report traceability. */
  source:
    | 'data-attribute'
    | 'class'
    | 'media-query'
    | 'default';
}

export interface ThemeDetectorOptions {
  /** Force a specific detection-source (testing). */
  forceSource?: ThemeDetection['source'];
  /** Force a specific resolved-mode for 'auto'. */
  forceResolvedMode?: 'light' | 'dark';
  /** Attribute names to consider as data-theme signals. */
  themeAttributes?: string[];
  /** Class names that signal dark-mode. */
  darkClasses?: string[];
}

const DEFAULT_THEME_ATTRIBUTES = ['data-theme', 'data-mode', 'data-color-scheme'];
const DEFAULT_DARK_CLASSES = ['dark', 'theme-dark', 'dark-mode', 'dark-theme'];

export { DEFAULT_THEME_ATTRIBUTES, DEFAULT_DARK_CLASSES };

/** Inspect an HTMLElement for data-theme / data-mode. Returns mode or null. */
export function detectFromDataAttribute(
  el: { getAttribute?: (name: string) => string | null } | null,
  attrs: string[] = DEFAULT_THEME_ATTRIBUTES,
): ThemeMode | null {
  if (!el) return null;
  const get = el.getAttribute;
  if (!get) return null;
  for (const attr of attrs) {
    const value = get(attr);
    if (!value) continue;
    const lower = value.toLowerCase().trim();
    if (lower === 'dark' || lower === 'night') return 'dark';
    if (lower === 'light' || lower === 'day') return 'light';
    if (lower === 'auto' || lower === 'system') return 'auto';
  }
  return null;
}

/** Inspect classList of an element for dark-mode markers. */
export function detectFromClassList(
  el: { classList?: { contains(c: string): boolean }; getAttribute?: (n: string) => string | null } | null,
  classes: string[] = DEFAULT_DARK_CLASSES,
): ThemeMode | null {
  if (!el) return null;
  const has = (c: string): boolean => {
    if (el.classList?.contains) return el.classList.contains(c);
    if (el.getAttribute) {
      const classAttr = el.getAttribute('class') ?? '';
      return classAttr.split(/\s+/).includes(c);
    }
    return false;
  };
  for (const cls of classes) {
    if (has(cls)) return 'dark';
  }
  return null;
}

/** Inspect window.matchMedia for prefers-color-scheme. */
export function detectFromMediaQuery(
  matchMedia: (query: string) => { matches: boolean } | null,
): 'light' | 'dark' | null {
  try {
    const dark = matchMedia('(prefers-color-scheme: dark)');
    if (dark?.matches) return 'dark';
    const light = matchMedia('(prefers-color-scheme: light)');
    if (light?.matches) return 'light';
  } catch {
    // matchMedia may throw in non-browser environments — treat as "unknown".
    return null;
  }
  return null;
}

/**
 * Master detection function.
 *
 * @param html  mock/html-element representing <html>
 * @param body  mock/html-element representing <body>
 * @param matchMedia optional matchMedia function (defaults to a no-op returning null)
 * @param options  optional overrides for testing
 */
type ElementLike = {
  getAttribute?: (name: string) => string | null;
  classList?: { contains(c: string): boolean };
} | null;

export function detectTheme(
  html: ElementLike,
  body: ElementLike,
  matchMedia: (q: string) => { matches: boolean } | null = () => null,
  options: ThemeDetectorOptions = {},
): ThemeDetection {
  const attrs = options.themeAttributes ?? DEFAULT_THEME_ATTRIBUTES;
  const darkClasses = options.darkClasses ?? DEFAULT_DARK_CLASSES;

  // 1) data-attribute on <html> (highest priority)
  const htmlDataMode = detectFromDataAttribute(html, attrs);
  if (htmlDataMode) {
    return {
      mode: htmlDataMode,
      resolvedMode: htmlDataMode === 'auto'
        ? (options.forceResolvedMode ?? detectFromMediaQuery(matchMedia) ?? 'light')
        : htmlDataMode,
      isExplicit: true,
      source: 'data-attribute',
    };
  }

  // 2) data-attribute on <body>
  const bodyDataMode = detectFromDataAttribute(body, attrs);
  if (bodyDataMode) {
    return {
      mode: bodyDataMode,
      resolvedMode: bodyDataMode === 'auto'
        ? (options.forceResolvedMode ?? detectFromMediaQuery(matchMedia) ?? 'light')
        : bodyDataMode,
      isExplicit: true,
      source: 'data-attribute',
    };
  }

  // 3) class-based dark detection
  const classMode = detectFromClassList(html, darkClasses) ?? detectFromClassList(body, darkClasses);
  if (classMode === 'dark') {
    return {
      mode: 'dark',
      resolvedMode: 'dark',
      isExplicit: true,
      source: 'class',
    };
  }

  // 4) media-query (auto)
  const mediaMode = detectFromMediaQuery(matchMedia);
  if (mediaMode) {
    return {
      mode: 'auto',
      resolvedMode: mediaMode,
      isExplicit: false,
      source: 'media-query',
    };
  }

  // 5) V3-Default
  return {
    mode: 'light',
    resolvedMode: 'light',
    isExplicit: false,
    source: 'default',
  };
}

/** Selector for the V3 page_css conditional block (Plan §10.2). */
export function buildThemeConditionalCss(theme: ThemeDetection, cssBody: string): string {
  if (theme.mode === 'dark') return cssBody;
  if (theme.mode === 'light') return cssBody;
  // auto → wrap in prefers-color-scheme: dark
  return `@media (prefers-color-scheme: dark) {\n${cssBody}\n}`;
}
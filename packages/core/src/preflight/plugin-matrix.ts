/**
 * Plugin compatibility matrix — Phase 115 (BAUPLAN v4.0 "Verbesserung 7", Phase 94).
 *
 * The set of WordPress plugins + environment versions each target mode needs
 * before the pipeline may run. Pure data + a version comparator; no I/O.
 */

export interface PluginRequirement {
  slug: string;
  name: string;
  minVersion: string;
  required: boolean;
  reason: string;
  installUrl?: string;
  /**
   * Other plugin slugs that satisfy this requirement.
   *
   * Not a convenience: `pro-elements` is a drop-in replacement for
   * `elementor-pro` that defines `ELEMENTOR_PRO_VERSION`, registers the
   * `ElementorPro\*` classes and loads the same modules. Live-verified on
   * testseite.nick-webdesign.de (2026-08-28):
   *
   * ```
   * elementor-pro/elementor-pro.php  installed but INACTIVE
   * pro-elements/pro-elements.php    ACTIVE
   * ELEMENTOR_PRO_VERSION            4.2.2
   * ELEMENTOR_PRO_PATH               .../plugins/pro-elements/
   * loaded modules                   motion-fx, sticky, popup, forms, …
   * ```
   *
   * `modules/motion-fx/controls-group.php` is byte-identical between the two
   * (md5 `a391f93e…`), so every `motion_fx_*` control and the amplitude formulas
   * the animation mapper inverts are exactly the same. Matching on the
   * `elementor-pro` slug alone reports Pro as missing on a site that has every
   * Pro capability — a false negative that would push natively mappable motion
   * into a WPCode fallback.
   */
  alternativeSlugs?: readonly string[];
}

/**
 * Plugin slugs that provide the Elementor Pro capability set.
 *
 * Exported because the animation mapper's fallback reasons and the preflight
 * report both need to name them, and because a third fork would otherwise have
 * to be added in two places.
 */
export const ELEMENTOR_PRO_PROVIDERS = ['elementor-pro', 'pro-elements'] as const;

export const PLUGIN_MATRIX: Record<'v3' | 'v4', PluginRequirement[]> = {
  v3: [
    {
      slug: 'elementor',
      name: 'Elementor',
      minVersion: '3.24.0',
      required: true,
      reason: 'Core-Rendering-Engine für V3-Widgets',
    },
    {
      // wp.org directory slug (== get_plugins() dirname), NOT the display name.
      // Verified live 2026-07-30: WPCode Lite installs as insert-headers-and-footers.
      slug: 'insert-headers-and-footers',
      name: 'WPCode Lite',
      minVersion: '2.0.0',
      required: true,
      reason: 'CSS/JS-Injection für Setting-First-Ansatz',
      installUrl: 'https://wordpress.org/plugins/insert-headers-and-footers/',
    },
    {
      slug: 'elementor-pro',
      name: 'Elementor Pro (oder PRO Elements)',
      minVersion: '3.0.0',
      required: false,
      reason:
        'Native Scroll-Motion-Effects (motion_fx_*) und Sticky. Ohne diese Fähigkeit ' +
        'fallen gemessene Scroll-Animationen auf WPCode-Snippets zurück.',
      alternativeSlugs: ['pro-elements'],
    },
    {
      slug: 'olympus-google-fonts',
      name: 'Olympus Google Fonts',
      minVersion: '1.0.0',
      required: false,
      reason: 'Optimiertes Font-Loading (optional, aber empfohlen)',
      installUrl: 'https://wordpress.org/plugins/olympus-google-fonts/',
    },
  ],
  v4: [
    {
      slug: 'elementor',
      name: 'Elementor',
      minVersion: '3.28.0',
      required: true,
      reason: 'V4 Atomic System erfordert Elementor 3.28+',
    },
    {
      slug: 'elementor-pro',
      name: 'Elementor Pro (oder PRO Elements)',
      minVersion: '3.28.0',
      required: false,
      reason: 'Erweiterte V4-Features (Loop Grid, etc.)',
      alternativeSlugs: ['pro-elements'],
    },
  ],
};

export const PHP_COMPATIBILITY = {
  minPhp: '8.0',
  minWordpress: '6.2',
  maxWordpress: '6.8',
} as const;

/**
 * True when `current` >= `minimum` comparing major.minor.patch numerically.
 * Non-numeric suffixes (e.g. "3.24.0-beta") are treated as their leading int.
 */
export function versionSatisfies(current: string, minimum: string): boolean {
  const parse = (v: string): number[] => v.split('.').map((p) => Number.parseInt(p, 10) || 0);
  const c = parse(current);
  const m = parse(minimum);
  for (let i = 0; i < 3; i++) {
    if ((c[i] ?? 0) > (m[i] ?? 0)) return true;
    if ((c[i] ?? 0) < (m[i] ?? 0)) return false;
  }
  return true;
}

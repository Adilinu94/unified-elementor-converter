/**
 * Novamira Ability Registry — Single Source of Truth (Phase 100, BAUPLAN v5.0).
 *
 * KNOWN_ABILITIES is a frozen snapshot of the abilities exposed by the live
 * Novamira MCP server (discovered 2026-07-30 against testseite.nick-webdesign.de,
 * see docs/NOVAMIRA-LIVE-ABILITIES-2026-07-30.txt — 263 abilities).
 *
 * WHY THIS EXISTS: the server migrated its ability namespace from the old
 * `novamira/adrians-*` scheme to `novamira-adrianv2/*` (and dropped the
 * `adrians-` prefix). Large parts of the codebase still referenced the old,
 * now-dead names. `resolveAbilityName()` maps any legacy/aliased name onto a
 * live one, and throws a helpful error for genuinely-unknown names so that
 * drift surfaces immediately instead of failing silently at runtime.
 *
 * Keep this file in sync via `elconv doctor --sync-abilities`, which diffs the
 * live server against this snapshot.
 */

/** Frozen snapshot of all abilities the live Novamira server exposes. */
export const KNOWN_ABILITIES = [
  'mcp-adapter/discover-abilities',
  'novamira-adrianv2/add-alt-text-from-context',
  'novamira-adrianv2/add-atomic-button',
  'novamira-adrianv2/add-atomic-divider',
  'novamira-adrianv2/add-atomic-heading',
  'novamira-adrianv2/add-atomic-image',
  'novamira-adrianv2/add-atomic-paragraph',
  'novamira-adrianv2/add-atomic-svg',
  'novamira-adrianv2/add-atomic-video',
  'novamira-adrianv2/add-atomic-widget',
  'novamira-adrianv2/add-atomic-youtube',
  'novamira-adrianv2/add-code-snippet',
  'novamira-adrianv2/add-custom-css',
  'novamira-adrianv2/add-custom-js',
  'novamira-adrianv2/add-div-block',
  'novamira-adrianv2/add-flexbox',
  'novamira-adrianv2/add-global-class-variant',
  'novamira-adrianv2/aioseo-check-setup',
  'novamira-adrianv2/analyze-section-structure',
  'novamira-adrianv2/apply-text-hierarchy',
  'novamira-adrianv2/apply-variable-map-to-page',
  'novamira-adrianv2/apply-variable-to-class',
  'novamira-adrianv2/audit-page-a11y',
  'novamira-adrianv2/audit-page-seo',
  'novamira-adrianv2/batch-build-page',
  'novamira-adrianv2/batch-class',
  'novamira-adrianv2/batch-create-variables',
  'novamira-adrianv2/batch-get-content',
  'novamira-adrianv2/batch-media-upload',
  'novamira-adrianv2/check-editor-health',
  'novamira-adrianv2/class-audit',
  'novamira-adrianv2/clear-cache',
  'novamira-adrianv2/clone-element',
  'novamira-adrianv2/convert-kit-to-v4',
  'novamira-adrianv2/convert-page-v3-to-v4',
  'novamira-adrianv2/convert-site-v3-to-v4',
  'novamira-adrianv2/copy-lane-settings',
  'novamira-adrianv2/create-component',
  'novamira-adrianv2/create-custom-code',
  'novamira-adrianv2/create-global-class',
  'novamira-adrianv2/create-php-snippet',
  'novamira-adrianv2/create-template',
  'novamira-adrianv2/create-wpcode-snippet',
  'novamira-adrianv2/delete-custom-code',
  'novamira-adrianv2/delete-form-submission',
  'novamira-adrianv2/delete-media',
  'novamira-adrianv2/delete-php-snippet',
  'novamira-adrianv2/delete-template',
  'novamira-adrianv2/delete-wpcode-snippet',
  'novamira-adrianv2/design-token-remap',
  'novamira-adrianv2/detach-component',
  'novamira-adrianv2/detect-elementor-version',
  'novamira-adrianv2/discover-ability-metadata',
  'novamira-adrianv2/duplicate-page',
  'novamira-adrianv2/duplicate-template',
  'novamira-adrianv2/duplicate-wpcode-snippet',
  'novamira-adrianv2/edit-global-class-variant',
  'novamira-adrianv2/edit-interaction',
  'novamira-adrianv2/edit-media',
  'novamira-adrianv2/elementor-assign-class-to-containers',
  'novamira-adrianv2/elementor-check-setup',
  'novamira-adrianv2/elementor-edit-element',
  'novamira-adrianv2/elementor-inject-calibrated-page',
  'novamira-adrianv2/empty-trash',
  'novamira-adrianv2/enforce-boundary-coherence',
  'novamira-adrianv2/ensure-atomic-experiments',
  'novamira-adrianv2/evaluate-design',
  'novamira-adrianv2/evaluate-render-context',
  'novamira-adrianv2/export-design-system',
  'novamira-adrianv2/export-template',
  'novamira-adrianv2/extract-keywords-from-content',
  'novamira-adrianv2/featured-image',
  'novamira-adrianv2/fix-color-contrast',
  'novamira-adrianv2/fix-gap-rhythm',
  'novamira-adrianv2/fix-orphan-styles',
  'novamira-adrianv2/generate-meta-tags',
  'novamira-adrianv2/generate-schema-markup',
  'novamira-adrianv2/get-custom-code',
  'novamira-adrianv2/get-form-submission',
  'novamira-adrianv2/get-kit-settings',
  'novamira-adrianv2/get-maintenance-mode',
  'novamira-adrianv2/get-page-elements',
  'novamira-adrianv2/get-page-markdown',
  'novamira-adrianv2/get-php-snippet',
  'novamira-adrianv2/get-style-guide',
  'novamira-adrianv2/get-template',
  'novamira-adrianv2/get-theme-builder-conditions',
  'novamira-adrianv2/get-wpcode-snippet',
  'novamira-adrianv2/global-widgets',
  'novamira-adrianv2/greet',
  'novamira-adrianv2/html-to-elementor-widget-plan',
  'novamira-adrianv2/image-to-background',
  'novamira-adrianv2/import-design-system',
  'novamira-adrianv2/import-kit-fonts',
  'novamira-adrianv2/import-kit-media',
  'novamira-adrianv2/import-kit-plugins',
  'novamira-adrianv2/import-template',
  'novamira-adrianv2/import-template-kit',
  'novamira-adrianv2/inject-wpcode-snippet',
  'novamira-adrianv2/insert-component',
  'novamira-adrianv2/kit-convert-v3-to-v4',
  'novamira-adrianv2/layout-audit',
  'novamira-adrianv2/list-class-variants',
  'novamira-adrianv2/list-code-snippets',
  'novamira-adrianv2/list-custom-code',
  'novamira-adrianv2/list-elementor-pages',
  'novamira-adrianv2/list-experiments',
  'novamira-adrianv2/list-form-submissions',
  'novamira-adrianv2/list-global-classes',
  'novamira-adrianv2/list-kit-snapshots',
  'novamira-adrianv2/list-kits',
  'novamira-adrianv2/list-media',
  'novamira-adrianv2/list-php-snippets',
  'novamira-adrianv2/list-style-keys',
  'novamira-adrianv2/list-templates',
  'novamira-adrianv2/list-v3-pages',
  'novamira-adrianv2/list-wpcode-snippets',
  'novamira-adrianv2/media-upload',
  'novamira-adrianv2/media-usage',
  'novamira-adrianv2/memory-auto-fill',
  'novamira-adrianv2/normalize-responsive-values',
  'novamira-adrianv2/normalize-section-spacing',
  'novamira-adrianv2/page-audit',
  'novamira-adrianv2/page-settings',
  'novamira-adrianv2/patch-element-styles',
  'novamira-adrianv2/pipeline-state',
  'novamira-adrianv2/plugin-deploy',
  'novamira-adrianv2/rankmath-check-setup',
  'novamira-adrianv2/register-google-font',
  'novamira-adrianv2/remove-global-class',
  'novamira-adrianv2/reorder-element',
  'novamira-adrianv2/replace-urls',
  'novamira-adrianv2/reset-negative-margins',
  'novamira-adrianv2/responsive-audit',
  'novamira-adrianv2/restore-template',
  'novamira-adrianv2/rollback-kit-import',
  'novamira-adrianv2/score-distinctiveness',
  'novamira-adrianv2/set-active-kit',
  'novamira-adrianv2/set-aioseo-meta',
  'novamira-adrianv2/set-rankmath-meta',
  'novamira-adrianv2/set-wpcode-snippet-status',
  'novamira-adrianv2/setup-v4-foundation',
  'novamira-adrianv2/skill-list',
  'novamira-adrianv2/suggest-design-fixes',
  'novamira-adrianv2/sync-component-variant',
  'novamira-adrianv2/update-atomic-widget',
  'novamira-adrianv2/update-custom-code',
  'novamira-adrianv2/update-experiment',
  'novamira-adrianv2/update-kit-settings',
  'novamira-adrianv2/update-maintenance-mode',
  'novamira-adrianv2/update-php-snippet',
  'novamira-adrianv2/update-template',
  'novamira-adrianv2/update-theme-builder-conditions',
  'novamira-adrianv2/update-wpcode-snippet',
  'novamira-adrianv2/upgrade-page-to-v4',
  'novamira-adrianv2/upload-asset',
  'novamira-adrianv2/v4-performance-analysis',
  'novamira-adrianv2/validate-php-snippet',
  'novamira-adrianv2/validate-v4-tree',
  'novamira-adrianv2/variable-audit',
  'novamira-adrianv2/visual-qa',
  'novamira-adrianv2/woocommerce-check-setup',
  'novamira-adrianv2/wpcode-check-setup',
  'novamira-adrianv2/yoast-check-setup',
  'novamira-adrianv2/zero-container-padding',
  'novamira/activate-design',
  'novamira/agent-context',
  'novamira/astra-check-setup',
  'novamira/astra-clear-post-settings',
  'novamira/astra-disable-module',
  'novamira/astra-edit-settings',
  'novamira/astra-enable-module',
  'novamira/astra-get-color-palette',
  'novamira/astra-get-css-output',
  'novamira/astra-get-defaults',
  'novamira/astra-get-footer-layout',
  'novamira/astra-get-header-layout',
  'novamira/astra-get-layout',
  'novamira/astra-get-post-settings',
  'novamira/astra-get-settings',
  'novamira/astra-list-customizer-settings',
  'novamira/astra-list-modules',
  'novamira/astra-reorder-header-row',
  'novamira/astra-set-color-palette',
  'novamira/astra-set-footer-layout',
  'novamira/astra-set-header-layout',
  'novamira/astra-set-post-background',
  'novamira/astra-set-post-settings',
  'novamira/astra-set-typography',
  'novamira/check-design',
  'novamira/create-admin-access-link',
  'novamira/create-post',
  'novamira/create-upload-link',
  'novamira/delete-design',
  'novamira/delete-file',
  'novamira/delete-post',
  'novamira/disable-file',
  'novamira/edit-file',
  'novamira/elementor-add-element',
  'novamira/elementor-add-interaction',
  'novamira/elementor-apply-dynamic-tag',
  'novamira/elementor-apply-global-class',
  'novamira/elementor-check-setup',
  'novamira/elementor-clear-document-cache',
  'novamira/elementor-create-atomic-widget',
  'novamira/elementor-create-global-class',
  'novamira/elementor-create-v3-color',
  'novamira/elementor-create-v3-typography',
  'novamira/elementor-create-variable',
  'novamira/elementor-delete-element',
  'novamira/elementor-delete-element-style',
  'novamira/elementor-delete-global-class',
  'novamira/elementor-delete-interaction',
  'novamira/elementor-delete-v3-color',
  'novamira/elementor-delete-v3-typography',
  'novamira/elementor-delete-variable',
  'novamira/elementor-edit-element',
  'novamira/elementor-edit-global-class',
  'novamira/elementor-edit-v3-color',
  'novamira/elementor-edit-v3-typography',
  'novamira/elementor-edit-variable',
  'novamira/elementor-get-content',
  'novamira/elementor-get-dynamic-tag',
  'novamira/elementor-get-schema',
  'novamira/elementor-get-style-schema',
  'novamira/elementor-get-variable',
  'novamira/elementor-list-dynamic-tags',
  'novamira/elementor-list-global-classes',
  'novamira/elementor-list-interactions',
  'novamira/elementor-list-v3-styles',
  'novamira/elementor-list-variables',
  'novamira/elementor-set-content',
  'novamira/enable-file',
  'novamira/execute-php',
  'novamira/get-active-design',
  'novamira/get-design',
  'novamira/get-wp-cli-job',
  'novamira/gutenberg-add-pending-change',
  'novamira/gutenberg-create-pending-batch',
  'novamira/gutenberg-delete-pending-batch',
  'novamira/gutenberg-delete-pending-change',
  'novamira/gutenberg-enable-batch-finalization',
  'novamira/gutenberg-get-content',
  'novamira/gutenberg-get-finalization-url',
  'novamira/gutenberg-get-finalizer-runtime',
  'novamira/gutenberg-get-pending-batch',
  'novamira/gutenberg-list-pending-batches',
  'novamira/gutenberg-write-content',
  'novamira/list-design-library',
  'novamira/list-directory',
  'novamira/memory-delete',
  'novamira/memory-get',
  'novamira/memory-list',
  'novamira/memory-save',
  'novamira/read-file',
  'novamira/run-wp-cli',
  'novamira/save-design',
  'novamira/skill-delete',
  'novamira/skill-edit',
  'novamira/skill-get',
  'novamira/skill-write',
  'novamira/update-post',
  'novamira/write-file',
] as const;

export type AbilityName = (typeof KNOWN_ABILITIES)[number];

const KNOWN_SET: ReadonlySet<string> = new Set(KNOWN_ABILITIES);

/**
 * Explicit aliases for legacy names that do NOT follow the mechanical
 * `adrians-` / namespace-swap rules handled by resolveAbilityName().
 * Everything rule-derivable is intentionally left out to keep this small.
 */
export const ALIAS_MAP: Readonly<Record<string, AbilityName>> = {
  // Legacy generic upload → the real upload-link ability.
  'novamira/upload': 'novamira/create-upload-link',
  // Legacy site-clone-to-v3 name for the server-side asset fetch.
  'novamira/upload_asset': 'novamira-adrianv2/upload-asset',
  // inject-calibrated-page gained an `elementor-` prefix and moved to adrianv2.
  'novamira/inject-calibrated-page': 'novamira-adrianv2/elementor-inject-calibrated-page',
  'novamira-adrianv2/inject-calibrated-page': 'novamira-adrianv2/elementor-inject-calibrated-page',
  'novamira/elementor-inject-calibrated-page': 'novamira-adrianv2/elementor-inject-calibrated-page',
  // set-page-content was the old name for batch-build-page.
  'novamira-adrianv2/set-page-content': 'novamira-adrianv2/batch-build-page',
  'novamira/set-page-content': 'novamira-adrianv2/batch-build-page',
  // The legacy `adrians-code-injector` was WPCode-snippet injection.
  'novamira-adrianv2/adrians-code-injector': 'novamira-adrianv2/create-wpcode-snippet',
  'novamira/adrians-code-injector': 'novamira-adrianv2/create-wpcode-snippet',
  // add-alt-text is now context-driven.
  'novamira-adrianv2/adrians-add-alt-text': 'novamira-adrianv2/add-alt-text-from-context',
  'novamira/adrians-add-alt-text': 'novamira-adrianv2/add-alt-text-from-context',
  // set-interaction (add a Pro interaction to an element).
  'novamira-adrianv2/set-interaction': 'novamira/elementor-add-interaction',
  'novamira/set-interaction': 'novamira/elementor-add-interaction',
};

/**
 * Ability names the codebase references ON PURPOSE but the live server does not
 * (yet) expose. These are documented capability gaps, NOT accidental namespace
 * drift — the CI drift-gate treats them as known, and `doctor --sync-abilities`
 * reports them separately so the gap stays visible.
 */
export const UNAVAILABLE_ABILITIES: Readonly<Record<string, string>> = {
  // Raw plugin version ping used by the health command. Not exposed as an
  // ability; `elementor-check-setup` returns the version instead.
  'novamira/version': 'No ability equivalent — use novamira/elementor-check-setup (.elementor.version).',
  // Proposed single-element render-preview ability. The server offers
  // novamira-adrianv2/evaluate-render-context, with a different I/O contract.
  'novamira/elementor-render-preview': 'Proposed; server offers novamira-adrianv2/evaluate-render-context.',
};

/** True if the name is a documented, intentional capability gap. */
export function isKnownUnavailable(name: string): boolean {
  return Object.prototype.hasOwnProperty.call(UNAVAILABLE_ABILITIES, name);
}

/** Error thrown when an ability name cannot be resolved to a live ability. */
export class UnknownAbilityError extends Error {
  constructor(
    public readonly requested: string,
    public readonly suggestion?: string,
  ) {
    super(
      suggestion
        ? `Unknown Novamira ability "${requested}". Did you mean "${suggestion}"? ` +
            `(Not in the live registry — run \`elconv doctor --sync-abilities\` if the server changed.)`
        : `Unknown Novamira ability "${requested}". No close match in the live registry. ` +
            `Run \`elconv doctor --sync-abilities\` to refresh the snapshot.`,
    );
    this.name = 'UnknownAbilityError';
  }
}

/** True if the given name is a live ability exactly as written. */
export function isKnownAbility(name: string): name is AbilityName {
  return KNOWN_SET.has(name);
}

/** Split an ability name into [namespace, ability]; namespace '' if no slash. */
function splitAbility(name: string): [string, string] {
  const idx = name.indexOf('/');
  if (idx === -1) return ['', name];
  return [name.slice(0, idx), name.slice(idx + 1)];
}

/**
 * Try to resolve a (possibly legacy) ability name onto a live one WITHOUT
 * throwing. Returns null if it cannot be resolved.
 *
 * Resolution order:
 *   1. Already a live ability → return as-is.
 *   2. Explicit ALIAS_MAP entry.
 *   3. Mechanical candidates: strip a leading `adrians-` from the ability part
 *      and/or swap the namespace between `novamira` and `novamira-adrianv2`.
 */
export function tryResolveAbilityName(name: string): AbilityName | null {
  if (isKnownAbility(name)) return name;

  const alias = ALIAS_MAP[name];
  if (alias) return alias;

  const [ns, ability] = splitAbility(name);
  const strippedAbility = ability.startsWith('adrians-') ? ability.slice('adrians-'.length) : ability;
  const namespaces = ns === 'novamira-adrianv2'
    ? ['novamira-adrianv2', 'novamira']
    : ns === 'novamira'
      ? ['novamira', 'novamira-adrianv2']
      : [ns, 'novamira-adrianv2', 'novamira'];

  for (const candidateAbility of [strippedAbility, ability]) {
    for (const candidateNs of namespaces) {
      const candidate = candidateNs ? `${candidateNs}/${candidateAbility}` : candidateAbility;
      if (isKnownAbility(candidate)) return candidate;
    }
  }
  return null;
}

/**
 * Cheap similarity for suggestions: shared-prefix length of the ability part.
 */
function closestKnown(name: string): AbilityName | undefined {
  const [, ability] = splitAbility(name);
  const target = ability.startsWith('adrians-') ? ability.slice('adrians-'.length) : ability;
  let best: AbilityName | undefined;
  let bestScore = -1;
  for (const known of KNOWN_ABILITIES) {
    const [, knownAbility] = splitAbility(known);
    let score = 0;
    const max = Math.min(target.length, knownAbility.length);
    while (score < max && target[score] === knownAbility[score]) score++;
    // Bonus for exact ability match across namespaces.
    if (knownAbility === target) score += 100;
    if (score > bestScore) {
      bestScore = score;
      best = known;
    }
  }
  return bestScore >= 3 ? best : undefined;
}

/**
 * Resolve a (possibly legacy) ability name onto a live one, or throw
 * UnknownAbilityError with a suggestion. This is the strict entry point used
 * by the MCP adapter before every ability call.
 */
export function resolveAbilityName(name: string): AbilityName {
  const resolved = tryResolveAbilityName(name);
  if (resolved) return resolved;
  throw new UnknownAbilityError(name, closestKnown(name));
}

/** Result of diffing the live server against the frozen KNOWN_ABILITIES snapshot. */
export interface AbilityDriftReport {
  liveCount: number;
  snapshotCount: number;
  /** Live on the server but missing from the snapshot → snapshot is stale. */
  addedOnServer: string[];
  /** In the snapshot but no longer live → possibly removed/renamed on the server. */
  removedFromServer: string[];
  /** Names referenced as unavailable that are NOW live → gap can be closed. */
  nowAvailable: string[];
  inSync: boolean;
}

/**
 * Diff a live ability list (from mcp-adapter-discover-abilities) against the
 * frozen snapshot. Used by `elconv doctor --sync-abilities`.
 */
export function diffAbilityRegistry(live: readonly string[]): AbilityDriftReport {
  const liveSet = new Set(live);
  const addedOnServer = [...liveSet].filter((n) => !KNOWN_SET.has(n)).sort();
  const removedFromServer = KNOWN_ABILITIES.filter((n) => !liveSet.has(n)).sort();
  const nowAvailable = Object.keys(UNAVAILABLE_ABILITIES).filter((n) => liveSet.has(n)).sort();
  return {
    liveCount: liveSet.size,
    snapshotCount: KNOWN_ABILITIES.length,
    addedOnServer,
    removedFromServer,
    nowAvailable,
    inSync: addedOnServer.length === 0 && removedFromServer.length === 0,
  };
}

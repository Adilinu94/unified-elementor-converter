/**
 * Pre-flight compatibility check — Phase 115 (BAUPLAN v4.0 V7, Phase 94).
 *
 * Pure evaluation of detected plugins + environment against the matrix. All I/O
 * (running PHP on the target site) is injected via `PhpExecutor`, so the whole
 * verdict logic here is deterministic and unit-testable.
 */

import {
  PLUGIN_MATRIX,
  PHP_COMPATIBILITY,
  versionSatisfies,
  type PluginRequirement,
} from './plugin-matrix.js';

/** A plugin as reported by the target WordPress. */
export interface DetectedPlugin {
  slug: string;
  name: string;
  version: string;
  active: boolean;
  file: string;
}

export type PluginCheckStatus = 'ok' | 'missing' | 'inactive' | 'outdated';

export interface PluginCheckResult {
  requirement: PluginRequirement;
  status: PluginCheckStatus;
  message: string;
  action: string | null;
  /**
   * Set only when an alternative slug satisfied the requirement instead of the
   * primary one, e.g. `pro-elements` standing in for `elementor-pro`.
   */
  satisfiedBySlug?: string;
}

/** Raw environment info as reported by the target WordPress. */
export interface EnvironmentInfo {
  php: string;
  wordpress: string;
  memoryLimit?: string;
  maxExecutionTime?: string;
}

export interface EnvironmentCheck {
  phpVersion: string;
  wordpressVersion: string;
  phpOk: boolean;
  wpOk: boolean;
  memoryLimit: string | null;
  warnings: string[];
}

export interface CompatibilityReport {
  mode: 'v3' | 'v4';
  timestamp: string;
  passed: boolean;
  results: PluginCheckResult[];
  environment: EnvironmentCheck;
}

/** Executes arbitrary PHP on the target WordPress, returning its stdout/return. */
export interface PhpExecutor {
  executePhp(code: string): Promise<string>;
}

/**
 * Every slug that can satisfy a requirement: the primary plus its alternatives.
 *
 * A requirement is satisfied by ANY of them. `pro-elements` is the live case —
 * it defines `ELEMENTOR_PRO_VERSION`, registers the `ElementorPro\*` classes and
 * ships a byte-identical motion-fx control group, so matching only on
 * `elementor-pro` would report Pro as missing on a fully Pro-capable site.
 */
function candidateSlugs(req: PluginRequirement): string[] {
  return [req.slug, ...(req.alternativeSlugs ?? [])];
}

/**
 * Evaluate one requirement against the detected plugin list.
 *
 * An ACTIVE alternative outranks an inactive primary. That order is what the
 * live target demands: `elementor-pro` is installed but inactive there while
 * `pro-elements` is active, and reporting `inactive` for the primary would be a
 * false negative on a site that has every Pro capability loaded.
 */
export function checkPlugin(
  req: PluginRequirement,
  installed: readonly DetectedPlugin[],
): PluginCheckResult {
  const slugs = candidateSlugs(req);
  const matches = installed.filter((p) => slugs.includes(p.slug));

  if (matches.length === 0) {
    return {
      requirement: req,
      status: 'missing',
      message: `${req.name} ist nicht installiert`,
      action: req.installUrl ? `Installieren: ${req.installUrl}` : 'Manuell installieren',
    };
  }

  const active = matches.filter((p) => p.active);
  if (active.length === 0) {
    return {
      requirement: req,
      status: 'inactive',
      message:
        matches.length === 1
          ? `${req.name} ist installiert aber nicht aktiviert`
          : `${req.name} ist installiert (${matches.map((p) => p.slug).join(', ')}) ` +
            'aber keine Variante ist aktiviert',
      action: 'Plugin aktivieren',
    };
  }

  // Among the active candidates, the highest version decides — an outdated
  // primary must not mask a current alternative.
  const best = active.reduce((a, b) => (versionSatisfies(b.version, a.version) ? b : a));
  if (!versionSatisfies(best.version, req.minVersion)) {
    return {
      requirement: req,
      status: 'outdated',
      message: `${best.name} ${best.version} < benötigte ${req.minVersion}`,
      action: `Update auf ${req.minVersion}+`,
    };
  }

  const viaAlternative = best.slug !== req.slug;
  return {
    requirement: req,
    status: 'ok',
    // Naming the provider matters for a later diagnosis: a Pro capability coming
    // from a fork is a fact a reader of the report should not have to infer.
    message: viaAlternative
      ? `${best.name} ${best.version} ✓ (erfüllt via "${best.slug}" statt "${req.slug}")`
      : `${best.name} ${best.version} ✓`,
    action: null,
    ...(viaAlternative ? { satisfiedBySlug: best.slug } : {}),
  };
}

/** Evaluate PHP + WordPress versions against PHP_COMPATIBILITY. */
export function evaluateEnvironment(env: EnvironmentInfo): EnvironmentCheck {
  const warnings: string[] = [];
  const wpOk = versionSatisfies(env.wordpress, PHP_COMPATIBILITY.minWordpress);
  // Above the highest tested WordPress version → warn, but don't hard-fail.
  if (wpOk && !versionSatisfies(PHP_COMPATIBILITY.maxWordpress, env.wordpress)) {
    warnings.push(
      `WordPress ${env.wordpress} liegt über der getesteten Maximalversion ${PHP_COMPATIBILITY.maxWordpress}`,
    );
  }
  return {
    phpVersion: env.php,
    wordpressVersion: env.wordpress,
    phpOk: versionSatisfies(env.php, PHP_COMPATIBILITY.minPhp),
    wpOk,
    memoryLimit: env.memoryLimit ?? null,
    warnings,
  };
}

/**
 * Build the full compatibility report. The pipeline may start only when every
 * REQUIRED plugin is 'ok' and the PHP + WordPress versions meet the minimum;
 * optional plugins and an above-max WordPress downgrade to warnings.
 */
export function buildCompatibilityReport(
  mode: 'v3' | 'v4',
  installed: readonly DetectedPlugin[],
  env: EnvironmentInfo,
  now: () => Date = () => new Date(),
): CompatibilityReport {
  const results = PLUGIN_MATRIX[mode].map((req) => checkPlugin(req, installed));
  const environment = evaluateEnvironment(env);
  const requiredPluginsOk = results.every((r) => !r.requirement.required || r.status === 'ok');
  return {
    mode,
    timestamp: now().toISOString(),
    passed: requiredPluginsOk && environment.phpOk && environment.wpOk,
    results,
    environment,
  };
}

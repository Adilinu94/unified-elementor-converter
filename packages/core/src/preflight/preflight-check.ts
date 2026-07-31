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

/** Evaluate one requirement against the detected plugin list. */
export function checkPlugin(
  req: PluginRequirement,
  installed: readonly DetectedPlugin[],
): PluginCheckResult {
  const found = installed.find((p) => p.slug === req.slug);
  if (!found) {
    return {
      requirement: req,
      status: 'missing',
      message: `${req.name} ist nicht installiert`,
      action: req.installUrl ? `Installieren: ${req.installUrl}` : 'Manuell installieren',
    };
  }
  if (!found.active) {
    return {
      requirement: req,
      status: 'inactive',
      message: `${req.name} ist installiert aber nicht aktiviert`,
      action: 'Plugin aktivieren',
    };
  }
  if (!versionSatisfies(found.version, req.minVersion)) {
    return {
      requirement: req,
      status: 'outdated',
      message: `${req.name} ${found.version} < benötigte ${req.minVersion}`,
      action: `Update auf ${req.minVersion}+`,
    };
  }
  return {
    requirement: req,
    status: 'ok',
    message: `${req.name} ${found.version} ✓`,
    action: null,
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

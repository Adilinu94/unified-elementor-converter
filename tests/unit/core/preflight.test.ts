import { describe, it, expect } from 'vitest';
import {
  versionSatisfies,
  checkPlugin,
  evaluateEnvironment,
  buildCompatibilityReport,
  PluginDetector,
  PLUGIN_MATRIX,
  DETECT_PLUGINS_PHP,
  buildInstallPluginPhp,
} from '@elconv/core';
import type { DetectedPlugin, EnvironmentInfo, PhpExecutor, PluginRequirement } from '@elconv/core';

const ELEMENTOR_V3 = PLUGIN_MATRIX.v3.find((r) => r.slug === 'elementor')!;

function plugin(over: Partial<DetectedPlugin> & { slug: string }): DetectedPlugin {
  return {
    slug: over.slug,
    name: over.name ?? over.slug,
    version: over.version ?? '1.0.0',
    active: over.active ?? true,
    file: over.file ?? `${over.slug}/${over.slug}.php`,
  };
}

const GOOD_ENV: EnvironmentInfo = { php: '8.3.32', wordpress: '6.5.0' };

describe('versionSatisfies', () => {
  it('accepts equal and higher versions, rejects lower', () => {
    expect(versionSatisfies('3.24.0', '3.24.0')).toBe(true);
    expect(versionSatisfies('3.25.0', '3.24.0')).toBe(true);
    expect(versionSatisfies('4.0.0', '3.24.0')).toBe(true);
    expect(versionSatisfies('3.23.9', '3.24.0')).toBe(false);
    expect(versionSatisfies('2.9.9', '3.0.0')).toBe(false);
  });
  it('handles missing patch parts and non-numeric suffixes', () => {
    expect(versionSatisfies('3.24', '3.24.0')).toBe(true);
    expect(versionSatisfies('8.3', '8.0')).toBe(true);
    expect(versionSatisfies('3.24.0-beta', '3.24.0')).toBe(true);
  });
});

describe('checkPlugin', () => {
  it('flags a required plugin that is not installed as "missing" with an install action', () => {
    const r = checkPlugin(ELEMENTOR_V3, []);
    expect(r.status).toBe('missing');
    expect(r.action).toMatch(/Manuell installieren|Installieren/);
  });
  it('flags an installed-but-inactive plugin', () => {
    const r = checkPlugin(ELEMENTOR_V3, [plugin({ slug: 'elementor', version: '3.30.0', active: false })]);
    expect(r.status).toBe('inactive');
    expect(r.action).toBe('Plugin aktivieren');
  });
  it('flags an outdated plugin with an update action', () => {
    const r = checkPlugin(ELEMENTOR_V3, [plugin({ slug: 'elementor', version: '3.10.0' })]);
    expect(r.status).toBe('outdated');
    expect(r.action).toContain('3.24.0');
  });
  it('accepts an active, up-to-date plugin', () => {
    const r = checkPlugin(ELEMENTOR_V3, [plugin({ slug: 'elementor', version: '3.30.0' })]);
    expect(r.status).toBe('ok');
    expect(r.action).toBeNull();
  });
});

/**
 * The live target runs PRO Elements instead of Elementor Pro. Measured on
 * testseite.nick-webdesign.de (2026-08-28):
 *
 *   elementor-pro/elementor-pro.php   installed, INACTIVE
 *   pro-elements/pro-elements.php     ACTIVE, 4.2.2
 *   ELEMENTOR_PRO_VERSION             4.2.2
 *   ELEMENTOR_PRO_PATH                .../plugins/pro-elements/
 *   loaded modules                    motion-fx, sticky, popup, forms, …
 *
 * `modules/motion-fx/controls-group.php` is byte-identical between the two
 * (md5 a391f93ecbaa8f9e035572a9d8df928b), so the motion-fx controls and the
 * amplitude formulas the animation mapper inverts are the same code.
 */
describe('checkPlugin — Pro provided by a fork', () => {
  const PRO_V3 = PLUGIN_MATRIX.v3.find((r) => r.slug === 'elementor-pro')!;

  it('declares elementor-pro satisfiable by pro-elements', () => {
    expect(PRO_V3.alternativeSlugs).toContain('pro-elements');
    expect(PLUGIN_MATRIX.v4.find((r) => r.slug === 'elementor-pro')!.alternativeSlugs)
      .toContain('pro-elements');
  });

  it('accepts an active alternative over an inactive primary — the live case', () => {
    const r = checkPlugin(PRO_V3, [
      plugin({ slug: 'elementor-pro', name: 'Elementor Pro', version: '3.35.1', active: false }),
      plugin({ slug: 'pro-elements', name: 'PRO Elements', version: '4.2.2', active: true }),
    ]);
    // Matching on the primary slug alone would report `inactive` on a site where
    // every Pro capability is loaded — pushing natively mappable scroll motion
    // into a WPCode fallback for no reason.
    expect(r.status).toBe('ok');
    expect(r.satisfiedBySlug).toBe('pro-elements');
    expect(r.message).toContain('pro-elements');
  });

  it('accepts the alternative alone', () => {
    const r = checkPlugin(PRO_V3, [plugin({ slug: 'pro-elements', version: '4.2.2' })]);
    expect(r.status).toBe('ok');
    expect(r.satisfiedBySlug).toBe('pro-elements');
  });

  it('does not mark a satisfiedBySlug when the primary itself is active', () => {
    const r = checkPlugin(PRO_V3, [plugin({ slug: 'elementor-pro', version: '3.35.1' })]);
    expect(r.status).toBe('ok');
    expect(r.satisfiedBySlug).toBeUndefined();
  });

  it('lets a current alternative outrank an outdated active primary', () => {
    const r = checkPlugin(
      { ...PRO_V3, minVersion: '4.0.0' },
      [
        plugin({ slug: 'elementor-pro', version: '3.35.1', active: true }),
        plugin({ slug: 'pro-elements', version: '4.2.2', active: true }),
      ],
    );
    expect(r.status).toBe('ok');
    expect(r.satisfiedBySlug).toBe('pro-elements');
  });

  it('reports inactive when both variants are installed but neither runs', () => {
    const r = checkPlugin(PRO_V3, [
      plugin({ slug: 'elementor-pro', version: '3.35.1', active: false }),
      plugin({ slug: 'pro-elements', version: '4.2.2', active: false }),
    ]);
    expect(r.status).toBe('inactive');
    expect(r.message).toContain('pro-elements');
  });

  it('reports missing when no variant is installed at all', () => {
    expect(checkPlugin(PRO_V3, []).status).toBe('missing');
  });
});

describe('evaluateEnvironment', () => {
  it('accepts a compatible environment', () => {
    const env = evaluateEnvironment(GOOD_ENV);
    expect(env.phpOk).toBe(true);
    expect(env.wpOk).toBe(true);
    expect(env.warnings).toHaveLength(0);
  });
  it('rejects an old PHP version', () => {
    expect(evaluateEnvironment({ php: '7.4.0', wordpress: '6.5.0' }).phpOk).toBe(false);
  });
  it('warns (but does not fail) above the tested max WordPress version', () => {
    const env = evaluateEnvironment({ php: '8.3.0', wordpress: '7.0.2' });
    expect(env.wpOk).toBe(true);
    expect(env.warnings.join(' ')).toMatch(/über der getesteten Maximalversion/);
  });
});

describe('buildCompatibilityReport', () => {
  const now = () => new Date('2026-07-30T00:00:00.000Z');

  it('passes when every required plugin is ok and the env is compatible', () => {
    const installed = [
      plugin({ slug: 'elementor', version: '3.30.0' }),
      plugin({ slug: 'insert-headers-and-footers', version: '2.5.0' }),
    ];
    const report = buildCompatibilityReport('v3', installed, GOOD_ENV, now);
    expect(report.passed).toBe(true);
    expect(report.timestamp).toBe('2026-07-30T00:00:00.000Z');
  });

  it('fails when a REQUIRED plugin is missing', () => {
    const installed = [plugin({ slug: 'insert-headers-and-footers', version: '2.5.0' })]; // no elementor
    expect(buildCompatibilityReport('v3', installed, GOOD_ENV, now).passed).toBe(false);
  });

  it('still passes when only an OPTIONAL plugin is missing', () => {
    // v4 requires only elementor; elementor-pro is optional.
    const installed = [plugin({ slug: 'elementor', version: '3.30.0' })];
    const report = buildCompatibilityReport('v4', installed, GOOD_ENV, now);
    expect(report.passed).toBe(true);
    expect(report.results.find((r) => r.requirement.slug === 'elementor-pro')!.status).toBe('missing');
  });

  it('reports Pro as available on the real target plugin set', () => {
    // The exact live set, trimmed to what the matrix looks at.
    const installed = [
      plugin({ slug: 'elementor', name: 'Elementor', version: '4.2.1' }),
      plugin({ slug: 'insert-headers-and-footers', name: 'WPCode Lite', version: '2.3.8' }),
      plugin({ slug: 'elementor-pro', name: 'Elementor Pro', version: '3.35.1', active: false }),
      plugin({ slug: 'pro-elements', name: 'PRO Elements', version: '4.2.2', active: true }),
    ];
    const report = buildCompatibilityReport('v3', installed, GOOD_ENV, now);
    expect(report.passed).toBe(true);
    const pro = report.results.find((r) => r.requirement.slug === 'elementor-pro')!;
    expect(pro.status).toBe('ok');
    expect(pro.satisfiedBySlug).toBe('pro-elements');
  });

  it('fails on an incompatible PHP version even when plugins are fine', () => {
    const installed = [
      plugin({ slug: 'elementor', version: '3.30.0' }),
      plugin({ slug: 'insert-headers-and-footers', version: '2.5.0' }),
    ];
    expect(buildCompatibilityReport('v3', installed, { php: '7.4', wordpress: '6.5' }, now).passed).toBe(false);
  });
});

describe('PluginDetector', () => {
  function fakePhp(plugins: unknown, env: unknown): PhpExecutor {
    return {
      executePhp: async (code: string) =>
        code.includes('get_plugins') ? JSON.stringify(plugins) : JSON.stringify(env),
    };
  }

  it('parses plugins + environment and produces a verdict via the injected executor', async () => {
    const detector = new PluginDetector(
      fakePhp(
        [
          { slug: 'elementor', name: 'Elementor', version: '3.30.0', active: true, file: 'elementor/elementor.php' },
          { slug: 'insert-headers-and-footers', name: 'WPCode Lite', version: '2.5.0', active: true, file: 'insert-headers-and-footers/wpcode.php' },
        ],
        { php: '8.3.32', wordpress: '6.5.0' },
      ),
    );
    const report = await detector.checkCompatibility('v3');
    expect(report.passed).toBe(true);
    // Optional olympus-google-fonts is absent; every REQUIRED plugin is ok.
    const required = report.results.filter((r) => r.requirement.required);
    expect(required.every((r) => r.status === 'ok')).toBe(true);
  });

  it('returns an empty plugin list when the PHP response is not an array', async () => {
    const detector = new PluginDetector(fakePhp({ error: 'boom' }, GOOD_ENV));
    expect(await detector.detectAll()).toEqual([]);
  });

  it('DETECT_PLUGINS_PHP has no opening <?php tag and returns JSON', () => {
    expect(DETECT_PLUGINS_PHP).not.toContain('<?php');
    expect(DETECT_PLUGINS_PHP).toContain('return json_encode');
  });

  it('buildInstallPluginPhp injects the sanitized slug', () => {
    const php = buildInstallPluginPhp('insert-headers-and-footers');
    expect(php).toContain("'insert-headers-and-footers'");
    expect(php).not.toContain('<?php');
    // Sanitizes anything that is not [a-z0-9-].
    expect(buildInstallPluginPhp("evil'; drop")).toContain("evildrop");
  });
});

// Type-only guard: PluginRequirement is exported and shaped as expected.
const _req: PluginRequirement = ELEMENTOR_V3;
void _req;

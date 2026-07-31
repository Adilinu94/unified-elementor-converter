/**
 * PluginDetector — Phase 115 (BAUPLAN v4.0 V7, Phase 94/95).
 *
 * Runs read-only PHP on the target WordPress (via an injected PhpExecutor, e.g.
 * the `novamira/execute-php` ability) to list installed plugins + environment,
 * then delegates the verdict to the pure `buildCompatibilityReport`.
 */

import {
  buildCompatibilityReport,
  type CompatibilityReport,
  type DetectedPlugin,
  type EnvironmentInfo,
  type PhpExecutor,
} from './preflight-check.js';

/** Read-only PHP that lists every installed plugin and its active state. */
export const DETECT_PLUGINS_PHP = `if (!function_exists('get_plugins')) {
  require_once ABSPATH . 'wp-admin/includes/plugin.php';
}
$plugins = get_plugins();
$active = get_option('active_plugins', []);
$result = [];
foreach ($plugins as $file => $data) {
  $slug = dirname($file) === '.' ? basename($file, '.php') : dirname($file);
  $result[] = [
    'slug' => $slug,
    'name' => $data['Name'],
    'version' => $data['Version'],
    'active' => in_array($file, $active),
    'file' => $file,
  ];
}
return json_encode($result);`;

/** Read-only PHP that reports the PHP + WordPress environment. */
export const DETECT_ENV_PHP = `return json_encode([
  'php' => phpversion(),
  'wordpress' => get_bloginfo('version'),
  'memoryLimit' => ini_get('memory_limit'),
  'maxExecutionTime' => ini_get('max_execution_time'),
]);`;

/** Build the PHP that installs + activates a plugin from the wp.org directory. */
export function buildInstallPluginPhp(slug: string): string {
  const s = slug.replace(/[^a-z0-9-]/gi, '');
  return `require_once ABSPATH . 'wp-admin/includes/class-wp-upgrader.php';
require_once ABSPATH . 'wp-admin/includes/plugin-install.php';
$api = plugins_api('plugin_information', ['slug' => '${s}']);
$upgrader = new Plugin_Upgrader(new Automatic_Upgrader_Skin());
$upgrader->install($api->download_link);
$activated = activate_plugin('${s}/${s}.php');
return json_encode(['slug' => '${s}', 'activated' => is_null($activated)]);`;
}

export class PluginDetector {
  constructor(private readonly php: PhpExecutor) {}

  /** List every installed plugin (empty on a non-array/garbage response). */
  async detectAll(): Promise<DetectedPlugin[]> {
    const parsed: unknown = JSON.parse(await this.php.executePhp(DETECT_PLUGINS_PHP));
    return Array.isArray(parsed) ? (parsed as DetectedPlugin[]) : [];
  }

  /** Report the target's PHP + WordPress environment. */
  async detectEnvironment(): Promise<EnvironmentInfo> {
    return JSON.parse(await this.php.executePhp(DETECT_ENV_PHP)) as EnvironmentInfo;
  }

  /** Detect everything and produce the compatibility verdict for `mode`. */
  async checkCompatibility(mode: 'v3' | 'v4'): Promise<CompatibilityReport> {
    const [installed, env] = await Promise.all([this.detectAll(), this.detectEnvironment()]);
    return buildCompatibilityReport(mode, installed, env);
  }
}

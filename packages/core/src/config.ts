/**
 * Config System — elconv.config.yaml loader and validator.
 * Supports project-level configuration for conversion defaults.
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

export interface ElconvConfig {
  version: 1;
  project: {
    name: string;
    defaultTarget: 'v3' | 'v4';
  };
  conversion: {
    preserveIds: boolean;
    generateStyles: boolean;
    strictMode: boolean;
    maxNestingDepth: number;
  };
  deploy: {
    strategy: 'auto' | 'direct' | 'upload-php' | 'split';
    chunkSize: number;
    dryRun: boolean;
    timeout: number;
  };
  qa: {
    enabled: boolean;
    viewports: Array<{ width: number; height: number; label: string }>;
    threshold: number;
    autoFix: boolean;
    maxFixRounds: number;
  };
  output: {
    directory: string;
    format: 'json' | 'pretty';
    includeMetadata: boolean;
  };
}

export const DEFAULT_CONFIG: ElconvConfig = {
  version: 1,
  project: {
    name: 'unnamed-project',
    defaultTarget: 'v3',
  },
  conversion: {
    preserveIds: true,
    generateStyles: true,
    strictMode: false,
    maxNestingDepth: 10,
  },
  deploy: {
    strategy: 'auto',
    chunkSize: 20,
    dryRun: false,
    timeout: 30000,
  },
  qa: {
    enabled: true,
    viewports: [
      { width: 1440, height: 900, label: 'desktop' },
      { width: 768, height: 1024, label: 'tablet' },
      { width: 390, height: 844, label: 'mobile' },
    ],
    threshold: 85,
    autoFix: true,
    maxFixRounds: 3,
  },
  output: {
    directory: './output',
    format: 'pretty',
    includeMetadata: true,
  },
};

export const CONFIG_FILENAME = 'elconv.config.yaml';

/**
 * Simple YAML-like parser for our config format.
 * Handles nested objects, arrays, strings, numbers, booleans.
 */
export function parseConfigYaml(content: string): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  const lines = content.split('\n');
  const stack: Array<{ obj: Record<string, unknown>; indent: number }> = [{ obj: result, indent: -1 }];

  for (const line of lines) {
    if (line.trim() === '' || line.trim().startsWith('#')) continue;

    const indent = line.search(/\S/);
    const trimmed = line.trim();

    // Pop stack to find parent
    while (stack.length > 1 && stack[stack.length - 1].indent >= indent) {
      stack.pop();
    }
    const parent = stack[stack.length - 1].obj;

    // Array item
    if (trimmed.startsWith('- ')) {
      const value = trimmed.slice(2).trim();
      // Find the array key in parent
      const keys = Object.keys(parent);
      const lastKey = keys[keys.length - 1];
      if (lastKey && Array.isArray(parent[lastKey])) {
        if (value.includes(': ')) {
          const obj: Record<string, unknown> = {};
          const [k, v] = value.split(': ');
          obj[k.trim()] = parseValue(v.trim());
          (parent[lastKey] as unknown[]).push(obj);
          stack.push({ obj, indent });
        } else {
          (parent[lastKey] as unknown[]).push(parseValue(value));
        }
      }
      continue;
    }

    // Key: value or key:
    const colonIdx = trimmed.indexOf(':');
    if (colonIdx === -1) continue;

    const key = trimmed.slice(0, colonIdx).trim();
    const valueStr = trimmed.slice(colonIdx + 1).trim();

    if (valueStr === '') {
      // Could be object or array - peek next line
      const nextLineIdx = lines.indexOf(line) + 1;
      const nextLine = nextLineIdx < lines.length ? lines[nextLineIdx] : '';
      if (nextLine.trim().startsWith('- ')) {
        parent[key] = [];
      } else {
        const child: Record<string, unknown> = {};
        parent[key] = child;
        stack.push({ obj: child, indent });
      }
    } else {
      parent[key] = parseValue(valueStr);
    }
  }

  return result;
}

function parseValue(str: string): unknown {
  if (str === 'true') return true;
  if (str === 'false') return false;
  if (str === 'null') return null;
  if (/^-?\d+$/.test(str)) return parseInt(str, 10);
  if (/^-?\d+\.\d+$/.test(str)) return parseFloat(str);
  // Remove quotes
  if ((str.startsWith('"') && str.endsWith('"')) || (str.startsWith("'") && str.endsWith("'"))) {
    return str.slice(1, -1);
  }
  return str;
}

/**
 * Serialize config to YAML-like format.
 */
export function serializeConfigYaml(config: ElconvConfig): string {
  const lines: string[] = [];

  function writeObj(obj: Record<string, unknown>, indent: number): void {
    const prefix = '  '.repeat(indent);
    for (const [key, value] of Object.entries(obj)) {
      if (value === null || value === undefined) continue;
      if (Array.isArray(value)) {
        lines.push(`${prefix}${key}:`);
        for (const item of value) {
          if (typeof item === 'object' && item !== null) {
            const entries = Object.entries(item as Record<string, unknown>);
            if (entries.length > 0) {
              lines.push(`${prefix}  - ${entries[0][0]}: ${formatValue(entries[0][1])}`);
              for (let i = 1; i < entries.length; i++) {
                lines.push(`${prefix}    ${entries[i][0]}: ${formatValue(entries[i][1])}`);
              }
            }
          } else {
            lines.push(`${prefix}  - ${formatValue(item)}`);
          }
        }
      } else if (typeof value === 'object') {
        lines.push(`${prefix}${key}:`);
        writeObj(value as Record<string, unknown>, indent + 1);
      } else {
        lines.push(`${prefix}${key}: ${formatValue(value)}`);
      }
    }
  }

  function formatValue(v: unknown): string {
    if (typeof v === 'string' && (v.includes(' ') || v.includes(':'))) return `"${v}"`;
    return String(v);
  }

  writeObj(config as unknown as Record<string, unknown>, 0);
  return lines.join('\n') + '\n';
}

/**
 * Deep merge two configs (override wins).
 */
export function mergeConfigs(base: ElconvConfig, override: Partial<ElconvConfig>): ElconvConfig {
  const result = { ...base };

  for (const [key, value] of Object.entries(override)) {
    if (value === undefined) continue;
    const k = key as keyof ElconvConfig;
    if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
      (result as Record<string, unknown>)[k] = {
        ...(base[k] as Record<string, unknown>),
        ...(value as Record<string, unknown>),
      };
    } else {
      (result as Record<string, unknown>)[k] = value;
    }
  }

  return result;
}

/**
 * Validate config structure.
 */
export function validateConfig(config: unknown): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  const c = config as Record<string, unknown>;

  if (!c || typeof c !== 'object') {
    return { valid: false, errors: ['Config must be an object'] };
  }

  if (c.version !== 1) {
    errors.push(`Unsupported config version: ${c.version}`);
  }

  if (c.project && typeof c.project === 'object') {
    const p = c.project as Record<string, unknown>;
    if (p.defaultTarget && !['v3', 'v4'].includes(p.defaultTarget as string)) {
      errors.push(`Invalid defaultTarget: ${p.defaultTarget}`);
    }
  }

  if (c.deploy && typeof c.deploy === 'object') {
    const d = c.deploy as Record<string, unknown>;
    if (d.strategy && !['auto', 'direct', 'upload-php', 'split'].includes(d.strategy as string)) {
      errors.push(`Invalid deploy strategy: ${d.strategy}`);
    }
    if (d.chunkSize && (typeof d.chunkSize !== 'number' || d.chunkSize < 1)) {
      errors.push(`Invalid chunkSize: ${d.chunkSize}`);
    }
  }

  if (c.qa && typeof c.qa === 'object') {
    const q = c.qa as Record<string, unknown>;
    if (q.threshold && (typeof q.threshold !== 'number' || q.threshold < 0 || q.threshold > 100)) {
      errors.push(`Invalid QA threshold: ${q.threshold}`);
    }
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Load config from file path.
 */
export function loadConfig(configPath: string): ElconvConfig {
  const resolvedPath = resolve(configPath);

  if (!existsSync(resolvedPath)) {
    return DEFAULT_CONFIG;
  }

  try {
    const content = readFileSync(resolvedPath, 'utf-8');
    const parsed = parseConfigYaml(content);
    const validation = validateConfig(parsed);

    if (!validation.valid) {
      console.warn(`Config validation warnings: ${validation.errors.join(', ')}`);
    }

    return mergeConfigs(DEFAULT_CONFIG, parsed as Partial<ElconvConfig>);
  } catch (err) {
    console.warn(`Failed to load config from ${resolvedPath}: ${err}`);
    return DEFAULT_CONFIG;
  }
}

/**
 * Save config to file path.
 */
export function saveConfig(configPath: string, config: ElconvConfig): void {
  const yaml = serializeConfigYaml(config);
  writeFileSync(resolve(configPath), yaml, 'utf-8');
}

/**
 * Find config file by searching up directory tree.
 */
export function findConfigFile(startDir: string): string | null {
  let dir = resolve(startDir);
  const root = resolve('/');

  while (dir !== root) {
    const configPath = resolve(dir, CONFIG_FILENAME);
    if (existsSync(configPath)) {
      return configPath;
    }
    dir = resolve(dir, '..');
  }

  return null;
}

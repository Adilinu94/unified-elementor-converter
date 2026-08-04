/**
 * Config System — elconv.config.yaml loader and validator.
 * Supports project-level configuration for conversion defaults.
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { z } from 'zod';

/**
 * Zod schema — the single source of truth for the elconv config shape (Phase 109).
 * Enforces enums, numeric ranges and required fields, and rejects unknown
 * top-level keys so a config typo fails loudly instead of being silently
 * ignored (the previous hand-rolled validateConfig only warned on a handful
 * of fields and never failed the load).
 */
const ViewportSchema = z.object({
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  label: z.string().min(1),
});

const ProjectSchema = z.object({
  name: z.string().min(1),
  defaultTarget: z.enum(['v3', 'v4']),
});

const ConversionSchema = z.object({
  preserveIds: z.boolean(),
  generateStyles: z.boolean(),
  strictMode: z.boolean(),
  maxNestingDepth: z.number().int().positive(),
});

const DeploySchema = z.object({
  strategy: z.enum(['auto', 'direct', 'upload-php', 'split']),
  chunkSize: z.number().int().positive(),
  dryRun: z.boolean(),
  timeout: z.number().int().positive(),
});

const QaSchema = z.object({
  enabled: z.boolean(),
  viewports: z.array(ViewportSchema),
  threshold: z.number().min(0).max(100),
  autoFix: z.boolean(),
  maxFixRounds: z.number().int().min(0),
});

const OutputSchema = z.object({
  directory: z.string().min(1),
  format: z.enum(['json', 'pretty']),
  includeMetadata: z.boolean(),
});

/** Full, strict schema for a complete config document. */
export const ElconvConfigSchema = z
  .object({
    version: z.literal(1),
    project: ProjectSchema,
    conversion: ConversionSchema,
    deploy: DeploySchema,
    qa: QaSchema,
    output: OutputSchema,
  })
  .strict();

export type ElconvConfig = z.infer<typeof ElconvConfigSchema>;

/**
 * Lenient counterpart used by validateConfig(): every field is optional and
 * nested objects are partial, so a *partial* config is checked field-by-field
 * (a present field must satisfy its type/enum/range) without demanding a
 * complete document. Unknown top-level keys are still rejected.
 */
const PartialConfigSchema = z
  .object({
    version: z.literal(1),
    project: ProjectSchema.partial(),
    conversion: ConversionSchema.partial(),
    deploy: DeploySchema.partial(),
    qa: QaSchema.partial(),
    output: OutputSchema.partial(),
  })
  .partial()
  .strict();

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

/** Error thrown by parseConfig()/loadConfig() when a config fails validation. */
export class ConfigValidationError extends Error {
  constructor(public readonly issues: string[]) {
    super(`Invalid elconv config:\n  - ${issues.join('\n  - ')}`);
    this.name = 'ConfigValidationError';
  }
}

/**
 * Format zod issues as "path: message" strings ("(root)" for the top level).
 * Shared by config validation and other core Zod-based contracts so error
 * reporting stays uniform across the repo.
 */
export function formatZodIssues(error: z.ZodError): string[] {
  return error.issues.map(
    (issue) => `${issue.path.length ? issue.path.join('.') : '(root)'}: ${issue.message}`,
  );
}

/**
 * Validate a (possibly partial) config against the lenient schema.
 * Returns collected error strings rather than throwing; used for soft checks
 * and by callers that want to report problems without aborting.
 */
export function validateConfig(config: unknown): { valid: boolean; errors: string[] } {
  const result = PartialConfigSchema.safeParse(config);
  if (result.success) return { valid: true, errors: [] };
  return { valid: false, errors: formatZodIssues(result.error) };
}

/**
 * Strictly parse a COMPLETE config, throwing ConfigValidationError on any
 * problem (missing field, bad enum, out-of-range number, unknown top-level
 * key). Returns a fully-typed, schema-validated config.
 */
export function parseConfig(input: unknown): ElconvConfig {
  const result = ElconvConfigSchema.safeParse(input);
  if (!result.success) {
    throw new ConfigValidationError(formatZodIssues(result.error));
  }
  return result.data;
}

/**
 * Load config from file path. A missing file yields DEFAULT_CONFIG; a present
 * file is parsed, merged over the defaults, then STRICTLY validated — an
 * invalid config now throws ConfigValidationError (fail-hard, Phase 109)
 * instead of silently falling back to defaults.
 */
export function loadConfig(configPath: string): ElconvConfig {
  const resolvedPath = resolve(configPath);

  if (!existsSync(resolvedPath)) {
    return DEFAULT_CONFIG;
  }

  const content = readFileSync(resolvedPath, 'utf-8');
  const parsed = parseConfigYaml(content);
  const merged = mergeConfigs(DEFAULT_CONFIG, parsed as Partial<ElconvConfig>);
  return parseConfig(merged);
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

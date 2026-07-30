import { describe, it, expect } from 'vitest';
import {
  DEFAULT_CONFIG,
  CONFIG_FILENAME,
  parseConfigYaml,
  serializeConfigYaml,
  mergeConfigs,
  validateConfig,
  parseConfig,
  ElconvConfigSchema,
  ConfigValidationError,
  type ElconvConfig,
} from '@elconv/core';

describe('Config System', () => {
  describe('DEFAULT_CONFIG', () => {
    it('has version 1', () => {
      expect(DEFAULT_CONFIG.version).toBe(1);
    });

    it('defaults to v3 target', () => {
      expect(DEFAULT_CONFIG.project.defaultTarget).toBe('v3');
    });

    it('has 3 QA viewports', () => {
      expect(DEFAULT_CONFIG.qa.viewports).toHaveLength(3);
    });

    it('has auto deploy strategy', () => {
      expect(DEFAULT_CONFIG.deploy.strategy).toBe('auto');
    });
  });

  describe('parseConfigYaml', () => {
    it('parses simple key-value pairs', () => {
      const result = parseConfigYaml('name: test\nversion: 1');
      expect(result.name).toBe('test');
      expect(result.version).toBe(1);
    });

    it('parses booleans', () => {
      const result = parseConfigYaml('enabled: true\ndisabled: false');
      expect(result.enabled).toBe(true);
      expect(result.disabled).toBe(false);
    });

    it('parses nested objects', () => {
      const yaml = `project:\n  name: my-project\n  defaultTarget: v4`;
      const result = parseConfigYaml(yaml);
      expect((result.project as Record<string, unknown>).name).toBe('my-project');
      expect((result.project as Record<string, unknown>).defaultTarget).toBe('v4');
    });

    it('parses arrays', () => {
      const yaml = `items:\n  - one\n  - two\n  - three`;
      const result = parseConfigYaml(yaml);
      expect(result.items).toEqual(['one', 'two', 'three']);
    });

    it('parses quoted strings', () => {
      const result = parseConfigYaml('path: "./output dir"');
      expect(result.path).toBe('./output dir');
    });

    it('skips comments', () => {
      const result = parseConfigYaml('# comment\nname: test');
      expect(result.name).toBe('test');
      expect(Object.keys(result)).toHaveLength(1);
    });
  });

  describe('serializeConfigYaml', () => {
    it('serializes config to YAML', () => {
      const yaml = serializeConfigYaml(DEFAULT_CONFIG);
      expect(yaml).toContain('version: 1');
      expect(yaml).toContain('defaultTarget: v3');
      expect(yaml).toContain('chunkSize: 20');
    });

    it('round-trips config', () => {
      const yaml = serializeConfigYaml(DEFAULT_CONFIG);
      const parsed = parseConfigYaml(yaml);
      expect(parsed.version).toBe(1);
      expect((parsed.project as Record<string, unknown>).defaultTarget).toBe('v3');
    });
  });

  describe('mergeConfigs', () => {
    it('merges override into base', () => {
      const merged = mergeConfigs(DEFAULT_CONFIG, {
        project: { name: 'custom', defaultTarget: 'v4' },
      });
      expect(merged.project.name).toBe('custom');
      expect(merged.project.defaultTarget).toBe('v4');
      expect(merged.deploy.strategy).toBe('auto');
    });

    it('preserves base for missing keys', () => {
      const merged = mergeConfigs(DEFAULT_CONFIG, {});
      expect(merged).toEqual(DEFAULT_CONFIG);
    });

    it('overrides nested values', () => {
      const merged = mergeConfigs(DEFAULT_CONFIG, {
        deploy: { strategy: 'direct', chunkSize: 50, dryRun: true, timeout: 60000 },
      });
      expect(merged.deploy.strategy).toBe('direct');
      expect(merged.deploy.chunkSize).toBe(50);
    });
  });

  describe('validateConfig', () => {
    it('validates correct config', () => {
      const result = validateConfig(DEFAULT_CONFIG);
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('rejects wrong version', () => {
      const result = validateConfig({ version: 2 });
      expect(result.valid).toBe(false);
      expect(result.errors[0]).toContain('version');
    });

    it('rejects invalid target', () => {
      const result = validateConfig({ version: 1, project: { defaultTarget: 'v5' } });
      expect(result.valid).toBe(false);
      expect(result.errors[0]).toContain('defaultTarget');
    });

    it('rejects invalid deploy strategy', () => {
      const result = validateConfig({ version: 1, deploy: { strategy: 'teleport' } });
      expect(result.valid).toBe(false);
    });

    it('rejects invalid threshold', () => {
      const result = validateConfig({ version: 1, qa: { threshold: 150 } });
      expect(result.valid).toBe(false);
    });

    it('rejects non-object', () => {
      const result = validateConfig('not an object');
      expect(result.valid).toBe(false);
    });

    it('accepts a partial config when every present field is valid', () => {
      const result = validateConfig({ version: 1, qa: { threshold: 90 } });
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('rejects an unknown top-level key', () => {
      const result = validateConfig({ version: 1, bogus: true });
      expect(result.valid).toBe(false);
    });
  });

  describe('ElconvConfigSchema / parseConfig (strict, Phase 109)', () => {
    it('the schema accepts DEFAULT_CONFIG', () => {
      expect(ElconvConfigSchema.safeParse(DEFAULT_CONFIG).success).toBe(true);
    });

    it('parseConfig returns a fully-typed config for a valid document', () => {
      const cfg = parseConfig(DEFAULT_CONFIG);
      expect(cfg.qa.threshold).toBe(85);
      expect(cfg.project.defaultTarget).toBe('v3');
    });

    it('parseConfig throws ConfigValidationError on an incomplete config', () => {
      expect(() => parseConfig({ version: 1 })).toThrow(ConfigValidationError);
    });

    it('parseConfig throws on an out-of-range QA threshold', () => {
      const bad = structuredClone(DEFAULT_CONFIG);
      bad.qa.threshold = 150;
      expect(() => parseConfig(bad)).toThrow(ConfigValidationError);
    });

    it('parseConfig error names the invalid enum path', () => {
      const bad = structuredClone(DEFAULT_CONFIG) as Record<string, unknown>;
      (bad.project as Record<string, unknown>).defaultTarget = 'v5';
      expect(() => parseConfig(bad)).toThrow(/defaultTarget/);
    });

    it('parseConfig rejects unknown top-level keys (config typo guard)', () => {
      expect(() => parseConfig({ ...DEFAULT_CONFIG, deploi: {} })).toThrow(ConfigValidationError);
    });
  });

  describe('CONFIG_FILENAME', () => {
    it('is elconv.config.yaml', () => {
      expect(CONFIG_FILENAME).toBe('elconv.config.yaml');
    });
  });
});

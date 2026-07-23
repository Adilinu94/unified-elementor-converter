import { describe, it, expect } from 'vitest';
import {
  DEFAULT_CONFIG,
  CONFIG_FILENAME,
  parseConfigYaml,
  serializeConfigYaml,
  mergeConfigs,
  validateConfig,
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
  });

  describe('CONFIG_FILENAME', () => {
    it('is elconv.config.yaml', () => {
      expect(CONFIG_FILENAME).toBe('elconv.config.yaml');
    });
  });
});

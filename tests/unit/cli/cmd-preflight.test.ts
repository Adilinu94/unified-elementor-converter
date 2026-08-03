import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { cmdPreflight, mcpPhpExecutor, runLivePreflight } from '../../../packages/cli/src/cmd-preflight.js';
import type { McpAdapter } from '@elconv/mcp';
import type { PhpExecutor } from '@elconv/core';

const AUTH_ENV = 'PF_TEST_AUTH';
const BASE = { 'mcp-url': 'http://wp.test', 'auth-env': AUTH_ENV } as const;

interface FakeState {
  plugins: unknown;
  env: unknown;
  installed: string[];
}

/** A PhpExecutor that answers the detection snippets and records installs. */
function fakeExecutor(state: FakeState): PhpExecutor {
  return {
    executePhp: async (code: string) => {
      if (code.includes('get_plugins')) return JSON.stringify(state.plugins);
      if (code.includes('phpversion')) return JSON.stringify(state.env);
      const m = code.match(/'slug' => '([^']+)'/);
      if (m) state.installed.push(m[1]!);
      return JSON.stringify({ slug: m?.[1], activated: true });
    },
  };
}

const GOOD_ENV = { php: '8.3.32', wordpress: '6.5.0' };

describe('cmdPreflight', () => {
  let out: string[];

  beforeEach(() => {
    process.env[AUTH_ENV] = 'user:app-password';
    out = [];
    vi.spyOn(process.stdout, 'write').mockImplementation((chunk: unknown) => {
      out.push(String(chunk));
      return true;
    });
    vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
  });
  afterEach(() => {
    vi.restoreAllMocks();
    delete process.env[AUTH_ENV];
  });

  it('evaluates realistic MCP discovery, setup, and execute-php responses for live preflight', async () => {
    const executeAbility = vi.fn(async (name: string, parameters: Record<string, unknown>) => {
      if (name === 'novamira/elementor-check-setup') {
        return {
          success: true,
          data: {
            elementor: { active: true, version: '3.30.0' },
            atomic: { runtime_available: true },
          },
        };
      }
      if (name === 'novamira/execute-php') {
        const code = String(parameters.code);
        return {
          success: true,
          data: {
            success: true,
            return_value: code.includes('get_plugins')
              ? JSON.stringify([{ slug: 'elementor', name: 'Elementor', version: '3.30.0', active: true, file: 'elementor/elementor.php' }])
              : JSON.stringify({ php: '8.3.32', wordpress: '6.5.0' }),
          },
        };
      }
      throw new Error(`unexpected ability: ${name}`);
    });
    const adapter = {
      listAbilities: vi.fn(async () => [
        'mcp-adapter/discover-abilities',
        'novamira/elementor-check-setup',
        'novamira/execute-php',
        'novamira-adrianv2/batch-build-page',
      ]),
      executeAbility,
    } as unknown as McpAdapter;

    const result = await runLivePreflight(adapter, 'v4');

    expect(result.passed).toBe(true);
    expect(result.message).toContain('Live preflight passed');
    expect(executeAbility).toHaveBeenCalledWith('novamira/elementor-check-setup', {});
    expect(executeAbility).toHaveBeenCalledWith('novamira/execute-php', expect.objectContaining({ code: expect.stringContaining('get_plugins') }));
    expect(executeAbility).toHaveBeenCalledWith('novamira/execute-php', expect.objectContaining({ code: expect.stringContaining('phpversion') }));
  });

  it('accepts a live-style execute-php data wrapper', async () => {
    const executor = mcpPhpExecutor({
      executeAbility: vi.fn(async () => ({
        success: true,
        data: { success: true, output: 'wrapped-output' },
      })),
    } as unknown as McpAdapter);

    await expect(executor.executePhp('echo 1;')).resolves.toBe('wrapped-output');
  });

  it('exits 0 when every required plugin and the env are compatible (v4)', async () => {
    const state: FakeState = {
      plugins: [{ slug: 'elementor', name: 'Elementor', version: '3.30.0', active: true, file: 'elementor/elementor.php' }],
      env: GOOD_ENV,
      installed: [],
    };
    const code = await cmdPreflight({ ...BASE, mode: 'v4' }, () => fakeExecutor(state));
    expect(code).toBe(0);
    expect(out.join('')).toContain('BESTANDEN');
  });

  it('exits 1 when a required plugin is missing (v3)', async () => {
    const state: FakeState = {
      plugins: [{ slug: 'wpcode-lite', name: 'WPCode Lite', version: '2.5.0', active: true, file: 'wpcode-lite/w.php' }],
      env: GOOD_ENV,
      installed: [],
    };
    const code = await cmdPreflight({ ...BASE, mode: 'v3' }, () => fakeExecutor(state));
    expect(code).toBe(1);
    expect(out.join('')).toContain('FEHLGESCHLAGEN');
  });

  it('exits 2 for an invalid --mode', async () => {
    const code = await cmdPreflight({ ...BASE, mode: 'v9' }, () => fakeExecutor({ plugins: [], env: GOOD_ENV, installed: [] }));
    expect(code).toBe(2);
  });

  it('exits 2 when --mcp-url / --auth-env are missing', async () => {
    const code = await cmdPreflight({ mode: 'v3' }, () => fakeExecutor({ plugins: [], env: GOOD_ENV, installed: [] }));
    expect(code).toBe(2);
  });

  it('emits a machine-readable report with --json', async () => {
    const state: FakeState = {
      plugins: [{ slug: 'elementor', name: 'Elementor', version: '3.30.0', active: true, file: 'elementor/elementor.php' }],
      env: GOOD_ENV,
      installed: [],
    };
    const code = await cmdPreflight({ ...BASE, mode: 'v4', json: true }, () => fakeExecutor(state));
    expect(code).toBe(0);
    const jsonLine = out.find((s) => s.includes('"passed"'))!;
    const report = JSON.parse(jsonLine) as { passed: boolean; mode: string };
    expect(report.mode).toBe('v4');
    expect(report.passed).toBe(true);
    // Human decoration is suppressed in JSON mode.
    expect(out.join('')).not.toContain('BESTANDEN');
  });

  it('--fix installs missing plugins that have an install URL', async () => {
    // v3 requires elementor (no installUrl) + WPCode Lite (has installUrl); both missing.
    const state: FakeState = { plugins: [], env: GOOD_ENV, installed: [] };
    const code = await cmdPreflight({ ...BASE, mode: 'v3', fix: true }, () => fakeExecutor(state));
    expect(code).toBe(1); // still reports failure for this run
    expect(state.installed).toContain('insert-headers-and-footers'); // has installUrl → auto-installed
    expect(state.installed).not.toContain('elementor'); // no installUrl → not auto-installed
  });
});

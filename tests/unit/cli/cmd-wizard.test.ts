import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { existsSync, rmSync } from 'node:fs';

// Mock the interactive prompt layer so the wizard can be driven headlessly.
// vi.mock is hoisted above the static imports below, so the SUT sees the mock.
vi.mock('@inquirer/prompts', () => ({
  select: vi.fn(),
  input: vi.fn(),
  confirm: vi.fn(),
}));

import { select, input, confirm } from '@inquirer/prompts';
import { cmdWizard, collectWizardOptionsInteractive } from '../../../packages/cli/src/cmd-wizard.js';

describe('collectWizardOptionsInteractive', () => {
  it('collects a V4 + live-URL + dry-run build from the prompts', async () => {
    vi.mocked(select)
      .mockResolvedValueOnce('v4' as never) // target
      .mockResolvedValueOnce('url' as never); // source type
    vi.mocked(input).mockResolvedValueOnce('https://example.com' as never); // url
    vi.mocked(input).mockResolvedValueOnce('./out/v4-tree.json' as never); // output
    vi.mocked(confirm)
      .mockResolvedValueOnce(false as never) // deploy now?
      .mockResolvedValueOnce(true as never); // dry run?

    vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const opts = await collectWizardOptionsInteractive();

    expect(opts.target).toBe('v4');
    expect(opts.url).toBe('https://example.com');
    expect(opts.xml).toBeUndefined();
    expect(opts.html).toBeUndefined();
    expect(opts.out).toBe('./out/v4-tree.json');
    expect(opts.postId).toBeUndefined();
    expect(opts.dryRun).toBe(true);
  });
});

describe('cmdWizard — mode branching', () => {
  beforeEach(() => {
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns 2 for --no-interactive without a target', async () => {
    const code = await cmdWizard({ 'no-interactive': true });
    expect(code).toBe(2);
  });

  it('returns 2 when interactive mode is requested without a TTY', async () => {
    const original = process.stdin.isTTY;
    Object.defineProperty(process.stdin, 'isTTY', { value: false, configurable: true });
    try {
      const code = await cmdWizard({}); // no target, no --no-interactive → interactive path
      expect(code).toBe(2);
    } finally {
      Object.defineProperty(process.stdin, 'isTTY', { value: original, configurable: true });
    }
  });

  it('runs the flag-mode state machine end-to-end in dry-run and returns 0', async () => {
    const stateFile = join(tmpdir(), `elconv-wizard-${Math.random().toString(36).slice(2)}.json`);
    try {
      const code = await cmdWizard({
        target: 'v3',
        html: './some-source.html', // preflight requires a source; dry-run never reads it
        'dry-run': true,
        'state-file': stateFile,
      });
      expect(code).toBe(0);
      // State was persisted so --resume can pick up.
      expect(existsSync(stateFile)).toBe(true);
    } finally {
      if (existsSync(stateFile)) rmSync(stateFile);
    }
  });

  it('rejects an invalid --target in flag mode with exit code 2', async () => {
    const code = await cmdWizard({ target: 'v5', 'no-interactive': true });
    expect(code).toBe(2);
  });
});

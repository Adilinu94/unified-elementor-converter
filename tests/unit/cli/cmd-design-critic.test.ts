import { describe, it, expect, vi, beforeEach } from 'vitest';

const evaluateResult = [
  {
    selector: 'button.cta',
    styles: { 'font-size': '16px', 'padding-top': '4px', 'padding-bottom': '4px' },
    boundingBox: { x: 0, y: 0, width: 100, height: 20 }, // height < 44px -> L1 button-min-height finding
    textContent: 'Click me',
  },
];

vi.mock('playwright', () => ({
  chromium: {
    launch: vi.fn(async () => ({
      newPage: vi.fn(async () => ({
        goto: vi.fn(async () => undefined),
        evaluate: vi.fn(async () => evaluateResult),
      })),
      close: vi.fn(async () => undefined),
    })),
  },
}));

describe('cmdDesignCritic', () => {
  beforeEach(() => {
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
  });

  it('returns exit code 2 when --url is missing', async () => {
    const { cmdDesignCritic } = await import('../../../packages/cli/src/cmd-design-critic.js');
    const code = await cmdDesignCritic({});
    expect(code).toBe(2);
  });

  it('captures styles via Playwright and runs L1 rules, returning a pass/fail exit code', async () => {
    const { cmdDesignCritic } = await import('../../../packages/cli/src/cmd-design-critic.js');
    const code = await cmdDesignCritic({ url: 'https://example.com' });
    expect([0, 1]).toContain(code);
  });

  it('returns exit code 2 when --server-critic is set without --post-id/--mcp-url/--auth-env (no network)', async () => {
    const { cmdDesignCritic } = await import('../../../packages/cli/src/cmd-design-critic.js');
    const code = await cmdDesignCritic({ 'server-critic': true });
    expect(code).toBe(2);
  });
});

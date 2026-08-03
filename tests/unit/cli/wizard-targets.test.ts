import { describe, expect, it } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { loadWizardTargetProfiles } from '../../../packages/cli/src/wizard-targets.js';

describe('wizard target profiles', () => {
  it('imports legacy profiles without persisting credentials', () => {
    const root = join(tmpdir(), `elconv-targets-${Math.random().toString(36).slice(2)}`);
    mkdirSync(join(root, '.clone-v3'), { recursive: true });
    writeFileSync(join(root, '.clone-v3', 'profiles.json'), JSON.stringify({
      targets: {
        staging: {
          label: 'Staging',
          url: 'https://staging.example.com',
          mcp_endpoint: 'https://staging.example.com/mcp',
          auth_token: 'redacted',
          elementor_version: '4.2.1',
          pro: true,
          retryPolicy: { maxRetries: 4, backoffMs: 250 },
        },
      },
    }));

    const [profile] = loadWizardTargetProfiles({ homeDir: root, cwd: join(root, 'project') });
    expect(profile).toMatchObject({
      name: 'staging',
      source: 'clone-v3',
      label: 'Staging',
      siteUrl: 'https://staging.example.com',
      mcpUrl: 'https://staging.example.com/mcp',
      elementorVersion: '4.2.1',
      pro: true,
      retryPolicy: { maxRetries: 4, backoffMs: 250 },
    });
    expect(JSON.stringify(profile)).not.toContain('redacted');
  });

  it('lets project-local targets override legacy targets by name', () => {
    const root = join(tmpdir(), `elconv-targets-${Math.random().toString(36).slice(2)}`);
    mkdirSync(join(root, '.clone-v3'), { recursive: true });
    mkdirSync(join(root, '.elconv'), { recursive: true });
    writeFileSync(join(root, '.clone-v3', 'profiles.json'), JSON.stringify({
      targets: { same: { url: 'https://legacy.example.com', mcp_endpoint: 'https://legacy.example.com/mcp' } },
    }));
    writeFileSync(join(root, '.elconv', 'targets.json'), JSON.stringify([
      { name: 'same', siteUrl: 'https://local.example.com', mcpUrl: 'https://local.example.com/mcp', description: 'Local' },
    ]));

    const [profile] = loadWizardTargetProfiles({ homeDir: root, cwd: root });
    expect(profile.source).toBe('elconv');
    expect(profile.siteUrl).toBe('https://local.example.com');
  });
});

import { existsSync, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export type WizardTargetProfileSource = 'clone-v3' | 'elconv';

/** Metadata the wizard may persist; credentials are deliberately excluded. */
export interface WizardTargetProfile {
  name: string;
  source: WizardTargetProfileSource;
  label: string;
  siteUrl: string;
  mcpUrl: string;
  elementorVersion?: string;
  pro?: boolean;
  retryPolicy?: { maxRetries: number; backoffMs: number };
}

interface LegacyProfile {
  label?: unknown;
  url?: unknown;
  mcp_endpoint?: unknown;
  elementor_version?: unknown;
  pro?: unknown;
  retryPolicy?: unknown;
}

interface LocalTarget {
  name?: unknown;
  mcpUrl?: unknown;
  siteUrl?: unknown;
  description?: unknown;
}

function readJson(filePath: string): unknown | null {
  if (!existsSync(filePath)) return null;
  try {
    return JSON.parse(readFileSync(filePath, 'utf8')) as unknown;
  } catch {
    return null;
  }
}

function retryPolicy(value: unknown): WizardTargetProfile['retryPolicy'] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  return typeof record.maxRetries === 'number' && typeof record.backoffMs === 'number'
    ? { maxRetries: record.maxRetries, backoffMs: record.backoffMs }
    : undefined;
}

function loadLegacyProfiles(homeDir: string): WizardTargetProfile[] {
  const parsed = readJson(path.join(homeDir, '.clone-v3', 'profiles.json'));
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return [];
  const targets = (parsed as { targets?: unknown }).targets;
  if (!targets || typeof targets !== 'object' || Array.isArray(targets)) return [];

  return Object.entries(targets as Record<string, LegacyProfile>).flatMap(([name, value]) => {
    if (!value || typeof value !== 'object') return [];
    const mcpUrl = typeof value.mcp_endpoint === 'string' ? value.mcp_endpoint : '';
    const siteUrl = typeof value.url === 'string' ? value.url : '';
    if (!mcpUrl || !siteUrl) return [];
    return [{
      name,
      source: 'clone-v3' as const,
      label: typeof value.label === 'string' && value.label.trim() ? value.label : name,
      siteUrl,
      mcpUrl,
      elementorVersion: typeof value.elementor_version === 'string' ? value.elementor_version : undefined,
      pro: typeof value.pro === 'boolean' ? value.pro : undefined,
      retryPolicy: retryPolicy(value.retryPolicy),
    }];
  });
}

function loadLocalTargets(cwd: string): WizardTargetProfile[] {
  const parsed = readJson(path.join(cwd, '.elconv', 'targets.json'));
  if (!Array.isArray(parsed)) return [];

  return parsed.flatMap((value: LocalTarget) => {
    if (!value || typeof value !== 'object') return [];
    const name = typeof value.name === 'string' ? value.name.trim() : '';
    const mcpUrl = typeof value.mcpUrl === 'string' ? value.mcpUrl.trim() : '';
    const siteUrl = typeof value.siteUrl === 'string' ? value.siteUrl.trim() : '';
    if (!name || !mcpUrl || !siteUrl) return [];
    return [{
      name,
      source: 'elconv' as const,
      label: typeof value.description === 'string' && value.description.trim() ? value.description : name,
      siteUrl,
      mcpUrl,
    }];
  });
}

/** Load both supported stores; local project targets take precedence by name. */
export function loadWizardTargetProfiles(options: { homeDir?: string; cwd?: string } = {}): WizardTargetProfile[] {
  const legacy = loadLegacyProfiles(options.homeDir ?? os.homedir());
  const local = loadLocalTargets(options.cwd ?? process.cwd());
  const byName = new Map<string, WizardTargetProfile>();
  for (const profile of legacy) byName.set(profile.name, profile);
  for (const profile of local) byName.set(profile.name, profile);
  return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
}

export function findWizardTargetProfile(
  name: string,
  options: { homeDir?: string; cwd?: string } = {},
): WizardTargetProfile | undefined {
  return loadWizardTargetProfiles(options).find((profile) => profile.name === name);
}

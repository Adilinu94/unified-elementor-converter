/**
 * Named WordPress targets stored in ~/.config/elconv/targets.json
 * Auth ONLY via environment variable name — never store passwords.
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

export interface WpTarget {
  mcpEndpoint: string;
  authEnv: string; // Name of env var containing "user:app-password"
  defaultTemplate: 'elementor_canvas' | 'elementor_header_footer' | 'default';
  label?: string;
}

export interface TargetStore {
  targets: Record<string, WpTarget>;
}

function defaultConfigPath(): string {
  return join(homedir(), '.config', 'elconv', 'targets.json');
}

export function loadTargets(configPath?: string): TargetStore {
  const path = configPath ?? defaultConfigPath();
  if (!existsSync(path)) return { targets: {} };
  try {
    return JSON.parse(readFileSync(path, 'utf-8')) as TargetStore;
  } catch {
    return { targets: {} };
  }
}

export function saveTargets(store: TargetStore, configPath?: string): void {
  const path = configPath ?? defaultConfigPath();
  mkdirSync(join(path, '..'), { recursive: true });
  writeFileSync(path, JSON.stringify(store, null, 2), 'utf-8');
}

export function getTarget(name: string, configPath?: string): WpTarget {
  const store = loadTargets(configPath);
  const target = store.targets[name];
  if (!target) {
    const available = Object.keys(store.targets).join(', ') || '(none)';
    throw new Error(`Target "${name}" not found. Available: ${available}`);
  }
  return target;
}

export function addTarget(name: string, target: WpTarget, configPath?: string): void {
  const store = loadTargets(configPath);
  store.targets[name] = target;
  saveTargets(store, configPath);
}

export function removeTarget(name: string, configPath?: string): boolean {
  const store = loadTargets(configPath);
  if (!(name in store.targets)) return false;
  delete store.targets[name];
  saveTargets(store, configPath);
  return true;
}

/**
 * Resolve auth credentials from environment variable.
 * The env var should contain "user:app-password" format.
 */
export function resolveAuth(target: WpTarget): string {
  const value = process.env[target.authEnv];
  if (!value) {
    throw new Error(
      `Environment variable "${target.authEnv}" not set. ` +
      `Set it to "username:application-password" for target auth.`,
    );
  }
  return value;
}

/**
 * Build the Authorization header value from a target.
 */
export function buildAuthHeader(target: WpTarget): string {
  const credentials = resolveAuth(target);
  return `Basic ${Buffer.from(credentials).toString('base64')}`;
}

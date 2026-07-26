/**
 * Cross-platform path helpers.
 * Critical: never use `~/` directly — Windows shells do not expand tilde
 * in node fs operations. Always go through os.homedir().
 */
import os from 'node:os';
import path from 'node:path';

export const CLONE_V3_HOME = path.join(os.homedir(), '.clone-v3');

export function profilesPath(): string {
  return path.join(CLONE_V3_HOME, 'profiles.json');
}

export function sourceAuthPath(): string {
  return path.join(CLONE_V3_HOME, 'source-auth.json');
}

export function cachePath(hostname: string): string {
  return path.join(CLONE_V3_HOME, 'cache', hostname);
}

export function researchPath(hostname: string): string {
  return path.join('research', hostname);
}

export function hostnameFromUrl(url: string): string {
  try {
    const u = new URL(url);
    return u.hostname.replace(/[^a-z0-9.-]/gi, '_').toLowerCase();
  } catch {
    return 'unknown-host';
  }
}

/**
 * WP-Target-Profile-Loader.
 *
 * Persistiert konfigurierte WordPress-Targets (z.B. yoursite.local, test4, custom
 * staging) in `~/.clone-v3/profiles.json` mit `os.homedir()`-basierter
 * Pfad-Auflösung (Windows-Tilde-Expansion-Fix aus Plan-Audit).
 *
 * Profil-Format:
 * ```json
 * {
 *   "targets": {
 *     "yoursite-local": {
 *       "label": "Solar (Dev)",
 *       "url": "https://yoursite.local",
 *       "mcp_endpoint": "https://yoursite.local/wp-json/mcp/novamira",
 *       "auth_token": "...",
 *       "elementor_version": "4.1.1",
 *       "pro": true,
 *       "source_auth": { ... }
 *     }
 *   }
 * }
 * ```
 */

import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import type { SourceAuth } from './source-auth.js';

export interface TargetProfile {
  label: string;
  url: string;
  mcp_endpoint: string;
  auth_token: string;
  elementor_version: string;
  pro: boolean;
  source_auth?: SourceAuth;
  /** Overrides McpAdapter's defaults (30s/3/500ms) for this target. */
  retryPolicy?: { maxRetries: number; backoffMs: number };
  /**
   * NOT YET CONSUMED ANYWHERE — no client-side batching concept exists to
   * apply this to (the only server-side "limit" param, on
   * convert-site-v3-to-v4, is set per-call, not per-profile). Stored for
   * when that changes; safe to ignore until then.
   */
  mcpBatchSize?: number;
}

export interface ProfilesFile {
  targets: Record<string, TargetProfile>;
}

const CLONE_V3_DIR = '.clone-v3';
const PROFILES_FILE = 'profiles.json';

/** `~/.clone-v3/profiles.json` — `os.homedir()` statt `~/` für Windows-Kompatibilität. */
export function profilesPath(homeDir: string = os.homedir()): string {
  return path.join(homeDir, CLONE_V3_DIR, PROFILES_FILE);
}

/**
 * Lädt alle konfigurierten Targets. Wirft NICHT wenn die Datei nicht
 * existiert — gibt dann leeres Profile-File zurück.
 */
export async function loadProfiles(
  homeDir: string = os.homedir(),
): Promise<ProfilesFile> {
  const file = profilesPath(homeDir);
  try {
    const raw = await fs.readFile(file, 'utf-8');
    return JSON.parse(raw) as ProfilesFile;
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return { targets: {} };
    }
    throw err;
  }
}

export async function saveProfiles(
  profiles: ProfilesFile,
  homeDir: string = os.homedir(),
): Promise<void> {
  const dir = path.join(homeDir, CLONE_V3_DIR);
  await fs.mkdir(dir, { recursive: true });
  const file = profilesPath(homeDir);
  await fs.writeFile(file, JSON.stringify(profiles, null, 2), { mode: 0o600 });
}

export async function getTarget(
  name: string,
  homeDir: string = os.homedir(),
): Promise<TargetProfile | null> {
  const profiles = await loadProfiles(homeDir);
  return profiles.targets[name] ?? null;
}

export async function upsertTarget(
  name: string,
  profile: TargetProfile,
  homeDir: string = os.homedir(),
): Promise<void> {
  const profiles = await loadProfiles(homeDir);
  profiles.targets[name] = profile;
  await saveProfiles(profiles, homeDir);
}

export async function deleteTarget(
  name: string,
  homeDir: string = os.homedir(),
): Promise<boolean> {
  const profiles = await loadProfiles(homeDir);
  if (!(name in profiles.targets)) return false;
  delete profiles.targets[name];
  await saveProfiles(profiles, homeDir);
  return true;
}

/**
 * Bestimmt, ob die Elementor-Version V3 oder V4 ist.
 * Cache-Flush und Atomic-Tree-Strukturen unterscheiden sich:
 * - V3: `wp elementor regenerate-css`, Section/Column/Widget-Struktur
 * - V4: `wp elementor flush-css`, Atomic e-* Trees, Global Variables
 */
export function isElementorV4(version: string): boolean {
  return version.startsWith('4.');
}

export function isElementorV3(version: string): boolean {
  return version.startsWith('3.');
}

/**
 * Auto-Add-from-env: Liest `NOVAMIRA_TARGET_URL` und `NOVAMIRA_TOKEN`.
 * Wenn gesetzt und Profil nicht vorhanden, wird es auto-erzeugt mit
 * Defaults für `elementor_version` und `pro`.
 */
export async function autoAddFromEnv(
  homeDir: string = os.homedir(),
): Promise<{ added: string; profile: TargetProfile } | null> {
  const url = process.env.NOVAMIRA_TARGET_URL;
  const token = process.env.NOVAMIRA_TOKEN;
  if (!url || !token) return null;

  const profiles = await loadProfiles(homeDir);
  // Wenn schon ein Target mit dieser URL existiert, nichts tun.
  const existing = Object.entries(profiles.targets).find(
    ([, p]) => p.url === url,
  );
  if (existing) return null;

  const slug = new URL(url).hostname.replace(/[^a-z0-9]+/gi, '-').toLowerCase();
  const profile: TargetProfile = {
    label: `Auto: ${new URL(url).hostname}`,
    url,
    mcp_endpoint: `${url.replace(/\/$/, '')}/wp-json/mcp/novamira`,
    auth_token: token,
    elementor_version: '4.0.0', // Conservative default; user kann überstimmen
    pro: false,
  };
  await upsertTarget(slug, profile, homeDir);
  return { added: slug, profile };
}

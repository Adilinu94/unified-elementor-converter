/**
 * update-checker — Query npm registry for newer versions of clone-v3.
 *
 * Designed to be called once at the start of a long-running pipeline.
 * Network failures are silent (we never block on a flaky registry call).
 */

const NPM_REGISTRY = 'https://registry.npmjs.org/clone-v3';
const CACHE_FILE = '.clone-v3-update-cache.json';
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

export interface UpdateCheckResult {
  current: string;
  latest: string;
  isOutdated: boolean;
  checkedAt: number;
  fromCache: boolean;
}

export type UpdateCheckFn = () => Promise<UpdateCheckResult | null>;

/** Read cached check from disk (if still fresh). Returns null if no cache or expired. */
export async function readUpdateCache(cachePath: string = CACHE_FILE): Promise<UpdateCheckResult | null> {
  const { existsSync, readFileSync, statSync } = await import('node:fs');
  if (!existsSync(cachePath)) return null;
  try {
    const stat = statSync(cachePath);
    if (Date.now() - stat.mtimeMs > CACHE_TTL_MS) return null;
    const raw = JSON.parse(readFileSync(cachePath, 'utf8')) as UpdateCheckResult;
    return { ...raw, fromCache: true };
  } catch {
    return null;
  }
}

/** Write check result to cache. */
export async function writeUpdateCache(result: UpdateCheckResult, cachePath: string = CACHE_FILE): Promise<void> {
  const { writeFileSync } = await import('node:fs');
  try {
    writeFileSync(cachePath, JSON.stringify({ ...result, fromCache: false }, null, 2));
  } catch {
    // best-effort
  }
}

/** Compare two semver-ish versions. Returns -1, 0, or 1. */
export function compareVersions(a: string, b: string): -1 | 0 | 1 {
  const parse = (v: string) => v.replace(/^v/, '').split('.').map((n) => parseInt(n, 10) || 0);
  const [aMaj, aMin, aPat] = parse(a);
  const [bMaj, bMin, bPat] = parse(b);
  if (aMaj !== bMaj) return aMaj > bMaj ? 1 : -1;
  if (aMin !== bMin) return aMin > bMin ? 1 : -1;
  if (aPat !== bPat) return aPat > bPat ? 1 : -1;
  return 0;
}

/** Run an update check. Returns null on any network/parse failure. */
export async function checkForUpdate(currentVersion: string, opts: { fetchImpl?: typeof fetch; cachePath?: string } = {}): Promise<UpdateCheckResult | null> {
  const cachePath = opts.cachePath ?? CACHE_FILE;
  const cached = await readUpdateCache(cachePath);
  if (cached) return cached;

  const fetchImpl = opts.fetchImpl ?? fetch;
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 3000);
    const res = await fetchImpl(NPM_REGISTRY, { signal: controller.signal });
    clearTimeout(timeoutId);
    if (!res.ok) return null;
    const data = (await res.json()) as { version?: string };
    if (!data.version) return null;
    const result: UpdateCheckResult = {
      current: currentVersion,
      latest: data.version,
      isOutdated: compareVersions(currentVersion, data.version) < 0,
      checkedAt: Date.now(),
      fromCache: false,
    };
    await writeUpdateCache(result, cachePath);
    return result;
  } catch {
    return null;
  }
}

/** Format a one-line notice for the user. Returns null if up-to-date. */
export function formatUpdateNotice(result: UpdateCheckResult | null): string | null {
  if (!result) return null;
  if (!result.isOutdated) return null;
  const from = result.fromCache ? ' (cached)' : '';
  return `Update available: v${result.current} → v${result.latest}. Run \`npm i -g clone-v3\` to update.${from}`;
}

/**
 * Source-Auth-Strategien für Klon-Quellen hinter HTTP-Auth.
 *
 * Drei Strategien:
 * - basic: HTTP Basic Auth (username + password)
 * - bearer: Bearer-Token in Authorization-Header
 * - cookie: Session-Cookies in Cookie-Header
 *
 * Wird in src/extractor/playwright-extractor.ts in `applySourceAuth()`
 * konsumiert — die Resultate werden in Playwright-`extraHTTPHeaders`
 * injiziert, BEVOR `page.goto()` aufgerufen wird.
 */

export type SourceAuth =
  | { type: 'basic'; username: string; password: string }
  | { type: 'bearer'; token: string }
  | { type: 'cookie'; cookies: Record<string, string> };

/**
 * Lädt Source-Auth aus `~/.clone-v3/source-auth.json` per Profilname.
 *
 * Datei-Format:
 * ```json
 * {
 *   "profiles": {
 *     "staging-stripe": {
 *       "type": "basic",
 *       "username": "admin",
 *       "password": "..."
 *     },
 *     "internal-preview": {
 *       "type": "bearer",
 *       "token": "..."
 *     }
 *   }
 * }
 * ```
 *
 * Wirft wenn der Profilname nicht existiert (Fail-Loud).
 */
export async function loadSourceAuth(
  profileName: string,
  homeDir: string = process.env.HOME ?? process.env.USERPROFILE ?? '.',
): Promise<SourceAuth | null> {
  const fs = await import('node:fs/promises');
  const path = await import('node:path');
  const file = path.join(homeDir, '.clone-v3', 'source-auth.json');

  let raw: string;
  try {
    raw = await fs.readFile(file, 'utf-8');
  } catch {
    return null; // Kein Source-Auth-File = keine Auth
  }

  const parsed = JSON.parse(raw) as { profiles?: Record<string, SourceAuth> };
  const profile = parsed.profiles?.[profileName];
  if (!profile) {
    throw new Error(
      `Source-Auth profile "${profileName}" not found in ${file}. ` +
        `Available: ${Object.keys(parsed.profiles ?? {}).join(', ') || '(none)'}`,
    );
  }
  return profile;
}

/**
 * Konvertiert eine `SourceAuth`-Strategy in HTTP-Header, die Playwright
 * via `context.setExtraHTTPHeaders()` akzeptiert.
 *
 * Basic-Auth wird NICHT über Header umgesetzt (Browser hat einen separaten
 * Auth-Dialog), sondern via `context.authenticate({ username, password })`.
 * Diese Funktion gibt trotzdem ein Header-Map zurück, in dem
 * `Authorization: Basic <base64>` steht — das ist ein Fallback für Sites,
 * die `WWW-Authenticate: Basic` ablehnen.
 */
export function sourceAuthToHeaders(auth: SourceAuth): Record<string, string> {
  if (auth.type === 'bearer') {
    return { Authorization: `Bearer ${auth.token}` };
  }
  if (auth.type === 'cookie') {
    const cookieStr = Object.entries(auth.cookies)
      .map(([k, v]) => `${k}=${v}`)
      .join('; ');
    return { Cookie: cookieStr };
  }
  // basic — base64-encode "user:pass"
  const creds = Buffer.from(`${auth.username}:${auth.password}`).toString('base64');
  return { Authorization: `Basic ${creds}` };
}

/**
 * Konvertiert eine `SourceAuth`-Strategy in Playwright-`cookies`-Array.
 * Wird für `context.addCookies()` gebraucht (sauberer als Cookie-Header).
 */
export async function sourceAuthToPlaywrightCookies(
  auth: SourceAuth,
  targetUrl: string,
): Promise<Array<{ name: string; value: string; url: string }>> {
  if (auth.type !== 'cookie') return [];
  return Object.entries(auth.cookies).map(([name, value]) => ({
    name,
    value,
    url: targetUrl,
  }));
}

/**
 * Konvertiert eine `SourceAuth`-Strategy in Playwright-`authenticate`-Argumente.
 * Wird für `context.authenticate({ username, password })` gebraucht.
 */
export function sourceAuthToPlaywrightBasic(
  auth: SourceAuth,
): { username: string; password: string } | null {
  if (auth.type !== 'basic') return null;
  return { username: auth.username, password: auth.password };
}

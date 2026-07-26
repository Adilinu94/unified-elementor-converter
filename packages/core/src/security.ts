/**
 * Security — Credential management and input sanitization.
 */
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

export interface Credentials {
  wpUrl?: string;
  wpUser?: string;
  wpAppPassword?: string;
  mcpUrl?: string;
  mcpId?: string;
  mcpSecret?: string;
  aiApiKey?: string;
}

export function loadCredentials(envPath?: string): Credentials {
  const paths = envPath
    ? [envPath]
    : [resolve(process.cwd(), '.env.local'), resolve(process.cwd(), '.env')];

  const env: Record<string, string> = { ...(process.env as Record<string, string>) };

  for (const p of paths) {
    if (!existsSync(p)) continue;
    for (const line of readFileSync(p, 'utf8').split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eq = trimmed.indexOf('=');
      if (eq < 0) continue;
      const key = trimmed.slice(0, eq).trim();
      let val = trimmed.slice(eq + 1).trim();
      if (
        (val.startsWith('"') && val.endsWith('"')) ||
        (val.startsWith("'") && val.endsWith("'"))
      ) {
        val = val.slice(1, -1);
      }
      env[key] = val;
    }
    break;
  }

  return {
    wpUrl: env.WP_URL,
    wpUser: env.WP_USER,
    wpAppPassword: env.WP_APP_PASSWORD,
    mcpUrl: env.MCP_URL ?? env.UNFRAMER_MCP_URL,
    mcpId: env.MCP_ID ?? env.UNFRAMER_MCP_ID,
    mcpSecret: env.MCP_SECRET ?? env.UNFRAMER_MCP_SECRET,
    aiApiKey: env.ANTHROPIC_API_KEY ?? env.AI_API_KEY,
  };
}

export function sanitizeUrl(input: string): string {
  try {
    const url = new URL(input);
    if (!['http:', 'https:'].includes(url.protocol)) {
      throw new Error(`Invalid protocol: ${url.protocol}`);
    }
    return url.toString();
  } catch {
    throw new Error(`Invalid URL: ${input}`);
  }
}

export function sanitizeHtml(input: string): string {
  return input
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
    .replace(/on\w+="[^"]*"/gi, '')
    .replace(/javascript:/gi, '');
}

export function maskSecret(secret: string | undefined): string {
  if (!secret) return '(not set)';
  if (secret.length <= 8) return '****';
  return `${secret.slice(0, 4)}...${secret.slice(-4)}`;
}

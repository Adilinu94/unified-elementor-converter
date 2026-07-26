/**
 * Token-Resolver — Phase 3 Sprint 3C
 * Resolves a computed-style value to a V3 token reference when it matches
 * a known design token.
 *
 * Portiert aus site-clone-to-v3/src/classifier/token-resolver.ts (Phase 45).
 */
import type { DesignTokens } from '@elconv/core';

export interface ResolvedToken {
  token_name: string;
  v3_id: string;
  raw_value: string;
  source: 'design-token' | 'css-var';
}

export interface TokenResolverOptions {
  cssVars?: Record<string, string>;
}

/**
 * Resolve a hex/rgb color value against the design-tokens palette.
 */
export function resolveColorToken(
  value: string,
  tokens: DesignTokens,
  options: TokenResolverOptions = {},
): ResolvedToken | null {
  if (!value) return null;
  const normalized = normalizeColor(value);
  if (!normalized) return null;

  for (const token of tokens.colors) {
    if (!token.hex) continue;
    if (normalizeColor(token.hex) === normalized) {
      const semantic = token.role ?? token.id;
      return { token_name: semantic, v3_id: `ct-${semantic}`, raw_value: value, source: 'design-token' };
    }
  }

  for (const token of tokens.colors) {
    if (!token.css_var) continue;
    const resolved = options.cssVars?.[token.css_var];
    if (resolved && normalizeColor(resolved) === normalized) {
      const semantic = token.role ?? token.id;
      return { token_name: semantic, v3_id: `ct-${semantic}`, raw_value: value, source: 'css-var' };
    }
  }

  return null;
}

/**
 * Resolve a CSS custom property to its token name.
 */
export function resolveCssVar(
  cssVarExpression: string,
  tokens: DesignTokens,
): ResolvedToken | null {
  const match = cssVarExpression.match(/var\(\s*(--[a-zA-Z0-9-_]+)\s*\)/);
  if (!match) return null;
  const varName = match[1];

  for (const token of tokens.colors) {
    if (token.css_var === varName) {
      const semantic = token.role ?? token.id;
      return { token_name: semantic, v3_id: `ct-${semantic}`, raw_value: cssVarExpression, source: 'css-var' };
    }
  }
  return null;
}

/**
 * Resolve a font-family to a V3 typography role.
 */
export function resolveFontRole(
  fontFamily: string,
  tokens: DesignTokens,
): { role: 'heading' | 'body' | 'mono' | 'system'; v3_id: string } | null {
  if (!fontFamily) return null;
  const normalized = fontFamily.toLowerCase().trim();

  const heading = tokens.fonts.find((f) => f.role === 'heading');
  if (heading?.family && normalized.includes(heading.family.toLowerCase())) {
    return { role: 'heading', v3_id: 'tt-heading' };
  }
  const body = tokens.fonts.find((f) => f.role === 'body');
  if (body?.family && normalized.includes(body.family.toLowerCase())) {
    return { role: 'body', v3_id: 'tt-body' };
  }

  if (/apple-system|blinkmacsystemfont|segoe ui|roboto|helvetica|arial/i.test(normalized)) {
    return { role: 'system', v3_id: 'tt-body' };
  }
  return null;
}

function normalizeColor(value: string): string | null {
  const trimmed = value.trim().toLowerCase();
  const hexMatch = trimmed.match(/^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/);
  if (hexMatch) {
    if (hexMatch[1].length === 3) {
      return `#${hexMatch[1].split('').map((c) => c + c).join('')}`;
    }
    return `#${hexMatch[1].slice(0, 6)}`;
  }
  const rgbMatch = trimmed.match(/^rgba?\((\d+),\s*(\d+),\s*(\d+)/);
  if (rgbMatch) {
    const r = parseInt(rgbMatch[1], 10).toString(16).padStart(2, '0');
    const g = parseInt(rgbMatch[2], 10).toString(16).padStart(2, '0');
    const b = parseInt(rgbMatch[3], 10).toString(16).padStart(2, '0');
    return `#${r}${g}${b}`;
  }
  return null;
}

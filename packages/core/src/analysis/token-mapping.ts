import type { DesignTokens } from '../analyzer/index.js';

export interface V4Variable {
  id: string;
  label: string;
  type: 'color' | 'font' | 'number' | 'size';
  value: string;
  synced: boolean;
  existingId?: string;
}

export interface MappedTokens {
  variables: V4Variable[];
  classes: Array<{ id: string; label: string; selector: string }>;
  colors: V4Variable[];
  fonts: V4Variable[];
  spacings: V4Variable[];
}

export interface TokenMappingOptions {
  prefix?: string;
  skipExisting?: boolean;
  existingVariables?: Array<{ id: string; label: string; value: string }>;
}

function sanitizeLabel(label: string): string {
  return label.replace(/[^a-z0-9-]/gi, '-').toLowerCase();
}

function toTitleCase(s: string): string {
  return s.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

function makeId(prefix: string, _label: string, value: string): string {
  const sanitized = sanitizeLabel(value);
  const sig = sanitized.startsWith('-') ? sanitized.slice(1).slice(0, 8) : sanitized.slice(0, 8);
  return `${prefix}-${sig}`;
}

export function mapColorToken(
  key: string,
  value: string,
  options: TokenMappingOptions = {},
): V4Variable {
  const prefix = options.prefix ?? 'sv';
  const label = toTitleCase(key);
  const id = makeId(prefix, key, value);
  return {
    id,
    label,
    type: 'color',
    value,
    synced: false,
    existingId: options.existingVariables?.find(
      (v) => v.label === label || sanitizeLabel(v.value) === sanitizeLabel(value),
    )?.id,
  };
}

export function mapFontToken(
  key: string,
  value: string,
  options: TokenMappingOptions = {},
): V4Variable {
  const prefix = options.prefix ?? 'sv';
  const label = toTitleCase(key);
  const id = makeId(prefix, key, value);
  return {
    id,
    label,
    type: 'font',
    value,
    synced: false,
    existingId: options.existingVariables?.find((v) => v.label === label)?.id,
  };
}

export function mapSpacingToken(
  key: string,
  value: string,
  options: TokenMappingOptions = {},
): V4Variable {
  const prefix = options.prefix ?? 'sv';
  const label = toTitleCase(key);
  const id = makeId(prefix, key, value);
  return {
    id,
    label,
    type: 'size',
    value,
    synced: false,
    existingId: options.existingVariables?.find((v) => v.label === label)?.id,
  };
}

export function mapDesignTokens(
  tokens: DesignTokens,
  options: TokenMappingOptions = {},
): MappedTokens {
  const colors: V4Variable[] = [];
  const fonts: V4Variable[] = [];
  const spacings: V4Variable[] = [];

  for (const token of tokens.colors) {
    if (token.hex) {
      colors.push(mapColorToken(token.role ?? token.id, token.hex, options));
    }
  }

  for (const token of tokens.fonts) {
    if (token.family) {
      fonts.push(mapFontToken(token.role ?? token.id, token.family, options));
    }
  }

  for (const token of tokens.sizes) {
    if (token.px !== undefined) {
      spacings.push(mapSpacingToken(token.id, `${token.px}px`, options));
    }
  }

  const allVariables = [...colors, ...fonts, ...spacings];
  const deduped = dedupeVariables(allVariables);
  const classes = buildClassesFromTokens(deduped);

  return {
    variables: deduped,
    classes,
    colors: deduped.filter((v) => v.type === 'color'),
    fonts: deduped.filter((v) => v.type === 'font'),
    spacings: deduped.filter((v) => v.type === 'size'),
  };
}

function dedupeVariables(vars: V4Variable[]): V4Variable[] {
  const seen = new Map<string, V4Variable>();
  for (const v of vars) {
    if (!seen.has(v.id)) {
      seen.set(v.id, v);
    }
  }
  return Array.from(seen.values());
}

function buildClassesFromTokens(vars: V4Variable[]): Array<{ id: string; label: string; selector: string }> {
  const classes: Array<{ id: string; label: string; selector: string }> = [];
  const colorVars = vars.filter((v) => v.type === 'color');
  for (const c of colorVars) {
    const selector = `.${c.id}`;
    classes.push({
      id: c.id,
      label: c.label,
      selector,
    });
  }
  return classes;
}

/**
 * Responsive-Settings — Phase 3 Sprint 3D
 * Builds V3 settings with explicit _tablet / _mobile variants from
 * per-viewport computed-style snapshots.
 *
 * Portiert aus site-clone-to-v3/src/classifier/responsive-settings.ts (Phase 45).
 */
import type { ComputedStyleSnapshot } from '@elconv/core';

export type ViewportLabel = 'desktop' | 'tablet' | 'mobile';

export interface ResponsiveStyles {
  desktop: Record<string, string>;
  tablet?: Record<string, string>;
  mobile?: Record<string, string>;
}

export interface ResponsiveSettingsOptions {
  properties?: string[];
  responsiveOnlyOnDiff?: boolean;
}

const DEFAULT_PROPERTIES = [
  'font-size',
  'font-weight',
  'line-height',
  'color',
  'background-color',
  'padding',
  'margin',
  'width',
  'height',
  'gap',
  'flex-direction',
];

/**
 * Build V3 settings object with desktop + responsive variants.
 */
export function buildResponsiveSettings(
  styles: ResponsiveStyles,
  options: ResponsiveSettingsOptions = {},
): Record<string, unknown> {
  const properties = options.properties ?? DEFAULT_PROPERTIES;
  const responsiveOnlyOnDiff = options.responsiveOnlyOnDiff ?? true;
  const settings: Record<string, unknown> = {};

  for (const prop of properties) {
    const desktop = styles.desktop[prop];
    if (!desktop) continue;

    const v3Key = cssPropToV3Key(prop);
    settings[v3Key] = normalizeValue(prop, desktop);

    if (responsiveOnlyOnDiff) {
      const tablet = styles.tablet?.[prop];
      if (tablet && tablet !== desktop) {
        settings[`${v3Key}_tablet`] = normalizeValue(prop, tablet);
      }
      const mobile = styles.mobile?.[prop];
      if (mobile && mobile !== desktop) {
        settings[`${v3Key}_mobile`] = normalizeValue(prop, mobile);
      }
    } else {
      if (styles.tablet?.[prop]) {
        settings[`${v3Key}_tablet`] = normalizeValue(prop, styles.tablet[prop]);
      }
      if (styles.mobile?.[prop]) {
        settings[`${v3Key}_mobile`] = normalizeValue(prop, styles.mobile[prop]);
      }
    }
  }

  return settings;
}

/**
 * Group computed-style snapshots by selector, then split by viewport.
 */
export function groupSnapshotsBySelector(
  snapshots: ComputedStyleSnapshot[],
  _viewports: ViewportLabel[] = ['desktop', 'tablet', 'mobile'],
): Map<string, ResponsiveStyles> {
  const out = new Map<string, ResponsiveStyles>();
  for (const snap of snapshots) {
    const existing = out.get(snap.selector) ?? { desktop: {} };
    existing.desktop = snap.styles;
    out.set(snap.selector, existing);
  }
  return out;
}

/**
 * Convert a CSS property name to V3 setting key.
 */
export function cssPropToV3Key(prop: string): string {
  if (prop === 'padding') return '_padding';
  if (prop === 'margin') return '_margin';
  if (prop === 'flex-direction') return 'flex_direction';
  if (prop.startsWith('font-') || prop === 'color' || prop === 'line-height') {
    return `typography_${prop.replace(/-/g, '_')}`;
  }
  return prop.replace(/-/g, '_');
}

function normalizeValue(prop: string, value: string): unknown {
  if (/^-?\d+(?:\.\d+)?px$/.test(value)) return { size: parseFloat(value), unit: 'px' };
  if (/^-?\d+(?:\.\d+)?rem$/.test(value)) return { size: parseFloat(value), unit: 'rem' };
  if (/^-?\d+(?:\.\d+)?%$/.test(value)) return { size: parseFloat(value), unit: '%' };
  if (/^-?\d+(?:\.\d+)?em$/.test(value)) return { size: parseFloat(value), unit: 'em' };
  if (prop === 'font-weight') {
    const num = parseInt(value, 10);
    if (!isNaN(num)) return num;
  }
  return value;
}

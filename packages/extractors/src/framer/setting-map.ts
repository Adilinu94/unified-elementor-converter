/**
 * Framer → Elementor Setting Map (Phase 65).
 *
 * Authoritative mapping table: Framer attribute → Elementor setting.
 * Used by framer-tree-to-v3 converter and annotated with render-compat info.
 *
 * @module extractors/framer/setting-map
 */

// ============================================================================
// Types
// ============================================================================

export interface SettingMapEntry {
  /** Framer attribute name (from XML/props). */
  framerAttr: string;
  /** Elementor V3 setting key. */
  elementorSetting: string;
  /** Transform function category. */
  transform: 'direct' | 'px' | 'color' | 'enum' | 'typography' | 'media' | 'complex';
  /** Whether this setting renders reliably under V4 engine. */
  v4Reliable: boolean;
  /** Notes / caveats. */
  notes?: string;
  /** Enum mapping (for transform:'enum'). */
  enumMap?: Record<string, string>;
}

export interface SettingMapResult {
  elementorSettings: Record<string, unknown>;
  warnings: string[];
  unmapped: string[];
}

// ============================================================================
// Authoritative Mapping Table
// ============================================================================

export const FRAMER_TO_ELEMENTOR_MAP: SettingMapEntry[] = [
  // Layout
  {
    framerAttr: 'stackDirection',
    elementorSetting: 'flex_direction',
    transform: 'enum',
    v4Reliable: true,
    enumMap: { horizontal: 'row', vertical: 'column' },
  },
  {
    framerAttr: 'gap',
    elementorSetting: 'flex_gap',
    transform: 'px',
    v4Reliable: true,
    notes: 'V4 may override with kit defaults in some cases',
  },
  {
    framerAttr: 'alignment',
    elementorSetting: 'flex_align_items',
    transform: 'enum',
    v4Reliable: true,
    enumMap: { start: 'flex-start', center: 'center', end: 'flex-end', stretch: 'stretch' },
  },
  {
    framerAttr: 'distribution',
    elementorSetting: 'flex_justify_content',
    transform: 'enum',
    v4Reliable: true,
    enumMap: { start: 'flex-start', center: 'center', end: 'flex-end', spaceBetween: 'space-between' },
  },
  {
    framerAttr: 'padding',
    elementorSetting: 'padding',
    transform: 'complex',
    v4Reliable: true,
    notes: 'Framer: {top,right,bottom,left} → Elementor: {top,right,bottom,left,unit}',
  },
  {
    framerAttr: 'width',
    elementorSetting: 'width',
    transform: 'px',
    v4Reliable: true,
  },
  {
    framerAttr: 'height',
    elementorSetting: 'min_height',
    transform: 'px',
    v4Reliable: true,
  },

  // Typography
  {
    framerAttr: 'inlineTextStyle',
    elementorSetting: 'typography_typography',
    transform: 'typography',
    v4Reliable: true,
    notes: 'Expands to typography_font_size, typography_font_family, typography_font_weight, typography_line_height. MUST set typography_typography:"custom"',
  },
  {
    framerAttr: 'fontSize',
    elementorSetting: 'typography_font_size',
    transform: 'px',
    v4Reliable: false,
    notes: 'REQUIRES typography_typography:"custom" companion',
  },
  {
    framerAttr: 'fontFamily',
    elementorSetting: 'typography_font_family',
    transform: 'direct',
    v4Reliable: false,
    notes: 'REQUIRES typography_typography:"custom" companion',
  },
  {
    framerAttr: 'fontWeight',
    elementorSetting: 'typography_font_weight',
    transform: 'direct',
    v4Reliable: false,
    notes: 'REQUIRES typography_typography:"custom" companion',
  },
  {
    framerAttr: 'lineHeight',
    elementorSetting: 'typography_line_height',
    transform: 'px',
    v4Reliable: false,
    notes: 'REQUIRES typography_typography:"custom" companion',
  },
  {
    framerAttr: 'letterSpacing',
    elementorSetting: 'typography_letter_spacing',
    transform: 'px',
    v4Reliable: false,
    notes: 'REQUIRES typography_typography:"custom" companion',
  },
  {
    framerAttr: 'textAlign',
    elementorSetting: 'align',
    transform: 'direct',
    v4Reliable: true,
  },

  // Colors
  {
    framerAttr: 'backgroundColor',
    elementorSetting: 'background_color',
    transform: 'color',
    v4Reliable: true,
  },
  {
    framerAttr: 'color',
    elementorSetting: 'title_color',
    transform: 'color',
    v4Reliable: true,
    notes: 'For heading widget. text-editor uses text_color',
  },
  {
    framerAttr: 'opacity',
    elementorSetting: 'opacity',
    transform: 'direct',
    v4Reliable: true,
  },

  // Background
  {
    framerAttr: 'backgroundImage',
    elementorSetting: 'background_image',
    transform: 'media',
    v4Reliable: false,
    notes: 'CRITICAL: V4 requires numeric media-id. Must upload to WP media library first.',
  },
  {
    framerAttr: 'backgroundSize',
    elementorSetting: 'background_size',
    transform: 'direct',
    v4Reliable: true,
  },
  {
    framerAttr: 'backgroundPosition',
    elementorSetting: 'background_position',
    transform: 'direct',
    v4Reliable: true,
  },

  // Border & Effects
  {
    framerAttr: 'borderRadius',
    elementorSetting: 'border_radius',
    transform: 'px',
    v4Reliable: true,
  },
  {
    framerAttr: 'shadow',
    elementorSetting: 'box_shadow',
    transform: 'complex',
    v4Reliable: true,
    notes: 'Framer shadow → Elementor box_shadow {horizontal, vertical, blur, spread, color}',
  },

  // Sizing
  {
    framerAttr: 'maxWidth',
    elementorSetting: 'content_width',
    transform: 'px',
    v4Reliable: true,
  },
];

// ============================================================================
// Mapping engine
// ============================================================================

const MAP_INDEX = new Map<string, SettingMapEntry>(
  FRAMER_TO_ELEMENTOR_MAP.map((e) => [e.framerAttr, e]),
);

/**
 * Map a set of Framer attributes to Elementor V3 settings.
 */
export function mapFramerToElementor(
  framerAttrs: Record<string, unknown>,
): SettingMapResult {
  const elementorSettings: Record<string, unknown> = {};
  const warnings: string[] = [];
  const unmapped: string[] = [];

  for (const [attr, value] of Object.entries(framerAttrs)) {
    if (value === undefined || value === null) continue;

    const entry = MAP_INDEX.get(attr);
    if (!entry) {
      unmapped.push(attr);
      continue;
    }

    if (!entry.v4Reliable) {
      warnings.push(
        `"${attr}" → "${entry.elementorSetting}" is NOT V4-reliable. ${entry.notes ?? ''}`,
      );
    }

    const transformed = transformValue(entry, value);
    Object.assign(elementorSettings, transformed);

    // Auto-add companions for typography
    if (entry.transform === 'typography' || attr.startsWith('font') || attr === 'lineHeight' || attr === 'letterSpacing') {
      elementorSettings['typography_typography'] = 'custom';
    }
  }

  return { elementorSettings, warnings, unmapped };
}

/**
 * Get all V4-unreliable mappings (for render-risk annotation).
 */
export function getUnreliableMappings(): SettingMapEntry[] {
  return FRAMER_TO_ELEMENTOR_MAP.filter((e) => !e.v4Reliable);
}

// ============================================================================
// Transform functions
// ============================================================================

function transformValue(entry: SettingMapEntry, value: unknown): Record<string, unknown> {
  switch (entry.transform) {
    case 'direct':
      return { [entry.elementorSetting]: value };

    case 'px': {
      const num = typeof value === 'number' ? value : parseFloat(String(value));
      if (isNaN(num)) return {};
      return { [entry.elementorSetting]: { size: num, unit: 'px' } };
    }

    case 'color':
      return { [entry.elementorSetting]: normalizeColor(String(value)) };

    case 'enum': {
      const mapped = entry.enumMap?.[String(value)] ?? String(value);
      return { [entry.elementorSetting]: mapped };
    }

    case 'typography': {
      // Expand inlineTextStyle object
      const style = value as Record<string, unknown>;
      const result: Record<string, unknown> = { typography_typography: 'custom' };
      if (style['fontSize']) result['typography_font_size'] = { size: style['fontSize'], unit: 'px' };
      if (style['fontFamily']) result['typography_font_family'] = style['fontFamily'];
      if (style['fontWeight']) result['typography_font_weight'] = String(style['fontWeight']);
      if (style['lineHeight']) result['typography_line_height'] = { size: style['lineHeight'], unit: 'px' };
      if (style['letterSpacing']) result['typography_letter_spacing'] = { size: style['letterSpacing'], unit: 'px' };
      return result;
    }

    case 'media':
      // Media requires upload — return placeholder with warning
      return { [entry.elementorSetting]: { url: String(value), id: '' } };

    case 'complex': {
      if (entry.framerAttr === 'padding') {
        const p = value as Record<string, number>;
        return {
          padding: {
            top: p['top'] ?? 0,
            right: p['right'] ?? 0,
            bottom: p['bottom'] ?? 0,
            left: p['left'] ?? 0,
            unit: 'px',
            isLinked: false,
          },
        };
      }
      if (entry.framerAttr === 'shadow') {
        const s = value as Record<string, unknown>;
        return {
          box_shadow: {
            horizontal: { size: s['x'] ?? 0, unit: 'px' },
            vertical: { size: s['y'] ?? 0, unit: 'px' },
            blur: { size: s['blur'] ?? 0, unit: 'px' },
            spread: { size: s['spread'] ?? 0, unit: 'px' },
            color: s['color'] ?? 'rgba(0,0,0,0.2)',
          },
        };
      }
      return { [entry.elementorSetting]: value };
    }

    default:
      return { [entry.elementorSetting]: value };
  }
}

function normalizeColor(color: string): string {
  // Pass through hex, rgb, rgba, var() as-is
  if (/^(#|rgb|hsl|var\()/.test(color)) return color;
  // Named colors pass through
  return color;
}

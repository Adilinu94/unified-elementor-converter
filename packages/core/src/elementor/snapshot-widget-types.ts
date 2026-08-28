/**
 * Widget types the committed schema snapshot must cover.
 *
 * Derived from `V3_WIDGET_TYPES` in @elconv/target-v3 plus the container
 * element key. Kept in @elconv/core so both the capture script (which imports
 * from @elconv/mcp) and the offline gate can reference one list — target-v3
 * cannot be imported from core without inverting the dependency direction, so
 * a drift test pins this list against `V3_WIDGET_TYPES` instead.
 *
 * `section` and `column` are deliberately absent: Elementor 4.x exposes no
 * control schema for them (live-verified — `elementor-get-schema` reports them
 * as `missing`). See `SCHEMA_UNAVAILABLE_EL_TYPES`.
 */

import { CONTAINER_SCHEMA_KEY } from './widget-schema-types.js';

/**
 * Every schema key a V3 tree can reference, sorted for deterministic capture.
 * `container` appears as a `widgetType` in `V3_WIDGET_TYPES` (nested container
 * widget) but resolves to the same `__container__` schema, so it is not listed
 * twice.
 */
export const SNAPSHOT_WIDGET_TYPES: readonly string[] = [
  CONTAINER_SCHEMA_KEY,
  'accordion',
  'button',
  'divider',
  'form',
  'heading',
  'html',
  'icon',
  'icon-box',
  'image',
  'spacer',
  'text-editor',
  'video',
];

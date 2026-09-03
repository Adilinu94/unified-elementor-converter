/**
 * Drift gate for the offline CSS → V3 control tables.
 *
 * `V3_CONTROL_CAPABILITIES` is the fallback the emitter resolves CSS against
 * when no live schema was passed, and `elconv convert` always runs that way. If
 * it drifts from the real schema, the emitter writes control ids the server
 * rejects — and it rejects the WHOLE write, which is how one converted page
 * reached 724 `unknown-key` errors before the per-widget split existed.
 *
 * So every entry is pinned against `schemas/elementor-v3-controls.snapshot.json`,
 * the same source the schema gate validates against. Same convention as
 * `KNOWN_ABILITIES` in @elconv/mcp: a generated constant plus a test that fails
 * on drift, never a hand-maintained list nobody re-checks.
 *
 * The three properties asserted here are exactly the three the mapping relies
 * on:
 *
 *   1. Every listed control EXISTS in the snapshot for that widget.
 *   2. Its recorded `t` and `r` MATCH — `t` decides the value shape (a box into
 *      a slider is a `wrong-shape` rejection), `r` decides whether a
 *      `_tablet` / `_mobile` suffix is a valid control at all.
 *   3. No listed control carries an `if` naming a companion outside the
 *      style-enabling set. This is what keeps the offline path from turning a
 *      plain divider into a line-with-text just to make a font size apply — the
 *      live path drops those properties as `unsafe-companion`, and the two paths
 *      must agree on the outcome.
 */

import { describe, expect, it } from 'vitest';
import {
  COMPANION_FALLBACK,
  V3_CONTROL_CAPABILITIES,
  V3_LEGACY_ELEMENT_CONTROLS,
  companionRequirements,
  offlineControlsFor,
  requiredCompanions,
  resolveCssControl,
  isResolvedCssControl,
  SCHEMA_UNAVAILABLE_EL_TYPES,
  SNAPSHOT_WIDGET_TYPES,
} from '@elconv/core';
import { loadWidgetSchemaFromSnapshot } from '@elconv/mcp';

const snapshot = loadWidgetSchemaFromSnapshot(SNAPSHOT_WIDGET_TYPES);

/**
 * Companion control ids the mapping may write on its own initiative.
 *
 * Mirrors `SAFE_COMPANION_CONTROL_IDS` in control-mapping.ts. Duplicated on
 * purpose: the test must state the invariant independently, or it would assert
 * the implementation against itself.
 */
const STYLE_ENABLING_COMPANIONS = new Set([
  'typography_typography',
  'background_background',
  '_background_background',
  '_element_width',
  // `_flex_size` gates `_flex_grow` / `_flex_shrink` on the value `'custom'`,
  // whose `selectors_dictionary` entry is the EMPTY string (live-read from
  // `includes/controls/groups/flex-item.php` on Elementor 4.2.3). It writes no CSS
  // of its own and only lets the two numbers apply, which is the same shape as
  // `typography_typography: 'custom'` — nothing about what the element renders
  // changes. Contrast `divider.look`, which selects a rendering mode.
  '_flex_size',
]);

describe('V3_CONTROL_CAPABILITIES pins against the committed snapshot', () => {
  it('loads a snapshot to compare against', () => {
    // Without this the whole suite would pass vacuously.
    expect(snapshot.source).toBe('snapshot');
    expect(Object.keys(snapshot.schema).length).toBeGreaterThan(0);
  });

  it('covers every widget type the snapshot declares', () => {
    // A widget present live but absent here means the emitter has no offline
    // answer for it and silently drops all of its styling.
    const tabled = Object.keys(V3_CONTROL_CAPABILITIES).sort();
    const captured = Object.keys(snapshot.schema).sort();
    expect(tabled).toEqual(captured);
  });

  for (const [schemaKey, controls] of Object.entries(V3_CONTROL_CAPABILITIES)) {
    describe(schemaKey, () => {
      const entry = snapshot.schema[schemaKey];

      it('exists in the snapshot', () => {
        expect(entry, `${schemaKey} is not in the snapshot`).toBeDefined();
      });

      it('records the same control type and responsive capability as the snapshot', () => {
        const live = entry!.controls;
        const drift: string[] = [];
        for (const [controlId, control] of Object.entries(controls)) {
          const liveControl = live[controlId];
          if (liveControl === undefined) {
            drift.push(`${controlId}: absent from the snapshot`);
            continue;
          }
          if (liveControl.t !== control.t) {
            drift.push(`${controlId}: t is "${liveControl.t}" live, "${control.t}" in the table`);
          }
          const liveResponsive = liveControl.r === 1;
          const tableResponsive = control.r === 1;
          if (liveResponsive !== tableResponsive) {
            drift.push(
              `${controlId}: responsive is ${liveResponsive} live, ${tableResponsive} in the table`,
            );
          }
        }
        expect(drift).toEqual([]);
      });

      it('lists no control whose condition cannot be met by a style-enabling companion', () => {
        // Three outcomes are acceptable for a listed control: it has no
        // condition, its condition is already satisfied by the sibling's schema
        // default (the container's whole flex group, gated on
        // `container_type: ['flex']` which defaults to `'flex'`), or the only
        // companion needed is a style enabler. Anything else means satisfying
        // the condition would change what the widget RENDERS.
        const live = entry!.controls;
        const unsafe: string[] = [];
        for (const controlId of Object.keys(controls)) {
          const control = live[controlId];
          if (control === undefined) continue;
          const { companions, blockers } = companionRequirements(controlId, control, live);
          for (const blocker of blockers) {
            unsafe.push(`${controlId} is gated on ${blocker}, which no schema value satisfies`);
          }
          for (const companionId of Object.keys(companions)) {
            if (STYLE_ENABLING_COMPANIONS.has(companionId)) continue;
            unsafe.push(`${controlId} needs ${companionId}, which is not a style enabler`);
          }
        }
        expect(unsafe).toEqual([]);
      });
    });
  }
});

describe('COMPANION_FALLBACK matches what the live conditions require', () => {
  it('names, for every entry, a companion the snapshot actually asks for', () => {
    // The fallback exists because the offline table carries no `if`. It must
    // reproduce what the live schema derives, not invent a different answer.
    const mismatches: string[] = [];
    for (const [controlId, expectedCompanions] of Object.entries(COMPANION_FALLBACK)) {
      // Find any widget that declares this control and compare against the
      // companions its real condition yields.
      const owner = Object.values(snapshot.schema).find((entry) => controlId in entry.controls);
      if (owner === undefined) {
        mismatches.push(`${controlId}: no snapshot widget declares it`);
        continue;
      }
      const live = requiredCompanions(controlId, owner.controls[controlId]!, owner.controls);
      for (const [companionId, value] of Object.entries(expectedCompanions)) {
        if (!(companionId in live)) {
          mismatches.push(
            `${controlId}: fallback names ${companionId}, but ${owner.widgetType}'s condition does not require it`,
          );
          continue;
        }
        if (live[companionId] !== value) {
          mismatches.push(
            `${controlId}.${companionId}: fallback says ${JSON.stringify(value)}, ` +
              `the schema derives ${JSON.stringify(live[companionId])}`,
          );
        }
      }
    }
    expect(mismatches).toEqual([]);
  });

  it('supplies the typography companion offline, where no condition is available', () => {
    const controls = offlineControlsFor('heading')!;
    const companions = requiredCompanions('typography_font_size', controls.typography_font_size!, controls);
    // Without this the size is stored and never rendered — AGENTS.md §6.
    expect(companions).toEqual({ typography_typography: 'custom' });
  });

  it('derives the same companion from a real schema', () => {
    const live = snapshot.schema.heading!.controls;
    expect(requiredCompanions('typography_font_size', live.typography_font_size!, live))
      .toEqual({ typography_typography: 'custom' });
  });
});

describe('the offline and live paths agree on which properties are mappable', () => {
  const CSS_PROPERTIES = [
    'background-color',
    'padding',
    'margin',
    'border-radius',
    'width',
    'min-height',
    'text-align',
    'color',
    'font-family',
    'font-size',
    'font-weight',
    'line-height',
    'letter-spacing',
  ];

  it('resolves each property to the same control id, or drops it in both paths', () => {
    const disagreements: string[] = [];
    for (const schemaKey of Object.keys(V3_CONTROL_CAPABILITIES)) {
      const offline = offlineControlsFor(schemaKey)!;
      const live = snapshot.schema[schemaKey]!.controls;
      for (const property of CSS_PROPERTIES) {
        const offlineResult = resolveCssControl(property, schemaKey, offline);
        const liveResult = resolveCssControl(property, schemaKey, live);
        const offlineId = isResolvedCssControl(offlineResult) ? offlineResult.controlId : null;
        const liveId = isResolvedCssControl(liveResult) ? liveResult.controlId : null;
        if (offlineId !== liveId) {
          disagreements.push(
            `${schemaKey}.${property}: offline → ${offlineId ?? 'dropped'}, live → ${liveId ?? 'dropped'}`,
          );
        }
      }
    }
    expect(disagreements).toEqual([]);
  });
});

describe('V3_LEGACY_ELEMENT_CONTROLS', () => {
  it('covers exactly the element types Elementor exposes no schema for', () => {
    expect(Object.keys(V3_LEGACY_ELEMENT_CONTROLS).sort())
      .toEqual([...SCHEMA_UNAVAILABLE_EL_TYPES].sort());
  });

  it('is not in the snapshot, which is why it cannot be schema-derived', () => {
    // If Elementor ever starts exposing these, this test fails and the table
    // should be replaced by real schema entries rather than kept by hand.
    for (const elType of Object.keys(V3_LEGACY_ELEMENT_CONTROLS)) {
      expect(snapshot.schema[elType]).toBeUndefined();
    }
  });

  it('uses the bare control naming family, like the container and unlike a widget', () => {
    for (const controls of Object.values(V3_LEGACY_ELEMENT_CONTROLS)) {
      const prefixed = Object.keys(controls).filter((controlId) => controlId.startsWith('_'));
      expect(prefixed).toEqual([]);
    }
  });

  it('is reachable through offlineControlsFor', () => {
    expect(offlineControlsFor('section')).toBe(V3_LEGACY_ELEMENT_CONTROLS.section);
    expect(offlineControlsFor('column')).toBe(V3_LEGACY_ELEMENT_CONTROLS.column);
    expect(offlineControlsFor('not-a-widget')).toBeUndefined();
  });
});

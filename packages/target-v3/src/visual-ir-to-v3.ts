/**
 * VisualPageIR -> Elementor V3 emitter.
 *
 * This is the generic target path. The legacy Framer XML mapper remains
 * available for compatibility, but new source adapters should emit VisualPageIR
 * and cross this target-neutral boundary before building a V3 tree.
 *
 * ## Style settings are resolved per element type
 *
 * `styleSettings` takes the schema key of the element it is writing, because
 * Elementor names the same CSS property differently per element family and a
 * wrong control id makes `elementor-set-content` reject the ENTIRE write.
 *
 * This is not a theoretical concern. Before the split, one mapping was applied
 * to every node type; validated against the LIVE schema of a real page it
 * produced **724 `unknown-key` errors** — 75 typography keys on spacers, 41 on
 * containers, `image_alt` on images (no such control), a box `border_radius`
 * where the widget wants `_border_radius`. The offline gate had passed the same
 * tree, because a snapshot-sourced schema is flagged `degraded` and `degraded`
 * downgrades every `unknown-key` to a warning by design.
 *
 * `resolveCssControl` from @elconv/core does the resolution against a real
 * schema when one is passed, and against `V3_CONTROL_CAPABILITIES` otherwise so
 * the offline path is narrower rather than wrong. A property the element has no
 * control for is DROPPED and reported — a spacer has no font size, and that is a
 * fidelity fact, not an error.
 *
 * ## Animations
 *
 * Until B4 was wired in, this emitter did exactly one thing with `ir.animations`:
 * it recorded a `static-approximation` decision per animation and emitted no
 * setting at all. A grep for `_animation`, `animation_delay`, `motion_fx_` and
 * `sticky` across every package found only `hover_animation: 'grow'` in a
 * pattern file — so a page with 31 measured effects deployed with zero of them.
 *
 * Mapping now runs through `mapAnimations`, which resolves every control id
 * against the passed control schema. Two consequences that are deliberate:
 *
 *   - Without `options.schema` no animation setting is written. The names differ
 *     per element family (`animation` on a container, `_animation` on a widget)
 *     and an unverified guess is rejected by `elementor-set-content` for the
 *     WHOLE write. The decision then says so instead of claiming an
 *     approximation was made.
 *   - Sticky candidates arrive through `options.stickyCandidates`, not through
 *     the IR. `MotionEvidence.sticky` is measured per DOM element and A4 does
 *     not yet attribute it to an IR node — see the option's docstring.
 */

import type {
  FidelityDecisionRecord,
  ResolvedWidgetSchema,
  VisualNodeIR,
  VisualPageIR,
  VisualSectionIR,
  WidgetControlMap,
} from '@elconv/core';
import { canContinueWithFidelityDecisions, validateVisualPageIR, breakpointKey } from '@elconv/core';
import { RESPONSIVE_BREAKPOINTS as CORE_RESPONSIVE_BREAKPOINTS } from '@elconv/core';
import { CONTAINER_SCHEMA_KEY } from '@elconv/core';
import {
  coerceControlValue,
  isResolvedCssControl,
  normalizeMediaUrlForWordPress,
  offlineControlsFor,
  resolveCssControl,
  resolveFlexItemSizing,
  toDimensionValue,
  FLEX_ITEM_CSS_PROPERTIES,
} from '@elconv/core';
import type { V3Element } from './types.js';
import {
  mapAnimations,
  mapSticky,
  type AnimationResolution,
  type AnimationTargetInfo,
  type StickyCandidate,
} from './animation/index.js';

export interface VisualIrToV3Options {
  assetUrlMap?: Record<string, string>;
  maxContainerDepth?: number;
  /**
   * Elementor control schema, used to resolve animation / motion / sticky
   * control ids.
   *
   * Optional so this emitter stays offline-capable, which `elconv convert`
   * relies on. Without it NO animation setting is emitted — the container/widget
   * name split cannot be guessed, and a wrong control id makes the server reject
   * the entire write. `loadWidgetSchemaFromSnapshot()` from `@elconv/mcp`
   * provides one without any transport.
   */
  schema?: ResolvedWidgetSchema;
  /**
   * `position: sticky` elements measured in the source, keyed by the IR
   * `sourceId` they belong to.
   *
   * Not read from the IR because sticky is not an animation and A4 does not
   * attribute `MotionEvidence.sticky` to IR nodes yet: the probe reports a
   * section-scoped name + ordinal, and turning that into a `sourceId` is the
   * merge's job. Passing it explicitly keeps the gap visible instead of encoding
   * a guess here.
   */
  stickyCandidates?: readonly StickyCandidate[];
  /** Delay step in ms between staggered siblings. Default from the mapper. */
  staggerStepMs?: number;
  /** Emit literal per-element delays instead of a stagger ramp. */
  disableStagger?: boolean;
}

export interface VisualIrToV3Result {
  tree: V3Element[];
  decisions: FidelityDecisionRecord[];
  warnings: string[];
  sourceSectionIds: string[];
  blocked: boolean;
  canContinue: boolean;
  /**
   * Per-animation verdicts, for the run report and for `G_ANIMATION_PARITY`.
   *
   * A guard cannot derive this from the tree alone: an animation that resolved
   * to `js-fallback` leaves no trace in the settings, so counting settings would
   * report it as silently lost rather than as needing a snippet.
   */
  animationResolutions: AnimationResolution[];
  /**
   * IR `sourceId` → the `_element_id` written onto the element it became.
   *
   * The residual snippet generator needs this and cannot derive it: `allocateId`
   * de-duplicates, so `visual-ir-ir_<sourceId>` is a lossy encoding, not a
   * reversible one. A generator that rebuilt the name by hand would emit CSS
   * selectors pointing at ids that are off-by-a-suffix on any page with two
   * nodes sharing a source name — a snippet that silently matches nothing.
   */
  elementIdBySourceId: Record<string, string>;
}

const DEFAULT_MAX_CONTAINER_DEPTH = 3;
const RESPONSIVE_BREAKPOINTS = new Set<string>(CORE_RESPONSIVE_BREAKPOINTS);

/** Emit a validated VisualPageIR as classic Elementor V3 sections/widgets. */
export function emitVisualIrToV3(
  ir: VisualPageIR,
  options: VisualIrToV3Options = {},
): VisualIrToV3Result {
  const validation = validateVisualPageIR(ir);
  if (!validation.valid) {
    throw new Error(`VisualPageIR validation failed: ${validation.errors.join('; ')}`);
  }

  const decisions: FidelityDecisionRecord[] = [];
  const warnings = [...validation.warnings];
  const usedIds = new Set<string>();
  const maxContainerDepth = Math.max(0, Math.floor(options.maxContainerDepth ?? DEFAULT_MAX_CONTAINER_DEPTH));
  const assetUrls = new Map(
    ir.assets
      .map((asset) => [asset.id, options.assetUrlMap?.[asset.id] ?? asset.localPath ?? asset.sourceUrl] as const)
      .filter((entry): entry is readonly [string, string] => typeof entry[1] === 'string' && entry[1].length > 0),
  );

  function allocateId(sourceId: string, suffix = ''): string {
    const base = `ir_${safeCssId(sourceId)}${suffix}`;
    let id = base;
    let index = 2;
    while (usedIds.has(id)) id = `${base}_${index++}`;
    usedIds.add(id);
    return id;
  }

  /**
   * The element each IR `sourceId` became, plus the position facts the animation
   * mapper needs.
   *
   * Built during emission because that is the only place the mapping exists:
   * `emitNode` decides whether a node becomes a `heading` widget or a
   * `container`, and the entrance control name depends on exactly that. A second
   * walk over the finished tree could not recover which `sourceId` produced which
   * element — `allocateId` de-duplicates, so the id is not a reversible encoding.
   */
  const emitted = new Map<string, { element: V3Element; schemaKey: string; parentSourceId?: string; indexInParent?: number }>();

  function register(
    sourceId: string,
    element: V3Element,
    position: { parentSourceId?: string; indexInParent?: number },
  ): V3Element {
    // First registration wins. A flattened wrapper re-emits its children, and
    // the child's own entry is the one that addresses a real element.
    if (!emitted.has(sourceId)) {
      emitted.set(sourceId, {
        element,
        schemaKey: schemaKeyFor(element),
        ...position,
      });
    }
    return element;
  }

  function addDecision(
    node: VisualNodeIR | VisualSectionIR,
    decision: FidelityDecisionRecord['decision'],
    capability: string,
    severity: FidelityDecisionRecord['severity'] = 'info',
    blocking = false,
    lostBehavior?: string[],
  ): void {
    decisions.push({
      sourceId: node.sourceId,
      code: `${decision.toUpperCase().replace(/-/g, '_')}_${capability.toUpperCase().replace(/[^A-Z0-9]+/g, '_')}`,
      scope: 'nodes' in node ? 'section' : 'node',
      decision,
      capability,
      evidenceIds: node.evidence.sourceIds,
      confidence: node.evidence.confidence,
      severity,
      ...(lostBehavior ? { lostBehavior } : {}),
      approval: blocking ? 'pending' : 'not-required',
      blocking,
      qaChecks: ['v3-guards', 'section-visual-diff'],
    });
  }

  /**
   * The control map to resolve CSS against for one schema key.
   *
   * A passed schema always wins. `offlineControlsFor` is the fallback and is
   * deliberately narrower than the live schema — it omits every control whose
   * `if` condition selects a RENDERING MODE rather than enabling a style, so the
   * offline path drops those properties instead of, say, turning a plain divider
   * into a line-with-text to make a font size apply.
   */
  function controlsFor(schemaKey: string): WidgetControlMap | undefined {
    const live = options.schema?.schema[schemaKey]?.controls;
    return live ?? offlineControlsFor(schemaKey);
  }

  /**
   * CSS properties that INHERIT, and whose loss on a non-text element is
   * therefore not automatically a loss at all.
   *
   * The IR carries *computed* styles, so inheritance is already resolved: a
   * heading inside a container that sets `font-family` carries that font itself.
   * Dropping the container's copy changes nothing — provided every text-bearing
   * descendant really does carry its own value, which `inheritanceIsCovered`
   * checks rather than assumes.
   *
   * Measured on a real page: 184 non-text elements carried typography, 136 of
   * them with no text descendant at all and the remaining 48 with descendants
   * that all carried their own. Zero uncovered. Reporting those 570 declarations
   * as dropped styling was noise that hid the genuine gaps.
   */
  const INHERITED_CSS_PROPERTIES: ReadonlySet<string> = new Set([
    'color',
    'font-family',
    'font-size',
    'font-weight',
    'line-height',
    'letter-spacing',
    'text-align',
  ]);

  const TEXT_BEARING_ROLES: ReadonlySet<string> = new Set(['heading', 'text', 'button']);

  /**
   * True when `node` renders text of its own.
   *
   * Role is not sufficient. A `component` instance that was never expanded, and
   * an `unknown` leaf carrying text, both become `html` widgets — and the `html`
   * widget declares NO typography or colour control at all, so such a node can
   * never carry its own value. Judging those by role would mark them "covered"
   * and silently drop the only styling their text could have had.
   */
  function rendersText(node: VisualNodeIR): boolean {
    if (TEXT_BEARING_ROLES.has(node.role)) return true;
    return typeof node.text === 'string' && node.text.trim().length > 0;
  }

  /**
   * True when dropping `cssProperty` on `node` loses nothing, because every
   * text-rendering descendant already carries its own value.
   *
   * A node with no text descendant is covered trivially: there is nothing for
   * the property to style — the 136 measured childless spacers are exactly this
   * case. A descendant that does NOT carry its own value is NOT covered, and the
   * drop is reported as the real loss it is.
   */
  function inheritanceIsCovered(node: VisualNodeIR | VisualSectionIR, cssProperty: string): boolean {
    const children = 'nodes' in node ? node.nodes : node.children;
    const pending: VisualNodeIR[] = [...children];
    while (pending.length > 0) {
      const current = pending.pop()!;
      if (rendersText(current) && current.styles?.[cssProperty] === undefined) return false;
      pending.push(...current.children);
    }
    return true;
  }

  /**
   * Map one CSS declaration onto `settings` for the element being written.
   *
   * Records a decision for a dropped property rather than only a warning: a
   * property the target cannot express is precisely what `FidelityDecisionRecord`
   * exists to report, and the run report reads decisions, not the warning list.
   */
  function applyCssDeclaration(args: {
    node: VisualNodeIR | VisualSectionIR;
    schemaKey: string;
    controls: WidgetControlMap;
    cssProperty: string;
    value: unknown;
    breakpoint?: 'tablet' | 'mobile';
    settings: Record<string, unknown>;
  }): void {
    const { node, schemaKey, controls, cssProperty, value, breakpoint, settings } = args;
    const resolution = resolveCssControl(cssProperty, schemaKey, controls, value);

    if (!isResolvedCssControl(resolution)) {
      // A no-op or a source-internal variable is not a loss, so it produces
      // neither a warning nor a decision. Reporting them buried the real gaps:
      // on one measured page 209 `display: flex` declarations (the container's
      // own default) and 80 `--framer-prop-*` properties drowned out 40
      // genuinely unsupported `opacity` declarations.
      if (resolution.reason === 'no-op' || resolution.reason === 'source-variable') return;
      // An inheritable property the element cannot express is only a loss when
      // some text descendant relied on inheriting it.
      if (
        INHERITED_CSS_PROPERTIES.has(cssProperty)
        && inheritanceIsCovered(node, cssProperty)
      ) {
        return;
      }
      warnings.push(`${node.sourceId}: ${cssProperty} was dropped — ${resolution.detail}`);
      addDecision(node, 'unsupported', `css-${cssProperty}`, 'warning', false, [
        `${cssProperty}: ${String(value)}`,
      ]);
      return;
    }

    const { controlId, control, companions, responsive } = resolution;

    if (breakpoint !== undefined && !responsive) {
      warnings.push(
        `${node.sourceId}: ${cssProperty} at ${breakpoint} was dropped — ` +
          `${schemaKey}.${controlId} declares no responsive capability, so a ` +
          `"_${breakpoint}" suffix is not a valid control`,
      );
      addDecision(node, 'static-approximation', `css-${cssProperty}-${breakpoint}`, 'warning', false, [
        `${cssProperty} at ${breakpoint}`,
      ]);
      return;
    }

    const coerced = coerceControlValue(controlId, control, value);
    if (!coerced.ok) {
      warnings.push(`${node.sourceId}: ${cssProperty} was dropped — ${coerced.reason}`);
      addDecision(node, 'unsupported', `css-${cssProperty}-value`, 'warning', false, [
        `${cssProperty}: ${String(value)}`,
      ]);
      return;
    }

    const key = breakpoint === undefined ? controlId : breakpointKey(controlId, breakpoint);
    settings[key] = coerced.value;
    // Companions are never breakpoint-suffixed: they enable the control group as
    // a whole (`typography_typography`) or select a background type, and both are
    // declared non-responsive in the live schema.
    for (const [companionId, companionValue] of Object.entries(companions)) {
      settings[companionId] = companionValue;
    }
  }

  function styleSettings(
    node: VisualNodeIR | VisualSectionIR,
    schemaKey: string,
    consumed: readonly string[] = [],
  ): Record<string, unknown> {
    const settings: Record<string, unknown> = {};
    const skip = new Set(consumed);
    const controls = controlsFor(schemaKey);
    if (controls === undefined) {
      // No live schema and no offline table entry. Writing the CSS anyway is
      // what produced the 724-error tree, so nothing is written and the gap is
      // reported once per element rather than once per property.
      const styleCount = Object.keys(node.styles ?? {}).length;
      if (styleCount > 0) {
        warnings.push(
          `${node.sourceId}: no control map is known for "${schemaKey}", so its ` +
            `${styleCount} style(s) were dropped rather than written with unverified control ids`,
        );
        addDecision(node, 'unsupported', `styles-${schemaKey}`, 'warning', false, ['element styling']);
      }
      return settings;
    }

    for (const [cssProperty, value] of Object.entries(node.styles ?? {})) {
      if (skip.has(cssProperty)) continue;
      if (FLEX_ITEM_CSS_PROPERTIES.includes(cssProperty)) continue;
      applyCssDeclaration({ node, schemaKey, controls, cssProperty, value, settings });
    }

    // The flex pair is resolved as a UNIT, after the per-property loop and
    // therefore outside it. `_flex_size` is a `choose` whose every option writes
    // BOTH `--flex-grow` and `--flex-shrink`, so mapping either property alone
    // would silently decide the other axis — see `resolveFlexItemSizing`.
    applyFlexItemSizing(node, schemaKey, controls, node.styles, settings, skip);

    for (const [breakpoint, overrides] of Object.entries(node.responsiveOverrides ?? {})) {
      if (!RESPONSIVE_BREAKPOINTS.has(breakpoint)) {
        warnings.push(`${node.sourceId}: unsupported responsive breakpoint ${breakpoint}`);
        continue;
      }
      for (const [cssProperty, value] of Object.entries(overrides)) {
        if (skip.has(cssProperty)) continue;
        if (FLEX_ITEM_CSS_PROPERTIES.includes(cssProperty)) continue;
        applyCssDeclaration({
          node,
          schemaKey,
          controls,
          cssProperty,
          value,
          breakpoint: breakpoint as 'tablet' | 'mobile',
          settings,
        });
      }
      applyFlexItemSizing(
        node,
        schemaKey,
        controls,
        overrides,
        settings,
        skip,
        breakpoint as 'tablet' | 'mobile',
      );
    }

    return settings;
  }

  /**
   * Write the flex-item sizing group for one style set, or report its loss.
   *
   * A dropped pair is a real fidelity fact and not a no-op: Elementor's own
   * default for an unset `_flex_size` in a flex row is `0/1` on most widget kinds
   * but `1/1` on a divider (its stylesheet consumes
   * `--container-widget-flex-grow`, which the row dictionary sets to 1). So a
   * hugging source box whose pair was dropped can arrive as a box that fills the
   * row.
   *
   * A breakpoint variant is only written when the control is responsive. All three
   * ids declare `r: 1` live, but the check is made against the schema rather than
   * assumed, exactly as `applyCssDeclaration` does.
   */
  function applyFlexItemSizing(
    node: VisualNodeIR | VisualSectionIR,
    schemaKey: string,
    controls: WidgetControlMap,
    styles: Readonly<Record<string, unknown>> | undefined,
    settings: Record<string, unknown>,
    skip: ReadonlySet<string>,
    breakpoint?: 'tablet' | 'mobile',
  ): void {
    if (styles === undefined) return;
    const present = FLEX_ITEM_CSS_PROPERTIES.filter(
      (property) => !skip.has(property) && styles[property] !== undefined,
    );
    if (present.length === 0) return;

    const resolved = resolveFlexItemSizing(styles, controls);
    if (resolved === undefined) {
      // A section is not a flex item, so it has no sizing to lose.
      if (schemaKey === 'section' || schemaKey === 'column') return;
      const measured = FLEX_ITEM_CSS_PROPERTIES.map((property) => `${property}: ${String(styles[property])}`);
      warnings.push(
        `${node.sourceId}: flex sizing was dropped — ${schemaKey} declares no ` +
          `_flex_size/_flex_grow/_flex_shrink group, or only one axis was measured (${measured.join(', ')})`,
      );
      addDecision(node, 'unsupported', 'css-flex-item-sizing', 'warning', false, measured);
      return;
    }

    for (const [controlId, value] of Object.entries(resolved)) {
      if (breakpoint === undefined) {
        settings[controlId] = value;
        continue;
      }
      if (controls[controlId]?.r !== 1) {
        warnings.push(
          `${node.sourceId}: flex sizing at ${breakpoint} was dropped — ` +
            `${schemaKey}.${controlId} declares no responsive capability`,
        );
        addDecision(node, 'static-approximation', `css-flex-item-sizing-${breakpoint}`, 'warning', false, [
          `flex sizing at ${breakpoint}`,
        ]);
        return;
      }
      settings[breakpointKey(controlId, breakpoint)] = value;
    }
  }

  /**
   * A media URL in the form WordPress will actually serve.
   *
   * `esc_url()` STRIPS `<`, `>`, `"` and `'` instead of encoding them, so a raw
   * `data:image/svg+xml,<svg …>` reaches the browser without the characters that
   * made it SVG — a blank image, with a successful write and a clean read-back
   * behind it. Measured: 4 of 6 images on a live deploy. The rewrite is reported
   * as a decision because the asset is not byte-identical to the source any more.
   */
  function mediaUrl(node: VisualNodeIR | VisualSectionIR, url: string): string {
    const normalized = normalizeMediaUrlForWordPress(url);
    if (!normalized.rewritten) return normalized.url;
    addDecision(node, 'native', 'media-url-reencoded', 'info', false);
    warnings.push(`${node.sourceId}: ${normalized.reason}`);
    return normalized.url;
  }

  /**
   * Write a container's own media as `background_image`.
   *
   * A node that carries an `assetId` AND authored children cannot become an
   * image widget — that widget has no children, so the subtree would be
   * discarded. Framer renders exactly this shape as a background: an `<img
   * style="object-fit:cover">` filling an absolutely-positioned wrapper behind
   * the content (measured on the captured page: 101 of 107 `<img>` are
   * `object-fit: cover; object-position: center`). Elementor's own
   * `background_image` + `background_size: cover` is the same rendering, so the
   * container keeps its children and still shows its image.
   *
   * Without this the media was silently dropped: `classifyDomRole` no longer
   * claims `image` for a node with children, and no other branch reads
   * `assetId`. Measured on the captured Humeen page: 6 image URLs are reachable
   * ONLY through such a node.
   *
   * The companion keys are mandatory, not decoration. `background_image` is
   * gated on `background_background: ['classic']` and both `background_position`
   * and `background_size` additionally on `background_image[url]!: ''` — a bare
   * `background_image` is stored and never rendered, which is the same class of
   * bug as a colour without its companion.
   */
  function applyNodeBackgroundImage(node: VisualNodeIR, settings: Record<string, unknown>): void {
    if (node.assetId === undefined) return;
    const rawUrl = assetUrls.get(node.assetId);
    if (rawUrl === undefined) {
      addDecision(node, 'unsupported', 'background-image-asset', 'critical', true, [
        'container background image',
      ]);
      warnings.push(`${node.sourceId}: background asset could not be resolved`);
      return;
    }
    settings.background_image = { url: mediaUrl(node, rawUrl), id: '' };
    settings.background_background = 'classic';
    settings.background_position = 'center center';
    settings.background_size = 'cover';
    addDecision(node, 'native', 'container-background-image');
  }

  /** Emit the children of `node`, telling each its position for stagger. */
  function emitChildren(node: VisualNodeIR, depth: number): V3Element[] {
    return node.children.flatMap((child, index) =>
      emitNode(child, depth, { parentSourceId: node.sourceId, indexInParent: index }),
    );
  }

  function emitNode(
    node: VisualNodeIR,
    depth: number,
    position: { parentSourceId?: string; indexInParent?: number } = {},
  ): V3Element[] {
    const id = allocateId(node.sourceId);
    /**
     * Styles for the element type this branch decided on.
     *
     * Called INSIDE each branch, never before: the control ids depend entirely
     * on the schema key, and computing one settings object up front for every
     * node type is exactly what wrote 75 typography keys onto spacers.
     *
     * `consumed` lists CSS properties the branch handles itself — a spacer's
     * height becomes `space`, a divider's colour becomes `color`. Passing them
     * here rather than deleting keys afterwards means the generic mapping never
     * resolves them, so no companion is written for a setting that then gets
     * overwritten.
     */
    const stylesFor = (schemaKey: string, consumed: readonly string[] = []): Record<string, unknown> => ({
      ...styleSettings(node, schemaKey, consumed),
      _element_id: `visual-ir-${safeCssId(id)}`,
    });
    const keep = (element: V3Element): V3Element[] => [register(node.sourceId, element, position)];

    if (node.role === 'heading') {
      addDecision(node, 'native', 'heading');
      return keep({
        id,
        elType: 'widget',
        widgetType: 'heading',
        settings: { ...stylesFor('heading'), title: node.text ?? '', header_size: headingTag(node.tag) },
      });
    }
    if (node.role === 'text') {
      addDecision(node, 'native', 'text');
      return keep({
        id,
        elType: 'widget',
        widgetType: 'text-editor',
        settings: { ...stylesFor('text-editor'), editor: node.text ?? '' },
      });
    }
    if (node.role === 'button') {
      addDecision(node, 'native', 'button');
      return keep({
        id,
        elType: 'widget',
        widgetType: 'button',
        settings: {
          ...stylesFor('button'),
          text: node.text ?? '',
          link: { url: node.href ?? '#', is_external: '', nofollow: '' },
        },
      });
    }
    if (node.role === 'image') {
      const rawUrl = node.assetId ? assetUrls.get(node.assetId) : undefined;
      if (!rawUrl) {
        addDecision(node, 'unsupported', 'image-asset', 'critical', true, ['visible image asset']);
        warnings.push(`${node.sourceId}: image asset could not be resolved`);
      } else {
        addDecision(node, 'native', 'image');
      }
      const url = rawUrl === undefined ? undefined : mediaUrl(node, rawUrl);
      // The alt text rides on the media object. `image_alt` is NOT a control of
      // the image widget — live-verified, and it was 6 of the measured
      // `unknown-key` errors. Elementor reads alt text from the attachment, so a
      // URL-only image has nowhere to put it; that loss is reported rather than
      // written to a key the server rejects.
      if (url && node.text) {
        addDecision(node, 'static-approximation', 'image-alt', 'info', false, ['image alt text']);
      }
      return keep({
        id,
        elType: 'widget',
        widgetType: 'image',
        settings: { ...stylesFor('image'), image: { url: url ?? '', id: '' } },
      });
    }
    if (node.role === 'icon') {
      addDecision(node, 'native', 'icon');
      return keep({
        id,
        elType: 'widget',
        widgetType: 'icon',
        settings: {
          ...stylesFor('icon'),
          selected_icon: { value: node.text ?? 'fas fa-star', library: 'fa-solid' },
        },
      });
    }

    // A component instance whose definition was never expanded. This is a
    // known, reportable gap — NOT an "unknown node". Emitting it as a silent
    // empty widget is exactly the kind of quiet loss the charter forbids.
    if (node.role === 'component' && node.children.length === 0) {
      const componentId = node.componentId ?? 'unknown';
      addDecision(node, 'static-approximation', `component-instance-${componentId}`, 'warning', false, [
        'component internal structure',
        'component variant behaviour',
      ]);
      warnings.push(
        `${node.sourceId}: component instance ${componentId} was not expanded; ` +
          'call resolveComponent() and re-emit, or accept a placeholder',
      );
      return keep({
        id,
        elType: 'widget',
        widgetType: 'html',
        settings: {
          ...stylesFor('html'),
          html: `<!-- elconv: unexpanded Framer component ${componentId} (${node.sourceId}) -->`,
        },
      });
    }

    if (node.children.length > 0) {
      // A node carrying a resolvable image is VISIBLE CONTENT, not a wrapper, so
      // the depth cap does not apply to it. Flattening drops the element that
      // would have held the settings, and `background_image` has nowhere else to
      // go — the children each carry their own box. Measured on
      // `output/live-framer/home-ir-aligned.json`: 3 of the 7 asset-bearing
      // nodes sit at emitted depth 5 with one child each, so the cap alone would
      // discard 3 of the 4 container backgrounds this emitter can produce.
      //
      // The cost is one level past the repo-wide cap of 3 on those nodes, which
      // `runNestingAudit` reports. A reported extra level is a smaller loss than
      // an image that silently disappears (charter: no quiet loss).
      const carriesMedia = node.assetId !== undefined && assetUrls.has(node.assetId);
      if (depth >= maxContainerDepth && !carriesMedia) {
        addDecision(node, 'static-approximation', 'nested-layout', 'warning', false, ['original wrapper semantics']);
        warnings.push(`${node.sourceId}: container depth ${maxContainerDepth} reached; wrapper flattened and descendants preserved`);
        // This node produces NO element of its own, so it is not registered. An
        // animation targeting it is then reported as unresolvable rather than
        // silently applied to a child that merely inherited its position.
        return emitChildren(node, depth + 1);
      }
      if (depth >= maxContainerDepth) {
        warnings.push(
          `${node.sourceId}: kept at container depth ${depth} despite the cap of ${maxContainerDepth} ` +
            'because it carries a background image that would otherwise be dropped',
        );
      }
      addDecision(node, 'native', 'layout-container');
      const settings = stylesFor(CONTAINER_SCHEMA_KEY);
      applyNodeBackgroundImage(node, settings);
      return keep({
        id,
        elType: 'container',
        // Every container emitted here lives inside the section+column that
        // emitSection() creates, so it is ALWAYS nested — `depth > 0` was wrong
        // and produced containers that Elementor renders at the wrong level.
        isInner: true,
        // `flex_direction` is a `choose` control: `undefined` is NOT an allowed
        // value and the schema gate rejects the key outright (measured: 9 errors
        // on a live page). Only the MEASURED direction is written; see
        // `flexDirectionSetting`.
        ...flexDirectionSetting(node, settings),
        settings,
        elements: emitChildren(node, depth + 1),
      });
    }

    // Childless, textless nodes. Framer uses these as spacers, rules and
    // scroll triggers; emitting an empty `html` widget for each produced 43
    // empty widgets and an HTML ratio of 58.9% on a real page.
    const structural = classifyStructuralLeaf(node);
    if (structural === 'divider') {
      addDecision(node, 'native', 'divider');
      // On a divider the rule's colour is the `color` control — gated on
      // `style != 'none'`, which its own default satisfies. Every OTHER colour
      // control the widget declares is gated on `look`, so the generic mapping
      // cannot reach one; `background-color` is therefore consumed here and
      // excluded from the generic pass, which would otherwise paint the
      // wrapper box behind the rule instead of the rule itself.
      const color = node.styles?.['background-color'];
      const weight = toDimensionValue(node.styles?.height ?? '1px');
      return keep({
        id,
        elType: 'widget',
        widgetType: 'divider',
        settings: {
          ...stylesFor('divider', ['background-color', 'height']),
          style: 'solid',
          ...(weight === undefined ? {} : { weight }),
          ...(typeof color === 'string' ? { color } : {}),
        },
      });
    }
    if (structural === 'spacer') {
      addDecision(node, 'native', 'spacer');
      // The height IS the spacer, so it becomes `space` rather than a wrapper
      // dimension. A spacer's background colour has no visible effect on an
      // empty box and Elementor would need the `_background_background`
      // companion to render it at all, so it is dropped and reported.
      //
      // The MEASURED box is the fallback, and it carries most of the page:
      // Framer sizes these nodes by flex layout rather than by an explicit
      // `height`, so `node.styles.height` is absent on nearly all of them and
      // every one collapsed to Elementor's 50px default. Measured on
      // precious-board-067119: 142 such nodes, and the Statement section alone
      // lost 2244px of 3690px that way. A measured box is evidence, not a guess —
      // it is the height the source actually rendered at this viewport.
      const height = node.styles?.height ?? node.styles?.['min-height'];
      const declared = height === undefined ? undefined : toDimensionValue(height);
      const space = declared ?? measuredSpace(node);
      return keep({
        id,
        elType: 'widget',
        widgetType: 'spacer',
        settings: {
          ...stylesFor('spacer', ['background-color', 'height', 'min-height']),
          ...(space === undefined ? {} : { space }),
        },
      });
    }

    addDecision(node, 'static-approximation', 'unknown-node', 'warning', false, ['unknown runtime semantics']);
    return keep({ id, elType: 'widget', widgetType: 'html', settings: { ...stylesFor('html'), html: node.text ?? '' } });
  }

  function emitSection(section: VisualSectionIR): V3Element {
    const sectionId = allocateId(section.sourceId, '-section');
    addDecision(section, 'native', 'section');
    const backgroundSettings: Record<string, unknown> = {};
    if (section.background?.color) {
      backgroundSettings.background_color = section.background.color;
      // Same companion rule as everywhere else: a colour without
      // `background_background` is stored and never rendered. A section has no
      // schema to derive it from (Elementor reports `section` as missing), so it
      // is written from the legacy table's naming family — bare, not `_`-prefixed.
      backgroundSettings.background_background = 'classic';
    }
    if (section.background?.assetId) {
      const backgroundUrl = assetUrls.get(section.background.assetId);
      if (backgroundUrl) {
        // Same esc_url() rewrite as an image widget — a section background is a
        // media URL and goes through the identical escaping on render.
        backgroundSettings.background_image = { url: mediaUrl(section, backgroundUrl), id: '' };
        backgroundSettings.background_position = 'center center';
        backgroundSettings.background_background = 'classic';
        addDecision(section, 'native', 'background-image');
      } else {
        addDecision(section, 'unsupported', 'background-image-asset', 'critical', true, ['section background image']);
        warnings.push(`${section.sourceId}: background asset could not be resolved`);
      }
    }
    const element: V3Element = {
      id: sectionId,
      elType: 'section',
      settings: {
        ...styleSettings(section, 'section'),
        ...backgroundSettings,
        content_width: 'boxed',
        _element_id: `visual-ir-${safeCssId(sectionId)}`,
      },
      elements: [{
        id: allocateId(section.sourceId, '-column'),
        elType: 'column',
        settings: { _column_size: 100 },
        elements: section.nodes.flatMap((node, index) =>
          emitNode(node, 0, { parentSourceId: section.sourceId, indexInParent: index }),
        ),
      }],
    };
    // A section has no parent for stagger purposes: sibling sections revealing in
    // a delay ramp is not choreography, it is a page that loads oddly.
    return register(section.sourceId, element, {});
  }

  const tree = ir.sections.map(emitSection);

  const animationResolutions = applyAnimations();

  const canContinue = canContinueWithFidelityDecisions(decisions);
  return {
    tree,
    decisions,
    warnings,
    sourceSectionIds: ir.sections.map((section) => section.sourceId),
    blocked: !canContinue,
    canContinue,
    animationResolutions,
    elementIdBySourceId: collectElementIds(),
  };

  /**
   * Read the `_element_id` actually written onto each registered element.
   *
   * Read back rather than recomputed. Every emitted element gets an
   * `_element_id`, but a `column` wrapper does not, and neither would a future
   * element type that skips the settings block — so an entry is only recorded
   * when the value is really there. A selector built from a missing id would be
   * `#undefined`.
   */
  function collectElementIds(): Record<string, string> {
    const map: Record<string, string> = {};
    for (const [sourceId, entry] of emitted) {
      const elementId = entry.element.settings?._element_id;
      if (typeof elementId === 'string' && elementId.length > 0) map[sourceId] = elementId;
    }
    return map;
  }

  /**
   * Run the animation mapper and merge its settings into the emitted elements.
   *
   * Declared after the return as a hoisted function so the emission code above
   * reads top-down; it must run after `tree` is built because `emitted` is only
   * complete then.
   */
  function applyAnimations(): AnimationResolution[] {
    const sticky = options.stickyCandidates ?? [];
    if (ir.animations.length === 0 && sticky.length === 0) return [];

    if (options.schema === undefined) {
      // No schema: emit nothing and say why. Previously this path reported
      // `static-approximation`, which claimed an approximation had been made
      // while in fact no setting was written at all.
      for (const animation of ir.animations) {
        addDecision(
          { sourceId: animation.targetSourceId, role: 'unknown', children: [], evidence: animation.evidence },
          'unsupported',
          'animation',
          'warning',
          false,
          [animation.intent],
        );
      }
      if (ir.animations.length > 0 || sticky.length > 0) {
        warnings.push(
          `${ir.animations.length} animation(s) and ${sticky.length} sticky candidate(s) were not applied: ` +
            'no control schema was passed, and the container-vs-widget control names cannot be guessed ' +
            '(pass options.schema, e.g. from loadWidgetSchemaFromSnapshot())',
        );
      }
      return [];
    }

    const resolveTarget = (sourceId: string): AnimationTargetInfo | undefined => {
      const entry = emitted.get(sourceId);
      if (entry === undefined) return undefined;
      return {
        schemaKey: entry.schemaKey,
        ...(entry.parentSourceId !== undefined ? { parentSourceId: entry.parentSourceId } : {}),
        ...(entry.indexInParent !== undefined ? { indexInParent: entry.indexInParent } : {}),
      };
    };

    const mapped = mapAnimations(ir.animations, {
      schema: options.schema,
      resolveTarget,
      ...(options.staggerStepMs !== undefined ? { staggerStepMs: options.staggerStepMs } : {}),
      ...(options.disableStagger !== undefined ? { disableStagger: options.disableStagger } : {}),
    });
    const stickyMapped = sticky.length > 0
      ? mapSticky(sticky, { schema: options.schema, resolveTarget })
      : undefined;

    for (const source of [mapped, stickyMapped]) {
      if (source === undefined) continue;
      warnings.push(...source.warnings);
      for (const [sourceId, settings] of Object.entries(source.settingsByTarget)) {
        const entry = emitted.get(sourceId);
        // Cannot happen for a resolved target, but a missing element must not
        // become a thrown error in an emitter that is otherwise report-only.
        if (entry === undefined) continue;
        entry.element.settings = { ...entry.element.settings, ...settings };
      }
      for (const resolution of source.resolutions) {
        recordAnimationDecision(resolution);
      }
    }

    return [...mapped.resolutions, ...(stickyMapped?.resolutions ?? [])];
  }

  /**
   * Turn one mapper verdict into a `FidelityDecisionRecord`.
   *
   * The mapper's decisions are already the charter's vocabulary, so they map
   * across unchanged rather than being collapsed to `static-approximation`. That
   * distinction is the point: `native` means the effect is reproduced,
   * `js-fallback` means a snippet still owes work, and reporting both as an
   * approximation is what hid the missing animation path in the first place.
   */
  function recordAnimationDecision(resolution: AnimationResolution): void {
    const severity: FidelityDecisionRecord['severity'] =
      resolution.decision === 'native'
        ? 'info'
        : resolution.decision === 'unsupported'
          ? 'critical'
          : 'warning';
    decisions.push({
      sourceId: resolution.targetSourceId,
      code: `${resolution.decision.toUpperCase().replace(/-/g, '_')}_ANIMATION`,
      scope: 'node',
      decision: resolution.decision,
      capability: 'animation',
      evidenceIds: [resolution.animationId],
      // The mapper's verdict is derived from the schema and from measured
      // amplitudes, so it is a high-confidence statement about the TARGET's
      // capability — not a guess about the source.
      confidence: 0.95,
      severity,
      ...(resolution.precisionLoss.length > 0 ? { lostBehavior: resolution.precisionLoss } : {}),
      // An unmappable animation must not block a build: the effect is reported
      // and, where possible, carried by a residual snippet.
      approval: 'not-required',
      blocking: false,
      qaChecks: ['v3-guards', 'schema-gate', 'section-visual-diff'],
    });
  }
}

/**
 * The schema key an emitted element is validated against.
 *
 * `section` and `column` have no schema (`elementor-get-schema` reports them as
 * missing) but they DO belong to the container naming family — both register
 * plain `animation` / `animation_delay` / `animation_duration` and neither
 * declares `_animation`, verified by reading the installed plugin. Returning
 * their own elType lets `isContainerFamily` resolve the right names while
 * keeping the "no schema entry" fact intact.
 */
function schemaKeyFor(element: V3Element): string {
  if (element.elType === 'container') return CONTAINER_SCHEMA_KEY;
  if (element.elType === 'widget') return element.widgetType ?? 'html';
  return element.elType;
}

/**
 * Classify a childless, textless node.
 *
 * Framer has no spacer or divider primitive: authors use a thin frame with a
 * background colour as a rule, and an empty frame with a fixed height as a
 * spacer. Measured on a real page: 15 such leaves — 8 scroll `Trigger` frames
 * at `30vh`, an `Indent` at `190x1px`, a `Divider` and a `Line` that carry a
 * colour, and a 2000px `Frame`. Mapping all of them to an empty `html` widget
 * is what pushed the HTML ratio to 58.9% and produced 43 empty widgets.
 */
function classifyStructuralLeaf(node: VisualNodeIR): 'divider' | 'spacer' | undefined {
  if (node.role !== 'layout' && node.role !== 'unknown') return undefined;
  if (node.children.length > 0 || node.text || node.assetId) return undefined;

  const styles = node.styles ?? {};
  const height = parseCssLength(styles.height ?? styles['min-height']);
  const width = parseCssLength(styles.width ?? styles['max-width']);
  const hasColor = Boolean(styles['background-color']);

  // A visible rule: one axis is hairline-thin AND it carries a colour.
  const THIN_PX = 4;
  const isThin = (height !== undefined && height.unit === 'px' && height.size <= THIN_PX)
    || (width !== undefined && width.unit === 'px' && width.size <= THIN_PX);
  if (isThin && hasColor) return 'divider';

  // Anything else childless and textless occupies space and nothing more.
  return 'spacer';
}

function parseCssLength(value: string | undefined): { size: number; unit: string } | undefined {
  if (!value) return undefined;
  const match = /^(-?\d+(?:\.\d+)?)(px|%|em|rem|vw|vh)?$/.exec(value.trim());
  if (!match) return undefined;
  return { size: Number(match[1]), unit: match[2]?.toLowerCase() ?? 'px' };
}

/**
 * The spacer height a node's measured box implies, when no CSS height was set.
 *
 * The widest captured viewport is used because that is the one a V3 tree's
 * unsuffixed settings describe; the narrower ones arrive as `_tablet`/`_mobile`
 * overrides through `responsiveOverrides`.
 *
 * A zero-height box yields nothing rather than `space: 0`: a spacer that occupies
 * no space is a node the source did not render, and asserting 0px would be a claim
 * the measurement does not support.
 */
function measuredSpace(node: VisualNodeIR): { unit: string; size: number } | undefined {
  const boxes = Object.values(node.bboxByViewport ?? {});
  if (boxes.length === 0) return undefined;
  const widest = boxes.reduce((best, box) => (box.width > best.width ? box : best), boxes[0]!);
  const height = Math.round(widest.height);
  return height > 0 ? { unit: 'px', size: height } : undefined;
}

/**
 * The `flex_direction` entry for a container, or nothing at all.
 *
 * `flex_direction` is a `choose` control whose allowed values are
 * `row|column|row-reverse|column-reverse`. Writing `undefined` is not "leave it
 * default" — the key is present with an invalid value and the schema gate rejects
 * it (measured: 9 errors on one live page).
 *
 * Only the MEASURED direction is written. There is no fallback: an absent value
 * means the capture saw no flex container, and guessing `column` for every layout
 * node turned rendered rows into columns wherever the capture had filtered `row`
 * as a CSS default. Omitting the key leaves Elementor's own container default
 * (`.e-con.e-flex { --flex-direction: column }`) in force, which is the same
 * outcome for a genuine column and no longer a fabrication for a row.
 */
function flexDirectionSetting(
  node: VisualNodeIR,
  settings: Record<string, unknown>,
): { settings?: never } | Record<string, never> {
  const measured = node.styles?.['flex-direction'];
  if (measured === undefined || !ALLOWED_FLEX_DIRECTIONS.has(measured)) return {};
  settings.flex_direction = measured;
  return {};
}

const ALLOWED_FLEX_DIRECTIONS: ReadonlySet<string> = new Set([
  'row',
  'column',
  'row-reverse',
  'column-reverse',
]);

function safeCssId(sourceId: string): string {
  return sourceId.replace(/[^a-zA-Z0-9_-]/g, '-').replace(/^-+|-+$/g, '') || 'node';
}

function headingTag(tag: string | undefined): 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6' {
  return /^h[1-6]$/i.test(tag ?? '') ? (tag!.toLowerCase() as 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6') : 'h2';
}

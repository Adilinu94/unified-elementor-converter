/**
 * VisualPageIR -> Elementor V3 emitter.
 *
 * This is the generic target path. The legacy Framer XML mapper remains
 * available for compatibility, but new source adapters should emit VisualPageIR
 * and cross this target-neutral boundary before building a V3 tree.
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
} from '@elconv/core';
import { canContinueWithFidelityDecisions, validateVisualPageIR, breakpointKey } from '@elconv/core';
import { RESPONSIVE_BREAKPOINTS as CORE_RESPONSIVE_BREAKPOINTS } from '@elconv/core';
import { CONTAINER_SCHEMA_KEY } from '@elconv/core';
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

/**
 * Control ids Elementor registers as sliders, which reject a plain string.
 *
 * Each one must arrive as `{ size, unit }`. Verified against the committed
 * control snapshot; the schema gate reports any omission as `wrong-shape`, which
 * is a hard build error rather than a rendering quirk.
 */
const SLIDER_CONTROL_KEYS: ReadonlySet<string> = new Set([
  'typography_font_size',
  'typography_line_height',
  'typography_letter_spacing',
  'typography_word_spacing',
  'width',
  'min_height',
  'height',
  'max_width',
]);

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
   * Coerce a CSS string into the shape the control actually expects.
   *
   * The list of slider controls is not a style choice — it is what the schema
   * gate enforces. Measured on a live hybrid IR: 80 `wrong-shape` errors, all
   * from `typography_letter_spacing` and `typography_line_height` receiving a
   * raw string, because those two were missing here while `typography_font_size`
   * was present. Elementor rejects a slider control given a string, so the whole
   * write fails.
   *
   * `letter_spacing` matters twice over: the value is routinely `em`-based and
   * negative (`-0.03em` on the measured page), so it must survive as
   * `{ size: -0.03, unit: 'em' }` rather than being rounded or dropped.
   */
  function normalizeSettingValue(key: string, value: unknown): unknown {
    if (typeof value !== 'string') return value;
    if (['padding', 'margin', 'border_radius'].includes(key)) return toBox(value);
    if (SLIDER_CONTROL_KEYS.has(key)) return toDimension(value);
    return value;
  }

  function responsiveSettings(node: VisualNodeIR | VisualSectionIR): Record<string, unknown> {
    const settings: Record<string, unknown> = {};
    for (const [breakpoint, overrides] of Object.entries(node.responsiveOverrides ?? {})) {
      if (!RESPONSIVE_BREAKPOINTS.has(breakpoint)) {
        warnings.push(`${node.sourceId}: unsupported responsive breakpoint ${breakpoint}`);
        continue;
      }
      for (const [rawKey, value] of Object.entries(overrides)) {
        const key = toV3SettingKey(rawKey, node);
        if (!key) {
          warnings.push(`${node.sourceId}: unsupported responsive property ${rawKey}`);
          continue;
        }
        // Elementor requires the `_tablet` / `_mobile` SUFFIX; a prefix is
        // stored but never rendered. breakpointKey() is the single source.
        // `key` is guaranteed to be a base control id because toV3SettingKey
        // only returns unsuffixed ids.
        settings[breakpointKey(key, breakpoint as 'tablet' | 'mobile')] = normalizeSettingValue(
          key,
          value,
        );
      }
    }
    return settings;
  }

  function styleSettings(node: VisualNodeIR | VisualSectionIR): Record<string, unknown> {
    const styles = node.styles ?? {};
    const settings: Record<string, unknown> = { ...responsiveSettings(node) };
    for (const [rawKey, rawValue] of Object.entries(styles)) {
      const key = toV3SettingKey(rawKey, node);
      if (!key) {
        warnings.push(`${node.sourceId}: unsupported style property ${rawKey}`);
        continue;
      }
      const value = normalizeSettingValue(key, rawValue);
      // A slider control that could not be coerced to `{ size, unit }` is a hard
      // schema-gate error, so the key is dropped rather than written. Measured:
      // `line-height: normal` — a real computed value with no numeric equivalent
      // — accounted for 25 of 28 remaining errors on a live page. Omitting it
      // lets Elementor apply its own line height, which is what `normal` means.
      if (SLIDER_CONTROL_KEYS.has(key) && typeof value === 'string') {
        warnings.push(
          `${node.sourceId}: ${rawKey}: "${value}" is not a numeric length, so ${key} was omitted ` +
            '(Elementor would reject a slider control given a keyword)',
        );
        continue;
      }
      settings[key] = value;
      if (key.startsWith('typography_') && key !== 'typography_font_family') {
        settings.typography_typography = 'custom';
      }
      // `background_color` is conditioned on `background_background` being one of
      // classic/gradient/video. Without the companion Elementor stores the colour
      // and never renders it, and the schema gate reports `missing-companion`
      // (measured: 6 on a live page). The companion is the whole reason the
      // colour has any effect.
      if (key === 'background_color') settings.background_background = 'classic';
    }
    return settings;
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
    const settings = { ...styleSettings(node), _element_id: `visual-ir-${safeCssId(id)}` };
    const keep = (element: V3Element): V3Element[] => [register(node.sourceId, element, position)];

    if (node.role === 'heading') {
      addDecision(node, 'native', 'heading');
      return keep({
        id,
        elType: 'widget',
        widgetType: 'heading',
        settings: { ...settings, title: node.text ?? '', header_size: headingTag(node.tag) },
      });
    }
    if (node.role === 'text') {
      addDecision(node, 'native', 'text');
      return keep({ id, elType: 'widget', widgetType: 'text-editor', settings: { ...settings, editor: node.text ?? '' } });
    }
    if (node.role === 'button') {
      addDecision(node, 'native', 'button');
      return keep({
        id,
        elType: 'widget',
        widgetType: 'button',
        settings: {
          ...settings,
          text: node.text ?? '',
          link: { url: node.href ?? '#', is_external: '', nofollow: '' },
        },
      });
    }
    if (node.role === 'image') {
      const url = node.assetId ? assetUrls.get(node.assetId) : undefined;
      if (!url) {
        addDecision(node, 'unsupported', 'image-asset', 'critical', true, ['visible image asset']);
        warnings.push(`${node.sourceId}: image asset could not be resolved`);
      } else {
        addDecision(node, 'native', 'image');
      }
      return keep({
        id,
        elType: 'widget',
        widgetType: 'image',
        settings: { ...settings, image: { url: url ?? '', id: '' }, image_alt: node.text ?? '' },
      });
    }
    if (node.role === 'icon') {
      addDecision(node, 'native', 'icon');
      return keep({
        id,
        elType: 'widget',
        widgetType: 'icon',
        settings: { ...settings, selected_icon: { value: node.text ?? 'fas fa-star', library: 'fa-solid' } },
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
          ...settings,
          html: `<!-- elconv: unexpanded Framer component ${componentId} (${node.sourceId}) -->`,
        },
      });
    }

    if (node.children.length > 0) {
      if (depth >= maxContainerDepth) {
        addDecision(node, 'static-approximation', 'nested-layout', 'warning', false, ['original wrapper semantics']);
        warnings.push(`${node.sourceId}: container depth ${maxContainerDepth} reached; wrapper flattened and descendants preserved`);
        // This node produces NO element of its own, so it is not registered. An
        // animation targeting it is then reported as unresolvable rather than
        // silently applied to a child that merely inherited its position.
        return emitChildren(node, depth + 1);
      }
      addDecision(node, 'native', 'layout-container');
      return keep({
        id,
        elType: 'container',
        // Every container emitted here lives inside the section+column that
        // emitSection() creates, so it is ALWAYS nested — `depth > 0` was wrong
        // and produced containers that Elementor renders at the wrong level.
        isInner: true,
        // `flex_direction` is a `choose` control: `undefined` is NOT an allowed
        // value and the schema gate rejects the key outright (measured: 9 errors
        // on a live page). Prefer the measured CSS when the DOM supplied one,
        // fall back to `column` for a layout node, and OMIT the key entirely
        // otherwise rather than writing a value the control does not accept.
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
      const color = node.styles?.['background-color'];
      return keep({
        id,
        elType: 'widget',
        widgetType: 'divider',
        settings: {
          ...omitKeys(settings, ['background_color']),
          style: 'solid',
          weight: toDimension(node.styles?.height ?? '1px'),
          ...(color ? { color } : {}),
        },
      });
    }
    if (structural === 'spacer') {
      addDecision(node, 'native', 'spacer');
      const height = node.styles?.height ?? node.styles?.['min-height'];
      return keep({
        id,
        elType: 'widget',
        widgetType: 'spacer',
        settings: {
          ...omitKeys(settings, ['background_color']),
          ...(height ? { space: toDimension(height) } : {}),
        },
      });
    }

    addDecision(node, 'static-approximation', 'unknown-node', 'warning', false, ['unknown runtime semantics']);
    return keep({ id, elType: 'widget', widgetType: 'html', settings: { ...settings, html: node.text ?? '' } });
  }

  function emitSection(section: VisualSectionIR): V3Element {
    const sectionId = allocateId(section.sourceId, '-section');
    addDecision(section, 'native', 'section');
    const backgroundSettings: Record<string, unknown> = {};
    if (section.background?.color) backgroundSettings.background_color = section.background.color;
    if (section.background?.assetId) {
      const backgroundUrl = assetUrls.get(section.background.assetId);
      if (backgroundUrl) {
        backgroundSettings.background_image = { url: backgroundUrl, id: '' };
        backgroundSettings.background_position = 'center center';
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
        ...styleSettings(section),
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

function omitKeys(settings: Record<string, unknown>, keys: string[]): Record<string, unknown> {
  const out = { ...settings };
  for (const key of keys) delete out[key];
  return out;
}

/**
 * The `flex_direction` entry for a container, or nothing at all.
 *
 * `flex_direction` is a `choose` control whose allowed values are
 * `row|column|row-reverse|column-reverse`. Writing `undefined` is not "leave it
 * default" — the key is present with an invalid value and the schema gate rejects
 * it (measured: 9 errors on one live page).
 *
 * The measured CSS wins when the DOM supplied one, because a component's real
 * direction is a fact rather than a default. `column` is the fallback for a
 * layout node, matching Framer's own vertical-stack default.
 */
function flexDirectionSetting(
  node: VisualNodeIR,
  settings: Record<string, unknown>,
): { settings?: never } | Record<string, never> {
  const measured = node.styles?.['flex-direction'];
  const value = ALLOWED_FLEX_DIRECTIONS.has(measured ?? '')
    ? measured
    : node.role === 'layout'
      ? 'column'
      : undefined;
  if (value === undefined) return {};
  settings.flex_direction = value;
  return {};
}

const ALLOWED_FLEX_DIRECTIONS: ReadonlySet<string> = new Set([
  'row',
  'column',
  'row-reverse',
  'column-reverse',
]);

function toV3SettingKey(rawKey: string, node: VisualNodeIR | VisualSectionIR): string | undefined {  const key = rawKey.trim();
  const cssMap: Record<string, string> = {
    'background-color': 'background_color',
    'font-family': 'typography_font_family',
    'font-size': 'typography_font_size',
    'font-weight': 'typography_font_weight',
    'line-height': 'typography_line_height',
    'letter-spacing': 'typography_letter_spacing',
    'text-align': 'align',
    'border-radius': 'border_radius',
    'min-height': 'min_height',
  };
  if (cssMap[key]) return cssMap[key];
  if (['padding', 'margin', 'border_radius', 'width', 'min_height', 'typography_font_size', 'typography_line_height', 'typography_font_family', 'typography_font_weight', 'typography_letter_spacing', 'align', 'background_color'].includes(key)) return key;
  if (key === 'color') {
    if ('role' in node && node.role === 'button') return 'button_text_color';
    if ('role' in node && node.role === 'text') return 'text_color';
    return 'title_color';
  }
  return undefined;
}

function safeCssId(sourceId: string): string {
  return sourceId.replace(/[^a-zA-Z0-9_-]/g, '-').replace(/^-+|-+$/g, '') || 'node';
}

function headingTag(tag: string | undefined): 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6' {
  return /^h[1-6]$/i.test(tag ?? '') ? (tag!.toLowerCase() as 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6') : 'h2';
}

function toDimension(value: string): { size: number; unit: string } | string {
  const match = value.trim().match(/^(-?\d+(?:\.\d+)?)(px|%|em|rem|vw|vh)?$/i);
  if (!match) return value;
  return { size: Number(match[1]), unit: match[2]?.toLowerCase() ?? 'px' };
}

function toBox(value: string): Record<string, unknown> | string {
  const parts = value.trim().split(/\s+/);
  if (!parts.every((part) => /^-?\d+(?:\.\d+)?(?:px|%|em|rem|vw|vh)?$/i.test(part))) return value;
  const dimensions = parts.map(toDimension);
  if (dimensions.some((dimension) => typeof dimension === 'string')) return value;
  const values = dimensions as Array<{ size: number; unit: string }>;
  const pick = (index: number): { size: number; unit: string } => values[index] ?? values[0]!;
  if (values.length === 1) return { top: pick(0).size, right: pick(0).size, bottom: pick(0).size, left: pick(0).size, unit: pick(0).unit };
  if (values.length === 2) return { top: pick(0).size, right: pick(1).size, bottom: pick(0).size, left: pick(1).size, unit: pick(0).unit };
  return { top: pick(0).size, right: pick(1).size, bottom: pick(2).size, left: pick(3).size, unit: pick(0).unit };
}

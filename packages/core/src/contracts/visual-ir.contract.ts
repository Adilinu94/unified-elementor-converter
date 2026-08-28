/**
 * Versioned, target-neutral visual intermediate representation.
 *
 * This contract is deliberately owned by core so source adapters and targets
 * can evolve independently. PageSpec remains the legacy compatibility shape;
 * new generic conversion flows should cross this boundary before emission.
 */

export type SourceExtractionMode =
  | 'unframer'
  | 'proofly'
  | 'live-dom'
  | 'local-export'
  | 'hybrid'
  | 'screenshot-only';

export type EvidenceMethod =
  | 'mcp'
  | 'xml'
  | 'html'
  | 'css'
  | 'dom'
  | 'computed-style'
  | 'screenshot'
  | 'vision';

export interface SourceInput {
  url?: string;
  projectId?: string;
  xmlPath?: string;
  htmlPath?: string;
  screenshotPaths?: string[];
  adapterHint?: string;
}

export interface CapabilityResult {
  supported: boolean;
  adapterId: string;
  confidence: number;
  reasons: string[];
  warnings: string[];
}

export interface Evidence {
  sourceIds: string[];
  methods: EvidenceMethod[];
  confidence: number;
  warnings: string[];
}

export interface SourceManifest {
  schemaVersion: '1.0';
  adapterId: string;
  source: SourceInput;
  discoveredAt: string;
  pages: Array<{ route: string; sourceId: string; kind: 'static' | 'dynamic-template' | '404' | 'redirect' }>;
  componentIds: string[];
  assetIds: string[];
  warnings: string[];
}

export interface PageRef {
  route: string;
  sourceId: string;
}

export interface RawPageEvidence {
  page: PageRef;
  evidence: Evidence;
  payload: unknown;
}

export interface RawComponentEvidence {
  componentId: string;
  evidence: Evidence;
  payload: unknown;
}

export interface SourceAdapter {
  readonly id: string;
  canHandle(input: SourceInput): Promise<CapabilityResult>;
  discover(input: SourceInput): Promise<SourceManifest>;
  extractPage(manifest: SourceManifest, page: PageRef): Promise<RawPageEvidence>;
  resolveComponent(manifest: SourceManifest, componentId: string): Promise<RawComponentEvidence>;
  close(): Promise<void>;
}

export interface ViewportProfile {
  label: string;
  width: number;
  height: number;
  deviceScaleFactor?: number;
}

export interface TextStyleIR {
  family?: string;
  weight?: number;
  size?: string;
  lineHeight?: string;
  letterSpacing?: string;
  color?: string;
}

export interface AssetIR {
  id: string;
  kind: 'image' | 'svg' | 'video' | 'font' | 'icon' | 'lottie' | 'canvas';
  sourceUrl?: string;
  localPath?: string;
  mimeType?: string;
  width?: number;
  height?: number;
  alt?: string;
  focalPoint?: { x: number; y: number };
  evidence: Evidence;
}

/**
 * How an animation behaves, independent of what triggers it.
 *
 * `kind` on `AnimationIR` says WHEN motion starts (scroll, hover, load). This
 * says WHAT it does, and the two are not the same axis: an entrance reveal and a
 * scroll-linked scrub are both `kind: 'scroll'` yet need entirely different
 * target settings — Elementor covers the first with an entrance animation and
 * the second with a scroll motion effect.
 *
 * `indeterminate` means a source measured a change it could not classify. It is
 * carried rather than dropped so a target reports a gap instead of guessing.
 */
export type AnimationMotionClass = 'entrance' | 'scroll-linked' | 'indeterminate';

/** One measured property change of an animation, with its observed amplitude. */
export interface AnimationEffectIR {
  kind: 'opacity' | 'translateX' | 'translateY' | 'scale' | 'rotate';
  /** Value at the start of the observed range. */
  from: number;
  /** Value at the end of the observed range. */
  to: number;
  /** Largest observed span. Never negative. */
  range: number;
  /** True when the observed series never reversed direction. */
  monotonic?: boolean;
}

export interface AnimationIR {
  id: string;
  kind: 'hover' | 'focus' | 'load' | 'scroll' | 'transition' | 'custom';
  targetSourceId: string;
  intent: string;
  durationMs?: number;
  /**
   * The behavioural class, when a source could determine it.
   *
   * Absent means unknown, which a target must report rather than default to
   * `entrance` — defaulting would put an entrance animation on a scroll scrub
   * and, because Elementor hides an entrance element with
   * `.elementor-invisible { visibility: hidden }` until its handler fires, an
   * incorrect entrance can make content vanish entirely.
   */
  motionClass?: AnimationMotionClass;
  /**
   * Measured amplitudes per property.
   *
   * Required for any target setting whose value IS an amplitude. Elementor Pro's
   * motion effects are exactly that: `motion_fx_translateY_speed` resolves to
   * `-(passedPercents - 50) * speed` px in the Pro frontend handler, so a speed
   * cannot be chosen without knowing how far the source actually travelled.
   * Without this field every speed would be an invented number, which is why
   * `intent` alone is not a sufficient contract for a mapper.
   */
  effects?: AnimationEffectIR[];
  evidence: Evidence;
}

export interface VisualNodeIR {
  sourceId: string;
  role: 'layout' | 'heading' | 'text' | 'image' | 'button' | 'icon' | 'component' | 'unknown';
  /**
   * The name the author gave this layer in the source tool, verbatim.
   *
   * Distinct from `role`, which is a normalised semantic classification and is
   * therefore lossy: a layer named `Rating` classifies as role `stats`, `Blogs`
   * as `blog`. Both are useful, and neither substitutes for the other — a
   * cross-source merge needs the verbatim name to verify it matched the same
   * element, because that is what the rendered DOM exposes
   * (`data-framer-name="Rating"`).
   *
   * A weak signal for classification (charter §6); a strong signal for identity.
   */
  sourceName?: string;
  text?: string;
  assetId?: string;
  href?: string;
  tag?: string;
  /**
   * Design-system text style this node uses, as a token key into
   * `VisualPageIR.tokens.textStyles` (e.g. `/Heading 3`).
   *
   * This relation is NOT recoverable from a rendered DOM: computed styles give
   * `font-size: 68px` but not the fact that the author picked a named style.
   * Preserving it is what lets a target emit a style reference instead of a
   * pile of inline overrides.
   */
  textStylePath?: string;
  /** Component definition this node is an instance of, when role is 'component'. */
  componentId?: string;
  bboxByViewport?: Record<string, { x: number; y: number; width: number; height: number }>;
  styles?: Record<string, string>;
  responsiveOverrides?: Record<string, Record<string, string>>;
  children: VisualNodeIR[];
  evidence: Evidence;
}

export interface VisualSectionIR {
  sourceId: string;
  role: string;
  /**
   * The name the author gave this section layer in the source tool, verbatim.
   * See `VisualNodeIR.sourceName` — `role` normalises and therefore loses the
   * string a rendered DOM can be matched against.
   */
  sourceName?: string;
  layoutArchetype: string;
  selector?: string;
  bboxByViewport: Record<string, { x: number; y: number; width: number; height: number }>;
  styles?: Record<string, string>;
  responsiveOverrides?: Record<string, Record<string, string>>;
  background?: { color?: string; assetId?: string };
  nodes: VisualNodeIR[];
  evidence: Evidence;
}

export interface VisualPageIR {
  schemaVersion: '1.0';
  source: {
    url?: string;
    route: string;
    extractionMode: SourceExtractionMode;
    capturedAt: string;
    pageId: string;
  };
  viewportProfiles: ViewportProfile[];
  tokens: {
    colors: Record<string, string>;
    fonts: Array<{ family: string; weight: number; style: string; sourceUrl?: string }>;
    textStyles: Record<string, TextStyleIR>;
    spacing: Record<string, number | string>;
  };
  sections: VisualSectionIR[];
  assets: AssetIR[];
  animations: AnimationIR[];
  warnings: string[];
}

export interface VisualIrValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

/** Validate the safety-critical shape before any target emitter runs. */
export function validateVisualPageIR(value: unknown): VisualIrValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  if (!isRecord(value)) return { valid: false, errors: ['IR must be an object'], warnings };
  if (value.schemaVersion !== '1.0') errors.push('schemaVersion must be 1.0');

  if (!isRecord(value.source)) {
    errors.push('source is required');
  } else {
    if (typeof value.source.route !== 'string' || !value.source.route) errors.push('source.route is required');
    if (typeof value.source.pageId !== 'string' || !value.source.pageId) errors.push('source.pageId is required');
    if (typeof value.source.capturedAt !== 'string' || !value.source.capturedAt) errors.push('source.capturedAt is required');
    if (!isExtractionMode(value.source.extractionMode)) errors.push('source.extractionMode is invalid');
  }

  if (!Array.isArray(value.viewportProfiles) || value.viewportProfiles.length === 0) {
    errors.push('at least one viewport profile is required');
  } else {
    value.viewportProfiles.forEach((profile, index) => {
      if (!isRecord(profile) || typeof profile.label !== 'string' || !profile.label
        || !isPositiveFiniteNumber(profile.width) || !isPositiveFiniteNumber(profile.height)) {
        errors.push(`viewportProfiles[${index}] is invalid`);
      }
    });
  }

  if (!Array.isArray(value.sections) || value.sections.length === 0) {
    errors.push('at least one section is required');
  } else {
    const activePath = new WeakSet<object>();
    const sourceIds = new Set<string>();
    value.sections.forEach((section, index) => validateSection(section, `sections[${index}]`, errors, warnings, activePath, sourceIds));
  }

  if (!Array.isArray(value.assets)) {
    errors.push('assets must be an array');
  } else {
    const assetIds = new Set<string>();
    value.assets.forEach((asset, index) => {
      if (isRecord(asset) && typeof asset.id === 'string' && asset.id) {
        if (assetIds.has(asset.id)) errors.push(`assets[${index}].id duplicates another asset`);
        else assetIds.add(asset.id);
      }
      validateAsset(asset, `assets[${index}]`, errors, warnings);
    });
  }
  if (!Array.isArray(value.animations)) errors.push('animations must be an array');
  else value.animations.forEach((animation, index) => validateAnimation(animation, `animations[${index}]`, errors, warnings));
  if (!Array.isArray(value.warnings)) errors.push('warnings must be an array');
  if (!isRecord(value.tokens)) {
    errors.push('tokens are required');
  } else {
    for (const field of ['colors', 'fonts', 'textStyles', 'spacing']) {
      if (value.tokens[field] === undefined) errors.push(`tokens.${field} is required`);
    }
  }
  return { valid: errors.length === 0, errors, warnings };
}

function validateSection(value: unknown, path: string, errors: string[], warnings: string[], seen: WeakSet<object>, sourceIds: Set<string>): void {
  if (!isRecord(value)) {
    errors.push(`${path} is invalid`);
    return;
  }
  if (seen.has(value)) {
    errors.push(`${path} contains a cyclic reference`);
    return;
  }
  seen.add(value);
  if (typeof value.sourceId !== 'string' || !value.sourceId) errors.push(`${path}.sourceId is required`);
  else if (sourceIds.has(value.sourceId)) errors.push(`${path}.sourceId duplicates another IR node`);
  else sourceIds.add(value.sourceId);
  if (typeof value.role !== 'string' || !value.role) errors.push(`${path}.role is required`);
  if (typeof value.layoutArchetype !== 'string' || !value.layoutArchetype) errors.push(`${path}.layoutArchetype is required`);
  validateBBoxes(value.bboxByViewport, `${path}.bboxByViewport`, errors);
  if (!Array.isArray(value.nodes)) errors.push(`${path}.nodes must be an array`);
  else value.nodes.forEach((node, index) => validateNode(node, `${path}.nodes[${index}]`, errors, warnings, seen, sourceIds));
  validateEvidence(value.evidence, `${path}.evidence`, errors, warnings);
  seen.delete(value);
}

function validateNode(value: unknown, path: string, errors: string[], warnings: string[], seen: WeakSet<object>, sourceIds: Set<string>): void {
  if (!isRecord(value)) {
    errors.push(`${path} is invalid`);
    return;
  }
  if (seen.has(value)) {
    errors.push(`${path} contains a cyclic reference`);
    return;
  }
  seen.add(value);
  if (typeof value.sourceId !== 'string' || !value.sourceId) errors.push(`${path}.sourceId is required`);
  else if (sourceIds.has(value.sourceId)) errors.push(`${path}.sourceId duplicates another IR node`);
  else sourceIds.add(value.sourceId);
  if (!isNodeRole(value.role)) errors.push(`${path}.role is invalid`);
  if (!Array.isArray(value.children)) errors.push(`${path}.children must be an array`);
  else value.children.forEach((child, index) => validateNode(child, `${path}.children[${index}]`, errors, warnings, seen, sourceIds));
  if (value.bboxByViewport !== undefined) validateBBoxes(value.bboxByViewport, `${path}.bboxByViewport`, errors);
  validateEvidence(value.evidence, `${path}.evidence`, errors, warnings);
  seen.delete(value);
}

function validateAsset(value: unknown, path: string, errors: string[], warnings: string[]): void {
  if (!isRecord(value)) {
    errors.push(`${path} is invalid`);
    return;
  }
  if (typeof value.id !== 'string' || !value.id) errors.push(`${path}.id is required`);
  if (!isAssetKind(value.kind)) errors.push(`${path}.kind is invalid`);
  for (const field of ['width', 'height']) {
    if (value[field] !== undefined && (!isFiniteNumber(value[field]) || (value[field] as number) < 0)) {
      errors.push(`${path}.${field} must be a non-negative finite number`);
    }
  }
  if (value.focalPoint !== undefined) {
    if (!isRecord(value.focalPoint) || !isFiniteNumber(value.focalPoint.x) || !isFiniteNumber(value.focalPoint.y)
      || value.focalPoint.x < 0 || value.focalPoint.x > 1 || value.focalPoint.y < 0 || value.focalPoint.y > 1) {
      errors.push(`${path}.focalPoint must contain x/y values between 0 and 1`);
    }
  }
  validateEvidence(value.evidence, `${path}.evidence`, errors, warnings);
}

function validateAnimation(value: unknown, path: string, errors: string[], warnings: string[]): void {
  if (!isRecord(value)) {
    errors.push(`${path} is invalid`);
    return;
  }
  if (typeof value.id !== 'string' || !value.id) errors.push(`${path}.id is required`);
  if (!isAnimationKind(value.kind)) errors.push(`${path}.kind is invalid`);
  if (typeof value.targetSourceId !== 'string' || !value.targetSourceId) errors.push(`${path}.targetSourceId is required`);
  if (typeof value.intent !== 'string' || !value.intent) errors.push(`${path}.intent is required`);
  if (value.durationMs !== undefined && (!isFiniteNumber(value.durationMs) || value.durationMs < 0)) {
    errors.push(`${path}.durationMs must be a non-negative finite number`);
  }
  if (value.motionClass !== undefined && !isAnimationMotionClass(value.motionClass)) {
    errors.push(`${path}.motionClass is invalid`);
  }
  if (value.effects !== undefined) {
    if (!Array.isArray(value.effects)) {
      errors.push(`${path}.effects must be an array`);
    } else {
      value.effects.forEach((effect, index) => {
        validateAnimationEffect(effect, `${path}.effects[${index}]`, errors);
      });
    }
  }
  validateEvidence(value.evidence, `${path}.evidence`, errors, warnings);
}

function validateAnimationEffect(value: unknown, path: string, errors: string[]): void {
  if (!isRecord(value)) {
    errors.push(`${path} is invalid`);
    return;
  }
  if (!isAnimationEffectKind(value.kind)) errors.push(`${path}.kind is invalid`);
  for (const key of ['from', 'to', 'range'] as const) {
    if (!isFiniteNumber(value[key])) errors.push(`${path}.${key} must be a finite number`);
  }
  // A negative span is not a measurement, it is a sign the producer subtracted in
  // the wrong order — and a mapper that derives a speed from it would emit a
  // motion effect in the opposite direction.
  if (isFiniteNumber(value.range) && value.range < 0) {
    errors.push(`${path}.range cannot be negative`);
  }
  if (value.monotonic !== undefined && typeof value.monotonic !== 'boolean') {
    errors.push(`${path}.monotonic must be a boolean`);
  }
}

function validateEvidence(value: unknown, path: string, errors: string[], warnings: string[]): void {
  if (!isRecord(value)) {
    errors.push(`${path} is required`);
    return;
  }
  if (!Array.isArray(value.sourceIds) || value.sourceIds.some((id) => typeof id !== 'string' || !id)) errors.push(`${path}.sourceIds is invalid`);
  if (!Array.isArray(value.methods) || value.methods.length === 0 || value.methods.some((method) => !isEvidenceMethod(method))) {
    errors.push(`${path}.methods is invalid`);
  }
  if (!isFiniteNumber(value.confidence) || value.confidence < 0 || value.confidence > 1) {
    errors.push(`${path}.confidence must be between 0 and 1`);
  } else if (value.confidence < 0.6) {
    warnings.push(`${path} has low evidence confidence (${value.confidence})`);
  }
  if (!Array.isArray(value.warnings)) errors.push(`${path}.warnings must be an array`);
}

function validateBBoxes(value: unknown, path: string, errors: string[]): void {
  if (!isRecord(value)) {
    errors.push(`${path} is required`);
    return;
  }
  for (const [viewport, bbox] of Object.entries(value)) {
    if (!isRecord(bbox) || !['x', 'y', 'width', 'height'].every((key) => isFiniteNumber(bbox[key]))) {
      errors.push(`${path}.${viewport} is invalid`);
    } else if ((bbox.width as number) < 0 || (bbox.height as number) < 0) {
      errors.push(`${path}.${viewport} cannot have negative dimensions`);
    }
  }
}

function isNodeRole(value: unknown): boolean {
  return ['layout', 'heading', 'text', 'image', 'button', 'icon', 'component', 'unknown'].includes(value as string);
}

function isPositiveFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isExtractionMode(value: unknown): value is SourceExtractionMode {
  return ['unframer', 'proofly', 'live-dom', 'local-export', 'hybrid', 'screenshot-only'].includes(value as string);
}

function isEvidenceMethod(value: unknown): value is EvidenceMethod {
  return ['mcp', 'xml', 'html', 'css', 'dom', 'computed-style', 'screenshot', 'vision'].includes(value as string);
}

function isAssetKind(value: unknown): boolean {
  return ['image', 'svg', 'video', 'font', 'icon', 'lottie', 'canvas'].includes(value as string);
}

function isAnimationKind(value: unknown): boolean {
  return ['hover', 'focus', 'load', 'scroll', 'transition', 'custom'].includes(value as string);
}

function isAnimationMotionClass(value: unknown): value is AnimationMotionClass {
  return ['entrance', 'scroll-linked', 'indeterminate'].includes(value as string);
}

function isAnimationEffectKind(value: unknown): boolean {
  return ['opacity', 'translateX', 'translateY', 'scale', 'rotate'].includes(value as string);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

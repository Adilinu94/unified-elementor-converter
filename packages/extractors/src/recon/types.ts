export interface ReconOptions {
  targetSelector?: string;
  maxEvents?: number;
  watchedAttributes?: string[];
  windowMs?: number;
}

export interface ReconEvent {
  type: 'mutation' | 'animation';
  selector: string;
  mutationType?: string;
  attributeName?: string;
  animationType?: string;
  animationName?: string;
  timestamp: number;
}

export interface ReconResult {
  isSpa: boolean;
  framework: string | null;
  mutationCount: number;
  animationCount: number;
  events: ReconEvent[];
  durationMs: number;
}

/* ─── State-Capture types (Phase 46) ─────────────────────────────────── */

/** What triggered a state snapshot */
export type CaptureTrigger =
  | 'attribute'
  | 'attribute-batch'
  | 'child-list'
  | 'animation-start'
  | 'animation-end'
  | 'transition-run'
  | 'transition-end'
  | 'time-based';

/** Baseline computed-style snapshot for a selector */
export interface StyleBaseline {
  selector: string;
  styles: Record<string, string>;
  collectedAt: number;
}

/** A structured state snapshot built from mutations + animation events */
export interface StateSnapshot {
  selector: string;
  trigger: CaptureTrigger;
  timestamp: number;
  /** Attribute values before the mutation */
  attributesBefore?: Record<string, string>;
  /** Attribute values after the mutation */
  attributesAfter?: Record<string, string>;
  /** Computed-style property diff (only changed props) */
  propertyDiff?: Record<string, { before: string; after: string }>;
  /** Number of added child nodes (child-list trigger) */
  addedNodeCount?: number;
  /** Number of removed child nodes (child-list trigger) */
  removedNodeCount?: number;
  /** CSS/Web animation name */
  animationName?: string;
  /** Duration in ms (computed from animationstart→animationend) */
  durationMs?: number;
}

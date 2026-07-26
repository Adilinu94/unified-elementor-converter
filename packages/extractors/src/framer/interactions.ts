/**
 * Framer Interaction Extraction (Phase 51, A2).
 * Extracts Framer Scroll/Trigger animations from HTML and maps
 * them to V4 Pro Interactions (native JSON, NO GSAP).
 * Ported from Framer-to-Elementor-V4-Pipeline/scripts/extract-framer-interactions.ts
 */

// ============================================================================
// Types
// ============================================================================

export interface InteractionEffect {
  type: 'transform';
  opacity?: { from: number; to: number };
  translateY?: { from: number; to: number; unit: string };
  translateX?: { from: number; to: number; unit: string };
  scale?: { from: number; to: number };
  rotate?: { from: number; to: number; unit: string };
  easing: string;
  duration: number;
  delay?: number;
}

export interface V4Interaction {
  type: string;
  trigger: string;
  effects: InteractionEffect[];
}

export interface InteractionMeta {
  originalProp: string;
  originalDuration: number;
  originalEasing: string;
}

export interface InteractionEntry {
  selector: string;
  v4_interaction: V4Interaction;
  meta?: InteractionMeta;
  appearId?: string;
  tag?: string;
  elementId?: string;
  source?: string;
}

export interface InteractionOutput {
  meta: {
    generatedAt: string;
    source: string;
    totalInteractions: number;
    post_id: number | null;
  };
  interactions: InteractionEntry[];
  mcpRouting: {
    ability: string;
    note: string;
  };
}

// ============================================================================
// CSS Animation Parsing
// ============================================================================

const EASING_MAP: Record<string, string> = {
  'ease': 'ease',
  'ease-in': 'ease-in',
  'ease-out': 'ease-out',
  'ease-in-out': 'ease-in-out',
  'linear': 'linear',
  'cubic-bezier(0.16, 1, 0.3, 1)': 'ease-out-expo',
  'cubic-bezier(0.34, 1.56, 0.64, 1)': 'ease-out-back',
};

/**
 * Parse CSS transition/animation properties into V4 interaction effects.
 */
export function parseCssAnimationToEffect(
  cssProps: Record<string, string>,
): InteractionEffect | null {
  const duration = parseFloat(cssProps['transition-duration'] || cssProps['animation-duration'] || '0.3') * 1000;
  const easing = EASING_MAP[cssProps['transition-timing-function'] || ''] || 'ease-out';
  const delay = parseFloat(cssProps['transition-delay'] || cssProps['animation-delay'] || '0') * 1000;

  const effect: InteractionEffect = {
    type: 'transform',
    easing,
    duration: duration || 300,
    delay: delay || undefined,
  };

  // Parse transform property
  const transform = cssProps['transform'] || '';
  if (transform.includes('translateY')) {
    const match = transform.match(/translateY\(([^)]+)\)/);
    if (match) {
      const value = parseFloat(match[1]);
      effect.translateY = { from: value, to: 0, unit: match[1].includes('%') ? '%' : 'px' };
    }
  }
  if (transform.includes('translateX')) {
    const match = transform.match(/translateX\(([^)]+)\)/);
    if (match) {
      const value = parseFloat(match[1]);
      effect.translateX = { from: value, to: 0, unit: match[1].includes('%') ? '%' : 'px' };
    }
  }
  if (transform.includes('scale')) {
    const match = transform.match(/scale\(([^)]+)\)/);
    if (match) {
      const value = parseFloat(match[1]);
      effect.scale = { from: value, to: 1 };
    }
  }

  // Parse opacity
  if (cssProps['opacity'] !== undefined) {
    const value = parseFloat(cssProps['opacity']);
    effect.opacity = { from: value, to: 1 };
  }

  return effect;
}

/**
 * Extract Framer appear animations from HTML (data-framer-appear-id).
 */
export function extractFramerAppearAnimations(html: string): InteractionEntry[] {
  const entries: InteractionEntry[] = [];
  const appearRe = /data-framer-appear-id=["']([^"']+)["']/g;
  let match: RegExpExecArray | null;

  while ((match = appearRe.exec(html)) !== null) {
    const appearId = match[1];
    // Find the containing element's selector
    const contextStart = Math.max(0, match.index - 500);
    const context = html.slice(contextStart, match.index + 200);

    // Try to find a class or id for the selector
    const classMatch = context.match(/class=["'][^"']*framer-([a-z0-9-]+)/i);
    const idMatch = context.match(/id=["']([^"']+)["']/);
    const selector = idMatch ? `#${idMatch[1]}` : classMatch ? `.framer-${classMatch[1]}` : `[data-framer-appear-id="${appearId}"]`;

    entries.push({
      selector,
      appearId,
      source: 'framer-appear',
      v4_interaction: {
        type: 'entrance',
        trigger: 'page-load',
        effects: [{
          type: 'transform',
          opacity: { from: 0, to: 1 },
          translateY: { from: 20, to: 0, unit: 'px' },
          easing: 'ease-out',
          duration: 600,
        }],
      },
    });
  }

  return entries;
}

/**
 * Extract CSS-based scroll animations from HTML style blocks.
 */
export function extractCssScrollAnimations(html: string): InteractionEntry[] {
  const entries: InteractionEntry[] = [];
  const styleRe = /<style[^>]*>([\s\S]*?)<\/style>/gi;
  let styleMatch: RegExpExecArray | null;

  while ((styleMatch = styleRe.exec(html)) !== null) {
    const css = styleMatch[1];
    // Find @keyframes with scroll-related names
    const keyframeRe = /@keyframes\s+([a-zA-Z0-9_-]*(?:scroll|reveal|fade|slide)[a-zA-Z0-9_-]*)\s*\{([^}]+(?:\{[^}]*\}[^}]*)*)\}/gi;
    let kfMatch: RegExpExecArray | null;

    while ((kfMatch = keyframeRe.exec(css)) !== null) {
      const animName = kfMatch[1];
      // Find selectors using this animation
      const selectorRe = new RegExp(`([^{}]+)\\{[^}]*animation-name:\\s*${animName}[^}]*\\}`, 'g');
      let selMatch: RegExpExecArray | null;

      while ((selMatch = selectorRe.exec(css)) !== null) {
        const selector = selMatch[1].trim();
        entries.push({
          selector,
          source: 'css-keyframe',
          v4_interaction: {
            type: 'scroll',
            trigger: 'in-view',
            effects: [{
              type: 'transform',
              opacity: { from: 0, to: 1 },
              easing: 'ease-out',
              duration: 500,
            }],
          },
        });
      }
    }
  }

  return entries;
}

/**
 * Build the full interaction output with MCP routing.
 */
export function buildInteractionOutput(
  interactions: InteractionEntry[],
  source: string,
  postId: number | null = null,
): InteractionOutput {
  return {
    meta: {
      generatedAt: new Date().toISOString(),
      source,
      totalInteractions: interactions.length,
      post_id: postId,
    },
    interactions,
    mcpRouting: {
      ability: 'novamira-adrianv2/set-interaction',
      note: 'V4 Pro Interactions — native JSON, no GSAP required.',
    },
  };
}

/**
 * Main extraction: combine all interaction sources from HTML.
 */
export function extractInteractionsFromHtml(html: string, source = 'html'): InteractionEntry[] {
  const appear = extractFramerAppearAnimations(html);
  const cssScroll = extractCssScrollAnimations(html);
  return [...appear, ...cssScroll];
}

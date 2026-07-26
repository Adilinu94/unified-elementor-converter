#!/usr/bin/env node
/**
 * extract-framer-interactions.ts  —  A2: Interaction Extraction (Sprint 2)
 *
 * Extrahiert Framer Scroll/Trigger-Animationen aus HTML und mapped
 * sie auf V4 Pro Interactions (native JSON, KEIN GSAP).
 *
 * Usage:
 *   node --import tsx scripts/extract-framer-interactions.ts \
 *     --html FramerExport/index.html \
 *     --output interactions-plan.json
 */

import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';

// ─────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────

type CssDeclarations = Record<string, string>;

interface InteractionEffect {
  type: 'transform';
  opacity?: { from: number; to: number };
  translateY?: { from: number; to: number; unit: string };
  translateX?: { from: number; to: number; unit: string };
  easing: string;
  duration: number;
  delay?: number;
  // Dynamic prop keys (opacity, translateY, translateX, scale, rotate)
  [key: string]: unknown;
}

interface V4Interaction {
  type: string;
  trigger: string;
  effects: InteractionEffect[];
}

interface InteractionMeta {
  originalProp: string;
  originalDuration: number;
  originalEasing: string;
}

interface InteractionEntry {
  selector: string;
  v4_interaction: V4Interaction;
  meta?: InteractionMeta;
  appearId?: string;
  tag?: string;
  elementId?: string;
  source?: string;
}

interface InteractionOutput {
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
    example: {
      ability_name: string;
      parameters: Record<string, string>;
    };
  };
}

interface V4TreeVariant {
  props?: Record<string, unknown>;
  meta?: {
    breakpoint?: string;
    [key: string]: unknown;
  };
}

interface V4TreeStyleDef {
  variants?: V4TreeVariant[];
  [key: string]: unknown;
}

interface V4TreeNode {
  id?: string;
  styles?: Record<string, V4TreeStyleDef>;
  elements?: V4TreeNode[];
  children?: V4TreeNode[];
}

// ─────────────────────────────────────────────
// ANIMATION EFFECT MAP TYPE
// ─────────────────────────────────────────────

interface EffectMapEntry {
  effect: string;
  v4Type: string;
}

// ─────────────────────────────────────────────
// CLI
// ─────────────────────────────────────────────

const { values: args } = parseArgs({
  options: {
    html:     { type: 'string' },
    'v4-tree':{ type: 'string' },
    output:   { type: 'string' },
    'post-id':{ type: 'string' },
    verbose:  { type: 'boolean', default: false },
    help:     { type: 'boolean', default: false },
  },
  strict: false,
});

const htmlPath: string | undefined = args.html as string | undefined;
const v4TreePath: string | undefined = args['v4-tree'] as string | undefined;
const outputPath: string | undefined = args.output as string | undefined;
const postIdRaw: string | undefined = args['post-id'] as string | undefined;

if (args.help || (!htmlPath && !v4TreePath)) {
  console.log(`

extract-framer-interactions.ts  —  A2: Interaction Extraction (Sprint 2)

ZWECK:
  Extrahiert Framer Scroll/Trigger-Animationen aus HTML und mapped
  sie auf V4 Pro Interactions (native JSON, KEIN GSAP). Erkennt:
    • CSS transition/transform Regeln → V4 entrance/scroll effects
    • data-framer-appear-id Attribute → Scroll-into-View Animationen
    • Easing-Werte werden auf Elementor-native Namen gemappt (C3 Fix)

EINGABE (mindestens eine):
  --html FILE           Framer HTML Export
  --v4-tree FILE        V4 Widget-Tree JSON (v4-tree mode, WIP)

OPTIONEN:
  --output FILE         Output-Pfad (interactions-plan.json)  [default: stdout]
  --post-id ID          WordPress Post-ID (fuer MCP-Routing)
  --verbose             Ausfuehrliche Logs
  --help                Diese Hilfe

BEISPIELE:
  # Aus Framer HTML-Export:
  node --import tsx scripts/extract-framer-interactions.ts \\\\
    --html FramerExport/index.html \\\\
    --output interactions-plan.json

  # Mit Post-ID fuer direktes MCP-Routing:
  node --import tsx scripts/extract-framer-interactions.ts \\\\
    --html FramerExport/index.html \\\\
    --post-id 123 \\\\
    --output interactions-plan.json

  # Stdout (kein --output):
  node --import tsx scripts/extract-framer-interactions.ts --html index.html

OUTPUT:
  interactions-plan.json  — Meta, interactions[], MCP-Routing

V4 INTERACTION FORMAT:
  { selector, v4_interaction: { type, trigger, effects[],
    easing (Elementor-native), duration (ms), delay (ms) } }

EASING-MAP (C3 Fix):
  power2.out → ease-out | power2.in → ease-in |
  ease → ease | ease-in-out → ease-in-out | linear → linear

MCP-ROUTING:
  ability: novamira-adrianv2/edit-interaction
  (Existiert bereits — kein neues PHP noetig)

EXIT-CODES:
  0 = Interactions extrahiert
  1 = Keine Interactions gefunden
  2 = Eingabedatei nicht gefunden / kein Input-Flag
`);
  if (args.help) process.exit(0);
  process.exit(2);
}

const log = (...m: string[]) => {
  if (args.verbose) process.stderr.write('[int-extract] ' + m.join(' ') + '\n');
};

// ─── TRIGGER + EASING MAPS ──────────────────────────────────────────────────

// C3 Fix: Elementor-native easing names (not GSAP)
const TRIGGER_MAP: Record<string, string> = {
  'scroll-into-view': 'scroll',
  'scroll':           'scroll',
  'hover':            'mouse',
  'click':            'click',
  'page-load':        'entrance',
  'entrance':         'entrance',
};

const EASING_MAP: Record<string, string> = {
  'ease':                'ease',
  'ease-in':             'ease-in',
  'ease-out':            'ease-out',
  'ease-in-out':         'ease-in-out',
  'linear':              'linear',
  'cubic-bezier(0.4, 0, 0.2, 1)': 'ease-out',
  'cubic-bezier(0, 0, 0.2, 1)':   'ease-out',
  'power2.out':          'ease-out',
  'power2.in':           'ease-in',
  'power2.inOut':        'ease-in-out',
  'power4.out':          'ease-out',
  'none':                'linear',
};

const ANIMATION_EFFECT_MAP: Record<string, EffectMapEntry> = {
  'opacity':         { effect: 'fade',      v4Type: 'entrance' },
  'translateY':      { effect: 'slide-up',  v4Type: 'scroll' },
  'translateX':      { effect: 'slide-left', v4Type: 'scroll' },
  'scale':           { effect: 'zoom',      v4Type: 'entrance' },
  'rotate':          { effect: 'rotate',    v4Type: 'entrance' },
};

// ─── EXTRACTION ──────────────────────────────────────────────────────────────

function extractStyleBlocks(html: string): string {
  const blocks: string[] = [];
  const styleRe = /<style[^>]*>([\s\S]*?)<\/style>/gi;
  let m: RegExpExecArray | null;
  while ((m = styleRe.exec(html)) !== null) blocks.push(m[1]);
  return blocks.join('\n');
}

function extractCssTransitions(css: string): InteractionEntry[] {
  const interactions: InteractionEntry[] = [];
  const ruleRe = /([^{}]+)\{([^{}]+)\}/g;
  let m: RegExpExecArray | null;
  while ((m = ruleRe.exec(css)) !== null) {
    const selector = m[1].trim();
    const body = m[2].trim();

    if (!/transition|animation/.test(body)) continue;

    const decls: CssDeclarations = {};
    const propRe = /([\w-]+)\s*:\s*([^;!]+)/g;
    let dm: RegExpExecArray | null;
    while ((dm = propRe.exec(body)) !== null) {
      decls[dm[1].trim()] = dm[2].trim();
    }

    const interaction = mapCssToInteraction(decls, selector);
    if (interaction) interactions.push(interaction);
  }
  return interactions;
}

function mapCssToInteraction(decls: CssDeclarations, selector: string): InteractionEntry | null {
  const transProp = decls['transition-property'] || (decls['transition']?.split(' ')[0]) || 'opacity';
  const duration = parseFloat(decls['transition-duration'] || decls['animation-duration'] || '0.3');
  const delay = parseFloat(decls['transition-delay'] || '0');
  const easing = (decls['transition-timing-function'] || decls['animation-timing-function'] || 'ease').trim();

  const prop = transProp.replace('transform.', '').trim();
  const effectInfo = ANIMATION_EFFECT_MAP[prop] || ANIMATION_EFFECT_MAP['opacity'];

  // Detect trigger from selector context
  const trigger = /appear|scroll/i.test(selector) ? 'scroll' : 'entrance';

  // Build effect with dynamic property key
  const effect: InteractionEffect = {
    type: 'transform',
    easing: EASING_MAP[easing] || 'ease-out',
    duration: Math.round(duration * 1000),
    delay: Math.round(delay * 1000),
  };
  (effect as Record<string, unknown>)[prop] = prop === 'opacity'
    ? { from: 0, to: 1 }
    : { from: 30, to: 0, unit: 'px' };
  if (prop !== 'opacity') {
    effect.opacity = { from: 0, to: 1 };
  }

  return {
    selector,
    v4_interaction: {
      type: trigger,
      trigger: trigger === 'scroll' ? 'scroll_into_view' : 'page_load',
      effects: [effect],
    },
    meta: {
      originalProp: transProp,
      originalDuration: duration,
      originalEasing: easing,
    },
  };
}

function extractFramerAppearInteractions(html: string): InteractionEntry[] {
  const interactions: InteractionEntry[] = [];
  const appearRe = /<[^>]*\sdata-framer-appear-id\s*=\s*['"]([^'"]+)['"][^>]*>/gi;
  let m: RegExpExecArray | null;
  while ((m = appearRe.exec(html)) !== null) {
    const appearId = m[1];
    const tagMatch = m[0].match(/^<(\w+)/);
    const elTag = tagMatch ? tagMatch[1] : 'div';
    const safeId = appearId.replace(/"/g, '\\"');
    const selector = `[data-framer-appear-id="${safeId}"]`;

    interactions.push({
      selector,
      appearId,
      tag: elTag,
      v4_interaction: {
        type: 'scroll',
        trigger: 'scroll_into_view',
        effects: [{
          type: 'transform',
          translateY: { from: 20, to: 0, unit: 'px' },
          opacity: { from: 0, to: 1 },
          easing: 'ease-out',
          duration: 600,
        }],
      },
    });
  }
  return interactions;
}

// ─── MAIN ───────────────────────────────────────────────────────────────────

const interactions: InteractionEntry[] = [];

if (htmlPath) {
  if (!fs.existsSync(htmlPath)) {
    process.stderr.write(`Error: HTML not found: ${htmlPath}\n`);
    process.exit(2);
  }
  const html = fs.readFileSync(htmlPath, 'utf8');
  const css = extractStyleBlocks(html);

  interactions.push(...extractCssTransitions(css));
  interactions.push(...extractFramerAppearInteractions(html));

  log(`CSS transitions: ${extractCssTransitions(css).length}`);
  log(`Framer appear: ${extractFramerAppearInteractions(html).length}`);
}

if (v4TreePath) {
  if (!fs.existsSync(v4TreePath)) {
    process.stderr.write(`Error: v4-tree not found: ${v4TreePath}\n`);
    process.exit(2);
  }
  const tree: V4TreeNode | V4TreeNode[] = JSON.parse(fs.readFileSync(v4TreePath, 'utf8'));
  const roots: V4TreeNode[] = Array.isArray(tree) ? tree : [tree];
  const extractedInteractions: InteractionEntry[] = [];
  const seen = new Set<string>();

  function walkV4Tree(node: V4TreeNode, depth: number): void {
    const elementId = node.id || `el-${depth}`;
    const styles = node.styles || {};

    for (const [styleId, styleDef] of Object.entries(styles)) {
      if (styleId.startsWith('gc-')) continue;
      const variants = styleDef.variants || [];
      for (const variant of variants) {
        const props = variant.props || {};
        const bp = (variant.meta && variant.meta.breakpoint) || '';
        if (bp && bp !== 'desktop') continue;

        const opacityVal = typeof (props.opacity as Record<string, unknown>)?.value === 'number'
          ? (props.opacity as Record<string, unknown>).value as number
          : typeof props.opacity === 'number' ? props.opacity as number : null;

        if (opacityVal !== null && opacityVal < 1) {
          const dedupKey = `${elementId}::entrance`;
          if (!seen.has(dedupKey)) {
            seen.add(dedupKey);
            extractedInteractions.push({
              selector: `#${elementId}`,
              elementId,
              v4_interaction: {
                type: 'entrance',
                trigger: 'page_load',
                effects: [{
                  type: 'transform',
                  opacity: { from: 0, to: 1 },
                  easing: 'ease-out',
                  duration: 600,
                }],
              },
              source: `v4-tree:${elementId}:opacity:${opacityVal}`,
            });
          }
        }

        const hasTransform = (props.transform as Record<string, unknown>)?.value;
        if (hasTransform) {
          const dedupKey = `${elementId}::scroll`;
          if (!seen.has(dedupKey)) {
            seen.add(dedupKey);
            extractedInteractions.push({
              selector: `#${elementId}`,
              elementId,
              v4_interaction: {
                type: 'scroll',
                trigger: 'scroll_into_view',
                effects: [{
                  type: 'transform',
                  translateY: { from: 30, to: 0, unit: 'px' },
                  opacity: { from: 0, to: 1 },
                  easing: 'ease-out',
                  duration: 600,
                }],
              },
              source: `v4-tree:${elementId}:transform`,
            });
          }
        }
      }
    }

    const children = node.elements || node.children || [];
    for (const child of children) walkV4Tree(child, depth + 1);
  }

  for (const root of roots) walkV4Tree(root, 0);
  interactions.push(...extractedInteractions);
  log(`V4 tree mode: ${extractedInteractions.length} interactions extracted`);
}

// ─── OUTPUT ─────────────────────────────────────────────────────────────────

const result: InteractionOutput = {
  meta: {
    generatedAt: new Date().toISOString(),
    source: htmlPath || v4TreePath || '',
    totalInteractions: interactions.length,
    post_id: postIdRaw ? parseInt(postIdRaw, 10) : null,
  },
  interactions,
  mcpRouting: {
    ability: 'novamira-adrianv2/edit-interaction',
    note: 'B3: Diese Ability existiert bereits. Route interactions[] via McpBridge.',
    example: {
      ability_name: 'novamira-adrianv2/edit-interaction',
      parameters: {
        post_id: '{{post_id}}',
        element_id: '{{element_id}}',
        interaction: '{{v4_interaction}}',
      },
    },
  },
};

if (outputPath) {
  fs.mkdirSync(path.dirname(path.resolve(outputPath)), { recursive: true });
  fs.writeFileSync(outputPath, JSON.stringify(result, null, 2), 'utf8');
  process.stderr.write(`[int-extract] ${interactions.length} interactions → ${outputPath}\n`);
} else {
  process.stdout.write(JSON.stringify(result, null, 2) + '\n');
}

process.exit(0);

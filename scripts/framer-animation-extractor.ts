#!/usr/bin/env node
/**
 * scripts/framer-animation-extractor.ts  —  Phase 1.5: Animation Extraction
 *
 * Analysiert einen Framer HTML-Export auf Animationen und generiert
 * eine animation-plan.json für inject-animation-code.js.
 *
 * Erkannte Animations-Typen:
 *   1. CSS @keyframes — als CSS-Snippet für site_wide_header
 *   2. CSS animation/transition Properties — extrahiert + als CSS-Snippet
 *   3. data-framer-appear-id — Framer Scroll-Animationen → GSAP-Plan
 *   4. Inline <script> mit GSAP/ScrollTrigger-Code
 *   5. transform/opacity mit transition → Motion-Hints
 *
 * Usage:
 *   # Aus Framer HTML-Export:
 *   node --import tsx scripts/framer-animation-extractor.ts \
 *     --html exports/framer-page/index.html \
 *     --output exports/framer-page/tokens/animation-plan.json
 *
 *   # Mit Post-ID für post-spezifische Snippets:
 *   node --import tsx scripts/framer-animation-extractor.ts \
 *     --html exports/framer-page/index.html \
 *     --post-id 123 \
 *     --output animation-plan.json
 *
 *   # Nur bestimmte Typen:
 *   node --import tsx scripts/framer-animation-extractor.ts \
 *     --html exports/framer-page/index.html \
 *     --types css,gsap \
 *     --output animation-plan.json
 *
 * Output: animation-plan.json (kompatibel mit inject-animation-code.js --plan)
 */

import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';

// ─── TYPES ────────────────────────────────────────────────────────────────────

interface KeyframeEntry {
  name: string;
  code: string;
}

interface AnimatedRule {
  selector: string;
  type: 'animation' | 'transition';
  declarations: Record<string, string>;
}

interface AppearAnimation {
  appearId: string;
  selector: string;
  tag: string;
  suggestedAnimation: {
    from: { opacity: number; y: number };
    to: { opacity: number; y: number };
    duration: number;
    ease: string;
  };
}

interface ScriptBlock {
  type: 'gsap' | 'js';
  code: string;
  gsap_plugins: string[];
  length: number;
  hasGSAP: boolean;
}

interface TransitionMapping {
  effect: string;
  entrance: boolean;
  duration_scale?: number;
}

interface V4InteractionNative {
  type: 'entrance';
  animation: string;
  duration: number;
  delay: number;
  easing: string;
}

interface TransitionInteraction {
  selector: string;
  effect: string;
  entrance: boolean;
  duration: number;
  delay: number;
  easing: string;
  v4_interaction: V4InteractionNative;
  exit: {
    animation: string;
    reverse: boolean;
  };
  mobile: {
    duration: number;
  };
}

interface Snippet {
  title: string;
  type: string;
  code?: string;
  location?: string;
  post_id?: number;
  gsap_version?: string;
  gsap_plugins?: string[];
  description: string;
  tags?: string[];
  on_conflict: string;
  priority: number;
  interactions?: TransitionInteraction[];
  mcpRouting?: {
    ability: string;
    note: string;
  };
}

interface ResultStats {
  total_snippets: number;
  css_snippets: number;
  gsap_snippets: number;
  js_snippets: number;
  interaction_snippets: number;
  keyframes: number;
  framer_appears: number;
  animated_rules: number;
  scripts: number;
}

interface ExtractionResult {
  meta: {
    source: string | boolean | undefined;
    extracted_at: string;
    post_id: number | null;
    stats: ResultStats;
  };
  snippets: Snippet[];
}

// ─── CLI ARGS ─────────────────────────────────────────────────────────────────

const { values: args } = parseArgs({
  options: {
    html:       { type: 'string' },
    'post-id':  { type: 'string' },
    output:     { type: 'string' },
    types:      { type: 'string', default: 'css,gsap,js,framer' },
    native:     { type: 'boolean', default: false },
    verbose:    { type: 'boolean', default: false },
  },
  strict: false,
});

if (process.argv.includes('--help') || process.argv.includes('-h')) {
  showHelp();
  process.exit(0);
}

const log = (...msg: string[]) => { if (args.verbose) process.stderr.write('[anim-extract] ' + msg.join(' ') + '\n'); };

if (!args.html) {
  process.stderr.write('Error: --html <framer-export/index.html> required\n');
  process.exit(2);
}

const htmlPath = args.html as string;
if (!fs.existsSync(htmlPath)) {
  process.stderr.write(`Error: HTML file not found: ${htmlPath}\n`);
  process.exit(2);
}

const enabledTypes = new Set((args.types as string).split(',').map(t => t.trim().toLowerCase()));
const postId = args['post-id'] ? parseInt(args['post-id'] as string, 10) : undefined;
const html = fs.readFileSync(htmlPath, 'utf8');

// ─── EXTRACTION FUNCTIONS ─────────────────────────────────────────────────────

/**
 * Extrahiert CSS aus <style>-Blöcken im HTML.
 */
function extractStyleBlocks(htmlContent: string): string {
  const blocks: string[] = [];
  const styleRe = /<style[^>]*>([\s\S]*?)<\/style>/gi;
  let m: RegExpExecArray | null;
  while ((m = styleRe.exec(htmlContent)) !== null) {
    blocks.push(m[1]);
  }
  return blocks.join('\n');
}

/**
 * Entfernt @keyframes, @media und @font-face Blöcke aus CSS.
 * Gibt bereinigtes CSS zurück, das nur noch Basis-Regeln enthält.
 */
function stripAtBlocks(css: string): string {
  let cleaned = css;
  const atRules = ['@keyframes', '@media', '@font-face', '@supports', '@document'];
  for (const rule of atRules) {
    const re = new RegExp(`${rule}\\s*[^{]*\\{`, 'g');
    let m: RegExpExecArray | null;
    const toRemove: Array<[number, number]> = [];
    while ((m = re.exec(cleaned)) !== null) {
      const startIdx = m.index;
      let depth = 1;
      let endIdx = startIdx + m[0].length;
      while (endIdx < cleaned.length && depth > 0) {
        if (cleaned[endIdx] === '{') depth++;
        else if (cleaned[endIdx] === '}') depth--;
        endIdx++;
      }
      toRemove.push([startIdx, endIdx]);
    }
    for (const [start, end] of [...toRemove].reverse()) {
      cleaned = cleaned.slice(0, start) + cleaned.slice(end);
    }
  }
  return cleaned;
}

/**
 * Extrahiert @keyframes-Blöcke aus CSS.
 * Gibt isolierte Keyframe-Definitionen zurück.
 */
function extractKeyframes(css: string): KeyframeEntry[] {
  const keyframes: KeyframeEntry[] = [];
  const kfRe = /@keyframes\s+([\w-]+)\s*\{/g;
  let m: RegExpExecArray | null;
  while ((m = kfRe.exec(css)) !== null) {
    const name = m[1];
    const startIdx = m.index + m[0].length;
    let depth = 1;
    let endIdx = startIdx;
    while (endIdx < css.length && depth > 0) {
      if (css[endIdx] === '{') depth++;
      else if (css[endIdx] === '}') depth--;
      endIdx++;
    }
    const body = css.slice(startIdx, endIdx - 1).trim();
    keyframes.push({
      name,
      code: `@keyframes ${name} {\n${body}\n}`,
    });
  }
  return keyframes;
}

/**
 * Extrahiert CSS-Regeln die animation-* oder transition-* Properties enthalten.
 * Operiert auf bereinigtem CSS (ohne @keyframes/@media/@font-face).
 */
function extractAnimatedRules(css: string): AnimatedRule[] {
  const cleanedCss = stripAtBlocks(css);
  const rules: AnimatedRule[] = [];
  const ruleRe = /([^{}]+)\{([^{}]+)\}/g;
  let m: RegExpExecArray | null;
  while ((m = ruleRe.exec(cleanedCss)) !== null) {
    const selector = m[1].trim();
    const body = m[2].trim();

    const hasAnimation = /animation\s*[^-]/.test(body);
    const hasTransition = /\btransition\s*[^-]/.test(body);

    if (hasAnimation || hasTransition) {
      const decls: Record<string, string> = {};
      const propRe = /([\w-]+)\s*:\s*([^;!]+)/g;
      let pm: RegExpExecArray | null;
      while ((pm = propRe.exec(body)) !== null) {
        decls[pm[1].trim()] = pm[2].trim();
      }
      rules.push({
        selector,
        type: hasAnimation ? 'animation' : 'transition',
        declarations: decls,
      });
    }
  }
  return rules;
}

/**
 * Sucht nach data-framer-appear-id Attributen (Framer Scroll-Animationen).
 */
function extractFramerAppearAnimations(htmlContent: string): AppearAnimation[] {
  const appears: AppearAnimation[] = [];
  const appearRe = /<[^>]*\sdata-framer-appear-id\s*=\s*['"]([^'"]+)['"][^>]*>/gi;
  let m: RegExpExecArray | null;
  while ((m = appearRe.exec(htmlContent)) !== null) {
    const appearId = m[1];
    const tagMatch = m[0];
    const tagRe = /^<(\w+)/;
    const tagM = tagMatch.match(tagRe);
    const elTag = tagM ? tagM[1] : 'div';

    const safeId = appearId.replace(/"/g, '\\"');
    const selector = `[data-framer-appear-id="${safeId}"]`;

    if (!appears.some(a => a.appearId === appearId)) {
      appears.push({
        appearId,
        selector,
        tag: elTag,
        suggestedAnimation: {
          from: { opacity: 0, y: 20 },
          to: { opacity: 1, y: 0 },
          duration: 0.6,
          ease: 'power2.out',
        },
      });
    }
  }

  return appears;
}

/**
 * Extrahiert <script>-Tags mit potentiellem GSAP/Animations-Code.
 * Ignoriert framework-spezifische Scripts (React, Vue, etc.).
 */
function extractScriptBlocks(htmlContent: string): ScriptBlock[] {
  const scripts: ScriptBlock[] = [];
  const scriptRe = /<script[^>]*>([\s\S]*?)<\/script>/gi;
  let m: RegExpExecArray | null;
  while ((m = scriptRe.exec(htmlContent)) !== null) {
    const code = m[1].trim();
    if (!code) continue;

    const isGSAP = /\bgsap\.|ScrollTrigger|gsap\.to|gsap\.from|gsap\.timeline/i.test(code);
    const isAnimation = /\banimat|\.animate\(|requestAnimationFrame|intersectionObserver/i.test(code);
    const isTransform = /\btransform\b|\.style\.\w+/i.test(code) && code.length > 50;

    if (isGSAP || isAnimation || isTransform) {
      const type = isGSAP ? 'gsap' as const : 'js' as const;
      const gsapPlugins: string[] = [];
      if (isGSAP) {
        if (/ScrollTrigger/i.test(code)) gsapPlugins.push('ScrollTrigger');
        if (/SplitText/i.test(code)) gsapPlugins.push('SplitText');
        if (/ScrollToPlugin/i.test(code)) gsapPlugins.push('ScrollToPlugin');
        if (/Flip\b/i.test(code)) gsapPlugins.push('Flip');
        if (/Observer/i.test(code)) gsapPlugins.push('Observer');
        if (/Draggable/i.test(code)) gsapPlugins.push('Draggable');
        if (/MotionPathPlugin/i.test(code)) gsapPlugins.push('MotionPathPlugin');
      }

      scripts.push({
        type,
        code,
        gsap_plugins: gsapPlugins,
        length: code.length,
        hasGSAP: isGSAP,
      });
    }
  }
  return scripts;
}

// ───────────────────────────────────────────────────────────────────────────────
// RC-20: CSS TRANSITION → V4 INTERACTION MAPPER
// ───────────────────────────────────────────────────────────────────────────────

const TRANSITION_TO_V4_MAP: Record<string, TransitionMapping> = {
  opacity: { effect: 'fade', entrance: true, duration_scale: 1.0 },
  'transform.translateY': { effect: 'slide-up', entrance: true },
  'transform.translateX': { effect: 'slide-left', entrance: true, duration_scale: 0.8 },
  'transform.scale': { effect: 'zoom', entrance: true, duration_scale: 1.2 },
  'opacity+transform.translateY': { effect: 'fade-slide-up', entrance: true, duration_scale: 1.0 },
};

function mapTransitionToV4Interaction(declarations: Record<string, string>, selector: string): TransitionInteraction {
  const props = Object.keys(declarations);
  const hasOpacity = props.includes('opacity');
  const hasTransform = props.includes('transform');
  const duration = declarations['transition-duration']
    || declarations['animation-duration']
    || declarations['transition']?.match(/([\d.]+)s/)?.[1]
    || '0.3';
  const delay = declarations['transition-delay'] || '0';
  const easing = declarations['transition-timing-function']
    || declarations['animation-timing-function']
    || 'ease';

  const parts: string[] = [];
  if (hasOpacity) parts.push('opacity');
  if (hasTransform) parts.push('transform.translateY');
  const key = parts.join('+') || 'opacity';

  const mapping = TRANSITION_TO_V4_MAP[key] || TRANSITION_TO_V4_MAP['opacity'];

  return {
    selector,
    effect: mapping.effect,
    entrance: mapping.entrance,
    duration: parseFloat(duration),
    delay: parseFloat(delay),
    easing,
    v4_interaction: {
      type: 'entrance',
      animation: mapping.effect,
      duration: Math.round(parseFloat(duration) * 1000),
      delay: Math.round(parseFloat(delay) * 1000),
      easing: mapEasingToElementor(easing),
    },
    exit: {
      animation: mapping.effect.replace('up', 'down').replace('left', 'right'),
      reverse: true,
    },
    mobile: {
      duration: Math.round(parseFloat(duration) * 700),
    },
  };
}

function mapEasingToElementor(cssEasing: string): string {
  const map: Record<string, string> = {
    'ease': 'ease',
    'ease-in': 'ease-in',
    'ease-out': 'ease-out',
    'ease-in-out': 'ease-in-out',
    'linear': 'linear',
    'cubic-bezier(0.4, 0, 0.2, 1)': 'ease-out',
    'cubic-bezier(0, 0, 0.2, 1)': 'ease-out',
    'power2.out': 'ease-out',
    'power2.in': 'ease-in',
    'power2.inOut': 'ease-in-out',
    'power4.out': 'ease-out',
    'none': 'linear',
  };
  return map[cssEasing] || 'ease';
}

function buildTransitionInteractions(animatedRules: AnimatedRule[], isNative: boolean = false): Snippet[] {
  if (animatedRules.length === 0) return [];

  const interactions: TransitionInteraction[] = [];
  for (const rule of animatedRules) {
    if (rule.type === 'transition') {
      const interaction = mapTransitionToV4Interaction(rule.declarations, rule.selector);
      interactions.push(interaction);
    }
  }

  if (interactions.length === 0) return [];

  if (isNative) {
    return [{
      title: `V4 Native Interactions (${interactions.length} elements)`,
      type: 'v4-native',
      interactions: interactions.map(ix => (({
        selector: ix.selector,
        v4_interaction: {
          type: ix.v4_interaction.type,
          animation: ix.v4_interaction.animation,
          trigger: ix.v4_interaction.type === 'entrance' ? 'page_load' as const : 'scroll_into_view' as const,
          effects: [{
            type: 'transform' as const,
            [ix.effect.includes('slide') ? 'translateY' :
             ix.effect.includes('zoom') ? 'scale' : 'opacity']:
              ix.effect.includes('zoom')
                ? { from: 0.95, to: 1 }
                : ix.effect.includes('slide')
                  ? { from: 30, to: 0, unit: 'px' }
                  : { from: 0, to: 1 },
            opacity: ix.effect !== 'fade' ? { from: 0, to: 1 } : undefined,
            easing: ix.v4_interaction.easing,
            duration: ix.v4_interaction.duration,
            delay: ix.v4_interaction.delay,
          }],
        } as unknown as V4InteractionNative & { trigger?: string; effects?: Array<Record<string, unknown>> },
        meta: {
          effect: ix.effect,
          originalDuration: ix.duration,
          originalEasing: ix.easing,
        },
      })) as unknown as TransitionInteraction),
      mcpRouting: {
        ability: 'novamira-adrianv2/edit-interaction',
        note: 'C3 Complete: Route each v4_interaction via McpBridge.editInteraction(). Kein neues PHP noetig.',
      },
      description: `${interactions.length} CSS transitions → V4 Native Interactions (C3 Complete)`,
      tags: ['v4', 'interactions', 'native', 'c3'],
      on_conflict: 'replace',
      priority: 25,
    }];
  }

  const gsapCode = generateGSAPInteractionCode(interactions);

  return [{
    title: `V4 Interactions (${interactions.length} elements)`,
    type: 'gsap',
    code: gsapCode,
    location: 'site_wide_footer',
    gsap_version: '3.12.5',
    gsap_plugins: ['ScrollTrigger'],
    description: `${interactions.length} CSS transitions → V4 GSAP interactions (RC-20)`,
    interactions,
    tags: ['v4', 'interactions', 'gsap', 'scrolltrigger', 'rc-20'],
    on_conflict: 'replace',
    priority: 25,
  }];
}

function generateGSAPInteractionCode(interactions: TransitionInteraction[]): string {
  const lines: string[] = [
    '// RC-20: Framer CSS Transitions → Elementor V4 GSAP Interactions',
    `// Generated from ${interactions.length} CSS transition rules`,
    '// GSAP + ScrollTrigger required',
    '// ⚠️  Selectors are from Framer CSS — MUST be mapped to V4 Elementor DOM classes before use.',
    '//     Framer: .framer-abc123 → V4: .elementor-element-<id> oder GC-Klasse',
    '',
    'document.addEventListener("DOMContentLoaded", () => {',
    '  gsap.registerPlugin(ScrollTrigger);',
    '',
  ];

  for (const ix of interactions) {
    const sel = ix.selector.replace(/"/g, '\\"');
    lines.push(`  // ${ix.effect} — ${ix.selector}`);
    lines.push(`  gsap.from("${sel}", {`);
    lines.push(`    opacity: 0,`);
    if (ix.effect.includes('slide')) lines.push(`    y: 30,`);
    if (ix.effect.includes('zoom')) lines.push(`    scale: 0.95,`);
    lines.push(`    duration: ${ix.duration},`);
    lines.push(`    delay: ${ix.delay},`);
    lines.push(`    ease: "${ix.v4_interaction.easing}",`);
    lines.push(`    scrollTrigger: {`);
    lines.push(`      trigger: "${sel}",`);
    lines.push(`      start: "top 90%",`);
    lines.push(`      toggleActions: "play none none reverse",`);
    lines.push(`    },`);
    lines.push(`  });`);
    lines.push('');
  }

  lines.push('});');
  return lines.join('\n');
}

// ─── SNIPPET BUILDERS ─────────────────────────────────────────────────────────

function buildLocation(isPostSpecific: boolean): string | undefined {
  return isPostSpecific ? undefined : 'site_wide_header';
}

function buildKeyframeSnippets(keyframes: KeyframeEntry[], isPostSpecific: boolean): Snippet[] {
  if (keyframes.length === 0) return [];

  const code = keyframes.map(kf => kf.code).join('\n\n');
  const names = keyframes.map(kf => kf.name).join(', ');

  return [{
    title: `CSS Keyframes: ${names}`,
    type: 'css',
    code,
    location: buildLocation(isPostSpecific),
    post_id: isPostSpecific ? postId : undefined,
    description: `${keyframes.length} @keyframes definiert (${names})`,
    tags: ['framer', 'keyframes', 'css', 'animation'],
    on_conflict: 'replace',
    priority: 10,
  }];
}

function buildAnimationRulesSnippet(animatedRules: AnimatedRule[], isPostSpecific: boolean): Snippet[] {
  if (animatedRules.length === 0) return [];

  const rules = animatedRules.map(r =>
    `${r.selector} {\n${Object.entries(r.declarations).map(([k, v]) => `  ${k}: ${v};`).join('\n')}\n}`
  ).join('\n\n');

  return [{
    title: 'Framer CSS Animations & Transitions',
    type: 'css',
    code: rules,
    location: buildLocation(isPostSpecific),
    post_id: isPostSpecific ? postId : undefined,
    description: `${animatedRules.length} animated CSS rules extrahiert`,
    tags: ['framer', 'animation', 'transition', 'css'],
    on_conflict: 'replace',
    priority: 20,
  }];
}

function buildFramerAppearSnippet(appears: AppearAnimation[], isPostSpecific: boolean): Snippet[] {
  if (appears.length === 0) return [];

  const gsapConfigs = appears.map((a) => {
    const { from, to, duration, ease } = a.suggestedAnimation;
    return (
      `  // ${a.selector}  (appear-id: ${a.appearId})\n` +
      `  gsap.fromTo('${a.selector}',\n` +
      `    { opacity: ${from.opacity}, y: ${from.y} },\n` +
      `    {\n` +
      `      opacity: ${to.opacity}, y: ${to.y},\n` +
      `      duration: ${duration},\n` +
      `      ease: '${ease}',\n` +
      `      scrollTrigger: {\n` +
      `        trigger: '${a.selector}',\n` +
      `        start: 'top 85%',\n` +
      `        toggleActions: 'play none none reverse',\n` +
      `      },\n` +
      `    }\n` +
      `  );`
    );
  }).join('\n\n');

  const code = (
    `// Framer Scroll-Animationen (${appears.length} Elemente)\n` +
    `// Generiert aus data-framer-appear-id Attributen\n` +
    `// GSAP + ScrollTrigger erforderlich\n\n` +
    `document.addEventListener('DOMContentLoaded', () => {\n` +
    `  gsap.registerPlugin(ScrollTrigger);\n\n` +
    `${gsapConfigs}\n` +
    `});\n`
  );

  return [{
    title: `Framer Scroll Appear (${appears.length} Elemente)`,
    type: 'gsap',
    code,
    location: 'site_wide_footer',
    post_id: isPostSpecific ? postId : undefined,
    gsap_version: '3.12.5',
    gsap_plugins: ['ScrollTrigger'],
    description: `${appears.length} Elemente mit data-framer-appear-id → GSAP ScrollTrigger`,
    tags: ['framer', 'scroll', 'appear', 'gsap', 'scrolltrigger'],
    on_conflict: 'replace',
    priority: 30,
  }];
}

function buildScriptSnippets(scripts: ScriptBlock[], isPostSpecific: boolean): Snippet[] {
  return scripts.map((s, i) => ({
    title: `Framer Script #${i + 1} (${s.type.toUpperCase()})`,
    type: s.type,
    code: s.code,
    location: 'site_wide_footer',
    post_id: isPostSpecific ? postId : undefined,
    gsap_version: s.hasGSAP ? '3.12.5' : undefined,
    gsap_plugins: s.gsap_plugins.length > 0 ? s.gsap_plugins : undefined,
    description: `${s.length} chars ${s.type} code${s.hasGSAP ? ' mit GSAP' : ''}`,
    tags: ['framer', s.type, ...(s.hasGSAP ? ['gsap'] : [])],
    on_conflict: 'replace',
    priority: 40 + i,
  }));
}

// ─── MAIN ─────────────────────────────────────────────────────────────────────

log('Reading HTML:', htmlPath);

const cssContent = extractStyleBlocks(html);
log(`  CSS from style blocks: ${cssContent.length} chars`);

const isPostSpecific = !!postId;
const snippets: Snippet[] = [];

const keyframes     = enabledTypes.has('css')             ? extractKeyframes(cssContent) : [];
const animatedRules = enabledTypes.has('css')             ? extractAnimatedRules(cssContent) : [];
const appears       = enabledTypes.has('framer')          ? extractFramerAppearAnimations(html) : [];
const scripts       = (enabledTypes.has('gsap') || enabledTypes.has('js'))
                      ? extractScriptBlocks(html) : [];

log(`  @keyframes found: ${keyframes.length}`);
log(`  Animated CSS rules found: ${animatedRules.length}`);
log(`  data-framer-appear-id elements: ${appears.length}`);
log(`  Animation scripts found: ${scripts.length}`);

if (keyframes.length > 0) {
  snippets.push(...buildKeyframeSnippets(keyframes, isPostSpecific));
}
if (animatedRules.length > 0) {
  snippets.push(...buildAnimationRulesSnippet(animatedRules, isPostSpecific));
  const transitionInteractions = buildTransitionInteractions(animatedRules, args.native as boolean);
  if (transitionInteractions.length > 0) {
    snippets.push(...transitionInteractions);
    log(`  RC-20: ${transitionInteractions[0]?.interactions?.length || 0} transition→V4 interactions mapped`);
  }
}
if (appears.length > 0) {
  snippets.push(...buildFramerAppearSnippet(appears, isPostSpecific));
}
if (scripts.length > 0) {
  snippets.push(...buildScriptSnippets(scripts, isPostSpecific));
}

// ─── OUTPUT ───────────────────────────────────────────────────────────────────

const result: ExtractionResult = {
  meta: {
    source: args.html,
    extracted_at: new Date().toISOString(),
    post_id: postId || null,
    stats: {
      total_snippets: snippets.length,
      css_snippets: snippets.filter(s => s.type === 'css').length,
      gsap_snippets: snippets.filter(s => s.type === 'gsap').length,
      js_snippets: snippets.filter(s => s.type === 'js').length,
      interaction_snippets: snippets.filter(s => s.tags?.includes('rc-20')).length,
      keyframes: keyframes.length,
      framer_appears: appears.length,
      animated_rules: animatedRules.length,
      scripts: scripts.length,
    },
  },
  snippets,
};

const output = JSON.stringify(result, null, 2);

const outputPath = args.output as string | undefined;
if (outputPath) {
  fs.mkdirSync(path.dirname(path.resolve(outputPath)), { recursive: true });
  fs.writeFileSync(outputPath, output, 'utf8');
  process.stderr.write(`[anim-extract] Saved to ${outputPath}\n`);
} else {
  process.stdout.write(output + '\n');
}

// ─── SUMMARY ──────────────────────────────────────────────────────────────────

const stats = result.meta.stats;
console.log('\n╔══════════════════════════════════════════════════════╗');
console.log('║  framer-animation-extractor.ts                       ║');
console.log('╚══════════════════════════════════════════════════════╝');
console.log(`\n  📄 Source:  ${path.basename(htmlPath)}`);
console.log(`  🎬 Snippets: ${snippets.length} total`);
console.log(`     CSS:    ${stats.css_snippets}  (${stats.keyframes} @keyframes, ${stats.animated_rules} rules)`);
console.log(`     GSAP:   ${stats.gsap_snippets}  (${stats.framer_appears} appear-IDs)`);
console.log(`     JS:     ${stats.js_snippets}  (${stats.scripts} scripts)`);

if (snippets.length === 0) {
  console.log('\n  ⚠️  Keine Animationen gefunden.');
  console.log('  → Erstelle animation-plan.json manuell oder nutze andere Flags.');
} else {
  console.log('\n  ─── Nächster Schritt ───────────────────────────────');
  console.log(`  node scripts/inject-animation-code.js --plan ${outputPath || 'animation-plan.json'}`);
  if (postId) {
    console.log(`  → Injektion auf Post #${postId}`);
  }
  console.log('  → MCP-Plan wird als animation-mcp-plan.json gespeichert');
}

console.log('');

process.exit(snippets.length === 0 ? 1 : 0);

// ─── HELP ─────────────────────────────────────────────────────────────────────

function showHelp(): void {
  console.log(`
framer-animation-extractor.ts — Framer HTML → animation-plan.json

Extrahiert Animationen aus Framer HTML-Exports:
  • CSS @keyframes Definitionen
  • CSS animation/transition Regeln
  • data-framer-appear-id → GSAP ScrollTrigger Plan
  • Inline <script> Blöcke mit GSAP/Animations-Code

Usage:
  node --import tsx scripts/framer-animation-extractor.ts \\
    --html exports/framer-page/index.html \\
    --output exports/framer-page/tokens/animation-plan.json

  # Mit Post-ID (post-spezifische Snippets):
  node --import tsx scripts/framer-animation-extractor.ts \\
    --html exports/framer-page/index.html \\
    --post-id 123 \\
    --output animation-plan.json

  # Nur bestimmte Typen:
  node --import tsx scripts/framer-animation-extractor.ts \\
    --html exports/framer-page/index.html \\
    --types css,gsap \\
    --output animation-plan.json

  # Stdout (kein --output):
  node --import tsx scripts/framer-animation-extractor.ts \\
    --html exports/framer-page/index.html

Typen: css | gsap | js | framer

Output: animation-plan.json — direkt nutzbar mit:
  node scripts/inject-animation-code.js --plan animation-plan.json
`);
}

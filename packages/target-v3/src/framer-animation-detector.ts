/**
 * Framer Animation Detector (#6)
 *
 * Scans the Framer page XML + code files for motion components (SmoothScroll,
 * Reveal, code components with motion like BeforeAfter/TextReveal) and emits
 * a WPCode animation snippet (GSAP) ready for the footer. Eliminates manual
 * identification of which sections need GSAP and hand-writing the init JS.
 *
 * Detection signals:
 *  - Code components whose name/source mentions motion, reveal, scroll, slider,
 *    parallax, before/after → emit the matching GSAP init from the library.
 *  - Framer <ComponentInstance> with componentId matching a known motion code file.
 *  - CSS class hints in the V3 tree (oc-reveal, oc-fade-in) → wire ScrollTrigger.
 *
 * @example
 * import { detectAnimations, buildAnimationSnippet } from './framer-animation-detector.js';
 * const inv = detectAnimations({ pageXml, codeFiles });
 * const wpcode = buildAnimationSnippet(inv, { pageId: 4956, sectionClasses: ['oc-hero'] });
 */

import * as cheerio from 'cheerio';

export interface AnimationSignal {
  /** Type of animation detected. */
  type: 'text-reveal' | 'fade-in' | 'before-after' | 'parallax' | 'scroll-pin' | 'marquee' | 'counter';
  /** Section class the animation applies to (from Framer name → css_classes). */
  sectionClass: string;
  /** Source: 'code-file' | 'page-xml' | 'v3-tree'. */
  source: 'code-file' | 'page-xml' | 'v3-tree';
  /** Evidence (code file name, component id, css class). */
  evidence: string;
}

export interface AnimationInventory {
  signals: AnimationSignal[];
  /** Unique animation types detected. */
  types: string[];
  /** Whether GSAP is needed at all. */
  needsGsap: boolean;
}

export interface DetectOptions {
  /** Framer page XML string (from framer_getNodeXml). */
  pageXml?: string;
  /** Code files map: id → { name, content } (from framer_readCodeFile). */
  codeFiles?: Record<string, { name: string; content: string }>;
  /** V3 tree css classes to scan for animation hints. */
  v3TreeClasses?: string[];
}

const MOTION_PATTERNS: Array<{ type: AnimationSignal['type']; pattern: RegExp }> = [
  { type: 'text-reveal', pattern: /reveal|splittext|text.?reveal|word.?reveal/i },
  { type: 'before-after', pattern: /before.?after|slider|comparison/i },
  { type: 'parallax', pattern: /parallax|scroll.?offset/i },
  { type: 'scroll-pin', pattern: /pin|sticky|scroll.?lock/i },
  { type: 'marquee', pattern: /marquee|ticker|infinite.?scroll/i },
  { type: 'counter', pattern: /counter|count.?up|number.?animate/i },
  { type: 'fade-in', pattern: /fade.?in|appear|on.?enter/i },
];

/**
 * Detect all animation signals from Framer page XML + code files + V3 tree.
 */
export function detectAnimations(opts: DetectOptions): AnimationInventory {
  const signals: AnimationSignal[] = [];

  // 1. Scan code files for motion components
  if (opts.codeFiles) {
    for (const [id, file] of Object.entries(opts.codeFiles)) {
      const name = file.name.toLowerCase();
      const content = file.content;
      for (const { type, pattern } of MOTION_PATTERNS) {
        if (pattern.test(name) || pattern.test(content.slice(0, 2000))) {
          signals.push({
            type,
            sectionClass: inferClassFromCodeFile(file.name),
            source: 'code-file',
            evidence: `code-file:${file.name} (${id})`,
          });
        }
      }
    }
  }

  // 2. Scan page XML for ComponentInstance referencing motion code files
  if (opts.pageXml) {
    const $ = cheerio.load(opts.pageXml, { xmlMode: true } as cheerio.CheerioOptions);
    $('ComponentInstance').each((_, el) => {
      const attrs = $(el).attr() ?? {};
      const name = (attrs.name ?? '').toLowerCase();
      for (const { type, pattern } of MOTION_PATTERNS) {
        if (pattern.test(name)) {
          signals.push({
            type,
            sectionClass: slug(attrs.name ?? 'section'),
            source: 'page-xml',
            evidence: `component-instance:${attrs.componentId ?? name}`,
          });
        }
      }
    });
  }

  // 3. Scan V3 tree css classes for animation hints
  if (opts.v3TreeClasses) {
    for (const cls of opts.v3TreeClasses) {
      const lower = cls.toLowerCase();
      for (const { type, pattern } of MOTION_PATTERNS) {
        if (pattern.test(lower)) {
          signals.push({
            type,
            sectionClass: cls,
            source: 'v3-tree',
            evidence: `css-class:${cls}`,
          });
        }
      }
    }
  }

  // Dedupe by (type, sectionClass)
  const seen = new Set<string>();
  const unique = signals.filter((s) => {
    const k = `${s.type}:${s.sectionClass}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });

  const types = [...new Set(unique.map((s) => s.type))];
  return { signals: unique, types, needsGsap: unique.length > 0 };
}

export interface SnippetOptions {
  pageId: number;
  /** All section classes that should get a base fade-in. */
  sectionClasses?: string[];
  /** Include GSAP CDN script tag. Default true. */
  includeCdn?: boolean;
  /** Respect prefers-reduced-motion. Default true. */
  respectReducedMotion?: boolean;
}

/**
 * Build a WPCode footer snippet (html + site_wide_footer) that initializes
 * GSAP for all detected animations. Vanilla JS (no React) — runs on WP.
 */
export function buildAnimationSnippet(inv: AnimationInventory, opts: SnippetOptions): string {
  const lines: string[] = [];
  if (opts.includeCdn !== false) {
    lines.push('<script src="https://cdnjs.cloudflare.com/ajax/libs/gsap/3.12.5/gsap.min.js"></script>');
    lines.push('<script src="https://cdnjs.cloudflare.com/ajax/libs/gsap/3.12.5/ScrollTrigger.min.js"></script>');
  }
  lines.push('<script>');
  lines.push('(function(){');
  lines.push('  if(!window.gsap){console.warn("GSAP not loaded");return;}');
  lines.push('  gsap.registerPlugin(ScrollTrigger);');
  if (opts.respectReducedMotion !== false) {
    lines.push('  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;');
    lines.push('  if(reduced){return;}');
  }
  lines.push(`  const pageGuard = !document.body.classList.contains('page-id-${opts.pageId}');`);
  lines.push('  if(pageGuard){return;}');

  const sectionClasses = opts.sectionClasses ?? inv.signals.map((s) => s.sectionClass);

  // Base fade-in for all sections
  if (sectionClasses.length) {
    lines.push('  // Base section fade-in');
    for (const cls of sectionClasses) {
      lines.push(`  gsap.from(".${cls}", {opacity:0, y:30, duration:0.8, ease:"power2.out", scrollTrigger:{trigger:".${cls}", start:"top 85%"}});`);
    }
  }

  // Type-specific animations
  for (const sig of inv.signals) {
    switch (sig.type) {
      case 'text-reveal':
        lines.push(`  // Text reveal for .${sig.sectionClass}`);
        lines.push(`  document.querySelectorAll(".${sig.sectionClass} .elementor-heading-title, .${sig.sectionClass} .elementor-text-editor").forEach(function(el){`);
        lines.push(`    var text=el.textContent; el.innerHTML=text.split(/\\s+/).map(function(w){return '<span class="oc-word" style="display:inline-block">'+w+'</span>'}).join(' ');`);
        lines.push(`    gsap.from("."+el.classList[0] ? ".${sig.sectionClass} .oc-word" : ".oc-word", {opacity:0.3, y:"20%", stagger:0.04, duration:0.6, ease:"power2.out", scrollTrigger:{trigger:el, start:"top 80%"}});`);
        lines.push('  });');
        break;
      case 'before-after':
        lines.push(`  // Before/After slider for .${sig.sectionClass}`);
        lines.push(`  var ba=document.querySelector(".${sig.sectionClass} .oc-ba-slider");`);
        lines.push(`  if(ba){var handle=ba.querySelector(".oc-ba-handle");ba.addEventListener("input",function(e){handle.style.left=e.target.value+"%";ba.querySelector(".oc-ba-after").style.clipPath="inset(0 0 0 "+e.target.value+"%)";});}`);
        break;
      case 'counter':
        lines.push(`  // Counter for .${sig.sectionClass}`);
        lines.push(`  document.querySelectorAll(".${sig.sectionClass} .elementor-counter-number").forEach(function(el){`);
        lines.push(`    var target=parseInt(el.textContent,10)||0;gsap.fromTo(el,{textContent:0},{textContent:target,duration:2,ease:"power1.out",snap:{textContent:1},scrollTrigger:{trigger:el,start:"top 85%"}});`);
        lines.push('  });');
        break;
      case 'marquee':
        lines.push(`  // Marquee for .${sig.sectionClass}`);
        lines.push(`  var track=document.querySelector(".${sig.sectionClass} .oc-track");`);
        lines.push(`  if(track){gsap.to(track,{x:"-=50%",repeat:-1,duration:20,ease:"none"});}`);
        break;
      case 'parallax':
        lines.push(`  // Parallax for .${sig.sectionClass}`);
        lines.push(`  gsap.to(".${sig.sectionClass} img", {yPercent:20, ease:"none", scrollTrigger:{trigger:".${sig.sectionClass}", start:"top bottom", end:"bottom top", scrub:true}});`);
        break;
      case 'scroll-pin':
        lines.push(`  // Scroll pin for .${sig.sectionClass}`);
        lines.push(`  ScrollTrigger.create({trigger:".${sig.sectionClass}", start:"top top", end:"+=100%", pin:true, pinSpacing:false});`);
        break;
    }
  }

  lines.push('})();');
  lines.push('</script>');
  return lines.join('\n');
}

function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

function inferClassFromCodeFile(name: string): string {
  const base = name.replace(/\.(tsx?|jsx?)$/, '');
  return 'fc-' + slug(base);
}

/** Format an AnimationInventory as a human-readable report. */
export function formatAnimationInventory(inv: AnimationInventory): string {
  const lines = [
    `Animation Inventory: ${inv.signals.length} signals, ${inv.types.length} types, needsGsap=${inv.needsGsap}`,
    '',
  ];
  for (const s of inv.signals) {
    lines.push(`  [${s.type}] .${s.sectionClass}  (${s.source}: ${s.evidence})`);
  }
  return lines.join('\n');
}

#!/usr/bin/env node
/**
 * scripts/inject-animation-code.ts
 *
 * Liest eine Animation-Plan-Datei (animation-plan.json) oder einzelne CLI-Argumente
 * und gibt einen MCP-Plan aus, den der Claude-Agent als novamira/adrians-code-injector
 * Calls ausführt.
 *
 * Anwendungsfälle:
 *   1. Framer GSAP-Animationen nachbauen (aus framer-export analysiert)
 *   2. Custom CSS für Elementor V4 Global Classes ergänzen
 *   3. JavaScript-Events / Observer-Patterns hinzufügen
 *
 * Usage:
 *   # Plan aus Datei ausgeben:
 *   node --import tsx scripts/inject-animation-code.ts --plan animation-plan.json
 *
 *   # Einzelnen Snippet direkt planen:
 *   node --import tsx scripts/inject-animation-code.ts \
 *     --title "Hero Fade In" \
 *     --type gsap \
 *     --code-file exports/papaya/hero-animation.js \
 *     --post-id 123 \
 *     --gsap-plugins ScrollTrigger,SplitText
 *
 *   # Inline-Code:
 *   node --import tsx scripts/inject-animation-code.ts \
 *     --title "Custom Hero CSS" \
 *     --type css \
 *     --code ".e-heading { opacity: 0; transition: opacity .5s; }" \
 *     --location site_wide_header
 *
 *   # Ergebnisse zurückschreiben:
 *   node --import tsx scripts/inject-animation-code.ts --apply-results injection-results.json
 *
 * Output-Datei: animation-mcp-plan.json
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { resolve } from 'path';
import { parseArgs } from 'node:util';

// ─── Typen ─────────────────────────────────────────────────────────────────────

interface SnippetSpec {
  title: string;
  type: string;
  code: string;
  location?: string;
  post_id?: number;
  priority?: number;
  description?: string;
  tags?: string[];
  on_conflict?: string;
  gsap_version?: string;
  gsap_plugins?: string[];
}

interface PlanInput {
  snippets?: SnippetSpec[];
}

interface BuildParameters {
  title: string;
  type: string;
  code: string;
  on_conflict: string;
  location?: string;
  post_id?: number;
  priority?: number;
  description?: string;
  tags?: string[];
  gsap_version?: string;
  gsap_plugins?: string[];
}

interface McpStep {
  step: number;
  ability: string;
  parameters: { snippets: BuildParameters[] } | BuildParameters;
}

interface McpPlan {
  description: string;
  generated_at: string;
  mode: 'batch' | 'single';
  total: number;
  steps: McpStep[];
}

interface InjectionResult {
  title?: string;
  snippet_id?: number;
  action?: string;
  type?: string;
  active?: boolean;
}

interface SummaryEntry {
  title: string;
  snippet_id: number;
  action: string;
  type: string;
  active: boolean;
}

// ─── CLI-Args parsen ──────────────────────────────────────────────────────────

const { values: args } = parseArgs({
  args: process.argv.slice(2),
  options: {
    'apply-results':    { type: 'string' },
    plan:               { type: 'string' },
    title:              { type: 'string' },
    type:               { type: 'string' },
    code:               { type: 'string' },
    'code-file':        { type: 'string' },
    location:           { type: 'string' },
    'post-id':          { type: 'string' },
    'on-conflict':      { type: 'string' },
    'gsap-version':     { type: 'string' },
    'gsap-plugins':     { type: 'string' },
    description:        { type: 'string' },
    tags:               { type: 'string' },
    'from-framer-export': { type: 'string' },
    output:             { type: 'string' },
    'single-mode':      { type: 'boolean' },
  },
  strict: false,
});

const hasFlag = (flag: string): boolean =>
  process.argv.slice(2).includes(flag);

// ─── Apply-Results Modus ──────────────────────────────────────────────────────

if (hasFlag('--apply-results')) {
  const resultsFile = args['apply-results'] as string | undefined;
  if (!resultsFile || !existsSync(resultsFile)) {
    console.error(`ERROR: Datei nicht gefunden: ${resultsFile}`);
    process.exit(1);
  }

  const results: InjectionResult[] | { results?: InjectionResult[] } =
    JSON.parse(readFileSync(resultsFile, 'utf8'));
  const snippets: InjectionResult[] = Array.isArray(results)
    ? results
    : results.results || [];

  const summary: SummaryEntry[] = snippets.map(r => ({
    title:      r.title      || '?',
    snippet_id: r.snippet_id || 0,
    action:     r.action     || '?',
    type:       r.type       || '?',
    active:     r.active     || false,
  }));

  const outputFile = 'injection-summary.json';
  writeFileSync(outputFile, JSON.stringify(
    { snippets: summary, generated_at: new Date().toISOString() }, null, 2));

  console.log(`\n✅ Injection-Summary gespeichert: ${outputFile}`);
  console.log(`   ${summary.filter(s => s.action === 'created').length} erstellt`);
  console.log(`   ${summary.filter(s => s.action === 'updated').length} aktualisiert`);
  console.log(`   ${summary.filter(s => s.action === 'skipped').length} übersprungen`);
  process.exit(0);
}

// ─── Plan-Datei Modus ─────────────────────────────────────────────────────────

let snippetSpecs: SnippetSpec[] = [];

if (hasFlag('--plan')) {
  const planFile = args.plan as string | undefined;
  if (!planFile || !existsSync(planFile)) {
    console.error(`ERROR: Plan-Datei nicht gefunden: ${planFile}`);
    process.exit(1);
  }
  const plan: SnippetSpec[] | PlanInput = JSON.parse(readFileSync(planFile, 'utf8'));
  snippetSpecs = Array.isArray(plan) ? plan : plan.snippets || [];
}

// ─── Einzelner CLI-Snippet ────────────────────────────────────────────────────

else if (args.title) {
  const codeFile = args['code-file'] as string | undefined;
  let code: string = (args.code as string) || '';

  if (codeFile) {
    if (!existsSync(codeFile)) {
      console.error(`ERROR: Code-Datei nicht gefunden: ${codeFile}`);
      process.exit(1);
    }
    code = readFileSync(codeFile, 'utf8');
  }

  const pluginsRaw  = (args['gsap-plugins'] as string) || 'ScrollTrigger';
  const gsapPlugins = pluginsRaw.split(',').map(p => p.trim()).filter(Boolean);

  snippetSpecs.push({
    title:        args.title as string,
    type:         (args.type as string) || 'js',
    code,
    location:     (args.location as string) || undefined,
    post_id:      args['post-id'] ? parseInt(args['post-id'] as string, 10) : undefined,
    on_conflict:  (args['on-conflict'] as string) || 'replace',
    gsap_version: (args['gsap-version'] as string) || '3.12.5',
    gsap_plugins: gsapPlugins,
    description:  (args.description as string) || '',
    tags:         ((args.tags as string) || '').split(',').map(t => t.trim()).filter(Boolean),
  });
}

// ─── Framer-Export analysieren (Auto-Discover) ────────────────────────────────

else if (hasFlag('--from-framer-export')) {
  const exportDir = (args['from-framer-export'] as string) || 'exports';
  snippetSpecs    = discoverFramerAnimations(exportDir);
}

else {
  showHelp();
  process.exit(0);
}

// ─── MCP-Plan generieren ──────────────────────────────────────────────────────

if (snippetSpecs.length === 0) {
  console.log('Keine Snippets im Plan. Nichts zu tun.');
  process.exit(0);
}

const isSingleMode: boolean = hasFlag('--single-mode'); // Debug-Flag: zwingt Individual-Calls

const mcpPlan: McpPlan = isSingleMode
  ? buildIndividualPlan(snippetSpecs)
  : buildBatchPlan(snippetSpecs);

const outputFile = (args.output as string) || 'animation-mcp-plan.json';

// ─── Plan-Builder ─────────────────────────────────────────────────────────────

/**
 * Generiert einen einzelnen Batch-Call (1 MCP-Call für alle Snippets).
 * Bevorzugter Modus — reduziert N MCP-Roundtrips auf 1.
 */
function buildBatchPlan(specs: SnippetSpec[]): McpPlan {
  return {
    description: 'Novamira adrians-batch-inject-snippets MCP-Plan (Batch)',
    generated_at: new Date().toISOString(),
    mode: 'batch',
    total: specs.length,
    steps: [{
      step: 1,
      ability: 'novamira-adrianv2/adrians-batch-inject-snippets',
      parameters: {
        snippets: specs.map(spec => buildParameters(spec)),
      },
    }],
  };
}

/**
 * Generiert individuelle Calls (ein Schritt pro Snippet).
 * Nur für Debugging via --single-mode Flag.
 */
function buildIndividualPlan(specs: SnippetSpec[]): McpPlan {
  return {
    description: 'Novamira adrians-code-injector MCP-Plan (Single — Debug)',
    generated_at: new Date().toISOString(),
    mode: 'single',
    total: specs.length,
    steps: specs.map((spec, i) => ({
      step: i + 1,
      ability: 'novamira-adrianv2/adrians-code-injector',
      parameters: buildParameters(spec),
    })),
  };
}

// ─── Output ───────────────────────────────────────────────────────────────────
writeFileSync(outputFile, JSON.stringify(mcpPlan, null, 2));

console.log(`\n╔══════════════════════════════════════════════════════╗`);
console.log(`║  inject-animation-code.ts — MCP-Plan generiert      ║`);
console.log(`╚══════════════════════════════════════════════════════╝`);
console.log(`\nOutput:  ${outputFile}`);
console.log(`Snippets: ${snippetSpecs.length}\n`);

snippetSpecs.forEach((s, i) => {
  const type     = (s.type || '').toUpperCase().padEnd(6);
  const location = s.location || '(auto)';
  const postHint = s.post_id ? ` → Post #${s.post_id}` : ' → sitewide';
  console.log(`  ${String(i + 1).padStart(2)}. [${type}] "${s.title}"  |  ${location}${postHint}`);
});

console.log(`\n─── Agent-Anweisung ───────────────────────────────────`);
if (isSingleMode) {
  console.log(`[--single-mode] Führe ${snippetSpecs.length} individuelle Calls aus:`);
  console.log(`  Ability: novamira-adrianv2/adrians-code-injector`);
} else {
  console.log(`Führe 1 Batch-Call für alle ${snippetSpecs.length} Snippets aus:`);
  console.log(`  Ability: novamira-adrianv2/adrians-batch-inject-snippets`);
}
console.log(`  Tool:    novamira-yoursite-local:mcp-adapter-execute-ability`);
console.log(`\nErgebnisse als injection-results.json speichern, dann:`);
console.log(`  node --import tsx scripts/inject-animation-code.ts --apply-results injection-results.json\n`);

// ─── Hilfsfunktionen ──────────────────────────────────────────────────────────

function buildParameters(spec: SnippetSpec): BuildParameters {
  const p: BuildParameters = {
    title:       spec.title,
    type:        spec.type,
    code:        spec.code,
    on_conflict: spec.on_conflict || 'replace',
  };

  if (spec.location)    p.location    = spec.location;
  if (spec.post_id)     p.post_id     = spec.post_id;
  if (spec.priority)    p.priority    = spec.priority;
  if (spec.description) p.description = spec.description;
  if (spec.tags?.length) p.tags       = spec.tags;

  // GSAP-spezifisch
  if (spec.type === 'gsap') {
    p.gsap_version = spec.gsap_version || '3.12.5';
    p.gsap_plugins = spec.gsap_plugins || ['ScrollTrigger'];
  }

  return p;
}

/**
 * Analysiert einen Framer-Export-Ordner auf Animations-Hinweise:
 *   - data-framer-appear-id → Framer Auto-Animate
 *   - CSS transition / animation Klassen
 *   - @keyframes Definitionen
 *   - JS-Dateien im Export
 *
 * Gibt ein Array von Snippet-Specs zurück (werden noch manuell befüllt).
 */
function discoverFramerAnimations(exportDir: string): SnippetSpec[] {
  if (!existsSync(exportDir)) {
    console.warn(`WARN: Export-Dir nicht gefunden: ${exportDir}`);
    return [];
  }

  const specs: SnippetSpec[] = [];

  // CSS-Transitions aus styles.css lesen
  const cssFile = resolve(exportDir, 'styles.css');
  if (existsSync(cssFile)) {
    const css         = readFileSync(cssFile, 'utf8');
    const transitions = (css.match(/transition:[^;]+;/g) || []);
    const keyframes   = (css.match(/@keyframes\s+\w+/g) || []);
    const animations  = (css.match(/animation:[^;]+;/g) || []);

    if (transitions.length || keyframes.length || animations.length) {
      specs.push({
        title:       'Framer Animation CSS (aus Export)',
        type:        'css',
        code:        css,
        location:    'site_wide_header',
        description: `Auto-entdeckt: ${transitions.length} transitions, ${keyframes.length} keyframes`,
        tags:        ['framer', 'animations', 'css'],
        on_conflict: 'replace',
      });
    }
  }

  // JS-Dateien im Export (können GSAP-Code enthalten)
  const jsFiles = ['animation.js', 'framer-animation.js', 'gsap-animations.js'];
  for (const jsFile of jsFiles) {
    const jsPath = resolve(exportDir, jsFile);
    if (existsSync(jsPath)) {
      const code = readFileSync(jsPath, 'utf8');
      const isGsap = code.includes('gsap.') || code.includes('ScrollTrigger');

      specs.push({
        title:        `Framer ${jsFile}`,
        type:         isGsap ? 'gsap' : 'js',
        code,
        location:     'site_wide_footer',
        gsap_version: '3.12.5',
        gsap_plugins: ['ScrollTrigger'],
        description:  `Auto-entdeckt aus ${jsFile}`,
        tags:         ['framer', 'animations', isGsap ? 'gsap' : 'js'],
        on_conflict:  'replace',
      });
    }
  }

  if (specs.length === 0) {
    console.log(`INFO: Keine Animations-Dateien in ${exportDir} gefunden.`);
    console.log(`      Erstelle animation-plan.json manuell oder nutze --title/--type/--code.`);
  }

  return specs;
}

function showHelp(): void {
  console.log(`
inject-animation-code.ts — Framer → WPCode MCP-Plan Generator

Usage:
  # Plan aus Datei:
  node --import tsx scripts/inject-animation-code.ts --plan animation-plan.json

  # Einzelner Snippet:
  node --import tsx scripts/inject-animation-code.ts \\
    --title "Hero GSAP" --type gsap \\
    --code-file exports/papaya/hero.js \\
    --post-id 123 \\
    --gsap-plugins ScrollTrigger,SplitText

  # Inline-Code:
  node --import tsx scripts/inject-animation-code.ts \\
    --title "Custom CSS" --type css \\
    --code ".hero { opacity: 0; }" \\
    --location site_wide_header

  # Framer-Export auto-analysieren:
  node --import tsx scripts/inject-animation-code.ts --from-framer-export exports/papaya/

  # Ergebnisse einlesen:
  node --import tsx scripts/inject-animation-code.ts --apply-results injection-results.json

Typen: css | js | html | php | gsap
Locations: site_wide_header | site_wide_footer | frontend | everywhere | after_post
  `);
}

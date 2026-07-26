/**
 * Run Report Generator (#9)
 *
 * Generates a `run-report.md` at the end of a build: sections built, WPCode
 * snippet IDs, geometry-probe pass rate, emitted CSS rules + reasons, image
 * upload results, animation inventory, structure-diff results, known deltas,
 * and a V/E/T/R/M scorecard. Replaces manual SESSION-HANDOFF.md maintenance.
 *
 * @example
 * import { generateRunReport } from './run-report-generator.js';
 * const md = generateRunReport({ projectName, postId, ... });
 * await fs.writeFile('research/oral-care/run-report.md', md);
 */

import type { V3Tree } from './v3-tree-types.js';
import type { RenderRiskReport } from './v3-setting-validator.js';
import type { GeometryProbeReport } from '../qa/geometry-probe.js';
import type { UploadReport } from './framer-image-uploader.js';
import type { AnimationInventory } from './framer-animation-detector.js';
import type { SectionDiff } from '../qa/structure-diff.js';
import type { CssManifestEntry } from './setting-first-css-generator.js';
import type { LinkWirerResult } from './framer-link-wirer.js';

export interface RunReportInput {
  projectName: string;
  framerUrl: string;
  elementorUrl: string;
  postId: number;
  /** Built V3 tree (for section count). */
  tree: V3Tree;
  /** WPCode snippet IDs by title. */
  wpcodeSnippets: Record<string, number>;
  /** Render risk report (pre-deploy). */
  renderReport?: RenderRiskReport;
  /** Setting-first CSS manifest. */
  cssManifest?: CssManifestEntry[];
  /** Geometry probe reports (post-deploy). */
  probeReports?: GeometryProbeReport[];
  /** Image upload report. */
  uploadReport?: UploadReport;
  /** Animation inventory. */
  animationInventory?: AnimationInventory;
  /** Structure diff results. */
  structureDiff?: SectionDiff[];
  /** Link wiring result. */
  linkResult?: LinkWirerResult;
  /** Build timestamp. Default now. */
  timestamp?: string;
}

export interface Scorecard {
  visual: number;
  editorial: number;
  technical: number;
  responsive: number;
  motion: number;
  overall: number;
}

export function generateRunReport(input: RunReportInput): string {
  const ts = input.timestamp ?? new Date().toISOString();
  const lines: string[] = [];

  lines.push(`# Run Report — ${input.projectName}`);
  lines.push('');
  lines.push(`- **Generated:** ${ts}`);
  lines.push(`- **Framer source:** ${input.framerUrl}`);
  lines.push(`- **Elementor target:** ${input.elementorUrl}`);
  lines.push(`- **Post ID:** ${input.postId}`);
  lines.push('');

  // Sections built
  const sectionCount = input.tree.length;
  const widgetCount = countWidgets(input.tree);
  lines.push(`## Build Summary`);
  lines.push('');
  lines.push(`- Top-level sections: **${sectionCount}**`);
  lines.push(`- Total widgets: **${widgetCount}**`);
  lines.push('');

  // WPCode snippets
  lines.push(`## WPCode Snippets`);
  lines.push('');
  lines.push('| Title | Snippet ID |');
  lines.push('|---|---|');
  for (const [title, id] of Object.entries(input.wpcodeSnippets)) {
    lines.push(`| ${title} | ${id} |`);
  }
  lines.push('');

  // Render risks (pre-deploy)
  if (input.renderReport) {
    const r = input.renderReport;
    lines.push(`## Render Risk Report (pre-deploy)`);
    lines.push('');
    lines.push(`- Total elements: ${r.total_elements}`);
    lines.push(`- Risks: ${r.total_risks} (${r.by_severity.error} errors, ${r.by_severity.warning} warnings, ${r.by_severity.info} info)`);
    lines.push('');
    if (r.risks.length) {
      lines.push('| Severity | Element | Setting | Reason | Fix |');
      lines.push('|---|---|---|---|---|');
      for (const risk of r.risks.slice(0, 20)) {
        lines.push(`| ${risk.severity} | ${risk.element_id} | ${risk.setting} | ${escapeMd(risk.reason)} | ${escapeMd(risk.fix)} |`);
      }
      if (r.risks.length > 20) lines.push(`| ... | *${r.risks.length - 20} more* | | | |`);
      lines.push('');
    }
  }

  // Setting-first CSS manifest
  if (input.cssManifest && input.cssManifest.length) {
    lines.push(`## Setting-First CSS (${input.cssManifest.length} rules)`);
    lines.push('');
    lines.push('Emitted only for V3 settings that do not render under V4. Each rule is documented.');
    lines.push('');
    lines.push('| Element | Setting | Reason | CSS |');
    lines.push('|---|---|---|---|');
    for (const m of input.cssManifest) {
      lines.push(`| ${m.element_id} | ${m.setting} | ${escapeMd(m.reason)} | \`${escapeMd(m.css.slice(0, 80))}\` |`);
    }
    lines.push('');
  }

  // Image uploads
  if (input.uploadReport) {
    const u = input.uploadReport;
    lines.push(`## Image Upload`);
    lines.push('');
    lines.push(`- Uploaded: ${u.uploaded}/${u.total} | Failed: ${u.failed} | Skipped: ${u.skipped}`);
    if (u.results.length) {
      lines.push('');
      lines.push('| Status | Attachment | URL |');
      lines.push('|---|---|---|');
      for (const r of u.results) {
        const status = r.attachmentId != null ? 'OK' : 'FAIL';
        lines.push(`| ${status} | ${r.attachmentId ?? r.error ?? '-'} | ${r.url.slice(0, 60)} |`);
      }
    }
    lines.push('');
  }

  // Animations
  if (input.animationInventory) {
    const a = input.animationInventory;
    lines.push(`## Animation Inventory`);
    lines.push('');
    lines.push(`- Needs GSAP: ${a.needsGsap}`);
    lines.push(`- Types: ${a.types.join(', ') || 'none'}`);
    if (a.signals.length) {
      lines.push('');
      lines.push('| Type | Section | Source |');
      lines.push('|---|---|---|');
      for (const s of a.signals) {
        lines.push(`| ${s.type} | .${s.sectionClass} | ${s.source} |`);
      }
    }
    lines.push('');
  }

  // Links
  if (input.linkResult) {
    lines.push(`## Link Wiring`);
    lines.push('');
    lines.push(`- Wired: ${input.linkResult.wired}`);
    lines.push(`- Unresolved: ${input.linkResult.unresolved.length}`);
    lines.push('');
  }

  // Geometry probes (post-deploy)
  if (input.probeReports && input.probeReports.length) {
    lines.push(`## Geometry Probe (post-deploy)`);
    lines.push('');
    for (const r of input.probeReports) {
      lines.push(`### ${r.viewport.toUpperCase()} — ${r.pass_pct}% pass`);
      lines.push(`- Passed: ${r.passed} | Failed: ${r.failed} | Not found: ${r.not_found}`);
      lines.push('');
      if (r.results.some((x) => !x.matches)) {
        lines.push('| Status | Label | Selector | Diff |');
        lines.push('|---|---|---|---|');
        for (const x of r.results) {
          if (x.matches) continue;
          const diff = x.diff.map((d) => `${d.property}: ${d.actual} (exp ${d.expected})`).join('; ');
          lines.push(`| ${x.found ? 'FAIL' : 'MISS'} | ${x.label} | ${x.selector} | ${escapeMd(diff)} |`);
        }
        lines.push('');
      }
    }
  }

  // Structure diff
  if (input.structureDiff && input.structureDiff.length) {
    const passed = input.structureDiff.filter((d) => d.match).length;
    lines.push(`## Structure Diff (Framer vs Elementor)`);
    lines.push('');
    lines.push(`${passed}/${input.structureDiff.length} sections match structurally.`);
    lines.push('');
    lines.push('| Section | Match | Deltas |');
    lines.push('|---|---|---|');
    for (const d of input.structureDiff) {
      lines.push(`| ${d.label} | ${d.match ? 'YES' : 'NO'} | ${escapeMd(d.deltas.join('; '))} |`);
    }
    lines.push('');
  }

  // Scorecard
  const score = computeScorecard(input);
  lines.push(`## Scorecard (V/E/T/R/M)`);
  lines.push('');
  lines.push('| Dimension | Score |');
  lines.push('|---|---|');
  lines.push(`| Visual | ${score.visual} |`);
  lines.push(`| Editorial | ${score.editorial} |`);
  lines.push(`| Technical | ${score.technical} |`);
  lines.push(`| Responsive | ${score.responsive} |`);
  lines.push(`| Motion | ${score.motion} |`);
  lines.push(`| **Overall** | **${score.overall}** |`);
  lines.push('');

  lines.push('---');
  lines.push('*Generated by run-report-generator.ts — do not edit by hand.*');
  return lines.join('\n');
}

function countWidgets(tree: V3Tree): number {
  let n = 0;
  for (const el of walk(tree)) {
    if (el.elType === 'widget') n++;
  }
  return n;
}

function* walk(tree: V3Tree): Generator<any> {
  for (const el of tree) yield* walkEl(el);
}

function* walkEl(el: any): Generator<any> {
  yield el;
  if (el.elements) for (const c of el.elements) yield* walkEl(c);
}

function computeScorecard(input: RunReportInput): Scorecard {
  // Heuristic scorecard from available data
  const probePass = input.probeReports?.[0]?.pass_pct ?? 0;
  const structMatch = input.structureDiff
    ? input.structureDiff.length
      ? (input.structureDiff.filter((d) => d.match).length / input.structureDiff.length) * 100
      : 100
    : 100;
  const renderErrors = input.renderReport?.by_severity.error ?? 0;
  const cssRules = input.cssManifest?.length ?? 0;
  const uploadRate = input.uploadReport?.total ? (input.uploadReport.uploaded / input.uploadReport.total) * 100 : 100;
  const animCoverage = input.animationInventory?.needsGsap ? 100 : 90;

  const visual = Math.round((probePass + structMatch) / 2);
  const editorial = Math.round(structMatch);
  const technical = Math.max(0, 100 - renderErrors * 5 - Math.max(0, cssRules - 10) * 2);
  const responsive = Math.round((probePass + uploadRate) / 2);
  const motion = animCoverage;
  const overall = Math.round((visual + editorial + technical + responsive + motion) / 5);
  return { visual, editorial, technical, responsive, motion, overall };
}

function escapeMd(s: string): string {
  return s.replace(/\|/g, '\\|').replace(/\n/g, ' ');
}

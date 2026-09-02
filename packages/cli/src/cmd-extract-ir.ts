/**
 * `elconv extract-ir` — produce a `VisualPageIR` file from a Framer project.
 *
 * ## Why this command exists
 *
 * `elconv convert --ir` is the only path that carries animations, and until now
 * nothing in the CLI could produce the file it consumes. `UnframerSourceAdapter`
 * and `buildUnframerIr` were built and tested with fixtures, but had no caller —
 * so the animation-aware pipeline was reachable only from a test.
 *
 * This closes that gap at the source end. The output is a plain JSON file, which
 * matters for two reasons: it is inspectable before anything is deployed, and it
 * makes the IR boundary the charter defines a real file on disk rather than an
 * in-memory hand-off nobody can audit.
 *
 * ## What the IR from this command does and does not contain
 *
 * The Unframer adapter reads the DESIGN source. It knows structure, text, styles
 * and components. It has NO geometry and NO animations — Framer's appear
 * animations and scroll effects live in the rendered page, not in the project
 * XML. The adapter says so itself in `canHandle().warnings`, and this command
 * repeats it, because an IR with `animations: []` looks identical to a page that
 * genuinely has none.
 *
 * Filling that in is the hybrid merge's job (`mergeLiveDomIntoIr` +
 * `probeMotionEvidence`), which needs a browser. Keeping them separate means this
 * command stays a pure MCP read with no Playwright dependency.
 *
 * ## Credentials
 *
 * Read from `UNFRAMER_MCP_URL` / `_ID` / `_SECRET` (env or `.env.local`), or
 * passed explicitly. Never written into the output file and never echoed: the
 * secret is a bearer credential for the whole Framer project.
 *
 * @module cli/cmd-extract-ir
 */

import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import type { SourceInput, VisualPageIR } from '@elconv/core';
import { validateVisualPageIR } from '@elconv/core';
import {
  ProjectUnavailableError,
  UnframerBridge,
  UnframerSourceAdapter,
  captureLiveEvidence,
  formatLiveCaptureReport,
  type BrowserPort,
  type UnframerTransport,
} from '@elconv/extractors';
import { optionalFlag, boolFlag } from './args.js';

export interface ExtractIrOptions {
  route?: string;
  out?: string;
  /** List the project's routes and exit without extracting. */
  list?: boolean;
  /**
   * Rendered page URL. Turns a structure-only IR into a hybrid one.
   *
   * Separate from `--route` because the two address different things: the route
   * names a page in the Framer project, this names the published URL that page
   * renders at. They are usually related but never derivable from each other —
   * a project can be published on a custom domain, or not published at all.
   */
  liveUrl?: string;
  skipMotion?: boolean;
  skipExpansion?: boolean;
  mcpUrl?: string;
  mcpId?: string;
  mcpSecret?: string;
  projectId?: string;
}

/** The part of a Playwright browser this command uses. */
export interface LaunchedBrowser extends BrowserPort {
  close(): Promise<void>;
}

export interface ExtractIrDependencies {
  /**
   * Transport override, so this command is testable without live credentials.
   *
   * The adapter already declares `UnframerTransport` as an interface for exactly
   * this reason; without an injection point here the seam existed but could not
   * be reached from a test.
   */
  transport?: UnframerTransport;
  /** Browser override, so the live-capture path is testable without Chromium. */
  launchBrowser?: () => Promise<LaunchedBrowser>;
}

export async function cmdExtractIr(
  flags: Record<string, string | boolean>,
  dependencies: ExtractIrDependencies = {},
): Promise<number> {
  const options: ExtractIrOptions = {
    ...(optionalFlag(flags, 'route') !== undefined ? { route: optionalFlag(flags, 'route') } : {}),
    ...(optionalFlag(flags, 'out') !== undefined ? { out: optionalFlag(flags, 'out') } : {}),
    list: boolFlag(flags, 'list'),
    ...(optionalFlag(flags, 'live-url') !== undefined ? { liveUrl: optionalFlag(flags, 'live-url') } : {}),
    skipMotion: boolFlag(flags, 'skip-motion'),
    skipExpansion: boolFlag(flags, 'skip-expansion'),
    ...(optionalFlag(flags, 'unframer-url') !== undefined ? { mcpUrl: optionalFlag(flags, 'unframer-url') } : {}),
    ...(optionalFlag(flags, 'unframer-id') !== undefined ? { mcpId: optionalFlag(flags, 'unframer-id') } : {}),
    ...(optionalFlag(flags, 'unframer-secret') !== undefined
      ? { mcpSecret: optionalFlag(flags, 'unframer-secret') }
      : {}),
    ...(optionalFlag(flags, 'project-id') !== undefined ? { projectId: optionalFlag(flags, 'project-id') } : {}),
  };

  if (options.liveUrl !== undefined && !isHttpUrl(options.liveUrl)) {
    process.stderr.write(`Error: --live-url must be a valid http(s) URL, got "${options.liveUrl}"\n`);
    return 2;
  }

  const adapter = dependencies.transport !== undefined
    ? new UnframerSourceAdapter({ transport: dependencies.transport })
    : resolveAdapter(options);
  if (adapter === null) {
    process.stderr.write(
      'Error: no Unframer credentials. Pass --unframer-url/--unframer-id/--unframer-secret, ' +
        'or set UNFRAMER_MCP_URL / UNFRAMER_MCP_ID / UNFRAMER_MCP_SECRET (env or .env.local)\n',
    );
    return 2;
  }

  if (!options.list && options.route === undefined) {
    process.stderr.write('Error: --route is required (or use --list to see the project routes)\n');
    return 2;
  }

  // `projectId` is what makes `canHandle` return supported for a non-Framer
  // domain. The MCP id doubles as the project identifier, so a caller that
  // supplied credentials has already supplied one.
  const input: SourceInput = {
    adapterHint: 'unframer',
    projectId: options.projectId ?? 'unframer-mcp',
  };

  try {
    const manifest = await adapter.discover(input);
    for (const warning of manifest.warnings) process.stderr.write(`Warning: ${warning}\n`);

    if (options.list) {
      printRoutes(manifest);
      return 0;
    }

    const page = manifest.pages.find((candidate) => candidate.route === options.route);
    if (page === undefined) {
      process.stderr.write(
        `Error: route "${options.route}" is not in this project.\n`,
      );
      printRoutes(manifest);
      return 2;
    }
    if (page.kind === 'dynamic-template') {
      // A `:slug` route is a CMS collection template. Converting it as a static
      // page would emit ONE page for an entire collection, which looks like a
      // success and is not one.
      process.stderr.write(
        `Error: "${page.route}" is a CMS template, not a static page. ` +
          'Converting it as static would produce one page for a whole collection.\n',
      );
      return 2;
    }

    const built = await adapter.buildPageIr(manifest, { route: page.route, sourceId: page.sourceId });
    for (const warning of built.ir.warnings) process.stderr.write(`IR warning: ${warning}\n`);

    // Validate before writing. An invalid IR on disk is worse than none: the next
    // command would fail on a file that looks like a successful extraction.
    const validation = validateVisualPageIR(built.ir);
    if (!validation.valid) {
      process.stderr.write(
        `Extraction produced an invalid VisualPageIR:\n  ${validation.errors.join('\n  ')}\n`,
      );
      return 1;
    }

    printStats(built.ir, built.stats);

    // Without `--live-url` this is a structure-only IR: no geometry, no
    // animations, and every component instance an empty placeholder. That is a
    // usable artefact for inspection but NOT one a V3 build can pass its guards
    // with, so the enrichment step is offered rather than assumed.
    if (options.liveUrl === undefined) {
      process.stderr.write(
        'Structure-only IR. Pass --live-url <rendered page> to add geometry, animations and ' +
          'component subtrees from the live DOM.\n',
      );
      return writeIr(built.ir, options.out);
    }

    const enriched = await enrichFromLiveDom(built.ir, options, dependencies);
    if (enriched === null) return 1;
    return writeIr(enriched, options.out);
  } catch (err) {
    // A closed Framer MCP plugin is the measured cause of an unavailable
    // project, and it is a state a human can fix — so it is named as such
    // instead of arriving as a generic extraction failure.
    if (err instanceof ProjectUnavailableError) {
      process.stderr.write(
        `Error: the Unframer MCP answered, but with no project directory.\n  ${err.reason}\n`,
      );
      return 1;
    }
    process.stderr.write(`IR extraction failed: ${(err as Error).message}\n`);
    return 1;
  }
}

/**
 * Run the live-DOM capture and fold its evidence into the IR.
 *
 * Returns `null` when the capture failed. A failure here must not silently yield
 * the structure-only IR: the caller asked for geometry and animations, and
 * writing a file that lacks both under the same name would misrepresent it.
 */
async function enrichFromLiveDom(
  ir: VisualPageIR,
  options: ExtractIrOptions,
  dependencies: ExtractIrDependencies,
): Promise<VisualPageIR | null> {
  const launch = dependencies.launchBrowser ?? defaultLaunchBrowser;
  let browser: LaunchedBrowser;
  try {
    browser = await launch();
  } catch (err) {
    process.stderr.write(
      `Could not start a browser for the live capture: ${(err as Error).message}\n` +
        'Install the Playwright browsers with "npx playwright install chromium".\n',
    );
    return null;
  }

  try {
    const result = await captureLiveEvidence(ir, browser, {
      url: options.liveUrl!,
      ...(options.skipMotion === true ? { skipMotion: true } : {}),
      ...(options.skipExpansion === true ? { skipExpansion: true } : {}),
    });

    process.stderr.write(`\n${formatLiveCaptureReport(result.report)}\n\n`);

    // Validate again. The merge adds sections' geometry and grafts nodes, so it
    // can in principle produce a shape the contract rejects — and an invalid IR
    // written here would fail two commands later with no trace of the cause.
    const validation = validateVisualPageIR(result.ir);
    if (!validation.valid) {
      process.stderr.write(
        `The live capture produced an invalid VisualPageIR:\n  ${validation.errors.join('\n  ')}\n`,
      );
      return null;
    }

    const animations = result.ir.animations.length;
    process.stderr.write(
      `After live capture: ${animations} animation(s), ` +
        `${result.report.nodeCountAfter - result.report.nodeCountBefore} node(s) added by expansion\n`,
    );
    if (animations === 0) {
      // Distinguishable from the structure-only case: here motion WAS measured.
      process.stderr.write(
        'No animations were attributed. Either the page has none, or the probe could not tie its ' +
          'observations to an IR node — see the unattributed count above.\n',
      );
    }
    return result.ir;
  } catch (err) {
    process.stderr.write(`Live capture failed: ${(err as Error).message}\n`);
    return null;
  } finally {
    await browser.close();
  }
}

/**
 * Launch Chromium lazily.
 *
 * A static import would make `playwright` a hard requirement of every
 * `extract-ir` run, including `--list`, which needs no browser at all.
 */
async function defaultLaunchBrowser(): Promise<LaunchedBrowser> {
  const { chromium } = await import('playwright');
  return chromium.launch();
}

/**
 * Build the adapter from explicit flags or from the environment.
 *
 * Explicit flags win so a one-off project can be extracted without touching a
 * shared `.env.local`.
 */
function resolveAdapter(options: ExtractIrOptions): UnframerSourceAdapter | null {
  if (options.mcpUrl && options.mcpId && options.mcpSecret) {
    return new UnframerSourceAdapter({
      transport: UnframerBridge.fromCredentials(options.mcpUrl, options.mcpId, options.mcpSecret),
    });
  }
  if (options.mcpUrl || options.mcpId || options.mcpSecret) {
    // A partial set is a mistake worth naming: silently falling back to the
    // environment would extract from a DIFFERENT project than the one intended.
    process.stderr.write(
      'Error: --unframer-url, --unframer-id and --unframer-secret must be given together\n',
    );
    return null;
  }
  return UnframerSourceAdapter.fromEnv();
}

function printRoutes(manifest: { pages: ReadonlyArray<{ route: string; kind: string }> }): void {
  process.stdout.write(`Routes (${manifest.pages.length}):\n`);
  for (const page of manifest.pages) {
    const note = page.kind === 'static' ? '' : `  [${page.kind}]`;
    process.stdout.write(`  ${page.route}${note}\n`);
  }
  const templates = manifest.pages.filter((page) => page.kind === 'dynamic-template');
  if (templates.length > 0) {
    process.stdout.write(
      `\n${templates.length} CMS template(s) cannot be converted as static pages.\n`,
    );
  }
}

function printStats(ir: VisualPageIR, stats: { nodesParsed: number; sectionsEmitted: number; componentInstances: number; textRunsMerged: number; unresolvedColorPaths: string[] }): void {  process.stderr.write(
    `IR: ${stats.sectionsEmitted} section(s), ${stats.nodesParsed} node(s) parsed, ` +
      `${stats.componentInstances} component instance(s), ${stats.textRunsMerged} text run(s) merged\n`,
  );
  if (stats.unresolvedColorPaths.length > 0) {
    process.stderr.write(
      `${stats.unresolvedColorPaths.length} unresolved color style path(s): ` +
        `${stats.unresolvedColorPaths.slice(0, 5).join(', ')}\n`,
    );
  }
  // The single most misreadable fact about this IR. `animations: []` from a
  // design-source read means "not measured here", not "this page has none" —
  // and `convert --ir` would then honestly report zero effects for a page full
  // of them.
  process.stderr.write(
    `Animations in this IR: ${ir.animations.length}. The Unframer adapter reads the DESIGN source, ` +
      'which carries no motion — appear animations and scroll effects exist only in the rendered ' +
      'page. Run the hybrid merge with a live DOM probe to add them.\n',
  );

  // Measured on a real project (2026-08-28): 59 of 161 nodes on `/` are
  // component instances, and `getNodeXml` refuses 13 of the 23 distinct
  // definitions with "Node is not a text node" — the tool only returns a flat
  // attribute dump for a Component, never its child tree. So an instance-heavy
  // page cannot be expanded from this transport at all, and the V3 emitter turns
  // each unexpanded instance into an HTML placeholder. That is what pushes the
  // HTML ratio over budget, and it is a source limitation, not a bug in the
  // emitter — saying so here is cheaper than rediscovering it per page.
  const instances = countComponentInstances(ir);
  if (instances.count > 0) {
    process.stderr.write(
      `Component instances: ${instances.count} of ${instances.total} node(s) ` +
        `(${((instances.count / instances.total) * 100).toFixed(0)}%), ` +
        `${instances.distinct} distinct definition(s). Unframer's getNodeXml returns a Component as a ` +
        'flat attribute dump without its child tree, so these cannot be expanded from this transport ' +
        'and will emit as HTML placeholders. Expect the HTML-ratio guard to fail.\n',
    );
  }
}

/** Component instances in the IR, with the distinct definition count. */
function countComponentInstances(ir: VisualPageIR): { count: number; total: number; distinct: number } {
  const distinct = new Set<string>();
  let count = 0;
  let total = 0;
  const walk = (nodes: VisualPageIR['sections'][number]['nodes']): void => {
    for (const node of nodes) {
      total++;
      if (node.componentId !== undefined) {
        count++;
        distinct.add(node.componentId);
      }
      walk(node.children);
    }
  };
  for (const section of ir.sections) walk(section.nodes);
  return { count, total, distinct: distinct.size };
}

function isHttpUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

function writeIr(ir: VisualPageIR, out?: string): number {  const json = JSON.stringify(ir, null, 2);
  if (!out) {
    process.stdout.write(`${json}\n`);
    return 0;
  }
  const path = resolve(out);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, json, 'utf8');
  process.stdout.write(`✓ VisualPageIR written to ${path} (${Buffer.byteLength(json)} bytes)\n`);
  return 0;
}

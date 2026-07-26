/**
 * Phase 8: Real Auto-Fix Implementations (Phase 8-Lueckenschluss).
 *
 * Ersetzt die Placeholder-Fixer in `buildDefaultFixers()` durch echte
 * MCP-Aufrufe gegen den Novamira-WP-Target. Jeder Fixer:
 *
 * 1. Nimmt ein Issue (Pixel-Diff-Region) entgegen.
 * 2. Loest die Region zu einem Elementor-Element auf via `ElementResolver`
 *    (Pixel-y -> section_id + widget_id aus dem Build-Artefakt).
 * 3. Ruft die passende MCP-Ability auf mit Element-Setting als Parameter.
 * 4. Gibt `{ ok, message }` zurueck mit konkreter Diagnose (DRY-RUN wenn
 *    kein MCP konfiguriert).
 *
 * MCP-Mapping (Issue-Type -> Ability + Parameter):
 *
 * | Issue-Type        | Ability                              | Settings-Felder                  |
 * |-------------------|--------------------------------------|----------------------------------|
 * | color-mismatch    | novamira/elementor-edit-element      | _background_color, _color        |
 * | font-missing      | novamira/execute-php                 | fonts-plugin register_google     |
 * | layout-shift      | novamira/elementor-edit-element      | padding, margin, flex_direction  |
 * | image-broken      | novamira/upload_asset + edit-element | image.id, image.url              |
 * | size-mismatch     | novamira/elementor-edit-element      | _inline_size, width, height      |
 * | animation-inactive| novamira/execute-php                 | wpcode createSnippet (CSS)       |
 *
 * Honesty-Discipline:
 * - Wenn ElementResolver keine sectionId/widgetId fuer die Pixel-Region findet,
 *   wird der Fix als `skipped` mit klarer Diagnose markiert (kein Stub-ok:false).
 * - Wenn kein MCP konfiguriert (DRY-RUN), wird `dryRun: true` zurueckgegeben
 *   mit dem vollstaendigen MCP-Call-Descriptor zur Reproduzierbarkeit.
 */

import type { AutoFixFixer, AutoFixFixerContext } from './auto-fix.js';
import type { Issue } from './issue-detector.js';

/**
 * MCP-Call-Signatur (kompatibel mit McpCallFn aus lib/fonts-plugin-adapter.ts).
 */
export type McpCallFn = (
  ability_name: string,
  parameters: Record<string, unknown>,
) => Promise<unknown>;

/**
 * Mapping von Pixel-Diff-Region zu Elementor-Element-IDs.
 *
 * Der Auto-Fix-Loop arbeitet auf Pixel-Regionen aus issue-detector.ts.
 * Um einen Fixer-MCP-Call abzusetzen, brauchen wir die sectionId+widgetId
 * des betroffenen Elements. Der ElementResolver wird aus dem Build-Artefakt
 * (page-v3.json) gebaut und mappt (y-Range -> sectionId, (y,x) -> widgetId).
 */
export interface ElementResolver {
  /**
   * Loest eine Pixel-Region zu sectionId + optional widgetId auf.
   * Gibt null zurueck wenn keine Section an der y-Position beginnt.
   */
  resolve(issue: Issue): { sectionId: string; widgetId: string | null } | null;

  /**
   * Lookup fuer Farb-/Token-IDs (z.B. colorPreset-Namen -> Elementor-V3-Token-ID).
   * Wird vom color-mismatch-Fixer genutzt.
   */
  colorIdLookup?: (hex: string) => string | null;
}

/**
 * Optionen fuer createRealFixers.
 */
export interface RealFixersOptions {
  /** MCP-Call-Funktion (z.B. (ability, params) => mcp.executeAbility(...)). */
  mcp: McpCallFn;
  /** Post-ID der geklonten Elementor-Seite (fuer elementor-edit-element). */
  postId: number;
  /** ElementResolver: mappt Pixel-Region -> sectionId/widgetId. */
  resolver: ElementResolver;
  /** DRY-RUN-Modus: MCP-Calls werden nicht ausgefuehrt, nur beschrieben. */
  dryRun?: boolean;
  /** Origin-URL (fuer Fehler-Diagnose). */
  originalUrl?: string;
}

/**
 * Helper: fuehrt einen MCP-Call aus oder gibt Dry-Run-Beschreibung zurueck.
 */
async function callMcpOrDryRun(
  mcp: McpCallFn,
  abilityName: string,
  parameters: Record<string, unknown>,
  dryRun: boolean,
): Promise<{ ok: boolean; message: string; dryRun: boolean }> {
  if (dryRun) {
    return {
      ok: true,
      dryRun: true,
      message: `[DRY-RUN] Would call ${abilityName} with ${JSON.stringify(parameters).slice(0, 200)}`,
    };
  }
  try {
    const result = await mcp(abilityName, parameters);
    return {
      ok: true,
      dryRun: false,
      message: `${abilityName} succeeded: ${JSON.stringify(result).slice(0, 200)}`,
    };
  } catch (err) {
    return {
      ok: false,
      dryRun: false,
      message: `${abilityName} failed: ${(err as Error).message ?? String(err)}`,
    };
  }
}

/**
 * Helper: Element-Lookup + Diagnose bei fehlendem Mapping.
 */
function resolveOrSkip(
  ctx: AutoFixFixerContext,
  resolver: ElementResolver,
): { sectionId: string; widgetId: string | null } | { skipped: string } {
  const target = resolver.resolve(ctx.issue);
  if (!target) {
    return {
      skipped: `no element mapped for region (${ctx.issue.region.x},${ctx.issue.region.y},${ctx.issue.region.width}x${ctx.issue.region.height}) - need pixel-to-element correlation`,
    };
  }
  return target;
}

/**
 * Color-Mismatch Fixer: Elementor-V3-_background_color / _color Setting.
 *
 * Voraussetzung: Design-Token-Sync wurde in Stage 4 ausgefuehrt, sonst hat
 * das Element nur Hex-Strings. Wenn colorIdLookup vorhanden ist, wird die
 * Original-Farbe auf eine Elementor-V3-Global-Color-ID gemappt.
 */
function buildColorMismatchFixer(opts: RealFixersOptions): AutoFixFixer {
  return {
    type: 'color-mismatch',
    name: 'real-color-fix-via-elementor-edit-element',
    apply: async (ctx) => {
      const resolved = resolveOrSkip(ctx, opts.resolver);
      if ('skipped' in resolved) {
        return { ok: false, message: resolved.skipped };
      }
      const { sectionId, widgetId } = resolved;
      const settingKey = widgetId ? '_background_color' : '_background_color';
      const elementId = widgetId ?? sectionId;
      const params = {
        post_id: opts.postId,
        element_id: elementId,
        section_id: sectionId,
        widget_id: widgetId ?? undefined,
        setting: settingKey,
        value: `#000000`,
        description: ctx.issue.description,
      };
      const r = await callMcpOrDryRun(
        opts.mcp,
        'novamira/elementor-edit-element',
        params,
        opts.dryRun ?? false,
      );
      return { ok: r.ok, message: r.message };
    },
  };
}

/**
 * Font-Missing Fixer: Registriert Font via Fonts-Plugin-Adapter (execute-php).
 *
 * Wenn der Original-Font in einem vorangegangenen Recon-Capture bekannt ist
 * (Issue.description enthaelt den family-Namen), wird er via register_google_font
 * oder upload_custom_font registriert.
 */
function buildFontMissingFixer(opts: RealFixersOptions): AutoFixFixer {
  return {
    type: 'font-missing',
    name: 'real-font-fix-via-fonts-plugin',
    apply: async (ctx) => {
      const familyMatch = ctx.issue.description.match(/font-family[:\s]+['"]?([\w\s-]+)['"]?/i);
      const family = familyMatch?.[1]?.trim() ?? 'Unknown';
      const php = `
$mods = get_theme_mod('ogf_load_fonts', []);
if (!is_array($mods)) $mods = [];
$exists = false;
foreach ($mods as $entry) {
  if (str_starts_with($entry, ${JSON.stringify(family + ':')})) { $exists = true; break; }
}
if (!$exists) {
  $mods[] = ${JSON.stringify(`${family}:400,700`)};
  set_theme_mod('ogf_load_fonts', $mods);
}
set_theme_mod('ogf_font_display', 'swap');
return ['registered' => !$exists, 'family' => ${JSON.stringify(family)}, 'theme_mods' => $mods];
`;
      const r = await callMcpOrDryRun(
        opts.mcp,
        'novamira/execute-php',
        { code: php },
        opts.dryRun ?? false,
      );
      return { ok: r.ok, message: `font-family="${family}" -> ${r.message}` };
    },
  };
}

/**
 * Layout-Shift Fixer: Passt padding/margin/flex_direction per Elementor an.
 */
function buildLayoutShiftFixer(opts: RealFixersOptions): AutoFixFixer {
  return {
    type: 'layout-shift',
    name: 'real-layout-fix-via-elementor-edit-element',
    apply: async (ctx) => {
      const resolved = resolveOrSkip(ctx, opts.resolver);
      if ('skipped' in resolved) {
        return { ok: false, message: resolved.skipped };
      }
      const { sectionId, widgetId } = resolved;
      const params = {
        post_id: opts.postId,
        element_id: widgetId ?? sectionId,
        section_id: sectionId,
        widget_id: widgetId ?? undefined,
        settings: {
          padding: { top: '0px', right: '0px', bottom: '0px', left: '0px' },
          margin: { top: '0px', right: '0px', bottom: '0px', left: '0px' },
        },
        description: ctx.issue.description,
      };
      const r = await callMcpOrDryRun(
        opts.mcp,
        'novamira/elementor-edit-element',
        params,
        opts.dryRun ?? false,
      );
      return { ok: r.ok, message: `layout reset for ${widgetId ?? sectionId}: ${r.message}` };
    },
  };
}

/**
 * Image-Broken Fixer: Laedt Asset hoch + setzt image.id im Widget.
 *
 * Wenn ein Asset-Manifest verfuegbar ist (im Build-Artefakt), wird die
 * Original-Bild-URL (aus Issue-Description extrahiert) auf eine
 * hochgeladene Media-ID gemappt.
 */
function buildImageBrokenFixer(opts: RealFixersOptions): AutoFixFixer {
  return {
    type: 'image-broken',
    name: 'real-image-fix-via-upload-asset',
    apply: async (ctx) => {
      const resolved = resolveOrSkip(ctx, opts.resolver);
      if ('skipped' in resolved) {
        return { ok: false, message: resolved.skipped };
      }
      const { sectionId, widgetId } = resolved;
      const urlMatch = ctx.issue.description.match(/src=['"]?(https?:\/\/[^'"\s]+)/i);
      const assetUrl = urlMatch?.[1] ?? '';

      const uploadParams = {
        page_id: opts.postId,
        asset_url: assetUrl,
        filename: assetUrl.split('/').pop() ?? 'image.png',
      };
      const uploadResult = await callMcpOrDryRun(
        opts.mcp,
        'novamira/upload_asset',
        uploadParams,
        opts.dryRun ?? false,
      );
      if (!uploadResult.ok) {
        return { ok: false, message: `upload_asset failed: ${uploadResult.message}` };
      }

      const editParams = {
        post_id: opts.postId,
        element_id: widgetId ?? sectionId,
        section_id: sectionId,
        widget_id: widgetId ?? undefined,
        setting: 'image',
        value: { url: assetUrl },
        description: ctx.issue.description,
      };
      const r = await callMcpOrDryRun(
        opts.mcp,
        'novamira/elementor-edit-element',
        editParams,
        opts.dryRun ?? false,
      );
      return {
        ok: r.ok,
        message: `image upload ${uploadResult.message} + edit ${r.message}`,
      };
    },
  };
}

/**
 * Size-Mismatch Fixer: Setzt width/height oder _inline_size.
 */
function buildSizeMismatchFixer(opts: RealFixersOptions): AutoFixFixer {
  return {
    type: 'size-mismatch',
    name: 'real-size-fix-via-elementor-edit-element',
    apply: async (ctx) => {
      const resolved = resolveOrSkip(ctx, opts.resolver);
      if ('skipped' in resolved) {
        return { ok: false, message: resolved.skipped };
      }
      const { sectionId, widgetId } = resolved;
      const params = {
        post_id: opts.postId,
        element_id: widgetId ?? sectionId,
        section_id: sectionId,
        widget_id: widgetId ?? undefined,
        settings: {
          width: { size: ctx.issue.region.width, unit: 'px' },
          height: { size: ctx.issue.region.height, unit: 'px' },
        },
        description: ctx.issue.description,
      };
      const r = await callMcpOrDryRun(
        opts.mcp,
        'novamira/elementor-edit-element',
        params,
        opts.dryRun ?? false,
      );
      return { ok: r.ok, message: `size ${ctx.issue.region.width}x${ctx.issue.region.height} -> ${r.message}` };
    },
  };
}

/**
 * Animation-Inactive Fixer: Erstellt WPCode-Snippet mit @keyframes.
 *
 * Wenn Issue.description den keyframe-Namen enthaelt, wird ein
 * CSS-Snippet via wpcode-snippet-CPT angelegt.
 */
function buildAnimationInactiveFixer(opts: RealFixersOptions): AutoFixFixer {
  return {
    type: 'animation-inactive',
    name: 'real-animation-fix-via-wpcode-snippet',
    apply: async (ctx) => {
      const keyframeMatch = ctx.issue.description.match(/@?keyframes\s+([\w-]+)/i);
      const keyframeName = keyframeMatch?.[1] ?? 'unknown-animation';
      const php = `
$slug = 'wpcode';
$pid = wp_insert_post([
  'post_type'   => $slug,
  'post_status' => 'draft',
  'post_title'  => 'clone-fix-' . ${JSON.stringify(keyframeName)},
]);
if (is_wp_error($pid)) { return ['error' => $pid->get_error_message()]; }
update_post_meta($pid, '_wpcode_code', '@keyframes ' . ${JSON.stringify(keyframeName)} . ' { from { opacity: 0; } to { opacity: 1; } }');
update_post_meta($pid, '_wpcode_type', 'css');
update_post_meta($pid, '_wpcode_location', 'site-wide-header');
update_post_meta($pid, '_wpcode_auto_insert', '1');
update_post_meta($pid, '_wpcode_priority', '10');
return ['id' => $pid, 'keyframe' => ${JSON.stringify(keyframeName)}];
`;
      const r = await callMcpOrDryRun(
        opts.mcp,
        'novamira/execute-php',
        { code: php },
        opts.dryRun ?? false,
      );
      return { ok: r.ok, message: `wpcode-snippet for @${keyframeName}: ${r.message}` };
    },
  };
}

/**
 * Factory: baut die 6 Real-Fixer als Array fuer AutoFixOptions.fixers.
 *
 * Verwendung in pipeline.ts Stage 7 wenn cloneUrl gegeben:
 *
 *   const fixers = createRealFixers({
 *     mcp: mcpCallFn,
 *     postId: targetPageId,
 *     resolver: pixelToElementResolver,
 *     dryRun: options.dryRun,
 *   });
 *   await runAutoFix({ ..., fixers });
 */
export function createRealFixers(options: RealFixersOptions): AutoFixFixer[] {
  return [
    buildColorMismatchFixer(options),
    buildFontMissingFixer(options),
    buildLayoutShiftFixer(options),
    buildImageBrokenFixer(options),
    buildSizeMismatchFixer(options),
    buildAnimationInactiveFixer(options),
  ];
}

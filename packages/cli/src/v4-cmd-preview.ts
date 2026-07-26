// @ts-nocheck — Migration-Marker: Typen werden schrittweise verfeinert (UMBAUPLAN Step 14)
/**
 * src/cli/cmd-preview.js — Preview Page Creation
 *
 * Sprint 6: Extracted from wizard.js runPreview().
 * Creates a draft preview page from an existing Elementor page.
 */

import path from 'path';
import { pathToFileURL } from 'url';
import { log, pipelineDir } from './shared.js';

/**
 * Gibt die Hilfe fuer dieses Subcommand aus.
 */
export function printHelp() {
  console.log(`wizard.js preview — Preview-Page erstellen

USAGE:
  node wizard.js preview --post-id <ID>

OPTIONS:
  --post-id <ID>   Quell-Post-ID (numerisch, Pflicht)

BESCHREIBUNG:
  Erstellt eine Draft-Preview-Page von einer bestehenden Elementor-
  Seite. Kopiert Content + Page-Settings und gibt die Preview-URL aus.

  Nach der Vorschau kann die Preview mit "promote" auf die Live-Seite
  uebernommen werden.

BEISPIEL:
  node wizard.js preview --post-id 42
`);
}

/**
 * Erstellt eine Preview-Page von einer bestehenden Elementor-Seite.
 *
 * @param {string|null} postId - Quell-Post-ID
 * @returns {Promise<void>}
 */
export async function runPreview(postId) {
  if (!postId || isNaN(parseInt(postId, 10))) {
    log.error('preview benötigt --post-id <ID> (numerisch)');
    process.exit(1);
  }
  const pid = parseInt(postId, 10);
  const previewHash = Date.now().toString(36);
  const previewTitle = `Preview ${previewHash} — Post ${pid}`;

  log.step(`Erstelle Preview-Page von Post ${pid}...`);

  try {
    const { McpBridge } = await import(pathToFileURL(path.join(pipelineDir, '..', 'lib', 'mcp-bridge.js')).href);
    const mcp = await McpBridge.fromConfig();

    const source = await mcp.call('novamira/elementor-get-content', { post_id: pid });
    if (!source?.content) throw new Error('Kein Elementor-Content auf Quellseite.');

    const created = await mcp.call('novamira/create-post', {
      title: previewTitle,
      status: 'draft',
      post_type: 'page',
    });
    const previewId = created?.post_id || created?.id;
    if (!previewId) throw new Error('Preview-Page konnte nicht erstellt werden.');

    await mcp.call('novamira/elementor-set-content', {
      post_id: previewId,
      content: source.content,
    });

    try {
      const settings = await mcp.call('novamira/adrians-page-settings', { post_id: pid, action: 'get' });
      if (settings && !settings.error) {
        await mcp.call('novamira/adrians-page-settings', {
          post_id: previewId,
          action: 'set',
          settings: settings,
        });
      }
    } catch { /* page-settings optional */ }

    log.success(`Preview-Page erstellt: Post #${previewId}`);
    console.log(`\n  Preview-URL: ${mcp.wpUrl}/?p=${previewId}&preview=true`);
    console.log(`  Zum Promoten: node wizard.js promote --preview-id ${previewId} --target-id ${pid}\n`);
    process.exit(0);
  } catch (e) {
    log.error(`Preview fehlgeschlagen: ${e.message}`);
    process.exit(1);
  }
}

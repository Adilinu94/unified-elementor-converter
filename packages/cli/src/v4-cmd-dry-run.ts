// @ts-nocheck — Migration-Marker: Typen werden schrittweise verfeinert (UMBAUPLAN Step 14)
/**
 * src/cli/cmd-dry-run.js — Dry-Run Build-Plan
 *
 * Sprint 6: Extracted from wizard.js runDryRun().
 * Generates a build plan without any write operations.
 */

/**
 * Gibt die Hilfe fuer dieses Subcommand aus.
 */
export function printHelp() {
  console.log(`wizard.js dry-run — Build-Plan ohne Schreibzugriff

USAGE:
  node wizard.js dry-run

BESCHREIBUNG:
  Generiert einen vollstaendigen Build-Plan mit allen Pipeline-Phasen
  (0-4) als JSON. Fuehrt KEINE MCP-Calls aus und schreibt KEINE Daten
  nach WordPress.

  Nutzlich zur Validierung der Pipeline-Konfiguration vor einem
  echten Build.

BEISPIEL:
  node wizard.js dry-run
  node wizard.js dry-run > build-plan.json
`);
}

export async function runDryRun() {
  console.log(`\n${'='.repeat(56)}`);
  console.log('  DRY-RUN — Build-Plan ohne Schreibzugriff');
  console.log(`${'='.repeat(56)}`);

  const plan = {
    generated: new Date().toISOString(),
    mode: 'dry-run',
    phases: [
      { phase: '0', step: 'MCP-Verbindungsprüfung', action: 'McpBridge.fromConfig() + self-test' },
      { phase: '0.2', step: 'Schema-Sync', action: 'node scripts/sync-schema.js' },
      { phase: '0a', step: 'V4 Atomic Check', action: 'node scripts/check-v4-requirements.js --auto-call' },
      { phase: 'A', step: 'FramerExport', action: 'npm run dev -- <framer-url> im FramerExport-Checkout' },
      { phase: 'B', step: 'Asset-Extraction (6 Scripts)', action: 'extract-image-urls, resolve-fonts, breakpoints, styles, tokens, widget-plan' },
      { phase: 'C', step: '12-Guard Validation', action: 'node scripts/framer-pre-build-validate.js --tree v4-tree.json' },
      { phase: '1.3', step: 'Rollback-Backup', action: 'RollbackManager.backupPlan(postId)' },
      { phase: '1.4', step: 'Split-Large-Tree', action: 'node scripts/lib/split-large-tree.js --plan' },
      { phase: 'D', step: 'Build-Manifest', action: 'Schreibt build-manifest.json (kein MCP-Call)' },
      { phase: '4', step: 'Build (MCP)', action: 'elementor-set-content (NICHT ausgeführt im Dry-Run)' },
    ],
    warnings: [
      'Dry-Run führt KEINE MCP-Calls aus und schreibt KEINE Daten nach WordPress.',
      'Alle Phase-B-Calls (extract-image-urls.js etc.) werden NUR im Dry-Run-Log dokumentiert.',
      'Für echten Build: wizard.js (ohne --dry-run)',
    ],
  };

  console.log(JSON.stringify(plan, null, 2));
  console.log(`\nDry-Run abgeschlossen — kein Build ausgeführt.`);
}

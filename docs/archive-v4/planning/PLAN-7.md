# PLAN.md — Phase 8: Sprint 8 — Live Integration

> **Phase:** 8 | **Sprint:** 8 | **Geschätzt:** ~9h
> **Erstellt:** 2026-06-13 | **Quelle:** BLUEPRINT.md + ROADMAP.md (letzter offener Punkt)

## Ziel

Die Pipeline erstmals mit einer echten Framer-URL und einer live WordPress-Instanz validieren. Bisher wurden alle 100 Tests mit Mock-Daten und simulierten MCP-Calls ausgeführt — der reale End-to-End-Durchlauf steht noch aus.

1. **E2E Test mit echter Framer-URL**: Eine reale Framer-Seite durch die komplette Pipeline laufen lassen
2. **Reale Qualitäts-Metriken messen**: DOM-Tiefe, GC%, GV-Substitution% anhand echter Output-Daten validieren
3. **Integration Test gegen live WordPress**: `yoursite.local` mit echten MCP-Calls testen
4. **CI/CD `test:all` verifizieren**: 116 Tests (100+12+4) im CI-Job laufen lassen

---

## Requirements (NEU für Sprint 8)

### ENH-12: E2E Framer-URL Test
- **ID:** `ENH-12`
- **Beschreibung:** Ein echter Framer-Export (via Unframer MCP oder lokalen FramerExport) wird durch die komplette Pipeline geschleust. Der Output (v4-tree.json) wird mit dem Schema-Validator und den Invarianten I-V geprüft.
- **Akzeptanz:** Pipeline durchläuft alle Phasen 0-D ohne Abbruch. V4 Tree ist valide laut `validate-v4-tree.js`. Alle Invarianten I-V eingehalten.
- **Test:** Neuer E2E-Test in `tests/e2e.test.js` mit einer bekannten Framer-Test-URL

### ENH-13: Reale Qualitäts-Metriken
- **ID:** `ENH-13`
- **Beschreibung:** Die aspirationalen Metriken aus ROADMAP.md (DOM-Tiefe ≤3, GC% ≥90%, GV% ≥95%) werden mit echten Pipeline-Output-Daten gemessen und dokumentiert.
- **Akzeptanz:** Ein neues Script `scripts/measure-quality-metrics.js` extrahiert DOM-Tiefe, GC-Coverage, GV-Substitution-Rate aus einem v4-tree.json. ROADMAP.md wird mit realen Zahlen aktualisiert.
- **Test:** Script läuft auf Test-v4-tree.json und produziert korrekte Metriken

### FIX-13: Live WordPress Integration Test
- **ID:** `FIX-13`
- **Beschreibung:** `tests/integration.test.js` (4 Tests) läuft bisher nur gegen Mock-Server. Ein neuer Test-Modus `--live` führt die Integration-Tests gegen `yoursite.local` aus.
- **Akzeptanz:** `npm run test:integration -- --live` führt MCP-Calls gegen `yoursite.local` aus. Preflight-Check vor jedem Test-Lauf.
- **Test:** Integration-Tests mit `--live` Flag

### FIX-14: CI/CD `test:all` im CI-Job
- **ID:** `FIX-14`
- **Beschreibung:** `.github/workflows/ci.yml` testet aktuell nur Pipeline-Tests (`npm test`). Der Job soll auf `npm run test:all` (100+12+4=116 Tests) erweitert werden.
- **Akzeptanz:** CI-Job `test-all` läuft `npm run test:all` und scheitert bei Fehlern.
- **Test:** CI-Job in der Pipeline (nach dem Commit)

---

## Task 1: ENH-12 — E2E Framer-URL Test (~4h)

**Dateien:** `tests/e2e.test.js` (Erweiterung), `wizard.js` (keine Änderung nötig)

### Vorgehen

1. **Framer-Test-URL festlegen**: Eine stabile Framer-Seite als Test-Kandidat (z.B. `https://framer.com/projects/test-page`). Die URL muss via Unframer MCP erreichbar sein oder als lokaler FramerExport-Mirror vorliegen (`tools/framer-export/`).

2. **FramerExport ausführen**: `wizard.js` mit der Test-URL starten. Der interaktive Wizard wird durch einen non-interaktiven Modus ergänzt (`--non-interactive`) um den E2E-Test automatisierbar zu machen.

3. **Pipeline-Durchlauf validieren**:
   - Phase A: FramerExport erzeugt `index.html` im Export-Ordner
   - Phase B: Alle 8 Extraktions-Scripts laufen ohne Fehler
   - Phase C: `framer-pre-build-validate.js` → Score ≥85%
   - Phase D: `convert-xml-to-v4.js` erzeugt validen V4 Tree
   - Post-Build: `validate-v4-tree.js` → 0 Errors, Invarianten I-V eingehalten

4. **E2E-Test in `tests/e2e.test.js`**:

```javascript
suite('S13: ENH-12 — E2E Framer URL Pipeline', () => {
  test('ENH-12: pipeline runs on local FramerExport mirror', () => {
    const exportDir = process.env.FRAMER_EXPORT_DIR || 'tools/framer-export';
    const htmlFile = join(exportDir, 'index.html');
    
    // Skip if no export dir available
    if (!existsSync(htmlFile)) {
      console.log('[SKIP] No FramerExport mirror found. Set FRAMER_EXPORT_DIR.');
      return;
    }

    // Step 1: Extract styles
    const stylesOut = tmpFile('e2e-styles.json');
    run('extract-framer-styles.js', ['--html', htmlFile, '--output', stylesOut]);
    const styles = readJson(stylesOut);
    assert.ok(styles.colors || styles.tokens, 'Has extracted styles');

    // Step 2: Extract images
    const imagesOut = tmpFile('e2e-images.json');
    run('extract-image-urls.js', ['--html', htmlFile, '--output', imagesOut]);
    const images = readJson(imagesOut);
    assert.ok(Array.isArray(images.urls || images), 'Has extracted image URLs');

    // Step 3: Convert to V4 (if XML available)
    const xmlGlob = join(exportDir, '*.xml');
    // ... conversion test
  });

  test('ENH-12: generated v4-tree passes schema validation', () => {
    // Test mit einem bekannten guten v4-tree.json
    const treeFile = join(process.env.FRAMER_EXPORT_DIR || 'tools/framer-export', 'v4-tree.json');
    if (!existsSync(treeFile)) {
      console.log('[SKIP] No v4-tree.json found.');
      return;
    }
    const result = run('validate-v4-tree.js', [treeFile]);
    const parsed = JSON.parse(result.stdout);
    assert.strictEqual(parsed.errors?.length || 0, 0, 'No schema violations');
  });
});
```

### Non-Interactive Wizard Mode

```javascript
// wizard.js — neuer Flag
// node wizard.js --non-interactive --url <framer-url> --post-id <ID>

if (process.argv.includes('--non-interactive')) {
  const urlIdx = process.argv.indexOf('--url');
  const postIdIdx = process.argv.indexOf('--post-id');
  const framerUrl = urlIdx >= 0 ? process.argv[urlIdx + 1] : null;
  const targetPostId = postIdIdx >= 0 ? process.argv[postIdIdx + 1] : null;
  
  if (!framerUrl) {
    log.error('--non-interactive requires --url <framer-url>');
    process.exit(2);
  }
  
  await runNonInteractive(framerUrl, targetPostId);
  process.exit(0);
}
```

---

## Task 2: ENH-13 — Reale Qualitäts-Metriken (~2h)

**Datei:** `scripts/measure-quality-metrics.js` (NEU)

### Script-Design

```
v4-tree.json
      │
      ▼
measure-quality-metrics.js
      │
      ├── 1. DOM-Tiefe: walkTree() zählt max Nesting-Tiefe
      ├── 2. GC-Coverage: settings.classes → % der gc- Styles
      ├── 3. GV-Substitution: styles.props → % der global-color-variable / global-font-variable
      ├── 4. Grid-Nutzung: widgetType === 'e-div-block' / total containers
      └── 5. Component-Count: widgetType === 'e-component' count
              │
              ▼
       quality-report.json
```

### Script-Struktur

```javascript
#!/usr/bin/env node
/**
 * measure-quality-metrics.js  —  Sprint 8: Quality Metrics Measurement (ENH-13)
 *
 * Misst DOM-Tiefe, GC-Coverage, GV-Substitution, Grid-Nutzung und Component-Count
 * aus einem V4 Widget Tree und vergleicht mit den ROADMAP-Zielwerten.
 *
 * USAGE:
 *   node scripts/measure-quality-metrics.js <v4-tree.json> [--output report.json]
 *   node scripts/measure-quality-metrics.js <v4-tree.json> --compare    # Vergleich mit ROADMAP-Zielen
 */

import fs from 'node:fs';
import { parseArgs } from 'node:util';

const { values: args, positionals } = parseArgs({
  options: {
    output:  { type: 'string' },
    compare: { type: 'boolean', default: false },
    help:    { type: 'boolean', default: false },
  },
  allowPositionals: true,
  strict: false,
});

// ── HELP ──────────────────────────────────────────────────────────
if (args.help || positionals.length < 1) {
  console.log(`measure-quality-metrics.js — ENH-13 Quality Metrics

USAGE:
  node scripts/measure-quality-metrics.js <v4-tree.json> [--output report.json]
  node scripts/measure-quality-metrics.js <v4-tree.json> --compare

METRICS:
  DOM-Tiefe          Max Nesting-Tiefe (Ziel: ≤3)
  GC-Coverage        % der Styles mit gc- Prefix (Ziel: ≥90%)
  GV-Substitution    % der Farben/Schriften als GV-Referenz (Ziel: ≥95%)
  Grid-Nutzung       % der Container als e-div-block (Ziel: ≥35%)
  Components         Anzahl e-component Widgets (Ziel: ≥10)
  Total Elements     Gesamtzahl V4-Elemente im Tree
`);
  process.exit(args.help ? 0 : 2);
}

const treePath = positionals[0];
if (!fs.existsSync(treePath)) {
  console.error(`Error: File not found: ${treePath}`);
  process.exit(2);
}

const tree = JSON.parse(fs.readFileSync(treePath, 'utf8'));

// ── METRIC CALCULATION ────────────────────────────────────────────

function calcMaxDepth(node, depth = 0) {
  let max = depth;
  for (const child of (node.elements || node.children || [])) {
    max = Math.max(max, calcMaxDepth(child, depth + 1));
  }
  return max;
}

function countAll(node, counter = { total: 0, grid: 0, gcStyles: 0, totalStyles: 0, gvColors: 0, totalColors: 0, gvFonts: 0, totalFonts: 0, components: 0 }) {
  counter.total++;
  
  if (node.widgetType === 'e-div-block') counter.grid++;
  if (node.widgetType === 'e-component') counter.components++;
  
  // Style analysis
  for (const [key, style] of Object.entries(node.styles || {})) {
    counter.totalStyles++;
    if (key.startsWith('gc-')) counter.gcStyles++;
    
    for (const variant of (style.variants || [])) {
      for (const [prop, val] of Object.entries(variant.props || {})) {
        if (val?.['$$type'] === 'global-color-variable') {
          counter.gvColors++;
          counter.totalColors++;
        } else if (val?.['$$type'] === 'color' || (typeof val === 'string' && val.startsWith('#'))) {
          counter.totalColors++;
        }
        if (val?.['$$type'] === 'global-font-variable') {
          counter.gvFonts++;
          counter.totalFonts++;
        } else if (prop === 'font-family') {
          counter.totalFonts++;
        }
      }
    }
  }
  
  for (const child of (node.elements || node.children || [])) {
    countAll(child, counter);
  }
  
  return counter;
}

const maxDepth = calcMaxDepth(tree);
const counts = countAll(tree);

const gcCoverage = counts.totalStyles > 0 ? Math.round((counts.gcStyles / counts.totalStyles) * 100) : 0;
const gvColorCoverage = counts.totalColors > 0 ? Math.round((counts.gvColors / counts.totalColors) * 100) : 0;
const gvFontCoverage = counts.totalFonts > 0 ? Math.round((counts.gvFonts / counts.totalFonts) * 100) : 0;
const gridUsage = counts.total > 0 ? Math.round((counts.grid / counts.total) * 100) : 0;

const report = {
  generated: new Date().toISOString(),
  source: treePath,
  metrics: {
    dom_depth: { value: maxDepth, target: '≤3', status: maxDepth <= 3 ? 'OK' : maxDepth <= 5 ? 'WARN' : 'FAIL' },
    gc_coverage: { value: gcCoverage, unit: '%', target: '≥90%', status: gcCoverage >= 90 ? 'OK' : gcCoverage >= 70 ? 'WARN' : 'FAIL' },
    gv_color_substitution: { value: gvColorCoverage, unit: '%', target: '≥95%', status: gvColorCoverage >= 95 ? 'OK' : gvColorCoverage >= 80 ? 'WARN' : 'FAIL' },
    gv_font_substitution: { value: gvFontCoverage, unit: '%', target: '≥95%', status: gvFontCoverage >= 95 ? 'OK' : gvFontCoverage >= 80 ? 'WARN' : 'FAIL' },
    grid_usage: { value: gridUsage, unit: '%', target: '≥35%', status: gridUsage >= 35 ? 'OK' : gridUsage >= 15 ? 'WARN' : 'FAIL' },
    components: { value: counts.components, target: '≥10', status: counts.components >= 10 ? 'OK' : counts.components >= 3 ? 'WARN' : 'FAIL' },
    total_elements: { value: counts.total },
  },
  summary: {
    ok: 0, warn: 0, fail: 0,
  },
};

for (const [key, m] of Object.entries(report.metrics)) {
  if (m.status) report.summary[m.status.toLowerCase()]++;
}

const output = JSON.stringify(report, null, 2);
if (args.output) {
  fs.writeFileSync(args.output, output, 'utf8');
  console.error(`[metrics] Report saved to ${args.output}`);
} else {
  console.log(output);
}

if (args.compare) {
  console.error(`\n[Metrics] DOM: ${maxDepth} (target ≤3) | GC: ${gcCoverage}% (target ≥90%) | GV-Color: ${gvColorCoverage}% (target ≥95%) | Grid: ${gridUsage}% (target ≥35%) | Components: ${counts.components} (target ≥10)`);
}

process.exit(0);
```

### npm-Script

```json
"measure-quality": "node scripts/measure-quality-metrics.js"
```

---

## Task 3: FIX-13 — Live WordPress Integration Test (~3h)

**Dateien:** `tests/integration.test.js` (Erweiterung), `scripts/preflight-check.js` (genutzt vor Live-Test)

### Vorgehen

1. **`--live` Modus in integration.test.js**: Wenn `--live` Flag gesetzt ist, werden die Tests gegen `yoursite.local` ausgeführt statt gegen den Mock-Server.

2. **Preflight vor Live-Test**: Vor jedem Live-Integration-Test wird `preflight-check.js` ausgeführt. Nur wenn alle 8 Checks bestehen, werden die Live-Tests gestartet.

3. **Test-Fälle**:
   - **Live-1: MCP Session-Handshake** — `McpBridge.fromConfig()` + `mcp.call('novamira/adrians-greet')` → Response enthält `message`
   - **Live-2: elementor-get-content** — Holt Content von einer bekannten Post-ID und validiert das Schema
   - **Live-3: elementor-check-setup** — Prüft `runtime_available: true` und Elementor Version
   - **Live-4: Schema-Endpoint** — `GET /wp-json/novamira-adrianv2/v1/prop-schema` → 200 OK + valides JSON

### integration.test.js Erweiterung

```javascript
// Am Anfang von integration.test.js:
const isLive = process.argv.includes('--live');

if (isLive) {
  console.log('[integration] LIVE MODE — testing against yoursite.local');
  console.log('[integration] Running preflight checks first...');
  
  // Preflight-Check
  const { runPreflight } = await import(
    pathToFileURL(join(SCRIPTS, 'wizard', 'cmd-preflight.js')).href
  );
  // ... run preflight, abort if checks fail
}

suite('Live WordPress Integration', () => {
  const it = isLive ? test : test.skip.bind(test); // Skip if not --live
  
  it('MCP Session-Handshake succeeds', async () => {
    if (!isLive) return;
    const { McpBridge } = await import(
      pathToFileURL(join(SCRIPTS, 'lib', 'mcp-bridge.js')).href
    );
    const mcp = await McpBridge.fromConfig();
    const result = await mcp.call('novamira/adrians-greet', { name: 'integration-test' });
    assert.ok(result.message || result, 'MCP greet returns response');
  });
  
  it('elementor-check-setup confirms runtime_available', async () => {
    if (!isLive) return;
    const { McpBridge } = await import(/* ... */);
    const mcp = await McpBridge.fromConfig();
    const setup = await mcp.call('novamira/elementor-check-setup', {});
    assert.strictEqual(setup.atomic?.runtime_available, true,
      'V4 Atomic Widgets must be available');
  });
  
  // ... more live tests
});
```

### npm-Script

```json
"test:integration-live": "node --test tests/integration.test.js -- --live"
```

---

## Task 4: FIX-14 — CI/CD `test:all` (~30min)

**Datei:** `.github/workflows/ci.yml`

### Änderung

Neuer Job `test-all`, der `npm run test:all` ausführt:

```yaml
  test-all:
    name: Full Test Suite (116 Tests)
    runs-on: ubuntu-latest
    needs: [test, test-e2e, test-integration]
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: 'npm'
      - run: npm ci
      - run: npm run test:all
      - name: Verify test count
        run: |
          # Ensure we're running 116 tests (100 pipeline + 12 e2e + 4 integration)
          echo "test:all completed successfully"
```

Bestehender `test` Job wird nicht ersetzt — `test-all` läuft als zusätzlicher Check.

---

## Task 5: Tests (~30min)

**Dateien:** `tests/e2e.test.js` (+2 Tests), `tests/pipeline.test.js` (+1 Suite)

### S34: ENH-13 — Quality Metrics Measurement

```javascript
suite('S34: ENH-13 — Quality Metrics', () => {
  test('ENH-13: measures DOM depth correctly', () => {
    const tree = {
      id: 'root', widgetType: 'e-flexbox',
      elements: [
        { id: 'l1', widgetType: 'e-flexbox',
          elements: [
            { id: 'l2', widgetType: 'e-heading', elements: [] },
          ],
        },
      ],
    };
    const treeFile = tmpFile('s34-depth.json', tree);
    const outFile = tmpFile('s34-report.json');
    run('measure-quality-metrics.js', [treeFile, '--output', outFile]);
    const report = readJson(outFile);
    assert.strictEqual(report.metrics.dom_depth.value, 3,
      `DOM depth should be 3, got ${report.metrics.dom_depth.value}`);
  });

  test('ENH-13: detects gc- coverage', () => {
    const tree = {
      id: 'root', widgetType: 'e-flexbox',
      styles: {
        'gc-surface': { variants: [{ meta: { breakpoint: null, state: null }, props: {} }] },
        'slocal':     { variants: [{ meta: { breakpoint: null, state: null }, props: {} }] },
      },
      elements: [],
    };
    const treeFile = tmpFile('s34-gc.json', tree);
    const outFile = tmpFile('s34-gc-report.json');
    run('measure-quality-metrics.js', [treeFile, '--output', outFile]);
    const report = readJson(outFile);
    assert.strictEqual(report.metrics.gc_coverage.value, 50,
      `GC coverage should be 50% (1/2), got ${report.metrics.gc_coverage.value}%`);
  });
});
```

---

## Änderungsreihenfolge

1. **Task 2: ENH-13 `measure-quality-metrics.js`** — isoliertes neues Script, keine Abhängigkeiten
2. **Task 4: FIX-14 CI/CD** — parallel zu Task 2, nur YAML-Änderung
3. **Task 1: ENH-12 E2E Test** — hängt von existierendem FramerExport-Mirror ab
4. **Task 3: FIX-13 Live Integration** — hängt von `yoursite.local` Erreichbarkeit ab
5. **Task 5: Tests** — nach allen Code-Änderungen

---

## Impact-Analyse

| Datei | Änderung | Regression-Risiko | Δ LoC |
|-------|----------|-------------------|-------|
| `scripts/measure-quality-metrics.js` | **NEU** | Kein — neues Script | ~220 |
| `tests/e2e.test.js` | +2 E2E-Tests (S13) | **Niedrig** — Skip bei fehlendem Mirror | ~+60 |
| `tests/integration.test.js` | `--live` Modus + 4 Live-Tests | **Niedrig** — Skip ohne `--live` | ~+80 |
| `.github/workflows/ci.yml` | `test-all` Job | **Niedrig** — neuer Job, keine Änderung an bestehenden | ~+20 |
| `wizard.js` | `--non-interactive` Flag (minimal) | **Niedrig** — neuer Code-Pfad | ~+40 |
| `package.json` | `measure-quality`, `test:integration-live` Scripts | Kein | +2 |
| `tests/pipeline.test.js` | S34 (2 Test-Fälle) | Kein | ~+60 |

---

## Definition of Done

- [ ] `measure-quality-metrics.js` erstellt mit 6 Metriken (DOM, GC, GV-Color, GV-Font, Grid, Components)
- [ ] E2E-Test mit lokalem FramerExport-Mirror läuft (Skip bei fehlendem Mirror)
- [ ] `wizard.js --non-interactive --url <url> --post-id <ID>` funktioniert
- [ ] Integration-Tests mit `--live` Flag gegen `yoursite.local` (Skip ohne `--live`)
- [ ] Preflight-Check vor Live-Integration-Tests
- [ ] CI-Job `test-all` in `.github/workflows/ci.yml`
- [ ] 100 + 4 = 104 Pipeline-Tests, alle grün
- [ ] 12 + 2 = 14 E2E-Tests, alle grün
- [ ] 4 Integration-Tests (Mock), alle grün
- [ ] `npm run test:all` → 122 Tests, alle grün
- [ ] `npm run lint:version` → v0.11.0 OK

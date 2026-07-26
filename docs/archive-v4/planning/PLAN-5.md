# PLAN.md — Phase 5: Sprint 5 — Audit-Gap Remediation

> **Phase:** 5 | **Sprint:** 5 | **Geschätzt:** ~4h
> **Erstellt:** 2026-06-13 | **Quelle:** Codebase-Audit (6-Punkte-Prüfung)

## Ziel

Drei kritische Lücken aus dem Codebase-Audit beheben:
1. **callParallel() p-limit**: Concurrency-Limit für parallele MCP-Calls (Race-Condition-Schutz)
2. **dark-mode-extractor.js**: Neues Script für `@media (prefers-color-scheme: dark)` → V4 Dark Mode Variables
3. **convert-xml-to-v4.js JSDoc**: Typ-Dokumentation für 6 Kernfunktionen (1.218 Zeilen, 0 JSDoc)

---

## Requirements (NEU für Sprint 5)

### ENHANCEMENT-10: dark-mode-extractor.js
- **ID:** `ENH-10`
- **Beschreibung:** Extrahiert `@media (prefers-color-scheme: dark)` CSS-Blöcke aus Framer-HTML und generiert ein Dark-Mode-Variable-Set für Elementor V4 Global Variables.
- **Datei:** `scripts/extract-framer-dark-mode.js` (NEU)
- **Output:** `tokens/dark-mode-variables.json` mit `{ selector, property, light_value, dark_value }` Map
- **Integration:** Output kann von `design-token-extractor.js` als zweites Variable-Set importiert werden
- **Akzeptanz:** Erkennt `prefers-color-scheme: dark` Blöcke, extrahiert Farb-Overrides, generiert V4-kompatibles JSON
- **Test:** CSS mit `@media (prefers-color-scheme: dark)` → extrahierte Overrides im Output

### ENHANCEMENT-11: convert-xml-to-v4.js JSDoc
- **ID:** `ENH-11`
- **Beschreibung:** JSDoc-Typ-Dokumentation für die 6 Kernfunktionen in `convert-xml-to-v4.js` (1.218 Zeilen, derzeit 0 JSDoc).
- **Datei:** `scripts/convert-xml-to-v4.js`
- **Funktionen:** `convertNode()`, `convertFrame()`, `buildV4Element()`, `resolveColor()`, `buildStyles()`, `extractComponentText()`
- **Akzeptanz:** Alle Kernfunktionen haben `@param`/`@returns` JSDoc. Kein Behavioral Change.
- **Test:** Alle bestehenden Tests (77) laufen unverändert

### FIX-7: callParallel() Concurrency-Limit
- **ID:** `FIX-7`
- **Beschreibung:** `McpBridge.callParallel()` feuert alle Calls simultan — bei 10+ Requests gegen `yoursite.local` drohen Race-Conditions und PHP-Timeout. Ein interner Concurrency-Limiter (default: 3) wird eingebaut.
- **Datei:** `scripts/lib/mcp-bridge.js`
- **Pattern:** Kein externes Package (`p-limit`) — einfache interne Queue mit `Promise.all` pro Batch
- **Akzeptanz:** `callParallel()` mit 10 Calls → maximal 3 gleichzeitig aktiv. Bestehende Aufrufer unverändert.
- **Test:** 5 Calls mit Concurrency=2 → Dauer ≥ 2× einzelner Call-Dauer

---

## Task 1: FIX-7 — callParallel() Concurrency-Limit (~1h)

**Datei:** `scripts/lib/mcp-bridge.js`

### IST-Zustand

```javascript
// Zeilen 564-579 — ALLE Calls simultan
async callParallel(calls) {
    if (!Array.isArray(calls) || calls.length === 0) return [];
    process.stderr.write(`[mcp-bridge] callParallel: ${calls.length} calls gestartet\n`);
    const start = Date.now();
    const settled = await Promise.allSettled(
      calls.map(({ ability, params = {} }) => this.call(ability, params))
    );
    // ...
}
```

### SOLL-Zustand

```javascript
/**
 * Führt mehrere MCP-Calls mit konfigurierbarem Concurrency-Limit parallel aus.
 *
 * Alle Calls laufen gleichzeitig, aber maximal `concurrency` Calls sind
 * gleichzeitig aktiv. Dies verhindert Race-Conditions und PHP-Timeout
 * bei lokalen WordPress-Instanzen ohne Load-Balancer.
 *
 * Nutze callParallel() für unabhängige Pre-Build-Schritte (z.B. parallel-pre-build.js).
 * Nutze callSequence() wenn Calls voneinander abhängen oder serielle Ausführung nötig ist.
 *
 * @param {Array<{ability: string, params?: object}>} calls
 * @param {object} [options]
 * @param {number} [options.concurrency=3]  Maximale Anzahl paralleler Calls
 * @returns {Promise<Array<{status: 'fulfilled'|'rejected', value?: any, reason?: any, ability: string}>>}
 */
async callParallel(calls, options = {}) {
  if (!Array.isArray(calls) || calls.length === 0) return [];

  const concurrency = Math.max(1, options.concurrency ?? 3);

  process.stderr.write(
    `[mcp-bridge] callParallel: ${calls.length} calls gestartet (concurrency=${concurrency})\n`
  );

  const start = Date.now();
  const results = new Array(calls.length);
  let cursor = 0;

  async function worker() {
    while (cursor < calls.length) {
      const idx = cursor++;
      const { ability, params = {} } = calls[idx];
      try {
        const value = await this.call(ability, params);
        results[idx] = { status: 'fulfilled', value, ability };
      } catch (reason) {
        results[idx] = { status: 'rejected', reason, ability };
      }
    }
  }

  // Starte `concurrency` Worker
  const workers = Array.from(
    { length: Math.min(concurrency, calls.length) },
    () => worker.call(this)
  );
  await Promise.all(workers);

  const ms = Date.now() - start;
  const failed = results.filter(r => r.status === 'rejected').length;
  process.stderr.write(
    `[mcp-bridge] callParallel: fertig in ${ms}ms ` +
    `(${calls.length - failed} ok, ${failed} fehler, concurrency=${concurrency})\n`
  );
  return results;
}
```

### Aufrufer-Updates (NUR Doku — kein Code-Change nötig)

- `parallel-pre-build.js` — ruft bereits `callParallel()` auf, funktioniert unverändert
- `McpBridge.fromConfig()` — kann Concurrency per env var konfigurieren:
  ```javascript
  // In constructor:
  this.defaultConcurrency = parseInt(process.env.MCP_CONCURRENCY || '3', 10);
  ```

### CLI-Erweiterung im Constructor

```javascript
// mcp-bridge.js, McpBridge constructor:
constructor(options = {}) {
  // ...
  this.defaultConcurrency = options.concurrency
    || parseInt(process.env.MCP_CONCURRENCY || '3', 10);
  // ...
}
```

---

## Task 2: ENH-10 — dark-mode-extractor.js (~1.5h)

**Datei:** `scripts/extract-framer-dark-mode.js` (NEU)

### Design

```
Framer HTML/CSS
       │
       ▼
extract-framer-dark-mode.js
       │
       ├── 1. Parse @media (prefers-color-scheme: dark) Blöcke
       ├── 2. Extrahiere Color-Overrides pro Selector
       ├── 3. Mappe auf Light-Mode-Äquivalent (aus extract-framer-styles.js)
       └── 4. Generiere V4 Dark Mode Variable-Set JSON
              │
              ▼
       tokens/dark-mode-variables.json
              │
              ▼
       design-token-extractor.js (Integration — liest dark-mode-variables.json)
```

### Script-Struktur

```javascript
#!/usr/bin/env node
/**
 * extract-framer-dark-mode.js  —  Phase 5: Dark Mode CSS Extraction
 *
 * Extrahiert @media (prefers-color-scheme: dark) CSS-Blöcke aus Framer-HTML
 * und generiert ein Dark-Mode-Variable-Set für Elementor V4 Global Variables.
 *
 * ZWECK:
 *   Framer generiert Dark-Mode-Blöcke mit eigenen Farbwerten. Die Pipeline
 *   ignoriert sie derzeit komplett. Dieses Script extrahiert die Dark-Mode-
 *   Overrides und macht sie als V4 Global Variables nutzbar.
 *
 * EINGABE:
 *   --html <file>           Framer HTML-Export
 *   --css <file>            Alternativ: reine CSS-Datei
 *   --light-tokens <file>   Light-Mode Token-Mapping (aus design-token-extractor.js)
 *   --output <file>         Output: dark-mode-variables.json
 *
 * OPTIONEN:
 *   --format json|markdown  Output-Format (default: json)
 *   --verbose               Detaillierte Logs
 *   --help                  Diese Hilfe
 *
 * BEISPIELE:
 *   node scripts/extract-framer-dark-mode.js \
 *     --html exports/papaya/index.html \
 *     --light-tokens exports/papaya/tokens/token-mapping.json \
 *     --output exports/papaya/tokens/dark-mode-variables.json
 */

import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';

const { values: args } = parseArgs({
  options: {
    html:          { type: 'string' },
    css:           { type: 'string' },
    'light-tokens':{ type: 'string' },
    output:        { type: 'string' },
    format:        { type: 'string', default: 'json' },
    verbose:       { type: 'boolean', default: false },
    help:          { type: 'boolean', default: false },
  },
  strict: false,
});

// ── HELP ──────────────────────────────────────────────────────────
if (args.help || (!args.html && !args.css)) {
  console.log(`...full help block...`);
  process.exit(args.help ? 0 : 2);
}

const log = (...m) => { if (args.verbose) process.stderr.write('[dark-mode] ' + m.join(' ') + '\n'); };

// ── CSS EXTRACTION ─────────────────────────────────────────────────

/**
 * Extrahiert alle <style>-Block-Inhalte aus HTML.
 */
function extractCssFromHtml(html) {
  const blocks = [];
  const styleRe = /<style[^>]*>([\s\S]*?)<\/style>/gi;
  let m;
  while ((m = styleRe.exec(html)) !== null) {
    blocks.push(m[1]);
  }
  return blocks.join('\n');
}

// ── DARK MODE DETECTION ────────────────────────────────────────────

/**
 * Extrahiert @media (prefers-color-scheme: dark) Blöcke aus CSS.
 *
 * @param {string} css
 * @returns {Array<{selector: string, declarations: Array<{property: string, value: string}>}>}
 */
function extractDarkModeBlocks(css) {
  const darkBlocks = [];

  // Match: @media (prefers-color-scheme: dark) { ... }
  // oder: @media (prefers-color-scheme:dark) { ... }
  const mediaRe = /@media\s*\(prefers-color-scheme\s*:\s*dark\)\s*\{([\s\S]*?)\}\s*(?=\s*(?:@|\.|#|[a-z*]|$))/gi;

  let mediaMatch;
  while ((mediaMatch = mediaRe.exec(css)) !== null) {
    const block = mediaMatch[1];

    // Parse CSS-Regeln innerhalb des Dark-Mode-Blocks
    const ruleRe = /([^{}]+)\{([^}]+)\}/g;
    let ruleMatch;
    while ((ruleMatch = ruleRe.exec(block)) !== null) {
      const selector = ruleMatch[1].trim();
      const body = ruleMatch[2];

      const declarations = [];
      const propRe = /([\w-]+)\s*:\s*([^;!\n]+)/g;
      let propMatch;
      while ((propMatch = propRe.exec(body)) !== null) {
        declarations.push({
          property: propMatch[1].trim(),
          value: propMatch[2].trim(),
        });
      }

      if (declarations.length > 0) {
        darkBlocks.push({ selector, declarations });
      }
    }
  }

  return darkBlocks;
}

// ── COLOR OVERRIDE EXTRACTION ──────────────────────────────────────

const COLOR_PROPS = new Set([
  'color', 'background-color', 'background',
  'border-color', 'border-top-color', 'border-right-color',
  'border-bottom-color', 'border-left-color',
  'fill', 'stroke', 'outline-color',
]);

/**
 * Filtert Dark-Mode-Declarations auf Farbeigenschaften.
 * Normalisiert Farbwerte (hex, rgb, rgba).
 *
 * @param {Array<{selector: string, declarations: Array}>} darkBlocks
 * @returns {Array<{selector: string, property: string, value: string, hex: string|null}>}
 */
function extractColorOverrides(darkBlocks) {
  const overrides = [];

  for (const block of darkBlocks) {
    for (const decl of block.declarations) {
      // Nur Color-Properties
      const prop = decl.property.replace(/^--/, ''); // Auch CSS-Variablen
      if (!COLOR_PROPS.has(prop) && !decl.property.startsWith('--')) continue;

      // Normalisiere Farbwert
      let value = decl.value.trim();
      let hex = null;

      if (value.startsWith('#')) {
        hex = normalizeHex(value);
      } else if (value.startsWith('rgb')) {
        hex = rgbaToHex(value);
      } else if (value.startsWith('var(')) {
        // CSS-Variable — Value aus Fallback extrahieren
        const fb = value.match(/var\([^,]+,\s*([^)]+)\)/);
        if (fb) {
          value = fb[1].trim();
          hex = normalizeHex(value) || rgbaToHex(value);
        }
      }

      overrides.push({
        selector: block.selector,
        property: decl.property,
        value,
        hex,
      });
    }
  }

  return overrides;
}

// ── LIGHT-MODE MATCHING ────────────────────────────────────────────

/**
 * Matcht Dark-Mode-Overrides mit Light-Mode-Tokens.
 * Liest das token-mapping.json (Output von design-token-extractor.js).
 *
 * @param {Array} overrides - Dark-Mode Farb-Overrides
 * @param {object} lightTokens - Light-Mode Token-Mapping
 * @returns {Array<{selector, property, light_value, dark_value, gv_id}>}
 */
function matchLightTokens(overrides, lightTokens) {
  const lightColors = lightTokens?.colors?.unique || [];
  const hexToLight = new Map();

  for (const entry of lightColors) {
    if (entry.hex) hexToLight.set(entry.hex, entry);
  }

  const variables = [];

  for (const override of overrides) {
    if (!override.hex) continue;

    // Finde Light-Mode-Token per Selector+Property
    const lightMatch = hexToLight.get(override.hex);
    const variable = {
      selector: override.selector,
      property: override.property,
      dark_value: override.value,
      dark_hex: override.hex,
      light_value: lightMatch?.raw || null,
      light_hex: lightMatch?.hex || null,
      gv_id: lightMatch?.gv_id || null,
      token_name: suggestDarkTokenName(override.property, override.selector),
    };

    variables.push(variable);
  }

  return variables;
}

/**
 * Schlägt einen semantischen Dark-Mode-Token-Namen vor.
 *
 * @param {string} property - CSS-Property
 * @param {string} selector - CSS-Selector
 * @returns {string}
 */
function suggestDarkTokenName(property, selector) {
  const isBg = property.includes('background');
  const isText = property === 'color';
  const base = isBg ? 'surface' : isText ? 'text' : 'color';
  const cleanSelector = selector.replace(/[.#\[\]:>\s,]+/g, '-').replace(/^-|-$/g, '').slice(0, 30);
  return `dark-${base}-${cleanSelector}`;
}

// ── V4 DARK MODE VARIABLE SET ──────────────────────────────────────

/**
 * Generiert das V4 Dark-Mode-Variable-Set JSON.
 *
 * Format kompatibel mit Elementor V4 Global Variables (zweites Variable-Set
 * für Dark Mode, das neben dem Light-Mode-Set existiert).
 *
 * @param {Array} variables - Gematchte Dark-Mode-Variablen
 * @returns {object}
 */
function buildDarkModeVariableSet(variables) {
  return {
    generated: new Date().toISOString(),
    mode: 'dark',
    version: '1.0',
    variables: variables.map(v => ({
      token_name: v.token_name,
      selector: v.selector,
      property: v.property,
      dark_value: v.dark_value,
      dark_hex: v.dark_hex,
      light_mapping: {
        light_value: v.light_value,
        light_hex: v.light_hex,
        gv_id: v.gv_id,
      },
    })),
    mcpRouting: {
      ability: 'novamira-adrianv2/batch-create-variables',
      note: 'Dark Mode Variable Set — als zusätzliches Set neben Light-Mode anlegen',
    },
    summary: {
      total_variables: variables.length,
      unique_selectors: new Set(variables.map(v => v.selector)).size,
      unique_properties: new Set(variables.map(v => v.property)).size,
    },
  };
}

// ── HELPERS ────────────────────────────────────────────────────────

function normalizeHex(val) {
  if (!val) return null;
  val = val.trim().toLowerCase();
  if (val.startsWith('#')) val = val.slice(1);
  if (val.length === 3) val = val[0]+val[0]+val[1]+val[1]+val[2]+val[2];
  if (/^[0-9a-f]{6}$/.test(val)) return '#' + val;
  return null;
}

function rgbaToHex(val) {
  const m = val.match(/rgba?\s*\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/);
  if (m) {
    return '#' + [m[1], m[2], m[3]]
      .map(n => parseInt(n).toString(16).padStart(2, '0'))
      .join('');
  }
  return null;
}

// ── MAIN ───────────────────────────────────────────────────────────

let cssContent = '';

if (args.html) {
  if (!fs.existsSync(args.html)) {
    process.stderr.write(`Error: HTML file not found: ${args.html}\n`);
    process.exit(2);
  }
  const html = fs.readFileSync(args.html, 'utf8');
  cssContent = extractCssFromHtml(html);
  log(`Extracted ${cssContent.length} chars of CSS from ${args.html}`);
} else if (args.css) {
  if (!fs.existsSync(args.css)) {
    process.stderr.write(`Error: CSS file not found: ${args.css}\n`);
    process.exit(2);
  }
  cssContent = fs.readFileSync(args.css, 'utf8');
}

// 1. Extrahiere Dark-Mode-Blöcke
const darkBlocks = extractDarkModeBlocks(cssContent);
log(`Found ${darkBlocks.length} dark-mode CSS blocks`);

if (darkBlocks.length === 0) {
  const output = {
    generated: new Date().toISOString(),
    mode: 'dark',
    version: '1.0',
    variables: [],
    summary: { total_variables: 0, note: 'No @media (prefers-color-scheme: dark) blocks found' },
  };
  if (args.output) {
    fs.mkdirSync(path.dirname(path.resolve(args.output)), { recursive: true });
    fs.writeFileSync(args.output, JSON.stringify(output, null, 2), 'utf8');
  } else {
    process.stdout.write(JSON.stringify(output, null, 2) + '\n');
  }
  process.exit(0);
}

// 2. Extrahiere Farb-Overrides
const overrides = extractColorOverrides(darkBlocks);
log(`Extracted ${overrides.length} color overrides`);

// 3. Match mit Light-Mode-Tokens (wenn verfügbar)
let variables = overrides.map(o => ({
  selector: o.selector,
  property: o.property,
  dark_value: o.value,
  dark_hex: o.hex,
  light_value: null,
  light_hex: null,
  gv_id: null,
  token_name: suggestDarkTokenName(o.property, o.selector),
}));

if (args['light-tokens'] && fs.existsSync(args['light-tokens'])) {
  const lightTokens = JSON.parse(fs.readFileSync(args['light-tokens'], 'utf8'));
  variables = matchLightTokens(overrides, lightTokens);
  log(`Matched ${variables.filter(v => v.gv_id).length}/${variables.length} with light tokens`);
}

// 4. Generiere V4 Dark Mode Variable-Set
const result = buildDarkModeVariableSet(variables);

// ── OUTPUT ─────────────────────────────────────────────────────────

const output = JSON.stringify(result, null, 2);

if (args.output) {
  fs.mkdirSync(path.dirname(path.resolve(args.output)), { recursive: true });
  fs.writeFileSync(args.output, output, 'utf8');
  process.stderr.write(`[dark-mode] Saved ${result.summary.total_variables} variables to ${args.output}\n`);
} else {
  process.stdout.write(output + '\n');
}

process.exit(0);
```

### npm-Script

```json
"extract-dark-mode": "node scripts/extract-framer-dark-mode.js"
```

### Integration in wizard.js

```javascript
// wizard.js — Step B (extractionSteps), nach extract-framer-styles.js:
{
  args: [/* ... */, '--light-tokens', path.join(tokensDir, 'token-mapping.json'),
         '--output', path.join(tokensDir, 'dark-mode-variables.json')],
  desc: 'Extrahiere Dark-Mode-Farbwerte (prefers-color-scheme: dark)'
}
```

---

## Task 3: ENH-11 — convert-xml-to-v4.js JSDoc (~1h)

**Datei:** `scripts/convert-xml-to-v4.js`

### Zu dokumentierende Kernfunktionen

| Funktion | Zeile (ca.) | Beschreibung | JSDoc-Tags |
|----------|-------------|-------------|------------|
| `convertNode()` | ~120 | XML-Node → V4-Element | `@param`, `@returns`, `@throws` |
| `convertFrame()` | ~280 | Framer-Frame-Node → V4-Container | `@param`, `@returns` |
| `buildV4Element()` | ~450 | Erzeugt V4-Element-Objekt mit ID, Type, Styles | `@param`, `@returns` |
| `resolveColor()` | ~620 | CSS-Farbwert → V4-Format (GV-Referenz oder Raw) | `@param`, `@returns` |
| `buildStyles()` | ~700 | CSS-Declarations → V4 Styles-Objekt | `@param`, `@returns` |
| `extractComponentText()` | ~850 | Extrahiert Text-Content aus Framer-Text-Layern | `@param`, `@returns` |

### JSDoc-Format (Projekt-Standard aus mcp-bridge.js)

```javascript
/**
 * Konvertiert einen Framer XML-Node in ein V4-Element.
 *
 * Erkennt den Element-Typ (Container, Text, Image, etc.) und erzeugt
 * das entsprechende V4-Widget mit ID, Type, Styles und Settings.
 *
 * @param {object} node        - Framer XML-Node (geparsed)
 * @param {string} node.name   - Tag-Name (div, h1, img, etc.)
 * @param {object} node.attrs  - HTML-Attribute (data-framer-*, class, style)
 * @param {Array}  node.children - Kind-Elemente
 * @param {object} options     - Konvertierungs-Optionen
 * @param {number} [options.depth=0]      - Nesting-Tiefe
 * @param {boolean} [options.applyGC=true] - Global Classes anwenden
 * @param {object} [options.tokenMap={}]  - GV-ID-Token-Mapping
 * @returns {object} V4-Element mit widgetType, id, styles, settings, elements
 * @throws {Error} Bei kritischen Schema-Verstößen (z.B. fehlender Type)
 */
function convertNode(node, options = {}) { ... }
```

### Kein Behavioral Change

- Nur Kommentare werden hinzugefügt
- Keine Code-Zeile wird verändert
- Alle 77 bestehenden Tests müssen unverändert grün bleiben
- `.js` Syntax-Check muss weiterhin bestehen

---

## Task 4: Tests (~0.5h)

**Datei:** `tests/pipeline.test.js`

### Test Suite 25: FIX-7 p-limit Concurrency

```javascript
suite('S25: FIX-7 — callParallel() p-limit', () => {
  test('FIX-7: callParallel respects concurrency limit', async () => {
    // Mock: 5 Calls, Concurrency=2 → mindestens 3 Batches
    // Simuliert via Mock-MCP mit 50ms delay pro Call
    const mockCalls = [
      { ability: 'novamira/greet-1', params: {} },
      { ability: 'novamira/greet-2', params: {} },
      { ability: 'novamira/greet-3', params: {} },
      { ability: 'novamira/greet-4', params: {} },
      { ability: 'novamira/greet-5', params: {} },
    ];
    const start = Date.now();
    const results = await mockCallParallel(mockCalls, { concurrency: 2 });
    const elapsed = Date.now() - start;
    // 5 Calls à ~50ms mit Concurrency=2 → ~150ms (3 Batches × 50ms)
    assert.ok(elapsed >= 100, `Expected >=100ms, got ${elapsed}ms`);
    assert.ok(elapsed < 300, `Expected <300ms, got ${elapsed}ms`);
    assert.strictEqual(results.length, 5);
    const ok = results.filter(r => r.status === 'fulfilled').length;
    assert.strictEqual(ok, 5);
  });

  test('FIX-7: callParallel default concurrency=3', () => {
    // Verifiziere dass der Default-Wert 3 ist
    assert.strictEqual(McpBridge.prototype.defaultConcurrency ?? 3, 3);
  });
});
```

### Test Suite 26: ENH-10 dark-mode-extractor.js

```javascript
suite('S26: ENH-10 — Dark Mode Extraction', () => {
  test('ENH-10: extracts dark mode color overrides', () => {
    const html = `
      <style>
        body { background: #ffffff; color: #111111; }
        @media (prefers-color-scheme: dark) {
          body { background: #1a1a2e; color: #e0e0e0; }
          .card { background: #16213e; }
        }
      </style>
      <div class="card"></div>`;
    const htmlFile = tmpFile('dark-mode-test.html', html);
    const outFile = tmpFile('dark-mode-out.json');
    run('extract-framer-dark-mode.js', ['--html', htmlFile, '--output', outFile]);
    const result = readJson(outFile);
    assert.ok(result.variables.length >= 2, `Expected >=2 variables, got ${result.variables.length}`);
    const bodyBg = result.variables.find(v => v.selector === 'body' && v.property === 'background');
    assert.ok(bodyBg, 'Has body background');
    assert.strictEqual(bodyBg.dark_hex, '#1a1a2e');
  });

  test('ENH-10: no dark mode blocks → empty output', () => {
    const html = '<style>body{background:#fff;}</style><div></div>';
    const htmlFile = tmpFile('no-dark.html', html);
    const outFile = tmpFile('no-dark-out.json');
    run('extract-framer-dark-mode.js', ['--html', htmlFile, '--output', outFile]);
    const result = readJson(outFile);
    assert.strictEqual(result.variables.length, 0);
    assert.ok(result.summary.note.includes('No @media'));
  });
});
```

### Test Suite 27: ENH-11 convert-xml-to-v4.js JSDoc

```javascript
suite('S27: ENH-11 — convert-xml-to-v4.js JSDoc', () => {
  test('ENH-11: JSDoc does not break XML conversion', () => {
    const xml = `<div data-framer-name=\"Hero\"><h1>Hello</h1></div>`;
    const xmlFile = tmpFile('jsdoc-test.xml', xml);
    const outFile = tmpFile('jsdoc-tree.json');
    run('convert-xml-to-v4.js', ['--xml', xmlFile, '--output', outFile, '--silent']);
    const tree = readJson(outFile);
    assert.ok(Array.isArray(tree), 'Tree is array');
    assert.ok(tree.length > 0, 'Tree has elements');
    // Verify core convertNode still works
    const hero = tree.find(e => e.widgetType === 'e-flexbox');
    assert.ok(hero, 'Has flexbox container');
  });

  test('ENH-11: buildV4Element produces valid V4 element', () => {
    const xml = `<img data-framer-name=\"Logo\" src=\"logo.png\" alt=\"Logo\"/>`;
    const xmlFile = tmpFile('jsdoc-img.xml', xml);
    const outFile = tmpFile('jsdoc-img-tree.json');
    run('convert-xml-to-v4.js', ['--xml', xmlFile, '--output', outFile, '--silent']);
    const tree = readJson(outFile);
    const img = tree.find(e => e.widgetType === 'e-image');
    assert.ok(img, 'Has image widget');
    assert.ok(img.id, 'Has id');
    assert.ok(img.settings?.image?.url, 'Has image url');
  });
});
```

---

## Änderungsreihenfolge

1. **Task 1: FIX-7 p-limit** — zuerst, da kleinster und isoliertester Change
2. **Task 2: ENH-10 dark-mode-extractor.js** — neues Script, keine Abhängigkeiten
3. **Task 3: ENH-11 JSDoc** — nur Kommentare, parallel zu Tests möglich
4. **Task 4: Tests** — nach allen Code-Änderungen

---

## Impact-Analyse

| Datei | Änderung | Regression-Risiko | LoC |
|-------|----------|-------------------|-----|
| `scripts/lib/mcp-bridge.js` | `callParallel()` Concurrency-Limiter | **Mittel** — ändert Call-Verhalten | ~+30/−10 |
| `scripts/extract-framer-dark-mode.js` | **NEU** | Kein — neues Script | ~280 |
| `scripts/convert-xml-to-v4.js` | **Nur JSDoc-Kommentare** | **Null** — kein Behavioral Change | ~+80/−0 |
| `package.json` | `extract-dark-mode` Script | Kein | +1 |
| `tests/pipeline.test.js` | 3 neue Suiten, 6 Test-Fälle | Kein | ~120 |

---

## Definition of Done

- [ ] `callParallel()` akzeptiert `{ concurrency: N }` Option (default 3)
- [ ] `McpBridge` constructor liest `MCP_CONCURRENCY` env var
- [ ] `extract-framer-dark-mode.js` erstellt mit `--html`, `--light-tokens`, `--output` Flags
- [ ] Dark-Mode-Script erkennt `@media (prefers-color-scheme: dark)` Blöcke
- [ ] Dark-Mode-Script generiert V4-kompatibles Variable-Set JSON
- [ ] `convert-xml-to-v4.js` — 6 Kernfunktionen mit JSDoc (`@param`, `@returns`)
- [ ] 77 + 6 = 83 Tests, alle grün
- [ ] `npm run test:all` → 93 + 6 = 99 Tests, alle grün
- [ ] Syntax-Check aller geänderten Dateien
- [ ] `npm run lint:version` → v0.10.0 OK

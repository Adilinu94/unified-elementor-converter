# PLAN.md — Phase 7: Sprint 7 — Quality Hardening

> **Phase:** 7 | **Sprint:** 7 | **Geschätzt:** ~3h
> **Erstellt:** 2026-06-13 | **Quelle:** Codebase-Scan (3 P1/P2-Lücken)

## Ziel

Drei verbleibende Qualitätslücken schließen, die beim Codebase-Scan nach Sprint 6 identifiziert wurden:

1. **`--format markdown` in dark-mode-extractor.js**: In `--help` beworben, aber Parser ignoriert das Flag — Output ist immer JSON
2. **Wizard sub-commands `--help` vereinheitlichen**: Nur `cmd-preflight.js` hat `--help`. `cmd-dry-run`, `cmd-preview`, `cmd-promote`, `cmd-serve`, `cmd-batch` haben keinen
3. **`token_name` Eindeutigkeit in dark-mode-extractor.js**: Bei Property-Overrides mit gleichem base+selector kollidieren Token-Namen

---

## Requirements (NEU für Sprint 7)

### FIX-10: `--format markdown` in dark-mode-extractor.js
- **ID:** `FIX-10`
- **Beschreibung:** Das `--format` Flag wird zwar per `parseArgs` akzeptiert, aber der Output-Code (`writeOutput()`) ignoriert es komplett und gibt immer JSON aus. Die `--help` Ausgabe bewirbt `--format json|markdown`, was falsche Erwartungen weckt.
- **Datei:** `scripts/extract-framer-dark-mode.js`
- **Akzeptanz:** `--format markdown` produziert eine Markdown-Tabelle der Dark-Mode-Variablen. `--format json` (default) bleibt unverändert.
- **Test:** `--format markdown` → Output enthält `| token_name | selector | property |`

### FIX-11: Wizard sub-commands `--help` vereinheitlichen
- **ID:** `FIX-11`
- **Beschreibung:** 5 von 6 Wizard-Subcommands (`cmd-dry-run`, `cmd-preview`, `cmd-promote`, `cmd-serve`, `cmd-batch`) haben keine `--help`-Unterstützung. Nur `cmd-preflight.js` hat einen Hilfe-Block. Jedes Subcommand soll einen konsistenten `--help` Block im gleichen Format bekommen.
- **Dateien:** `scripts/wizard/cmd-dry-run.js`, `cmd-preview.js`, `cmd-promote.js`, `cmd-serve.js`, `cmd-batch.js`
- **Akzeptanz:** `node wizard.js dry-run --help` zeigt Usage + Flags. Gleiches Format wie `cmd-preflight.js --help`.
- **Test:** `run('wizard.js', ['dry-run', '--help'])` → exit 0, output enthält `Usage`

### FIX-12: `token_name` Eindeutigkeit in dark-mode-extractor.js
- **ID:** `FIX-12`
- **Beschreibung:** `suggestDarkTokenName()` generiert Namen nach Pattern `dark-{base}-{selector}` (z.B. `dark-surface-card`). Wenn zwei verschiedene Dark-Mode-Blöcke denselben Selector und denselben Property-Typ haben, kollidieren die Token-Namen. Der Fix: `-${property}` Suffix anhängen.
- **Datei:** `scripts/extract-framer-dark-mode.js`
- **Akzeptanz:** Zwei Overrides für `body { background, color }` → `dark-surface-body-background` und `dark-text-body-color` (nicht `dark-surface-body` und `dark-text-body`)
- **Test:** Zwei Overrides mit gleichem Selector → unterschiedliche token_names

---

## Task 1: FIX-10 — `--format markdown` in dark-mode-extractor.js (~30min)

**Datei:** `scripts/extract-framer-dark-mode.js`

### IST-Zustand

```javascript
// Zeile 76-85 — format wird geparsed aber ignoriert
const { values: args } = parseArgs({
  options: {
    // ...
    format: { type: 'string', default: 'json' },
    // ...
  },
});

// Zeile 461-473 — writeOutput() ignoriert args.format komplett
function writeOutput(data) {
  const output = JSON.stringify(data, null, 2);
  // immer JSON — kein markdown-Pfad
}
```

### SOLL-Zustand

`writeOutput()` wird um einen Markdown-Formatierer erweitert. Der Markdown-Output ist eine lesbare Tabelle, nützlich für Docs und Agent-Übersicht.

```javascript
/**
 * Schreibt das Ergebnis als JSON oder Markdown in die Output-Datei oder stdout.
 *
 * @param {object} data - Ergebnis-JSON
 */
function writeOutput(data) {
  const fmt = (args.format || 'json').toLowerCase();
  let output;

  if (fmt === 'markdown' || fmt === 'md') {
    output = formatMarkdown(data);
  } else {
    output = JSON.stringify(data, null, 2);
  }

  if (args.output) {
    fs.mkdirSync(path.dirname(path.resolve(args.output)), { recursive: true });
    fs.writeFileSync(args.output, output, 'utf8');
    process.stderr.write(
      `[dark-mode] Saved ${data.summary?.total_variables || 0} variables to ${args.output}\n`
    );
  } else {
    process.stdout.write(output + '\n');
  }
}

/**
 * Formatiert das Dark-Mode-Variable-Set als Markdown-Tabelle.
 *
 * @param {object} data - Variable-Set JSON
 * @returns {string} Markdown-formatierter Output
 */
function formatMarkdown(data) {
  const lines = [];
  lines.push('# Dark Mode Variables');
  lines.push('');
  lines.push(`> Generated: ${data.generated}`);
  lines.push(`> Mode: ${data.mode}`);
  lines.push(`> Variables: ${data.summary?.total_variables || 0}`);
  if (data.summary?.matched_with_light_tokens !== undefined) {
    lines.push(`> Matched with Light: ${data.summary.matched_with_light_tokens}`);
  }
  lines.push('');

  if (!data.variables || data.variables.length === 0) {
    lines.push('_No dark mode variables found._');
    return lines.join('\n');
  }

  lines.push('| token_name | selector | property | dark_value | dark_hex | light_value | gv_id |');
  lines.push('|------------|----------|----------|------------|----------|-------------|-------|');

  for (const v of data.variables) {
    const token = v.token_name || '-';
    const sel = (v.selector || '-').replace(/\|/g, '\\|');
    const prop = v.property || '-';
    const darkVal = (v.dark_value || '-').replace(/\|/g, '\\|');
    const darkHex = v.dark_hex || '-';
    const lightVal = (v.light_mapping?.light_value || '-').replace(/\|/g, '\\|');
    const gvId = v.light_mapping?.gv_id || '-';
    lines.push(`| ${token} | ${sel} | ${prop} | ${darkVal} | ${darkHex} | ${lightVal} | ${gvId} |`);
  }

  lines.push('');
  lines.push('## MCP Routing');
  lines.push('');
  lines.push(`- **Ability:** \`${data.mcpRouting?.ability || 'N/A'}\``);
  lines.push(`- **Note:** ${data.mcpRouting?.note || 'N/A'}`);

  return lines.join('\n');
}
```

---

## Task 2: FIX-11 — Wizard sub-commands `--help` vereinheitlichen (~1h)

**Dateien:** `scripts/wizard/cmd-dry-run.js`, `cmd-preview.js`, `cmd-promote.js`, `cmd-serve.js`, `cmd-batch.js`, `cmd-preflight.js`

### Problem

- `cmd-preflight.js`: Hat bereits `formatJson` Parameter (via `wizard.js preflight --format=json`), aber kein direkter `--help` Mechanismus innerhalb des Moduls
- `cmd-dry-run.js`, `cmd-preview.js`, `cmd-promote.js`, `cmd-serve.js`, `cmd-batch.js`: Kein `--help` Block, keine Parameter-Validierung mit hilfreicher Fehlermeldung

### Lösung

Jedes Subcommand-Modul exportiert eine `printHelp()`-Funktion. `wizard.js` ruft sie auf wenn `wizard.js <sub> --help` oder `wizard.js help <sub>`.

**Pattern (pro Subcommand):**

```javascript
/**
 * Gibt die Hilfe für dieses Subcommand aus.
 */
export function printHelp() {
  console.log(`wizard.js dry-run — Build-Plan ohne Schreibzugriff

USAGE:
  node wizard.js dry-run --pages <files> [--post-ids <ids>]

OPTIONS:
  --pages <files>     Komma-separierte XML/HTML-Dateien
  --post-ids <ids>    Komma-separierte Post-IDs (optional)

BEISPIEL:
  node wizard.js dry-run --pages exports/home.xml,exports/about.xml
`);
}
```

**wizard.js Dispatch-Update:**

```javascript
// wizard.js — Zeile ~400, nach sub-command parsing:
if (args.help || sub === 'help') {
  if (targetSub && cmdModules[targetSub]?.printHelp) {
    cmdModules[targetSub].printHelp();
  } else if (cmdModules[sub]?.printHelp) {
    cmdModules[sub].printHelp();
  } else {
    showHelp(); // allgemeine Hilfe
  }
  process.exit(0);
}
```

**Hilfe-Inhalte pro Subcommand:**

| Subcommand | Usage | Flags | Beschreibung |
|------------|-------|-------|-------------|
| `preflight` | `wizard.js preflight [--format=json]` | `--format json` | 8 System-Checks vor Build-Start |
| `dry-run` | `wizard.js dry-run --pages <files>` | `--pages`, `--post-ids` | Build-Plan ohne Schreibzugriff |
| `preview` | `wizard.js preview --post-id <ID>` | `--post-id` | Preview-Page von bestehender Seite |
| `promote` | `wizard.js promote --preview-id <ID> --target-id <ID>` | `--preview-id`, `--target-id` | Preview → Live übernehmen |
| `serve` | `wizard.js serve [--port <N>]` | `--port` (default: 3099) | HTTP-API Server starten |
| `batch` | `wizard.js batch --pages <files> [--post-ids <ids>]` | `--pages`, `--post-ids` | Multi-Page Batch-Build |

---

## Task 3: FIX-12 — `token_name` Eindeutigkeit (~30min)

**Datei:** `scripts/extract-framer-dark-mode.js`

### Problem

```javascript
// Zeile 321-332
function suggestDarkTokenName(property, selector) {
  const isBg = property.includes('background');
  const isText = property === 'color';
  const base = isBg ? 'surface' : isText ? 'text' : 'color';
  const cleanSelector = selector
    .replace(/[.#\[\]:>\s,]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 30);
  return `dark-${base}-${cleanSelector}`;
  // Problem: dark-surface-body (background) vs dark-surface-body (auch background,
  //          aber anderer Wert) → identischer Name!
}
```

Das Problem tritt auf wenn:
- Gleicher Selector + gleicher Property-Typ (`background`) → beide bekommen `dark-surface-body`
- Die Token-Namen sind dann nicht mehr unterscheidbar

### Lösung

Property-Name als Suffix anhängen. Das macht die Namen auch semantisch aussagekräftiger.

```javascript
/**
 * Schlägt einen semantischen Dark-Mode-Token-Namen vor.
 *
 * Pattern: dark-{type}-{selector}-{property}
 *   type = surface (background), text (color), color (andere)
 *
 * @param {string} property - CSS-Property
 * @param {string} selector - CSS-Selector
 * @returns {string} Semantischer Token-Name
 */
function suggestDarkTokenName(property, selector) {
  const isBg = property.includes('background');
  const isText = property === 'color';
  const base = isBg ? 'surface' : isText ? 'text' : 'color';
  const cleanSelector = selector
    .replace(/[.#\[\]:>\s,]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 24); // gekürzt wegen property-Suffix
  const cleanProperty = property.replace(/--/, '').replace(/[^a-z0-9-]/gi, '-').slice(0, 16);
  return `dark-${base}-${cleanSelector}-${cleanProperty}`;
}
```

**Beispiele:**

| Selector | Property | Vorher | Nachher |
|----------|----------|--------|---------|
| `body` | `background` | `dark-surface-body` | `dark-surface-body-background` |
| `body` | `color` | `dark-text-body` | `dark-text-body-color` |
| `.card` | `background-color` | `dark-surface-card` | `dark-surface-card-background-color` |
| `.card` | `border-color` | `dark-color-card` | `dark-color-card-border-color` |

---

## Task 4: Tests (~30min)

**Datei:** `tests/pipeline.test.js`

### Test Suite 31: FIX-10 — `--format markdown`

```javascript
suite('S31: FIX-10 — dark-mode --format markdown', () => {
  test('FIX-10: --format markdown produces table', () => {
    const html = `
      <style>
        @media (prefers-color-scheme: dark) {
          body { background: #1a1a2e; color: #e0e0e0; }
        }
      </style>`;
    const htmlFile = tmpFile('fmt-md.html', html);
    const outFile = tmpFile('fmt-md-out.md');
    run('extract-framer-dark-mode.js', [
      '--html', htmlFile,
      '--format', 'markdown',
      '--output', outFile,
    ]);
    const content = fs.readFileSync(outFile, 'utf8');
    assert.ok(content.includes('| token_name | selector | property |'),
      'Contains markdown table header');
    assert.ok(content.includes('# Dark Mode Variables'),
      'Contains markdown heading');
    assert.ok(content.includes('dark-surface-body'),
      'Contains token names');
  });

  test('FIX-10: --format json is default', () => {
    const html = '<style>@media (prefers-color-scheme: dark) { body { background: #111; } }</style>';
    const htmlFile = tmpFile('fmt-json.html', html);
    const outFile = tmpFile('fmt-json-out.json');
    run('extract-framer-dark-mode.js', ['--html', htmlFile, '--output', outFile]);
    const result = readJson(outFile);
    assert.ok(result.variables, 'JSON output has variables array');
    assert.ok(Array.isArray(result.variables));
  });
});
```

### Test Suite 32: FIX-11 — Wizard `--help`

```javascript
suite('S32: FIX-11 — Wizard sub-commands --help', () => {
  const subcommands = ['preflight', 'dry-run', 'preview', 'promote', 'serve', 'batch'];

  for (const sub of subcommands) {
    test(`FIX-11: wizard.js ${sub} --help shows usage`, () => {
      const result = runFromRoot('wizard.js', [sub, '--help']);
      assert.ok(result.includes('wizard.js'), `${sub} help mentions wizard.js`);
      assert.ok(result.length > 50, `${sub} help has substantial content`);
    });
  }

  test('FIX-11: wizard.js help <sub> works', () => {
    const result = runFromRoot('wizard.js', ['help', 'batch']);
    assert.ok(result.includes('batch'), 'help batch mentions batch');
    assert.ok(result.includes('--pages'), 'help batch mentions --pages');
  });
});
```

### Test Suite 33: FIX-12 — `token_name` Eindeutigkeit

```javascript
suite('S33: FIX-12 — token_name uniqueness', () => {
  test('FIX-12: different properties get different token_names', () => {
    const html = `
      <style>
        @media (prefers-color-scheme: dark) {
          body { background: #1a1a2e; color: #e0e0e0; }
        }
      </style>`;
    const htmlFile = tmpFile('token-uniq.html', html);
    const outFile = tmpFile('token-uniq-out.json');
    run('extract-framer-dark-mode.js', ['--html', htmlFile, '--output', outFile]);
    const result = readJson(outFile);

    const bg = result.variables.find(v => v.property.includes('background'));
    const text = result.variables.find(v => v.property === 'color');

    assert.ok(bg, 'Has background variable');
    assert.ok(text, 'Has text color variable');
    assert.notStrictEqual(bg.token_name, text.token_name,
      `Token names differ: "${bg.token_name}" vs "${text.token_name}"`);
  });

  test('FIX-12: token_name includes property suffix', () => {
    const html = `
      <style>
        @media (prefers-color-scheme: dark) {
          .card { background-color: #16213e; }
        }
      </style>`;
    const htmlFile = tmpFile('token-suffix.html', html);
    const outFile = tmpFile('token-suffix-out.json');
    run('extract-framer-dark-mode.js', ['--html', htmlFile, '--output', outFile]);
    const result = readJson(outFile);

    assert.ok(result.variables.length > 0, 'Has at least one variable');
    const v = result.variables[0];
    assert.ok(v.token_name.includes('background-color'),
      `Token name "${v.token_name}" includes property name`);
  });
});
```

---

## Änderungsreihenfolge

1. **Task 1: FIX-10 `--format markdown`** — isoliert, keine Abhängigkeiten
2. **Task 2: FIX-11 Wizard `--help`** — kann parallel zu Task 1 laufen
3. **Task 3: FIX-12 `token_name`** — kann parallel zu Task 1+2 laufen
4. **Task 4: Tests** — nach allen Code-Änderungen

---

## Impact-Analyse

| Datei | Änderung | Regression-Risiko | Δ LoC |
|-------|----------|-------------------|-------|
| `scripts/extract-framer-dark-mode.js` | `writeOutput()` Markdown-Pfad + `suggestDarkTokenName()` property-Suffix | **Niedrig** — neuer Code-Pfad, bestehender JSON-Pfad unverändert | ~+50/−5 |
| `scripts/wizard/cmd-preflight.js` | `printHelp()` export hinzufügen | **Niedrig** — neue Export-Funktion, kein Behavioral Change | ~+20 |
| `scripts/wizard/cmd-dry-run.js` | `printHelp()` export + Fehlermeldungen verbessern | **Niedrig** | ~+25 |
| `scripts/wizard/cmd-preview.js` | `printHelp()` export | **Niedrig** | ~+20 |
| `scripts/wizard/cmd-promote.js` | `printHelp()` export | **Niedrig** | ~+20 |
| `scripts/wizard/cmd-serve.js` | `printHelp()` export | **Niedrig** | ~+20 |
| `scripts/wizard/cmd-batch.js` | `printHelp()` export | **Niedrig** | ~+25 |
| `wizard.js` | `--help`/`help <sub>` dispatch | **Niedrig** — neuer Code-Pfad | ~+15 |
| `tests/pipeline.test.js` | 3 neue Suiten, 6 Test-Fälle | Kein | ~+120 |

---

## Definition of Done

- [ ] `extract-framer-dark-mode.js --format markdown` produziert Markdown-Tabelle
- [ ] `extract-framer-dark-mode.js --format json` (default) unverändert
- [ ] Alle 6 Wizard-Subcommands haben `printHelp()` Export
- [ ] `wizard.js <sub> --help` zeigt subcommand-spezifische Hilfe
- [ ] `wizard.js help <sub>` funktioniert als Alias
- [ ] `suggestDarkTokenName()` hängt `-${property}` Suffix an
- [ ] Zwei Overrides mit gleichem Selector → unterschiedliche token_names
- [ ] 88 + 6 = 94 Tests, alle grün
- [ ] Syntax-Check aller geänderten Dateien
- [ ] `npm run lint:version` → v0.11.0 OK

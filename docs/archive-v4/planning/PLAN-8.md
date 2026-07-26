# PLAN.md — Phase 9: Sprint 9 — Performance, A11y & FramerExport

> **Phase:** 9 | **Sprint:** 9 | **Geschätzt:** ~12h
> **Erstellt:** 2026-06-14 | **Quelle:** novamira-improvement-2026-06/report.md (47 Findings)

## Ziel

Die Pipeline von "funktional" auf "produktionsreif" heben: Performance messen, A11y-Validierung integrieren, und den ersten echten FramerExport-Durchlauf durchführen.

1. **Performance Profiling**: Pipeline-Laufzeit messen, Bottlenecks identifizieren, `Diagnostics::record()` erweitern
2. **A11y Hardening**: axe-core in visual-qa.js verankern, WCAG 2.2-Update, A11y-CI-Schritt
3. **FramerExport Integration**: FramerExport CLI installieren, ersten echten End-to-End-Durchlauf
4. **Security Quick-Wins**: Filename-Sanitization, File-Type-Validation im Media-Upload

---

## Requirements (NEU für Sprint 9)

### ENH-14: Pipeline Performance Profiler

- **ID:** `ENH-14`
- **Beschreibung:** Ein neues Script `scripts/profile-pipeline.js` misst die Laufzeit jedes Pipeline-Schritts (FramerExport, Extraktion, Konvertierung, Validierung) und gibt einen `pipeline-profile.json` Report aus. `--bottleneck` Flag identifiziert die 3 langsamsten Schritte.
- **Akzeptanz:** Profiler läuft auf existierendem v4-tree.json und produziert Zeitmessungen pro Phase. ROADMAP.md wird mit realen Laufzeiten aktualisiert.
- **Test:** Profiler auf Test-Tree mit 100+ Elementen → valider JSON-Report mit ≥5 Phasen

### ENH-15: axe-core A11y Integration

- **ID:** `ENH-15`
- **Beschreibung:** `visual-qa.js` um axe-core A11y-Audit erweitern. Bestehende `@axe-core/playwright` Dependency nutzen. Output: `a11y-report.json` mit WCAG 2.0/2.1/2.2 Violations.
- **Akzeptanz:** `visual-qa.js --a11y` produziert A11y-Report. axe-core scannt alle Breakpoints.
- **Test:** HTML mit bekannten A11y-Issues → Report enthält violations mit rule IDs

### FIX-15: WCAG 2.2 Update in V4_Color_Contrast

- **ID:** `FIX-15`
- **Beschreibung:** `class-v4-color-contrast-22.php` (existiert) auf korrekte WCAG 2.2 Konstanten prüfen. Target Size (2.5.8) und Focus Appearance (2.4.11) Thresholds validieren.
- **Akzeptanz:** Plugin-Tests bestätigen WCAG 2.2 Compliance. Keine harten 2.1-Only Konstanten.
- **Test:** PHPUnit-Test mit bekannten Farbpaaren → correct pass/fail nach 2.2

### FIX-16: Media Filename Sanitization

- **ID:** `FIX-16`
- **Beschreibung:** `class-media-upload.php`: `filename` Input mit `sanitize_file_name()` bereinigen. Whitelist für erlaubte Extensions (jpg, png, gif, svg, webp, pdf).
- **Akzeptanz:** `../../../etc/passwd.jpg` → `etc-passwd.jpg`. `evil.php` → rejected.
- **Test:** PHPUnit-Test mit Path-Traversal und verbotenen Extensions

### FIX-17: Media File-Type Validation

- **ID:** `FIX-17`
- **Beschreibung:** `class-media-upload.php`: Base64-Content gegen deklarierte Extension mit `finfo_buffer()` validieren. MIME-Type-Spoofing verhindern.
- **Akzeptanz:** `image/png` Content als `.jpg` → rejected. Echter PNG-Content als `.png` → accepted.
- **Test:** PHPUnit mit gespooftem und echtem Content

### ENH-16: FramerExport CLI Integration

- **ID:** `ENH-16`
- **Beschreibung:** FramerExport CLI (`@anthropic/framer-export` oder lokales Repo) in `tools/framer-export/` installieren. Ersten echten End-to-End-Durchlauf mit `wizard.js --non-interactive`.
- **Akzeptanz:** `wizard.js --non-interactive --url https://stupendous-football-158496.framer.app/` läuft von Phase 0 bis D ohne Abbruch. V4 Tree valide.
- **Test:** E2E-Test mit echter Framer-URL → v4-tree.json valide laut `validate-v4-tree.js`

---

## Task 1: ENH-14 — Pipeline Performance Profiler (~2h)

**Datei:** `scripts/profile-pipeline.js` (NEU)

### Script-Design

```
pipeline-profile.js <v4-tree.json> [--bottleneck]
│
├── 1. Token-Extraktion: misst Zeit für design-token-extractor.js
├── 2. Konvertierung: misst Zeit für convert-xml-to-v4.js
├── 3. Auto-Scaling: misst Zeit für auto-scale-responsive.js
├── 4. GC-Generierung: misst Zeit für generate-global-classes.js
├── 5. Media-Patching: misst Zeit für patch-v4-tree-media-ids.js
├── 6. Validierung: misst Zeit für validate-v4-tree.js
├── 7. Quality-Metrics: misst Zeit für measure-quality-metrics.js
│
└── pipeline-profile.json
    { phases: [{name, duration_ms, status}], total_ms, bottleneck: [...] }
```

### npm-Script

```json
"profile-pipeline": "node scripts/profile-pipeline.js"
```

---

## Task 2: ENH-15 — axe-core A11y Integration (~3h)

**Dateien:** `scripts/visual-qa.js` (Erweiterung)

### Vorgehen

1. `--a11y` Flag in visual-qa.js
2. `@axe-core/playwright` bereits als devDependency installiert
3. Nach visuellem Screenshot: `page.evaluate()` mit axe-core vanilla → `a11y-report.json`
4. Output-Struktur: `{ url, timestamp, violations: [{ id, impact, description, nodes }], passes, incomplete }`

### npm-Script

```json
"visual-qa-a11y": "node scripts/visual-qa.js --a11y"
```

---

## Task 3: FIX-15 — WCAG 2.2 Update (~1h)

**Datei:** `includes/helpers/class-v4-color-contrast-22.php` (novamira-adrianv2 Plugin)

### Vorgehen

1. Prüfen: Sind die 2.2-Konstanten korrekt?
2. Target Size 2.5.8: minimum 24×24px target area
3. Focus Appearance 2.4.11: minimum 2px thick, contrast ratio ≥3:1
4. PHPUnit-Test mit Testfällen

---

## Task 4: FIX-16 — Media Filename Sanitization (~1h)

**Datei:** `includes/abilities/media/class-media-upload.php`

### Vorgehen

1. `sanitize_file_name($filename)` vor Verarbeitung
2. Whitelist-Check: `in_array($ext, ['jpg','jpeg','png','gif','svg','webp','pdf'])`
3. Fehlerbehandlung: `wp_die()` bei invalider Extension

---

## Task 5: FIX-17 — Media File-Type Validation (~1h)

**Datei:** `includes/abilities/media/class-media-upload.php`

### Vorgehen

1. `finfo_buffer(finfo_open(FILEINFO_MIME_TYPE), base64_decode($content))`
2. Vergleich mit Extension-MIME-Map
3. Reject bei Mismatch

---

## Task 6: ENH-16 — FramerExport CLI & Echter E2E-Test (~3h)

**Dateien:** `tools/framer-export/` (Installation), `tests/e2e.test.js` (Erweiterung)

### Vorgehen

1. FramerExport CLI installieren (npm oder git clone)
2. `wizard.js --non-interactive --url https://stupendous-football-158496.framer.app/`
3. Pipeline-Durchlauf validieren (alle Phasen)
4. Output: valider v4-tree.json + quality-report.json
5. E2E-Test S14 in tests/e2e.test.js

---

## Task 7: Tests (~1h)

**Dateien:** `tests/pipeline.test.js` (S35), `tests/e2e.test.js` (S14)

### S35: ENH-14 — Pipeline Profiler

```javascript
describe('S35: ENH-14 — Pipeline Profiler', () => {
  test('ENH-14: profiles pipeline phases with timing', () => {
    const reportOut = tmpFile('s35-profile.json');
    run('profile-pipeline.js', [treeFile, '--output', reportOut]);
    const report = readJson(reportOut);
    assert.ok(report.phases.length >= 5, 'At least 5 phases profiled');
    assert.ok(typeof report.total_ms === 'number', 'Has total_ms');
  });

  test('ENH-14: --bottleneck identifies slowest phases', () => {
    const { stdout } = run('profile-pipeline.js', [treeFile, '--bottleneck']);
    assert.ok(stdout.includes('bottleneck') || stdout.includes('slowest'), 'Shows bottlenecks');
  });
});
```

---

## Änderungsreihenfolge

1. **Task 4+5: FIX-16/17** — Plugin-Security (unabhängig, parallel zu anderem)
2. **Task 1: ENH-14 profile-pipeline.js** — isoliertes neues Script
3. **Task 2: ENH-15 visual-qa --a11y** — hängt von axe-core dep ab (bereits installiert)
4. **Task 3: FIX-15 WCAG 2.2** — Plugin-Update
5. **Task 6: ENH-16 FramerExport** — hängt von CLI-Installation ab
6. **Task 7: Tests** — nach allen Code-Änderungen

---

## Impact-Analyse

| Datei | Änderung | Regression-Risiko | Δ LoC |
|-------|----------|-------------------|-------|
| `scripts/profile-pipeline.js` | **NEU** | Kein | ~180 |
| `scripts/visual-qa.js` | --a11y Flag + axe-core | **Niedrig** (opt-in) | ~+60 |
| `class-media-upload.php` | sanitize_file_name + finfo | **Niedrig** (additiv) | ~+30 |
| `class-v4-color-contrast-22.php` | WCAG 2.2 Prüfung | **Niedrig** | ~+20 |
| `tools/framer-export/` | **Installation** | Kein | — |
| `tests/e2e.test.js` | S14 (2 Tests) | Kein | ~+40 |
| `tests/pipeline.test.js` | S35 (2 Tests) | Kein | ~+50 |
| Plugin PHPUnit | 2 neue Tests | Kein | ~+40 |

---

## Definition of Done

- [ ] `profile-pipeline.js` erstellt mit 7 Phasen-Timing + `--bottleneck` Flag
- [ ] `visual-qa.js --a11y` produziert `a11y-report.json` mit WCAG Violations
- [ ] `class-media-upload.php`: Filename-Sanitization + File-Type-Validation
- [ ] `class-v4-color-contrast-22.php`: WCAG 2.2 Compliance bestätigt
- [ ] FramerExport CLI installiert und funktionsfähig
- [ ] `wizard.js --non-interactive` läuft mit echter Framer-URL durch
- [ ] Pipeline-Tests: 105→107 (+2 S35)
- [ ] E2E-Tests: 15→17 (+2 S14)
- [ ] `npm run test:all` → 129 Tests, alle grün
- [ ] `npm run lint:version` → v0.13.0 OK

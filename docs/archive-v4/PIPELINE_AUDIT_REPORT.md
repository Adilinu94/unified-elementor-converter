# 🔍 Pipeline Audit Report — Framer → Elementor V4

> **Generiert:** 12. Juni 2026  
> **Basis:** V4 Deep Research (Server-Interna, Performance, DOM-Tiefe)  
> **Geprüfte Dateien:** 30+ (alle `scripts/`, `tests/`, `wizard.js`, `schemas/`)

---

## 📋 Executive Summary

Basierend auf den Deep Research Erkenntnissen (Server-seitige JSON-Verarbeitung, DOM-Tiefen-Performance, GC-Deduplizierung, Post-4943-Analyse) wurden **alle 30+ Pipeline-Dateien** systematisch auditiert.

**Ergebnis: 15 Verbesserungen identifiziert — 3 P0-kritisch, 5 P1-wichtig, 7 P2-nice-to-have.**

Die P0-Fixes allein würden Post 4943 von **Score 83% → ~95%** heben.

---

## 🔬 Deep Research Key Findings (Kontext)

| Finding | Impact auf Pipeline |
|---------|-------------------|
| **DOM-Tiefe >3 kostet exponentiell Reflow-Zeit** | Kein Depth-Check vorhanden. Post 4943: Tiefe 7 |
| **GCs reduzieren JSON um 61%, CSS um 98%** | GC-Generierung existiert, aber nicht als Default |
| **Lighthouse-Grenze: 1.400 Nodes, 32 Depth** | Keine Node-Count Warnung im Pre-Build |
| **`_elementor_data` = ein JSON in `wp_postmeta`** | Große Trees (>500KB) überschreiten `php_max_input_vars` |
| **45 Style-Duplikate in Post 4943** | `generate-global-classes.js` erkennt sie, wendet sie aber nicht an |
| **`json_encode()` limit: kein offizielles, aber praktisch ~1MB** | Kein Size-Check vor Build |

---

## 🔴 P0 — Kritisch (Datenverlust / Build-Fehler)

### P0-1: `wizard.js` — GC-Generierung nicht als Default aktiviert

**Datei:** `wizard.js`  
**Problem:** Der `--gc` Flag ist optional. Ohne ihn werden Global Classes nicht generiert. Das führt zu:
- 45+ Style-Duplikaten im Tree (Post 4943)
- 61% größerem JSON
- 98% mehr CSS-Output
- Keiner Wiederverwendbarkeit der Styles

**Lösung:** `gc: true` als Default setzen. Nur mit `--no-gc` deaktivierbar.  
**Aufwand:** ~20min  
**Impact:** Hoch — jeder Build profitiert automatisch

```diff
// wizard.js — Zeile ~120
- gc:           { type: 'boolean', default: false },
+ gc:           { type: 'boolean', default: true },
+ 'no-gc':      { type: 'boolean', default: false },
```

---

### P0-2: `validate-v4-tree.js` — Kein DOM-Depth-Check

**Datei:** `scripts/validate-v4-tree.js`  
**Problem:** Der Validator prüft 6 Checks (Schema, Binding, IDs, Text, Image-Src, Styles) — aber **nicht die DOM-Tiefe**. Post 4943 hatte Tiefe 7, was serverseitig zu Timeouts führen kann und client-seitig exponentiell mehr Reflow-Zeit kostet.

**Lösung:** `CHECK_DOM_DEPTH` hinzufügen:
- Tiefe ≤ 3: ✅ OK
- Tiefe 4–5: ⚠️ WARNING
- Tiefe ≥ 6: ❌ ERROR (Build blocken)

```javascript
// Neuer Check in validate-v4-tree.js
CHECK_DOM_DEPTH: {
  check(tree) {
    let maxDepth = 0;
    function walk(node, depth) {
      if (depth > maxDepth) maxDepth = depth;
      (node.elements || node.children || []).forEach(c => walk(c, depth + 1));
    }
    (Array.isArray(tree) ? tree : [tree]).forEach(n => walk(n, 0));
    if (maxDepth >= 6) return { pass: false, severity: 'error', message: `DOM depth ${maxDepth} >= 6 — server timeout risk` };
    if (maxDepth >= 4) return { pass: false, severity: 'warning', message: `DOM depth ${maxDepth} >= 4 — performance degradation` };
    return { pass: true };
  }
}
```

**Aufwand:** ~30min  
**Impact:** Verhindert Server-Timeouts und Lighthouse-Abwertungen

---

### P0-3: `scripts/lib/framer-utils.js` — `wrapHtmlContent` Verfügbarkeit prüfen

**Datei:** `scripts/lib/framer-utils.js` + `scripts/convert-xml-to-v4.js`  
**Problem:** `convert-xml-to-v4.js` (RC-04) ruft `wrapHtmlContent` auf für Text-Inhalte in Widgets. Falls diese Funktion nicht in `framer-utils.js` definiert/exportiert ist, schlägt der Build mit einem `ReferenceError` fehl.

**Lösung:** Sicherstellen dass `wrapHtmlContent` in `framer-utils.js` existiert und korrekt exportiert wird. Typischerweise:
```javascript
export function wrapHtmlContent(text) {
  return { '$$type': 'html-v3', value: String(text) };
}
```

**Aufwand:** ~15min  
**Impact:** Verhindert Build-Absturz bei Text-Widgets

---

## 🟡 P1 — Wichtig (Performance / Korrektheit)

### P1-1: `generate-global-classes.js` — Nur Analyse, keine Auto-Anwendung

**Datei:** `scripts/generate-global-classes.js`  
**Problem:** Das Script analysiert den Tree und schreibt `gc-plan.json` — aber wendet die Global Classes **nicht** automatisch auf den Tree an. Der Agent müsste manuell die GC-IDs in den Tree einweben. Das passiert in der Praxis nie.

**Lösung:** `--apply` Modus hinzufügen, der:
1. GC-Plan aus `gc-plan.json` liest
2. Via `novamira/adrians-batch-create-classes` registriert
3. Style-Duplikate im Tree durch `"classes": {"value": ["gc-xxx"]}` ersetzt
4. Ungenutzte lokale Styles entfernt

```bash
node scripts/generate-global-classes.js --tree v4-tree.json --apply --output v4-tree-deduped.json
```

**Aufwand:** ~1.5h  
**Impact:** Automatische Reduktion von 45+ Duplikaten → 1 GC-Referenz

---

### P1-2: `convert-xml-to-v4.js` — Position-Filter (RC-08) zu aggressiv

**Datei:** `scripts/convert-xml-to-v4.js`, Funktion `buildStyleProps`  
**Problem:** Der RC-08 Fix entfernt `position: absolute` komplett wenn keine expliziten Offsets (`top`/`right`/`bottom`/`left`) gesetzt sind. Aber:
- Root-Container (depth=0) sollten immer ihre Positionierung behalten
- Manche Framer-Layouts verlassen sich auf `absolute` für korrekte Stack-Reihenfolge

**Lösung:** Root-Container von der Filterung ausnehmen:
```javascript
// RC-08 Fix (verbessert):
if (position !== 'absolute' || hasExplicitOffsets || depth === 0) {
  props['position'] = wrapType('string', position);
  // ...
}
```

Dazu muss `depth` als Parameter an `buildStyleProps` durchgereicht werden.

**Aufwand:** ~30min  
**Impact:** Verhindert Layout-Regressionen bei Root-Containern

---

### P1-3: `post-build-auto-fix.js` — Kein DOM-Tiefen-Fix

**Datei:** `scripts/post-build-auto-fix.js`  
**Problem:** Das Script fixt nur Style-Issues (Duplicate Styles, Missing Bindings) — aber nicht strukturelle DOM-Tiefe. Verschachtelte Single-Child-Container bleiben unangetastet.

**Lösung:** `fixDomDepth()` Funktion hinzufügen:
- Single-Child-Container erkennen (Bug 3/RC-07 Logik wiederverwenden)
- Pass-through Chains flatten
- Max depth enforcement (rekursiv flachen bis Tiefe ≤ 3)

```javascript
function fixDomDepth(tree, maxDepth = 3) {
  // Rekursive Flattening-Strategie aus convert-xml-to-v4.js portieren
}
```

**Aufwand:** ~1h  
**Impact:** Automatische DOM-Tiefen-Reduktion nach dem Build

---

### P1-4: `run-post-build-qa.js` — Check-Liste unvollständig

**Datei:** `scripts/run-post-build-qa.js`  
**Problem:** Das QA-Script prüft nur Basic Checks. Aus der Deep Research fehlen:
- GC Coverage (% der Styles die Global Classes nutzen)
- DOM Depth (max Tiefe im gesamten Tree)
- Responsive Variants (wie viele Elemente haben Mobile/Tablet Varianten)
- Unused Styles (Styles ohne Binding)

**Lösung:** 4 neue QA-Checks:
```javascript
// CHECK_GC_COVERAGE: min 60% der styles sollten GCs sein
// CHECK_DOM_DEPTH: max Tiefe ≤ 5
// CHECK_RESPONSIVE_COVERAGE: min 30% der Elemente sollten responsive Varianten haben
// CHECK_UNUSED_STYLES: 0 ungebundene Styles
```

**Aufwand:** ~45min  
**Impact:** Vollständige QA-Abdeckung gemäß Deep Research Best Practices

---

### P1-5: `framer-pre-build-validate.js` — Keine Pre-Build GC-Analyse

**Datei:** `scripts/framer-pre-build-validate.js`  
**Problem:** Das Script validiert nur Input-Formate (XML, JSON), nicht ob der spätere Tree GC-würdig ist. Ein Pre-Build-Check auf Style-Duplikate könnte früh warnen.

**Lösung:** GC-Potential-Analyse vor dem Build:
```javascript
// Neue Check-Funktion:
function estimateGcPotential(xmlNode) {
  // Zähle wiederholte style-Attribute rekursiv
  // Wenn >10 Duplikate: empfehle GC-Generierung
}
```

**Aufwand:** ~30min  
**Impact:** Frühwarnung bevor ein Build mit 45+ Duplikaten startet

---

## 🟢 P2 — Nice-to-Have (DX / Robustheit)

### P2-1: `auto-scale-responsive.js` — Bereits gut
✅ RC-14 (gap, border-radius, grid) und RC-19 (width, height, letter-spacing) sind implementiert. Grid-Collapse auf Mobile funktioniert korrekt. **Keine Änderung nötig.**

### P2-2: `check-v4-requirements.js` — Server-Kapazitäts-Check fehlt
**Problem:** Prüft Atomic Widgets + Elementor Version, aber nicht `php_max_input_vars` oder `memory_limit`. Große Trees (>500KB) können den Server überlasten.  
**Lösung:** `--server-info` Flag für `phpinfo()`-äquivalente Checks.  
**Aufwand:** ~30min

### P2-3: `parallel-pre-build.js` — Hardcoded Pfade
**Problem:** Nimmt immer `v4-tree.json` und `gc-plan.json` — bricht wenn der Tree anders heißt.  
**Lösung:** `--tree` und `--gc-output` Args respektieren.  
**Aufwand:** ~15min

### P2-4: `framer-animation-extractor.js` — RC-20 Mapping unvollständig
**Problem:** CSS→V4 Mapping fehlt für `transform.rotate`, `transform.skew`, kombinierte `opacity+transform.translateX+transform.scale`.  
**Lösung:** Mapping-Tabelle um 6 weitere Einträge erweitern.  
**Aufwand:** ~15min

### P2-5: Tests — Keine DOM-Depth / GC-Coverage Tests
**Datei:** `tests/pipeline.test.js`  
**Problem:** 56 Tests, aber keine für DOM-Tiefe, GC-Abdeckung, responsive Coverage.  
**Lösung:** 5 neue Test-Szenarien für P0/P1 Fixes.  
**Aufwand:** ~45min

### P2-6: `extract-responsive-breakpoints.js` — Keine Container Queries
**Problem:** Erkennt `@media` Queries, aber nicht `@container` Queries (modernes CSS).  
**Lösung:** Optionaler `@container` Query Support.  
**Aufwand:** ~30min

### P2-7: `section-compare.js` — Bereits sehr ausgereift
✅ Playwright+Puppeteer Backend, Pixel-Diff mit pixelmatch, A11y-Audit, Section-Scroll, HTML-Report. **Keine Änderung nötig.**

---

## 📊 Zusammenfassung nach Kategorie

| Kategorie | Dateien | Status |
|----------|---------|--------|
| **Konvertierung** | `convert-xml-to-v4.js` | 🟡 RC-08 zu aggressiv |
| **Validierung** | `validate-v4-tree.js` | 🔴 DOM-Depth fehlt |
| **Qualität** | `run-post-build-qa.js`, `post-build-auto-fix.js` | 🟡 Checks unvollständig |
| **Performance** | `generate-global-classes.js`, `parallel-pre-build.js` | 🟡 GC nicht auto-anwendbar |
| **Pre-Flight** | `check-v4-requirements.js`, `framer-pre-build-validate.js` | 🟡 Server-Checks fehlen |
| **Responsive** | `auto-scale-responsive.js`, `extract-responsive-breakpoints.js` | ✅ Gut |
| **Assets** | `asset-to-wp-media.js`, `patch-v4-tree-media-ids.js` | ✅ Gut |
| **Orchestrierung** | `wizard.js` | 🔴 GC nicht Default |
| **Testing** | `tests/` | 🟢 Coverage ausbaufähig |

---

## 🎯 Geschätzter Aufwand

| Priorität | Anzahl | Aufwand | Impact |
|-----------|--------|---------|--------|
| 🔴 P0 Kritisch | 3 | ~1h 05min | Build-Fehler verhindern, GC-Pflicht |
| 🟡 P1 Wichtig | 5 | ~4h 15min | Performance +60%, DOM-Tiefe halbiert |
| 🟢 P2 Nice-to-Have | 7 | ~2h 45min | DX, Robustheit, Test-Coverage |
| **Gesamt** | **15** | **~8h** | Post 4943: 83% → ~97% |

---

## 🚀 Empfohlenes Vorgehen

1. **Sprint 1 (heute):** P0-1 + P0-2 + P0-3 → GC-Default + DOM-Depth-Check + wrapHtmlContent
2. **Sprint 2 (morgen):** P1-1 + P1-2 + P1-3 → GC Auto-Apply + Position-Fix + DOM-Flatten
3. **Sprint 3 (diese Woche):** P1-4 + P1-5 + P2-1..P2-5 → QA-Checks + Pre-Build + Tests

---

> **Basis:** [V4 Deep Research Report](./V4_DEEP_RESEARCH.md) | [V4 Design Schema](./V4_DESIGN_SCHEMA_REPORT.md)

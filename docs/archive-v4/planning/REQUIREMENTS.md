# Requirements — framer-v4-pipeline-v2

> **Definiert:** 2026-06-13 | **Quelle:** V4_DESIGN_IMPROVEMENTS_RESEARCH.md (v2)
> **Update:** 2026-06-13 — Sprint 7 Quality Hardening abgeschlossen
> **Core Value:** Token-effizienter, stabiler Framer→V4-Workflow

---

## v1 Requirements (Sprint 1) ✅ Complete

### ENHANCEMENT-1: Strict Grid Mapping
- **ID:** `ENH-1`
- **Beschreibung:** RC-09 Grid-Erkennung von Child-Count-Heuristik auf echtes CSS-Grid-Parsing (`display: grid`, `grid-template-*`) upgraden
- **Datei:** `scripts/convert-xml-to-v4.js`
- **Akzeptanz:** Grid-Container mit `display:grid` oder `grid-template-columns` werden als `e-div-block` erkannt
- **Test:** Grid-Element in `pipeline.test.js` mit explizitem CSS-Grid → erwartet `e-div-block`

### ENHANCEMENT-2: Semantic GC Naming
- **ID:** `ENH-2`
- **Beschreibung:** GC-Namen von `gc-bg-1` auf BEM/Semantic (`gc-surface-primary`, `gc-text-lg`) umstellen
- **Datei:** `scripts/generate-global-classes.js`
- **Akzeptanz:** GC-Name enthält Typ-Präfix + Token-Identifier + Size-Modifier
- **Test:** `suggestNameSemantic()` mit Style-Props → expected output validieren

### ENHANCEMENT-3: Breakpoint-bewusstes Scaling
- **ID:** `ENH-3`
- **Beschreibung:** `auto-scale-responsive.js` liest `tokens/responsive-breakpoints.json` statt Hardcode-Faktoren (0.75/0.6) zu nutzen
- **Datei:** `scripts/auto-scale-responsive.js`
- **Abhängigkeit:** `extract-responsive-breakpoints.js` Output (existiert bereits)
- **Akzeptanz:** Element-spezifische Breakpoint-Faktoren werden aus `breakpoints.json` geladen
- **Test:** Mock `breakpoints.json` → erwartete Scale-Faktoren pro Element

### ENHANCEMENT-4: Token-zu-GV-Substitution (Root-Cause Fix)
- **ID:** `ENH-4`
- **Beschreibung:** Neuer Pass ersetzt Hardcoded-Hex-Werte im v4-tree durch `e-gv-XXXXXXX` Referenzen aus `token-mapping.json`
- **Datei:** `scripts/convert-xml-to-v4.js` (neuer Pass) oder eigenes Script
- **Abhängigkeit:** `design-token-extractor.js` (existiert), `token-mapping.json` mit gv_ids
- **Akzeptanz:** Nach Substitution enthalten 0 Styles Hardcoded-Hex — alle Farben referenzieren GVs
- **Test:** `#111111` → `e-gv-abc123` Substitution in Pipeline-Test

### VALIDATION-1: GRID_VS_FLEXBOX_COVERAGE
- **ID:** `VAL-1`
- **Beschreibung:** Neuer Check in `validate-v4-tree.js` — erkennt `e-flexbox` Container mit Grid-Charakteristiken
- **Datei:** `scripts/validate-v4-tree.js`
- **Akzeptanz:** Container mit `flex-wrap:wrap` oder ≥4 Kindern werden als Grid-Kandidaten gemeldet
- **Test:** Flexbox mit `flex-wrap:wrap` → Warning im Validator-Output

---

## v2 Requirements (Sprint 2) ✅ Complete

### SCRIPT-1: extract-framer-components.js
- **ID:** `SCR-1`
- **Beschreibung:** Framer Component-Definitionen in V4 Atomic Component JSON übersetzen
- **Output:** `components/<name>.json`
- **Test:** Wiederholte Card-Struktur → Component-Definition extrahiert

### SCRIPT-2: extract-framer-interactions.js
- **ID:** `SCR-2`
- **Beschreibung:** Framer Scroll/Trigger-Animationen → V4 Pro Interactions (native JSON, kein GSAP)
- **Output:** `interactions-plan.json`
- **Test:** `data-framer-appear-id` → V4-native Interaction-JSON

### ENHANCEMENT-5: Component Preservation
- **ID:** `ENH-5`
- **Beschreibung:** `e-component` Marker in `convert-xml-to-v4.js` erkennen und als Component-Widget ausgeben
- **Abhängigkeit:** SCR-1 (Component-Extraktion)
- **Test:** Component-Referenz → `e-component` Widget mit Properties

### ENHANCEMENT-6: V4-Native Animation Routing
- **ID:** `ENH-6`
- **Beschreibung:** Easing-Map korrigieren (Elementor-Namen statt GSAP) + Route zu `edit-interaction` statt GSAP-Injection
- **Datei:** `scripts/framer-animation-extractor.js`
- **Test:** CSS `ease-out` → `ease-out` (nicht `power2.out`)

### INTEGRATION-1: Existing Abilities Pipeline-Integration
- **ID:** `INT-1`
- **Beschreibung:** `create-component`, `insert-component`, `edit-interaction` via McpBridge routen (kein neues PHP)
- **Test:** MCP-Call Parameter-Mapping validieren

### VALIDATION-2: COMPONENT_REUSE_POTENTIAL
- **ID:** `VAL-2`
- **Beschreibung:** Duplizierte Element-Gruppen erkennen, die als Component ausgelagert werden sollten
- **Test:** 3 identische Card-Strukturen → Warning

---

## v3 Requirements (Sprint 3) ✅ Complete

### SCRIPT-3: extract-framer-forms.js
- **ID:** `SCR-3`
- **Beschreibung:** Framer Formulare → V4 Atomic Forms (Label + Input + Submit als Einzelelemente)
- **Output:** `form-plan.json`
- **Test:** `<input>` mit Label → Atomic Form Struktur

### ABILITY-1: create-atomic-form
- **ID:** `ABL-1`
- **Beschreibung:** Granulare V4 Atomic Form erstellen (einzige neue PHP-Ability)
- **Parameter:** `post_id`, `form.action`, `form.fields[]`
- **Validierung:** Widget-Types gegen `V4_DESIGN_SCHEMA_REPORT.md` prüfen

### VALIDATION-3: NATIVE_INTERACTION_COVERAGE
- **ID:** `VAL-3`
- **Beschreibung:** GSAP-Injection vermeiden, wenn V4-native Interaktionen möglich sind
- **Flag:** `--animation-plan` für Zugriff auf `animation-plan.json`
- **Test:** GSAP-Animation die als V4-native mappbar ist → Warning

---

## Out of Scope

| Feature | Grund |
|---------|-------|
| Loop Grid Support | Kein Framer-Pendant in aktuellen Designs |
| Motion Effects API | V4-API noch nicht stabil |
| A4 `map-framer-breakpoints.js` | Ersetzt durch ENH-3 (Enhancement statt neuem Script) |
| B1–B3 als neue PHP-Abilities | Existieren bereits im `novamira-adrianv2` Plugin |

---

## v4 Requirements (Sprint 4) ✅ Complete

### ENHANCEMENT-7: C3 Native Routing Completion
- **ID:** `ENH-7`
- **Beschreibung:** `framer-animation-extractor.js` — `--native` Flag: V4-native Interaction-JSON statt GSAP-Code. `mapEasingToGSAP` → `mapEasingToElementor` umbenannt. MCP-Routing zu `edit-interaction`.
- **Datei:** `scripts/framer-animation-extractor.js`
- **Akzeptanz:** Mit `--native` produziert der Output `v4_interactions` Objekte (Typ `v4-native`) ohne GSAP `code` Strings
- **Test:** `--native` Flag → Output enthält `v4_interactions[]` ohne `code`-Strings

### ENHANCEMENT-8: structuralHash in framer-utils.js
- **ID:** `ENH-8`
- **Beschreibung:** `structuralHash()` einmalig in `framer-utils.js` definieren (mit `includeTag`, `nullOnSmall`, `short` Optionen), in A1 und D1 importieren statt lokaler Doppel-Definition.
- **Dateien:** `scripts/lib/framer-utils.js`, `scripts/extract-framer-components.js`, `scripts/validate-v4-tree.js`
- **Akzeptanz:** Keine doppelte `structuralHash`-Definition mehr. Beide Scripts importieren aus `framer-utils.js`.
- **Test:** A1 und D1 Tests bestehen unverändert mit gemeinsamem Import

### ENHANCEMENT-9: A2 v4-tree Mode Implementation
- **ID:** `ENH-9`
- **Beschreibung:** `extract-framer-interactions.js` `--v4-tree` Flag: Walked den V4 Tree, erkennt Elemente mit opacity/transform Styles, generiert V4-native interaction Objekte.
- **Datei:** `scripts/extract-framer-interactions.js`
- **Akzeptanz:** `--v4-tree v4-tree.json` erzeugt `interactions[]` mit V4-native JSON
- **Test:** V4 Tree mit opacity-Styles → erwartete interaction im Output

---

## v5 Requirements (Sprint 5) ✅ Complete

### FIX-7: callParallel() Concurrency-Limit
- **ID:** `FIX-7`
- **Beschreibung:** `McpBridge.callParallel()` Worker-Pool mit konfigurierbarem Concurrency-Limit (default 3). Verhindert Race-Conditions und PHP-Timeout bei 10+ parallelen Requests gegen lokale WP-Instanzen.
- **Datei:** `scripts/lib/mcp-bridge.js`
- **Akzeptanz:** `callParallel()` mit `{ concurrency: N }` Option. `McpBridge.defaultConcurrency` via Constructor + `MCP_CONCURRENCY` env var.
- **Test:** `defaultConcurrency === 3`, constructor override

### ENHANCEMENT-10: dark-mode-extractor.js
- **ID:** `ENH-10`
- **Beschreibung:** Extrahiert `@media (prefers-color-scheme: dark)` CSS-Blöcke aus Framer-HTML. Generiert V4 Dark Mode Variable-Set JSON mit Light-Token-Matching.
- **Datei:** `scripts/extract-framer-dark-mode.js` (NEU)
- **Output:** `tokens/dark-mode-variables.json`
- **Technik:** Brace-Counting statt Regex-Lookahead (nested-rule-safe)
- **Test:** CSS mit `@media (prefers-color-scheme: dark)` → extrahierte Overrides im Output

### ENHANCEMENT-11: convert-xml-to-v4.js JSDoc

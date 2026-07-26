# Cross-Reference Analyse: ki-2-elementor-master → Umbau Pipeline

**Datum:** 15. Juni 2026
**Ziel:** Identifikation von Lücken, Verbesserungen und übernehmbaren Artefakten

---

## 1. Executive Summary

Das `ki-2-elementor-master` Repo ist unserem Projekt in mehreren kritischen Bereichen **deutlich voraus** — insbesondere bei Skills, Design-Token-Management und dem Dual-Source-Ansatz. Es enthält konkrete Lösungen für 6 unserer 8 identifizierten Pipeline-Lücken. Gleichzeitig hat unser Projekt Stärken im Wizard, Animationen und E2E-Testing, die ki-2-elementor nicht hat.

**Empfehlung:** Die beiden Repos sollten zusammengeführt oder mindestens synchronisiert werden.

---

## 2. Was ki-2-elementor hat, das UNS FEHLT

### 2A. Skills (DER GRÖSSTE UNTERSCHIED)

| ki-2-elementor Skill | Adressiert unsere Lücke | Wert |
|---|---|---|
| **`framer-dual-source-to-v4`** | 🔴 L1, L2, L3, L4, L7 | **DER GOLDSTANDARD** — Kombiniert Unframer MCP + FramerExport für CSS-Werte. Löst ALLE unsere Style-Lücken |
| **`client-design-token-setup-protocol`** | 🔴 L6 | Vollständiges Protokoll: Variables → Classes → Tokens in 5 Phasen |
| **`elementor-v4-build-checklist`** | 🟡 L8 | 12-Guard Pre-Build-Check, verhindert dass fehlerhafte Trees deployed werden |
| **`elementor-v4-visual-qa`** | 🟡 L8 | Browser-basierte visuelle QA mit Screenshot-Vergleich via `agent-browser` |
| **`framer-token-validator`** | 🔴 L1, L2 | Validiert Token-Mappings (Farben, Fonts) gegen echte GV-IDs |
| **`global-class-pattern-analyzer`** | 🔴 L6 | Analysiert Style-Patterns und schlägt Global Classes vor |
| **`framer-responsive-extractor`** | 🟡 L7 | Extrahiert Responsive-Daten aus CSS/HTML und erzeugt V4-Varianten |
| **`elementor-v4-style-property-quick-reference`** | 🔴 L3 | Referenz für alle 30 Style-Properties mit korrektem $$type-Format |
| **`screenshot-to-elementor`** | 🟡 L8 | Screenshot → V4 Build Workflow |
| **`elementor-v4-error-recovery`** | 🟡 - | Systematische Fehlerbehebung nach Build-Fehlern |
| **`elementor-v4-grid-layout`** | 🟡 L7 | Grid-Layout-Muster und Best Practices |
| **`elementor-v4-section-snippets`** | 🟡 - | Fertige Code-Snippets für häufige Layouts |
| **`framer-dependency-graph`** | - | Build-Order für Komponenten via Kahn's Algorithm |
| **`design-system-reference`** | 🔴 L6 | Referenz für Design-System-Aufbau |
| **`novamira-skills-index`** | - | Vollständiger Index aller Novamira-Skills |
| **`handoff`** | - | Strukturierte Übergabe zwischen Agenten |

**Fazit:** ki-2-elementor hat 36 Skills, wir haben 7. 15 davon adressieren direkt unsere Lücken.

### 2B. Scripts

| ki-2-elementor Script | Fehlt uns? | Nutzen |
|---|---|---|
| `audit-variable-consistency.js` | ✅ JA | Prüft ob alle referenzierten GV-IDs existieren |
| `check-binding-after-patch.js` | ✅ JA | Validiert Class-Variable-Bindings nach Patches |
| `download-and-map-images.js` | ✅ JA | Lädt Bilder herunter und mappt sie |
| `upload-and-map-images.js` | ✅ JA | Lädt Bilder in WP Media Library hoch |
| `upload-fonts-to-wp.js` | ✅ JA | Lädt Fonts in WordPress hoch |
| `validate-token-mapping.js` | ✅ JA | Validiert Token-Mappings gegen Live-GV-IDs |
| `framer-html-to-elementor.js` | ✅ JA | Konvertiert Framer HTML direkt zu Elementor |

### 2C. Abilities (PHP für Novamira MCP)

| ki-2-elementor Ability | Nutzen |
|---|---|
| `adrians-auto-fix.php` | Automatische Fehlerbehebung nach Pre-Build-Validation |
| `adrians-batch-media-upload.php` | Batch-Upload von Medien |
| `adrians-pre-build-validate.php` | Server-seitige Pre-Build-Validierung |

### 2D. Dokumentation

| ki-2-elementor Doc | Wert |
|---|---|
| `CLAUDE.md` | **Exzellentes** Master-Agent-Instruction-Manual mit Golden Rules |
| `FRAMER-ONBOARDING.md` | Vollständiger 7-Phasen Framer-Workflow |
| `SPEC-framer-to-elementor-v4.md` | Python-Pipeline-Spezifikation mit 7 kritischen Bugs + 5 Invarianten |
| `ELEMENTOR-V4-EXPERTISE.md` | Tiefgehende V4-Architektur-Referenz |
| `ENTWICKLUNGSLEITFADEN.md` | Entwicklungsleitfaden für neue Abilities |

---

## 3. Was WIR haben, das ki-2-elementor FEHLT

| Unser Asset | Kategorie | Wert |
|---|---|---|
| **`wizard.js` + `wizard/`** | Orchestrierung | Vollständiger interaktiver Pipeline-Wizard mit Caching, Recovery und Non-Interactive-Mode |
| **`extract-framer-components.js`** | Extraktion | Extrahiert Framer-Komponenten aus HTML-Export |
| **`extract-framer-dark-mode.js`** | Extraktion | Dark-Mode-Extraktion |
| **`extract-framer-forms.js`** | Extraktion | Formular-Extraktion |
| **`extract-framer-interactions.js`** | Extraktion | Interaktions-Extraktion |
| **`framer-animation-extractor.js`** | Animation | Extrahiert Framer-Animationen |
| **`inject-animation-code.js`** | Animation | Injiziert Animationen via MCP (Batch-Mode) |
| **`visual-qa.js`** | QA | Visuelle QA |
| **`section-compare.js`** | QA | Abschnittsweiser Vergleich |
| **`post-build-auto-fix.js`** | QA | Automatische Post-Build-Korrekturen |
| **`deduplicate-visual-qa.js`** | QA | Deduplizierte visuelle QA |
| **`measure-quality-metrics.js`** | QA | Qualitätsmetriken |
| **`run-post-build-qa.js`** | QA | Post-Build-QA-Runner |
| **`lint-test-count.js`** | DX | Automatischer Test-Zähler-Lint |
| **`parallel-pre-build.js`** | Performance | Parallele Pre-Build-Schritte |
| **`profile-pipeline.js`** | Performance | Pipeline-Profiling |
| **`E2E-FEHLERPROTOKOLL.md`** | Doku | Systematisches Fehlerprotokoll (gerade erstellt) |
| **E2E-Tests (18 Tests)** | Test | Umfangreiche E2E-Testsuite |
| **128 Pipeline-Tests** | Test | Große Unit-Testsuite |
| **`mcp-cache.js`** | Performance | MCP-Caching mit TTL |

---

## 4. Die 5 wichtigsten Erkenntnisse

### Erkenntnis 1: DER DUAL-SOURCE-ANSATZ LÖST 6 UNSERER 8 LÜCKEN

```
Statt:  Unframer MCP allein → keine CSS-Werte
Besser: Unframer MCP (Struktur) + FramerExport (CSS/Assets) → vollständiger Build
```

Das `framer-dual-source-to-v4` Skill beschreibt exakt diesen Workflow — inklusive Cross-Validation, Token-Mapping und Pixel-Referenz-Server.

### Erkenntnis 2: Skills sind der Schlüssel zur Qualität

ki-2-elementor hat 36 spezialisierte Skills, die den Agenten durch JEDEN Schritt führen. Unser Projekt hat fast keine Skills für den kritischen Pfad (CSS-Extraktion, Token-Setup, visuelle QA).

### Erkenntnis 3: Es gibt eine Python-Pipeline als Alternative

Die `SPEC-framer-to-elementor-v4.md` beschreibt eine **Python-basierte** Pipeline (`framer_to_elementor.py`, `v4_converter.py`, `framer_pipeline.py`), die möglicherweise robuster ist als unser Node.js-Ansatz. Sie hat bereits 7 kritische Bugs dokumentiert und behoben.

### Erkenntnis 4: CLAUDE.md ist das bessere AGENTS.md

Das `CLAUDE.md` in ki-2-elementor ist ein vollständiges Master-Manual mit:
- Golden Rules (Skill-First, Global Classes mandatory, Patch > Rebuild)
- Kategorisierten Ability-Katalog
- Quick-Reference für CLI-Commands
- Workflow-spezifischen Anweisungen (Framer-ZIP, V3→V4, Bulk)

### Erkenntnis 5: Unsere Stärken liegen woanders

Unser Projekt ist stärker bei:
- **Orchestrierung** (Wizard mit Caching, Recovery)
- **Animationen** (Extractor + Injector)
- **Testing** (128 Unit-Tests + 18 E2E-Tests)
- **Performance** (Parallelisierung, Profiling, Caching)

---

## 5. Konkrete Übernahme-Empfehlungen

### SOFORT übernehmbar (niedriger Aufwand)

| Artefakt | Aufwand | Impact |
|---|---|---|
| `elementor-v4-build-checklist` Skill | 5 min | 🔴 Verhindert fehlerhafte Deployments |
| `elementor-v4-style-property-quick-reference` Skill | 5 min | 🔴 Korrekte $$type-Formate |
| `CLAUDE.md` als Vorlage für unser AGENTS.md | 30 min | 🔴 Bessere Agenten-Steuerung |
| `client-design-token-setup-protocol` Skill | 5 min | 🔴 Design-System von Grund auf |
| `validate-token-mapping.js` Script | 10 min | 🔴 Token-Validierung |
| `upload-fonts-to-wp.js` Script | 10 min | 🟡 Font-Upload |
| `upload-and-map-images.js` Script | 10 min | 🟡 Bild-Upload |

### MITTELFRISTIG übernehmbar (Aufwand 1-3 Tage)

| Artefakt | Nutzen |
|---|---|
| **Dual-Source-Workflow integrieren** | Löst L1-L4+L6+L7 — CSS-Werte aus FramerExport extrahieren |
| `framer-dual-source-to-v4` Skill + alle referenzierten Scripts | Kompletter qualitativer Build |
| `framer-token-validator` Skill | Validierung vor dem Build |
| `elementor-v4-visual-qa` Skill + `agent-browser` | Screenshot-Vergleich |
| `framer-responsive-extractor` für CSS-Parsing | Responsive Breakpoints |

### LANGFRISTIG evaluieren

| Artefakt | Begründung |
|---|---|
| Python-Pipeline (`framer_to_elementor.py`) | Könnte robuster sein als Node.js — evaluieren |
| `adrians-auto-fix.php` Ability | Automatische Fehlerkorrektur Server-seitig |
| `adrians-pre-build-validate.php` Ability | Server-seitige Pre-Build-Validierung |

---

## 6. Konkreter Verbesserungsplan für unser Projekt

### Phase 1: Skills übernehmen (heute machbar)
- [ ] `elementor-v4-build-checklist` → `novamira-skill/`
- [ ] `elementor-v4-style-property-quick-reference` → `novamira-skill/`
- [ ] `client-design-token-setup-protocol` → `novamira-skill/`
- [ ] `framer-responsive-extractor` → `novamira-skill/`

### Phase 2: Dual-Source-Workflow implementieren
- [ ] `cross-validate-sources.js` Integration in Wizard
- [ ] FramerExport-CSS-Extraktion VOR convert-xml-to-v4.js
- [ ] Token-Mapping aus CSS befüllen und an `--tokens` übergeben
- [ ] `validate-token-mapping.js` als Pre-Build-Guard

### Phase 3: Build-Qualität
- [ ] `framer-pre-build-validate.js` mit 85%-Score-Gate
- [ ] `upload-fonts-to-wp.js` für Font-Enqueuing
- [ ] `elementor-v4-visual-qa` für Screenshot-Vergleich

### Phase 4: Agenten verbessern
- [ ] `CLAUDE.md`-ähnliches Master-Manual
- [ ] Skills-Index für automatische Skill-Erkennung

---

## 7. Was die Python-Pipeline besser macht

Laut `SPEC-framer-to-elementor-v4.md` hat die Python-Variante:

1. **Typed AST**: Explizite Typisierung jedes Properties mit `$$type`
2. **7 dokumentierte Bugs** mit Fixes (inkl. Subtitle-Downgrade, Border-Radius-Struktur)
3. **5 architektonische Invarianten** die Stabilität garantieren
4. **Live-Modus** (`--live`) für direkte MCP-Integration
5. **`.elements.json` + `.variables.json` + `.global_classes.json`** als getrennte Outputs statt einem monolithischen Tree

Das sind Ideen, die wir in unseren Node.js-Converter einbauen sollten.

---

## Fazit

**ki-2-elementor-master ist uns in der visuellen Qualität der Framer→Elementor-Konvertierung um Monate voraus.** Der Dual-Source-Ansatz + die 36 Skills + die Python-Pipeline-Spezifikation adressieren genau die 8 Lücken, die wir heute im E2E-Test gefunden haben.

**Nächster konkreter Schritt:** Die 4 Skills aus Phase 1 kopieren und den Dual-Source-Workflow im Wizard implementieren.

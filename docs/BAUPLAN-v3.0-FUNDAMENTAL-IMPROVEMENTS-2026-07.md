# Bauplan v3.0 — Fundamental Architecture & Product Hardening

**Created:** 2026-07-26
**Basis:** `IMPROVEMENT-PLAN-FUNDAMENTAL-2026-07.md` (site-clone-to-v3), `DESIGN-CRITIC-ARCHITECTURE-2026-07.md`, `UMBAUPLAN-V4-PIPELINE-HARDENING-2026-07.md` (Framer-V4), `PRODUCT-BACKLOG-P1-P10.md`, `VISUAL-QA-IMPROVEMENTS-2026-07.md`
**Scope:** Systemische Probleme lösen, die bei JEDER Konvertierung auftreten — nicht site-spezifisch.
**Ziel:** Build in 30 % der Zeit, 80 % weniger Patch-Runden, Editability ≥ 70 %.

---

## Meta-Erkenntnis: Das grundlegende Architekturproblem

**Beobachtung (aus Live-Build Oral Care):** ALLES Visuelle wurde via page-scoped CSS in WPCode erzwungen — nicht via Elementor-Widget-Settings. Der V3-Tree ist nur noch Struktur, die ganze Gestaltung lebt in CSS.

**Konsequenzen:**
1. Editierbarkeit ist eine Illusion — Elementor-Editor zeigt ungestylte Widgets
2. "Widget-first" ist nicht realisierbar — V4-Engine ignoriert V3-Settings stillschweigend
3. Zwei Sources of Truth — V3-Tree (strukturell) und WPCode-CSS (visuell)

**Dieses Problem muss gelöst werden — nicht einzelne CSS-Selektoren.**

---

## Teil 1 — V3/V4-Trennregel (unchanged, verschärft)

Bestehende Regel bleibt hart. Neu: **Render-Kompatibilitäts-Check** als zusätzliche Trennlinie:
- V3-Settings, die unter V4-Engine nicht rendern → müssen als `render-risk` markiert werden
- V4-Atomic-Elemente (`$$type`, e-flexbox) dürfen nie V3-Settings erben

---

## Teil 2 — Neue Phasen 59–74

### Phase 59 — V3-Setting-Validator & Render-Compat-Tabelle [P1]

**Quelle:** IMPROVEMENT-PLAN Problem 1
**Ziel-Ort:** `packages/target-v3/src/setting-validator.ts` + `references/v3-v4-render-compat.json`
**V3/V4:** V3-only (prüft V3-Settings gegen V4-Render-Verhalten)

**Implementierung:**
- `v3-v4-render-compat.json`: maschinenlesbare Tabelle (Setting → requires → fallback)
- `setting-validator.ts`: iteriert V3-Tree, prüft jedes Setting gegen Compat-Tabelle
- Output: `render-risk-report.json` (blockiert Deploy NICHT, warnt)
- Auto-Kompanion: `typography_font_size` → ergänze `typography_typography: "custom"`

**DoD:**
- [ ] Compat-Tabelle mit ≥ 15 dokumentierten Settings
- [ ] Validator findet alle 6 Oral-Care-Fehler (typography, bg-image, css_classes, overlay, flex_gap, padding)
- [ ] Unit-Tests mit Fixture-Trees

---

### Phase 60 — WPCode-Helper (Safe-Interaction-Layer) [P1]

**Quelle:** IMPROVEMENT-PLAN Problem 6, PRODUCT-BACKLOG P2
**Ziel-Ort:** `packages/core/src/wpcode-helper.ts` (erweitert bestehendes `wpcode.ts`)
**V3/V4:** Mechanismus gemeinsam

**Implementierung:**
- Kapselt ALLE WPCode-Interaktionen mit korrekten Settings:
  - `location: "header"` → `site_wide_header` (nie `site_header`)
  - `location: "footer"` → `site_wide_footer` (nie `site_footer`)
  - Lässt `priority` weg (private property)
  - `type: "html"` mit Inline-`<script>` → nutzt `site_wide_footer` (kses-Workaround)
  - Dual-Write: `post_content` + `wpcode_snippets` Option
  - Page-Guard: wrappt JS/CSS mit `body.page-id-N`
- `wpcode-validate`: prüft VOR dem Speichern (Location, kses, private Props)

**DoD:**
- [ ] 5 Oral-Care-WPCode-Fehler werden verhindert
- [ ] Dual-Write implementiert + getestet
- [ ] Unit-Tests für alle Location/Type-Kombinationen

---

### Phase 61 — Render-Preview & Section-Render-Check [P1]

**Quelle:** IMPROVEMENT-PLAN Problem 2
**Ziel-Ort:** `packages/mcp/src/render-preview.ts` + `packages/target-v3/src/section-render-check.ts`
**V3/V4:** Mechanismus gemeinsam (MCP), Check V3-spezifisch

**Implementierung:**
- MCP-Ability `elementor-render-preview`: rendert einzelnes Element/Section in temp Post
- `section-render-check.ts`: nach Emit jeder Section → render-preview → vergleiche expected vs actual
- Bei Mismatch: generiere CSS-Komplement automatisch
- `progressive-deploy.ts`: Section 1 → verify → fix → Section 2 → ...

**DoD:**
- [ ] render-preview MCP-Call definiert (Input: V3-JSON, Output: HTML + computed styles)
- [ ] section-render-check vergleicht Font-Size, BG-Color, Width, Position
- [ ] Progressive-Deploy-Strategie implementiert

---

### Phase 62 — Setting-First-Policy & Editability-Score [P2]

**Quelle:** IMPROVEMENT-PLAN Problem 3, PRODUCT-BACKLOG P4
**Ziel-Ort:** `packages/target-v3/src/setting-first-policy.ts` + `packages/qa/src/editability-score.ts`
**V3/V4:** V3-spezifisch (Policy), QA gemeinsam

**Implementierung:**
- Policy: jedes visuelle Attribut ZUERST als Elementor-Setting, CSS nur als Fallback
- `css-budget.json`: pro CSS-Regel begründet, WARUM sie nötig ist
- `editability-score.ts`: scannt gerendertes HTML → "Setting-Driven Visuals %"
- Widget-first Guards: `htmlWidgetCount / totalWidgets ≤ 0.15`, fail bei `<img>` in html

**DoD:**
- [ ] Setting-first Workflow pro Attribut implementiert
- [ ] Editability-Score ≥ 70 % als Hard-Floor in QA
- [ ] Widget-first Guards (G_HTML_BUDGET, G_HTML_HAS_IMG) in pre-push

---

### Phase 63 — Tree-Flattening & Nesting-Audit [P2]

**Quelle:** IMPROVEMENT-PLAN Problem 4
**Ziel-Ort:** `packages/target-v3/src/flatten-tree.ts` + `packages/qa/src/nesting-audit.ts`
**V3/V4:** V3-spezifisch (Flatten), QA gemeinsam

**Implementierung:**
- Post-Processing: merge Container die nur einem Layout-Zweck dienen
- Max-Depth-Limit: 3 (Section → Layout-Container → Widget)
- `nesting-audit.ts`: prüft vor Deploy, warnt bei Depth > 3
- Reduziert 75 Container auf ~30, Max-Depth von 6 auf 3

**DoD:**
- [ ] Flatten-Algorithmus reduziert Oral-Care-Tree von 75 auf ~30 Container
- [ ] Nesting-Audit in QA-Pipeline integriert
- [ ] Unit-Tests mit tief-verschachtelten Fixture-Trees

---

### Phase 64 — Geometry-Probe & Structured Visual-Diff [P2]

**Quelle:** IMPROVEMENT-PLAN Problem 5, VISUAL-QA-IMPROVEMENTS §2.2
**Ziel-Ort:** `packages/qa/src/geometry-probe.ts` + `packages/qa/src/visual-diff-structured.ts`
**V3/V4:** Mechanismus gemeinsam

**Implementierung:**
- `geometry-probe.ts`: Input: URL + `{selector, expectedStyles}` → Output: `{actual, expected, match, suggestedCSSFix}`
- `visual-diff-structured.ts`: DOM-Diff statt Bild-Diff (Framer-URL vs Elementor-URL)
- Structural Probes mit Probe-IDs: `header-shell-transparent`, `hero-media-side`, `stats-centered`, `button-not-full-width`, `html-budget`
- `screenshot-annotate.ts`: Bounding-Boxes + Labels + `screenshot-manifest.json`

**DoD:**
- [ ] Geometry-Probe generalisiert (nicht mehr ad-hoc pro Build)
- [ ] ≥ 7 Structural Probes mit konfigurierbaren Selektoren
- [ ] issues.json Output-Format definiert + getestet

---

### Phase 65 — Framer→Elementor Setting-Map [P2]

**Quelle:** IMPROVEMENT-PLAN Problem 7
**Ziel-Ort:** `packages/extractors/src/framer/setting-map.ts` + `packages/target-v3/src/framer-tree-to-v3.ts`
**V3/V4:** Input-Layer neutral (Map), V3-spezifisch (Tree-Emitter)

**Implementierung:**
- Autoritative Mapping-Tabelle: Framer-Attribut → Elementor-Setting
  - `stackDirection` → `flex_direction`
  - `gap` → `flex_gap`
  - `inlineTextStyle` → `typography_*`
  - `backgroundColor` → `background_color`
  - `backgroundImage` → `background_image` (WARN: needs media upload)
- `framer-tree-to-v3.ts`: generischer Konverter (ersetzt ad-hoc Scripts)
- Verknüpft mit Phase 59 Render-Compat (Annotation "rendert zuverlässig?")

**DoD:**
- [ ] Setting-Map deckt alle Oral-Care-Mappings ab
- [ ] framer-tree-to-v3 produziert validen V3-Tree aus Framer-XML
- [ ] Unit-Tests mit echtem Framer-XML-Fixture

---

### Phase 66 — Token-Pipeline (Framer → Kit + Fonts + WPCode) [P2]

**Quelle:** IMPROVEMENT-PLAN Problem 9
**Ziel-Ort:** `packages/core/src/token-pipeline.ts`
**V3/V4:** Mechanismus gemeinsam

**Implementierung:**
- Input: Framer-ColorStyles + TextStyles
- Output: 3 Artefakte:
  1. Elementor Kit-Colors (via MCP `set-active-kit`)
  2. Fonts-Plugin-Einträge (via MCP `register-google-font`)
  3. WPCode Font-Link-Snippet (via wpcode-helper, Phase 60)
- `framer-typography-to-kit.ts`: TextStyles → Kit-Typography-Settings

**DoD:**
- [ ] Token-Setup von 45 min auf 1 Skript-Aufruf reduziert
- [ ] Kit-Colors + Fonts + WPCode-Link in einem Durchlauf
- [ ] Unit-Tests mit Framer-Token-Fixture

---

### Phase 67 — Design Critic (3-Layer QA) [P2]

**Quelle:** DESIGN-CRITIC-ARCHITECTURE, PRODUCT-BACKLOG P1
**Ziel-Ort:** `packages/qa/src/design-critic/`
**V3/V4:** Mechanismus gemeinsam

**Implementierung:**
```
packages/qa/src/design-critic/
  types.ts              — Finding schema (id, layer, severity, principle, selector, expected, actual, fixHint)
  orchestrator.ts       — 3-Layer-Orchestrierung
  rules/spacing.ts      — Section-Padding, Flex-Gap-Konsistenz
  rules/typography.ts   — Font-Hierarchy, Body ≥ 16px, Line-Height
  rules/contrast.ts     — WCAG AA (4.5:1 text, 3:1 large)
  rules/components.ts   — Button-Height 40-56px, Touch ≥ 44px, Radius
  rules/overflow.ts     — Horizontal-Scroll, Mobile-Stack
  collect-computed.ts   — Playwright computed styles
  pair-with-source.ts   — L2 Diff gegen Referenz
  report.ts             — DesignCritiqueReport JSON + MD
```

**DoD:**
- [ ] L1 Rules laufen ohne Referenz-URL (< 2 min)
- [ ] Findings mit selector + fixHint
- [ ] Score ≥ 85 und 0 critical → design OK
- [ ] CLI: `elconv design-critic --url <live> --layers rules`

---

### Phase 68 — Component-Resolver & CMS-Resolver [P3]

**Quelle:** IMPROVEMENT-PLAN Problem 8
**Ziel-Ort:** `packages/extractors/src/framer/component-resolver.ts` + `cms-resolver.ts`
**V3/V4:** Input-Layer neutral

**Implementierung:**
- `component-resolver.ts`: drillt alle componentIds im Page-XML
  - Leaf-Komponenten: inferiere Struktur aus Name (ServiceCard → image+heading+text)
  - Komplexe: parse Variant-Struktur
- `cms-resolver.ts`: erkennt CMS-Collection-Instanzen → `framer_getCMSItems`
- `code-component-library/`: portierte Code-Components als WPCode-Templates

**DoD:**
- [ ] Component-Drill automatisiert (1 Aufruf statt 8+ manuell)
- [ ] CMS-Items automatisch aufgelöst
- [ ] ≥ 4 Code-Component-Templates (before-after, text-reveal, line-animation, smooth-scroll)

---

### Phase 69 — Section-Template-Library [P3]

**Quelle:** IMPROVEMENT-PLAN Problem 10
**Ziel-Ort:** `packages/target-v3/src/section-templates/` + `packages/target-v4/src/section-templates/`
**V3/V4:** STRIKT GETRENNT (V3-Templates ≠ V4-Templates)

**Implementierung:**
- V3: `hero-bg-image/`, `stats-row/`, `service-cards-grid/`, `accordion-steps/`, `team-grid/`, `contact-cta/`, `floating-header/`
- V4: dieselben Patterns als Atomic+HTML-Hybride
- Jedes Template: `v3-tree.json` + `css.css` + `config.json` (parametrisierbar)
- `section-classifier.ts`: Framer-Section-XML → Section-Typ → Template-Auswahl

**DoD:**
- [ ] ≥ 7 V3-Templates + ≥ 3 V4-Templates
- [ ] Section-Classifier erkennt hero, stats, services, process, team, contact
- [ ] Templates vorgetestet gegen V4-Engine

---

### Phase 70 — Novamira-Client & Deploy-Automatisierung [P2]

**Quelle:** IMPROVEMENT-PLAN Problem 11, UMBAUPLAN-V4 Phase V5
**Ziel-Ort:** `packages/mcp/src/novamira-client.ts`
**V3/V4:** Mechanismus gemeinsam

**Implementierung:**
- Wiederverwendbarer MCP-Client: `injectPage`, `createWpcode`, `updateWpcode`, `clearCache`, `renderPreview`, `detectElementorVersion`
- Large-Tree Deploy-Strategien:
  - `< 400KB` → direct set-content
  - `< 1.2MB` → upload + PHP update_post_meta
  - `≥ 1.2MB` → split top-level sections
- Rollback: backup vor --execute
- Deploy ist dry-run by default; `--execute` für live write

**DoD:**
- [ ] NovamiraClient kapselt Session-Management, Auth, Retry
- [ ] 3 Deploy-Strategien implementiert + getestet
- [ ] Dry-run default + --execute flag

---

### Phase 71 — Skill-Session & Build-Resume [P3]

**Quelle:** IMPROVEMENT-PLAN Problem 12
**Ziel-Ort:** `packages/cli/src/skill-session.ts`
**V3/V4:** Mechanismus gemeinsam

**Implementierung:**
- `session.json` pro Build: domain, framer_project, wp_target, post_id, wpcode_snippets, sections_done/pending, css_round, last_action
- `elconv session resume <domain>` — lädt State, schlägt nächsten Schritt vor
- Jedes Deploy/CSS-Fix aktualisiert automatisch den Session-State

**DoD:**
- [ ] Session-Persistence über MCP-Disconnects hinweg
- [ ] Resume schlägt korrekten nächsten Schritt vor
- [ ] Unit-Tests für State-Transitions

---

### Phase 72 — V4-Pipeline-Hardening (aus UMBAUPLAN-V4) [P2]

**Quelle:** UMBAUPLAN-V4-PIPELINE-HARDENING Phases V1-V12
**Ziel-Ort:** `packages/target-v4/` + `packages/cli/`
**V3/V4:** STRIKT V4-only

**Implementierung (aus V4-Umbauplan):**
- V1: CLI Product Surface (`elconv v4 build/validate/deploy/qa`)
- V2: One-Shot Happy Path (XML → V4-Tree → validate ≥ 85 → optional deploy)
- V3: Preflight always-on (nicht optionales Script)
- V4: Bridge Intake (V3-JSON → echtes Atomic mit strict $$type upgrade)
- V5: Large-tree deploy + rollback (align mit Phase 70)
- V6: Pattern library V4 (glass-header, stat-row, orbit als Atomic+HTML)
- V7: Unified QA Report (section-compare + visual-qa + structural probes)
- V8: Animation inject reliability (page-scoped WPCode)

**DoD:**
- [ ] `elconv v4 build --xml fixture.xml --validate` → score ≥ 85
- [ ] Bridge-Upgrade: V3-JSON → valides Atomic ($$type envelopes)
- [ ] Unified QA Report mit V4-only Probes (no-v3-widgets, gc-bound, $$type-present)

---

### Phase 73 — Healing-Loop ↔ Design-Critic Integration [P2]

**Quelle:** PRODUCT-BACKLOG P8, REPAIR-LOOP-V1
**Ziel-Ort:** `packages/qa/src/healing-loop.ts` (erweitern)
**V3/V4:** Mechanismus gemeinsam

**Implementierung:**
- Feed critical Design-Critic/QA findings into healing path
- Mutation-Allowlist: CSS edits, element setting changes (nie html als Layout-Fix)
- Regression-Guard: E-Floor kann nicht regressieren
- States: PASS / PLATEAU / MAX / ESCALATE
- Max 5 Runden, dann ESCALATE mit best_state + reason + open issues

**DoD:**
- [ ] Issue → Fixer Registry für Top-Probe/Rule-IDs
- [ ] Never-List enforced (no html_widget layout fix, no absolute positioning)
- [ ] Plateau-Detection + Regression-Rollback
- [ ] Unit-Tests mit Mock-Fixer

---

### Phase 74 — Offline E2E Golden Path (CI) [P2]

**Quelle:** PRODUCT-BACKLOG P10, UMBAUPLAN-V4 Phase V12
**Ziel-Ort:** `tests/e2e/` + `.github/workflows/ci.yml`
**V3/V4:** Beide Targets

**Implementierung:**
- Deterministische Fixtures (HTML + stored tree + mock MCP)
- Pipeline: Build → Guards → Pixel-Compare → Scorecard
- Scorecard Hard-Floors: E ≥ 70, M ≥ 60, critical probes = 0
- Kein Netzwerk nötig für Default-Job

**DoD:**
- [ ] `npm run test:e2e` grün ohne Netzwerk
- [ ] Scorecard-Assertion (nicht nur pixel %)
- [ ] V3 + V4 Golden-Path-Fixtures

---

## Teil 3 — Plugin-Seite (Novamira-Vorschläge, nicht in elconv)

Diese Abilities werden per MCP aufgerufen, nicht in elconv implementiert:

1. `novamira/elementor-render-preview` — rendere einzelnes Element, return HTML + computed styles
2. `novamira-adrianv2/wpcode-validate` — validiere Snippet vor Speichern
3. `novamira-adrianv2/setting-render-check` — rendert dieses Setting unter V4?
4. `novamira-adrianv2/kit-apply-typography` — setze Kit-Typography aus Token-Set
5. `novamira-adrianv2/section-template-deploy` — deploye vorgetestete Section
6. `novamira-adrianv2/geometry-probe` — Selectoren + erwartete Styles → actual + Diff

---

## Teil 4 — Empfohlene Reihenfolge

```
1. Phase 60 (WPCode-Helper)         — P1, gering, eliminiert 5 Fehlerquellen
2. Phase 59 (Setting-Validator)     — P1, mittel, eliminiert Blind-Build
3. Phase 64 (Geometry-Probe)        — P2, gering, macht QA für nicht-vision nutzbar
4. Phase 61 (Render-Preview)        — P1, mittel-hoch, größter Single-Improvement
5. Phase 62 (Setting-First)         — P2, mittel, Editability-Ziel
6. Phase 63 (Tree-Flatten)          — P2, gering-mittel, CSS-Zuverlässigkeit
7. Phase 65 (Setting-Map)           — P2, mittel, jeder Build profitiert
8. Phase 66 (Token-Pipeline)        — P2, mittel, 45 min → 1 Aufruf
9. Phase 67 (Design Critic)         — P2, mittel, Designer-QA
10. Phase 70 (Novamira-Client)      — P2, gering-mittel, Setup-Zeit
11. Phase 72 (V4-Hardening)         — P2, hoch, V4-Produktqualität
12. Phase 73 (Healing-Loop)         — P2, mittel, Auto-Fix
13. Phase 74 (E2E CI)              — P2, mittel, Regressionsschutz
14. Phase 68 (Component-Resolver)   — P3, hoch, CMS/Code-Components
15. Phase 69 (Section-Templates)    — P3, hoch, ab 3. Build
16. Phase 71 (Skill-Session)        — P3, gering, Resume-Komfort
```

---

## Teil 5 — Messbare Ziele

| Metric | Oral Care (Ist) | Nach P1 (Phase 59-61) | Nach P2 (Phase 62-74) | Langfristig |
|---|---|---|---|---|
| Build-Zeit (Framer→Live) | ~3 h | ~1.5 h | ~1 h | ~30 min |
| CSS-Patch-Runden | 5 | 2-3 | 1-2 | 0 |
| Editability-Score | ~10 % | ~30 % | ~50 % | ≥ 70 % |
| Geometry-Probe Treffer | ~60 % | ~75 % | ~85 % | ≥ 90 % |
| Setup-Zeit pro Build | ~30 min | ~10 min | ~5 min | ~1 min |
| Manuelle Scripts pro Build | 8 | 4 | 2 | 1 |
| Nesting Max-Depth | 6 | 4 | 3 | 3 |
| Container-Anzahl (9 Sections) | 75 | 50 | ~30 | ~30 |

---

## Teil 6 — Definition of Done (Gesamt v3.0)

- Alle Phasen 59–74 haben ✅ oder begründete Ausnahme
- `npx tsc --noEmit` weiterhin 0 Fehler über alle 8 Packages
- `npx vitest run` grün
- V3/V4-Isolation bleibt enforced (bestehender Test)
- Editability-Score-Test: Setting-driven ≥ 70 % in Golden-Path-Fixture
- Geometry-Probe: ≥ 85 % Treffer in Golden-Path
- Design-Critic: Score ≥ 85, 0 critical in Golden-Path
- `npm run lint` läuft durch
- README + Docs aktualisiert

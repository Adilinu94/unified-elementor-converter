# Fundamental Improvement Plan — Framer → Elementor V3 Pipeline

**Created:** 2026-07-26 · **Context:** Nach erstem Live-Build (Oral Care) auf testseite.nick-webdesign.de
**Scope:** Systemische Probleme, die bei JEDER Framer→V3-Konvertierung auftreten werden — nicht site-spezifisch.
**Ziel:** Der nächste Build läuft in 30 % der Zeit mit 80 % weniger Patch-Runden.

---

## Meta-Erkenntnis: Das grundlegende Architekturproblem

**Beobachtung:** Der Build endete damit, dass ALLES Visuelle via page-scoped CSS in WPCode erzwungen wurde — nicht via Elementor-Widget-Settings. Der V3-Tree ist nur noch Struktur (Container + Widget-Texte), die ganze Gestaltung lebt in CSS. Das bedeutet:

1. **Editierbarkeit ist eine Illusion** — öffnet ein User den Elementor-Editor, sieht er ungestylte Widgets. Die echten Styles sind in WPCode-CSS versteckt. Das widerspricht dem Kernversprechen "editable Elementor V3".
2. **Der Skill "widget-first" ist im aktuellen Setup nicht realisierbar** — native Widgets haben Settings, die Elementor V4 stillschweigend ignoriert (`typography_font_size` ohne `typography_typography: "custom"`, `background_image` auf Containern, `css_classes` auf Widgets). Widget-first produziert visuell kaputte Seiten, die dann mit CSS geflickt werden.
3. **Zwei Sources of Truth** — der V3-Tree (strukturiert, aber visuell wirkungslos) und das WPCode-CSS (visuell korrekt, aber unstrukturiert). Jede Änderung muss an beiden Orten synchronisiert werden.

**Das ist das Problem, das gelöst werden muss — nicht einzelne CSS-Selektoren.**

---

## Problem 1: Elementor-Settings rendern nicht zuverlässig (Silent Failure)

### Beobachtung
| Setting | Im V3-Tree gesetzt | Gerendert? | Ursache |
|---|---|---|---|
| `typography_font_size` | `{unit:"px", size:64}` | ❌ 24px (Theme-Default) | Braucht `typography_typography: "custom"` |
| `background_image` (Container) | `{url, id:null}` | ❌ kein BG-Image | `id: null` oder V4-Engine-Unterschied |
| `css_classes` (Widget) | `"oc-reveal-text"` | ❌ Klasse fehlt | V4-Engine stript Widget-css_classes? |
| `background_overlay` | `{color, opacity}` | ❌ wird nicht gerendert | V4-Engine rendert Overlay anders |
| `flex_gap` | `{unit:"px", size:32}` | ⚠️ teils, teils nicht | Inkonsistent |
| `padding` | `{unit:"px", top:"112", ...}` | ⚠️ teils | V4 `e-con-full` überschreibt |

### Root Cause
Elementor V4.2 rendert V3-`_elementor_data` mit V4-Markup, aber nicht alle V3-Settings werden 1:1 übernommen. Es gibt **keine offizielle Mapping-Tabelle** "V3-Setting → V4-Render-Verhalten". Das Skill (`v4-engine.md`) dokumentiert Symptome, aber nicht systematisch.

### Lösung (Repo + Plugin)

**A. Repo: `src/builder/v3-setting-validator.ts` (NEU)**
- Vor Deploy: iteriere über alle Elemente im V3-Tree, prüfe jedes Setting gegen eine **Render-Kompatibilitäts-Tabelle**.
- Tabelle (maschinenlesbar, `references/v3-v4-render-compat.json`):
  ```json
  {
    "typography_font_size": { "requires": "typography_typography=custom", "fallback": "CSS" },
    "background_image": { "requires": "id=<media-id>, not null", "fallback": "CSS background-image" },
    "css_classes": { "applies_to": "container", "widget_support": "unverified", "fallback": "section-scoped selector" },
    "background_overlay": { "v4_render": "different markup", "fallback": "CSS ::before" }
  }
  ```
- Output: pro Element "Setting X wird vermutlich nicht rendern → Empfehlung: CSS oder Setting Y hinzufügen".
- **Blockiert Deploy nicht**, sondern erzeugt einen `render-risk-report.json` im Research-Dir.

**B. Repo: `src/builder/v3-tree-emitter.ts` (Erweiterung)**
- Setzt automatisch kompanion-Settings:
  - Wenn `typography_font_size` gesetzt → ergänze `typography_typography: "custom"`
  - Wenn `background_image` mit `id: null` → warne + empfehle Media-Upload zuerst
  - Wenn `css_classes` auf Widget → warne + generiere Section-Scoped-CSS-Selector als Fallback

**C. Plugin (Novamira): `novamira/elementor-render-preview` (NEUE Ability)**
- Nimmt einen V3-Element-Baum (ein einzelnes Element oder eine Section) + erzeugt einen temporären Post → rendert ihn → gibt das gerenderte HTML + computed styles zurück.
- Damit kann der Builder VOR dem Full-Deploy verifizieren: "rendert dieses Setting?"
- Optional: gibt Diff "erwartete Settings vs. gerenderte Settings".

**Priorität:** P1 — ohne das bleibt jeder Build ein Trial-and-Error-CSS-Patching.

---

## Problem 2: Kein Render-Feedback vor Full-Deploy (Blind Build)

### Beobachtung
Ich deploye den gesamten V3-Tree (9 Sections, ~140 Elemente), sehe das Resultat, und merke dann: "H2 ist 24px, Background fehlt, Header liegt nicht über Hero." Jede Korrektur = ein weiterer Deploy + CSS-Patch + Re-Verify. 5+ Runden bei Oral Care.

### Root Cause
Es gibt keine Möglichkeit, eine einzelne Section oder ein einzelnes Widget zu rendern und das Ergebnis zu sehen, OHNE die ganze Page zu deployen. Der Build ist "all-or-nothing".

### Lösung (Repo + Plugin)

**A. Plugin: `novamira/elementor-render-preview` (siehe Problem 1C)**
- Input: V3-Element-JSON (ein Element oder eine Section)
- Erzeugt temporären Post (draft), injiziert das Element, rendert, gibt HTML + computed-styles zurück, löscht den Post.
- Der Builder kann dann pro-Section verifizieren, BEVOR der Full-Tree deployed wird.

**B. Repo: `src/builder/section-render-check.ts` (NEU)**
- Nach dem Emit jeder Section: rufe `render-preview` auf → vergleiche gerenderte Font-Size, BG-Color, Width, Position mit den erwarteten Werten aus dem Framer-XML.
- Bei Mismatch: generiere automatisch das nötige CSS-Komplement (z. B. `font-size: 64px !important`).
- Output: `section-render-report.json` pro Section mit "expected vs. actual" + auto-generiertem CSS.

**C. Repo: `src/builder/progressive-deploy.ts` (NEU)**
- Deploye Section 1 → verify → fix CSS → deploy Section 2 → ...
- Statt: deploye alles → merke alles ist kaputt → fixe alles.
- Reduziert die Fehler-Kaskade.

**Priorität:** P1 — das wäre der größte Single-Improvement für die Build-Geschwindigkeit.

---

## Problem 3: CSS wird Source of Truth statt Elementor-Settings (Editability-Verlust)

### Beobachtung
Am Ende des Oral-Care-Builds war 100 % der visuellen Gestaltung in WPCode-CSS, 0 % in Elementor-Widget-Settings. Ein User, der den Elementor-Editor öffnet, sieht ungestylte Widgets. Das Scorecard-Ziel "E (Editability) ≥ 70" wird verfehlt, weil die Editability nur auf dem Papier existiert.

### Root Cause
1. Elementor-Settings rendern nicht zuverlässig (Problem 1) → CSS ist zuverlässiger → CSS wird Default.
2. Der Skill empfiehlt "widget-first" aber liefert keine Garantie, dass Widget-Settings auch rendern.
3. Es gibt keinen Mechanismus, der CSS nur als Ergänzung (für das, was Settings nicht können) einsetzt, statt als Ersatz.

### Lösung (Repo + Skill)

**A. Repo: `src/builder/setting-first-policy.ts` (NEU)**
- **Regel:** Jedes visuelle Attribut wird ZUERST als Elementor-Setting versucht, CSS nur als Fallback wenn das Setting nachweislich nicht rendert.
- Workflow pro Attribut:
  1. Setze als Elementor-Setting (z. B. `typography_font_size: 64` + `typography_typography: "custom"`)
  2. Deploy-Preview → prüfe ob gerendert
  3. Wenn ja → belassen, kein CSS nötig
  4. Wenn nein → CSS-Komplement generieren + im `render-risk-report` markieren
- Output: ein `css-budget.json` das pro CSS-Regel begründet, WARUM sie nötig ist (welches Setting versagt hat).

**B. Skill: `references/setting-render-matrix.md` (NEU)**
- Tabelle: "Visuelles Bedürfnis → Elementor-Setting → rendert zuverlässig? → CSS-Fallback"
- Wird aus dem `v3-v4-render-compat.json` (Problem 1A) generiert.
- Der Builder konsultiert diese Matrix vor dem Emit und entscheidet Setting vs. CSS.

**C. Repo: `src/qa/editability-score.ts` (NEU)**
- Nach Deploy: scanne das gerenderte HTML.
- Für jedes Widget: ist die visuelle Gestaltung aus Elementor-Settings oder aus CSS gekommen?
- Metric: "Setting-Driven Visuals %" — wie viel der Gestaltung ist im Elementor-Editor sichtbar.
- Ziel: ≥ 70 % (Scorecard E-Floor).

**Priorität:** P2 — direkt abhängig von Problem 1+2.

---

## Problem 4: Deep Nesting (V4-Engine + Tree-Builder kumulieren)

### Beobachtung
Layout-Audit: 43 Deep-Nesting-Errors (Depth > 3), Max-Depth 6. 75 Container für 9 Sections. Jeder Section hat: section-container → content-container (max-width) → row-container → column-container → widget-wrapper → widget. Die V4-Engine fügt `.e-con-inner` Wrapper hinzu. Das macht Layouts fragil und CSS-Selektoren unzuverlässig.

### Root Cause
1. Tree-Builder-Helper verschachteln Container für Layout-Zwecke (row, column, max-width-Wrapper), die in Elementor nicht nötig wären (Elementor hat `flex_direction`, `content_width: boxed`, `_element_custom_width`).
2. Die V4-Engine fügt eigene Wrapper hinzu (`e-con-inner`), die im V3-Tree nicht existieren.
3. Keine Nesting-Tiefe-Begrenzung im Builder.

### Lösung (Repo)

**A. Repo: `src/builder/flatten-tree.ts` (NEU)**
- Post-Processing auf den V3-Tree vor Deploy:
  - Finde Container, die nur einem Layout-Zweck dienen (ein Child, keine eigenen Settings) → merge mit Child.
  - Ersetze `container > container(row) > container(column) > widget` durch `container(row, mit flex) > widget` wo möglich.
  - Max-Depth-Limit: 3 (Section → Layout-Container → Widget). Tiefer nur wenn inhaltlich nötig.
- Reduziert 75 Container auf ~30, Max-Depth von 6 auf 3.

**B. Repo: `src/builder/v3-tree-emitter.ts` (Erweiterung)**
- Helper-Funktionen (`container()`, `row()`, `column()`) mergen automatisch statt zu verschachteln:
  - `container({flex_direction:"row"}, [container({flex_direction:"column"}, [widget])])` → `container({flex_direction:"row"}, [widget])` (Column-Wrapper weg, wenn er nur ein Widget wrappt).
- `max-width` als Setting auf dem Container, nicht als extra Wrapper-Container.

**C. Repo: `src/qa/nesting-audit.ts` (NEU)**
- Vor Deploy: prüfe Nesting-Tiefe. Bei Depth > 3 → Warning + Vorschlag zum Flatten.
- Integration in den bestehenden `layout-audit`.

**Priorität:** P2 — verbessert CSS-Zuverlässigkeit + Performance.

---

## Problem 5: Kein strukturiertes Visual-Feedback für nicht-vision-Modelle

### Beobachtung
Ich kann keine Screenshots sehen. Die `scripts/visual-diff.mjs` produziert Bild-Diffs (pixelmatch), die ich nicht lesen kann. Die Novamira-QA-Tools (`visual-qa`, `page-audit`, `layout-audit`) finden Struktur-Issues aber keine visuellen Deltas. Am nützlichsten waren selbst geschriebene Playwright-Geometry-Probes (computed styles pro Element) — die sind aber ad-hoc und nicht in der Pipeline.

### Root Cause
1. Alle Visual-QA-Tools geben Bilder oder unstrukturierte Text-Reports.
2. Es gibt kein Tool, das "visuelle Differenz" als **strukturierte Daten** zurückgibt (z. B. "Hero-H1 ist 24px, erwartet 96px, Selector .oc-hero h1, Fix: font-size: 96px !important").
3. Geometry-Probes sind nicht generalisiert — ich schrieb sie pro-Build neu.

### Lösung (Repo)

**A. Repo: `src/qa/geometry-probe.ts` (NEU, generalisierte Version meiner ad-hoc-Probes)**
- Input: Live-URL + eine Liste von `{selector, expectedStyles}` (z. B. `{".oc-hero h1": {fontSize: "96px", color: "#fff"}}`).
- Output: pro Selector `{actual, expected, match: bool, diff, suggestedCSSFix}`.
- Läuft headless (Playwright), kein Bild nötig, strukturierte Daten.
- Der Builder generiert die `expectedStyles` automatisch aus dem Framer-XML (Token-Mapping).

**B. Repo: `src/qa/visual-diff-structured.ts` (NEU)**
- Statt Bild-Diff: **DOM-Diff**.
- Lädt Framer-Live-URL + Elementor-Live-URL in Playwright.
- Vergleicht pro Section: Container-Struktur (Tiefe, Kind-Anzahl), Text-Content, computed Font-Size/Color/Width/Position.
- Output: JSON-Report "Section X: Framer hat 3 Cards in einer Row, Elementor hat 3 Cards gestacked → Fix: flex-direction: row".
- Kein Bildvergleich, sondern **Strukturvergleich** — für nicht-vision-Modelle nutzbar.

**C. Repo: `src/qa/screenshot-annotate.ts` (NEU)**
- Erzeugt Screenshot + annotiert ihn mit Bounding-Boxes + Labels pro Section.
- Speichert unter `research/<domain>/screenshots/annotated-<viewport>.png`.
- Für den User (der kann Bilder sehen) — nicht für das Modell.
- Plus: speichert einen `screenshot-manifest.json` mit Section → Koordinaten-Mapping, damit das Modell Bereiche referenzieren kann ("Section 3 hat Cards bei y=1200-1800").

**Priorität:** P2 — macht nicht-vision-Modelle produktiv für Visual-QA.

---

## Problem 6: WPCode-Interaktion ist fragil und undokumentiert

### Beobachtung
Fünf WPCode-Probleme in einem Build:
1. `priority` ist private property → Snippet-Erstellung scheitert.
2. `site_footer` vs `site_wide_footer` → Snippet wird nicht injiziert.
3. kses stript Inline-`<script>` aus HTML-Snippets.
4. `bypass_kses: true` → Post-Typ-Konflikt.
5. `code_type: "js"` → Snippet wird nicht geladen (andere Injektion als html).

### Root Cause
1. WPCode hat viele Konfigurations-Fallen, die nicht dokumentiert sind.
2. Das Skill erwähnt einige (`priority` weglassen) aber nicht alle (`site_wide_footer` vs `site_footer`).
3. Kein WPCode-Helper, der die korrekten Settings kapselt.

### Lösung (Repo + Skill)

**A. Repo: `src/builder/wpcode-helper.ts` (NEU, entspricht Backlog P2)**
- Kapselt ALLE WPCode-Interaktionen:
  ```typescript
  wpcode.createOrUpdate({ title, code, type: "css"|"html"|"js", location: "header"|"footer", pageId, active: true })
  ```
- Intern:
  - Mappt `location: "header"` → `site_wide_header`, `"footer"` → `site_wide_footer` (nie `site_footer`).
  - Lässt `priority` weg (private property).
  - Für `type: "html"` mit Inline-`<script>`: nutzt `site_wide_footer` (wo kses Inline-Scripts erhält).
  - Dual-Write: `post_content` + `wpcode_snippets` Option (Skill §4.3).
  - Page-Guard: wrappt JS/CSS automatisch mit `body.page-id-N` Check.
- **Ein** Skript-Aufruf statt 5 Trial-and-Error-Runden.

**B. Skill: `references/wpcode-recipe.md` (NEU, ersetzt ad-hoc-Notizen)**
- Autoritative Tabelle: "Will ich X → code_type Y, location Z, caveats A".
- Generiert aus dem `wpcode-helper.ts` (Single Source of Truth).

**C. Plugin (Novamira): `novamira-adrianv2/wpcode-validate` (NEUE Ability)**
- Nimmt Snippet-Code + code_type + location → validiert VOR dem Speichern:
  - Wird die Location injiziert? (prüft gegen bekannte funktionierende Locations).
  - Sind Inline-Scripts erhalten? (kses-Check).
  - Sind private Properties vermieden?
- Returnt `{valid: bool, warnings: [], suggestedFixes: []}`.

**Priorität:** P1 — WPCode ist bei jedem Build nötig, die Fehler sind reproduzierbar.

---

## Problem 7: Keine Framer→Elementor Setting-Mapping-Tabelle (Ad-hoc-Mapping)

### Beobachtung
Ich mappte manuell: Framer `stackDirection: "horizontal"` → Elementor `flex_direction: "row"`, Framer `gap: "32px"` → Elementor `flex_gap: {unit:"px", size:32}`, Framer `inlineTextStyle: "/Headings/..."` → Elementor `typography_font_family + typography_font_size`. Das Mapping ist lückenhaft, fehleranfällig und nicht wiederverwendbar.

### Root Cause
1. `src/analysis/token-mapping.ts` existiert, mappt aber nur Design-Tokens (Colors, Fonts), keine Layout-Settings.
2. Framer-Attribute (stackDirection, stackDistribution, stackAlignment, gap, padding, borderRadius, backgroundColor, inlineTextStyle) haben keine systematische Elementor-Entsprechung.
3. Jeder Build reimplementiert das Mapping.

### Lösung (Repo)

**A. Repo: `src/builder/framer-to-elementor-setting-map.ts` (NEU)**
- Autoritative Mapping-Tabelle (maschinenlesbar):
  ```typescript
  const SETTING_MAP = {
    "stackDirection": { "horizontal": "flex_direction: row", "vertical": "flex_direction: column" },
    "stackDistribution": { "start": "flex_justify_content: flex-start", "center": "flex_justify_content: center", "space-between": "flex_justify_content: space-between", ... },
    "stackAlignment": { "start": "flex_align_items: flex-start", "center": "flex_align_items: center", ... },
    "gap": (v) => `flex_gap: {unit:"px", size:${parseInt(v)}}`,
    "padding": (v) => `padding: {unit:"px", top:..., right:..., ...}`,
    "borderRadius": (v) => `border_radius: {unit:"px", top:${v}, ...}`,
    "backgroundColor": (v) => v.startsWith("/") ? `background_color: "${resolveColorStyle(v)}"` : `background_color: "${v}"`,
    "inlineTextStyle": (v) => resolveTextStyle(v), // → {font_family, font_size, line_height, letter_spacing, color}
    "backgroundImage": (v) => `background_image: {url: "${v}", id: null} → WARN: needs media upload`,
    "width": (v) => v === "1fr" ? `content_width: full` : `_element_custom_width: {unit:"px", size:${parseInt(v)}}`,
    "overflow": (v) => `overflow: ${v}`,
    "minHeight": (v) => `min_height: {unit:"vh", size:${parseInt(v)}}`,
  };
  ```
- Der Builder konsultiert diese Tabelle statt manuell zu mappen.
- Bei jedem Mapping: Annotation "rendert zuverlässig?" (verknüpft mit Problem 1A Render-Compat-Tabelle).

**B. Repo: `src/builder/framer-tree-to-v3.ts` (NEU)**
- Nimmt den Framer-Page-XML (aus Unframer MCP) → iteriert über alle Nodes → emittiert V3-Tree unter Nutzung des Setting-Maps.
- Ersetzt meinen ad-hoc `build-tree.mjs` durch einen generischen, projekt-agnostischen Konverter.
- Konfigurierbar via `clone.config` (Section-Class-Prefix, Token-Overrides).

**Priorität:** P2 — einmal gebaut, jeder folgende Build profitiert.

---

## Problem 8: Component-Drill ist unvollständig (Leaf-Komponenten, CMS-Content)

### Beobachtung
1. Leaf-Komponenten (ServiceCard, Achievement, SectionTag, ButtonPrimary) → "Node is not a text node" — nicht drillbar. Ich musste ihre Struktur erraten.
2. CMS-Driven Content (Team-Cards) → nur 1 von 6 Cards im XML. Die anderen 5 sind in einer Framer-CMS-Collection, die ich nicht abfragte.
3. Code-Components (BeforeAfter, TextReveal) → drillbar via `readCodeFile`, aber Port nach Vanilla-JS manuell.

### Root Cause
1. Unframer MCP drillt Component-Definitionen nur für komplexe Multi-Variant-Komponenten. Leaf-Komponenten geben nur Instance-Props.
2. Framer-CMS-Collections sind via `framer_getCMSItems` abfragbar, aber der Workflow weiß nicht, WANN er das tun soll.
3. Code-Component-Port ist nicht automatisiert.

### Lösung (Repo + MCP)

**A. Repo: `src/extractor/framer-component-resolver.ts` (NEU)**
- Input: Framer-Page-XML (aus `framer_getNodeXml`).
- Für jede `componentId` im Page-XML:
  1. Versuche `framer_getNodeXml(componentId)`.
  2. Bei "Node is not a text node" (Leaf): extrahiere Instance-Props aus dem Page-XML-Block → inferiere Struktur aus Component-Name (ServiceCard → image+heading+text, Achievement → heading+text, ButtonPrimary → button).
  3. Bei Erfolg (komplex): parse Variant-Struktur.
- Output: `component-resolved.json` mit allen Component-Definitionen + Variant-Maps + Instance-Props.
- Ein Skript-Aufruf statt 8+ manuellen Drills.

**B. Repo: `src/extractor/framer-cms-resolver.ts` (NEU)**
- Prüfe Page-XML auf Component-Instanzen, die in Collections verwendet werden (z. B. Team-Cards in einem Grid mit nur 1 Instanz).
- Rufe `framer_getCMSCollections` → finde passende Collection → `framer_getCMSItems`.
- Mappe CMS-Items auf zusätzliche Component-Instanzen.
- Output: `cms-resolved.json` mit allen echten Content-Einträgen.
- Bei Oral Care: hätte die 5 fehlenden Team-Cards automatisch geliefert.

**C. Repo: `src/builder/framer-code-component-library/` (NEU)**
- Verzeichnis mit portierten Code-Components als WPCode-Snippets:
  - `before-after-slider.js` — parametrisierbar (Selektor-Klassen)
  - `text-reveal.js` — parametrisierbar (Trigger-Selektor, Start/End-Opacity)
  - `line-animation.js` — SVG-Line + ScrollTrigger
  - `smooth-scroll.js` — Lenis-Integration
- Jede als Template mit `${SELECTOR}`, `${PAGE_ID}` Platzhaltern.
- Builder wählt automatisch das passende Snippet pro Code-Component-Typ.
- Reduziert Code-Component-Port von ~30 min auf 1 Konfiguration.

**Priorität:** P2 — einmal gebaut, jeder Build mit Code-Components/CMS profitiert.

---

## Problem 9: Kein Token-Pipeline (Framer ColorStyles/TextStyles → Elementor Kit + Fonts + WPCode)

### Beobachtung
Ich mappte 10 Framer-ColorStyles + 22 TextStyles manuell auf:
- Elementor Kit-Colors (nicht gemacht — CSS übernahm)
- Fonts-Plugin `ogf_custom_fonts` (nicht gemacht — WPCode Google-Fonts-Link)
- WPCode page-scoped CSS (manuell, 200+ Zeilen)

Das ist bei jedem Build ~45 min repetitive Arbeit.

### Root Cause
1. `src/analysis/font-kit-bridge.ts` + `src/lib/fonts-plugin-adapter.ts` existieren, sind aber nicht in den Framer-Build integriert.
2. Keine automatische Pipeline: Framer-ColorStyles → Elementor Kit-Colors, Framer-TextStyles → Elementor Kit-Typography + Fonts-Plugin + WPCode-Font-Link.

### Lösung (Repo)

**A. Repo: `src/builder/framer-token-pipeline.ts` (NEU)**
- Input: Framer-ColorStyles + TextStyles (aus `framer_getProjectXml`).
- Output: 3 Artefakte:
  1. **Elementor Kit-Colors** via `novamira-adrianv2/set-active-kit` + Kit-Settings (Primary, Dark, Light, Border, …).
  2. **Fonts-Plugin-Einträge** via `novamira-adrianv2/register-google-font` pro Font-Family (Bricolage, Inter, Figtree, Jost, Gilda).
  3. **WPCode Font-Link-Snippet** (Google-Fonts-`<link>`) via `wpcode-helper` (site_wide_header, page-guarded).
- Reduziert Token-Setup von 45 min auf 1 Skript-Aufruf.

**B. Repo: `src/builder/framer-typography-to-kit.ts` (NEU)**
- Mappe Framer-TextStyles → Elementor Kit-Typography-Settings.
- Pro TextStyle: `{font_family, font_size, font_weight, line_height, letter_spacing}` → Kit-Typography-Eintrag.
- Verknüpft mit Problem 7A (Setting-Map) für zuverlässiges Rendering.

**Priorität:** P2 — repetitiv bei jedem Build.

---

## Problem 10: Kein Section-Template-Library (jede Section von null)

### Beobachtung
Jede Section (Hero, Stats, Accordion, Team-Grid, BeforeAfter, Contact) wurde von null gebaut. Dabei sind diese Patterns universell: jeder Framer-Dental-/SaaS-/Portfolio-Template hat Varianten davon. Es gibt keine Wiederverwendung zwischen Builds.

### Root Cause
1. `skills/framer-to-elementor-v3/references/component-playbooks.md` dokumentiert Patterns textuell, aber nicht als ausführbare Templates.
2. Keine Bibliothek von getesteten, parameterisierten Section-Templates, die als V3-JSON + CSS + JS deployt werden können.

### Lösung (Repo)

**A. Repo: `src/builder/section-templates/` (NEU)**
- Verzeichnis mit getesteten Section-Templates:
  ```
  section-templates/
    hero-bg-image/        → v3-tree.json + css.css + js.js + config.json
    stats-row/            → v3-tree.json + css.css + config.json
    service-cards-grid/   → v3-tree.json + css.css + config.json
    accordion-steps/      → v3-tree.json + css.css + config.json
    before-after-slider/  → v3-tree.json + css.css + js.js + config.json
    team-grid/             → v3-tree.json + css.css + config.json
    contact-cta/           → v3-tree.json + css.css + config.json
    floating-header/       → v3-tree.json + css.css + js.js + config.json
  ```
- Jedes Template ist **parametrisierbar** (`config.json`: `{prefix, tokens, content}`).
- Jedes ist **vorgetestet** gegen die V4-Engine (render-preview verifiziert).
- Der Builder wählt Templates basierend auf Section-Typ (aus Framer-XML-Klassifikation) + füllt Parameter aus Framer-Instanz-Props.

**B. Repo: `src/builder/section-classifier.ts` (NEU)**
- Input: Framer-Section-XML.
- Output: Section-Typ (`hero`, `stats`, `services`, `process`, `before-after`, `team`, `contact`, `header`).
- Nutzt Heuristik (BG-Image + H1 → hero; Grid + Cards → team/services; Accordion → process).
- Verknüpft mit Section-Templates (A).

**Priorität:** P3 — großer Aufwand, aber exponentieller Return ab dem 3. Build.

---

## Problem 11: Deploy-Route nicht automatisiert (manuelle JSON-RPC-Scripts)

### Beobachtung
Ich schrieb manuelle Node-Scripts (`deploy.mjs`, `create-wpcode.mjs`, `fix-css*.mjs`) die rohe JSON-RPC über HTTP mit Session-Management implementieren. Jedes Script hat den gleichen Boilerplate (initialize → session-id → tools/call). Das ist reproduzierbar, aber nicht wiederverwendbar — der nächste Build reimplementiert den RPC-Client.

### Root Cause
1. `src/mcp/mcp-adapter.ts` existiert, ist aber auf die automatisierte Pipeline zugeschnitten, nicht auf Skill-basierte Builds.
2. Kein wiederverwendbarer MCP-Client für Skill-basierte ad-hoc-Deployments.

### Lösung (Repo)

**A. Repo: `src/mcp/novamira-client.ts` (NEU)**
- Wiederverwendbarer Client:
  ```typescript
  const client = new NovamiraClient({ url, user, password });
  await client.injectPage({ post_id, tree, template: "canvas" });
  await client.createWpcode({ title, code, type, location, pageId });
  await client.updateWpcode({ snippet_id, code });
  await client.clearCache({ post_ids });
  await client.renderPreview({ element });  // Problem 2A
  await client.detectElementorVersion();
  ```
- Kapselt: Session-Management, JSON-RPC, Auth, Error-Handling, Retry.
- Nutzt den `wpcode-helper` (Problem 6A) intern.
- Skill-basierte Builds importieren diesen Client statt rohe RPC-Calls.

**B. Repo: `src/cli/deploy.ts` (NEU, CLI-Command)**
- `npx clone-v3 deploy <research-dir> --target <name>` — deployt den V3-Tree + WPCode + Tokens aus dem Research-Dir.
- Nutzt `novamira-client` (A).
- Ein Command statt 5 Scripts.

**Priorität:** P2 — reduziert Build-Setup-Zeit pro Projekt.

---

## Problem 12: Keine Build-Resume / Session-State für Skill-basierte Builds

### Beobachtung
Bei Abbruch mitten im Build (MCP-Disconnect, Token-Limit) ist der Fortschritt verloren. Die automatisierte Pipeline hat `state.json` (`--resume`), aber der Skill-basierte Build nicht. Bei Oral Care musste ich bei jedem Reconnect neu anfangen.

### Root Cause
1. `state.json` existiert nur für die automatisierte Pipeline (`src/cli/state-manager.ts`).
2. Skill-basierte Builds haben keine State-Persistence.

### Lösung (Repo)

**A. Repo: `src/cli/skill-session.ts` (NEU)**
- Pro Build: `research/<domain>/session.json`:
  ```json
  {
    "domain": "oral-care",
    "framer_project": "easier-train-154753",
    "wp_target": "novamira-testseite-nick-w",
    "post_id": 4956,
    "wpcode_snippets": [4958, 4961],
    "sections_done": ["header", "hero", "about-reveal", "about-stats"],
    "sections_pending": ["services", "process", "before-after", "team", "contact"],
    "css_round": 3,
    "last_action": "fix-css3.mjs",
    "timestamp": "2026-07-26T13:45:00Z"
  }
  ```
- `npx clone-v3 session resume <domain>` — lädt State, schlägt nächsten Schritt vor.
- `npx clone-v3 session update <domain> <key> <value>` — aktualisiert State.
- Jedes Deploy/CSS-Fix-Script aktualisiert automatisch den Session-State.

**Priorität:** P3 — nice-to-have, verhindert Progress-Verlust.

---

## Priorisierung (implementierungsreihenfolge)

| Prio | Problem | Lösung | Aufwand | Impact |
|---|---|---|---|---|
| **P1** | 1 (Settings rendern nicht) | v3-setting-validator + render-compat-Tabelle | mittel | Jeder Build |
| **P1** | 2 (Kein Render-Preview) | elementor-render-preview (Plugin) + section-render-check | mittel-hoch | Jeder Build |
| **P1** | 6 (WPCode fragil) | wpcode-helper + wpcode-recipe | gering | Jeder Build |
| **P2** | 3 (CSS als Source of Truth) | setting-first-policy + editability-score | mittel | Editability-Ziel |
| **P2** | 4 (Deep Nesting) | flatten-tree + nesting-audit | gering-mittel | CSS-Zuverlässigkeit |
| **P2** | 5 (Kein strukturiertes Visual-Feedback) | geometry-probe + visual-diff-structured | mittel | QA für nicht-vision |
| **P2** | 7 (Kein Setting-Map) | framer-to-elementor-setting-map + framer-tree-to-v3 | mittel | Jeder Build |
| **P2** | 9 (Kein Token-Pipeline) | framer-token-pipeline | mittel | Jeder Build |
| **P2** | 11 (Deploy nicht automatisiert) | novamira-client + deploy-CLI | gering-mittel | Setup-Zeit |
| **P3** | 8 (Component-Drill unvollständig) | framer-component-resolver + cms-resolver + code-component-library | hoch | Builds mit CMS/Code-Components |
| **P3** | 10 (Keine Section-Templates) | section-templates + section-classifier | hoch | Ab 3. Build |
| **P3** | 12 (Kein Session-State) | skill-session | gering | Resume-Komfort |

**Empfohlene erste 3 (größter Return pro Aufwand):**
1. **WPCode-Helper** (P1, gering) — eliminiert 5 reproduzierbare Fehlerquellen.
2. **Render-Compat-Tabelle + Setting-Validator** (P1, mittel) — eliminiert Blind-Build.
3. **Geometry-Probe (generalisiert)** (P2, gering) — macht QA für nicht-vision-Modelle nutzbar.

---

## Was an der Novamira-Plugin-Seite helfen würde (Plugin-Verbesserungen)

Diese sind Vorschläge für das `WordPress_mcp_adrian`-Repo (Novamira-Plugin), nicht für `site-clone-to-v3`:

1. **`novamira/elementor-render-preview`** — rendere einzelnes Element/Section, return HTML + computed styles. (Problem 2)
2. **`novamira-adrianv2/wpcode-validate`** — validiere Snippet vor Speichern (Location, kses, private Props). (Problem 6)
3. **`novamira-adrianv2/setting-render-check`** — input: Element + Setting → output: rendert dieses Setting unter V4? (Problem 1)
4. **`novamira-adrianv2/kit-apply-typography`** — setze Kit-Typography aus Token-Set (Font-Family + Size + Weight + Line-Height + Letter-Spacing in einem Call). (Problem 9)
5. **`novamira-adrianv2/section-template-deploy`** — deploye eine vorgetestete Section aus einer Template-Library + Parameter-Set. (Problem 10)
6. **`novamira-adrianv2/geometry-probe`** — input: Selectoren + erwartete Styles → output: actual Styles + Diff. (Problem 5)

---

## Was am Skill (`framer-to-elementor-v3`) helfen würde

1. **`references/v3-v4-render-compat.json`** — maschinenlesbare Render-Kompatibilitäts-Tabelle. (Problem 1)
2. **`references/setting-render-matrix.md`** — Setting vs. CSS-Fallback Entscheidungstabelle. (Problem 3)
3. **`references/wpcode-recipe.md`** — autoritative WPCode-Konfigurations-Tabelle. (Problem 6)
4. **`references/framer-setting-map.json`** — Framer-Attribut → Elementor-Setting Mapping. (Problem 7)
5. **Skill §0 Hard Rules erweitern:** "Setze `typography_typography: custom` bei jedem `typography_font_size`." (Problem 1)
6. **Skill §3.4 Container Rules erweitern:** "Max-Depth 3. Container nur für Layout, nicht für Wrapping." (Problem 4)
7. **Skill §4.3 WPCode:** "Footer IMMER `site_wide_footer`, nie `site_footer`." (Problem 6)
8. **Skill §5 QA erweitern:** "Geometry-Probe vor Visual-Diff. Setting-Render-Check vor Done." (Problem 5)

---

## Messbare Ziele (nach Implementierung)

| Metric | Oral Care (jetzt) | Ziel nach P1+P2 | Ziel langfristig |
|---|---|---|---|
| Build-Zeit (Framer→Live) | ~3 h | ~1 h | ~30 min |
| CSS-Patch-Runden | 5 | 1-2 | 0 (Setting-first) |
| Editability-Score (Setting-driven %) | ~10 % | ~50 % | ≥ 70 % |
| Visuelle Treffer (Geometry-Probe) | ~60 % | ~85 % | ≥ 90 % |
| Setup-Zeit pro Build (MCP+WPCode) | ~30 min | ~5 min | ~1 min (CLI) |
| Manuelle Scripts pro Build | 8 | 2 (deploy + qa) | 1 (`npx clone-v3 framer-build`) |


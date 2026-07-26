# Improvements for Future Framer → Elementor V3 Conversions

**Created:** 2026-07-26 · **Context:** Oral-Care-Build (erstes Projekt mit Unframer MCP + Novamira MCP + opencode)
**Purpose:** Friction-Punkte aus diesem Build festhalten, damit zukünftige Framer-Konvertierungen reibungsloser laufen.

---

## 1. MCP-Setup & Target-Verwaltung

### Problem
- Novamira-MCP-Server in opencode erfordert manuelles Editieren von `~/.config/opencode/opencode.json` + **kompletten opencode-Neustart** (Reconnect reicht nicht, da MCP-Server nur beim Session-Start geladen werden).
- Keine Vorab-Prüfung der Credentials. In diesem Build wurden zwei ungültige Application Passwords durchprobiert, bevor ein gültiges kam — jeder Versuch = ein opencode-Neustart.
- `list_mcp_resources` zeigt nur Server mit Resources; Novamira hat nur Tools → Verbindung muss via Tool-Aufruf verifiziert werden, nicht via Resource-Listing.

### Verbesserung
- **`clone-v3 add-target`** (CLI) soll Novamira-Targets verwalten:
  - Prompt für URL/Username/Application-Password
  - **Vorab-Validierung** der Credentials gegen `/wp-json/wp/v2/users/me` (Basic Auth) **bevor** Config geschrieben wird
  - Schreiben in `opencode.json` `mcp.<name>` Block (oder separater Targets-Store)
  - Hinweis: "opencode neu starten, damit MCP lädt"
- **`clone-v3 check-target <name>`** — testet eine bestehende Config gegen die WP-API ohne opencode-Neustart.
- Optional: Health-Check-Fähigkeit im Novamira-Plugin, die `novamira/health` ohne Auth zurückgibt (Status + Plugin-Version), damit Verbindungsprobleme von Auth-Problemen unterscheidbar sind.

---

## 2. Bild-/Screenshot-Eingabe

### Problem
- Das ausführende Modell (GLM-5.2 via Baseten) unterstützt **keine Bild-Eingabe**. Screenshots können nicht visuell analysiert werden.
- "Framer-pur" Modus funktioniert, weil Unframer MCP die Quelle ist — aber Hybrid/Screenshot-only ist blockiert.
- Visual-QA (Side-by-Side-Vergleich Build vs. Referenz) kann nicht manuell vom Modell durchgeführt werden.

### Verbesserung
- **Framer-Source-Modus als Default**, wenn ein Framer-Projekt via Unframer MCP verfügbar ist — dann ist die Framer-XML die Source of Truth, Screenshots nur für finale Human-QA.
- **Automatisierte Visual-QA** (`scripts/visual-diff.mjs` mit Playwright + pixelmatch) statt modell-basierter Bildanalyse — läuft headless, gibt Score zurück.
- **Geometry-Probes** (Playwright computed styles) für kritische Checks: Header-Alpha, Button-Höhe, Flex-Child-Width — ohne Bildanalyse.
- Für Hybrid-Modus ohne Framer-Zugriff: **vision-fähiges Modell** für QA-Schritt nutzen (z. B. Claude mit Vision), Build selbst mit nicht-vision-Modell.
- Optional: Screenshot-to-text-Extraktion (OCR + Layout-Beschreibung) als Vorverarbeitung, damit nicht-vision-Modelle trotzdem Layout-Infos bekommen.

---

## 3. Unframer MCP als primäre Quelle (statt Playwright-Scraping)

### Problem
- Aktuelle Pipeline (`src/extractor/playwright-extractor.ts`) scraped die **live URL** — für Framer-Sites ist das schlechter als direkter MCP-Zugriff:
  - Live-URL hat hydratisierte React-DOMs, Animation-States, lazy Content
  - Unframer MCP liefert **exakte Projekt-Struktur** (Components, Variants, Code-Components, TextStyles, ColorStyles, framerusercontent-Bild-URLs)
  - Component-Variants (z. B. Service Card `hSmEulJuz`) sind über MCP sichtbar, über Scraping nur als gerendertes HTML

### Verbesserung
- **Neuer Extractor `src/extractor/framer-mcp-extractor.ts`** — nutzt Unframer MCP statt Playwright:
  - `framer_getProjectXml` → Pages + Components + ColorStyles + TextStyles
  - `framer_getNodeXml` pro Page → Section-Baum
  - Rekursiver Component-Drill: für jede `componentId` im Page-XML → `framer_getNodeXml` → Variant-Settings
  - `framer_readCodeFile` für Code-Components (BeforeAfter-Slider, Text-Reveal) → JS-Logik für WPCode-Port
  - `framer_getComponentInsertUrlAndTypes` für Component-Props
  - Map Framer-Attribute → V3-Widget-Settings (Token-Mapping existiert schon in `src/analysis/token-mapping.ts`)
- **Framer-Source-Detection**: wenn `--framer-project` Flag oder Unframer MCP verbunden → verwende Framer-Extractor, sonst Playwright.
- Vorteil: keine Playwright-Abhängigkeit, keine hydratisierte-DOM-Probleme, exakte Tokens.

---

## 4. Component-Drill-Automatisierung

### Problem
- Jede Framer-Component auf der Page braucht einen separaten `framer_getNodeXml`-Aufruf. Für die Oral-Care-Page: ~10 Sections mit ~8 Component-Instanzen (Header, ServiceCard, Achievement, SectionTag, ButtonPrimary, FeatureAccordion, TeamCard, BeforeAfterSlider, TextReveal, LineAnimation) = 8+ Round-Trips.
- Component-Variants (z. B. `variant="hSmEulJuz"`) müssen aus dem Component-XML extrahiert werden, um die korrekten Settings zu finden.

### Verbesserung
- **Batch-Component-Resolver** — ein Skript, das:
  1. Page-XML parst, alle `componentId` + `variant` sammelt
  2. Für jede eindeutige Component `framer_getNodeXml` aufruft (dedupliziert)
  3. Pro Variant die relevanten Settings extrahiert
  4. Ein `component-resolved.json` ausgibt mit allen Component-Definitionen + Variant-Maps
- Reduziert 8+ manuelle Drill-Calls auf 1 Skript-Aufruf.
- Caching: Component-Definitionen ändern sich selten → einmal pro Projekt fetchen, wiederverwenden.

---

## 5. Framer-Code-Component → WPCode-Bibliothek

### Problem
- Framer-Code-Components (BeforeAfterImageSlider `MqsJ8o1`, Text_reveal `iPXuyQF`, LineAnimation `ghsCP0klE`) müssen manuell als JS in WPCode nachgebaut werden.
- Keine Wiederverwendung zwischen Builds — jedes Projekt baut den Slider neu.

### Verbesserung
- **WPCode-Snippet-Bibliothek** im Repo (`src/builder/framer-code-components/`):
  - `before-after-slider.js` — Drag-Compare-Slider (2 image-Widgets + JS)
  - `text-reveal.js` — Scroll-basierte Word-by-Word-Opacität (GSAP + SplitText)
  - `line-animation.js` — animierte Linie (SVG + ScrollTrigger)
  - `smooth-scroll.js` — Framer `SmoothScroll`-Äquivalent (Lenis oder native)
- Jede als parametrisierbares Snippet (Selektor-Klassen als Variablen), deploybar via `novamira-adrianv2/create-wpcode-snippet`.
- Mapping-Tabelle Framer-CodeComponent-Name → WPCode-Snippet-Datei.
- Reduziert Code-Component-Build von ~30 min auf 1 Skript-Aufruf.

---

## 6. Header / Footer / Page-Wrapper-Ebene

### Problem
- Die Homepage-XML (`framer_getNodeXml` auf Page-Node) enthielt **keinen Header** — die `Header`-Component existiert aber im Projekt.
- Header/Footer sind vermutlich auf einer **Page-Wrapper-Ebene** (Breakpoint-Root oder Template-Ebene), nicht im Main-Content-Flow.
- Risiko: Header wird übersehen, wenn nur der Page-Node gelesen wird.

### Verbesserung
- **Wrapper-Ebenen-Check** — nach `framer_getProjectXml` prüfen, ob es Component-Instanzen gibt, die auf der Page referenziert werden aber nicht im Page-XML auftauchen (z. B. Header, Footer, Menu).
- Dokumentieren: Framer-Seiten können Overlay-Elemente (fixed Header, floating nav) auf Canvas-Root-Ebene haben — explizit danach suchen.
- Skill `framer-to-elementor-v3` §1.2 Tooling-Checkliste erweitern: "Header/Footer-Component im Projekt vorhanden? → getNodeXml darauf, auch wenn nicht im Page-XML."

---

## 7. WPCode Dual-Write & Page-Guard

### Problem
- Dual-Write (`post_content` + `wpcode_snippets` Option) ist manuell und fehleranfällig — vergisst man die Option-Sync, bleibt die Live-Site auf altem CSS/JS.
- Page-Guard (`body.page-id-N`) wird oft vergessen → site-weite Snippets verschmutzen andere Seiten.

### Verbesserung
- **`src/builder/wpcode-helper.ts`** (entspricht P2 im Backlog) — kapselt:
  - `create-or-update-snippet(name, code, location, pageId)` → macht automatisch dual-write
  - `page-guard(code, pageId)` → wrappt JS/CSS automatisch mit `body.page-id-N` Check
  - Validierung vor Deploy: Snippet-Code enthält Page-Guard? (sonst Warning)
- CLI-Flag `--auto-page-guard` hängt Guard automatisch an alle Footer-Snippets.

---

## 8. V3-Tree-Deploy vs. batch-build-page

### Problem
- `site-clone-pipeline.md` warnt explizit: `batch-build-page` **nicht** verwenden (dropt nested V3 elements silent).
- Empfohlen: `elementor-inject-calibrated-page` oder `create-upload-link` + `execute-php` für große Bäume.
- Keine automatische Entscheidungshilfe, wann welche Route nötig ist.

### Verbesserung
- **Deploy-Router** in `src/mcp/wp-push.ts`:
  - Schätze Payload-Größe (Bytes des `_elementor_data` JSON)
  - < 256 KB → `elementor-inject-calibrated-page` (ein Call)
  - ≥ 256 KB → `create-upload-link` + PUT + `execute-php` (sandbox-Route)
  - **Nie** `batch-build-page` für V3 (hard rule, already in skill)
- Logging: welche Route gewählt + warum.

---

## 9. Flex-Width / V4-Engine-Gotchas automatisieren

### Problem
- V4-Engine rendert V3-Data mit V4-Markup (`e-con-full`, `e-flex`, kein `.e-con-inner` auf full-width). CSS-Selektoren müssen das berücksichtigen.
- Flex-Row-Children ohne Width stacken zu 100% — häufigster Layout-Bug.
- Diese Gotchas sind im Skill dokumentiert, aber manuelles Anwenden fehleranfällig.

### Verbesserung
- **Post-Build-Guard `v4-engine-width-fix`** — nach Deploy:
  - Lese Page-HTML via Playwright
  - Finde `e-con-full` Children in Row-Layouts ohne explizite Width
  - Generiere per-data-id CSS mit Width-Fix automatisch
  - Hänge an Header-WPCode-Snippet an
- **V4-Engine-CSS-Cheat-Sheet** als maschinenlesbare Regel-Datei (`references/v4-engine-rules.json`) → Generator baut page-scoped CSS daraus.

---

## 10. Token & Font-Setup automatisieren

### Problem
- Framer ColorStyles + TextStyles manuell in Elementor Kit + Fonts-Plugin + WPCode Google-Fonts-Link zu übertragen ist repetitiv.
- Fonts: Bricolage Grotesque, Inter, Figtree, Jost, Gilda Display — 5 Fonts, jeder braucht Google-Fonts-Link + Fonts-Plugin-Eintrag + Kit-Typography.

### Verbesserung
- **`framer-tokens-to-elementor-kit`** — Skript:
  - Lese `framer_getProjectXml` ColorStyles + TextStyles
  - Generiere Kit-Colors via `novamira-adrianv2/...` (oder `set-active-kit` + Kit-Settings)
  - Generiere Fonts-Plugin-Einträge (`ogf_custom_fonts` Taxonomy) für jede Font-Family
  - Generiere WPCode Google-Fonts-`<link>` Header-Snippet (dual-write, page-guarded)
  - Generiere Kit-Typography mit Font-Family + Size + Line-Height + Letter-Spacing
- Reduziert Token-Setup von ~45 min auf 1 Skript-Aufruf.

---

## 11. QA-Loop-Integration

### Problem
- QA-Checkliste ist manuell (`references/qa-checklist.md`). Visual-QA via `scripts/visual-diff.mjs` existiert, ist aber nicht in den Build-Flow integriert.
- "Done" wird oft zu früh gerufen (MCP `success: true` ≠ sichtbares Resultat).

### Verbesserung
- **`clone-v3 qa <page-id>`** — führt automatisch aus:
  - `novamira-adrianv2/visual-qa` + `layout-audit` + `page-audit`
  - `scripts/visual-diff.mjs` (desktop + mobile) gegen Framer-Live-URL
  - Geometry-Probes (Header-Alpha, Button-Höhe, Flex-Child-Width)
  - HTML-Budget-Check (html-Widgets / total ≤ 0.15)
  - Cache-Status-Check (`has_element_cache`)
  - Score-Report mit Scorecard V/E/T/R/M (aus `SCORECARD-V1-FROM-STRONGER-AI.md`)
- **Hard-Floor-Gate**: E ≥ 70 und M ≥ 60, sonst nicht "done".

---

## 12. Projekt-Config & Section-Class-Prefixe

### Problem
- Skill §11 sagt: "Use stable section classes chosen per project (document in run report)" — aber kein Mechanismus, sie zu speichern/wiederzuverwenden.
- Hardcodierte Client-Klassennamen sind Anti-Pattern (Skill §8).

### Verbesserung
- **`clone.config`** pro Projekt (`research/<domain>/clone.config.json`):
  ```json
  {
    "sectionClassPrefix": "oc",  // Oral Care
    "sections": ["hero", "about", "services", "process", "before-after", "team", "contact"],
    "tokens": { "primary": "#D1FC71", "dark": "#0D1B15", ... },
    "fonts": ["Bricolage Grotesque", "Inter", "Figtree", "Jost", "Gilda Display"],
    "framerProject": "easier-train-154753",
    "wpTarget": "novamira-testseite-nick-w"
  }
  ```
- Generator nutzt `<prefix>-<section>` für alle CSS-Klassen → keine Kollisionen, keine hardcodierten Client-Namen im Core.

---

## 13. Session-Handoff & Resume

### Problem
- `docs/SESSION-HANDOFF.md` ist manuell gepflegt — bei vielen Builds pro Projekt unübersichtlich.
- Resume nach Abbruch nur via `state.json` (automatisierte Pipeline), nicht für Skill-basierte Builds.

### Verbesserung
- **`clone-v3 session <action>`**:
  - `start` — legt `research/<domain>/session.md` an (Brief, Tokens, Sections, WPCode-IDs, QA-Status)
  - `update <section> <status>` — aktualisiert Section-Status
  - `handoff` — generiert `SESSION-HANDOFF.md` automatisch aus Session-State
  - `resume <domain>` — lädt Session-State und schlägt nächsten Schritt vor
- Ein Skript-Aufruf statt manuelle MD-Pflege.

---

## Priorisierung (Vorschlag für Backlog)

| # | Verbesserung | Impact | Aufwand | Empfehlung |
|---|---|---|---|---|
| 1 | MCP-Setup-CLI + Credential-Pre-Check | hoch (jeder Build) | gering | **P1 — sofort** |
| 3 | Framer-MCP-Extractor | hoch (exakte Quelle) | mittel | **P2 — nächstes** |
| 4 | Component-Drill-Automatisierung | hoch (Zeitersparnis) | gering | **P2 — neben P2** |
| 5 | WPCode-Code-Component-Bibliothek | mittel (nur bei Code-Components) | mittel | P3 |
| 10 | Token & Font-Setup-Automatisierung | hoch (jeder Build) | mittel | P3 |
| 7 | WPCode Dual-Write-Helper | hoch (Bug-Prävention) | gering | P3 (bereits P2 im Backlog) |
| 9 | V4-Engine-Width-Fix-Guard | hoch (häufigster Bug) | gering | P4 |
| 8 | Deploy-Router | mittel | gering | P4 |
| 11 | QA-Loop-Integration | hoch (Done-Gate) | mittel | P4 |
| 6 | Wrapper-Ebenen-Check | gering (selten) | gering | P5 |
| 12 | Projekt-Config | mittel | gering | P5 |
| 13 | Session-Handoff-Automatisierung | gering | gering | P5 |
| 2 | Bild-Eingabe-Workaround | hoch für nicht-vision-Modelle | — | **Betrieb: Framer-pur-Modus default** |

---

## Quick-Wins für den nächsten Build (sofort umsetzbar)

1. **Framer-pur als Default**, wenn Unframer MCP verbunden — Screenshots nur für finale Human-QA.
2. **Vorab Credential-Check** gegen `/wp-json/wp/v2/users/me` bevor Config geschrieben wird (Skript ~20 Zeilen).
3. **Component-Drill-Skript** — einmal `framer_getProjectXml`, dann für jede Component `framer_getNodeXml` in einer Schleife → `component-resolved.json`.
4. **Wrapper-Ebenen-Check** — nach Page-XML: Component-IDs im Projekt, die nicht im Page-XML auftauchen aber Header/Footer heißen → separat drillen.
5. **V4-Engine-Width-Fix** als Standard-Post-Deploy-Step — CSS für alle `e-con-full` Row-Children ohne Width.

---

## Verwandte Docs (Repo)

- `docs/AI-EXECUTOR-PLAYBOOK.md` — Praxis-Pipeline
- `docs/PRODUCT-BACKLOG-P1-P10.md` — Produkt-Backlog (P2 = WPCode-Helper, P4 = widget-first-guards)
- `docs/SCORECARD-V1-FROM-STRONGER-AI.md` — Ship-Metriken
- `docs/SESSION-HANDOFF.md` — Session-Übergabe
- `skills/framer-to-elementor-v3/references/v4-engine.md` — V4-Engine-CSS-Regeln
- `skills/framer-to-elementor-v3/references/component-playbooks.md` — Build-Anleitungen

---

## 14. Learnings aus dem Oral-Care-Build (2026-07-26, live eingetreten)

Diese Punkte sind während des echten Builds aufgefallen — in den ursprünglichen 13 Punkten nicht erfasst.

### 14.1 `css_classes` muss STRING sein, nicht Array
- **Symptom:** Container-Klassen renderten als Literal `"Array"` im class-Attribut (`class="... e-con-full Array e-flex ..."`).
- **Ursache:** Tree-Builder nutzte `css_classes: ["oc-header"]` (Array). V4-Engine gibt Arrays als PHP `"Array"`-String aus.
- **Fix:** `css_classes: "oc-header"` (space-getrennter String bei mehreren Klassen).
- **Verbesserung:** Guard im Tree-Builder, der `css_classes`-Werte auf String erzwingt. Generator-Doku anpassen.

### 14.2 `create-wpcode-snippet` — `priority` ist private property
- **Symptom:** `Cannot access private property WPCode_Snippet::$priority` → Snippet-Erstellung schlägt fehl.
- **Fix:** `priority`-Feld weglassen (Skill erwähnt das schon, aber nicht prominent genug).
- **Verbesserung:** WPCode-Helper (P2 im Backlog) soll `priority` automatisch weglassen + nur via `update-wpcode-snippet` setzen wenn nötig.

### 14.3 MCP HTTP-Transport braucht `Mcp-Session-Id` Header
- **Symptom:** Direkte JSON-RPC-Calls ab dem 2. Request geben 400/404.
- **Ursache:** Novamira MCP nutzt Streamable-HTTP-Transport — der `initialize`-Response liefert `Mcp-Session-Id`-Header, der bei allen Folgerequests mitgesendet werden muss.
- **Fix:** Session-ID aus `initialize`-Response-Header capturen und in `Mcp-Session-Id`-Header bei jedem Folgerequest setzen.
- **Verbesserung:** Deploy-Helper-Skript (`research/<domain>/deploy.mjs` Template) kapselt das — als Standard-Deploy-Weg dokumentieren.

### 14.4 `notifications/initialized` wird vom Novamira-Server nicht unterstützt
- **Symptom:** 404 "Method not found: notifications/initialized".
- **Fix:** Optional — try/catch um den Notification-Call, bei Fehler einfach weiter.
- **Verbesserung:** Deploy-Helper soll Notification überspringen können (Server-spezifisch).

### 14.5 `execute-php` Document-API-Save schlägt fehl ("Call to undefined method")
- **Symptom:** `$plugin->documents->create('wp-page', ...)` oder `$doc->save(['elements' => ...])` wirft "Call to undefined method".
- **Ursache:** Elementor 4.2.0 interne API hat sich geändert — die alte Document-API-Save-Signatur stimmt nicht mehr.
- **Fix:** `elementor-inject-calibrated-page`-Ability nutzen (empfohlen) — sie kapselt die korrekte Save-Route inkl. Lock-Check + CSS-Rebuild. Rohes `execute-php` für Tree-Save vermeiden.
- **Verbesserung:** Skill §4.2 "Full tree" schonend klarstellen: **immer** `elementor-inject-calibrated-page`, niemals rohes execute-php für `_elementor_data`.

### 14.6 `elementor-inject-calibrated-page` nimmt inline `_elementor_data`-Array
- **Lösung gefunden:** Statt Upload-Link + execute-php kann `elementor-inject-calibrated-page` den Tree direkt als JSON-Array-Parameter nehmen — auch bei 58 KB / 9 Sections / ~140 Elementen. Upload-Link-Pfad ist nur für >256 KB nötig.
- **Verbesserung:** Deploy-Router (Punkt 8) Schwellwert auf ~256 KB setzen; darunter inline `elementor-inject-calibrated-page`.

### 14.7 Header war KEIN Floating-Glass (Skill-Pattern A passte nicht)
- **Symptom:** Skill-Pattern A (floating glass pills) wurde als Default angenommen — der echte Framer-Header war eine solide weiße Nav-Bar (maxWidth 1300px, borderRadius 8px).
- **Fix:** Header-Komponente (`s7_UXSBBA`) vorab per `framer_getNodeXml` drillen — nicht vom Skill-Default ausgehen.
- **Verbesserung:** Skill §1.2: "Header immer drillen, nie Pattern-A als Default annehmen."

### 14.8 Leaf-Komponenten nicht drillbar ("Node is not a text node")
- **Symptom:** `framer_getNodeXml` auf `bV7kHxHjX` (ServiceCard), `kV7i00hEu` (Achievement), `OKnEWeVuW` (SectionTag), `EqKx76Nda` (ButtonPrimary) → "Node is not a text node".
- **Workaround:** Instance-Props aus dem Page-XML reichen (Text, Farben, Links stehen im Component-Instanz-Block). Component-Definition nur nötig für komplexe Multi-Variant-Komponenten (Header, FeatureAccordion).
- **Verbesserung:** Component-Drill-Skript (Punkt 4) soll Leaf-Komponenten überspringen + Instance-Props aus Page-XML nutzen.

### 14.9 Team-Grid hatte nur 1 Card im XML (CMS-driven)
- **Symptom:** Framer-Page-XML zeigte 6-Slot-Grid (3×2) aber nur 1 TeamCard-Instanz (`Dr. Julien Lefèvre`). Andere 5 sind CMS-Collection-driven (nicht im statischen XML).
- **Fix:** 1 echte Card + 5 Platzhalter-Cards gebaut, User kann füllen.
- **Verbesserung:** Framer-CMS-Collections separat fetchen (`framer_getCMSItems` falls Collection-ID bekannt) — sonst Platzhalter + Warnung im Build-Report.

### 14.10 `wp_page_template: "elementor_canvas"` funktioniert über `elementor-inject-calibrated-page`
- **Lösung:** Der Ability-Parameter `wp_page_template` setzt das Template direkt — kein separater execute-php-Call nötig. Full-bleed Framer-Clone ohne Theme-Header-Chrome.
- **Verbesserung:** Im Skill §3.1 dokumentieren: `wp_page_template: "elementor_canvas"` als Ability-Parameter, nicht als separater Step.

### 14.11 Kontakte-Sektion ohne Form (User-Wunsch)
- **Lösung:** Nur rechte "Get in Touch"-Seite gebaut (heading + text-editor + icon-box für Phone/Email/Hours), linke Form weggelassen.
- **Verbesserung:** Skill §3.3: "Form-Deploy ist optional — User kann Form weglassen, nur Kontakt-Infos bauen."

### 14.12 Code-Components als WPCode portiert (BeforeAfter + TextReveal)
- **Lösung:** `framer_readCodeFile` lieferte vollen React-Source → nach Vanilla-JS portiert in Footer-WPCode.
  - BeforeAfter: 2 image-Widgets + CSS-clip-path + JS-Drag-Handler (widget-first, kein HTML-Bild-Dump)
  - TextReveal: word-split + GSAP ScrollTrigger scrub (Manifesto-Pattern aus Skill)
- **Verbesserung:** Punkt 5 (WPCode-Code-Component-Bibliothek) bestätigt — diese zwei als erste Einträge.

### 14.13 WPCode Location: `site_wide_footer` nicht `site_footer`
- **Symptom:** Footer-Snippets mit `location: "site_footer"` rendern nicht (nicht injiziert). Header mit `site_wide_header` funktionierte.
- **Ursache:** WPCode kennt `site_wide_header` + `site_wide_footer` (und `site_wide_body`). `site_footer` ist eine andere/ungültige Taxonomy-Location.
- **Fix:** Footer-Snippets IMMER mit `location: "site_wide_footer"` erstellen.
- **Verbesserung:** WPCode-Helper (P2) soll die korrekten Location-Slugs hartkodieren: `site_wide_header` / `site_wide_footer`. Nie `site_footer` verwenden.

### 14.14 WPCode kses stript Inline-`<script>` aus HTML-Snippets
- **Symptom:** HTML-Snippet mit `<script src="cdn">` (extern) rendert, aber `<script>inline code</script>` wird entfernt.
- **Ursache:** WPCode kses-Filterung erlaubt externe Script-Tags, entfernt aber Inline-Script-Content.
- **Fix:** `code_type: "html"` mit `location: "site_wide_footer"` — bei dieser Kombination wird der Inline-Code ERHALTEN (im Gegensatz zu `site_footer`). Die ClinicHub-Snippets beweisen das. `bypass_kses: true` funktioniert nicht (Post-Typ-Konflikt).
- **Verbesserung:** Im Skill §4.3 dokumentieren: Footer-Snippets = `code_type: "html"` + `location: "site_wide_footer"` für Inline-JS.

### 14.15 Elementor Widget-`typography_font_size` wird ignoriert ohne `typography_typography: "custom"`
- **Symptom:** Heading-Widgets hatten `typography_font_size: {unit:"px", size:64}` in den Settings, aber gerendert wurde Theme-Default (24px).
- **Ursache:** Elementor wendet Custom-Typography nur an, wenn `typography_typography: "custom"` gesetzt ist. Ohne diesen Flag sind alle `typography_*` Settings wirkungslos.
- **Fix (quick):** Alle Font-Sizes via page-scoped CSS mit `!important` überschrieben (Selector: `h2.elementor-heading-title`, NICHT `h2 .elementor-heading-title` — siehe 14.16).
- **Fix (proper):** Tree-Builder muss `typography_typography: "custom"` zu jedem Heading/Text-Editor Setting hinzufügen, wenn Custom-Typography gewünscht.
- **Verbesserung:** Tree-Builder-Helper (`heading()`, `textEditor()`) setzen automatisch `typography_typography: "custom"` wenn `typography_font_size` übergeben wird.

### 14.16 CSS-Selector: `h2.elementor-heading-title` nicht `h2 .elementor-heading-title`
- **Symptom:** CSS-Regel `body.page-id-N .oc-section h2 .elementor-heading-title { font-size: 64px }` existiert im Stylesheet, greift aber nicht.
- **Ursache:** `h2 .elementor-heading-title` (mit Leerzeichen) = Nachkomme-Selektor: ein `.elementor-heading-title`-Element INNERHALB eines h2. Aber das h2 selbst TRÄGT die Klasse `elementor-heading-title` — es enthält kein weiteres Element mit dieser Klasse.
- **Fix:** `h2.elementor-heading-title` (ohne Leerzeichen = UND-Selektor) oder einfach `.elementor-heading-title` mit Section-Scope.
- **Verbesserung:** CSS-Generator-Helper für Heading-Selektoren: immer `tag.elementor-heading-title` (ohne Leerzeichen).

### 14.17 Widget `css_classes` rendert nicht (nur Container)
- **Symptom:** `css_classes: "oc-reveal-text"` auf einem text-editor-Widget erschien nicht im HTML. Container-`css_classes` funktionierten.
- **Ursache:** Entweder V4-Engine stript Widget-`css_classes`, oder das Setting-Format für Widgets unterscheidet sich.
- **Fix:** Statt Widget-Klassen zu nutzen, Section-Scoped-Selektor: `.oc-about-reveal .elementor-widget-text-editor .elementor-widget-container`.
- **Verbesserung:** Tree-Builder für Widgets: `css_classes` auf Widgets meiden, stattdessen Section-Container-Klasse + Positionsbasierter Selektor in CSS.

---

## Build-Status Oral Care (2026-07-26)

| Section | Status | Bemerkung |
|---|---|---|
| Header | ✅ deployed | Solide weiße Nav-Bar (kein Floating-Glass) |
| Hero | ✅ deployed | BG-Image + Overlay + H1 + 2 Buttons |
| About-Reveal | ✅ deployed | Text-Reveal via GSAP-Scrub (JS-injected) |
| About-Stats | ✅ deployed | Image + Text + 4 Stats (Width-Fix via CSS) |
| Services | ✅ deployed | 3 Service-Cards (1 aus XML + 2 inferiert) |
| Working-Process | ✅ deployed | Header + 4-Step-Accordion (native) |
| Before-After | ✅ deployed | 2 image-Widgets + WPCode-Drag-Slider |
| Team | ✅ deployed | Grid 3×2 (1 echte + 5 Platzhalter-Cards) |
| Get-in-Touch | ✅ deployed | Heading + Text + 3 Icon-Boxes (kein Form) |

- **Page:** https://testseite.nick-webdesign.de/oral-care/ (post_id 4956)
- **WPCode Header:** snippet_id 4958 (Fonts + page-scoped CSS)
- **WPCode Footer:** snippet_id 4959 (GSAP + Text-Reveal + Slider)
- **HTML-Budget:** 2/95 = 2,1 % (unter 15 %)
- **Deploy-Route:** `elementor-inject-calibrated-page` (inline, 58 KB)
- **Caches:** invalidated (post_css, files_manager_global, post_meta_cache)


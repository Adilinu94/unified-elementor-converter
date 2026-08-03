# Umbauplan: Framer → Elementor V3 mit belastbarer visueller Verifikation

**Plattformziel:** Beliebige Framer-Projekte zuverlässig als editierbare Elementor-V3-Seiten rekonstruieren
**Fallstudie:** Gelaf Golf Club (`https://swift-teacher-216675.framer.app/`)
**Ziel:** Elementor V3 auf dem Novamira-WordPress-Ziel und kompatiblen V3-Targets
**Ausgangslage:** Die Gelaf-Testseite ist eine wichtige Regression, aber nicht das Produktziel. Ihr erster echte Live-Vergleich erreicht nur **26,03 % Pixelmatch** im Desktop-Fold und zeigt konkrete Fehlerklassen, die für die generische Plattform behoben werden müssen.
**Status dieses Dokuments:** Plattformweiter Umbau- und Qualitätsplan. Gelaf darf als isoliertes Testziel mutiert werden; Produktionsseiten bleiben ausgeschlossen.

---

## 1. Zieldefinition

Das Ziel ist nicht nur ein gültiger Elementor-JSON-Tree. Ziel ist eine **visuell und strukturell nachvollziehbare Rekonstruktion** der Quelle:

- gleiche Seitenabschnitte in gleicher Reihenfolge,
- gleiche sichtbare Inhalte und semantische Hierarchie,
- gleiche Bilder, Bildausschnitte und Bildpositionen,
- gleiche Fonts, Gewichte, Größen und Zeilenhöhen,
- gleiche Containerbreiten, Spalten, Abstände und Höhen,
- gleiche Farben, Hintergründe, Border-Radii und Shadows,
- gleiche Desktop-, Tablet- und Mobile-Varianten,
- gleiche relevante Interaktionen und Zustände, soweit Elementor V3 dies nativ abbilden kann,
- nachvollziehbare Abweichungen, wenn Framer-Verhalten in Elementor V3 nicht 1:1 möglich ist.

„Pixel-perfect“ wird dabei als **prüfbares Ziel mit klaren Grenzen** behandelt. Browser, Betriebssystem, Font-Rasterisierung, Third-Party-Assets und dynamische Inhalte können einzelne Pixel verändern. Darum wird nicht ein einziger globaler Wert als Wahrheit verwendet, sondern eine Kombination aus:

1. erreichbarem Live-Render,
2. deterministischer Screenshot-Aufnahme,
3. Pixelmatch und SSIM,
4. section-basierten Scores und Hotspots,
5. DOM-/Geometry-/Computed-Style-Vergleich,
6. Inhalts- und Asset-Parität,
7. manueller Freigabe der wenigen unvermeidbaren Differenzen.

---

## 2. Aktuelle Fakten und harte Grenzen

### 2.1 Quelle

Die Framer-Seite ist read-only erreichbar und rendert auf Desktop und Mobile. Erkannt wurden unter anderem:

1. Header / Navigation
2. Hero: „Perfect Your Swing, Elevate Your Game“
3. About: „Premium Amenities & Expert Coaching“
4. Services: Golf Training, Course & Play, Events
5. Upcoming Events: Annual Championship, Summer Tournament
6. Facilities
7. Coaches / Instructors
8. Philosophy
9. Testimonials
10. Blog / News & Articles
11. FAQ
12. Newsletter
13. Footer / Social Links

Die Quelle verwendet Satoshi und Inter sowie eine größere Anzahl definierter Farb- und Textstile. Sie enthält Komponenteninstanzen, Controls, responsive Varianten, echte Bildquellen und Framer-spezifische Layout-/Animationsdaten.

### 2.2 Bisheriger Elementor-Tree

Der bisherige reparierte Tree weist folgende strukturelle Warnsignale auf:

- 1 Top-Level-Section statt einer klaren Seitenstruktur aus vielen eigenständigen Abschnitten,
- 237 Container,
- maximale Baumtiefe 13,
- 234 Deep-Nesting-Befunde,
- 73 Spacer-Widgets,
- 63 Bild-Widgets mit URL,
- 9 Bild-Widgets ohne URL,
- 18 Buttons,
- 81 Text-Editor-Widgets,
- 0 zuverlässig erkannte Heading-Widgets im erzeugten Artefakt,
- 474 gespeicherte Elementor-Elemente.

Der Tree ist somit technisch gespeichert, aber kein Beleg für visuelle Treue.

### 2.3 Aktueller Live-Render-Befund

Post 644 ist jetzt öffentlich erreichbar und rendert unter dem finalen Pfad `/gelaf-v3-proofly-test-2026-08-01/`. Damit ist der frühere 404-Blocker aufgehoben. Der Live-Render ist jedoch eindeutig nicht visuell abnahmefähig.

**Desktop 1440 × 900, echte Quelle gegen echtes Ziel:**

| Messwert | Framer-Quelle | Elementor-Ziel |
|---|---:|---:|
| HTTP | 200 | 200 |
| Body-Länge | 818.063 Zeichen | 173.818 Zeichen |
| Seitenhöhe | ca. 12.635–12.764 px | ca. 50.352 px |
| Headings | 35 | 0 |
| Buttons/Links | 61 | 18 |
| Bilder | 71 | 54 |
| Geladene Bilder | 66 | 14 |
| Elementor-Marker | nein | ja |
| Console-/Request-Probleme | 0 / 0 | 3 / 3 |
| Desktop-Fold-Pixelmatch | — | **26,03 %** |

Der Ziel-Fold ist nicht leer, aber deutlich heller und strukturell anders: Der Ziel-Screenshot enthält etwa 52,9 % nahezu weiße Pixel gegenüber etwa 18,9 % bei der Quelle. Das bestätigt ein massives Layout-/Asset-/Style-Problem, nicht nur eine kleine Abweichung.

Die ersten Live-Artefakte liegen unter `runs/proofly-2026-08-01/visual-diff-live/` und dem fokussierten Desktop-Fold-Lauf. Diese Dateien sind gitignored; sie sind Diagnoseartefakte und kein Release-Baseline-Set.

**Konkrete Zielprobleme:**

- Nur 1 gerenderte Elementor-Section und 226 Widgets **im Browser-DOM** statt einer Section-Struktur, die die Quelle nachvollziehbar abbildet. Das ist nicht identisch mit dem gespeicherten Tree (1 Top-Level-Section / 474 Elemente).
- Keine nativen Heading-Tags bzw. Heading-Widgets im Frontend.
- Nur 14 von 54 Zielbildern sind im Browser geladen.
- Drei Elementor-Pro-CSS-Ressourcen schlagen fehl bzw. werden abgebrochen (`widget-mega-menu`, `widget-blockquote`, `widget-nav-menu`). Diese Fehler werden als Render-/Asset-Infrastrukturfehler vor dem Converter-Rebuild behandelt.
- Der Full-Page-Lauf erzeugte inkonsistente Ziel-PNG-Dimensionen: Bei einer DOM-Scrollhöhe von ca. 50.352 px wurde eine Ziel-PNG-Höhe von ca. 53.606 px und eine Breite von 1.844 px beobachtet, obwohl der Capture-Viewport 1.440 px breit war. Das ist ein eigener `captureIntegrity`-Fehler, nicht nur ein visueller Mismatch.
- Der kombinierte Desktop/Tablet/Mobile-Lauf lief länger als 300 Sekunden ohne Abschlussreport. Das ist zusätzlich ein Fehler der Capture-/Diff-Orchestrierung.
- Die Zielhöhe ist ungefähr viermal so groß wie die Quelle; die 73 Spacer und die tiefe Wrapper-Struktur sind dafür ein konkreter Verdacht.

Folgerung:

- Der Renderzugang ist **PASS**, die visuelle Abnahme ist **FAIL**.
- `visual-qa: 0 Issues` bleibt nur ein technischer Server-Check und kein Pixelmatch-Erfolg.
- Der erste Reparaturschritt ist jetzt Render-/Asset-/Struktur-Stabilisierung, nicht A11y-/SEO-Polishing.
- Ein Pixel-Diff darf bei 404, Login, Redirect, Error Page, inkonsistenten PNG-Dimensionen oder hängendem Capture keinen Score erzeugen.

---

### 2.4 Neue Live-Baseline und Prioritätsänderung

Der Plan wird ab jetzt in zwei Gates getrennt:

**Gate A — Renderbarkeit:** HTTP 2xx, korrekter finaler Pfad, Elementor-Marker, stabile Screenshot-Breite, keine kritischen CSS-/Asset-Fehler, Capture-Abschluss pro Viewport und `captureIntegrity=pass`.

**Gate B — visuelle Treue:** Section-/Heading-/Image-Parität, Seitenhöhen, Geometry, Pixelmatch, SSIM und Hotspots.

Gate A ist bei Post 644 aktuell nur **PARTIAL/FAIL**: HTTP 200 und Elementor-Marker sind vorhanden, aber drei CSS-Request-Fehler, die falsche Full-Page-PNG-Breite/Höhe und der nicht abgeschlossene kombinierte Lauf verhindern ein bestandenes Render-Gate. Gate B ist mit 26,03 % im Desktop Fold klar nicht bestanden. Deshalb gilt die neue Reihenfolge:

1. Visual-Diff-Orchestrierung begrenzen und diagnostisch machen.
2. Elementor-CSS-/Asset-Ladefehler beheben.
3. künstliche Höhe und Spacer-/Wrapper-Explosion entfernen.
4. Sections und Heading-Hierarchie neu emittieren.
5. erst danach Farben, Typografiefeinheiten und Animationen kalibrieren.

Die echte Testseite wird für jede Iteration weiterverwendet; vor jedem Write bleibt ein Snapshot Pflicht. Eine Veröffentlichung war für diesen Test bereits durch den Nutzer freigegeben.

## 3. Root-Cause-Analyse

### 3.1 Falsche aktive Pipeline

Im Repository existieren bereits robustere Extraktionsmodelle:

- `BrowserExtractionResult` mit Screenshots,
- `sections`, `y_range`, Layout und DOM-Informationen,
- `computedStyles` über mehrere Viewports,
- Font-Interception,
- Asset-Erfassung,
- CSS-Variablen und Design Tokens,
- Responsive Matrix,
- `SourceSpec`/`PageSpec`.

Der aktive Proofly-zu-V3-Pfad verwendet jedoch im Kern `framerXmlToV3()` → `convertFramerTree()` direkt. Dadurch werden die reicheren Daten nicht als verbindliche Source of Truth zwischen Extraktion und V3-Emission genutzt.

### 3.2 Bestätigter Root Cause: Unterstrich-Komponenten wurden als sichtbarer Roh-XML-Text emittiert

Die Live-DOM-Forensik hat den horizontalen Overflow auf ein konkretes Widget zurückgeführt:

- Elementor-Widget: `#framer-Fu6qgJci2` / `data-id="el_Fu6qgJc"`
- Viewport-Breite / Widget-`scrollWidth`: `1040 → 1644 px` (Desktop), `668 → 1644 px` (Tablet), `290 → 1644 px` (Mobile)
- sichtbarer Inhalt begann mit `<_01 nodeId="..." ... controls="{...}" />`
- `white-space`, `min-width`, `transform` und eine feste Widget-Breite waren **nicht** die Ursache

Der direkte XML-Parser verwendete ursprünglich:

```ts
/<(\\/?)([A-Za-z][\\w:.-]*)([^>]*?)(\\/?)>/g
```

Framer-Komponenten wie `<_01 ... />` beginnen jedoch mit `_`. Der Tag wurde deshalb nicht als Node erkannt; `appendXmlText()` übernahm den gesamten Roh-Tag als Parent-Text. Dieser Text landete im Elementor-`text-editor` und erzeugte den `1644px`-Overflow.

Der lokale Fix:

1. Beide Framer-XML-Parser akzeptieren nun `[A-Za-z_]` als Tag-Start.
2. `_`-Komponenten mit Controls werden nicht mehr als Roh-XML emittiert.
3. Bild, Label und Link werden im V3-Pfad als native `image`-/`button`-Widgets erhalten.
4. Der allgemeine Extractor verwendet für unbekannte Components einen konservativen sichtbaren Fallback statt stiller Verwerfung.
5. Regressionen decken Roh-XML-Vermeidung, Bild+Label+Link und Link-ohne-Label ab.

Lokale Verifikation: **61 fokussierte Tests**, Typecheck, Lint und `git diff --check` bestanden. Die bestehende Live-Testseite enthält noch den alten Tree; ein erneuter Deploy und Live-Capture stehen aus, weil der ursprüngliche XML-Input nicht mehr lokal vorhanden ist und die Credentials in dieser Shell nicht als Umgebungsvariablen gesetzt sind.

### 3.3 Heuristische Semantik statt explizitem Seitenmodell

`packages/target-v3/src/framer-tree-to-v3.ts` entscheidet unter anderem nach:

- `node.type`,
- Namensfragmenten wie `hero`, `section`, `button`, `cta`,
- Anzahl der Children,
- vorhandenen Text-/Bild-Controls.

Das reicht nicht für eine Framer-Seite mit Komponenteninstanzen und Wrappern. Besonders problematisch:

- Nur Top-Level-Nodes können Section werden.
- Ein unbekannter Frame mit Children wird pauschal Container.
- Ein leerer Frame wird Spacer.
- Heading-Erkennung erfolgt überwiegend aus Fontgröße statt aus semantischem Tag/Textstil/Section-Rolle.
- Komponenten-Controls werden nur teilweise rekursiv interpretiert.
- Reine Layout-Wrapper werden nicht zuverlässig von visuellen Gruppen getrennt.

### 3.3 Spacer-Fallback zerstört die Layoutbedeutung

Ein leerer Framer-Frame ist nicht automatisch ein sichtbarer Spacer. Er kann sein:

- ein absolut positioniertes Overlay,
- ein Bild-/Background-Wrapper,
- ein Layout- oder Alignment-Wrapper,
- eine Komponente, deren Inhalt separat aufgelöst werden muss,
- ein unsichtbarer technischer Node,
- tatsächlich leerer Raum.

Die pauschale Umwandlung in `spacer` erzeugt künstliche Leerflächen und verändert die vertikale Rhythmik der gesamten Seite.

### 3.4 Container-Nesting wird zu spät und zu schwach behandelt

Der Tree wird zuerst mit bis zu 20 Ebenen gebaut. Das spätere Flattening ist ein generisches Post-Processing und kennt die Quelle nicht ausreichend. Es kann Wrapper zusammenlegen, aber nicht sicher entscheiden, ob ein Wrapper visuell relevant ist, ohne dessen Layout-/Background-/Positionierungssemantik zu kennen.

Die richtige Reihenfolge ist:

1. Quelle semantisch normalisieren,
2. visuelle Layoutgruppen bilden,
3. V3-Tree mit begrenzter, absichtlicher Tiefe emitten,
4. Flattening nur als Guard-/Safety-Net verwenden.

### 3.5 Design Tokens werden nicht verbindlich angewandt

Die Quelle liefert Fonts, Textstile und Farben. Im aktuellen direkten Converter werden aber nicht alle globalen Werte in einen konsistenten Token-/Style-Kontext überführt. Einzelne Inline-Settings reichen nicht, wenn:

- Header, Body und CTA unterschiedliche Textpresets haben,
- Farben als Framer-Objekte referenziert sind,
- `font-family`/`font-weight` nicht vollständig aufgelöst werden,
- responsive Varianten nur im XML-Control liegen,
- Element- und Theme-Styles konkurrieren.

### 3.6 Responsive-Daten gehen verloren

Die Extraktionsseite besitzt `computedStyles` und `responsive-matrix.ts`. Der direkte XML-Mapper legt jedoch überwiegend Desktop-Werte an. Elementor-V3-Responsive-Suffixe und gerätespezifische Abweichungen werden nicht aus einer vollständigen, stabilen Matrix gespeist.

Das führt besonders auf Mobile zu:

- falschen Heading-Größen,
- falschen Abständen,
- nicht gestapelten Reihen,
- falschen Bildhöhen,
- überbreiten Buttons oder Content-Spalten,
- fehlenden Hide/Show-Zuständen.

### 3.7 Bild- und Background-Handling ist unvollständig

63 echte URLs werden übernommen, 9 Wrapper bleiben ohne URL. Zusätzlich sind diese Fälle getrennt zu behandeln:

- Widget-Bild versus Section-Background,
- responsive Background-Bilder,
- object-fit und object-position,
- Bildgröße und Aspect Ratio,
- Framer-optimierte CDN-URLs,
- SVG-/Icon-Assets,
- Lazy-/Poster-/Source-Attribute.

Eine Bild-URL allein garantiert nicht denselben sichtbaren Ausschnitt.

### 3.8 V3-Template-/Theme-Kontext ist visuell entscheidend

`elementor_canvas`, `elementor_header_footer` und `default` erzeugen unterschiedliche Seitenrahmen. Eine Canvas-Seite mit entferntem Theme-Header/Footer kann gegenüber einer Quelle mit eigenem Header/Footer oder anderem Body-Kontext vollständig anders aussehen.

Der Ziel-Template-Kontext muss vor dem Diff als Teil des Render-Vertrags feststehen und auf beiden Seiten vergleichbar sein.

### 3.9 Der bisherige Visual-Diff hatte mehrere methodische Schwächen

Der reparierte `scripts/visual-diff.mjs` behandelt 404 jetzt sauber als „not scored“. Für einen echten Vergleich fehlen beziehungsweise bleiben zu verbessern:

- keine authentifizierte Draft-/Preview-Session,
- keine robuste semantische Prüfung von Login-/Preview-/Error-Seiten über ein generisches Health-Check hinaus,
- festes `waitForTimeout(3000)` statt primär event-/state-basierter Stabilitätsprüfung,
- keine vollständige Font-/Image-Decode-/Layout-Stabilitätsmessung,
- keine standardisierte Animation-/Caret-/Blink-Deaktivierung im Script,
- kein einheitlicher Manifest-Vertrag mit HTTP-Status, Redirectkette, DOM-Signalen, Console- und Request-Fehlern,
- keine echte Section-Erkennung für die aktuelle Framer- und Elementor-Seite innerhalb des CLI-Laufs,
- Pixelvergleich beschneidet unterschiedliche Höhen auf die kleinere Höhe und kann dadurch reale fehlende oder zusätzliche Inhalte aus dem Score entfernen,
- die verschiedenen Diff-Engines (`pixel-diff`, `diff/index`, `visual-diff`, `structure-diff`, `visual-diff-structured`) sind nicht auf einen kanonischen Live-Vergleich vereinigt,
- die HTML-/JSON-Ausgabe unterscheidet bisher nicht stark genug zwischen „nicht erreichbar“, „erreichbar aber strukturell leer“ und „erreichbar und gemessen“.

---

## 4. Zielarchitektur

### 4.1 Neue verbindliche Pipeline

```text
Source Discovery
  ├─ Framer/Unframer/Proofly project metadata
  ├─ page XML + component XML
  ├─ live DOM/HTML/CSS
  ├─ screenshots desktop/tablet/mobile
  └─ fonts/assets/tokens/animations
        ↓
Source Validation
  ├─ semantic HTTP/content validation
  ├─ page/component completeness
  ├─ asset URL validation
  ├─ token completeness
  └─ extraction manifest
        ↓
Versioned Visual IR
  ├─ page sections in order
  ├─ semantic roles
  ├─ layout groups
  ├─ text nodes with heading level
  ├─ image/background nodes
  ├─ style tokens
  ├─ responsive variants
  ├─ component provenance
  ├─ geometry expectations
  └─ confidence/warnings
        ↓
V3 Planner
  ├─ section strategy
  ├─ container depth budget
  ├─ widget mapping
  ├─ CSS fallback allowlist
  ├─ responsive settings
  └─ asset upload plan
        ↓
V3 Tree Emitter
  ├─ classic V3 only
  ├─ deliberate sections/columns/containers
  ├─ native headings/images/buttons/text
  └─ page-scoped CSS only where native settings are insufficient
        ↓
Deploy Transaction
  ├─ snapshot target
  ├─ create/update isolated draft
  ├─ direct array payload
  ├─ set template/status
  ├─ clear Elementor cache
  └─ read-back + element count
        ↓
Authenticated Render Contract
  ├─ preview URL + auth/storage state
  ├─ same viewport/browser settings
  ├─ wait for fonts/images/layout
  ├─ capture diagnostics
  └─ reject invalid render
        ↓
Canonical Visual QA
  ├─ pixelmatch with explicit dimension policy
  ├─ SSIM
  ├─ section crops and hotspots
  ├─ DOM/geometry/style diff
  ├─ content/asset parity
  └─ HTML report + machine-readable manifest
```

### 4.2 Versioned Visual IR

Ein neues oder erweitertes IR sollte mindestens folgende Daten besitzen:

```ts
interface VisualPageIR {
  schemaVersion: '1.0';
  source: {
    url: string;
    extractionMode: 'unframer' | 'proofly' | 'live-dom' | 'hybrid';
    capturedAt: string;
    pageId: string;
  };
  viewportProfiles: ViewportProfile[];
  tokens: {
    colors: Record<string, string>;
    fonts: Array<{ family: string; weight: number; style: string; sourceUrl?: string }>;
    textStyles: Record<string, TextStyleIR>;
    spacing: Record<string, number | string>;
  };
  sections: VisualSectionIR[];
  assets: AssetIR[];
  animations: AnimationIR[];
  warnings: SourceWarning[];
}
```

Jede Section benötigt:

- stabile Source-ID,
- Rolle (`header`, `hero`, `about`, `services`, `events`, `faq`, …),
- DOM-/XML-Provenienz,
- erwartete Y-Range und Höhe je Viewport,
- Hintergrundfarbe/-bild,
- Layoutrichtung, Gap, Alignment und Content Width,
- geordnete Child-Gruppen,
- Text-/Image-/Button-Widgets,
- responsive Overrides,
- Confidence und ungelöste Felder.

Die V3-Emission darf nur starten, wenn die IR-Validierung keine kritischen Lücken meldet.

---

## 5. Phasenplan

### 5.0 Phase 0 — Live-Baseline und Capture-Stabilisierung (Gelaf-Regression)

> Die konkreten Post-644-Schritte und die Gelaf-Section-Namen in den folgenden Fallstudienpassagen sind Beispiele für eine Regression. Bei jedem neuen Projekt werden sie durch die Werte aus `ProjectManifest`, `SiteManifest` und dem freigegebenen Scope ersetzt.

> Diese Phase dokumentiert den bereits gemessenen Gelaf-Fall. Für ein beliebiges neues Framer-Projekt werden dieselben Gates mit einem neuen Projekt-, Source- und Target-Manifest ausgeführt; Post 644 ist kein global vorausgesetztes Ziel.

#### Ziel
Die jetzt erreichbare Testseite reproduzierbar aufnehmen können, bevor der Converter umgebaut wird.

#### Aufgaben

1. Für eine Gelaf-Regression Post 644 als isoliertes Testziel bestätigen; bei anderen Projekten ein neues, eindeutig isoliertes Target verwenden. Produktionsseiten bleiben gesperrt.
2. Snapshot des aktuellen Elementor-Tree-Zustands speichern.
3. Quelle und Ziel mit finalen URLs, Status, Redirects und Content-Markern inventarisieren.
4. Den Desktop-Fold-Lauf als kleinsten reproduzierbaren Baseline-Test festschreiben: 1440 × 900, Quelle/Ziel, HTTP 200, echte PNGs, **26,03 % Match**.
5. Pro Viewport und Modus einen harten Einzel-Timeout einführen; ein hängender Mobile-Full-Lauf darf nicht den Desktop-Report blockieren.
6. Capture-Aufträge isolieren oder begrenzt parallelisieren und jeden Auftrag mit Status `captured`, `not-scored`, `capture-timeout` oder `capture-error` abschließen.
7. PNG-Dimensionen vor dem Diff prüfen; Breitenabweichungen und inkonsistente Full-Page-Dimensionen als Capture-Fehler melden.
8. Für jede Aufnahme ein `captureIntegrity`-Objekt mit `domScrollHeight`, `screenshotWidth`, `screenshotHeight`, `viewportWidth`, `viewportHeight`, `heightDeltaPx`, `widthMismatch` und `captureTimedOut` speichern.
9. Elementor-Pro-CSS-/Asset-Request-Fehler nach Kritikalität klassifizieren; die drei aktuell beobachteten Widget-CSS-Fehler blockieren Gate A, bis sie erklärt oder behoben sind.
10. Report und maschinenlesbare Zusammenfassung auch bei Teilfehlern schreiben.
11. Quelle/Ziel in Reports als `source`/`target` bezeichnen; die bisherigen `v3`/`v4`-Namen nur als deprecated CLI-Kompatibilität behalten.

#### Gate

- Desktop-Fold-Lauf reproduzierbar abgeschlossen.
- Jeder Viewport besitzt einen eigenen Abschlussstatus.
- Kein Prozess hängt länger als den konfigurierten Einzel-Timeout.
- Report wird auch bei Teilfehlern erzeugt.
- Gleiche Screenshot-Breite auf Quelle und Ziel.
- `captureIntegrity=pass` für jede verwendete Aufnahme.
- Keine ungeklärten kritischen CSS-/Asset-Request-Fehler.
- Full-Page-Höhen werden separat ausgewiesen und nicht still weggekürzt.
- Erst wenn dieses Gate grün ist, beginnt die strukturelle Converter-Reparatur.

### Benötigte Nutzerentscheidung

Vor dem echten Live-Diff muss eine von drei Varianten freigegeben werden:

1. authentifizierte Preview-Session,
2. temporärer, sicherer Public-Preview-Link,
3. temporäres Publish der isolierten Draft-Testseite.

Standard bleibt Variante 1 oder 2; Publish wird nicht automatisch ausgeführt.

---

### 5.1 Phase 1 — Source-of-Truth-Extraktion vervollständigen

#### Ziel
Nicht nur eine Homepage-XML, sondern eine vollständige, semantisch geprüfte Quelldarstellung gewinnen.

#### Aufgaben

1. Unframer-Session stabilisieren oder Proofly als expliziten Fallback markieren.
2. `getProjectXml`, Fonts, Color Styles und Text Styles abrufen.
3. Homepage-Node-XML abrufen und Payload semantisch validieren.
4. Für jede relevante Component-ID rekursiv `getNodeXml(componentId)` abrufen.
5. Component-Instanzen deduplizieren, aber Instanz-spezifische Controls erhalten.
6. `getNodeHTML` und `getNodeCSS` als ergänzende Quelle verknüpfen.
7. Für jede Seite prüfen, ob HTTP 200 tatsächlich Layer-/Content-Daten enthält.
8. Leere 71–89-Byte-Wrapper als `semanticFailure` markieren, nicht als erfolgreiche Extraktion.
9. Parallel Live-DOM-Screenshots und Computed-Styles aus der öffentlichen Framer-Seite speichern.
10. Fonts und Assets mit Status, MIME-Type, Dimensionen und URL-Provenienz inventarisieren.

#### Neue Artefakte

```text
runs/<session>/source/
  project.xml
  homepage.xml
  components/<component-id>.xml
  homepage.html
  homepage.css
  fonts.json
  colors.json
  text-styles.json
  assets.json
  live-extraction-result.json
  screenshots/desktop.png
  screenshots/tablet.png
  screenshots/mobile.png
  computed-styles/desktop.json
  computed-styles/tablet.json
  computed-styles/mobile.json
  source-manifest.json
```

#### Gate

- Jede als „vollständig“ markierte Section hat Layer/DOM-Content.
- Jede verwendete Component-Instanz ist aufgelöst oder mit einer blockierenden Warnung versehen.
- Alle großen Bild- und Font-Assets sind validiert.
- Desktop/Tablet/Mobile-Screenshots und Computed-Style-Matrizen existieren.
- Source-Manifest enthält keine stillen Fallbacks.

---

### 5.2 Phase 2 — Visual IR und Seitenstruktur

#### Ziel
Die Quelle in eine semantische, target-neutrale Repräsentation überführen.

#### Aufgaben

1. Top-Level-Sections nicht über Namen allein, sondern aus XML-/DOM-Grenzen, Y-Ranges, Background-Wechseln, Full-Width-Bereichen und Layout-Sprüngen erkennen.
2. Die erwarteten Rollen aus dem jeweiligen Projekt prüfen; für die Gelaf-Regression sind das beispielsweise Header, Hero, About, Services, Events, Facilities, Coaches, Philosophy, Testimonials, Blog, FAQ, Newsletter und Footer.
3. Jede Section mit `sourceId`, Rolle, Bounding Box und Children versehen.
4. Layout-Wrapper klassifizieren:
   - visual wrapper,
   - layout-only wrapper,
   - component root,
   - overlay/absolute layer,
   - asset wrapper,
   - unknown.
5. Text-Controls und direkte Textinhalte zusammenführen.
6. Heading-Level aus einer Prioritätskette ableiten:
   - explizites XML-/DOM-Tag,
   - Framer Text Style / semantisches Preset,
   - Section-Rolle und Position,
   - Fontgröße nur als letzter Fallback.
7. Component-Controls typisiert extrahieren: label, href, image, variant, icon, content.
8. Bild-Widget und Background-Image unterscheiden.
9. Wiederholte Karten/Events/Testimonials als wiederverwendbare Layoutmuster erkennen, ohne Inhalte zu verlieren.
10. Alle Werte mit Confidence und Quelle versehen.

#### Gate

- Sections sind in der richtigen Reihenfolge.
- Es gibt mindestens eine explizite H1-Kandidatur für den Hero.
- Text-, Button- und Image-Anzahl sind mit Quelle plausibel.
- Keine leeren Wrapper werden automatisch als Spacer akzeptiert.
- Jede Spacer-Entscheidung besitzt eine Begründung und eine Höhenquelle.
- IR-Warnungen sind vor V3-Emission sichtbar.

---

### 5.3 Phase 3 — Token-, Font- und Asset-System

#### Ziel
Die visuelle Sprache der Quelle zentral und reproduzierbar anwenden.

#### Aufgaben

1. Satoshi und Inter mit Gewicht/Style/URL inventarisieren.
2. Font-Loading für die Zielseite planen; keine stillen System-Fallbacks.
3. Farbrollen nicht nur nach Luminanz heuristisch klassifizieren, sondern anhand von Text Styles, CSS-Variablen und Vorkommen bestätigen.
4. Text Styles als benannte Presets im IR speichern:
   - Heading/H1,
   - Heading/H2,
   - eyebrow/label,
   - body,
   - button,
   - navigation,
   - caption.
5. Asset-URLs auf Erreichbarkeit, Content-Type und Dimensionen prüfen.
6. Framer-Bilder in WordPress Media Library hochladen, wenn Elementor-Rendering mit externen URLs nicht stabil genug ist.
7. Original-URL → WordPress-Attachment-ID/URL in einem Asset-Mapping speichern.
8. `alt` aus Quelle übernehmen oder explizit als fehlend melden.
9. SVGs und Icons separat behandeln; nicht jedes SVG in ein Bild-Widget zwingen.
10. Background-Position, object-fit und object-position in Asset-Metadaten speichern.

#### Gate

- Alle sichtbaren Bilder besitzen eine valide Zielquelle.
- Keine 9 ungeklärten Bild-Wrapper bleiben still im Tree.
- Font-Familien und kritische Gewichte laden in der Zielvorschau.
- Token-Drift zwischen IR und V3-Settings ist 0 bei kritischen Rollen.

---

### 5.4 Phase 4 — Neuer semantischer V3-Emitter

#### Ziel
Einen V3-Tree erzeugen, der die Seitenstruktur und nicht die Roh-Wrapper abbildet.

#### Aufgaben

1. `framer-tree-to-v3.ts` nicht weiter als alleinigen Direkt-Mapper verwenden.
2. Einen neuen IR→V3-Emitter ergänzen, beispielsweise:
   - `packages/target-v3/src/visual-ir-to-v3.ts`
   - `packages/target-v3/src/v3-layout-planner.ts`
   - `packages/target-v3/src/v3-style-mapper.ts`
3. Pro Section eine bewusste V3-Struktur erzeugen:

```text
section
└── column
    └── layout-container(s)  // nur wenn visuell erforderlich
        └── native widgets
```

4. Zieltiefe standardmäßig auf höchstens 3–4 Ebenen begrenzen.
5. Layout-only Wrapper in der Planung auflösen, nicht erst im nachgelagerten Flattening.
6. Native V3-Widgets bevorzugen:
   - `heading`,
   - `text-editor`,
   - `image`,
   - `button`,
   - `icon`,
   - `divider`,
   - `spacer` nur mit nachgewiesener visueller Funktion.
7. Heading-Level explizit setzen (`header_size`).
8. Section-/Container-Settings vollständig abbilden:
   - width/content width,
   - flex direction,
   - gap,
   - alignment,
   - padding/margin,
   - min-height,
   - backgrounds,
   - border radius/shadow.
9. Responsive V3-Suffix-Settings aus der Responsive Matrix erzeugen.
10. Page-scoped CSS nur für nachweislich nicht-native Eigenschaften verwenden:
    - komplexe Background-Positionierung,
    - spezifische absolute overlays,
    - fehlende Framer-Effekte.
11. CSS nicht als Ersatz für fehlende Sections oder Widgets verwenden.
12. Jede ausgegebene V3-Node erhält Source-Provenienz für spätere Diffs.

#### Gate

- Keine V4-Settings oder `e-flexbox`-Elemente.
- Keine Top-Level-Section mit dem gesamten Seitenbaum als unstrukturierter Block.
- Heading-, Button- und Image-Parität plausibel.
- Maximal zulässige Tree-Tiefe eingehalten.
- Spacer-Anteil unter einem festgelegten Schwellenwert und jede Ausnahme begründet.
- V3-Guards, Tree-Shape- und Widget-Settings-Gates grün.

---

### 5.5 Phase 5 — Responsive Rekonstruktion

#### Ziel
Nicht nur Desktop, sondern alle drei Zielbreiten sichtbar korrekt abbilden.

#### Zielprofile

- Desktop: 1440 × 900
- Tablet: 768 × 1024
- Mobile: 390 × 844

#### Aufgaben

1. Quelle und Ziel in exakt denselben Viewports aufnehmen.
2. `deviceScaleFactor`, Locale, Timezone, Color Scheme und User Agent festlegen.
3. Responsive Matrix aus Computed Styles und IR lesen.
4. Pro Section prüfen:
   - direction,
   - wrap/stack,
   - order,
   - hide/show,
   - font size,
   - line height,
   - padding/margin,
   - gap,
   - width/max-width,
   - image height/position.
5. Mobile- und Tablet-Overrides bewusst ausgeben; nicht auf Elementor-Vererbung hoffen, wenn die Quelle explizit abweicht.
6. Navigation, Hero, Card-Grids, Events und Footer separat prüfen.
7. Keine generische Gleichverteilung von Flex-Row-Kindern verwenden, wenn die Quelle andere Breiten/Ratios hat.

#### Gate

- Kein horizontaler Overflow.
- Keine überlappenden Hero-/Card-Elemente.
- Responsive-Audit ohne kritische Befunde.
- Section-Höhen und Haupt-Bounding-Boxes innerhalb festgelegter Toleranzen.

---

### 5.6 Phase 6 — Deployment und Elementor-Rendervertrag

#### Ziel
Das gespeicherte JSON zuverlässig als sichtbares Elementor-Frontend rendern.

#### Aufgaben

1. Vor jedem Write Snapshot des Zielposts speichern.
2. V3 weiter über direkten Array-Payload deployen; `batch-build-page` nicht für verschachtelte V3-Trees verwenden.
3. Page Template explizit setzen und dokumentieren.
4. Nach dem Write:
   - Read-back von `_elementor_data`,
   - `content` muss Array sein,
   - Elementanzahl und Top-Level-Struktur prüfen,
   - den Dokument-Cache **verpflichtend** mit `novamira/elementor-clear-document-cache` und `{ post_ids: [<id>] }` leeren,
   - `novamira-adrianv2/clear-cache` mit `{ post_ids: [<id>] }` ausschließlich als separat live verifizierten Zusatz-/Fallback-Pfad verwenden, niemals als stillen Ersatz für den kanonischen Dokument-Cache-Clear,
   - Cache-Clear-Ergebnis und anschließenden Frontend-CSS-/Renderstatus verifizieren,
   - Permalink/Preview-URL abrufen,
   - Frontend-Render im freigegebenen Kontext prüfen.
5. Cache-Löschung nicht als optionales „nice to have“ behandeln; die beiden Cache-Abilities dürfen nicht verwechselt werden.
6. Bei abweichendem Read-back sofort stoppen; kein nachfolgender Diff auf einem unbekannten Tree.
7. Deployment-Report muss status, template, post ID, element count, preview state und cache state enthalten.

#### Gate

- Read-back entspricht dem gesendeten Tree semantisch.
- Keine 0-Elemente-Speicherung.
- Cache wurde erfolgreich invalidiert.
- Preview-Render ist erreichbar und enthält erwartete Marker.
- Snapshot/Restore-Pfad ist vorhanden.

---

### 5.7 Phase 7 — Kanonisches Live-Visual-Diff-Tool

#### Ziel
Ein einziges, ehrliches Vergleichssystem, das zwei reale Seiten unter gleichen Bedingungen rendert.

### 7.1 Capture-Vertrag

Für jede Seite und jeden Viewport muss ein `CaptureManifest` geschrieben werden:

```ts
interface CaptureManifest {
  url: string;
  finalUrl: string;
  httpStatus: number;
  redirectChain: string[];
  title: string;
  viewport: { width: number; height: number; deviceScaleFactor: number };
  authMode: 'anonymous' | 'storage-state' | 'basic' | 'public-preview';
  bodyLength: number;
  scrollHeight: number;
  contentMarkers: string[];
  errorMarkers: string[];
  fontsReady: boolean;
  images: { total: number; loaded: number; failed: number };
  consoleErrors: string[];
  requestFailures: string[];
  screenshotPath?: string;
  captured: boolean;
  notScoredReason?: string;
}
```

### 7.2 Deterministische Capture-Schritte

1. Browser-Context mit identischem Viewport/Scale/Locale/Timezone öffnen.
2. Authentifizierten Storage State nur aus lokaler, ignorierter Datei laden.
3. `page.goto()` mit dokumentiertem Status und Redirectkette.
4. Redirect auf Login, 404, Preview-Fehler oder Error Page ablehnen.
5. `document.fonts.ready` abwarten.
6. Alle sichtbaren Bilder prüfen und `decode()` abwarten.
7. Lazy Loading durch kontrolliertes Scrollen triggern.
8. Animationen, Transitions, Carets und Blinking im Vergleichskontext deaktivieren.
9. Framework-Hydration und Elementor-Frontend-Init abwarten.
10. Layout-Stabilität messen: mehrere aufeinanderfolgende `scrollHeight`-/Bounding-Box-Samples müssen gleich sein.
11. Screenshot aufnehmen.
12. Console, Request-Failures und Fehler-Marker mit speichern.
13. Bei fehlender Validierung: `captured=false`, `notScoredReason`, kein Pixel-Score.

### 7.3 Diff-Regeln

1. Gleiche Breite erzwingen.
2. Unterschiedliche Höhen **nicht still auf Minimum beschneiden**.
3. Stattdessen zwei Werte ausgeben:
   - sichtbarer Overlap-Score,
   - Vollseiten-Höhen-/Content-Paritätsfehler.
4. Section-Crops anhand der Quelle- und Ziel-Section-Manifeste synchronisieren.
5. Pixelmatch und SSIM pro Viewport und pro Section rechnen.
6. Hotspots und Heatmap speichern.
7. Bei fehlender Zielaufnahme niemals `0`, `100` oder einen geschätzten Score ausgeben.
8. `not scored` muss vom Exit-Code 1 begleitet werden.
9. Score-Gates getrennt definieren:
   - render availability,
   - content/structure parity,
   - visual similarity.

### 7.4 Einheitliche Engine

`packages/qa/src/diff/index.ts` sollte die kanonische Engine werden. Die folgenden Pfade müssen danach entweder delegieren oder klar als Legacy markiert werden:

- `packages/qa/src/pixel-diff.ts`,
- `packages/qa/src/ssim.ts`,
- `packages/qa/src/visual-diff.ts`,
- `packages/qa/src/structure-diff.ts`,
- `packages/qa/src/visual-diff-structured.ts`,
- `scripts/visual-diff.mjs`,
- `packages/cli/src/v3v4-diff.ts`,
- `packages/cli/src/cmd-qa.ts`.

Vor einer Konsolidierung müssen die bestehenden Aufrufer separat getestet werden; der bekannte Repository-Befund weist auf mehrere überlappende Diff-Engines hin.

### 7.5 Report

Der HTML-Report muss enthalten:

- Quelle/Ziel und final aufgelöste URLs,
- Auth-/Preview-Modus ohne Secrets,
- Status und Redirects,
- Screenshot-Paare,
- Slider, Overlay und Diff-Heatmap,
- Viewport-/Section-Scores,
- Höhen- und Content-Parität,
- Console-/Request-Fehler,
- Font-/Image-Load-Status,
- DOM-/Heading-/Button-/Image-Parität,
- klare Statusklassen: `PASS`, `FAIL`, `NOT SCORED`, `CAPTURE ERROR`.

---

### 5.8 Phase 8 — Section-/Geometry-Diff und Reparaturschleife

#### Ziel
Nicht nur sagen, dass es anders aussieht, sondern lokalisieren, warum.

#### Aufgaben

1. Quelle und Ziel mit stabilen Section-Rollen mappen.
2. Pro Section vergleichen:
   - top/left/width/height,
   - Background/Farbe,
   - Content Width,
   - Heading-Styles,
   - Textlänge,
   - Image Count/URL/Aspect Ratio,
   - Button Count/Label/Link,
   - max DOM depth.
3. Pixel-Hotspots auf IR-Node und Elementor-ID zurückführen.
4. Fehlerkategorien bilden:
   - missing section,
   - wrong order,
   - missing asset,
   - typography mismatch,
   - width/spacing mismatch,
   - responsive mismatch,
   - template/cache/render issue.
5. Kleine, nachvollziehbare Reparaturen priorisieren.
6. Nach jedem Reparaturbatch:
   - Snapshot/rollback point,
   - redeploy only isolated draft,
   - cache clear,
   - capture manifest,
   - section diff,
   - full diff.

#### Reparaturpriorität

1. Renderzugang / Template / Cache
2. Section-Reihenfolge und fehlende Sections
3. Hero-Layout und Heading-Hierarchie
4. Bilder, Backgrounds und Bildpositionen
5. Containerbreiten, Spalten und Abstände
6. Responsive-Verhalten
7. Typography/Colors/Buttons
8. Animationen und Mikrodetails
9. A11y und SEO-Polishing

A11y und SEO bleiben wichtig, dürfen aber nicht die visuelle Grundstruktur überholen.

---

## 6. Konkrete erwartete Codeänderungen

### Extraktion

- Proofly-/Unframer-Adapter um semantische Payload-Validierung und Component-Expansion ergänzen.
- Quelle, Component und Live-DOM in ein gemeinsames Source-Manifest schreiben.
- `playwright-extractor.ts` um stabile Font-/Image-/Layout-Wait-Zustände und Capture-Diagnostics erweitern.
- `computedStyles`, Screenshots und Responsive Matrix als Pflichtartefakte für den pixelnahen Modus behandeln.

### IR

- neues versioniertes Visual IR im `packages/core` oder `packages/extractors`-Vertrag.
- Source-Provenienz und Confidence verpflichtend machen.
- IR-Validator mit kritischen Fehlern statt stillen Fallbacks.

### V3

- neuer `VisualIR → V3`-Emitter.
- `framer-tree-to-v3.ts` nur noch für kompatible Legacy-/kleine Inputs oder als Parser-/Adapterpfad verwenden.
- semantische Section-Planner, Heading-Resolver, Component-Resolver, Asset-Resolver und Responsive-Mapper.
- `flatten-tree.ts` als Safety-Net, nicht als primäre Architektur.
- maximale Tiefe und Spacer-Regeln als harte QA-Gates.

### MCP/Deploy

- `wp-push.ts` um Post-Write-Readback, Cache-Clear-Verifikation und Renderability-Port ergänzen.
- Legacy-`packages/mcp/src/deploy.ts` entweder explizit deprecated markieren oder auf denselben Ability-/Payload-Pfad umstellen.
- Preview-URL-/Auth-State-Vertrag ergänzen, ohne Credentials zu loggen.

### QA

- kanonische Capture-Engine in `packages/qa`.
- CLI-Skript delegiert an die Engine statt eigene zweite Capture-/Diff-Logik zu behalten.
- Statusmodell `available`, `notScored`, `captureError`, `scored`.
- Dimensionen und zusätzliche Höhe nicht still wegcroppen.
- Section-/Geometry-/Content-Parität in denselben Report integrieren.
- Tests für 404, Login, Redirect, leeren Elementor-Tree, fehlende Fonts, nicht geladene Bilder, unterschiedliche Page Heights und authentifizierte Preview.

---

## 7. Test- und Freigabegates

### Lokale Unit-/Integrationstests

- XML-/HTML-/Component-Expansion
- Token-/Font-/Asset-Resolution
- Heading-/Button-/Image-Mapping
- Wrapper-Klassifizierung
- Spacer-Entscheidungen
- responsive V3-Suffixe
- V3 tree depth / `isInner` / row widths
- direct-array deploy payload
- cache-clear/read-back contracts
- capture manifest status model
- 404/non-scored behavior
- login/preview rejection
- height mismatch policy
- section score aggregation
- report escaping and artifact cleanup

### Autoritativer Lauf

```bash
npx tsc --build --pretty false
npx vitest run --pool=forks --maxWorkers=1 --minWorkers=1 --testTimeout=15000
git diff --check
npx eslint packages/core packages/extractors packages/target-v3 packages/mcp packages/qa packages/cli
```

### Live-Draft-Gates

1. read-only source manifest valid,
2. local IR validation green,
3. V3 guards green,
4. snapshot captured,
5. isolated draft write successful,
6. read-back count/shape valid,
7. cache clear confirmed,
8. authenticated/approved preview HTTP 2xx,
9. source and target capture manifests valid,
10. desktop/tablet/mobile section and full-page comparisons generated,
11. no critical missing-section/asset/render failures,
12. report reviewed before any publish decision.

### Kein Erfolg bei

- 404 oder Login-Render,
- nur MCP-HTTP-200 ohne semantischen Payload,
- `visual-qa: 0 Issues` ohne Screenshot-Paar,
- fehlendem Font-/Image-Load,
- leerem oder verkürztem Tree,
- nicht erklärten Spacern,
- fehlender Mobile-Aufnahme,
- Score aus beschnittenen Seitenhöhen ohne Höhenparitätswert.

---

## 8. Risiken und Gegenmaßnahmen

| Risiko | Wirkung | Gegenmaßnahme |
|---|---|---|
| Unframer-Session 401 | Quelle unvollständig | Session neu verbinden, Proofly-Fallback markieren, Payload validieren |
| Proofly HTTP 200 mit leerem XML | falsche Vollständigkeitsannahme | minimale Layer-/Byte-/Semantik-Gates |
| Komponenten nicht expandiert | fehlende Inhalte/Styles | deduplizierter Component-Drill |
| externe Framer-Bilder blockiert | leere Bilder | Asset-Download/Upload und Load-Checks |
| Elementor-Draft nicht erreichbar | kein Live-Diff | Storage State/Public Preview nach Freigabe |
| falsches Template | komplett anderer Rahmen | Template als Rendervertrag prüfen |
| stale Elementor CSS | falsche Darstellung trotz korrektem Tree | Cache-Clear und CSS-Load-Gate |
| Font-Fallback | globale Textabweichung | Font-Load-Manifest und Font-Ready-Gate |
| dynamische Animationen | flakende Pixelwerte | reduced motion, CSS freeze, stable state |
| unterschiedliche Seitenhöhen | Score verfälscht | overlap plus height/content parity getrennt messen |
| mehrere Diff-Engines | widersprüchliche Ergebnisse | kanonische QA-Engine, Legacy-Pfade delegieren |
| zu aggressives Flattening | verlorene visuelle Gruppen | IR-basierte Layoutplanung vor Flattening |
| Credential-Leak | Sicherheitsrisiko | nur lokale Env/Storage State, Secret-Rotation |

---

## 9. Empfohlene Ausführungsreihenfolge

### Sprint A — Diagnose und Renderzugang

- Capture-Manifest und authentifizierten Preview-Pfad bauen.
- Gelaf/Post 644 ausschließlich als Regression-/Rollback-Bestand verwenden; für jedes andere Projekt ein eigenes Target-Profil und eine eigene isolierte Draft-Gruppe anlegen.
- Framer-Referenz-Manifest und deterministische Screenshots erzeugen.
- Visual-Diff-404-/Login-/Cache-Gates testen.
- Vor einem Site-Build den Scope festlegen: einzelne Seite, ausgewählte Routen oder vollständige Site.

### Sprint B — Quelle und IR

- Component-Expansion und semantische Payload-Validierung.
- Source-Manifest, Tokens, Fonts, Assets, responsive Styles.
- Visual IR und Section-Validator.

### Sprint C — V3-Rebuild

- neuer semantischer V3-Emitter.
- Sections, Heading-Hierarchie, Bilder, Buttons und responsive Layouts.
- Tree-Tiefe und Spacer-Gates.

### Sprint D — isolierter Draft-Deploy

- neue Testseite oder explizit freigegebener Ersatz-Draft, nicht Produktionsseite.
- Snapshot, Array-Payload, Cache-Clear, Read-back.
- Preview-Zugriff herstellen.

### Sprint E — echte visuelle Iteration

- Desktop zuerst: Header/Hero → Content Sections → Footer.
- Tablet danach.
- Mobile danach.
- pro Iteration nur eine Fehlerklasse ändern.
- Section-Diff und Full-Page-Diff nach jedem Batch.

### Sprint F — Abschluss

- A11y/SEO.
- Animationen/Interaction-Parität.
- finaler Report.
- nur nach expliziter Freigabe publishen.
- Chat-Credentials rotieren.

---

## 10. Definition of Done für Gelaf

Die Gelaf-Konvertierung gilt erst dann als fertig, wenn alle folgenden Aussagen stimmen:

- [ ] Homepage-Quelle ist vollständig oder alle Grenzen sind explizit dokumentiert.
- [ ] Header, Hero, About, Services, Events, Facilities, Coaches, Philosophy, Testimonials, Blog, FAQ, Newsletter und Footer sind im IR vorhanden.
- [ ] V3-Tree enthält separate, nachvollziehbare Sections.
- [ ] Hero besitzt eine korrekte H1 und die erwartete Bild-/CTA-Struktur.
- [ ] Keine ungeklärten Bild-URLs im sichtbaren Inhalt.
- [ ] Fonts laden in der Zielvorschau.
- [ ] Desktop/Tablet/Mobile-Overrides sind vorhanden, wo die Quelle abweicht.
- [ ] Container-Tiefe ist begrenzt und Deep-Nesting-Gate grün.
- [ ] Draft-Readback entspricht dem gesendeten Array.
- [ ] Elementor CSS/Cache ist nachweislich aktualisiert.
- [ ] Zielseite ist im freigegebenen Preview-Kontext erreichbar.
- [ ] Capture-Manifest bestätigt echte Screenshots beider Seiten.
- [ ] Kein Viewport ist „not scored“.
- [ ] Pixelmatch und SSIM wurden pro Viewport und Section berechnet.
- [ ] Höhen-/Content-Parität wurde separat bewertet.
- [ ] DOM-/Geometry-Diff hat keine kritischen fehlenden Sections oder Assets.
- [ ] Report wurde angesehen und die verbleibenden Differenzen sind erklärt.
- [ ] Veröffentlichung wurde nicht automatisch durchgeführt.

---

## 11. Plattformziel: beliebige Framer-Projekte

### 11.1 Was „beliebig“ technisch bedeutet

Die Plattform darf nicht nur eine bestimmte Landingpage-Form oder Proofly-XML-Struktur beherrschen. Sie muss mindestens diese Projektfamilien unterscheiden und testen:

| Projektfamilie | Typische Schwierigkeit | Zielverhalten |
|---|---|---|
| Marketing-Landingpage | Hero, Cards, CTA, Footer | native V3-Widgets und begrenzte Layouttiefe |
| SaaS-/Product-Seite | Tabellen, Feature-Matrix, Tabs, Pricing | semantische Sections, Tabellen-/Accordion-Fallbacks |
| Portfolio/Agency | Masonry, Case Studies, Lightbox, Gallery | Gallery-/Image-Strategie und definierte Interaktionsgrenzen |
| E-Commerce | Produktkarten, Preise, Varianten, dynamische Daten | statischer Snapshot oder expliziter CMS-/WooCommerce-Adapter |
| Blog/Editorial | Listen, Artikel, Rich Text, Pagination | Inhaltssnapshot oder CMS-Plan, keine erfundenen Beiträge |
| Membership/Event | Formulare, Login, Kalender, dynamische Bereiche | sichtbares Layout plus klarer Funktionsstatus |
| Component-heavy Framer | verschachtelte Komponenten und Varianten | Definitionen deduplizieren, Instanz-Overrides bewahren |
| Code-component-heavy | Canvas, React-Logik, Motion, Charts | native Approximation, HTML/CSS/JS-Fallback oder `unsupported` |
| One-page/scroll narrative | sticky panels, scroll transforms, pinned scenes | statischer Zustand plus optionaler Interaction-Adapter |
| Theme-/Design-system-heavy | globale Styles, Light/Dark, Tokens | Token- und Theme-Vertrag vor der V3-Emission |

„Beliebig“ bedeutet dabei nicht, dass jede Framer-Laufzeitfunktion verlustfrei in Elementor V3 umsetzbar ist. Es bedeutet, dass jeder Input einen **expliziten, validierten Ausgang** erhält: native Umsetzung, kontrollierte Approximation, page-scoped Fallback oder begründetes `unsupported` mit sichtbaren Warnungen. Stille Vereinfachungen sind nicht erlaubt.

### 11.2 Multi-Source-Akquisition

Die Plattform braucht einen gemeinsamen `SourceAdapter`-Vertrag statt einer fest verdrahteten Proofly-Annahme:

```ts
interface SourceAdapter {
  id: string;
  canHandle(input: SourceInput): Promise<CapabilityResult>;
  discover(input: SourceInput): Promise<SourceManifest>;
  extractPage(manifest: SourceManifest, page: PageRef): Promise<RawPageEvidence>;
  resolveComponent(manifest: SourceManifest, component: ComponentRef): Promise<RawComponentEvidence>;
  close(): Promise<void>;
}
```

Unterstützte Eingänge müssen schrittweise abgedeckt werden:

- stabiler Unframer-MCP,
- Proofly-MCP als Adapter, nicht als Domänenannahme,
- öffentliche Framer-Live-URL mit Playwright,
- lokale Framer-/HTML-/CSS-/Asset-Exports,
- gemischter Modus aus MCP-Struktur plus Live-DOM/Screenshot,
- Screenshot-only als ausdrücklich konservativer Modus.

Jeder Adapter liefert dieselbe Evidenzform und muss semantische Leere erkennen. HTTP 200, ein vorhandenes XML-Element oder ein erfolgreicher MCP-Handschlag reicht nicht als Extraktions-Erfolg.

### 11.3 Versioniertes Visual IR als Plattformvertrag

`PageSpec` bleibt für kompatible Legacy-Flows bestehen; für die generische Plattform wird ein versioniertes Visual IR als verbindliche Grenze zwischen Quelle und Ziel eingeführt. Das IR muss folgende Dimensionen abbilden:

- Seite, Route, Locale und Theme-Kontext,
- Sections in stabiler Reihenfolge,
- semantische Rollen und Layout-Archetypen,
- DOM-/XML-/Screenshot-Provenienz,
- Komponenten-Definitionen und Instanzen,
- Varianten, States und Instanz-Overrides,
- CMS-/Collection-Referenzen,
- Text mit semantischem Tag, Rich-Text-Markup und Linkstruktur,
- Bild, Video, SVG, Icon, Lottie und Canvas-Assets,
- Backgrounds, Gradients, Masks, Blend Modes und Overlays,
- Desktop/Tablet/Mobile plus benutzerdefinierte Framer-Breakpoints,
- Hover, Focus, Active, Open, Scroll- und Load-Zustände,
- Animation Intent statt nur generiertem GSAP-Code,
- Design Tokens und lokale Abweichungen,
- erwartete Geometrie und Screenshot-Regionen,
- Confidence, Evidence und ungelöste Entscheidungen.

Jeder IR-Knoten erhält mindestens:

```ts
interface Evidence {
  sourceIds: string[];
  methods: Array<'mcp' | 'xml' | 'html' | 'css' | 'dom' | 'computed-style' | 'screenshot' | 'vision'>;
  confidence: number;
  warnings: string[];
}
```

Regeln:

- `confidence >= 0.85`: automatische native Planung zulässig,
- `0.60–0.84`: Planung zulässig, aber Review-/QA-Hinweis verpflichtend,
- `< 0.60`: kein spekulatives Speziallayout; generischer sicherer Fallback oder Benutzerentscheidung,
- widersprüchliche Quellen werden nicht überschrieben, sondern als Konflikt im Manifest gespeichert.

### 11.4 Komponenten, Varianten und CMS

Der Component-Resolver muss Definition und Instanz trennen:

1. Component-Definition dedupliziert abrufen.
2. Varianten und States aus Definition und Live-DOM zusammenführen.
3. Instanz-Controls, Overrides und Inhalte separat speichern.
4. Rekursion, Zyklen und maximale Expand-Tiefe erkennen.
5. CMS-Collections und dynamische Einträge als Datenquelle, Snapshot oder `unsupported` klassifizieren.
6. Leaf-Komponenten ohne eigene XML-Struktur über Controls und wiederverwendbare Pattern-Templates auflösen.
7. Code Components nicht als leere Container verschlucken; stattdessen native Approximation, isoliertes HTML/CSS/JS oder blockierende Warnung erzeugen.

Kein Component-Inhalt darf durch „Node is not a text node“, leere Wrapper oder unbekannte Controls still verloren gehen. Der Build-Report muss pro Komponente `resolved`, `approximated`, `fallback` oder `unsupported` ausweisen.

### 11.5 Layout-Archetypen statt Namensheuristiken

Der generische Planner braucht eine begrenzte, testbare Menge von Layout-Archetypen:

- single-column,
- split hero,
- media-left/media-right,
- multi-column cards,
- grid,
- masonry approximation,
- centered editorial,
- full-bleed media,
- sticky/overlap composition,
- tabs/accordion,
- gallery/carousel,
- form/contact,
- header/navigation,
- footer.

Archetypen werden aus mehreren Signalen ausgewählt:

- DOM-/XML-Struktur,
- Computed Styles und Bounding Boxes,
- wiederholte Child-Signaturen,
- Source-Namen nur als schwaches Signal,
- Screenshot-/Vision-Evidence bei niedriger Struktur-Confidence.

Die Heuristik `name.includes('hero')` darf niemals alleine eine Section, ein Button-Widget oder einen Spacer bestimmen.

### 11.6 Ziel- und Capability-Matrix

Vor jedem Build wird das konkrete Elementor-Ziel profiliert:

- Elementor-/Pro-Version,
- V3-Widget-Schemas,
- verfügbare Templates,
- Canvas/Full-Width/Theme-Kontext,
- Font-Loading-Möglichkeiten,
- Media-Upload und externe Asset-Regeln,
- Custom CSS/JS-Erlaubnis,
- Form-/Menu-/Popup-/Carousel-Widgets,
- Cache-/CSS-Regeneration,
- verfügbare Novamira-Abilities.

Die V3-Emission nutzt eine Capability-Matrix:

| IR-Fähigkeit | Native V3 | Page-CSS/JS | Approximation | Unsupported |
|---|---|---|---|---|
| Heading/Text/Image/Button | bevorzugt | nein | nein | nur bei Schemafehler |
| Flex/Grid/Spacing | bevorzugt | begrenzt | ja bei Sonderfall | selten |
| Background/Gradient/Radius/Shadow | bevorzugt | bei komplexen Werten | ja | selten |
| Component Instance | Pattern/native group | optional | ja | bei nicht auflösbarer Definition |
| Hover/Focus | Widget-/CSS-State | page-scoped CSS | ja | bei fehlender Semantik |
| Scroll/Load Animation | V3 motion/API | scoped JS | statischer Zustand | bei komplexer Physik |
| CMS/Collections | vorhandener Adapter | Snapshot | ja | ohne Datenzugriff |
| Canvas/WebGL/React runtime | nein | isolierter Embed | Screenshot-/Static-Fallback | wenn Embed verboten |
| Authenticated app state | nein | kein Credential-Import | sichtbarer Shell-Fallback | interaktive Funktion |

Die Entscheidung wird pro Node im Build-Manifest gespeichert. „Native first“ verhindert sowohl unnötige Custom-Änderungen als auch falsche Versprechen.

### 11.7 Responsive und State-Matrix für beliebige Projekte

Die Plattform darf nicht auf genau drei Breiten oder pauschale Faktoren reduziert werden. Sie muss:

1. Framer-Breakpoints aus Quelle und Live-CSS erkennen.
2. Sie auf Zielprofile abbilden und die Mapping-Entscheidung dokumentieren.
3. Explizite Werte je Breakpoint als Elementor-V3-Suffixe schreiben.
4. Hide/Show, Order, Direction, Gap, Width, Typography, Image Position und Overflow prüfen.
5. States getrennt vom Responsive-Breakpoint speichern: `hover`, `focus`, `active`, `open`, `scrolled`, `loaded`.
6. Fehlende Zielzustände als `interaction-gap` melden.
7. Desktop-Inheritance nur verwenden, wenn die Quelle dort tatsächlich keine Abweichung besitzt.

### 11.8 Asset- und Font-Lifecycle

Ein generischer Asset-Service benötigt:

- URL-Normalisierung und Redirect-Prüfung,
- MIME-/Dimension-/Decode-Validierung,
- CORS-/Hotlink-/Expiry-Erkennung,
- Download und Hashing,
- WordPress-Media-Upload mit Idempotency-Key,
- Original-zu-Ziel-Mapping,
- Alt-Text- und Focal-Point-Metadaten,
- responsive Bildvarianten,
- SVG-Sanitizing,
- Font-Familie/Gewicht/Style-Mapping,
- Lizenz-/externe-URL-Warnung.

Ein Asset darf nicht nur wegen einer vorhandenen URL als erfolgreich gelten. Sichtbare, fehlende oder falsch zugeschnittene Assets blockieren den jeweiligen Section-Gate.

### 11.9 Fallback- und Fehlervertrag

Jede nicht native Fähigkeit muss eine kontrollierte Entscheidung besitzen:

```ts
type FidelityDecision =
  | { kind: 'native'; capability: string }
  | { kind: 'css-fallback'; reason: string; scope: 'node' | 'section' | 'page' }
  | { kind: 'js-fallback'; reason: string; scope: 'node' | 'section' | 'page' }
  | { kind: 'static-approximation'; lostBehavior: string }
  | { kind: 'unsupported'; reason: string; userAction?: string };
```

Pflichten:

- keine stillen Spacer-/Text-/Bild-Fallbacks,
- keine erfundenen URLs oder Inhalte,
- keine globale CSS-/JS-Injektion ohne Page-Scope,
- keine JS-Fallbacks ohne Cleanup-/Performance-/Security-Gate,
- keine automatische Veröffentlichung bei `unsupported`-Kernfunktionen,
- Report zeigt verlorene Semantik und erwartete Auswirkung.

### 11.10 Benchmark-Korpus und Plattform-Regression

Gelaf allein ist kein ausreichender Test. Es wird ein versioniertes, secrets-freies Benchmark-Korpus benötigt:

- mindestens 10 unterschiedliche Framer-Archetypen für den ersten Plattform-Meilenstein,
- mindestens 20 Seiten/Varianten für einen belastbaren Release-Meilenstein,
- lokale Roh-Evidenz, IR-Golden-Datei, V3-Golden-Tree und erwartete Entscheidungen,
- deterministische Fixture-Seiten für Capture-/Diff-Tests,
- mindestens eine Komponente, ein CMS-/Collection-Fall, ein dunkles Theme, ein Mobile-first-Fall, eine Gallery, ein Formular, eine Sticky-/Scroll-Komposition und ein Code-Component-Fallback,
- synthetische Edge Cases für leere Payloads, malformed XML, fehlende Fonts, externe Assets, extreme Nesting-Tiefe und unbekannte Controls.

Jede neue Reparatur muss zeigen:

- keine Regression in den bestehenden Archetypen,
- unveränderte Source-ID-/Provenienz-Stabilität,
- native-vs-fallback-Entscheidung nachvollziehbar,
- V3-Gates grün,
- Visual-Diff-Metriken innerhalb der kalibrierten Baseline.

### 11.11 Plattformweite Release-Gates

Ein beliebiger Projektbuild darf erst als erfolgreich gelten, wenn:

1. Source-Adapter-Capability und Payload-Semantik bestanden sind.
2. IR-Schema validiert und kritische Confidence-Konflikte gelöst sind.
3. Jede sichtbare Section eine Entscheidung und Provenienz besitzt.
4. Jede sichtbare Asset-/Font-Abhängigkeit geladen oder explizit als Fallback markiert ist.
5. V3-Tree keine V4-Kontamination, keine unbounded depth und keine stillen Placeholder besitzt.
6. Target-Capability-Matrix und Template-Kontext zum Tree passen.
7. Read-back, kanonischer Dokument-Cache-Clear und Render-Manifest erfolgreich sind.
8. Jeder angeforderte Viewport einen eigenen Capture-Status besitzt.
9. Kein `captureIntegrity`-Fehler oder kritischer Request-Fehler offen ist.
10. Section-/Content-/Geometry-Parität und Pixelmatch/SSIM die Projekt- und Plattform-Gates bestehen.
11. `unsupported`-Entscheidungen nicht in kritischen Kernbereichen liegen oder ausdrücklich bestätigt wurden.
12. Der gesamte Build reproduzierbar und rollback-fähig ist.

### 11.12 Plattformmetriken

Neben visuellen Scores werden langfristig gemessen:

- `sourceCompleteness`,
- `irConfidence` und Konfliktrate,
- `sectionRecall` / `sectionPrecision`,
- `widgetRecall` nach Typ,
- `assetLoadSuccess` und `fontLoadSuccess`,
- `nativeCoverage` versus Fallback-Anteil,
- `interactionCoverage`,
- `responsiveCoverage`,
- `containerDepthP95`,
- `captureSuccessRate`,
- `visualScoreByArchetype`,
- `rollbackRate` und `repairIterations`.

Das verhindert, dass ein globaler Pixelwert eine Plattformverschlechterung bei Components, Mobile oder Interactions versteckt.

### 11.13 Sicherheits- und Betriebsanforderungen

Für beliebige Kundenprojekte muss die Plattform zusätzlich:

- Credentials, Preview-States und private Assets strikt von Artefakten trennen,
- URLs in Reports redigieren, wenn sie Tokens/Secrets enthalten,
- HTML/CSS/JS-Fallbacks sanitizen und page-scopen,
- externe Requests und Downloads mit Limits, Allowlist/Policy und Timeouts versehen,
- MCP-Abilities gegen Registry und Capability-Schema prüfen,
- Idempotency, Retry und Circuit Breaker bei Source-/Target-Calls verwenden,
- jede Mutation mit Snapshot, Audit-Log und Rollback-Referenz versehen,
- Kosten-/Timeout-Budgets pro Projekt und Phase melden.

### 11.14 Konkrete Repository-Zuordnung und Migrationspfad

Die Plattformarchitektur wird schrittweise in die vorhandenen Pakete integriert und ersetzt nicht unkontrolliert die bestehenden Verträge:

| Plattformvertrag | Zielmodul | Migrationsregel |
|---|---|---|
| `SourceAdapter`, `SourceManifest`, semantische Payload-Prüfung | `packages/extractors/src/adapters/` neu; bestehende `framer/mcp-bridge.ts` als Adapter-Basis | `extract-pipeline.ts` akzeptiert Adapter statt Proofly-/URL-Sonderpfad |
| `VisualPageIR` und Validator | `packages/core/src/contracts/visual-ir.contract.ts` + `packages/core/src/guards/visual-ir.ts` | `PageSpec` bleibt Legacy-Input; Adapter/Builder erzeugen IR zuerst |
| Live DOM, Screenshots, Computed Styles | `packages/extractors/src/browser/` | `BrowserExtractionResult` wird als Evidence-Quelle in IR überführt, nicht verworfen |
| Component-/CMS-Resolution | `packages/extractors/src/framer/component-resolver.ts` und neue CMS-/code-component Resolver | Definitionen/Instanzen getrennt persistieren; Zyklen und Budgets validieren |
| IR→V3-Planung | `packages/target-v3/src/visual-ir-to-v3.ts`, `v3-layout-planner.ts`, `v3-style-mapper.ts` neu | `framer-tree-to-v3.ts` bleibt kompatibler Legacy-Adapter, nicht Plattform-Hauptpfad |
| Responsive Mapping | `packages/target-v3/src/responsive-breakpoint-mapper.ts` | Framer-Matrix plus Ziel-Breakpoint-Profil, keine pauschalen Skalierungsfaktoren |
| Deploy-/Read-back-/Cache-Vertrag | `packages/mcp/src/wp-push.ts`, `abilities.ts`, `snapshot.ts` | direct-array V3 bleibt Pflicht; Read-back und Cache-Clear vor QA |
| Capture-Manifest und Live-Diff | `packages/qa/src/visual-capture.ts`, `packages/qa/src/diff/index.ts` | CLI-Script delegiert schrittweise an kanonische QA-Engine |
| Fallback-/Fidelity-Entscheidungen | `packages/core/src/contracts/fidelity.contract.ts` neu | jede Entscheidung erhält Code, Scope, Evidence und Severity |
| Benchmark-/Run-Manifest | `tests/fixtures/platform/` und `runs/<session>/manifest.json` | keine Secrets, keine privaten Kundendaten, Version und Hash verpflichtend |

Jede neue Schnittstelle erhält zunächst Contract-Tests und einen Legacy-Adapter. Erst wenn die bestehenden V3-Golden-Paths und CLI-Aufrufer gegen den neuen Vertrag grün sind, wird ein alter Direktpfad deprecated.

### 11.15 Multi-Page-, Routing- und Site-Kontrakt

Ein beliebiges Framer-Projekt kann aus einer Homepage, mehreren statischen Routen, dynamischen Slugs und gemeinsamen Komponenten bestehen. Der Plattformumfang muss deshalb zwischen Page- und Site-Konvertierung unterscheiden:

```ts
interface SiteManifest {
  schemaVersion: '1.0';
  sourceOrigin: string;
  deployment: {
    targetProfileId: string;
    transactionMode: 'atomic' | 'partial-with-explicit-scope';
    rollbackGroupId: string;
    status: 'planned' | 'deploying' | 'verified' | 'rolled-back' | 'blocked';
  };
  pages: Array<{
    sourceRoute: string;
    targetSlug: string;
    targetPostId?: number;
    kind: 'static' | 'dynamic-template' | '404' | 'redirect';
    sharedComponentIds: string[];
    requiredAssetIds: string[];
    status: 'discovered' | 'extracted' | 'planned' | 'built' | 'verified' | 'blocked';
    snapshotId?: string;
    rollbackStatus?: 'available' | 'restored' | 'failed';
  }>;
  sharedComponents: Array<{
    sourceComponentId: string;
    kind: 'header' | 'footer' | 'template' | 'component';
    targetPostId?: number;
    targetTemplateId?: number;
    version: string;
    status: 'planned' | 'built' | 'verified' | 'blocked';
    snapshotId?: string;
    rollbackStatus?: 'available' | 'restored' | 'failed';
  }>;
  unresolvedRoutes: string[];
}
```

Regeln:

1. Site-Discovery nutzt Projekt-Metadaten, Sitemap, interne Links und explizite Nutzer-Scope-Auswahl.
2. Jede Route erhält ein eigenes Source-/IR-/V3-/QA-Artefakt.
3. Shared Header/Footer/Components werden dedupliziert, aber pro Seite auf ihre Sichtbarkeit und Overrides geprüft.
4. Dynamische Slugs werden nicht still als eine Homepage ausgegeben; sie werden als Template, Snapshot-Liste oder `unsupported` gekennzeichnet.
5. Ziel-Slugs werden normalisiert und Kollisionen vor jeder Mutation blockiert.
6. Cross-Page-Assets und Komponenten verwenden ein gemeinsames, idempotentes Mapping.
7. Partial Site Builds sind zulässig, aber der Report muss vollständig ausweisen, welche Routen fehlen.
8. Vor dem ersten Write wird jede `sourceRoute` deterministisch einer freien `targetPostId` oder einem vorhandenen, ausdrücklich freigegebenen Post zugeordnet; Slug-Kollisionen und unklare Zuordnungen blockieren den Build.
9. `atomic` bedeutet: Bei einem Fehler wird die gesamte Deployment-Gruppe zurückgerollt. Vor dem ersten Write werden für jede Zielseite, jeden gemeinsamen Header/Footer/Template-Datensatz und jede Slug-/Routing-Änderung Snapshots mit `rollbackGroupId` gespeichert. Der Restore stellt `_elementor_data`, Template-Kontext, Status, Slug und gemeinsame Zielobjekte aus diesen Snapshots wieder her; danach folgen Read-back und Cache-Clear-Verifikation. Ein Restore-Fehler setzt den Site-Status auf `blocked` und verhindert weitere Writes.
10. `partial-with-explicit-scope` erlaubt nur vorher festgelegte Routen und muss pro Route Snapshot, Read-back, Cache-Clear und Rollbackstatus ausweisen. Bereits verifizierte Routen bleiben unverändert; eine fehlgeschlagene Route wird isoliert restauriert.
11. Shared Header/Footer/Component-Änderungen werden als eigene, versionierte Deployment-Einheiten behandelt; eine Seite darf nicht auf eine unbestätigte gemeinsame Abhängigkeit zeigen. Ihre Ziel-ID, Version, Snapshot- und Rollback-Status stehen im `sharedComponents`-Manifest.

### 11.16 Maschinenlesbare Fallback- und Abnahmeentscheidungen

Textwarnungen allein reichen für beliebige Projekte nicht. Jede Node, Section, Route und Interaktion erhält eine persistierte Entscheidung:

```ts
interface FidelityDecisionRecord {
  sourceId: string;
  code: string;
  scope: 'node' | 'section' | 'page' | 'site';
  decision: 'native' | 'css-fallback' | 'js-fallback' | 'static-approximation' | 'unsupported';
  capability: string;
  evidenceIds: string[];
  confidence: number;
  severity: 'info' | 'warning' | 'error' | 'critical';
  lostBehavior?: string[];
  approval: 'not-required' | 'pending' | 'approved' | 'rejected';
  blocking: boolean;
  qaChecks: string[];
}
```

Beispiele:

- ein Heading ohne Zweifel: `native`, nicht blockierend,
- ein komplexer Scroll-Transform: `static-approximation`, verlorenes Verhalten dokumentiert,
- eine interaktive Auth-App: `unsupported`, blockierend, Nutzerentscheidung erforderlich,
- ein nicht erreichbares Bild: `css-fallback` ist nicht erlaubt; `unsupported` oder korrigierter Asset-Plan,
- ein Framer-Code-Component-Chart: native Approximation oder isolierter Fallback mit eigener QA-Region.

`code` ist innerhalb eines Builds stabil und maschinenlesbar, `severity` beschreibt die Auswirkung, und `approval` ersetzt freie Chat-Warnungen als Abnahmezustand. Ein Build darf nur dann automatisch weiterlaufen, wenn `blocking=false` für alle Entscheidungen gilt oder alle blockierenden Entscheidungen den Status `approved` besitzen. `rejected` oder `pending` blockieren den betroffenen Scope.

### 11.17 Benchmark-Fixture-Vertrag

Jedes Plattform-Fixture erhält eine reproduzierbare, lizenzierte und secrets-freie Struktur:

```text
tests/fixtures/platform/<fixture-id>/
  fixture.json              # Archetyp, Version, Scope, erwartete Fähigkeiten
  source/                   # anonymisierte XML/HTML/CSS/JSON-Evidence
  components/               # optionale Definitionen und Instanzen
  assets/                   # lokale, lizenzierte Testassets
  expected-ir.json
  expected-decisions.json
  expected-v3-tree.json
  screenshots/desktop.png
  screenshots/tablet.png
  screenshots/mobile.png
  expected-qa.json
```

`fixture.json` enthält mindestens:

- `fixtureVersion`, `sourceAdapter`, `archetype`, `license`,
- erwartete Sections und Rollen,
- erlaubte Approximationen,
- blockierende Unsupported-Fälle,
- Ziel-Viewportprofile,
- kalibrierte QA-Toleranzen.

Golden-Dateien normalisieren nur volatile IDs/Zeitstempel. Layout-, Content-, Asset- und Fidelity-Entscheidungen dürfen nicht normalisiert werden. Externe Live-Projekte werden nur mit ausdrücklicher Berechtigung als opt-in E2E-Tests verwendet; der Standardkorpus bleibt lokal reproduzierbar.

### 11.18 Generisches Plattform-Definition-of-Done

Die Plattform gilt nicht aufgrund eines einzelnen Gelaf-Laufs als bereit. Der Plattform-Meilenstein ist erst erfüllt, wenn:

- [ ] mindestens drei Source-Adapter-Modi denselben IR-Vertrag erzeugen,
- [ ] mindestens zehn unterschiedliche Archetypen im Benchmark-Korpus vertreten sind,
- [ ] mindestens fünf Component-/Variant-/CMS-/Code-Component-Fälle geprüft sind,
- [ ] Multi-Page-Site-Discovery und Partial-Scope-Reports funktionieren,
- [ ] native, CSS-, JS-, statische und Unsupported-Entscheidungen maschinenlesbar sind,
- [ ] keine stillen Placeholder-/Spacer-/Content-Verluste auftreten,
- [ ] Desktop/Tablet/Mobile plus projektspezifische Breakpoints abgedeckt werden,
- [ ] Asset-/Font-Load- und Capture-Integrity-Gates in allen Kern-Fixtures bestehen,
- [ ] V3-Golden-Paths, Target-Capability-Gates, Read-back und Rollback grün sind,
- [ ] section-basierte Visual-Diff-/Geometry-Reports für alle Kern-Fixtures erzeugt werden,
- [ ] mindestens ein negatives Fixture pro kritischer Fehlerklasse den Build korrekt blockiert,
- [ ] die Plattformmetriken pro Archetyp gespeichert und gegen eine versionierte Baseline verglichen werden,
- [ ] pro Kern-Fixture mindestens **95 % Section-Recall**, **95 % Section-Precision**, **99 % erfolgreiche Loads kritischer sichtbarer Assets/Fonts** und **100 % Capture-Integrity-Pass** erreicht werden,
- [ ] Pixelmatch/SSIM die je Fixture kalibrierte Mindestschwelle erreichen; für statische Kern-Fixtures gilt als Start-Gate mindestens **85 % Pixelmatch** und **90 % SSIM**, Ausnahmen benötigen eine versionierte Begründung und Freigabe,
- [ ] `nativeCoverage` für als V3-nativ markierte Fähigkeiten mindestens **80 %** erreicht und `captureSuccessRate` für verpflichtende Viewports **100 %** beträgt,
- [ ] kein kritischer Request-/Renderfehler und kein unbehandelter `unsupported`-Fall in einem sichtbaren Kernbereich offen ist,
- [ ] keine Secrets oder privaten Kundendaten in Fixtures, Reports oder Git landen.

## 12. Quellen und technische Referenzen

- Playwright Screenshots: <https://playwright.dev/docs/screenshots>
- Playwright Emulation: <https://playwright.dev/docs/emulation>
- Elementor Preview/Publish: <https://elementor.com/help/preview-publish-your-page/>
- Elementor Canvas/Full Width: <https://elementor.com/help/canvas-vs-full-width/>
- Elementor Clear Files & Data: <https://elementor.com/help/regenerate-css-data/>
- Repository-interne Ability-Referenz: `docs/NOVAMIRA-ABILITY-PLAYBOOK.md`
- Repository-interne Render-/Diff-Risiken: `docs/CRITICAL-FAILURE-POINTS.md`
- Fallbericht Gelaf: `docs/FRAMER-V3-CONVERSION-GELAF-2026-08-01.md`

---

## 13. Präzisierungen nach Plan-Review

### 12.1 Verbindliche Visual-Diff-Gates

Die folgenden Werte gelten für den ersten produktionsnahen Vergleich. Sie sind bewusst als Gates pro Viewport und Section definiert, nicht nur als globaler Durchschnitt:

| Gate | Warnung | Blockierend |
|---|---:|---:|
| Capture verfügbar | — | `captured=false`, HTTP < 200 oder > 399, Login-/404-/Error-Marker |
| Font-Load | mindestens 95 % erwartete Fonts geladen | kritischer Font für sichtbare Typografie fehlt |
| Bild-Load | mindestens 98 % sichtbare Bilder geladen | sichtbares Hero-/Section-Bild fehlt |
| Section-Präsenz | 100 % Kernsections vorhanden | Hero, Header, Footer oder eine Hauptsection fehlt |
| Section-Höhe | Abweichung > 8 % | Abweichung > 15 % |
| Kern-Bounding-Box | Abweichung > 12 px oder 4 % | Abweichung > 32 px oder 10 % |
| SSIM pro Kernsection | < 0,92 | < 0,82 |
| Pixelmatch pro Kernsection | < 90 % | < 75 % |
| Full-page SSIM | < 0,90 | < 0,78 |
| Full-page Pixelmatch | < 88 % | < 70 % |
| Kritische Hotspots | 1–2 | mehr als 2 oder ein Hotspot in Hero/Navigation |
| Ungeklärte Spacer | > 3 | jeder Spacer im Hero oder über 120 px |
| Container-Tiefe | > 4 | > 6 |

Diese Schwellen sind Startwerte für die erste Iteration. Sie dürfen nur zusammen mit einem begründeten Baseline-Report geändert werden. Ein globaler Durchschnitt darf niemals eine blockierende Section-Abweichung verdecken.

### 12.2 Dimensionen ohne Score-Verfälschung

Pixelvergleich und Seitenhöhen werden getrennt behandelt:

1. Die Browser-Breite und `deviceScaleFactor` müssen identisch sein.
2. Screenshots werden nicht auf gemeinsame Breite oder Höhe skaliert.
3. Für den Pixelvergleich wird nur der gemeinsame sichtbare Overlap-Bereich derselben Breite verglichen.
4. Die Differenz der vollständigen Seitenhöhen wird separat als `heightDeltaPx` und `heightDeltaPercent` ausgewiesen.
5. Zusätzliche Zielhöhe erzeugt einen `extra-content`-Befund; fehlende Zielhöhe erzeugt `missing-content`.
6. `resizeToSameSize()` darf in der Live-Gate-Engine nicht verwendet werden, wenn es Layout auf eine andere Breite skaliert. Resizing bleibt ausschließlich für unkritische Offline-Analysen erlaubt.
7. Bei abweichenden Screenshot-Breiten ist der Vergleich `not scored`, nicht interpoliert.

### 12.3 Stabiler Section-Mapping-Vertrag

Jede emittierte Elementor-Section erhält gleichzeitig:

- `data-source-id` bzw. eine äquivalente stabile CSS-Klasse,
- `data-source-role` bzw. eine äquivalente Rollenklasse,
- eine deterministische Reihenfolgeposition,
- den ursprünglichen Source-ID-Verweis im lokalen IR-/Build-Manifest.

Das Mapping erfolgt in dieser Reihenfolge:

1. identische stabile Source-ID,
2. identische semantische Rolle plus Reihenfolgeposition,
3. Rollen-/Text-/Geometrie-Signatur,
4. kein Fallback bei Mehrdeutigkeit: Section wird als `unmapped` gemeldet.

Fehlende Sections, zusätzliche Sections und doppelte Rollen werden als strukturelle Fehler vor dem Pixel-Score ausgewiesen. Section-Crops verwenden die gemappten Bounding-Boxes aus den Capture-Manifests; feste Y-Ranges wie „900–2200“ sind nur noch ein expliziter Fallback für nicht gemappte Legacy-Läufe.

### 12.4 Preview-Strategie mit klarer Priorität

Die Zielseite darf für den Vergleich nur in dieser Reihenfolge geöffnet werden:

1. **Authentifizierte Storage-State-Preview:** einmalige lokale Browser-Session mit minimal nötiger WordPress-Berechtigung; State-Datei bleibt gitignored und wird nie geloggt.
2. **Bereits vorhandener, kurzlebiger Public-Preview-Mechanismus:** nur wenn auf dem Ziel bereits installiert und read-only verifizierbar; kein Plugin wird ungefragt installiert oder konfiguriert.
3. **Temporäres Publish der isolierten Testseite:** nur nach ausdrücklicher Nutzerfreigabe, mit vorherigem Snapshot, eindeutigem Test-Slug und anschließendem Zurücksetzen auf Draft.

Ein `preview=true` ohne gültige WordPress-Nonce und Berechtigung ist kein Preview-Vertrag. Die Pipeline muss Login-Redirects, „not allowed to preview drafts“, 404 und WordPress-Error-Seiten erkennen und ohne Score abbrechen.

### 12.5 Verbindliche Font-/Asset-Entscheidung

Für Gelaf wird im pixelnahen Modus folgende Strategie verwendet:

- Sichtbare Fonts werden bevorzugt als lokale WordPress-Assets bzw. über den bereits erlaubten, stabilen Font-Mechanismus des Ziels eingebunden.
- Externe Framer-CDN-Fonts bleiben nur zulässig, wenn sie im Ziel-Browser mit HTTP 2xx geladen und über `document.fonts.check()`/`document.fonts.ready` bestätigt werden.
- Jede erwartete Font-Familie und jedes kritische Gewicht erhält einen Load-Status im Capture-Manifest.
- Sichtbare Bilder werden bevorzugt in die WordPress Media Library übernommen und im Tree mit stabiler Ziel-URL/Attachment-Zuordnung referenziert.
- Externe Bild-URLs sind nur zulässig, wenn Status, MIME-Type, Dimensionen und Browser-Decode erfolgreich sind.
- Ein fehlendes Hero-Bild oder ein fehlender kritischer Font blockiert den visuellen Gate-Lauf.

### 12.6 Animations- und Zustandsvertrag

Der erste Vergleich ist ein **statischer Initialzustand**:

- Scrollposition `0` für Fold-Aufnahmen,
- definierte Scrollpositionen für Section-Aufnahmen,
- `prefers-reduced-motion: reduce`,
- CSS-Animationen und Transitions im Capture-Kontext deaktiviert,
- Carets, Blinkeffekte und zufällige Cursor-/Hover-Zustände deaktiviert,
- stabile Daten-/Cookie-/Consent-Situation ohne sichtbare Banner.

Danach können optionale Zustandsvergleiche folgen:

1. Hero bei initialem Load,
2. Navigation bei Mobile-Open,
3. Section nach kontrolliertem Scroll,
4. Hover/Focus nur als separater QA-Lauf.

Ein Unterschied durch bewusst nicht emittierte Framer-Animation wird als `interaction-gap` dokumentiert, nicht als zufälliger Pixel-Fehler.

### 12.7 CLI-/Engine-Namensbereinigung

Das Migrationsziel lautet:

- `--source-url` statt `--v3-url`,
- `--target-url` statt `--v4-url`,
- `source`/`target` in JSON und Reports,
- `packages/qa` als einzige kanonische Capture-/Diff-Engine.

`scripts/visual-diff.mjs` bleibt während der Migration als kompatibler Wrapper bestehen, delegiert aber an die kanonische Engine. Die alten V3/V4-Bezeichnungen werden als deprecated markiert, damit nicht erneut der Eindruck entsteht, V4 werde verglichen oder ein Ziel sei automatisch verfügbar.

### 12.8 Scope-Grenze für Gelaf

Der aktuell belastbare Implementierungsscope bleibt ausdrücklich die Homepage. Die neun übrigen Proofly-Seiten dürfen erst in den IR-/Build-Scope aufgenommen werden, wenn ihre Payloads Layer-/DOM-Inhalt enthalten und die semantische Validierung bestehen.

Die erwarteten Homepage-Sections werden nicht als bereits vollständig exportiert behauptet, sondern als **zu validierende Zielstruktur** geführt. Eine Phase gilt erst als bestanden, wenn jede Rolle durch mindestens zwei unabhängige Signale bestätigt ist, zum Beispiel:

- XML/Component-Struktur plus Live-DOM,
- Live-DOM plus Screenshot-/Geometry-Segment,
- HTML/CSS plus Text-/Asset-Inventar.

### 12.9 Provenienz im Elementor-V3-Tree

Elementor V3 rendert nicht automatisch beliebige `data-*`-Attribute aus dem JSON. Die Source-Provenienz muss deshalb über unterstützte Felder abgebildet werden:

1. Die JSON-Node-`id` erhält eine deterministische Elementor-Node-ID.
2. `_element_id` erhält eine CSS-sichere, deterministische gerenderte Element-ID, zum Beispiel `gelaf-src-hero`.
3. `css_classes` wird nur verwendet, wenn das Live-Schema es als **String** akzeptiert; ein Array ist verboten, weil es als literal `Array` gerendert werden kann. `_css_classes` darf nicht ungeprüft angenommen werden. Die Klasse erhält Rollen- und Build-Klassen, zum Beispiel `gelaf-section gelaf-role-hero`.
4. Falls das Ziel-Ability-Schema Custom Attributes unterstützt, werden `data-source-id` und `data-source-role` zusätzlich dort geschrieben.
5. Wenn Custom Attributes nicht unterstützt werden, gelten die verifizierte gerenderte `_element_id` plus die verifizierte CSS-Klasse als kanonischer Marker; der Capture-Probe muss die tatsächlich gerenderten Selektoren kennen.
6. Eine Provenienz-Map `sourceId -> elementorNodeId -> renderedElementId -> renderedSelector` wird neben dem Tree gespeichert.

Die Pipeline darf nicht voraussetzen, dass eine nicht unterstützte Elementor-Einstellung sichtbar gerendert wird. Vor dem ersten Live-Diff wird mit einem kleinen isolierten Probe-Element und dem tatsächlichen V3-Deploy-/Read-back-Pfad verifiziert, welche von `_element_id`, `css_classes` und Custom Attributes im Frontend ankommen.

### 12.10 Score-Einheiten und Tiefenmessung

Die Report-Verträge verwenden explizite Feldnamen und Einheiten:

- `ssimScore`: Zahl von `0` bis `1`.
- `pixelMatchPercent`: Zahl von `0` bis `100`.
- `heightDeltaPx`: Pixelwert.
- `heightDeltaPercent`: Prozentwert.
- `bboxDeltaPx`: größter bzw. pro Achse dokumentierter Pixelwert.

Die Tiefen-Gates unterscheiden drei Messgrößen:

- `elementTreeDepth`: Tiefe aller V3-Elemente ab Top-Level-Node.
- `containerDepth`: Tiefe nur der `container`-/`column`-Nodes.
- `renderedDomDepth`: Tiefe des tatsächlich gerenderten DOMs unter der gemappten Section.

Die Grenzwerte `>4`/`>6` im Plan beziehen sich auf `containerDepth` des V3-Trees. Der Novamira-`layout-audit`-Wert wird separat als Server-Metrik dokumentiert und nicht ohne Umrechnung mit `containerDepth` gleichgesetzt.

### 12.11 Preview-Blocker und authentifizierter Kontext

Vor Sprint A muss genau eine Renderzugangsvariante freigegeben werden:

1. Storage-State-Preview,
2. bereits vorhandener Public-Preview-Mechanismus,
3. temporäres Publish der isolierten Testseite.

Ohne diese Entscheidung kann der Umbau lokal und als Draft vorbereitet werden, aber der Live-Visual-Diff bleibt blockiert. Es wird keine Preview- oder Publish-Mutation aus dieser Planung automatisch abgeleitet.

Bei Storage-State wird der Vergleichskontext ausdrücklich bereinigt:

- Admin-Bar, Editor-Overlays und Debug-UI werden nicht in den Screenshot aufgenommen.
- Quelle und Ziel werden entweder beide anonym verglichen oder beide mit einem gleichwertigen, bereinigten Kontext aufgenommen.
- Login-Redirects und Berechtigungsfehler bleiben harte Capture-Fehler.
- Der Auth-Modus wird im Manifest nur als Kategorie geführt; Cookies, Tokens und Nonces werden nie gespeichert oder geloggt.

### 12.12 Kalibrierung und schrittweise Engine-Migration

Die numerischen Gates in Abschnitt 12.1 sind **Startwerte für eine deterministische Baseline**, keine offiziellen Elementor- oder Pixelmatch-Standards. Nach dem ersten stabilen Source-/Target-Capture werden sie anhand von:

- wiederholten Captures derselben unveränderten Seite,
- Font-/Image-/Browser-Stabilität,
- section-spezifischen natürlichen Schwankungen,
- und der gewünschten visuellen Qualitätsstufe

kalibriert. Die Baseline muss dokumentieren, warum ein Grenzwert geändert wurde.

Die Diff-Engine wird nicht in einem Big-Bang umgebaut. Die Reihenfolge ist:

1. bestehende Aufrufer und ihre aktuellen Ergebnisverträge mit Tests absichern,
2. kanonische Capture-Manifeste und Statusmodell einführen,
3. `runComprehensiveDiff()` um die neue Dimension-/Availability-Policy erweitern,
4. `cmd-qa` und `v3v4-diff` schrittweise auf die kanonische Engine umstellen,
5. `scripts/visual-diff.mjs` als kompatiblen Source/Target-Wrapper weiterführen,
6. Legacy-Engines erst entfernen oder als deprecated markieren, wenn alle Aufrufer migriert und die Release-Gates grün sind.

---

# Repository-Charta — Beliebige Framer-Projekte → Elementor V3

**Status:** verbindlicher Soll-/Zielvertrag für neue Arbeit
**Geltungsbereich:** `unified-elementor-converter`
**Ziel:** beliebige Framer-Projekte so zuverlässig wie möglich als editierbare Elementor-V3-Seiten rekonstruieren
**Nicht-Ziel:** eine einzelne Fallstudie durch projektspezifische Sonderlogik „grün“ zu machen

> Diese Charta ist der sichtbare gemeinsame Vertrag für Menschen und KI-Agenten. Sie beschreibt die Zielarchitektur, verbindlichen Qualitätsmaßstab und erlaubten Fallbacks. Sie ist **nicht** die Behauptung, dass bereits jeder Vertrag vollständig implementiert ist. Der aktuelle Umsetzungsstand und die offenen Lücken stehen im [`Repository-Audit`](./REPOSITORY-AUDIT-AND-CONVERGENCE-2026-08-01.md), insbesondere bei eigenständiger URL-Extraktion, vollständigem Visual-IR-Hauptpfad, großen Deploy-Strategien und QA-Konsolidierung.

---

## 1. Die zentrale Wahrheit

Ein gültiger Elementor-JSON-Tree ist **nur ein Zwischenprodukt**. Er beweist nicht, dass:

- die Quelle vollständig extrahiert wurde,
- alle Sections und Komponenten erhalten sind,
- Heading-, Text-, Bild- und Button-Inhalte stimmen,
- Fonts tatsächlich geladen werden,
- das Ziel-Template korrekt ist,
- Elementor-CSS und Cache aktuell sind,
- die Seite im Frontend erreichbar ist,
- Desktop, Tablet und Mobile korrekt reagieren,
- der Screenshot-Vergleich eine echte Referenz verwendet.

**Done bedeutet daher nicht „JSON gespeichert“.** Done bedeutet:

```text
Quelle semantisch validiert
→ Visual IR validiert
→ V3-Tree mit nachvollziehbaren Entscheidungen erzeugt
→ Guards bestanden
→ isoliert deployt
→ Read-back stimmt
→ Cache/CSS verifiziert
→ echter Ziel-Render erreichbar
→ jeder angeforderte Viewport capturable
→ Struktur, Geometrie und Visual-Diff geprüft
→ verbleibende Abweichungen erklärt
```

Ein MCP-HTTP-200, ein erfolgreicher Write oder `visual-qa: 0 Issues` ohne echten Screenshotvergleich ist **kein visueller Erfolg**.

---

## 2. Plattformziel: „beliebig“ mit ehrlichen Grenzen

„Beliebiges Framer-Projekt“ bedeutet, dass jeder Input einen überprüften und sichtbaren Ausgang erhält:

1. **native** — direkt mit Elementor-V3-Widgets/Settings umgesetzt,
2. **css-fallback** — page- oder section-scoped CSS, wenn native Settings nicht reichen,
3. **js-fallback** — ausdrücklich begrenztes, page-scoped Verhalten mit Sicherheits- und Cleanup-Gate,
4. **static-approximation** — sichtbarer Zustand wird erhalten, dynamisches Verhalten dokumentiert,
5. **unsupported** — Umsetzung ist nicht sicher möglich; Grund und nächste Aktion werden ausgegeben.

Es bedeutet **nicht**, dass jede Framer-Laufzeitfunktion in klassisches Elementor V3 übertragbar ist. Code Components, Canvas/WebGL, private CMS-Zustände, komplexe Scroll-Physik und authentifizierte App-Zustände können außerhalb eines statischen V3-Trees liegen.

**Verboten:** stilles Löschen, erfundene Inhalte, erfundene Asset-URLs, pauschale Spacer, Roh-XML als sichtbarer Text und ein Erfolgstatus trotz ungeklärter Kernverluste.

---

## 3. Verbindliche Architektur

Der generische Hauptpfad ist:

```text
Source Adapter
  → Source Manifest + Evidence
  → Source Validation
  → Versioned VisualPageIR
  → V3 Layout Planner
  → V3 Emitter
  → V3 Guards
  → Snapshot / Deploy
  → Read-back / Cache / Render Contract
  → Canonical Capture
  → Structure + Geometry + Pixel/SSIM QA
  → Report / Repair Decision
```

### 3.1 Verbindliche Grenzen

- `packages/core`: target-neutrale Verträge, Evidence, IR, Status und gemeinsame Mechanismen.
- `packages/extractors`: Unframer-/Proofly-/Live-DOM-/Export-Adapter und Source-Evidenz.
- `packages/target-v3`: Planung und Emission klassischer V3-Elemente.
- `packages/target-v4`: ausschließlich V4 Atomic.
- `packages/mcp`: Target-Profil, Ability-Registry, Snapshot, Deploy, Read-back und Cache-Verträge.
- `packages/qa`: kanonische Capture-, Diff- und Reparaturdiagnostik.
- `packages/cli`: Orchestrierung, Status, Artefakte und ehrliche Exit-Codes.

### 3.2 V3/V4-Isolation

V3 und V4 bleiben strikt getrennt:

- Kein `e-flexbox` oder V4-`$type` in einem V3-Tree.
- Keine V3-Widgets in einem V4-Atomic-Tree.
- Target-spezifisches Wissen bleibt in `target-v3/` bzw. `target-v4/`.
- Contamination Guards laufen vor jedem Deploy.
- V3 verschachtelte Trees werden nicht über `batch-build-page` deployt; der vollständige Array-Payload läuft über den dafür vorgesehenen V3-Pfad.

---

## 4. Source-Vertrag: Was muss vor dem Build bekannt sein?

Die Plattform unterstützt mehrere Quellen, ohne eine davon als garantiert vollständig anzunehmen:

- Unframer-MCP,
- Proofly-MCP,
- öffentliche Framer-Live-URL,
- lokaler Framer-/HTML-/CSS-/Asset-Export,
- Hybrid aus MCP-Struktur und Live-DOM,
- Screenshot-only als ausdrücklich eingeschränkter Modus.

Jeder Adapter muss liefern oder sichtbar als fehlend markieren:

- Projekt-/Seiten-/Routen-Inventar,
- Component-Definitionen und Instanzen,
- Varianten und Instanz-Overrides,
- Assets und Fonts,
- Design Tokens und Text Styles,
- HTML/CSS/DOM-Evidence,
- Screenshots und Viewports,
- responsive Daten,
- Interaktions-/Animationshinweise,
- Warnings, Confidence und Konflikte.

### 4.1 Semantische Validierung ist Pflicht

Folgende Aussagen reichen **nicht** als Erfolg:

- HTTP 200,
- MCP-Handshake erfolgreich,
- `tools/list` erfolgreich,
- XML-Element vorhanden,
- JSON syntaktisch gültig,
- Screenshot-Datei erzeugt.

Zusätzlich muss geprüft werden:

- enthält die Payload tatsächlich Layer/Content?
- ist die Seite nicht leer, nicht nur ein Wrapper und nicht eine Fehlerseite?
- sind verwendete Komponenten aufgelöst oder als offen markiert?
- sind Assets erreichbar, decodierbar und inhaltlich plausibel?
- stimmen DOM, XML, CSS und Screenshot-Evidenz ausreichend überein?

Eine leere oder widersprüchliche Quelle wird als `source-incomplete` bzw. `semantic-failure` ausgegeben und nicht still als vollständige Quelle verwendet.

---

## 5. VisualPageIR als verbindlicher Plattformvertrag

Der produktive generische Build muss die target-neutrale IR-Grenze passieren. Das vorhandene Visual IR in `packages/core/src/contracts/visual-ir.contract.ts` ist dafür die kanonische Basis.

Das IR muss mindestens abbilden:

- Seite, Route, Locale und Theme-Kontext,
- Sections in stabiler Reihenfolge,
- semantische Rollen und Layout-Archetypen,
- XML-/DOM-/Screenshot-Provenienz,
- Component-Definitionen und Instanzen,
- Varianten, States und Instance-Overrides,
- CMS-/Collection-Referenzen,
- Text, Rich Text, Links und Heading-Level,
- Bild, Background, SVG, Video, Icon, Lottie und Canvas,
- Fonts, Farben, Text Styles und Spacing Tokens,
- Desktop/Tablet/Mobile und benutzerdefinierte Breakpoints,
- Hover, Focus, Active, Open, Scroll und Load States,
- erwartete Bounding Boxes pro Viewport,
- Confidence, ungelöste Konflikte und Fidelity Decisions.

Jede sichtbare Section und jeder relevante Node benötigt:

```text
sourceId
role / layoutArchetype
evidence methods + sourceIds
confidence
warnings / conflicts
responsive overrides
expected geometry
```

### 5.1 Confidence-Regeln

- `>= 0.85`: automatische native Planung zulässig.
- `0.60–0.84`: Planung zulässig, aber Review-/QA-Hinweis verpflichtend.
- `< 0.60`: keine spekulative Spezialstruktur; sicherer Fallback oder Benutzerentscheidung.
- Widersprüchliche Quellen werden als Konflikt gespeichert, nicht überschrieben.

---

## 6. Layout- und Komponentenregeln

Namensheuristiken wie `hero`, `button`, `section` oder `card` dürfen nur schwache Signale sein. Entscheidungen kombinieren:

- XML-/DOM-Struktur,
- Computed Styles,
- Bounding Boxes,
- Layout-Richtung und Positionierung,
- wiederholte Child-Signaturen,
- Sichtbarkeit,
- Component-Metadaten,
- Screenshot-/Vision-Evidence.

### 6.1 Wrapper

Jeder Wrapper wird klassifiziert als:

- visual wrapper,
- layout-only wrapper,
- component root,
- overlay/absolute layer,
- asset wrapper,
- unknown.

Layout-only Wrapper werden **vor** der V3-Emission reduziert. Nachträgliches blindes Flattening ist nur ein Safety-Net.

### 6.2 Spacer

Ein leerer Frame ist nicht automatisch ein Spacer. Ein Spacer darf nur entstehen, wenn:

- seine visuelle Funktion nachgewiesen ist,
- eine Höhenquelle vorhanden ist,
- die Entscheidung im Report steht,
- der Spacer-Anteil ein konfiguriertes Gate nicht überschreitet.

### 6.3 Native Widgets zuerst

V3 bevorzugt:

- `heading`,
- `text-editor`,
- `image`,
- `button`,
- `icon`/`icon-box`,
- `accordion`/`toggle`,
- `divider`,
- `spacer` nur begründet.

Ein HTML-Widget ist kein Ersatz für eine fehlende Seitenstruktur. `<img>` in HTML-Blobs, komplette Sections als HTML und Roh-XML im sichtbaren Content sind Anti-Patterns.

### 6.4 Komponenten

Definition und Instanz müssen getrennt werden:

1. Definition dedupliziert abrufen.
2. Varianten und States auflösen.
3. Instanz-Controls und Overrides erhalten.
4. Rekursion, Zyklen und Expand-Budget prüfen.
5. Nicht auflösbare Code Components sichtbar approximieren oder als `unsupported` markieren.

---

## 7. Tokens, Fonts und Assets

Ein Asset ist nicht erfolgreich, nur weil eine URL existiert. Der Asset-Lifecycle umfasst:

- URL-Normalisierung und Redirect-Prüfung,
- MIME-Type und Decode-Prüfung,
- Dimensionen und Aspect Ratio,
- Focal Point,
- `object-fit` und `object-position`,
- Widget-Bild versus Section-Background,
- responsive Bildvarianten,
- SVG-Sanitizing,
- externe URL oder WordPress-Media-Mapping,
- Alt-Text,
- Font-Familie, Gewicht und Style,
- tatsächlichen Font-Load im Zielbrowser.

Sichtbare ungelöste Bilder oder Fonts blockieren den betreffenden Section-/Render-Gate oder werden explizit als Fallback ausgewiesen. Es werden keine URLs erfunden.

---

## 8. Elementor-Zielvertrag

Vor einem Build wird das konkrete Ziel profiliert:

- WordPress-, PHP-, Elementor- und Elementor-Pro-Version,
- Theme und Page Template,
- verfügbare Widgets und Pro-Features,
- globale Fonts/Styles,
- externe Asset-Regeln und Media-Upload,
- Custom-CSS-/JS-Erlaubnis,
- Cache-/CSS-Regeneration,
- MCP-Abilities und ihre Schemas,
- Preview-/Auth-Möglichkeit.

Deployment ist eine Transaktion:

```text
Snapshot
→ isolierte Draft-Seite
→ V3 Array-Payload
→ Read-back
→ semantischer Tree-/Shape-Vergleich
→ Element Count
→ Template-Prüfung
→ Elementor-Dokument-Cache-Clear
→ CSS-/Frontend-Verifikation
→ Preview-/Live-Capture
→ Rollback bei Abweichung
```

Ein erfolgreicher MCP-Write ohne Read-back und Frontendprüfung ist ein **unvollständiger Deploy**.

---

## 9. Zielbild für kanonische Visual-QA

Es soll künftig genau einen kanonischen Live-Vergleichspfad geben. Bis diese Konsolidierung vollständig umgesetzt ist, existieren im Repository mehrere Legacy-/Kompatibilitätspfade; neue generische Arbeit darf deren Unterschiede nicht verschleiern und muss den Status jedes Pfades ausdrücklich ausweisen. Legacy-Skripte sollen schrittweise delegieren oder klar als Legacy markiert werden.

Jede Quelle und jedes Ziel erhält pro Viewport ein `CaptureManifest` mit:

- URL und finaler URL,
- HTTP-Status und Redirects,
- Auth-/Preview-Modus ohne Secrets,
- Viewport und Device Scale Factor,
- Content-/Error-Marker,
- Font- und Image-Status,
- Console- und Request-Fehler,
- DOM-Höhe und Screenshot-Dimensionen,
- horizontalem Overflow,
- Stabilitäts-/Timeout-Diagnostik,
- Screenshot-Artefakt,
- Status und `notScoredReason`.

Capture prüft mindestens:

- Login-, 404-, Redirect- und Error-Seiten,
- Hydration und Elementor-Init,
- `document.fonts.ready`,
- sichtbare Bild-Decodes bzw. Full-Page-Bildstatus,
- Layout-Stabilität,
- deaktivierte Animationen/Transitions/Carets,
- eigene Timeouts je Viewport,
- PNG-Größe und Dimensionskonsistenz.

### 9.1 Keine falschen Scores

Ein Score entsteht nur, wenn beide Seiten erreichbar und semantisch korrekt capturable sind.

Statuswerte:

```text
captured
scored
not-scored
capture-timeout
capture-error
render-fail
```

Unterschiedliche Seitenhöhen werden nicht still auf die kleinere Höhe beschnitten. Der Report trennt:

- Fold-/Overlap-Score,
- Full-Page-Score,
- Höhen-Parität,
- Section-Parität,
- Content-Parität,
- Geometry-Diff,
- Pixelmatch,
- SSIM,
- Hotspots und Heatmap.

`visual-qa: 0 Issues` ohne echtes Screenshotpaar ist kein visueller Pass.

---

## 10. Zwei Release-Gates

### Gate A — Renderbarkeit

Bestanden nur bei:

- HTTP 2xx,
- korrekter finaler URL,
- kein Login-/404-/Error-Render,
- erwartete Content-Marker,
- Fonts bereit,
- kritische Assets geladen,
- keine ungeklärten kritischen CSS-/Request-Fehler,
- stabile und viewport-konsistente Screenshots,
- `captureIntegrity=pass`.

### Gate B — Visuelle Treue

Bestanden nur bei:

- Sections in richtiger Reihenfolge,
- plausible Heading-/Text-/Button-/Image-Parität,
- keine kritischen fehlenden Assets,
- Geometrie innerhalb projektbezogener Toleranzen,
- kein horizontaler Overflow,
- Desktop/Tablet/Mobile geprüft,
- Pixelmatch und SSIM erzeugt und bewertet,
- verbleibende Fallbacks und Differenzen dokumentiert.

Gate B darf nicht bewertet werden, wenn Gate A nicht bestanden ist.

---

## 11. Benchmark-Korpus und Plattformmetriken

Eine einzelne Landingpage ist kein ausreichender Plattformtest. Das Benchmark-Korpus muss mindestens abdecken:

- Marketing-Landingpage,
- SaaS/Product und Pricing,
- Portfolio/Gallery,
- Editorial/Blog,
- Event/Membership,
- Component-heavy Framer,
- CMS/Collection,
- Dark Theme,
- Mobile-first,
- Sticky/Scroll Narrative,
- Formulare,
- Tabs/Accordion/Carousel,
- Code Component/Canvas-Fallback.

Pro Fixture gehören dazu:

- Source Evidence,
- SourceManifest,
- VisualPageIR,
- V3-Golden-Tree,
- Fidelity Decisions,
- Capture-Fixtures,
- erwartete Warnungen und Regressionstests.

Langfristig werden mindestens gemessen:

- Source Completeness,
- IR Confidence und Konfliktrate,
- Section Recall/Precision,
- Widget Recall nach Typ,
- Asset- und Font-Load-Success,
- Native Coverage versus Fallback-Anteil,
- Responsive- und Interaction-Coverage,
- Container Depth P95,
- Capture Success Rate,
- Visual Score je Archetyp,
- Reparaturrunden und Rollback-Rate.

---

## 12. Verbindliche Definition of Done

Ein beliebiges Projekt gilt erst als erfolgreich, wenn:

- [ ] Source vollständig oder explizit begrenzt ist.
- [ ] Source-Payload semantisch validiert ist.
- [ ] VisualPageIR validiert ist.
- [ ] Jede sichtbare Section und jeder relevante Node Provenienz besitzt.
- [ ] Jede sichtbare Fidelity-Entscheidung dokumentiert ist.
- [ ] Assets und Fonts geladen oder explizit als Fallback markiert sind.
- [ ] Keine stillen Roh-XML-, Placeholder- oder Spacer-Fallbacks existieren.
- [ ] V3-Tree-Gates und V3/V4-Contamination-Gates grün sind.
- [ ] Tree-Tiefe und HTML-Widget-Budget eingehalten sind.
- [ ] Target-Capabilities und Template-Kontext zum Build passen.
- [ ] Snapshot, Deploy, Read-back und Rollback-Vertrag bestanden sind.
- [ ] Elementor-Cache/CSS und Frontend-Render verifiziert sind.
- [ ] Jeder angeforderte Viewport einen eigenen gültigen Capture-Status besitzt.
- [ ] Kein Score aus einer fehlerhaften oder beschnittenen Capture-Grundlage entsteht.
- [ ] Section-, Content- und Geometry-Parität geprüft sind.
- [ ] Pixelmatch/SSIM nur bei gültiger Referenz bewertet werden.
- [ ] Unsupported-/Approximation-Entscheidungen erklärt und akzeptiert sind.
- [ ] Build reproduzierbar, auditierbar und rollback-fähig ist.

---

## 13. Arbeitsauftrag für künftige KI-Agenten

Vor jeder Implementierung:

1. Aktive Produktionspfade und Legacy-Pfade anhand von Code, Tests und Artefakten feststellen.
2. Keine Dokumentationsbehauptung als Implementierungsnachweis akzeptieren.
3. Einen kleinen, priorisierten Plan mit P0/P1/P2 und betroffenen Dateien vorlegen.
4. Pro Änderung echte Regressionstests schreiben.
5. Keine Live-Mutation ohne explizites isoliertes Target, Snapshot und Rollback.
6. Nach jeder Phase Typecheck, betroffene Tests, seriellen Volltest, Lint und `git diff --check` ausführen.
7. Einen unabhängigen Code-Review durchführen lassen.
8. Reports bei Fehlern trotzdem mit ehrlichem Status erzeugen.
9. Keine Secrets in Code, Artefakten, Reports oder Git.
10. Bei Informationsmangel `not-scored`, `source-incomplete` oder `unsupported` melden statt zu raten.

**Neue Plattformlogik gehört in dieses Repository.** Die Vorgänger-Repositories bleiben Maintenance-/Migrationsreferenzen und dürfen keine dritte divergierende Hauptpipeline erhalten.

---

## Verwandte Dokumente

- [`REPOSITORY-AUDIT-AND-CONVERGENCE-2026-08-01.md`](./REPOSITORY-AUDIT-AND-CONVERGENCE-2026-08-01.md) — aktueller Audit und priorisierte offene Arbeiten
- [`REBUILD-PLAN-FRAMER-ELEMENTOR-V3-VISUAL-FIDELITY-2026-08-01.md`](./REBUILD-PLAN-FRAMER-ELEMENTOR-V3-VISUAL-FIDELITY-2026-08-01.md) — ausführlicher technischer Umbauplan
- [`AI-EXECUTOR-PLAYBOOK.md`](./AI-EXECUTOR-PLAYBOOK.md) — operative Regeln für KI-Agenten
- [`CRITICAL-FAILURE-POINTS.md`](./CRITICAL-FAILURE-POINTS.md) — reproduzierte Fehler und Gegenmaßnahmen
- [`VISUAL-QA-IMPROVEMENTS-2026-07.md`](./VISUAL-QA-IMPROVEMENTS-2026-07.md) — Visual-QA-Verträge und Verbesserungen
- [`PRODUCT-BACKLOG-P1-P10.md`](./PRODUCT-BACKLOG-P1-P10.md) — generischer Backlog für Framer→V3

# Visual-Capture-Diagnose — 2026-08-01

## Ergebnis

Der Screenshot-Capture scheitert nicht grundsätzlich an Chromium, Playwright oder der Erreichbarkeit der Seiten.

Ein unabhängiger `agent-browser`-Lauf konnte erfolgreich:

- die Framer-Quelle öffnen und als Full-Page-PNG speichern,
- die veröffentlichte WordPress-Testseite öffnen und als Full-Page-PNG speichern,
- `http://hcm.local/?page_id=644` korrekt auf die Testseite auflösen.

Damit ist bewiesen, dass beide Seiten grundsätzlich renderbar und erreichbar sind. `agent-browser` wurde nicht als Produktions-Backend integriert.

## Reproduzierter Playwright-Befund

Der diagnostische Playwright-Lauf wurde mit 390×844 Pixeln, jeweils als Viewport- und Full-Page-Capture, ausgeführt.

### Framer

- HTTP: 200
- Titel: `Gelaf - Golf Club Sports Website`
- Viewport-Capture: PNG wurde erzeugt, aber nicht gescored
- Full-Page-Capture: PNG wurde erzeugt, aber nicht gescored
- Grund: `asset wait timed out with 13 pending image(s)`
- Console-Fehler: 0
- Request-Fehler: 0
- Full-Page-DOM-Höhe: ca. 20.438 px
- Full-Page-Scroll: 25 Iterationen, kein Safety-Cap

### WordPress-Ziel

- HTTP: 200
- Titel: `Gelaf V3 Proofly Test 2026-08-01 – hcm.b-o-w.de`
- Viewport-Capture: PNG wurde erzeugt, aber nicht gescored
- Full-Page-Capture: PNG wurde erzeugt, aber nicht gescored
- Grund: `asset wait timed out with 52 pending image(s)`
- Console-Fehler: 3
- Request-Fehler: 3
- Full-Page-DOM-Höhe: ca. 25.041–27.375 px
- Full-Page-Scroll: 33 Iterationen, kein Safety-Cap

Ein Screenshot-Artefakt existiert also. Das bisherige Problem war die Kombination aus unbeschränkter Stabilisierung und einem strikten Score-Gate, nicht das grundsätzliche Erzeugen eines PNGs.

## Umgesetzte Verbesserungen

In `packages/qa/src/visual-capture.ts`:

- Capture-Phasen werden im Manifest erfasst:
  - Navigation
  - Selector
  - Initial-/Final-Assets
  - Scroll
  - DOM-Inspektion
  - Screenshot
  - PNG-Parsing
  - Schreiben des Artefakts
- `document.fonts.ready` und Bild-Decoding haben eine begrenzte Wartezeit.
- Dynamisches Full-Page-Scrolling hat maximale Iterationen und eine maximale Seitenhöhe.
- Das Manifest enthält:
  - aktive Phase bei Fehlern,
  - Dauer je Phase,
  - Gesamtzeit,
  - Pending-Bilder,
  - Scroll-Höhen und Iterationen,
  - Asset-Timeout- und Scroll-Cap-Flags.
- Der Legacy-Screenshot-Pfad bleibt strikt: Asset-Timeouts und Scroll-Caps führen zu einem Fehler statt zu einem stillschweigend unvollständigen Capture.
- Ausgabe-Verzeichnisse werden vor dem Screenshot angelegt.

In `packages/qa/src/canonical-live-diff.ts`:

- Captures mit `assetWaitTimedOut` oder `scrollCapped` werden nicht gescored.
- Der zentrale PNG-/Dimensionen-/Bytes-Gate bleibt aktiv.

Tests:

- Regressionstest für Scroll-Safety-Cap.
- Regressionstest für strikten Legacy-Capture.
- Regressionstest für stabilen Viewport-Capture.
- Regressionstests für Diagnoseflags im kanonischen Score-Gate.

## Verifikation

- TypeScript Workspace-Build: bestanden
- Fokussierte QA-/CLI-Tests: 15 bestanden
- Vollständiger serieller Vitest-Lauf: 1.211 bestanden, 2 übersprungen
- Testdateien: 110 bestanden
- ESLint der geänderten QA-Quellen: bestanden
- `git diff --check`: bestanden

## Warum `agent-browser` nicht die endgültige Lösung ist

`agent-browser` ist als unabhängiger Kontrolltest wertvoll, weil es außerhalb der Node-/Playwright-Stabilisierung arbeitet. Es beweist hier, dass die Seiten und ein Browser-Screenshot grundsätzlich funktionieren.

Es ersetzt aber nicht:

- die DOM-/Asset-Analyse,
- die viewport-identische Capture-Paarung,
- das PNG-Integritäts-Gate,
- Pixelmatch/SSIM,
- die Elementor-Reparaturschleife.

Der nächste sinnvolle Schritt ist daher nicht eine sofortige Migration, sondern die Fehlerursachen der 13 Framer- und 52 WordPress-Bilder zu identifizieren und zu entscheiden, ob diese Bilder als tatsächlich fehlend, lazy-loaded oder absichtlich dauerhaft pending klassifiziert werden müssen.

## Finaler Live-Befund nach dem Lazy-Load-Fix

Der kanonische Multi-Viewport-Lauf wurde erneut mit Desktop, Tablet und Mobile ausgeführt.

### Framer-Quelle

Alle drei Viewports sind `captured` und damit technisch scorable:

- Desktop: 1440 px breit, 12.635 px hoch
- Tablet: 768 px breit, 30.177 px hoch
- Mobile: 390 px breit, 20.438 px hoch
- `pendingImages`: 0 in allen Viewports
- Console- und Request-Fehler: 0
- Horizontaler Overflow: 0 px

### WordPress-Ziel

Alle Bilder werden nach der Capture-seitigen Lazy-Load-Promotion geladen, aber der Ziel-Render bleibt nicht scorable:

- Desktop: Screenshot 1844 px statt 1440 px, Overflow 404 px
- Tablet: Screenshot 1694 px statt 768 px, Overflow 926 px
- Mobile: Screenshot 1694 px statt 390 px, Overflow 1304 px
- `pendingImages`: 0 in allen Viewports
- Drei Elementor-Pro-Stylesheets antworten mit 404 und erzeugen drei Console-Fehler:
  - `widget-blockquote.min.css`
  - `widget-mega-menu.min.css`
  - `widget-nav-menu.min.css`
- Die DOM-Prüfung fand keine passenden sichtbaren Blockquote-, Mega-Menu- oder Nav-Menu-Widgets. Die Requests sind daher als optional erkannt und im Manifest als nicht-blockierende Request-Probleme markiert.
- Die zugehörigen URL-losen Browser-Console-Fehler bleiben absichtlich blockierend, weil Playwright sie nicht sicher einer konkreten Request-URL zuordnen kann.

Der Diff wird deshalb **nicht** künstlich gescored. Insbesondere wird horizontaler Overflow nicht durch Cropping versteckt.

## Verbindliche Score-Policy

- Ein Capture ohne Diagnose-Manifest ist nicht scorable.
- `pendingImages > 0` ist immer ein Score-Blocker.
- Asset-Timeouts und Scroll-Safety-Caps sind Score-Blocker.
- Echte Breitenabweichungen/Overflow sind Score-Blocker.
- Rohe Console-Fehler sind immer Score-Blocker, solange keine sichere URL-Korrelation vorliegt.
- Nur explizit klassifizierte, optionale Elementor-Pro-Request-Fehler werden als nicht-blockierend markiert; sie bleiben vollständig im Manifest sichtbar.

## Verifikation des finalen lokalen Stands

- TypeScript Workspace-Build: bestanden
- Fokussierte QA-/CLI-Tests: 15 bestanden vor dem letzten Pending-Regressionstest
- Vollständiger serieller Vitest-Lauf: 1.211 bestanden, 2 übersprungen vor dem letzten Pending-Regressionstest
- ESLint der geänderten QA-Quellen: bestanden
- `git diff --check`: bestanden
- Der neue Pending-Regressionstest muss nach diesem Dokumentations-/Testpatch nochmals ausgeführt werden.

## Nächster echter Reparaturschritt

Die Testseite darf erst repariert und per MCP verändert werden, wenn der Capture-Vertrag einen ehrlichen, viewport-identischen Ziel-Render ermöglicht. Der aktuelle technische Blocker liegt im WordPress-Layout/Overflow und in den fehlenden Elementor-Pro-Stylesheet-Dateien, nicht mehr im Screenshot-Capture selbst.

Die WordPress-Testseite wurde in diesem Diagnose-Schritt nicht verändert.

## Finaler Capture- und Reparaturstand (2026-08-01)

Die Testseite wurde anschließend in einem ausdrücklich isolierten Reparaturschritt verändert: drei fehlerhafte Legacy-Component-Widgets wurden durch native V3-Bild-/Text-Strukturen ersetzt und der Elementor-Dokument-Cache wurde geleert. Der finale Read-back bestätigt 525 Elemente, 0 Rohmarker und 0 Platzhalter.

### Kanonischer Desktop-Fold nach der Reparatur

- Viewport: 1440×900, Quelle und Ziel identisch.
- Quelle: `captured`, HTTP 200, 0 Console-/Request-Fehler, kein Overflow.
- Ziel: `not-scored`, HTTP 200, korrekte 1440×900-PNG, kein Overflow.
- Blocker: 3 blockierende Console-/Request-Fehler durch fehlende Elementor-Pro-Stylesheets:
  - `widget-blockquote.min.css`
  - `widget-mega-menu.min.css`
  - `widget-nav-menu.min.css`
- Der Ziel-Capture wird absichtlich nicht bewertet. Der frühere diagnostische Fold-Vergleich von 26,37 % ist kein Release-Score.

### Capture-Vertragsänderung

- Bei `fullPage: false` werden Asset-Wartezeit und `scoredImages` auf sichtbare Bilder im aktuellen Viewport begrenzt.
- Bei `fullPage: true` bleibt die Prüfung aller Bilder streng.
- Nicht eindeutig zuordenbare globale Console-/Request-Fehler bleiben in beiden Modi blockierend. Eine scheinbar passende Fehleranzahl genügt nicht als URL-Korrelation.
- Das kanonische `isScorableCapture()`-Gate verwendet jetzt `scoredImages` mit Fallback auf die globalen Bildzahlen.
- Neue Regressionen decken sichtbare Bildfehler, Below-Fold-Fehler, Full-Page-Strenge, Scroll-Caps und das zentrale Fold-Gate ab.

### Verbleibender nächster Schritt

Zuerst müssen die drei Elementor-Pro-Stylesheet-404s auf dem Zielserver behoben oder über einen belastbaren, URL-spezifischen Klassifizierungsmechanismus als optional nachgewiesen werden. Danach ist der kanonische Lauf für Desktop, Tablet und Mobile erneut auszuführen. Erst bei `captured` für alle Paare darf ein Pixel-/SSIM-Ergebnis als visuelle Abnahme gelten.

Artefakte liegen unter `output/live-recovery-2026-08-01/` und enthalten keine Zugangsdaten.

# Framer → Elementor V3: Gelaf Golf Club

**Quelle:** `https://swift-teacher-216675.framer.app/`
**Ziel:** Elementor V3 auf einer neu angelegten WordPress-Testseite
**Datum:** 2026-08-01
**Status:** Lokale MCP-Konfiguration eingerichtet; Novamira-Verbindung erfolgreich geprüft. Der historische Unframer-MCP-Handschlag war einmal erfolgreich (`initialize`/`tools/list`, 22 Tools), danach schlugen vier frische Versuche mit `401 Invalid session` fehl. Über den aktuellen Proofly-Fallback wurde die Homepage-XML erfolgreich extrahiert; eine vollständige XML-Extraktion aller Seiten ist nicht gelungen. Eine neue WordPress-Draft-Testseite wurde angelegt und der V3-Tree erfolgreich gespeichert; Publish und öffentliche Frontend-Freigabe bleiben gesperrt.

> Dieses Dokument enthält absichtlich keine WordPress-Passwörter, Application Passwords, Unframer-Secrets oder vollständigen credential-bearing URLs.

## 1. Auftrag und Sicherheitsgrenzen

- Framer-Seite als Elementor-V3-Seite konvertieren.
- Für WordPress eine eigene Testseite anlegen; keine bestehende Seite überschreiben.
- V3-only: klassische Elementor-Container und Widgets, keine V4-Atomic-Elemente.
- Vor Mutation: Live-Preflight und, falls möglich, Snapshot des Zielzustands.
- Deployment bevorzugt als Draft/Testseite; kein Produktions- oder ungeprüfter Publish-Schritt.
- Zugangsdaten ausschließlich über lokale Umgebungsvariablen.
- Probleme werden unmittelbar in diesem Dokument ergänzt.

## 2. Read-only-Prüfung der Framer-Quelle

**Ergebnis:** Seite erreichbar und lesbar.

- Seitentitel: `Gelaf - Golf Club Sports Website`
- Hero: `Perfect Your Swing, Elevate Your Game`
- About: `Premium Amenities & Expert Coaching`
- Services: `What We Offer`
  - Golf Training
  - Course & Play
  - Events
- Upcoming Events:
  - Annual Championship
  - Summer Tournament
- Weitere erkannte Bereiche:
  - Facilities
  - Coaches
  - Philosophy
  - Testimonials
  - Blogs / News & Articles
  - FAQ
  - Newsletter Subscription
- Erkannte interne Links: About, Blogs, Pricing, Events, Contact Us
- Erkannte externe Social-Links: Twitter/X, Facebook, Instagram, LinkedIn
- Newsletter-Formular mit E-Mail-Feld und Subscribe-Button vorhanden.
- Read-only-Browserprüfung erfolgreich.
- Keine JavaScript-Konsolenfehler in der verfügbaren alternativen Evaluierung festgestellt.
- Der Versuch, ein separates `list_console_messages`-Browser-Tool zu verwenden, war nicht möglich, weil dieses Tool in der Laufzeit nicht verfügbar ist. Das ist eine Tool-Einschränkung, kein nachgewiesener Seitenfehler.

## 3. Lokale Pipeline-Prüfung

- Workspace-Typecheck: **PASS** (`npx tsc --build --pretty false`)
- Gebautes CLI-Artefakt vorhanden: **PASS** (`packages/cli/dist/cli.js`)
- `node_modules/.bin/elconv`: nicht als ausführbare Verknüpfung vorhanden; das gebaute CLI-Artefakt ist vorhanden.
- V3-Regel geprüft: verschachtelte V3-Trees müssen über den dafür vorgesehenen V3-Push-Pfad laufen; kein V4-`batch-build-page` für den vollständigen V3-Baum.

## 4. Früherer Blocker — behoben

Die erforderlichen Variablen wurden lokal in `.env.local` hinterlegt. Die Datei ist durch `.gitignore` geschützt. Sie werden nicht in Git, Dokumentation oder CLI-Argumente übernommen.

Damit sind Novamira-MCP-Handshake, Ability-Discovery und Live-Preflight möglich. Der frühere Unframer-XML-Pfad bleibt wegen des historischen separaten `401 Invalid session`-Befunds blockiert; der aktuelle Proofly-Fallback liefert die Homepage-XML erfolgreich.

## 5. Historischer Live-Befund: Unframer-Session-Handshake und Tool-Inventar

**Zeitpunkt:** 2026-08-01, wiederholte read-only Versuche.

- Der Request erreicht `mcp.unframer.co`.
- Ein vorheriger frischer Versuch war erfolgreich: `initialize` und `tools/list` antworteten mit HTTP 200; es wurden 22 Tools gemeldet.
- Beim anschließenden erneuten frischen Inventar-Aufruf wurde `initialize` wieder mit HTTP 401 und `Invalid session` abgewiesen; dadurch konnten die Tool-Schemas in diesem Lauf nicht erfasst werden.
- Es wurde kein Projekt-XML geladen und keine Mutation ausgeführt.
- Die vorhandene `UnframerBridge` verwendet JSON-RPC über HTTP und ergänzt `id`/`secret` als Query-Parameter. Der wechselnde Status kann auf einen instabilen oder kurzlebigen Unframer-Session-Tunnel beziehungsweise auf abgelaufene oder widerrufene Session-Credentials hindeuten; er ist kein nachgewiesener Framer-Inhaltsfehler.
- **Sofort dokumentierte Schwachstelle:** Der Endpoint ist nicht zuverlässig reproduzierbar nutzbar: ein erfolgreicher Handshake wird von `401 Invalid session`-Antworten abgelöst. Vor XML-Extraktion muss eine stabile Session bestätigt werden.
- **Sofort dokumentierte Harness-Schwachstelle:** Der erste Windows-Node-Probeprozess endete nach dem 401 zusätzlich mit einer `uv_async`-Assertion (`exit 127`). Das betrifft den lokalen Probeprozess; der HTTP-Status wurde bereits sicher gelesen.
- **Erneute Bestätigung:** Ein zweiter direkter Einzelprozess ohne Child-Process-/Shutdown-Harness erhielt ebenfalls HTTP 401 `Invalid session` und konnte `tools/list` nicht ausführen. Der Fehler ist damit nicht nur auf das erste lokale Harness zurückzuführen.
- **Dritter aktueller Retry:** Auch der erneute direkte Versuch mit derselben URL erhielt HTTP 401 `Invalid session`; `tools/list` wurde erneut nicht erreicht. Nach dem HTTP-Ergebnis trat im Windows-Prozess wieder die bekannte `uv_async`-Assertion auf.
- **Vierter aktueller Retry:** Der erneute Versuch mit derselben URL erhielt wieder HTTP 401 `Invalid session`; `tools/list` wurde nicht erreicht. Auch hier trat nach dem HTTP-Ergebnis die bekannte Windows-`uv_async`-Assertion auf.
- Nächster Prüfpfad: Session im Unframer/Framer-Plugin neu erzeugen bzw. verbinden und die neue Connection URL lokal ersetzen; erst bei stabilem Erfolg `tools/list` und Read-only-Tools aufrufen.

## 6. Lokale MCP-Konfiguration

Eine lokale `.mcp.json` enthält den Framer-HTTP-Server mit dem vom Nutzer gelieferten Unframer-Endpoint.

Novamira ist separat und ohne Credential-Duplikation lokal konfiguriert: Die Zugangsdaten liegen in `.env.local`; der Server wird mit dem Namen `novamira-hcm-local` und exakt `[-y, @automattic/mcp-wordpress-remote@latest]` gestartet.

`.mcp.json` und `.env.local` sind durch `.gitignore` geschützt. `git check-ignore -v` bestätigt beide Dateien als ignoriert.

## 7. Benötigte lokale Vorbereitung

Die Werte müssen lokal gesetzt werden, ohne sie in den Chat, in CLI-Argumente, Dokumente oder Git zu schreiben. Die WordPress-Verbindung verwendet die vorgegebene Konfiguration:

```text
WP_API_URL=https://<ziel>/wp-json/mcp/novamira
WP_API_USERNAME=<username>
WP_API_PASSWORD=<application-password>
```

Für die Unframer-Verbindung werden die drei Werte getrennt gesetzt:

```text
UNFRAMER_MCP_URL=https://mcp.unframer.co/mcp
UNFRAMER_MCP_ID=<id>
UNFRAMER_MCP_SECRET=<secret>
```

Die vom Auftrag vorgegebene Remote-MCP-Konfiguration muss dabei erhalten bleiben:

```text
args: ["-y", "@automattic/mcp-wordpress-remote@latest"]
server name: novamira-hcm-local
transport: @automattic/mcp-wordpress-remote via npx
```

## 8. Live-Befund: WordPress-Remote-MCP-Transport

**Zeitpunkt:** 2026-08-01, erster Transporttest.

- Der exakt vorgegebene Start `npx -y @automattic/mcp-wordpress-remote@latest` startet mit den lokalen Env-Variablen und bleibt erwartungsgemäß als stdio-MCP-Server wartend aktiv.
- Es wurden danach read-only WordPress-Tools für Discovery und Preflight aufgerufen; mutierende WordPress-Tools wurden nicht aufgerufen.
- Ein temporärer Node-Probeversuch konnte unter Windows `npx` nicht als Prozess finden (`spawn npx ENOENT`), obwohl der gleiche Start aus Bash funktioniert. Das ist ein lokales Test-Harness-/PATH-Problem.
- Der Windows-Node-Probeversuch war ein lokales Harness-Problem; der direkte Bash-Test ist maßgeblich und war erfolgreich.

## 9. Live-Befund: WordPress-MCP-Handshake erfolgreich

**Zeitpunkt:** 2026-08-01, stdio-Test mit dem exakt vorgegebenen Transport.

- `npx -y @automattic/mcp-wordpress-remote@latest` startet mit den Env-Variablen.
- `initialize` erfolgreich.
- `notifications/initialized` akzeptiert.
- `tools/list` erfolgreich.
- Server meldet `Novamira v1.0.0`.
- Adapter-Tools verfügbar: `mcp-adapter-discover-abilities`, `mcp-adapter-get-ability-info`, `mcp-adapter-execute-ability`.
- Read-only `tools/call` für Discovery und Schema-Abfragen wurden erfolgreich ausgeführt.
- Mutierende WordPress-Tools wurden nicht aufgerufen.

## 10. Live-Befund: Discovery-Probe-Harness

- Der erste automatisierte Discovery-Subprozess lief in einen 30-Sekunden-Timeout, bevor eine Antwort gelesen werden konnte.
- Der direkte Bash-stdio-Test für denselben Server hatte zuvor erfolgreich `initialize` und `tools/list` erhalten.
- Der Befund wird deshalb als lokales Stdio-/Buffering-Problem des Probe-Harnesses klassifiziert, nicht als bestätigter WordPress- oder Credential-Fehler.
- Discovery wurde anschließend über die funktionierende direkte Bash-Pipeline erfolgreich wiederholt.

## 11. Live-Befund: WordPress-/Elementor-Preflight erfolgreich

**Zeitpunkt:** 2026-08-01, read-only über den vorgegebenen stdio-MCP-Transport.

- MCP-Handshake und Ability-Discovery erfolgreich.
- 234 Live-Abilities entdeckt.
- Alle für diesen Lauf abgefragten Fähigkeiten sind live und besitzen Schemas.
- Elementor: aktiv, Version `4.2.1`.
- Elementor Pro: aktiv, Version `4.1.0`.
- WordPress: `7.0.2`.
- PHP: `8.2.23`.
- Atomic-Runtime, Style-Schema, Global Classes, Variables und Interactions: verfügbar.
- `novamira/elementor-check-setup`: erfolgreich, `issues: []`.
- Read-only PHP-Runtime-Probe: erfolgreich.
- Bis zum Preflight wurde keine WordPress-Seite angelegt und kein Content verändert; die spätere Mutation erfolgte ausschließlich auf der neu angelegten Draft-Testseite `644`.

## 12. Sicherheitsproblem: Credentials im Chat

Die im Auftrag enthaltenen WordPress- und Unframer-Zugangsdaten wurden nicht in dieses Dokument, in Logs oder in Git übernommen. Da sie jedoch im Chatverlauf sichtbar sind, sollten beide Credentials nach Abschluss bzw. vor einem produktiven Einsatz rotiert werden:

1. WordPress Application Password widerrufen und neu erstellen.
2. Unframer-Secret widerrufen bzw. neuen Endpoint erzeugen.
3. Danach nur noch lokale Umgebungsvariablen verwenden.

## 13. Historischer Fallback: öffentliche Framer-HTML-Extraktion

Dieser Abschnitt beschreibt den früheren Fallback vor der Proofly-Verbindung. Da der damalige Unframer-MCP-Handschlag mit `401 Invalid session` blockiert war, wurde die öffentlich erreichbare, gerenderte Framer-Seite als ausdrücklich gekennzeichneter Fallback verwendet. Für den aktuellen Lauf ist Proofly die primäre read-only Quelle.

- Quelle bleibt read-only.
- HTML und Screenshots werden nur unter `runs/gelaf-2026-08-01/` gespeichert; `runs/` ist gitignored.
- Einschränkung: Der Fallback liefert die gerenderte DOM-Struktur, aber nicht zwingend die vollständigen Unframer-XML-Komponenten, Framer-Style-Referenzen oder Editor-Metadaten.
- Die Konvertierung wird deshalb als `public-render-fallback` protokolliert und nicht als vollständige Unframer-Fidelity ausgegeben.
- WordPress-Mutation bleibt bis zu einem erfolgreichen lokalen V3-Guard-/Tree-Check gesperrt.

## 14. Proofly-MCP-Befund (2026-08-01)

Der alternative Proofly-MCP-Endpoint ist technisch stabiler als der frühere Unframer-Endpoint:

- `initialize`: HTTP 200.
- `tools/list`: HTTP 200; 137 Tools verfügbar.
- Mit dem zusätzlichen Proofly-Token wurden read-only Metadata-Aufrufe erfolgreich ausgeführt.
- `getAllPages`: HTTP 200; 10 Routen gefunden (`/`, `/about`, `/blogs`, dynamische Blog-/Slug-Routen, `/events`, `/pricing`, `/contact`, `/404`).
- `getProjectFonts`: HTTP 200; Satoshi und Inter, 15 Font-Varianten.
- `getProjectColorStyles`: HTTP 200; 18 Farbstile.
- `getProjectTextStyles`: HTTP 200; 13 Textstile.
- `getProoflyState`: HTTP 200; kein Custom Code und keine installierten Plugins gemeldet.
- `getProjectXml`: HTTP 200; 14.728 Bytes Projektbeschreibung mit Seiten-, Komponenten- und Style-Verzeichnis.
- `getNodeXml` Homepage `/`: HTTP 200; ca. 363 KB echte Layer-Struktur.
- **Sofort dokumentierte API-Schwachstelle:** `getNodeXml` antwortete für die neun übrigen Seiten zwar mit HTTP 200, lieferte aber nur 71–89 Bytes große leere `<WebPageNode>`-Wrapper ohne Layer. HTTP 200 ist hier daher kein semantischer Erfolgsindikator.
- Die Homepage-XML enthält echte Sections, Komponenten, Bilder, Layout-Attribute und responsive Textstil-Breakpoints. Sie enthält jedoch nicht für jeden sichtbaren Text einen direkt nutzbaren `text`-Attributwert; Komponenten-Controls und Textstile müssen ergänzend ausgewertet werden.
- **Scope-Entscheidung:** Bis die Proofly-Seitenabfrage für Unterseiten korrigiert oder durch HTML-/Node-Abfragen ergänzt ist, wird nur die Homepage als belastbarer V3-Konvertierungs-Scope behandelt. Unterseiten werden nicht als erfolgreich extrahiert ausgegeben.
- `getNodeHTML` Homepage: HTTP 200; verwertbares HTML-/Metadatenobjekt.
- `getNodeCSS` Homepage: HTTP 200; CSS-/Style-Objekt.
- **Korrigierter lokaler Pipeline-Befund:** Ein erster V3-Auswertungsversuch meldete `TypeError: Cannot read properties of undefined (reading 'length')`. Die Ursache war das Test-Harness, das die Array-Rückgabe von `framerXmlToV3()` fälschlich als `ConversionResult` mit `stats`/`warnings` behandelte. Die isolierte Prüfung bestätigte anschließend: `framerXmlToV3()` läuft erfolgreich; der Guard-Lauf ist technisch ausführbar.
- **Reparierter V3-Qualitätsbefund:** Die Homepage-Konvertierung erzeugt weiterhin 474 Elemente (1 Section, 1 Column, 237 Container, 235 Widgets), jetzt 73 Spacer-, 81 Text-Editor-, 63 Bild- und 18 Button-Widgets. Der Tree erreicht **95/100** bei einer Schwelle von 85 und besteht damit das lokale Guard-Gate.
- Die Reparatur beseitigt die 71 doppelten Tree-IDs, doppelte CSS-IDs und 237 fehlende `isInner`-Flags. Die 63 echten Proofly-Bildquellen mit URL werden als Bild-Widgets übernommen. Übrig bleiben 9 Bildwarnungen für strukturelle `Images`-/`Image`-Wrapper ohne eigenes Asset; es werden dafür keine URLs erfunden.
- Typ-Isolation, V4-Kontamination, HTML-Regeln, Widget-Pflichtsettings, Breakpoint-Abdeckung, Tree-Größe und Flex-Row-Risiken bestehen. Der erste Injection-Versuch wurde zwar akzeptiert, speicherte wegen eines serialisierten `_elementor_data`-Payloads aber 0 Elemente; dieser Fehler wurde lokal behoben und getestet. Der korrigierte Array-Payload speichert nun alle 474 Elemente in Draft `644`.
- `getNodeDetails` Homepage: HTTP 200; 10 direkte Kinder gemeldet.
- `getPageLiveUrl` und `getBreakpointInfo` Homepage: jeweils HTTP 200.
- **Sofort dokumentierte Qualitätsgrenze:** Der XML-Export enthält viele Komponenteninstanzen und Style-Control-Daten; nicht jeder sichtbare Text ist als direktes `text`-Attribut enthalten. Für eine pixelnahe V3-Konvertierung müssen Controls/Komponenten und gegebenenfalls HTML ergänzend interpretiert werden.

## 15. Live-Deployment und Server-Verifikation

- Neue Draft-Testseite angelegt: **Post 644**, Titel `Gelaf V3 Proofly Test 2026-08-01`.
- Zielstatus: **Draft**; kein Publish und keine bestehende Seite überschrieben.
- Korrigierter V3-Deploy über `novamira-adrianv2/elementor-inject-calibrated-page` erfolgreich.
- Pre-Push-Normalisierung: 474 Nodes verarbeitet; keine zusätzlichen `isInner`- oder Flex-Width-Korrekturen nötig.
- Read-back über `novamira/elementor-get-content`: `content` ist ein Array mit **1 Top-Level-Section** und `element_count: 474`; Template `wp-page`.
- Erste Ursache des Fehlers: `_elementor_data` wurde in `wp-push.ts` als JSON-String statt als Array übergeben. Der Server akzeptierte den Call, speicherte aber 0 Elementor-Elemente. Beide V3-Wrapper verwenden nun den direkten Array-Payload; Regressionstest und 83 fokussierte Tests sind grün.
- Server-Audits nach dem korrigierten Deploy:
  - `page-audit`: technisch erfolgreich.
  - `responsive-audit`: technisch erfolgreich.
  - `visual-qa`: technisch erfolgreich, **0 Issues**.
  - `layout-audit`: **291 Befunde** — 234 Fehler durch Deep-Nesting, 9 Warnungen und 48 Grid-Kandidaten; 237 Container, maximale Tiefe 12.
  - Accessibility-Audit: **67/100**.
  - SEO-Audit: **63/100**.
- Öffentliche Draft-URL liefert im Browser **404 „Seite nicht gefunden“**. Das ist bei einem nicht veröffentlichten Draft erwartbar und verhindert eine öffentliche Frontend-/Pixel-QA. Es wurde kein Publish durchgeführt.
- Sanitized deployment evidence: `runs/proofly-2026-08-01/v3/deploy-verification-after-array-fix.json`.

### Zusätzliche Read-only-Matrix

Folgende 14 Tools wurden auf der Homepage read-only getestet; alle antworteten technisch mit HTTP 200:

- `getSelectedNodesXml`: nur 13 Bytes; semantisch kein verwertbarer Auswahl-Export.
- `getNodeXml`: 363.002 Bytes echte Homepage-Struktur.
- `getNodeHTML`: HTML-/Metadatenobjekt vorhanden.
- `getNodeCSS`: CSS-/Style-Objekt vorhanden.
- `getNodeDetails`: 10 direkte Kinder gemeldet.
- `getNodeRect`: `null` trotz HTTP 200; semantische API-Schwachstelle, daher nicht als Geometrieerfolg gewertet.
- `getBreakpointInfo`: Objekt mit Breakpoint-Metadaten vorhanden.
- `getRichTextStyles`: Antwort vorhanden, kleine Payload.
- `findNodesByName`: 18 Button-Matches gefunden.
- `findComponentInstances` und `getComponentInstances`: jeweils 0 Instanzen für die geprüfte Komponentensuche; dies ist ein Suchbefund, kein Beweis, dass die XML-Komponenten nicht verwendet werden.
- `getPageRichTextAudit`: 63 Textknoten geprüft.
- `findRichTextInconsistencies`: 0 Inkonsistenzen.
- `auditPageAccessibility`: 23 Accessibility-Befunde.

**Sofort dokumentierte Grenzen:** HTTP 200 bedeutet bei Proofly nicht automatisch verwertbare Daten. Leere/`null`-Payloads müssen zusätzlich semantisch geprüft werden. Der Accessibility-Audit ist noch nicht in den Tree-/Deploy-Gates behoben; WordPress-Mutation bleibt gesperrt.

## 16. Aktueller Befund: Unframer erneut nicht verbunden

**Zeitpunkt:** 2026-08-01, nach dem Parser-Fix.

- JSON-RPC `initialize` und `tools/list` waren mit der angegebenen Connection URL erfolgreich; der Server meldete 22 Tools.
- Der korrekte Toolname ist `getProjectXml` ohne `unframer/`-Präfix.
- `getProjectXml` antwortete anschließend technisch mit einer Fehler-Textantwort: `Framer plugin not connected for user ...`.
- Es wurde kein gültiges XML extrahiert; die gespeicherte Recovery-Datei enthält nur diese Fehlerantwort und wird nicht als Quelle verwendet.
- **Sofort dokumentierte Schwachstelle:** Ein erfolgreicher MCP-Handschlag bzw. eine Tool-Liste garantiert keine aktive Framer-Plugin-Verbindung. Vor jedem Build muss zusätzlich ein semantischer Erfolgscheck des XML-Payloads erfolgen.
- Der Live-Deploy des Parser-Fixes ist deshalb noch blockiert, solange weder eine aktive Unframer-Session noch ein gültiges Proofly-/XML-Artefakt verfügbar ist.

## 17. Noch ausstehend

1. Proofly-Unterseiten über ergänzende HTML-/Node-Abfragen vollständig erfassen; leere Wrapper trotz HTTP 200 weiter klären.
2. Optional verbleibende 9 strukturelle Bild-Wrapper-Warnungen weiter reduzieren; echte Asset-URLs werden bereits korrekt übernommen.
3. Layout-Nesting reduzieren: 234 Deep-Nesting-Fehler und 48 Grid-Kandidaten vor einer produktiven Freigabe bearbeiten.
4. Accessibility (67/100) und SEO (63/100) verbessern.
5. Für echte öffentliche Frontend-/Pixel-QA entweder den Draft authentifiziert im WordPress-Kontext prüfen oder nach ausdrücklicher Freigabe temporär veröffentlichen; Standard bleibt **nicht veröffentlichen**.
6. Jede Abweichung oder fehlende Ability sofort in diesem Dokument ergänzen.
7. Nach dem Test die im Chat verwendeten Credentials rotieren.

## 18. Offene Entscheidungen / Freigaben

- [x] Lokale Umgebungsvariablen setzen.
- [x] `hcm.local` als Testziel read-only erreicht und Preflight bestanden.
- [x] Neue Seite als Draft angelegt: Post 644.
- [x] Gewünschter Testtitel verwendet: `Gelaf V3 Proofly Test 2026-08-01`.
- [x] Newsletter-Form nur visuell übernommen; kein Versand und keine externe Integration.
- [ ] Für öffentliche Frontend-/Pixel-QA ausdrücklich Publish oder authentifizierte Draft-Vorschau freigeben.
- [ ] Nach dem Test Credentials rotieren.

## 19. Laufstatus

| Schritt | Status | Notiz |
|---|---|---|
| Framer URL erreichbar | PASS | Read-only Browserprüfung |
| Framer-Struktur inventarisiert | PARTIAL | Proofly: Homepage vollständig; neun Unterseiten semantisch leer trotz HTTP 200 |
| Lokaler Typecheck | PASS | Workspace-Build grün |
| Lokale MCP-Konfiguration | PASS | `.mcp.json` und `.env.local` sind gitignored; JSON gültig |
| Proofly Tool-Inventar/XML | PARTIAL | 137 Tools; Homepage-XML/HTML/CSS erfolgreich, neun Unterseiten nur leere Wrapper trotz HTTP 200 |
| Novamira Ability-Discovery | PASS | 234 Abilities; relevante Schemas vorhanden |
| Live-Preflight | PASS | Elementor/Pro, PHP/WP und Atomic-Setup read-only verifiziert |
| Neue WP-Testseite | PASS | Neue Draft-Seite Post 644 angelegt; keine bestehende Seite überschrieben |
| V3-Deployment | PASS | Direkter Array-Payload; Read-back 1 Section / 474 Elemente |
| Cache/Permalink-Prüfung | PARTIAL | Elementor-Read-back erfolgreich; öffentliche Draft-URL liefert 404 |
| Visuelle QA mit Referenz | GESPERRT | Öffentliche Draft-URL nicht erreichbar; `visual-qa` serverseitig 0 Issues |
| Server-QA-Abilities | PARTIAL | Page/Responsive/Visual technisch erreichbar; Layout 291 Befunde, A11y 67, SEO 63 |

## 20. Finaler Reparatur- und Visual-Diff-Status (2026-08-01)

### 20.1 Live-Reparatur Post 644

- Der defekte Legacy-Component-Block wurde auf Post 644 gezielt repariert.
- Betroffen waren **drei** `text-editor`-Widgets mit Framer-Underscore-Komponenten; nicht nur das zuerst sichtbare Widget.
- Der neue Array-Payload wurde ausschließlich auf die isolierte Testseite `644` geschrieben.
- Der kanonische Dokument-Cache-Clear wurde erfolgreich ausgeführt; der Live-Server akzeptierte dafür die Form `{ post_ids: [644] }`.
- Finaler Read-back: **525 Elemente**, **81 Bild-Widgets**, **96 Text-Editor-Widgets**, **0 Roh-XML-Marker**, **0 Platzhalter**.
- Die drei alten Legacy-IDs sind im finalen Read-back nicht mehr vorhanden.
- Browserprüfung nach der Reparatur: HTTP 200, erwartete Hero-/Section-Marker, **kein horizontaler Overflow**.
- Kein Publish-Schritt und keine andere Seite wurden verändert.

### 20.2 Kanonischer Desktop-Fold-Diff

- Quelle und Ziel wurden mit identischem Viewport **1440×900** aufgenommen.
- Die Framer-Quelle ist technisch `captured` und scorable.
- Der Ziel-Capture wird korrekt als **NOT SCORED** abgelehnt, nicht mit einem künstlichen Pixelwert versehen.
- Grund: drei blockierende Console-/Request-Fehler durch fehlende Elementor-Pro-Stylesheets (`widget-blockquote.min.css`, `widget-mega-menu.min.css`, `widget-nav-menu.min.css`).
- Beide Screenshots hatten die erwartete Breite und keinen horizontalen Overflow; der Capture-Blocker liegt daher jetzt in der Ziel-Asset-/CSS-Infrastruktur.
- Der alte diagnostische Fold-Vergleich lag bei **26,37 % Match**. Dieser Wert bleibt ein historischer Diagnosewert, kein bestandenes QA-Gate.

### 20.3 Capture-/QA-Verbesserung

- Fold-Captures warten und gate’n nun nur sichtbare Bilder; Full-Page-Captures bleiben für alle Bilder streng.
- `scoredImages` ist im Capture-Manifest und im kanonischen `isScorableCapture()`-Gate verdrahtet.
- Global nicht eindeutig zuordenbare Console-/Request-Fehler bleiben absichtlich blockierend. Dadurch wird kein falscher grüner Fold-Score erzeugt.
- Regressionen decken Scroll-Caps, sichtbare/unsichtbare Bildfehler, Full-Page-Strenge und die kanonische `scoredImages`-Semantik ab.

### 20.4 Verbleibende Blocker

1. Die drei fehlenden Elementor-Pro-Stylesheets auf dem Ziel müssen serverseitig repariert oder sicher als nicht benötigte optionale Assets klassifiziert werden.
2. Danach muss der kanonische Desktop-/Tablet-/Mobile-Lauf erneut ausgeführt werden.
3. Erst wenn alle Capture-Manifeste scorable sind, darf der Pixel-/SSIM-Score zur visuellen Abnahme verwendet werden.
4. Die strukturelle Layoutabweichung bleibt trotz des Legacy-Fixes bestehen: Der nächste Converter-Schritt ist die Neuemission aus Visual IR statt die weitere Reparatur einzelner Roh-XML-Widgets.

Artefakte (gitignored): `output/live-recovery-2026-08-01/`, einschließlich finalem Read-back, Cache-Clear-Nachweis, repariertem Kandidaten und kanonischem Diff-Manifest.

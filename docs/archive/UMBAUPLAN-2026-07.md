# Umbauplan — Juli 2026

**Anlass:** manueller E2E-Test (Tirizz-HVAC-Demo → Elementor V3, test4) über mehrere Chat-Runden.
Kein synthetischer Test — echte Fehler, echte Kosten (Stunden Debugging für Dinge, die die
Pipeline künftig automatisch abfangen sollte). Dieses Dokument bündelt, was dabei über die
Pipeline selbst gelernt wurde, getrennt von den WordPress-Testartefakten.

**Betrifft:** `site-clone-to-v3` (primär), `Framer-to-Elementor-V4-Pipeline` (Querverweis),
`WordPress_mcp_adrian` (ein Bugfix, separat schon gemerged — siehe PR
`fix/upload-asset-missing-image-includes`).

---

## 1. Was in dieser Session bereits umgesetzt wurde

- `site-clone-to-v3`: neuer `IssueType: 'missing-texture'` in `src/qa/issue-detector.ts` —
  erkennt "Original hat Fototextur, Klon ist flache Farbe" (Branch
  `fix/qa-missing-texture-detection`, 1279/1279 Tests grün).
- `WordPress_mcp_adrian`: `require_sideload_includes()` lud `image.php` nie, weil zwei
  Guard-Checks für drei Dateien wiederverwendet wurden — jede Datei hat jetzt ihren eigenen
  Guard (Branch `fix/upload-asset-missing-image-includes`, 60/60 Tests grün).
- `site-clone-to-v3` + `Framer-to-Elementor-V4-Pipeline`: `TROUBLESHOOTING.md` um die unten
  detaillierten V3/V4-Settings-Gotchas ergänzt.

## 2. Lessons Learned aus dem manuellen Rebuild

### 2.1 Elementor-Settings-Gotchas (Details in `TROUBLESHOOTING.md` beider Repos)

Drei Fälle, in denen ein Wert **ohne Validierungsfehler** geschrieben wurde, aber am
Rendering nichts änderte:

1. **Companion-Switcher-Pattern:** `_element_custom_width` wirkt nur mit
   `_element_width:"initial"` daneben (`"if"`-Bedingung im Schema). Ohne den Schalter: Wert
   landet in `_elementor_data`, aber keine einzige CSS-Zeile wird erzeugt. Das kostete in
   diesem Test ein 189px statt ~50px hohes Logo, was wiederum den ganzen Header 90px zu groß
   machte.
2. **`min-height` in `vh`:** verhielt sich nicht wie eine einfache Untergrenze — Inhalt, der
   rechnerisch weit darunter lag, produzierte trotzdem eine ~40% größere Box als erwartet.
   Ursache nicht vollständig isoliert (kein Computed-Style-Zugriff von der Generator-Seite
   aus), aber ein expliziter Pixelwert verhielt sich sauber linear (1:1 zur Gesamthöhe).
3. **Negative Margin schrumpft die eigene Box nicht:** verschiebt nur, wo das nächste
   Geschwisterelement im Fluss beginnt. Für "wie hoch ist Element X" ist das die falsche
   Messgröße.

**Gemeinsamer Nenner:** alle drei sind mit einem Blick auf die generierte CSS oder einer
`getBoundingClientRect()`-Messung sofort erkennbar gewesen — aber unsichtbar, wenn man nur
prüft, ob der Schreibvorgang fehlerfrei durchlief. Ein fehlerfreier Write ist kein Beweis,
dass die Einstellung wirkt.

### 2.2 Diff-Methodik: warum ein Score allein nicht reicht

- Ein reiner Ähnlichkeits-Score (egal ob grobes Farbraster oder pixelmatch) bewegt sich kaum,
  wenn ein Fix zwar inhaltlich korrekt ist, aber der Ton/die Fläche ähnlich bleibt — ein
  Platzhalter-Grauton statt eines echten Fotos ergab in diesem Test praktisch denselben Score
  wie das echte Foto danach. Der Score allein hätte diese Verbesserung nicht sichtbar
  gemacht, geschweige denn ihr Fehlen erkannt.
- Ein zu großes Logo/zu großer Header wurde vom groben Farb-Raster-Diff **nicht** als
  Größenproblem erkannt, obwohl die Rohdaten (helle vs. dunkle Fläche pro Zeile) den Hinweis
  bereits enthielten — die Interpretation ("zu wenig Hero-Dunkelheit blitzt durch" statt "der
  Header ist strukturell zu groß") war falsch. Erst ein direkter
  `getBoundingClientRect()`-Vergleich (Original: Logo 177×49px, Header 145px hoch; eigener
  Rebuild: Logo 189px hoch, Header 222px) hat das zweifelsfrei bestätigt.
- **Lektion:** Pixel-/Farbstatistik ist gut für "stimmt der Ton grob", aber strukturell blind.
  Für Fragen der Form "ist Element X richtig dimensioniert" braucht es eine strukturelle
  Messung, keine statistische Annäherung.

### 2.3 Tooling-Zuverlässigkeit

- Große Binärdaten (Screenshots als Base64) manuell durch eigene Textgenerierung zu einem
  neuen Tool-Call zu transportieren, ist nicht zuverlässig — zweimal in dieser Session
  festgestellt (Byte-Anzahl fast identisch, MD5 trotzdem verschieden). Checksummen-Vergleich
  hat das zuverlässig aufgedeckt, sollte aber gar nicht erst nötig sein: Bild-Daten sollten
  nie durch ein Sprachmodell "hindurch" transportiert werden, wenn ein direkter Weg existiert.

---

## 3. Firecrawl — wo es tatsächlich hilft (und wo nicht)

**Wichtiger Fund beim Recherchieren, bevor hier vorschnell "Firecrawl einbauen" empfohlen
wird:** `site-clone-to-v3` hat bereits `src/extractor/browserbase-extractor.ts` — explizit als
Drop-in-Replacement für `playwright-extractor.ts` gebaut, *für exakt das Netzwerk-Problem*,
das in dieser Session den ganzen manuellen Umweg über `execute-php` nötig gemacht hat
("Claude Web sandbox egress block", laut Kommentar im Code). Und `computed-styles.ts` macht
bereits einen kuratierten ~80-Properties-Walk über Playwright — mehr, als das, was ich über
Firecrawls `executeJavascript`-Action manuell nachgebaut habe.

**Firecrawl ist also kein Ersatz für Browserbase/Playwright in der echten Pipeline** — die
sind für die eigentliche Extraktion umfassender und bereits ins System integriert (Fonts,
Custom Properties, Keyframes, responsive Matrix, etc. — das kann Firecrawl nicht).

**Wo Firecrawl trotzdem echten Wert hat:**

1. **Als Verifikations-Werkzeug für Claude-Chat-Sessions selbst** (wie in dieser Session) —
   kein API-Key/Account-Setup nötig, sofort verfügbar, gut genug für Stichproben-Messungen
   (`getBoundingClientRect`, Screenshots), wenn kein Zugriff auf die eigentliche Pipeline
   besteht. Kein Pipeline-Code-Änderung nötig, einfach die richtige Wahl für diesen Kontext.
2. **Eine echte Lücke gefunden, unabhängig von Firecrawl:** `src/qa/visual-capture.ts` (nimmt
   den Screenshot der **fertig gebauten Seite** für den Diff) hat **keinen**
   Browserbase-Fallback — nur `playwright-extractor.ts` (Quellseiten-Extraktion) hat ihn. Bei
   genau dem Netzwerk-Problem, das diese ganze Session ausgelöst hat, würde die
   Extraktions-Seite über Browserbase funktionieren, die Verifikations-Seite (Screenshot der
   eigenen gebauten Seite) aber genauso blockiert bleiben wie hier. Siehe Phase 1 unten.
3. **Denkbar als dritte, leichtgewichtige Fallback-Stufe** (Playwright → Browserbase →
   Firecrawl) für den Fall, dass auch kein `BROWSERBASE_API_KEY` konfiguriert ist — geringerer
   Funktionsumfang, aber kein zusätzliches Konto/Setup nötig. Niedrige Priorität, siehe
   Phase 3.

**Für `Framer-to-Elementor-V4-Pipeline`:** dieselbe Einschätzung dürfte gelten (nicht im
Detail geprüft in dieser Session) — vermutlich dieselbe Playwright-basierte Extraktion, also
dieselbe Empfehlung: Firecrawl nicht als Ersatz, sondern höchstens als dritte Fallback-Stufe
bzw. Chat-Debugging-Werkzeug.

---

## 4. Visual-Diff-Tool: konkrete Verbesserungen

### 4.1 Bereits umgesetzt

`missing-texture`-Erkennung (siehe Abschnitt 1) — Streuung (StdDev der Luminanz) pro Region,
zusätzlich zum bisherigen Farbmittelwert-Vergleich. Erkennt "Original hat Textur, Klon ist
flach", unabhängig vom Farbton.

### 4.2 Vorgeschlagen: `visual-capture.ts` bekommt denselben Browserbase-Fallback

Direkte Konsequenz aus Abschnitt 3, Punkt 2. Kleinstmögliche, chirurgische Änderung: densel­ben
Fallback-Mechanismus aus `browserbase-extractor.ts` in `visual-capture.ts` spiegeln (gleiches
Muster, andere Aufrufstelle). Ohne das bleibt die QA-Verifikation anfällig für genau das
Netzwerkproblem, das die Extraktion schon abgefangen hat.

### 4.3 Vorgeschlagen: strukturelle Cross-Validation erweitern (nicht nur Farben/Fonts)

`src/qa/cross-validator.ts` prüft bereits Drift zwischen extrahierten Design-Tokens und dem
gebauten Baum (`checkColorDrift`, `checkFontDrift`, `checkImageMediaIds`,
`checkBreakpointVariants`, `checkGvIdDrift`). Fehlt: ein Check für **Dimensionen** — Breite/
Höhe eines gebauten Elements vs. was tatsächlich extrahiert wurde. Das hätte den
Logo-Größenfehler in dieser Session sofort und deterministisch gefunden, ganz ohne
Pixelvergleich: "Extractor sagt Logo ist 177px breit, gebauter Baum setzt keine Breite → Flag."
Genau dieselbe Stelle, dasselbe Muster wie die bestehenden Checks — kein neues Konzept, nur
ein zusätzliches Feld.

### 4.4 Vorgeschlagen: Companion-Control-Validierung im Builder selbst

`src/builder/` setzt aktuell nirgends `_element_custom_width` o.ä. (geprüft, kein Treffer) —
der exakte Bug aus dieser Session existiert im Code (noch) nicht. Sobald der Builder aber
irgendeine bedingte Style-Kontrolle setzt (Custom Width, Custom Height, o.ä.), sollte er
automatisch prüfen, ob alle im Schema referenzierten `"if"`-Bedingungen mit erfüllt sind, statt
das der aufrufenden Stelle zu überlassen — ein Lint-artiger Check direkt beim Bauen, nicht erst
beim Diffen.

---

## 5. Phasenplan (priorisiert)

| Phase | Was | Warum zuerst/später |
|---|---|---|
| **1** | `visual-capture.ts`: Browserbase-Fallback nach Vorbild `browserbase-extractor.ts` | Schließt die asymmetrische Lücke, die diese ganze Session ausgelöst hat. Kleinste, klarste Änderung mit größtem direktem Nutzen. |
| **2** | `cross-validator.ts`: Dimensions-Check (Breite/Höhe extrahiert vs. gebaut) | Gleiches Muster wie bestehende Checks, hätte den Logo-Bug deterministisch gefangen. |
| **3** | Builder-seitige Companion-Control-Validierung | Verhindert die Fehlerklasse an der Quelle, nicht erst beim Prüfen. |
| **4** | Firecrawl als dritte Fallback-Stufe (nur falls Browserbase-Key fehlt) | Nice-to-have, kein Blocker — Playwright→Browserbase deckt den Regelfall bereits ab. |

---

## 6. Offene Fragen für den nächsten Chat

- Sollen die drei Phasen alle in `site-clone-to-v3` umgesetzt werden, oder Priorität setzen?
- Existiert für `Framer-to-Elementor-V4-Pipeline` ein Äquivalent zu `visual-capture.ts` mit
  derselben Lücke? (In dieser Session nicht geprüft, nur die Extraktionsseite.)
- Reicht der aktuelle GD-basierte `missing-texture`-Check (PHP-Prototyp, `execute-php`
  ad-hoc gebaut) als Vorlage, oder soll die TS-Version in `issue-detector.ts` weiter verfeinert
  werden (z. B. Region-Auflösung, Bounding-Box-gebundene statt blinder Raster-Checks)?

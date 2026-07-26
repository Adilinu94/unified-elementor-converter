# E2E-Test Fehlerprotokoll — Framer → Elementor V4 Pipeline

**Datum:** 15. Juni 2026
**Framer-Seite:** https://hilarious-workshops-284047.framer.app/
**Ziel:** test4.nick-webdesign.de (Post ID 1950)
**Ergebnis:** ❌ Massive qualitative Abweichungen

---

## Soll-Ist-Vergleich (Framer Original vs. V4-Ergebnis)

| Eigenschaft | Framer Original | V4-Ergebnis | Lücke |
|---|---|---|---|
| **Hintergrund** | `rgb(6, 29, 19)` (Dunkelgrün) | Weiß/Transparent | ❌ Kein Hintergrund |
| **Heading Font** | `Inter Display`, 68px, 600, #FFFFFF | `Inter`, 32px, 600, #111111 | ❌ Falsche Größe, Farbe, Schnitt |
| **Body Font** | `Inter`, 20px, 500, rgb(194,194,194) | `Inter`, 32px, 600, #111111 | ❌ Gleicher Fallback wie Heading |
| **Button BG** | `rgb(223, 255, 163)` (Limettengrün) | Kein Button-Styling | ❌ Nur Text + Link |
| **Button Radius** | 42px | Keiner | ❌ |
| **Button Padding** | 12px 16px | Keines | ❌ |
| **Feature-Badges** | Icon + Text in Zeile | Nur Text als `e-heading` | ❌ Kein Icon, kein Layout |
| **Avatare** | 3 Kreis-Bilder (40×40px) | Bilder vorhanden | ✅ Teils ok |
| **Layout-Struktur** | Korrekt | Größtenteils korrekt | ✅ Struktur passt |

---

## Die 8 systematischen Lücken — Warum das Ergebnis so schlecht war

### LÜCKE 1 (KRITISCH): Unframer MCP liefert Style-REFERENZEN, keine CSS-Werte

```
Framer XML enthält:
  inlineTextStyle="/Heading/Heading 1"
  backgroundColor="/Theme Color/Very Dark Green"

Die tatsächlichen CSS-Werte sind NUR im <style>-Block der publizierten Seite:
  .heading-1 { font-family: 'Inter Display'; font-size: 68px; font-weight: 600; color: #FFFFFF; }
  .theme-color-very-dark-green { background-color: rgb(6, 29, 19); }
```

**Der Converter kann Styles nicht auflösen, weil die XML-Daten keine CSS-Werte enthalten.**

**Lösung:** Der Pipeline fehlt ein Schritt, der die Framer-Seite crawled und die CSS-Style-Definitionen extrahiert. Das Script `extract-framer-styles.js` existiert bereits, wurde aber nie aufgerufen. Zusätzlich müsste der Unframer MCP um einen `getStyles`-Endpunkt erweitert werden, der die Projekt-Styles (Colors, Text Styles) als JSON liefert.

---

### LÜCKE 2 (KRITISCH): BUG 3 — Background-Colors werden EXPLIZIT ÜBERSPRUNGEN

```javascript
// convert-xml-to-v4.js, Zeile 540+565:
const bgVal = backgroundColor || bgColor;
if (bgVal) {
  warn(`background.color '${bgVal}' muss als Global Class gesetzt werden (Bug 3). Übersprungen.`);
  // ← Der Wert wird KOMPLETT VERWORFEN, nicht mal als lokaler Style gesetzt!
}
```

Der Converter erkennt den Hintergrundfarbwert, schreibt eine Warnung und **verwirft ihn dann**. 
Es wird weder eine Global Class erstellt noch ein lokaler Style gesetzt.

**Lösung:** Mindestens: Hintergrundfarbe als lokalen Style setzen (`background-color` Prop). 
Besser: `generate-global-classes.js` VOR dem Build ausführen und GC-IDs in den Tree einweben.

---

### LÜCKE 3 (KRITISCH): RC-11 Fallback-Werte sind falsch und undifferenziert

```javascript
// convert-xml-to-v4.js, Zeile 657-667:
if (Object.keys(props).length === 0) {
  if (widgetType === 'e-heading') {
    props['font-family'] = wrapType('string', 'Inter');
    props['font-size'] = wrapSize('32px');      // ← ALLE Headings bekommen 32px
    props['font-weight'] = wrapType('string', '600');
    props['color'] = wrapColor('#111111');       // ← ALLE Headings bekommen #111
  }
}
```

Der Fallback wird aktiviert, wenn keine CSS-Attribute im XML gefunden werden — was bei Unframer-XML **immer** der Fall ist. Das Ergebnis: JEDE Überschrift sieht gleich aus (32px, schwarz), egal ob H1 (68px, weiß) oder Body-Label (16px, grau).

**Lösung:** Entweder:
- A) Unframer MCP erweitern, sodass `getNodeXml` auch CSS-Werte liefert
- B) Framer-Seite crawlen und CSS extrahieren (via `extract-framer-styles.js`)
- C) `inlineTextStyle`-Referenzen gegen ein Style-Dictionary auflösen

---

### LÜCKE 4: `inlineTextStyle`-Attribut wird komplett ignoriert

```xml
<FastReliablePlumbingSolutionsYouCanTrust
    inlineTextStyle="/Heading/Heading 1">
  Fast reliable plumbing solutions you can Trust
</FastReliablePlumbingSolutionsYouCanTrust>
```

Das `inlineTextStyle`-Attribut verweist auf ein Framer-Text-Style. Der Converter liest es nicht. Hätte man die Framer-Style-Map (`/Heading/Heading 1 → { family: "Inter Display", size: 68, weight: 600, color: "#FFFFFF" }`), könnte man die korrekten Werte setzen.

**Lösung:** Unframer MCP braucht einen `getTextStyles`/`getColorStyles`-Endpunkt, der die Projekt-Styles als JSON liefert. Oder: Framer-Seite parsen und CSS-Klassen extrahieren.

---

### LÜCKE 5: Komponenten werden nicht aufgelöst

```xml
<PrimaryButton
    componentId="Y8FLRZ93g"
    variant="MkNLMUh9v"
    ycw27fUKm="Get Free Estimate"    ← Text
    hM59WZCdN="/contact" />           ← Link
```

Der Converter erzeugt ein `e-component`-Widget, speichert `componentId` und `variant` — aber:
- Die Komponenten-Definition (Layout, Styling) wird NICHT vom Unframer geladen
- Die Property-Werte (`ycw27fUKm`, `hM59WZCdN`) werden NICHT extrahiert (Bug 8 findet sie nicht, weil sie in `extractComponentText` durch Uppercase-Camel-Filter fallen)
- Elementor V4 lehnt `e-component` ohne Server-seitige Komponenten-Registry ab

**Lösung:** Entweder Komponenten rekursiv vom Unframer abrufen (`getNodeXml(componentId)`) und in Widget-Trees auflösen, ODER wie im Workaround manuell mappen.

---

### LÜCKE 6: Design-System fehlt vollständig

Was gebaut wurde:
- 28 lokale `fenodeN`-Styles im `styles`-Objekt jedes Widgets
- Keine Global Classes, keine Global Variables
- Fonts nicht enqueued (Inter muss per Google Fonts geladen werden)

Was benötigt wird (laut elementor-v4-atomic-builder Skill):
1. **Global Variables** (Farben, Fonts, Größen) via `adrians-batch-create-variables`
2. **Global Classes** die auf diese Variables verweisen
3. **Font-Enqueuing** via `resolve-fonts.js` + WordPress
4. **Responsive Variants** für Tablet/Phone Breakpoints

Die Pipeline hat `generate-global-classes.js` und `resolve-fonts.js`, aber sie wurden nie aufgerufen.

**Lösung:** Der Pipeline-Workflow muss zwingend die vollständige Kette durchlaufen:
```
Unframer XML → convert-xml-to-v4.js → generate-global-classes.js 
→ Design System anlegen → GCs in Tree einweben → elementor-set-content
```

---

### LÜCKE 7: Responsive Breakpoints werden ignoriert

Das Framer-XML enthält:
```xml
<Tablet nodeId="Px0QA3Mz8" width="810px" ... />
<Phone  nodeId="QoxZ85cXX" width="390px" ... />
```

Der Converter sieht diese als separate Root-Nodes, konvertiert sie aber nicht als responsive Varianten des Desktop-Layouts. Stattdessen werden sie als leere `e-flexbox`-Container mit 0 Kindern ausgegeben (weil der Unframer bei Non-Primary-Variants die Kinder nicht liefert).

**Lösung:** Für jede Breakpoint-Variante `getNodeXml(nodeId)` aufrufen, die Kinder extrahieren und als `variants[{ breakpoint: "tablet" }, { breakpoint: "mobile" }]` in die Style-Definition des Desktop-Elements einweben.

---

### LÜCKE 8: Kein Screenshot-Abgleich / Visual QA

Es gab keinen Schritt, der das Ergebnis mit dem Original vergleicht. Die Pipeline hat `visual-qa.js` und `section-compare.js`, aber diese wurden nie verwendet.

**Lösung:** Nach jedem Build:
1. Screenshot der Framer-Seite machen (Browser-Automation)
2. Screenshot der gebauten Elementor-Seite machen
3. `visual-qa.js` oder Pixel-Differenz-Vergleich ausführen
4. Bei Abweichungen automatisch `adrians-patch-element-styles` auslösen

---

## Verbesserungsplan — Was müsste geändert werden?

### A) Unframer MCP ERWEITERN (höchste Priorität)

Der Unframer MCP braucht neue Endpunkte:

| Endpunkt | Return | Nutzen |
|---|---|---|
| `getColorStyles` | `{ "/Theme Color/Very Dark Green": { hex, rgb, opacity } }` | Löst `backgroundColor="/Theme Color/Very Dark Green"` auf |
| `getTextStyles` | `{ "/Heading/Heading 1": { family, size, weight, color, lineHeight } }` | Löst `inlineTextStyle="/Heading/Heading 1"` auf |
| `getComponentXml` | Vollständiger XML-Tree einer Komponente | Löst `componentId="Y8FLRZ93g"` auf |

### B) convert-xml-to-v4.js FIXEN

| Fix | Beschreibung |
|---|---|
| **Bug 3 fixen** | `backgroundColor` nicht verwerfen, sondern als lokalen Style setzen (minimal) |
| **Style-Referenz-Resolver** | `inlineTextStyle` und `backgroundColor`-Pfade gegen Style-Map auflösen |
| **RC-11 verbessern** | Fallbacks nicht statisch, sondern aus der ersten gefundenen Text-Style-Referenz ableiten |
| **Komponenten-Auflösung** | `e-component`-Nodes rekursiv via Unframer `getNodeXml(componentId)` expandieren |
| **Responsive Variants** | Breakpoint-Varianten als Style-Varianten mit `meta.breakpoint` erzeugen |

### C) Pipeline-Workflow vervollständigen

Der minimale Workflow für ein brauchbares Ergebnis:

```
1. Unframer: getProjectXml()              → Projekt-Struktur
2. Unframer: getColorStyles()             → Farb-Map         (NEU)
3. Unframer: getTextStyles()              → Typografie-Map   (NEU)
4. Unframer: getNodeXml(pageNodeId)       → Seiten-XML
5. convert-xml-to-v4.js                   → V4-Tree (MIT Styles diesmal!)
6. generate-global-classes.js             → GC-Plan
7. Novamira: batch-create-variables        → Farb/Font-Variablen
8. Novamira: create-global-class (×N)     → Global Classes
9. GCs in V4-Tree einweben
10. resolve-fonts.js                      → Fonts enqueuen
11. Novamira: batch-build-page            → Seite bauen
12. visual-qa.js                          → Screenshot-Vergleich
13. Novamira: patch-element-styles        → Iterative Korrekturen
```

### D) Neue Skills/Tools die benötigt werden

| Tool/Skill | Zweck |
|---|---|
| **`framer-css-extractor`** | Extrahiert CSS aus der publizierten Framer-Seite (als Fallback wenn Unframer keine Styles liefert) |
| **`style-reference-resolver`** | Löst `/Heading/Heading 1` → `{ family, size, weight, color }` auf |
| **`component-expander`** | Holt Komponenten-XML vom Unframer und ersetzt `e-component`-Nodes |
| **`screenshot-diff`** | Automatisierter Pixel-Vergleich Original vs. Build |
| **Unframer MCP Upgrade** | `getColorStyles`, `getTextStyles`, `getComponentXml` Endpunkte |

### E) Sofort machbare Quick-Wins

1. **Bug 3 Minimal-Fix**: `backgroundColor` als lokalen Style setzen (20 Zeilen)
2. **RC-11 verbessern**: Statt statischem Fallback die `inlineTextStyle`-Referenz parsen und Größe daraus ableiten (z.B. "Heading 1" → 68px, "Heading 2" → 48px, "Body" → 16px)
3. **Komponenten-Props extrahieren**: Bug 8 so erweitern, dass auch Uppercase-Camel-Keys als Text-Kandidaten geprüft werden
4. **Pipeline-Checkliste**: Vor jedem Build prüfen ob `--tokens` und `--fonts` übergeben wurden

---

## Fazit

Das Ergebnis war schlecht, weil die Pipeline nur die **strukturelle** Konvertierung durchgeführt hat (XML → Widget-Tree), aber die **visuelle** Konvertierung komplett fehlt:
- ❌ Keine Farben (Hintergründe, Textfarben)
- ❌ Keine Typografie (Font-Families, Größen, Gewichte)
- ❌ Keine Komponenten-Styles (Buttons, Badges)
- ❌ Kein Design-System (Global Classes, Variables)
- ❌ Kein Screenshot-Abgleich

Der Unframer MCP liefert aktuell nur die Struktur — für visuelle Qualität braucht er dringend Style-Endpunkte, oder die Pipeline muss als Fallback die publizierte Framer-Seite crawlen und CSS extrahieren.

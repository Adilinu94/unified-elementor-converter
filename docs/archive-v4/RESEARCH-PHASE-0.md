# RESEARCH PHASE 0 — Deep Research Ergebnisse

**Datum:** 15. Juni 2026
**Ziel:** 3 kritische Fragen für den Umbauplan klären

---

## R1: FRAMEREXPORT CSS-DATEN

### Forschungsfrage
> Welche CSS-Daten produziert FramerExport, und können wir daraus Token-Mappings generieren?

### Erkenntnisse

#### 1.1 Die publizierte Framer-Seite enthält ALLE benötigten CSS-Daten

Die Analyse von `https://hilarious-workshops-284047.framer.app/` ergab:

| CSS-Quelle | Inhalt | Relevanz |
|---|---|---|
| **Style Block 0** | `@font-face`-Regeln für "Inter" (100+ Font-Referenzen) | 🔴 Font-Definitionen |
| **Style Block 1** | Media Queries für responsive Breakpoints | 🟡 Responsive CSS |
| **Style Block 2** | **610 CSS-Variablen** + Global Styles | 🔴 DER DATENSCHATZ |
| **Style Block 3-4** | Body Background-Styling | 🟢 Weniger relevant |

#### 1.2 Framer Token-System

Die Framer-Seite verwendet ein Token-System mit UUID-basierten CSS-Variablen:

```css
/* Farb-Tokens (Framer-intern) */
--token-bd19fd49-3c1b-41a5-beeb-16e4bb8af9a3 → #0b0b0b
--token-38956d97-a979-47e1-890f-3665b6184df9 → #3e3e3e
--token-70c481ff-a9c5-46df-ae83-28c71ddf96f6 → #061d13  ← Very Dark Green!
--token-d5cd1460-88c4-40e6-8db0-834e519755f3 → #1a3127

/* Typografie-Tokens */
--font-family
--font-style  
--font-weight
--font-size
--framer-font-family
--framer-font-weight
--framer-font-size

/* Text-Farb-Tokens */
--text-color
--framer-text-color
--framer-link-text-color
--framer-link-hover-text-color
```

#### 1.3 MAPPING-LÜCKE: Token-UUIDs ↔ Unframer-Style-Pfade

Das KERNPROBLEM: Der Unframer MCP liefert menschenlesbare Style-Pfade:
- `backgroundColor="/Theme Color/Very Dark Green"`
- `inlineTextStyle="/Heading/Heading 1"`

Aber das Framer-CSS verwendet UUID-Tokens:
- `--token-70c481ff-a9c5-46df-ae83-28c71ddf96f6: #061d13`

Es gibt KEINE direkte Mapping-Tabelle zwischen diesen beiden Systemen in der publizierten Seite.

#### 1.4 Fonts: KEINE Google Fonts, sondern @font-face

```css
/* Block 0: @font-face für Inter */
@font-face {
  font-family: 'Inter';
  src: url('https://framerusercontent.com/.../Inter-Regular.woff2') format('woff2');
  font-weight: 400;
}
@font-face {
  font-family: 'Inter Display';
  src: url('https://framerusercontent.com/.../InterDisplay-SemiBold.woff2') format('woff2');
  font-weight: 600;
}
```

**Konsequenz:** Fonts können NICHT per Google Fonts API geladen werden. Sie müssen:
- Entweder vom Framer CDN verlinkt werden (nicht nachhaltig)
- Oder lokal via `resolve-fonts.js` + `upload-fonts-to-wp.js` in WordPress hochgeladen werden
- Das `ki-2-elementor-master` Script `resolve-fonts.js` parst bereits Framer-Präfixe wie `FR;InterDisplay-SemiBold`

#### 1.5 FramerExport-Status im Projekt

- Kein FramerExport-Output vorhanden (kein `index.html` in Framerverzeichnissen)
- Der Wizard kann FramerExport ausführen (via `npm run dev -- <url>` oder `npx tsx src/cli/index.ts`)
- `extract-framer-styles.js` existiert und kann CSS aus HTML parsen
- Die Pipeline hat ALLE Komponenten, sie wurden nur nicht verknüpft

### Empfehlung für Phase 2

```
Ansatz A (Bevorzugt): FramerExport ausführen → extract-framer-styles.js → Token-Map
  Vorteil: CSS-Dateien sind bereits geparst, Klassennamen könnten mit Unframer-Refs korrelieren
  Nachteil: FramerExport muss installiert sein

Ansatz B (Fallback): Publizierte Seite crawlen → CSS-Variablen extrahieren → Heuristik-Mapping
  Vorteil: Funktioniert immer, keine lokale Installation nötig
  Nachteil: Token-UUIDs müssen manuell mit Style-Pfaden gemappt werden
```

---

## R2: ELEMENTOR V4 STYLE-SYSTEM

### Forschungsfrage
> Was akzeptiert `elementor-set-content` für Hintergründe, Buttons und Fonts?

### Erkenntnisse

#### 2.1 Das V4 Style-Schema (Live von test4 abgerufen)

Der Server liefert ein vollständiges Schema mit **29 Properties**:

| Property | $$type | Enum/Besonderheit |
|----------|--------|-------------------|
| `width`, `height`, `min-width`, `max-width` | `size` oder `global-size-variable` | Einheiten: px,em,rem,vw,vh,%,auto... |
| `overflow` | `string` | `visible`, `hidden`, `auto` |
| `aspect-ratio` | `string` oder `number` | |
| `display` | `string` | (nicht vollständig gesehen) |
| `flex-direction` | `string` | |
| `color` | `color` oder `global-color-variable` | |
| `background-color` | ❓ MUSS VERIFIZIERT WERDEN | |
| `font-family` | `string` oder `global-font-variable` | |
| `font-size` | `size` oder `global-size-variable` | |
| `font-weight` | `string` oder `number` | |
| `border-radius` | `size` oder `border-radius` (4-Ecken) | |
| `padding` | `dimensions` oder `size` | |
| `margin` | `dimensions` oder `size` | |

#### 2.2 Kritische offene Frage: background-color

Die E2E-Test-Response zeigte: Der Server lehnt `background-color` auf `e-flexbox`-Containern
NICHT grundsätzlich ab — er hat es als "muss in Global Class" gewarnt (Bug 3), aber nicht rejected.

**Zu testen:** Ein minimales V4-Tree mit `background-color` als lokalen Style an test4 senden
und prüfen ob es akzeptiert wird.

#### 2.3 Button-Styling (aus verschiedenen Quellen)

Laut `elementor-v4-style-property-quick-reference` aus ki-2-elementor:

| Property | $$type | Beispiel |
|----------|--------|----------|
| `background-color` | `color` oder `global-color-variable` | `{"$$type":"color","value":"#DFFFA3"}` |
| `border-radius` | `size` (4-Ecken-Objekt) | `{"$$type":"size","value":{"size":42,"unit":"px"}}` |
| `padding` | `dimensions` | `{"$$type":"dimensions","value":{...}}` |
| `color` (Textfarbe) | `color` oder `global-color-variable` | `{"$$type":"color","value":"#1A3127"}` |
| `font-family` | `string` oder `global-font-variable` | `{"$$type":"string","value":"Inter"}` |
| `font-weight` | `string` | `{"$$type":"string","value":"600"}` |

#### 2.4 Was wir noch TESTEN müssen (vor Phase 1)

- [ ] Minimaler `e-button` mit allen Style-Properties an test4 senden → akzeptiert?
- [ ] `e-flexbox` mit `background-color` als lokalem Style → akzeptiert oder rejected?
- [ ] `e-heading` mit `font-family` als `global-font-variable` → wird die GV-ID aufgelöst?
- [ ] `border-radius` als 4-Ecken-Objekt vs. einfacher `size` Wert

---

## R3: PYTHON PIPELINE CODE

### Forschungsfrage
> Ist der Python Pipeline Code verfügbar?

### Erkenntnisse

#### 3.1 NICHT ÖFFENTLICH

- Keine `.py`-Dateien im `ki-2-elementor-master` Repo
- Keine öffentlichen GitHub-Repos mit `framer_to_elementor.py`
- Web-Recherche ergab: Es gibt KEINEN öffentlichen Framer→Elementor-Konverter
- **Der Code ist privat/intern — wir können ihn nicht studieren**

#### 3.2 Was wir TROTZDEM aus der SPEC lernen können

Die `SPEC-framer-to-elementor-v4.md` dokumentiert ausführlich:

**7 Kritische Bugs (die wir vermeiden müssen):**

| Bug | Beschreibung | Relevanz für uns |
|-----|-------------|------------------|
| 1 | Breakpoint `"desktop"` → MUSS `null` sein | ✅ Unser Converter setzt `"desktop"` — BUG! |
| 2 | `line-height`/`opacity` als `px` → MUSS `unit:"custom"` | 🟡 Teilweise gefixt in `resolveLineHeight()` |
| 3 | `border-radius` als einfacher Wert → MUSS 4-Ecken-Objekt | 🔴 Unser Converter macht das FALSCH |
| 4 | `custom_css` in `props` → MUSS auf Variant-Ebene | 🟢 Noch nicht relevant |
| 5 | `origin` in `transform` → MUSS top-level | 🟢 Noch nicht relevant |
| 6 | Default-Werte skippen (`line-height:0`, `aspect-ratio:auto`) | 🟡 Teilweise |
| 7 | `stroke` als Array (V5) → Crash | 🟢 Noch nicht relevant |

**5 Architektonische Invarianten:**

| # | Invariante | Beschreibung |
|---|-----------|-------------|
| 1 | **Rendering-Gate** | Verstoß gegen Typisierung = Seite rendert OHNE Styles |
| 2 | **Typed AST** | JEDES Property MUSS `{"$$type":"T","value":V}` sein |
| 3 | **Token Indirection** | Farben/Fonts NUR als GV-Referenzen, nie hardcoded |
| 4 | **Namespace-Trennung** | `settings` vs `styles` strikt trennen |
| 5 | **Variant Isolation** | Responsive Variants nur mit geänderten Props (Delta) |

**3-Phasen-Architektur:**

```
Phase 1: framer_to_elementor.py
  XML → Intermediate JSON (variables, global_classes, elements, warnings)

Phase 2: v4_converter.py  
  Intermediate JSON → V4-compliant JSON ($$type wrapping, e-gv-* resolution)

Phase 3: framer_pipeline.py
  Orchestrierung, CLI, Output (.elements.json, .variables.json, .global_classes.json)
```

**Beste Ideen zum Übernehmen:**

1. **Getrennte Output-Dateien** statt monolithischem Tree
2. **MD5-Hashes für GV-IDs** (deterministisch, kein Server-Call nötig)
3. **Component Downgrading** (Heading → Paragraph Heuristik)
4. **9 spezifische Pre-Build-Checks**
5. **MCP-Live-Modus** für geordnete API-Aufrufe

---

## ZUSAMMENFASSUNG & NÄCHSTE SCHRITTE

### Beantwortete Fragen

| Frage | Antwort |
|-------|---------|
| FramerExport CSS? | ✅ Ja, 610 CSS-Variablen + @font-face in publizierter Seite. FramerExport-Output muss noch getestet werden |
| Elementor V4 Schema? | ✅ Live-Schema abgerufen. 29 Properties. `background-color`-Frage noch offen |
| Python Code? | ❌ Nicht öffentlich. Aber SPEC enthält 7 Bugs + 5 Invarianten zum Übernehmen |

### Neue Erkenntnisse für den Umbauplan

1. **BUG GEFUNDEN:** Unser Converter setzt Breakpoint `"desktop"` statt `null` (Bug 1)
2. **BUG GEFUNDEN:** `border-radius` wird als einfacher Wert gesetzt, V4 braucht 4-Ecken-Objekt (Bug 3)
3. **FONT-STRATEGIE:** Keine Google Fonts! `@font-face` mit Framer CDN URLs → lokal via `resolve-fonts.js`
4. **TOKEN-MAPPING:** UUID-Tokens der Framer-Seite müssen mit Style-Pfaden des Unframer gemappt werden
5. **PYTHON-IDEEN:** Getrennte Output-Dateien + MD5-GV-IDs + 9 Pre-Build-Checks übernehmen

### Vor Phase 1 zu klären

- [ ] `background-color`-Test an test4: lokaler Style akzeptiert?
- [ ] `border-radius` 4-Ecken-Format testen
- [ ] Breakpoint `null` vs `"desktop"` testen
- [ ] FramerExport auf `hilarious-workshops-284047` ausführen und CSS-Output analysieren

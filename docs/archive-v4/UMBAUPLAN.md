# UMBAUPLAN v2.0 — Framer → Elementor V4 Pipeline

**Datum:** 15. Juni 2026 (Update nach Phase 0 Research)
**Ausgangspunkt:** E2E-Test mit 8 systematischen Lücken + Phase 0 Deep Research
**Ziel:** Vollautomatisierte Pipeline mit visuell korrektem Output
**Strategie:** Dual-Source-Ansatz (Unframer MCP für Struktur + FramerExport/Crawler für CSS)

---

## 0. GRUNDSATZENTSCHEIDUNGEN (mit Research-Erkenntnissen)

### 0.1 Unframer MCP kann NICHT modifiziert werden ✅ BESTÄTIGT

Der Unframer MCP (`mcp.unframer.co`) ist ein externer Service.
Er hat nur 4 Tools: `getProjectXml`, `getNodeXml`, `getSelectedNodesXml`, `zoomIntoView`.
**Keine** `getColorStyles`/`getTextStyles`/`getComponentXml` Endpunkte.
**Kein** `includeStyles: true` Parameter.

**Konsequenz:** Style-Daten MÜSSEN aus externen Quellen kommen.

### 0.2 Architektur-Entscheidung: Dual-Source (Option D) ✅ BESTÄTIGT

```
QUELLE 1: Unframer MCP              → Struktur (DOM-Baum, Komponenten-Hierarchie, Style-REFERENZEN)
QUELLE 2: FramerExport/Publikation  → Styling  (CSS-Werte, Farben via CSS-Vars, Fonts via @font-face)
         ↓
    CSS-TOKEN-EXTRACTOR             → Extrahiert 610+ CSS-Variablen, @font-face, Media Queries
         ↓
    TOKEN-MAPPING                   → Verknüpft Unframer Style-PFADE mit CSS UUID-TOKENS
         ↓                            (DAS ist die Schlüssel-Herausforderung!)
         ↓
    DESIGN SYSTEM                   → Global Variables (MD5-GV-IDs) + Global Classes
         ↓
    V4 WIDGET TREE                  → convert-xml-to-v4.js MIT Tokens + 9 new Bug-Fixes
         ↓
    BUILD + QA                      → set-content → Screenshot-Vergleich → Auto-Fix
```

### 0.3 DAS TOKEN-MAPPING-PROBLEM (Neue Erkenntnis aus Research)

Der Unframer MCP liefert menschenlesbare Style-Pfade:
```
backgroundColor="/Theme Color/Very Dark Green"
inlineTextStyle="/Heading/Heading 1"
```

Das Framer-CSS verwendet UUID-basierte Token:
```
--token-70c481ff-a9c5-46df-ae83-28c71ddf96f6: #061d13
```

**Es gibt KEINE direkte Mapping-Tabelle zwischen diesen Systemen in der publizierten Seite.**

**Lösungsstrategie (3-stufig):**

| Stufe | Ansatz | Genauigkeit | Aufwand |
|-------|--------|-------------|---------|
| 1. FramerExport | CSS-Klassennamen könnten mit Style-Pfaden korrelieren | Hoch | Mittel |
| 2. Heuristik | Farbwert-Vergleich (alle UUID-Tokens mit Hex-Wert gegen Unframer-Pfad-Erwartung) | Mittel | Hoch |
| 3. Manuell | Mapping-Tabelle pro Projekt pflegen | 100% | Manuell |

### 0.4 CSS-Quellen-Priorität (angepasst)

| Quelle | Priorität | Begründung |
|--------|-----------|------------|
| FramerExport CLI (lokaler HTML/CSS-Mirror) | 🥇 PRIMÄR | CSS-Dateien mit korrelierbaren Klassennamen, bereits im Wizard |
| Publizierte Framer-Seite (fetch-basierter Crawl) | 🥈 FALLBACK | 610 CSS-Variablen + @font-face + Media Queries, aber UUID-Mapping nötig |
| Built-in Style-Resolver (Heuristik) | 🥉 LETZTE INSTANZ | Basierend auf `inlineTextStyle`-Pfad-Parsing |

### 0.5 Font-Strategie (KOMPLETT GEÄNDERT)

❌ **NICHT:** Google Fonts API
✅ **STATTDESSEN:** `@font-face` mit `.woff2`-Dateien vom Framer CDN → lokal in WordPress hosten

```css
/* Was die publizierte Seite tatsächlich verwendet: */
@font-face {
  font-family: 'Inter';
  src: url('https://framerusercontent.com/.../Inter-Regular.woff2') format('woff2');
}
@font-face {
  font-family: 'Inter Display';
  src: url('https://framerusercontent.com/.../InterDisplay-SemiBold.woff2') format('woff2');
}
```

**Workflow:** `resolve-fonts.js` (parst `FR;InterDisplay-SemiBold`) → `upload-fonts-to-wp.js` → `adrians-batch-media-upload`

---

## NEUE BUGS AUS PHASE 0 RESEARCH (SOFORT FIXEN)

Diese Bugs wurden während des Researchs entdeckt und sind **vor** Phase 1 zu beheben:

### BUG A: Breakpoint `"desktop"` → MUSS `null` sein

**Quelle:** Python SPEC Bug #1
**Betroffen:** `convert-xml-to-v4.js`, Zeile ~900: `meta: { breakpoint: 'desktop', state: null }`
**Fix:** `breakpoint: 'desktop'` → `breakpoint: null`
**Impact:** 🔴 Ohne Fix rendern responsive Varianten nicht korrekt

### BUG B: `border-radius` als einfacher Wert → MUSS 4-Ecken-Objekt

**Quelle:** Python SPEC Bug #3
**Betroffen:** `framer-utils.js`, `wrapBorderRadius()` und `convert-xml-to-v4.js`
**Fix:** Statt `{"$$type":"size","value":{"size":16,"unit":"px"}}` → 
`{"$$type":"border-radius","value":{"top_left":...,"top_right":...,"bottom_right":...,"bottom_left":...}}`
**Impact:** 🔴 Ohne Fix werden Border-Radii von V4 ignoriert

### BUG C: `line-height`/`opacity` müssen `unit:"custom"` verwenden

**Quelle:** Python SPEC Bug #2, #6
**Betroffen:** `framer-utils.js`, `resolveLineHeight()` und `wrapUnitless()`
**Status:** 🟡 Teilweise gefixt, muss verifiziert werden

### BUG D: Default-Werte skippen

**Quelle:** Python SPEC Bug #6
**Betroffen:** `convert-xml-to-v4.js`, `buildStyleProps()`
**Fix:** `line-height: 0` → weglassen, `aspect-ratio: auto` → weglassen
**Impact:** 🟢 Gering

---

## PHASE 1: QUICK-WINS & SKILLS-ÜBERNAHME (Tag 1)

**Ziel:** Sofortige Verbesserungen + 4 neue Bug-Fixes.
**Aufwand:** ~4 Stunden (verdoppelt wegen neuer Bugs)

### 1.1 Skills aus ki-2-elementor-master kopieren

| Skill | Datei | Adressiert |
|-------|-------|-----------|
| `elementor-v4-build-checklist` | `build-checklist.md` | 12-Guard Pre-Build-Check |
| `elementor-v4-style-property-quick-reference` | `style-props-quickref.md` | Korrekte $$type-Formate (30 Props) |
| `client-design-token-setup-protocol` | `design-token-protocol.md` | Variables → Classes in 5 Phasen |
| `framer-dual-source-to-v4` | `dual-source-workflow.md` | Goldstandard-Workflow |
| `framer-responsive-extractor` | `responsive-extractor.md` | Responsive Breakpoints aus CSS |
| `elementor-v4-visual-qa` | `visual-qa.md` | Browser-Screenshot-Vergleich |
| `framer-token-validator` | `token-validator.md` | Token-Mapping-Validierung |
| `global-class-pattern-analyzer` | `gc-pattern-analyzer.md` | Style-Pattern → Global Classes |
| `elementor-v4-error-recovery` | `error-recovery.md` | Fehlerbehebung nach Build |
| `design-system-reference` | `design-system-ref.md` | Design-System-Referenz |

### 1.2 Bug 3 Fix — background-color NICHT verwerfen

```javascript
// convert-xml-to-v4.js, buildStyleProps(), beide Stellen (e-flexbox + e-div-block):

// STATT:
warn(`background.color '${bgVal}' muss als Global Class gesetzt werden (Bug 3). Übersprungen.`);

// NEU (minimaler Fix):
if (resolved) {
  props['background-color'] = resolved;
  warn(`background.color '${bgVal}' als lokaler Style gesetzt (wird später durch GC ersetzt).`);
}
```

### 1.3 RC-11 Fallback verbessern — inlineTextStyle parsen

```javascript
// convert-xml-to-v4.js, buildStyleProps(): inlineTextStyle-Attribut LESEN

const textStyleRef = attrs.inlineTextStyle;
if (textStyleRef && !fontFamily && !fontSize) {
  // Style-Pfad parsen: "/Heading/Heading 1" → "Heading 1"
  const styleName = textStyleRef.split('/').pop();
  const fallback = TEXT_STYLE_FALLBACKS[styleName];
  if (fallback) {
    if (fallback.size)   props['font-size']   = wrapSize(fallback.size);
    if (fallback.weight) props['font-weight'] = wrapType('string', fallback.weight);
    if (fallback.color)  props['color']       = wrapColor(fallback.color);
  }
}

const TEXT_STYLE_FALLBACKS = {
  'Heading 1': { size: '68px', weight: '700' },
  'Heading 2': { size: '48px', weight: '600' },
  'Heading 3': { size: '32px', weight: '600' },
  'Heading 4': { size: '24px', weight: '600' },
  'Body-20px-Medium':  { size: '20px', weight: '500' },
  'Body-16px-Medium':  { size: '16px', weight: '500' },
  'Body S':     { size: '14px', weight: '400' },
};
```

### 1.4 Bug 8 erweitern — Komponenten-Props aus CamelCase-Keys

```javascript
// extractComponentText() in convert-xml-to-v4.js:
// Nur BEKANNTE Style-Attribut-Keys filtern, den Rest als Text-Kandidaten prüfen

const STYLE_ATTR_KEYS = new Set([
  'backgroundColor','backgroundImage','borderRadius','fontFamily',
  'fontSize','fontWeight','lineHeight','letterSpacing','opacity',
  'stackDirection','stackGap','stackDistribution','stackAlignment',
  'position','top','right','bottom','left','width','height',
  'maxWidth','minWidth','overflow','display','gridTemplateColumns',
]);
// NICHT filtern: componentId, variant, name, nodeId (bereits oben gefiltert)
// ALLE ANDEREN CamelCase-Keys sind Property-Overrides → Text-Kandidaten
if (STYLE_ATTR_KEYS.has(key)) continue;
```

### 1.5 Bug A Fix — Breakpoint `null` statt `"desktop"`

```javascript
// convert-xml-to-v4.js, convertNode() → baseVariant:
// ALT:  meta: { breakpoint: 'desktop', state: null }
// NEU:  meta: { breakpoint: null, state: null }
```

### 1.6 Bug B Fix — border-radius als 4-Ecken-Objekt (wenn ungleich)

```javascript
// framer-utils.js, wrapBorderRadius():
// Wenn alle 4 Ecken gleich → einfacher size-Wert (V4 akzeptiert das)
// Wenn ungleich → 4-Ecken-Objekt

function wrapBorderRadius(value) {
  const parts = String(value).trim().split(/\s+/);
  if (parts.length === 1) {
    return { "$$type": "size", "value": parseSize(parts[0]) };
  }
  // Unterschiedliche Ecken → 4-Ecken-Objekt
  return {
    "$$type": "border-radius",
    "value": {
      "top_left": parseSize(parts[0] || '0'),
      "top_right": parseSize(parts[1] || parts[0] || '0'),
      "bottom_right": parseSize(parts[2] || parts[0] || '0'),
      "bottom_left": parseSize(parts[3] || parts[1] || parts[0] || '0'),
    }
  };
}
```

### 1.7 Tests & Commit

- [ ] Alle 128 Pipeline-Tests müssen weiterhin grün sein
- [ ] Neue Tests für Bug A (breakpoint null), Bug B (border-radius)
- [ ] Manueller Test: Hero-XML konvertieren, prüfen ob Hintergrundfarbe + korrekte Breakpoints im Tree
- [ ] Commit: `fix: Bug 3, RC-11, Bug 8, Bug A, Bug B — Phase 1 quick-wins`

---

## PHASE 2: DUAL-SOURCE CSS-EXTRAKTION (Tag 2-3)

**Ziel:** CSS-Werte aus FramerExport ODER publizierter Seite extrahieren und Token-Mapping erstellen.
**NEU:** Zwei Extraktions-Pfade (FramerExport primär, Crawler sekundär) + UUID-Mapping-Logik.

### 2.1 Neues Script: `extract-framer-css-tokens.js`

```javascript
// Input:  FramerExport/<project>/index.html + styles.css  ODER Framer-URL
// Output: token-mapping.json (Style-Pfad → CSS-Properties)

{
  "source": "framer-export",  // oder "crawler"
  "colors": {
    "/Theme Color/Very Dark Green": {
      "hex": "#061D13",
      "gv_id": null,
      "matched_by": "heuristic"  // wie wurde das Mapping gefunden?
    }
  },
  "textStyles": {
    "/Heading/Heading 1": {
      "fontFamily": "Inter Display",
      "fontSize": "68px",
      "fontWeight": "600",
      "color": "#FFFFFF",
      "lineHeight": "1.1",
      "matched_by": "framer-export-class"
    }
  },
  "fonts": {
    "Inter": {
      "family": "Inter",
      "weights": ["400", "500", "600", "700"],
      "sources": [
        { "weight": "400", "url": "https://framerusercontent.com/.../Inter-Regular.woff2" }
      ]
    }
  },
  "breakpoints": {
    "tablet": { "width": "810px" },
    "mobile": { "width": "390px" }
  },
  "unmapped_tokens": {
    "// Token-UUIDs die keinem Style-Pfad zugeordnet werden konnten": [],
    "--token-70c481ff-...": { "hex": "#061d13", "possible_paths": ["/Theme Color/Very Dark Green"] }
  }
}
```

### 2.2 ZWEI EXTRAKTIONS-PFADE

**Pfad A: FramerExport (PRIMÄR)**

```javascript
// FramerExport ausführen
await runFramerExport(framerUrl);

// CSS extrahieren — Klassennamen könnten mit Unframer-Pfaden korrelieren
// extract-framer-styles.js parst <style>-Blöcke + styles.css
const cssData = await runScript('extract-framer-styles.js', [
  '--html', path.join(exportDir, 'index.html'),
  '--output', path.join(exportDir, 'extracted-styles.json'),
]);

// Mapping bauen: CSS-Klasse → Unframer-Style-Pfad
// FramerExport-Klassen wie ".heading-1" → Unframer "/Heading/Heading 1"
const tokenMap = mapFramerExportClassesToStylePaths(cssData, unframerStyleRefs);
```

**Pfad B: Browser-Crawl (FALLBACK)**

```javascript
// Publizierte Seite fetchen
const html = await fetch(framerUrl);

// 610 CSS-Variablen aus Block 2 extrahieren
const cssVars = extractCssVariables(html);
// → { "--token-70c481ff-...": "#061d13", ... }

// @font-face-Regeln aus Block 0 extrahieren
const fontFaces = extractFontFaces(html);
// → [{ family: "Inter", weight: "400", url: "..." }]

// Media Queries aus Block 1 extrahieren  
const breakpoints = extractBreakpoints(html);

// UUID-Tokens via Farbwert-Heuristik mit Style-Pfaden matchen
const tokenMap = matchUuidTokensToStylePaths(cssVars, unframerStyleRefs);
```

### 2.3 UUID-MAPPING-HEURISTIK (Die Schlüssel-Innovation)

```javascript
function matchUuidTokensToStylePaths(cssVars, unframerStyleRefs) {
  const map = {};
  
  for (const [uuidToken, cssValue] of Object.entries(cssVars)) {
    // Extrahiere den Farbwert (hex oder rgb)
    const color = normalizeColor(cssValue);
    if (!color) continue;
    
    // Suche nach Unframer-Style-Pfaden mit ähnlichem Namen
    // (z.B. "--token-xxx" → "/Theme Color/Very Dark Green" via Farbwert-Vergleich)
    
    // Heuristik 1: Exakter Farbwert-Match
    for (const [stylePath, styleData] of Object.entries(unframerStyleRefs.colors || {})) {
      if (styleData.expectedColor && colorsMatch(color, styleData.expectedColor)) {
        map[stylePath] = { hex: color, matched_by: 'color-heuristic', confidence: 'high' };
      }
    }
    
    // Heuristik 2: Token-Name enthält Style-Pfad-Hinweise
    // (funktioniert selten, aber Versuch wert)
    
    // Heuristik 3: Position im CSS (Reihenfolge der Variablen)
  }
  
  return map;
}
```

### 2.4 Wizard-Integration

```javascript
// wizard.js: NEUER Schritt 1.5

await runStep('CSS-Token-Extraktion', async () => {
  let tokenMap;
  
  // Pfad A: FramerExport
  if (framerExportAvailable) {
    tokenMap = await runScript('extract-framer-css-tokens.js', [
      '--mode', 'framer-export',
      '--html', path.join(exportDir, 'index.html'),
      '--style-refs', unframerStyleRefsPath,
      '--output', tokenMapPath,
    ]);
  }
  
  // Pfad B: Crawler (Fallback)
  if (!tokenMap || tokenMap.unmapped_tokens.length > 10) {
    log.info('FramerExport-Mapping unvollständig, versuche Browser-Crawl...');
    tokenMap = await runScript('extract-framer-css-tokens.js', [
      '--mode', 'crawler',
      '--url', framerUrl,
      '--style-refs', unframerStyleRefsPath,
      '--output', tokenMapPath,
    ]);
  }
  
  // Qualitäts-Check
  const coverage = Object.keys(tokenMap.colors || {}).length;
  log.info(`Token-Mapping: ${coverage} Farben, ${Object.keys(tokenMap.textStyles||{}).length} Text-Styles`);
  
  if (tokenMap.unmapped_tokens?.length > 0) {
    log.warn(`${tokenMap.unmapped_tokens.length} unmappte Tokens — manuelle Nacharbeit nötig`);
  }
  
  return tokenMap;
});
```

---

## PHASE 3: DESIGN-SYSTEM-AUTOMATISIERUNG (Tag 4-5)

**Ziel:** Global Variables + Global Classes aus Token-Mapping erstellen.
**NEU:** MD5-basierte GV-IDs (von Python SPEC übernommen), getrennte Output-Dateien.

### 3.1 MD5-basierte GV-IDs (von Python SPEC)

```javascript
// Statt Server-seitiger ID-Generierung:
// Deterministische IDs via MD5 (kein Server-Call nötig!)

function generateGvId(name, type) {
  const hash = crypto.createHash('md5')
    .update(`novamira:${type}:${name}`)
    .digest('hex')
    .slice(0, 7);
  return `e-gv-${hash}`;
}

// Beispiel:
// generateGvId("Theme Color / Very Dark Green", "color") → "e-gv-a3f2b1c"
// generateGvId("Inter Display", "font") → "e-gv-d4e5f6a"
```

### 3.2 Getrennte Output-Dateien (von Python SPEC)

Statt einem monolithischen V4-Tree produziert die Pipeline jetzt:

| Datei | Inhalt |
|-------|--------|
| `elements.json` | Der V4 Widget-Tree |
| `variables.json` | Alle Global Variables mit GV-IDs |
| `global-classes.json` | Alle Global Classes mit GC-IDs |
| `token-mapping.json` | Style-Pfad → CSS-Wert + GV-ID (aktualisiert) |
| `font-resolution.json` | Font-Mapping + Upload-URLs |
| `asset-manifest.json` | Bild-Mapping + Media-IDs |

### 3.3 Workflow: Vom Token-Mapping zum Design-System

```
token-mapping.json
    │
    ├── colors → setup-design-system.js → batch-create-variables
    │              → e-gv-XXXXXXXX (MD5) zurück in Token-Map
    │
    ├── fonts → setup-design-system.js → batch-create-variables
    │              → e-gv-XXXXXXXX (MD5)
    │
    ├── textStyles → generate-global-classes.js → Typografie-GCs
    │                  → gc-XXXXXXXXXXXXXXXXX
    │
    └── → elementor-create-global-class (×N)
           → apply-variable-to-class (Bindings)
```

### 3.4 Font-Handling (KEINE Google Fonts!)

```javascript
// Statt Google Fonts API:
// 1. @font-face-URLs aus Framer-Seite extrahieren
// 2. .woff2-Dateien herunterladen
// 3. Via adrians-batch-media-upload in WordPress hochladen
// 4. Font-Variable mit Media-ID erstellen

const fontFace = extractFontFaces(html);
for (const font of fontFace) {
  const file = await downloadFont(font.url);
  const mediaId = await uploadToWordpress(file, font.family);
  await createFontVariable(font.family, font.weight, mediaId);
}
```

---

## PHASE 4: convert-xml-to-v4.js UMBAU (Tag 5-7)

**Ziel:** Den Converter so umbauen, dass er MIT Token-Mapping + allen Bug-Fixes korrekte Outputs produziert.
**NEU:** 9 Änderungen (statt 8), inkl. Breakpoint-null + border-radius + MD5-GV-IDs.

### 4.1 Alle Änderungen im Überblick

| # | Änderung | Zeilen | Lücke |
|---|----------|--------|-------|
| 1 | `inlineTextStyle` parsen + via Token-Map auflösen | +40 | L1, L3, L4 |
| 2 | `backgroundColor`-Pfad via Token-Map auflösen | +30 | L2 |
| 3 | Bug 3: background-color NICHT verwerfen | -10/+5 | L2 |
| 4 | RC-11: Fallback aus Style-Referenz ableiten | +50 | L3 |
| 5 | Bug 8: CamelCase-Keys als Text-Kandidaten | +10 | L5 |
| 6 | Bug A: Breakpoint `null` statt `"desktop"` | -3/+3 | 🔴 NEU |
| 7 | Bug B: border-radius 4-Ecken-Objekt | +15 | 🔴 NEU |
| 8 | Komponenten-Rekursion (getNodeXml) | +60 | L5 |
| 9 | Responsive Variants erzeugen | +80 | L7 |

### 4.2 Python SPEC Invarianten einbauen

```javascript
// Invariante 1 (Rendering-Gate): Typisierung validieren
function assertTypedAst(node) {
  for (const [key, value] of Object.entries(node.settings || {})) {
    if (typeof value === 'object' && !value['$$type']) {
      throw new Error(`Rendering-Gate: settings.${key} ohne $$type`);
    }
  }
}

// Invariante 3 (Token Indirection): Keine Hardcoded-Hex-Werte
function assertNoHardcodedColors(node) {
  for (const variant of (node.styles?.[styleId]?.variants || [])) {
    for (const [prop, value] of Object.entries(variant.props || {})) {
      if (value['$$type'] === 'color' && value.value?.startsWith('#')) {
        warn(`Hardcoded color ${value.value} — sollte GV-Referenz sein`);
      }
    }
  }
}

// Invariante 5 (Variant Isolation): Nur geänderte Props in Responsive-Variants
function deltaVariants(desktopProps, responsiveProps) {
  const delta = {};
  for (const [key, value] of Object.entries(responsiveProps)) {
    if (JSON.stringify(value) !== JSON.stringify(desktopProps[key])) {
      delta[key] = value;
    }
  }
  return delta;
}
```

### 4.3 Tests für den umgebauten Converter

- [ ] Unit-Test: Token-Mapping wird korrekt aufgelöst
- [ ] Unit-Test: `inlineTextStyle` → CSS-Properties via Token-Map
- [ ] Unit-Test: `backgroundColor="/Theme Color/X"` → korrekte Farbe via Token-Map
- [ ] Unit-Test: Breakpoint `null` (nicht `"desktop"`)
- [ ] Unit-Test: border-radius 4-Ecken-Objekt
- [ ] Unit-Test: Komponenten-Rekursion
- [ ] Unit-Test: Responsive Variants
- [ ] Unit-Test: Rendering-Gate-Invariante
- [ ] Alle 128 existierenden Tests müssen weiterhin grün sein

---

## PHASE 5: BUILD-QUALITÄT & VISUAL QA (Tag 7-8)

**Ziel:** Automatische Qualitätssicherung nach jedem Build.
**NEU:** 9-Punkte Pre-Build-Check (von Python SPEC) + border-radius/Breakpoint-Checks.

### 5.1 Pre-Build-Validation (erweitert)

```javascript
// 9 Checks (von Python SPEC + eigene):
// 1. TOKEN_EXISTENCE — alle referenzierten GV-IDs existieren
// 2. COLOR_CONSISTENCY — Farbwerte in Tokens stimmen mit CSS überein
// 3. NO_HARDCODED_HEX — keine direkten Hex-Werte in Styles
// 4. BREAKPOINT_NULL — Desktop-Variants haben breakpoint: null
// 5. BORDER_RADIUS_FORMAT — border-radius ist 4-Ecken-Objekt
// 6. NO_EMPTY_CONTAINERS — keine leeren e-flexbox/e-div-block
// 7. HEADING_HIERARCHY — h1-h6 Reihenfolge logisch
// 8. ALT_TEXT_PRESENT — alle e-image haben alt-Text
// 9. DOM_DEPTH — max 6 Ebenen

await runStep('Pre-Build-Validation', async () => {
  const result = await runScript('framer-pre-build-validate.js', [
    '--tree', v4TreePath,
    '--token-map', tokenMapPath,
    '--min-score', '85',
    '--checks', 'all',
  ]);
  
  if (result.score < 85) {
    throw new Error(`Pre-build validation: ${result.score}% < 85%`);
  }
});
```

### 5.2 Screenshot-Vergleich (unverändert gut)

Der bestehende `visual-qa.js` + `section-compare.js` + `deduplicate-visual-qa.js` Stack wird aktiviert.

---

## PHASE 6: WIZARD-INTEGRATION & E2E-TEST (Tag 8-10)

**Ziel:** Alles im Wizard zusammenführen und mit E2E-Test validieren.

### 6.1 Finaler Wizard-Workflow (14 Schritte)

```
 1. FramerExport                        (bestehend, gecached)
 2. CSS-Token-Extraktion                (NEU — Pfad A: FramerExport)
 3. Browser-Crawl-Fallback              (NEU — Pfad B: wenn A unvollständig)
 4. Unframer MCP getProjectXml          (NEU)
 5. Unframer MCP getNodeXml(section)    (NEU)
 6. Style-Referenzen aus XML sammeln    (NEU — alle inlineTextStyle, backgroundColor-Pfade)
 7. Token-Mapping erstellen             (NEU — UUIDs mit Style-Pfaden matchen)
 8. Token-Mapping validieren            (NEU)
 9. Design System aufbauen              (NEU — Variables + Classes + Fonts)
10. resolve-fonts.js                    (bestehend, jetzt AKTIV mit @font-face)
11. convert-xml-to-v4.js                (bestehend, jetzt MIT Tokens + 9 Fixes)
12. framer-pre-build-validate.js        (NEU — 9 Checks, 85% Gate)
13. elementor-set-content               (bestehend)
14. Visual QA + Auto-Fix                (NEU — Screenshot-Vergleich + Patch)
```

### 6.2 Erfolgskriterien (erweitert)

Nach Abschluss ALLER Phasen:

1. ✅ Hintergrundfarben korrekt (aus CSS-Tokens, nicht verworfen)
2. ✅ Typografie korrekt (Font-Family, Größe, Gewicht, Farbe aus Token-Map)
3. ✅ Buttons mit vollständigem Styling (Background, Border-Radius, Padding)
4. ✅ Breakpoint `null` für Desktop-Variants
5. ✅ Border-Radius als 4-Ecken-Objekt
6. ✅ Global Variables via MD5-GV-IDs erstellt
7. ✅ Global Classes automatisch generiert
8. ✅ Fonts via @font-face lokal in WordPress gehostet
9. ✅ Responsive Breakpoints als Variants
10. ✅ Komponenten aus Unframer aufgelöst
11. ✅ Visual QA ≥85% Übereinstimmung
12. ✅ E2E-Test grün

---

## ZEITPLAN

| Phase | Beschreibung | Aufwand |
|-------|-------------|---------|
| **Phase 0** | Deep Research | ✅ ABGESCHLOSSEN |
| **Phase 1** | Quick-Wins (6 Fixes) + 10 Skills | 0.5 Tage |
| **Phase 2** | Dual-Source CSS-Extraktion + UUID-Mapping | 2 Tage |
| **Phase 3** | Design-System (MD5-GV-IDs + getrennte Outputs) | 2 Tage |
| **Phase 4** | convert-xml-to-v4.js Umbau (9 Änderungen) | 3 Tage |
| **Phase 5** | Build-Qualität (9-Punkte-Check) + Visual QA | 2 Tage |
| **Phase 6** | Wizard-Integration + E2E-Test | 3 Tage |
| **GESAMT** | | **~2.5 Wochen** |

---

## RISIKEN & OFFENE FRAGEN

| Risiko/Frage | Status |
|-------------|--------|
| UUID-Token → Style-Pfad Mapping unvollständig | 🔴 Heuristik kann Lücken haben — manuelles Mapping pro Projekt als Fallback |
| Akzeptiert V4 lokale `background-color`? | 🟡 MUSS GETESTET WERDEN vor Phase 1 |
| Akzeptiert V4 `border-radius` als 4-Ecken-Objekt? | 🟡 MUSS GETESTET WERDEN vor Phase 1 |
| FramerExport auf dieser Maschine verfügbar? | 🟡 MUSS GETESTET WERDEN vor Phase 2 |
| @font-face-URLs (framerusercontent.com) dauerhaft? | 🟡 Framer CDN könnte URLs ändern — lokal hosten |
| Unframer MCP Rate-Limits bei Komponenten-Rekursion | 🟢 Caching + max 3 Ebenen tief |

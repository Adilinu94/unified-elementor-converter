# 🔬 Deep Research: Elementor V4 Design-Verbesserungen (v2)

> **Erstellt:** 2026-06-12 | **Revision:** 2026-06-13 (Plan-Analyse integriert)
> **Scope:** framer-v4-pipeline-v2 + novamira-adrianv2 Plugin
> **Methode:** V4-Tree-Analyse (Post 4943), Web-Research (Elementor 4.x Features), Pipeline-Code-Audit, V4_DESIGN_SCHEMA_REPORT.md Queranalyse, Abgleich mit bestehenden Abilities

---

## 1. Zusammenfassung

Der Framer→Elementor V4 Pipeline (`framer-v4-pipeline-v2`) und das Novamira V2-Plugin (`novamira-adrianv2`) erzeugen funktionale V4-Seiten, nutzen aber nur **~25% der Design-Features von Elementor V4**. Die Analyse von Post 4943 (`framer-e2e-test-hero`) zeigt: 0% Global Class Nutzung, kein Grid, keine Components, keine Interaktionen, nur Desktop-Breakpoint, DOM-Tiefe 8.

**❗ Wichtigste Erkenntnis aus der Gegenprüfung:** 3 der 4 geplanten neuen Abilities (B1–B3) existieren bereits im `novamira-adrianv2` Plugin. Kein neues PHP nötig — nur Pipeline-Integration. Zusätzlich ist A4 kein neues Script, sondern ein Enhancement an `auto-scale-responsive.js`.

**15 konkrete Verbesserungen** → davon 3 als existierend identifiziert, 2 neu definiert, Sprint-Reihenfolge korrigiert.

---

## 2. Root-Cause: Das `#111111 × 45` Problem

### Das Symptom

Post 4943 enthält den Farbwert `#111111` 45-mal dupliziert — je einmal pro Element-Style-Block. Keine Global Variable, keine Global Class.

### Die Ursache (nicht: fehlende GC-Generierung)

Die Pipeline hat eine **Token-zu-GV-Mapping-Lücke**:

```
design-token-extractor.js  →  token-mapping.json
  extrahiert CSS Custom Properties, erkennt Farb-Hex-Werte,
  schlägt GV-Label vor. ABER: gv_id Felder bleiben null.
  ↓
  KEIN GV-SUBSTITUTIONS-PASS
  ↓
convert-xml-to-v4.js  →  v4-tree.json
  Schreibt Hardcoded #111111 in jedes Element.
  ↓
generate-global-classes.js
  Erkennt das Duplikat, erstellt GC. ABER: GC enthält
  immer noch #111111 — keine GV-Referenz.
```

**Der Fix (C6):** Ein neuer Substitutions-Pass nach `design-token-extractor.js` und vor `convert-xml-to-v4.js`, der:
1. `token-mapping.json` lädt
2. Für jeden Token mit `gv_id !== null` den CSS-Wert im Tree durch `e-gv-XXXXXXXX` ersetzt
3. Erst dann `generate-global-classes.js` laufen lässt — GCs referenzieren jetzt GVs statt Hardcoded-Hex

---

## 3. Ist-Zustand: Detaillierte Analyse

### 3.1 V4-Tree-Metriken (`v4-tree-final.json`, Post 4943)

```
Elemente gesamt:     121
Widget-Verteilung:   72× e-flexbox (59.5%)
                     46× e-heading  (38.0%)
                      3× e-image    (2.5%)
                      0× e-div-block (Grid)
                      0× e-component
                      0× e-button, e-paragraph, e-svg, e-divider

DOM-Tiefe (max):     8  (Soll: ≤3)
Global Classes:      0% (121/121 lokale Styles)
Responsive:          Nur "desktop" Breakpoint (0 tablet, 0 mobile)
Farben:              Hardcoded #rrggbb (keine Global Variables)
Animation:           0 Interaktionen
Formulare:           0
```

### 3.2 V4-Design-Defizite im Detail

#### 🔴 Kritisch

| Defizit | Auswirkung | Ursache |
|---------|-----------|---------|
| **DOM-Tiefe 8** | Server-Timeouts, Lighthouse-Abwertung, langsame Render-Zeit | Framer Canvas-Absolute-Positionierung wird 1:1 in verschachtelte Flexboxen übersetzt |
| **0% Global Classes** | 121 identische Style-Definitionen (45+ Duplikate). JSON 61% größer als nötig. CSS 98% größer. | GC-Generator existiert, wurde aber beim Build von Post 4943 nicht ausgeführt |
| **Keine Responsive Varianten** | Mobile View komplett broken (79px Schrift auf 375px Viewport) | `auto-scale-responsive.js` wurde nicht ausgeführt + nutzt Pauschalfaktoren statt Framer-Breakpoints |
| **Hardcoded Farben (#111111 × 45)** | Keine Wiederverwendbarkeit, keine Design-Token-Konsistenz | **Token-zu-GV-Substitutions-Pass fehlt** (Root-Cause, siehe §2) |

#### 🟡 Mittel

| Defizit | Auswirkung | Ursache |
|---------|-----------|---------|
| **Kein Grid (`e-div-block`)** | 72 Flexboxen statt ~20 Grid-Container. 2D-Layouts (Karten, Stats) als 1D-Flexbox-Reihen realisiert | RC-09 Grid-Erkennung existiert, aber Post 4943 wurde vor dem Fix gebaut |
| **Keine Components** | Jede Sektion ist einmalig. Keine Wiederverwendbarkeit. | Pipeline hat kein Component-Konzept |
| **Keine Interaktionen** | Statische Seite ohne Animation/Hover-Effekte | `framer-animation-extractor.js` existiert, aber nur GSAP-Output (nicht V4-nativ) |

#### 🟢 Niedrig

| Defizit | Auswirkung |
|---------|-----------|
| **Keine semantischen GC-Namen** | `gc-bg-1` statt `gc-surface-primary` |
| **auto-scale-responsive generisch** | Nutzt feste Faktoren (0.75/0.6) statt Framer-eigener Breakpoints |
| **Kein Atomic Forms Support** | Formulare in Framer werden ignoriert |

---

## 4. Elementor V4 Feature-Landschaft — Genutzt vs. Ungenutzt

### 4.1 Elementor V4 Architektur-Übersicht

| Schicht | V3 (alt) | V4 (neu) |
|---------|----------|----------|
| **Container** | Sections/Columns (div-itis) | Flexbox (`e-flexbox`) + Grid (`e-div-block`) |
| **Widgets** | 30+ monolithische Widgets | 6 Atomic Widgets (`e-heading`, `e-paragraph`, `e-button`, `e-image`, `e-svg`, `e-divider`) |
| **Styles** | Global Colors/Fonts, Inline-CSS | Global Variables (Design Tokens) + Global Classes (wiederverwendbare Style-Gruppen) |
| **Wiederverwendung** | Global Widgets (starr) | Atomic Components (synced, mit editierbaren Properties) |
| **Animation** | Entrance Animation (basic) | Pro Interactions (Scroll/Click/Hover-Trigger, Easing, Koordinaten-Transforms) |
| **Formulare** | Form Widget (monolithisch) | Atomic Forms (granular: Label, Input, Submit als Einzelelemente) |
| **Responsive** | Breakpoints (global) | Breakpoint-spezifische Varianten pro Style + Interaktionen |

### 4.2 Feature-Gap-Analyse

| V4 Feature | Pipeline-Status | Gap |
|------------|-----------------|-----|
| **Atomic Components** | ❌ Nicht implementiert | Kein `e-component` Support in convert-xml-to-v4.js |
| **Component Properties** | ❌ Nicht implementiert | Kein Property-System für editierbare Felder |
| **Atomic Forms** | ❌ Nicht implementiert | Formulare werden nicht erkannt |
| **Pro Interactions** | 🟡 Teilweise (nur GSAP) | `framer-animation-extractor.js` generiert externen JS-Code, keine nativen V4-Interaktionen |
| **Global Classes** | ✅ Generator vorhanden (`generate-global-classes.js`) | 0% Adoption bei Post 4943 (nicht ausgeführt) |
| **Global Variables** | 🟡 Token-Extraktor vorhanden | Mapping auf GV-IDs nicht automatisiert; **GV-Substitutions-Pass fehlt** |
| **Grid (`e-div-block`)** | 🟡 RC-09 Heuristik | Child-Count-basiert, kein echtes CSS-Grid-Parsing |
| **Responsive Breakpoints** | 🟡 `auto-scale-responsive.js` | Generische Faktoren (0.75/0.6), nicht Framer-Breakpoint-bewusst |
| **Motion Effects** | ❌ Nicht implementiert | `entrance_animation` Properties nicht gesetzt |
| **Loop Grid** | ❌ Nicht implementiert | Dynamische Listendarstellung nicht unterstützt |

---

## 5. Die 15 Verbesserungen — Vollständige Spezifikation

### 🆕 Kategorie A: Neue Pipeline-Scripts (3 Scripts)

> **⚠️ A4 entfernt:** `map-framer-breakpoints.js` war kein neues Script, sondern ein Enhancement an `auto-scale-responsive.js`. → Siehe C5.

---

#### A1. `extract-framer-components.js`

**Zweck:** Framer Component-Definitionen (Variants, Variables) in V4 Atomic Component JSON übersetzen.

**Input:** Framer HTML/XML einer Komponente (z.B. Card, Hero, Testimonial)
**Output:** `components/<name>.json` — V4 Component Blueprint

**Warum:** Post 4943 hat 72 Flexboxen, viele davon sind wiederholte Muster (2 Karten-Stacks, 5 Logo-Kacheln). Components reduzieren DOM-Tiefe, JSON-Größe und ermöglichen Client-Editing.

**Architektur:**

```javascript
// Erkennt wiederholte Framer-Component-Instanzen
function detectRepeatingComponents(framerXml) {
  // 1. Alle Framer-Component-Instanzen finden (name-Attribut-Muster)
  // 2. Wiederholte Instanzen gruppieren (>2 Vorkommen = Component-Kandidat)
  // 3. Component-Body extrahieren (eine Instanz als Template)
  // 4. Variable Felder identifizieren (Text, Image, Link)
  // 5. V4 Component JSON mit Properties generieren
}

// Output-Format:
{
  "name": "StatCard",
  "properties": {
    "name": { "type": "text", "default": "Name" },
    "metric": { "type": "text", "default": "+100%" },
    "category": { "type": "text", "default": "Revenue" },
    "timeframe": { "type": "text", "default": "In 7 weeks" }
  },
  "content": [ /* V4 Element-Tree */ ]
}
```

**npm-Script:** `"extract-components": "node scripts/extract-framer-components.js"`

**Integration mit bestehenden Abilities:** Der Output wird via `novamira-adrianv2/create-component` (existiert bereits) registriert. Kein neues PHP nötig.

---

#### A2. `extract-framer-interactions.js`

**Zweck:** Framer Scroll/Trigger-Animationen → V4 Pro Interactions (native JSON-Struktur, kein GSAP).

**Input:** Framer HTML (Animation-Attribute, CSS-Transitions, GSAP-Scripte)
**Output:** `interactions-plan.json` — V4-native Interaction-Definitionen

**Warum:** Aktuell generiert `framer-animation-extractor.js` GSAP-Code (`gsap.fromTo()`), der extern injected wird. Das ist fragil, performance-schädlich und nicht V4-nativ. V4 Pro Interactions sind reine JSON-Konfiguration — schneller, stabiler, ohne externe Abhängigkeiten.

**Architektur:**

```javascript
// Mapping: Framer Trigger → V4 Interaction
const TRIGGER_MAP = {
  'scroll-into-view': 'scroll',    // V4: scroll_animation
  'hover':            'mouse',      // V4: mouse_track
  'click':            'click',      // V4: click_action
  'page-load':        'entrance',   // V4: entrance_animation
};

// V4 Interaction JSON-Struktur:
{
  "interactions": [{
    "type": "scroll",
    "trigger": "scroll_into_view",
    "start_offset": { "type": "viewport", "value": "bottom" },
    "end_offset":   { "type": "viewport", "value": "top" },
    "effects": [{
      "type": "transform",
      "translateY": { "from": 100, "to": 0, "unit": "px" },
      "opacity":    { "from": 0, "to": 1 },
      "easing": "ease-out",
      "duration": 600
    }]
  }]
}
```

**Integration mit bestehenden Abilities:** Output wird an `novamira-adrianv2/edit-interaction` (existiert bereits) geroutet. → Siehe C3 für die Routing-Anpassung.

**npm-Script:** `"extract-interactions": "node scripts/extract-framer-interactions.js"`

---

#### A3. `extract-framer-forms.js`

**Zweck:** Framer Formulare (Input-Felder, Labels, Submit-Buttons) → V4 Atomic Forms.

**Input:** Framer HTML/XML mit Formular-Elementen
**Output:** `form-plan.json` — V4 Atomic Form Struktur

**Warum:** Elementor V4 hat Formulare fundamental neu gebaut: statt eines monolithischen Form-Widgets werden jetzt einzelne Atomelemente (`e-field-label`, `e-field-input`, `e-field-submit`) in einem Container kombiniert. Das gibt volle Kontrolle über Layout, Spacing und Styling.

**Architektur:**

```javascript
function detectFormElements(xmlNode) {
  // 1. Input-Felder erkennen (type, placeholder, name)
  // 2. Labels zuordnen (for-Attribut oder Geschwister-Text)
  // 3. Submit-Button identifizieren
  // 4. Form-Action bestimmen (action-Attribut oder Default: email)
}

// V4 Atomic Form Output:
{
  "form": {
    "action": "email",
    "fields": [
      {
        "type": "text",
        "label": "Name",
        "placeholder": "Your name",
        "required": true,
        "widgets": [
          { "widgetType": "e-field-label", /* ... */ },
          { "widgetType": "e-field-input", /* ... */ }
        ]
      }
    ],
    "submit": { "widgetType": "e-field-submit", /* ... */ }
  }
}
```

**Validierung:** `e-field-label`, `e-field-input`, `e-field-submit` Widget-Types müssen gegen `V4_DESIGN_SCHEMA_REPORT.md` und `schemas/v4-prop-type-schema.json` validiert werden.

---

### 🔌 Kategorie B: MCP-Abilities (1 neue Ability, 3 existierend)

> **⚠️ WICHTIG:** B1 (`create-component`), B2 (`assign-component-instance`), B3 (`inject-pro-interaction`) existieren **bereits** als `novamira-adrianv2/create-component`, `novamira-adrianv2/insert-component`, `novamira-adrianv2/edit-interaction`. Kein neues PHP nötig — nur Pipeline-Integration (Parameter-Mapping in A1/A2/C3).

---

#### B1–B3: Existierende Abilities — Pipeline-Integration

| Plan-Ability | Existiert als | Was zu tun ist |
|---|---|---|
| B1 `create-component` | `novamira-adrianv2/create-component` | A1-Output via McpBridge routen, Parameterformat validieren |
| B2 `assign-component-instance` | `novamira-adrianv2/insert-component` | Component-Overrides aus A1 in MCP-Call-Parameter mappen |
| B3 `inject-pro-interaction` | `novamira-adrianv2/edit-interaction` | C3-Output (V4-native Interactions) statt GSAP-Code routen |

---

#### B4. `novamira-adrianv2/create-atomic-form` ⭐ NEU

**Zweck:** Granulare V4 Atomic Form erstellen (Label + Input + Submit als Einzelelemente).

**Parameter:**

```json
{
  "post_id": 4943,
  "form": {
    "action": {
      "type": "email",
      "to": "hello@example.com",
      "subject": "New Contact Form"
    },
    "fields": [
      {
        "type": "text",
        "label": "Full Name",
        "placeholder": "Your name",
        "required": true
      },
      {
        "type": "email",
        "label": "Email Address",
        "placeholder": "you@example.com",
        "required": true
      }
    ],
    "submit_text": "Send Message"
  }
}
```

**Validierung:** Widget-Types (`e-field-label`, `e-field-input`, `e-field-submit`) gegen `V4_DESIGN_SCHEMA_REPORT.md` prüfen. Diese sind im Schema dokumentiert.

---

### 🛠 Kategorie C: Bestehende Scripts verbessern (6 Enhancements)

---

#### C1. `convert-xml-to-v4.js` — Component Preservation

**⚠️ Sprint-Abhängigkeit:** C1 braucht A1 (`extract-framer-components.js`), da `e-component` Marker erst nach der Component-Extraktion existieren. **C1 muss in Sprint 2 (nach A1) verschoben werden.**

**Problem:** `determineWidgetType()` mappt Framer-Component-Instanzen auf `e-flexbox`. Dadurch gehen Component-Informationen verloren und der Output ist flach.

**Lösung:** Component-Referenzen erkennen und als `e-component` Widget ausgeben:

```javascript
// In determineWidgetType():
if (attrs.componentId || attrs.componentName) {
  return 'e-component'; // Statt e-flexbox
}

// In buildStyleProps() für e-component:
if (widgetType === 'e-component') {
  props['component-id'] = wrapType('string', attrs.componentId);
  for (const [key, val] of Object.entries(attrs.componentOverrides || {})) {
    props[`property-${key}`] = wrapType('string', val);
  }
}
```

**Aufwand:** ~2h (nach A1 fertiggestellt)

---

#### C2. `convert-xml-to-v4.js` — Strict Grid Mapping (RC-09 Upgrade)

**Problem:** RC-09 erkennt Grid-Kandidaten anhand Child-Count (`>=2 Kinder + Namensmuster`). Das ist eine Heuristik, die false positives und false negatives produziert.

**Lösung:** Echtes CSS-Grid-Parsing aus Framer:

```javascript
function detectExplicitGrid(xmlNode, attrs) {
  // 1. Prüfe ob Framer CSS Grid verwendet
  if (attrs.display === 'grid') return true;

  // 2. Prüfe grid-template-* CSS-Properties
  if (attrs['grid-template-columns'] || attrs['grid-template-rows']) return true;

  // 3. Prüfe Compound-Layouts (2+ Spalten mit >3 Kindern)
  const children = (xmlNode?.children || []).filter(c => c.tagName);
  if (children.length >= 4) {
    const positions = children.map(c => c.attrs?.left || c.attrs?.x);
    const uniqueX = new Set(positions.filter(Boolean));
    if (uniqueX.size >= 2) return true;
  }

  return false;
}
```

**Aufwand:** ~1.5h

---

#### C3. `framer-animation-extractor.js` — V4-Native Routing (RC-20 Fix)

**⚠️ 80% bereits implementiert.** RC-20 in `framer-animation-extractor.js` generiert bereits `v4_interaction`-Objekte mit `type`, `animation`, `duration`. Zwei Probleme bleiben:

1. **Easing-Werte sind GSAP-Namen** (`"power2.out"`) statt Elementor-Namen (`"ease-out"`)
2. **Output wird an `inject-animation-code.js` → GSAP-Injection geroutet** statt an `novamira-adrianv2/edit-interaction`

**Lösung (1h, keine Neu-Architektur):**

```javascript
// 1. Easing-Map korrigieren:
function mapEasingToElementor(cssEasing) {
  const map = {
    'ease': 'ease', 'ease-in': 'ease-in', 'ease-out': 'ease-out',
    'ease-in-out': 'ease-in-out', 'linear': 'linear',
    'cubic-bezier(0.4, 0, 0.2, 1)': 'ease-out',
    'cubic-bezier(0, 0, 0.2, 1)': 'ease-out',
  };
  return map[cssEasing] || 'ease-out';
}

// 2. Route ändern: buildTransitionInteractions() output
//    → McpBridge.call('novamira-adrianv2/edit-interaction', ...)
//    statt generateGSAPInteractionCode() → inject-animation-code.js
```

---

#### C4. `generate-global-classes.js` — Semantic Naming

**Problem:** `suggestName()` generiert Namen wie `gc-bg-1`, `gc-text-2`. Das ist nicht aussagekräftig und erschwert Wartung.

**Lösung:** BEM/Semantic-Naming mit Design-Token-Bezug:

```javascript
function suggestNameSemantic(styleProps, tokenMap) {
  const parts = ['gc'];

  // 1. Typ-Präfix
  if (styleProps['font-size']) parts.push('text');
  else if (styleProps['background-color']) parts.push('surface');
  else if (styleProps['border-radius']) parts.push('rounded');
  else if (styleProps['gap'] || styleProps['padding']) parts.push('spacing');
  else parts.push('style');

  // 2. Semantic-Identifier aus Token-Map
  const color = styleProps['color'] || styleProps['background-color'];
  if (color) {
    const tokenName = tokenMap?.[color];
    if (tokenName) parts.push(tokenName.replace(/[^a-z0-9-]/g, '-').toLowerCase());
    else parts.push('neutral');
  }

  // 3. Size-Modifier
  if (styleProps['font-size']) {
    const px = getWrappedSizeNumber(styleProps['font-size']);
    if (px >= 48) parts.push('xl');
    else if (px >= 28) parts.push('lg');
    else if (px >= 18) parts.push('md');
    else parts.push('sm');
  }

  return parts.join('-'); // z.B. "gc-text-primary-lg"
}
```

**Aufwand:** ~1h

---

#### C5. `auto-scale-responsive.js` — Breakpoint-bewusstes Scaling ⭐ NEU (ersetzt A4)

**Warum kein neues Script:** `auto-scale-responsive.js` existiert bereits und läuft in Phase B des Wizards. Das Problem: Es nutzt Hardcode-Faktoren (`tablet: 0.75 / mobile: 0.6`) statt Framer-eigener Breakpoints.

**Problem-Code (aktuell):**
```javascript
const SCALE_FACTORS = {
  tablet: 0.75,
  mobile: 0.6,
};
```

**Lösung (~2h):**

```javascript
// Lies breakpoints.json (von extract-responsive-breakpoints.js)
import breakpointsData from '../tokens/responsive-breakpoints.json' assert { type: 'json' };

function getElementBreakpointFactors(elementId, baseProps) {
  // 1. Suche spezifische Framer-Breakpoint-Daten für dieses Element
  const elData = breakpointsData.elements?.[elementId];
  if (elData) {
    return {
      tablet: elData.tablet?.fontSize / baseProps.fontSize || 0.75,
      mobile: elData.mobile?.fontSize / baseProps.fontSize || 0.6,
    };
  }
  // 2. Fallback: Global Breakpoints
  return {
    tablet: breakpointsData.global?.tabletFactor || 0.75,
    mobile: breakpointsData.global?.mobileFactor || 0.6,
  };
}
```

**Aufwand:** ~2h, kein neues Script.

---

#### C6. Token-zu-GV-Substitutions-Pass ⭐ NEU (Root-Cause Fix)

**Zweck:** Die Token-zu-GV-Mapping-Lücke schließen (siehe §2 Root-Cause).

**Input:** `v4-tree.json` + `token-mapping.json`
**Output:** `v4-tree.json` mit GV-Referenzen statt Hardcoded-Hex

**Implementation — neuer Pass in `convert-xml-to-v4.js` oder eigenes Script:**

```javascript
function substituteTokensWithGvIds(tree, tokenMapping) {
  let substitutions = 0;

  walkTree(tree, (node) => {
    if (!node.styles) return;

    for (const styleId in node.styles) {
      const style = node.styles[styleId];
      for (const variant of (style.variants || [])) {
        for (const [prop, value] of Object.entries(variant.props || {})) {
          // Prüfe ob der Wert ein gemappter Token ist
          const hex = normalizeHex(value?.value);
          if (!hex) continue;

          // Suche in token-mapping.json
          for (const [tokenName, tokenData] of Object.entries(tokenMapping.colors || {})) {
            if (tokenData.hex === hex && tokenData.gv_id) {
              variant.props[prop] = {
                $$type: 'global_variable',
                value: tokenData.gv_id,
              };
              substitutions++;
              break;
            }
          }
        }
      }
    }
  });

  return { tree, substitutions };
}
```

**Aufwand:** ~2h. Dies ist der **wichtigste Einzel-Fix** — er adressiert die Root-Cause des `#111111 × 45` Problems.

---

### 📊 Kategorie D: Neue Validierungs-Checks (3 Checks)

---

#### D1. `COMPONENT_REUSE_POTENTIAL` (validate-v4-tree.js)

**Zweck:** Duplizierte Element-Gruppen erkennen, die als Component ausgelagert werden sollten.

**Logik:**

```javascript
function checkComponentReusePotential(tree) {
  const groups = findSiblingGroups(tree);
  const hashes = groups.map(g => hashStructure(g));
  const duplicates = hashes.filter((h, i) => hashes.indexOf(h) !== i);

  if (duplicates.length >= 2) {
    return {
      pass: false,
      severity: 'warning',
      message: `${duplicates.length} duplicate element groups — consider Atomic Components`,
    };
  }
  return { pass: true };
}
```

---

#### D2. `NATIVE_INTERACTION_COVERAGE` (validate-v4-tree.js)

**⚠️ Architektur-Fix:** `NATIVE_INTERACTION_COVERAGE` muss `animation-plan.json` lesen, aber `validate-v4-tree.js` operiert nur auf dem v4-tree. **Lösung:** `--animation-plan` Flag hinzufügen.

**Logik:**

```javascript
function checkNativeInteractionCoverage(tree, interactionsPlan) {
  const gsapAnimations = (interactionsPlan?.animations || [])
    .filter(a => a.type === 'gsap');

  const mappableToNative = gsapAnimations.filter(a => {
    return ['fade', 'slide-up', 'zoom', 'rotate'].includes(a.effect);
  });

  if (mappableToNative.length > 0) {
    return {
      pass: false,
      severity: 'warning',
      message: `${mappableToNative.length} GSAP animations could be V4-native interactions`,
      suggestion: 'Use C3 routing to edit-interaction',
    };
  }
  return { pass: true };
}
```

**CLI:** `node scripts/validate-v4-tree.js --tree v4-tree.json --animation-plan animation-plan.json`

---

#### D3. `GRID_VS_FLEXBOX_COVERAGE` (validate-v4-tree.js)

**Zweck:** `e-flexbox` Container mit Grid-Charakteristiken erkennen und `e-div-block` erzwingen.

**Logik:**

```javascript
function checkGridVsFlexboxCoverage(tree) {
  const issues = [];

  walkTree(tree, (node) => {
    if (node.widgetType !== 'e-flexbox') return;

    const styles = node.styles || {};
    const children = node.elements || [];

    // Check 1: flex-wrap: wrap → sollte Grid sein
    for (const style of Object.values(styles)) {
      for (const variant of style.variants || []) {
        if (variant.props?.['flex-wrap']?.value === 'wrap') {
          issues.push(`${node.id}: flex-wrap:wrap → use e-div-block with grid`);
        }
      }
    }

    // Check 2: >3 parallele Kinder → Grid-Kandidat
    if (children.length >= 4) {
      issues.push(`${node.id}: ${children.length} children → consider grid-template-columns`);
    }
  });

  return {
    pass: issues.length === 0,
    severity: issues.length > 0 ? 'warning' : undefined,
    message: issues.length > 0 ? `${issues.length} flexbox containers should be grid` : undefined,
    details: issues,
  };
}
```

---

## 6. Tests — Neue Test-Blöcke

> **⚠️ Der Original-Plan erwähnte 0 neue Tests.** Für die 6 Enhancements + 3 neuen Scripts + 3 neuen Validierungs-Checks sind folgende Test-Blöcke nötig:

| Test-Block | Testet | Datei |
|-----------|--------|-------|
| `DOM_DEPTH` | DOM-Tiefe-Check (bereits vorhanden) | `tests/pipeline.test.js` |
| `GRID_VS_FLEXBOX` | D3 — Grid-Erkennung | `tests/pipeline.test.js` |
| `COMPONENT_REUSE` | D1 — Duplikat-Erkennung | `tests/pipeline.test.js` |
| `NATIVE_INTERACTION` | D2 — GSAP→Native-Prüfung (+ `--animation-plan`) | `tests/pipeline.test.js` |
| `GC_POTENTIAL` | Style-Duplikate (bereits vorhanden) | `tests/pipeline.test.js` |
| `GV_SUBSTITUTION` | C6 — Token-zu-GV-Ersetzung | `tests/pipeline.test.js` |
| `BREAKPOINT_SCALING` | C5 — Breakpoint-spezifische Faktoren | `tests/pipeline.test.js` |
| `COMPONENT_EXTRACTION` | A1 — Component-Erkennung | `tests/pipeline.test.js` |
| `INTERACTION_EXTRACTION` | A2 — Interaction-Mapping | `tests/pipeline.test.js` |
| `FORM_EXTRACTION` | A3 — Formular-Erkennung | `tests/pipeline.test.js` |
| `EASING_MAP` | C3 — Easing-Korrektur (Elementor-Namen) | `tests/pipeline.test.js` |

**Ziel:** 49 → ≥60 Tests nach vollständiger Implementierung.

---

## 7. Erwarteter Qualitätssprung

| Metrik | Vorher (Post 4943) | Sprint 1 | Sprint 2 | Sprint 3 (Ziel) |
|--------|-------------------|----------|----------|-----------------|
| **DOM-Tiefe** | 8 | ≤6 | ≤4 | ≤3 |
| **Global Class %** | 0% | ≥60% | ≥80% | ≥90% |
| **GV-Substitution %** | 0% | ≥80% | ≥90% | ≥95% |
| **Responsive** | Desktop only | +Tablet (präzise) | +Mobile (präzise) | Breakpoint-perfekt |
| **Grid-Nutzung** | 0× e-div-block | ≥10% | ≥25% | ≥35% |
| **Components** | 0 | 0 | ≥5 | ≥10 |
| **Interaktionen** | 0 | 0 | V4-native | V4-native |
| **Semantic GCs** | `gc-bg-1` | `gc-surface-neutral` | BEM-Standard | BEM-Standard |
| **Formulare** | N/A | N/A | N/A | Atomic Forms |

---

## 8. Umsetzungs-Roadmap (korrigiert)

### Sprint 1 (diese Woche, ~5h) — Quick Wins + Root-Cause Fix

```
├── C2: convert-xml-to-v4.js — Strict Grid Mapping (RC-09 Upgrade)
├── C4: generate-global-classes.js — Semantic Naming
├── C5: auto-scale-responsive.js — Breakpoint-bewusstes Scaling (NEU, ersetzt A4)
├── C6: Token-zu-GV-Substitutions-Pass (NEU, Root-Cause Fix)
└── D3: GRID_VS_FLEXBOX_COVERAGE Validierungs-Check
```

**⚠️ C1 wurde VERSCHOBEN** (braucht A1 aus Sprint 2).

**Erwarteter Impact:** DOM-Tiefe 8→6, Grid ≥10%, GV-Substitution ≥80%, GCs mit lesbaren Namen, Breakpoint-präzises Responsive

### Sprint 2 (nächste Woche, ~8h) — Components & Interactions

```
├── A1: extract-framer-components.js (NEU)
├── A2: extract-framer-interactions.js (NEU)
├── C1: convert-xml-to-v4.js — Component Preservation (VERSCHOBEN von Sprint 1)
├── C3: framer-animation-extractor.js — V4-Native Routing (1h, kein Neuaufbau)
├── B1–B3: Pipeline-Integration existierender Abilities (kein neues PHP)
└── D1: COMPONENT_REUSE_POTENTIAL Validierungs-Check
```

**Erwarteter Impact:** Components ≥5, V4-native Interaktionen, Component-Potential-Erkennung

### Sprint 3 (übernächste Woche, ~8h) — Forms & Validierung

```
├── A3: extract-framer-forms.js (NEU)
├── B4: create-atomic-form Ability (NEU — PHP)
└── D2: NATIVE_INTERACTION_COVERAGE (mit --animation-plan Flag)
```

**Erwarteter Impact:** Atomic Forms, vollständige V4-Integration, Validierung geschlossen

---

## 9. Technische Abhängigkeiten

- **V4_DESIGN_SCHEMA_REPORT.md**: Definiert das V4 $$type-System und die Style-Architektur — Grundlage für alle Verbesserungen. B4 muss gegen das Schema validiert werden.
- **novamira-adrianv2/includes/abilities/elementor/**: Bestehende Elementor-Abilities (`create-component`, `insert-component`, `edit-interaction`), die in Sprint 2 integriert werden.
- **framer-v4-pipeline-v2/scripts/convert-xml-to-v4.js**: Zentrales Konvertierungsscript, das C1-, C2- und C6-Verbesserungen betrifft.
- **validate-v4-tree.js**: Validator, der alle Kategorie-D-Checks aufnimmt. D2 braucht `--animation-plan` Flag.
- **auto-scale-responsive.js**: C5-Enhancement — liest `tokens/responsive-breakpoints.json`.
- **design-token-extractor.js**: Erzeugt `token-mapping.json` — Basis für C6 GV-Substitution.

---

## 10. Zusammenfassung der Korrekturen

| Original-Plan | Problem | Korrektur |
|---|---|---|
| B1–B3 als neue Abilities | Existieren bereits im Plugin | Nur Pipeline-Integration (Sprint 2) |
| A4 als neues Script | Enhancement an existierendem Code | → C5 (Sprint 1) |
| C1 in Sprint 1 | Braucht A1 (Sprint 2) | → C1 nach Sprint 2 verschoben |
| C3 volle Neu-Architektur | 80% bereits implementiert | Nur Easing-Map + Routing-Fix (1h) |
| Kein GV-Substitutions-Pass | Root-Cause des #111111×45 Problems | → C6 (Sprint 1, Priorität!) |
| Keine Tests erwähnt | 12 neue Features, 0 Tests | 11 Test-Blöcke definiert |
| D2 ohne animation-plan Flag | Kann animation-plan.json nicht lesen | `--animation-plan` Flag hinzugefügt |

---

> **Erstellt basierend auf:** v4-tree-final.json (Post 4943), V4_DESIGN_SCHEMA_REPORT.md, Elementor 4.x Developer Docs, Pipeline-Code-Audit, BLUEPRINT.md, INTEGRATION-PLAN.md Ability-Liste, Plan-Analyse (2026-06-13)


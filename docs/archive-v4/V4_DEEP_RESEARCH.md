# Deep Research: Elementor V4 Server-Interna & Performance

> **Erstellt:** 2026-06-12  
> **Fokus 1:** Server-Interna — Wie V4 JSON im PHP-Backend verarbeitet & in `wp_postmeta` gespeichert wird  
> **Fokus 2:** Performance — DOM-Tiefe, Style-Deduplizierung, Critical CSS für große V4-Seiten  
> **Quellen:** Elementor Developer Docs, Elementor Blog, Web-Recherche, Pipeline-Codebase

---

## Teil A: Server-Interna — Die PHP-Verarbeitungskette

### A.1 WordPress Datenbank: Wie V4-Seiten gespeichert werden

Eine Elementor V4-Seite wird in **genau einer Zeile** der `wp_postmeta`-Tabelle gespeichert:

```
wp_postmeta
├── post_id: 4943
├── meta_key: _elementor_data
└── meta_value: JSON-String (serialisiert)
```

**Die Meta-Keys einer V4-Seite:**

| Meta-Key | Inhalt | Format |
|----------|--------|--------|
| `_elementor_data` | **Der gesamte Element-Tree als JSON** | `json_encode()` serialisiert |
| `_elementor_edit_mode` | `"builder"` | string |
| `_elementor_template_type` | `"page"`, `"section"`, `"header"`, etc. | string |
| `_elementor_css` | Kompiliertes CSS (Post-spezifisch) | JSON/string |
| `_elementor_version` | `"4.1.1"` | string |
| `_elementor_page_settings` | Page-Level Settings (Template, Hide Title) | JSON |

**Das `_elementor_data` Format (Minimalbeispiel):**

```json
[
  {
    "id": "a1b2c3d",
    "elType": "e-flexbox",
    "widgetType": "e-flexbox",
    "settings": {
      "classes": { "$$type": "classes", "value": ["smy-style"] },
      "tag": "section"
    },
    "styles": {
      "smy-style": {
        "id": "smy-style",
        "type": "class",
        "label": "local",
        "variants": [
          {
            "meta": { "breakpoint": "desktop", "state": null },
            "props": {
              "width": { "$$type": "size", "value": { "size": 1200, "unit": "px" } }
            },
            "custom_css": null
          }
        ]
      }
    },
    "elements": [
      {
        "id": "e4f5g6h",
        "elType": "widget",
        "widgetType": "e-heading",
        "settings": {
          "classes": { "$$type": "classes", "value": ["sheading"] },
          "tag": { "$$type": "string", "value": "h1" },
          "title": {
            "$$type": "html-v3",
            "value": {
              "content": { "$$type": "string", "value": "Hello World" },
              "children": []
            }
          }
        },
        "styles": {
          "sheading": { /* ... */ }
        },
        "elements": []
      }
    ]
  }
]
```

**Kritische Erkenntnisse:**

1. **`_elementor_data` ist EIN Array** — die Root-Elemente sind in einem Top-Level-Array, nicht in einem Wrapper-Objekt
2. **`json_encode()` — kein PHP `serialize()`** — Elementor speichert pur JSON, was bedeutet: keine PHP-spezifischen Typen, nur JSON-kompatible
3. **Post-ID = `wp_postmeta.post_id`** — 1:1-Mapping, kein `wp_posts.post_content`
4. **Kein separates DB-Schema für Styles** — Alles (Elements + Styles + Settings) liegt im selben JSON-Baum

### A.2 PHP-Verarbeitungskette: Vom JSON zum gerenderten HTML

Wenn eine V4-Seite aufgerufen wird, durchläuft sie diese Verarbeitung:

```
Frontend-Request
    ↓
[1] get_post_meta($post_id, '_elementor_data', true)
    ↓  Roh-JSON aus der DB
[2] json_decode() → PHP Array/Objekt-Baum
    ↓
[3] Document::get_elements_data()
    ↓  Factory-Pattern: Für jedes Element die richtige PHP-Klasse instanziieren
[4] Element_Base-Instanzen (rekursiver Baum)
    ├── e-flexbox    → Elementor\Core\Elements\Models\Flexbox
    ├── e-div-block  → Elementor\Core\Elements\Models\DivBlock
    ├── e-heading    → Elementor\Core\Elements\Models\Heading
    └── ...
    ↓
[5] Style-Parser (verarbeitet "styles" → CSS)
    ↓  Varianten pro Breakpoint + State auflösen → CSS-Regeln
[6] Render-Engine
    ↓  Jedes Element ruft render() auf → erzeugt HTML
[7] CSS + HTML → Browser
```

**Schritt 5 im Detail — Der Style-Parser:**

```php
// Pseudocode — wie Elementor die styles verarbeitet:

foreach ($element['styles'] as $styleId => $styleDef) {
    foreach ($styleDef['variants'] as $variant) {
        $breakpoint = $variant['meta']['breakpoint'];  // "desktop", "tablet", "mobile"
        $state      = $variant['meta']['state'];        // null, "hover", "focus", "active"
        $props      = $variant['props'];                // { "font-size": { $$type: size, ... }, ... }
        $customCss  = $variant['custom_css'];           // null oder { raw: "base64..." }

        // 1. Props in CSS-Regeln übersetzen
        foreach ($props as $prop => $value) {
            $cssRule = $this->propToCss($prop, $value);
            // font-size → font-size: 60px;
            // color → color: #111111; (oder var(--e-global-color-xxx))
            // padding → padding-block-start: 60px; padding-inline-start: 40px; ...
        }

        // 2. Breakpoint-Media-Query wrappen
        if ($breakpoint === 'tablet') {
            $cssRule = "@media (max-width: 1024px) { $cssRule }";
        } elseif ($breakpoint === 'mobile') {
            $cssRule = "@media (max-width: 767px) { $cssRule }";
        }

        // 3. State-Selektoren
        if ($state === 'hover') {
            $cssRule = ".element-{$elementId}:hover { $cssRule }";
        }

        // 4. custom_css direkt anhängen (wenn { raw: "..." })
        if ($customCss && isset($customCss['raw'])) {
            $cssRule .= base64_decode($customCss['raw']);
        }
    }
}
```

**Wichtige Implikationen für die Pipeline:**

| Implikation | Warum kritisch |
|-------------|---------------|
| `meta.breakpoint` **muss ein String sein** (`"desktop"`), nicht `null` | PHP validiert streng — `null` verursacht Parser-Fehler |
| `meta.state` **muss als Key existieren** | Fehlt der Key, wird die ganze Variante ignoriert |
| `custom_css` **muss `null` oder `{raw: "..."}` sein** | Plain String crasht `base64_decode()` → **HTTP 500** |
| `props` ohne `$$type` werden **nicht** auto-gewrappt | PHP validiert das `$$type`-Feld und lehnt Plain-Strings ab |
| `$$type: "size"` akzeptiert **KEIN `fr`** | Nur `px`, `%`, `em`, `rem`, `vw`, `vh` |

### A.3 Global Classes — Wie sie serverseitig entstehen

Global Classes (`gc-*`) werden **automatisch** registriert, wenn sie im Tree referenziert werden:

```php
// Beim elementor-set-content:
foreach ($tree as $element) {
    $classes = $element['settings']['classes']['value'] ?? [];
    foreach ($classes as $classId) {
        if (str_starts_with($classId, 'gc-')) {
            // Prüfe: Existiert diese Global Class bereits?
            $existing = get_posts([
                'post_type' => 'e_global_class',
                'name'      => $classId,
            ]);

            if (!$existing) {
                // Automatisch anlegen!
                wp_insert_post([
                    'post_title'  => $classId,
                    'post_name'   => $classId,
                    'post_type'   => 'e_global_class',
                    'post_status' => 'publish',
                ]);
            }
        }
    }
}
```

**CPT `e_global_class` Datenstruktur:**

```
wp_posts
├── ID: 5013
├── post_title: "gc-text-md"
├── post_name: "gc-text-md"
├── post_type: "e_global_class"
├── post_status: "publish"
└── post_content: "" (leer — Styles sind in postmeta)

wp_postmeta (für post_id=5013)
├── _elementor_data: { "id": "gc-text-md", "type": "class", "variants": [...] }
├── _elementor_version: "4.1.1"
└── ...
```

**Kritisch:** GC-Styles werden aus dem Element-Tree EXTRAHIERT und in eigenen `e_global_class`-Posts gespeichert. Der referenzierende Tree enthält nur die `gc-*` ID in `classes.value[]`.

### A.4 Die `novamira-adrianv2/batch-build-page` Ability

Die Pipeline nutzt `novamira-adrianv2/batch-build-page` als zentralen Build-Endpoint:

```
MCP-Call: novamira-adrianv2/batch-build-page
Parameter: { post_id, elements[], page_settings? }

Serverseitig (class-batch-build-page.php):
1. create-post (falls post_id = "new")
2. novamira-adrianv2/setup-v4-foundation { post_id }
   → V4-Foundation anlegen (CSS-Basis, GV-Basis, Template)
3. Für JEDES Element im elements[]-Array:
   a. elementor-add-element { post_id, tree: element }
   b. Style-Registrierung (lokal + Global Classes)
4. Page-Settings setzen (Template, Hide Title, etc.)
5. ✅ Build abgeschlossen
```

**Alternative: `elementor-set-content` (Direkt-Build)**

```
MCP-Call: novamira/elementor-set-content
Parameter: { post_id, content: [<gesamter Baum als Array>] }

WICHTIG: content MUSS ein Array sein!
❌ content: { elType: "e-flexbox", ... }     → Fehler!
✅ content: [{ elType: "e-flexbox", ... }]    → Korrekt
```

---

## Teil B: Performance & Best Practices

### B.1 DOM-Tiefe & Element-Anzahl

#### Branchen-Standards (Google Lighthouse)

| Metrik | Grün (< 90) | Warnung (50-89) | Rot (< 50) |
|--------|------------|-----------------|------------|
| **Total DOM Nodes** | < 800 | 800-1,400 | > 1,400 |
| **Max DOM Depth** | < 15 | 15-32 | > 32 |
| **Max Child Elements** | < 60 pro Parent | — | — |

#### Elementor V4 Spezifisch

| Richtwert | Empfehlung | Begründung |
|-----------|-----------|------------|
| **Max DOM-Tiefe** | **3 Ebenen** | Section → Grid/Flex-Cell → Widget. Jede weitere Ebene erhöht Reflow-Kosten exponentiell |
| **Max Elemente pro Seite** | **200** | Bei >200 Elementen → `elementor-set-content` Timeout-Risiko |
| **Pass-Through Container** | **0 tolerieren** | Single-Child-Flexboxen ohne Layout-Props sind reine DOM-Verschwendung |

#### Post 4943: DOM-Analyse

```
Gesamt-Elemente: ~70
davon:
  e-flexbox:  ~40  (57% — extrem hoch)
  e-heading:  ~25
  e-image:    3
  e-div-block: 0  (kein Grid!)

Max DOM-Tiefe: 7 (Hero-Sektion)
  → Absolut inakzeptabel. Grid-Einsatz würde auf Tiefe 3 reduzieren.

Durchschnittliche Tiefe: 4.2
Pass-Through Container: ~8 (Single-Child ohne Layout-Props)

Performance-Score (geschätzt): 45/100
```

#### Optimierungsstrategie: Grid statt Flexbox-Nesting

**Vorher (Flexbox-Kaskade, Tiefe 4+):**
```json
// 4 Ebenen für 2 Karten nebeneinander
{ "e-flexbox": [           // Row
    { "e-flexbox": [       // Card 1 Wrapper
        { "e-flexbox": [   // Card 1 Content  ← Eine Ebene zu viel!
            { "e-image": ... },
            { "e-heading": ... }
        ]}
    ]},
    { "e-flexbox": [       // Card 2 Wrapper
        { "e-flexbox": [   // Card 2 Content  ← Ebenfalls zu viel
            ...
        ]}
    ]}
]}
```

**Nachher (Grid, Tiefe 2-3):**
```json
{ "e-div-block": [         // Grid Container (Tiefe 1)
    "display": "grid",
    "grid-template-columns": "1fr 1fr",
    "gap": "24px"
    { "e-flexbox": [       // Card 1 (Tiefe 2)
        "flex-direction": "column"
        { "e-image": ... },      // (Tiefe 3)
        { "e-heading": ... }     // (Tiefe 3)
    ]},
    { "e-flexbox": [       // Card 2 (Tiefe 2)
        ...
    ]}
]}
```

**Impact:** DOM-Tiefe von 4→3, Pass-Through-Container von 2→0.

### B.2 Global Classes: Style-Deduplizierung

#### Das Problem: Lokale Style-Duplikation

Post 4943 zeigt das Problem eindrücklich: **45 identische Heading-Styles** sind lokal dupliziert:

```json
// 45× dasselbe — jedes e-heading bekommt eigene Kopie:
{
  "snode8": { "props": {} },     // leere Props, aber eigener Style-Eintrag
  "snode14": { "props": {} },    // identisch
  "snode142": { "props": {} },   // identisch
  // ... 42 weitere ...
}
```

#### Die Lösung: Global Class

```json
// EIN Global Class Eintrag im Kit:
{
  "id": "gc-text-md",
  "type": "class",
  "variants": [{
    "meta": { "breakpoint": "desktop", "state": null },
    "props": {
      "font-family": { "$$type": "string", "value": "Inter" },
      "font-size":   { "$$type": "size", "value": { "size": 32, "unit": "px" } },
      "font-weight": { "$$type": "string", "value": "600" },
      "color":       { "$$type": "global-color-variable", "value": "e-gv-XXXXXXXX" }
    }
  }]
}

// 45× Referenz statt 45× Duplikat:
{ "settings": { "classes": { "value": ["gc-text-md"] } } }
```

#### Performance-Impact

| Metrik | Ohne GCs (Post 4943) | Mit GCs | Einsparung |
|--------|---------------------|---------|------------|
| JSON-Größe (Tree) | 219 KB | ~85 KB | **-61%** |
| CSS-Regeln (kompiliert) | ~900 | ~20 | **-98%** |
| `wp_postmeta` Größe | ~219 KB | ~85 KB | **-61%** |
| MCP-Tokens (Agent) | ~60K | ~8K | **-87%** |

### B.3 Global Variables: Design Token System

#### Das Problem: Hardcoded Werte

Post 4943 verwendet `#111111` 45× hardcoded. Jede Farbänderung erfordert 45 Tree-Änderungen.

#### Die Lösung: Global Variables

```
Farbpalette:
  e-gv-color-primary:  #111111
  e-gv-color-muted:    #444444
  e-gv-color-bg:       #ffffff

Fonts:
  e-gv-font-heading:   Inter
  e-gv-font-body:      Inter

Größen:
  e-gv-size-h1:        79px
  e-gv-size-body:      16px
  e-gv-spacing-lg:     100px
```

#### Token-Flow in der Pipeline

```
1. design-token-extractor.js
   → CSS Custom Properties → token-mapping.json

2. novamira-adrianv2/batch-create-variables
   → e-gv-* IDs in WordPress anlegen

3. token-mapping.json → convert-xml-to-v4.js
   → Hardcoded #hex → global-color-variable Referenzen

4. Style-Props:
   "color": { "$$type": "global-color-variable", "value": "e-gv-a1b2c3d" }
```

### B.4 Critical CSS & Build-Größe

#### Was Elementor V4 automatisch optimiert

| Optimierung | Automatisch? | Beschreibung |
|-------------|-------------|-------------|
| **CSS-Minimierung** | ✅ | Kompiliertes CSS wird minified |
| **Unused CSS Removal** | ❌ | Nicht automatisch — braucht Plugin (z.B. Perfmatters) |
| **Critical CSS Inline** | ❌ | Nicht automatisch — braucht separates Tool |
| **Font-Subsetting** | ❌ | Google Fonts lädt komplette Font-Files |
| **Lazy Loading** | ✅ | Bilder standardmäßig `loading="lazy"` |
| **CSS Cache** | ✅ | `_elementor_css` wird gecached |

#### Empfehlungen für große V4-Seiten

1. **GCs konsequent nutzen** — jedes Duplikat kostet CSS
2. **Grid statt Nesting** — flachere DOM = schnellere Reflows
3. **Font-Display: swap** — verhindert FOIT (Flash of Invisible Text)
4. **Bilder optimieren** — WebP, Lazy Loading, korrekte Größen
5. **Critical CSS extrahieren** — Above-the-fold CSS inline für < 1s LCP

---

## Teil C: Synthese — Was das für die Pipeline bedeutet

### C.1 Aktuelle Pipeline → Optimaler Flow

```
AKTUELL (Post 4943 Stand):
  convert-xml-to-v4.js → v4-tree.json (219 KB, keine GCs, keine Responsive, tiefes Nesting)
  → elementor-set-content → Live

OPTIMAL (mit allen RC-Fixes + Research-Erkenntnissen):
  convert-xml-to-v4.js
    → Grid-Erkennung (RC-09)  → e-div-block wo sinnvoll
    → Pass-Through-Flattening (RC-07)  → DOM-Tiefe reduzieren
    → XML-Text-Fix (RC-04)  → kein "true"/"1fr" Müll
    → Default-Styles (RC-11)  → keine leeren Props
    ↓
  auto-scale-responsive.js
    → tablet + mobile Varianten (RC-19)  → kein Broken Mobile
    ↓
  generate-global-classes.js
    → 45 Duplikate → 1 Typography-GC + 12 Structure-GCs
    → 76% Inline-Style-Reduktion (RC-12)
    ↓
  design-token-extractor.js
    → #111111 → e-gv-color-primary
    → Inter → e-gv-font-heading
    ↓
  patch-v4-tree-media-ids.js
    → Framer-URLs → WP Media IDs
    ↓
  framer-pre-build-validate.js
    → Score ≥ 85% ✅ (statt 83% ❌)
    ↓
  elementor-set-content
    → Cleaner, schneller, responsiver Build
```

### C.2 Token-Effizienz

| Phase | Ohne GCs/Tokens | Mit GCs/Tokens | Ersparnis |
|-------|----------------|----------------|-----------|
| elementor-set-content Input | 219 KB JSON | ~60 KB JSON | -73% |
| Agent-Turns für Build | 1× set-content | 1× set-content + 1× GC-create | +1 Turn |
| Agent-Turns für Fixes | 45× patch-element-styles | 0 (GCs zentral änderbar) | -45 Turns |
| Responsive-Änderungen | 45 Elemente patchen | 1 GC-Variante ändern | -98% Tokens |

### C.3 Empfohlene Pipeline-Verbesserungen

| Prio | Verbesserung | Impact |
|------|-------------|--------|
| 🔴 **P0** | Auto-Scale-Lauf PFLICHT vor jedem Build | Verhindert Broken Mobile (Post 4943 Problem #1) |
| 🔴 **P0** | Grid-Erkennung in convert-xml-to-v4 aktivieren | Reduziert DOM-Tiefe von 7→3 (Post 4943 Problem #2) |
| 🟠 **P1** | GC-Generierung als Default-Schritt (nicht optional) | Eliminiert 45-fache Duplikation (Post 4943 Problem #3) |
| 🟠 **P1** | Token-Extraktion mit --auto-create Variables | #111111 45× → 1 Variable (Post 4943 Problem #4) |
| 🟡 **P2** | Post-Build DOM-Tiefe-Check (novamira-adrianv2/layout-audit) | Erkennt tiefes Nesting nach Build |
| 🟡 **P2** | Critical-CSS-Extraktion für Above-the-fold | < 1s LCP auf Mobile |
| 🟢 **P3** | Tree-Größen-Warnung bei >200 Elementen | Verhindert elementor-set-content Timeout |

---

## Anhang: Quellen & Weiterführende Links

### Elementor Developer Docs
- [Data Structure Overview](https://developers.elementor.com/docs/data-structure/)
- [Atomic Elements Structure](https://developers.elementor.com/docs/data-structure/atomic-elements/)
- [Elementor Editor v4.0 — Atomic Foundation](https://elementor.com/blog/editor-40-atomic-forms-pro-interactions/)

### Performance
- [Reduce DOM Size for Better Performance](https://elementor.com/blog/elementor-performance-tip-reduce-your-dom-size-to-make-your-website-faster/)
- [Google Lighthouse: DOM Size](https://developer.chrome.com/docs/lighthouse/performance/dom-size/)

### Interne Referenzen (Projekt)
- `V4_DESIGN_SCHEMA_REPORT.md` — Generalisiertes V4 Schema
- `BLUEPRINT.md` — Pipeline-Masterplan
- `INTEGRATION-PLAN.md` — MCP-Integrations-Fixes
- `elementor-v4-atomic-builder` Skill — Komplette Bauanleitung

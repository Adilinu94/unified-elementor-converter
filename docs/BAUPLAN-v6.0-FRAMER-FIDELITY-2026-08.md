# BAUPLAN v6.0 — Framer→Elementor Fidelity Engine

> **Status:** verbindlicher Umbauplan. Ersetzt die Annahme, der `--url`-Pfad sei funktionsfähig.
> **Datum:** 2026-08-23
> **Ausgelöst durch:** Realer Konvertierungsversuch `original-tables-638990.framer.app` → Post 5101 auf `testseite.nick-webdesign.de`. Ergebnis: 1 Sektion, 0 Widgets, keine Styles, keine Animationen. Manueller Rebuild war nötig.
> **Zielbild:** Beliebige Framer-Seite → editierbare Elementor-V3-Seite. **Native Elementor-Settings zuerst.** WPCode nur für nachweislich nicht-native Anteile. Animationen so weit wie möglich native (`_animation`, `motion_fx_*`, `sticky`).
> **Vorher:** [`BAUPLAN-v5.0`](./BAUPLAN-v5.0-KONVERGENZ-NOVAMIRA-WIZARDS-2026-07.md) (Phasen 100–115, abgeschlossen), [`REPOSITORY-CHARTA.md`](./REPOSITORY-CHARTA.md) (Zielvertrag, gültig)

---

## 0. Executive Summary

Der Konverter erzeugt für Live-URLs strukturell **immer** ein leeres Ergebnis. Das ist **kein einzelner Bug**, sondern eine Kette von **neun unabhängigen Abbrüchen** zwischen Extraktion und Emitter. Jeder einzelne Abbruch genügt, um das Endergebnis zu leeren; sie greifen kumulativ.

Der wichtigste Befund ist nicht die Bugliste, sondern eine architektonische Lücke:

> **Der Vertrag für ein styles- und texttragendes Zwischenmodell existiert** (`packages/core/src/contracts/visual-ir.contract.ts:126-173`, `VisualPageIR`).
> **Der Konsument existiert** (`packages/target-v3/src/visual-ir-to-v3.ts` — der beste der drei V3-Emitter).
> **Es gibt keinen Producer.**

Die Pipeline nutzt stattdessen zwei unabhängige, per String-Selektor lose verbundene Datenstrukturen (`SectionInfo` = nur Selektor + y-Range, `ComputedStyleSnapshot[]` = flacher Style-Array ohne Text und ohne Parent-Pfad). Die Verbindung ist ein String-Vergleich, der bei Mehrklassen-DOMs — also bei jeder Framer-Seite — **nicht funktionieren kann**.

Sekundär, aber ebenfalls strukturell:

- **Vier konkurrierende CSS→Setting-Tabellen** mit widersprüchlichem `color`-Handling.
- **Zwei verschiedene Breakpoint-Konventionen**, davon eine falsch (Präfix statt Suffix), und ein Guard, der die falsche Form nicht erkennt.
- **Drei V3-Emitter** unterschiedlicher Qualität — der URL-Pfad benutzt den ärmsten.
- **Keine Schema-Verifikation vor dem Deploy**, obwohl der Server sie per Ability anbietet. Deshalb schlagen Deploys mit „110 unknown keys" fehl, statt dass der Build den Fehler meldet.
- **Elementor-native Entrance-Animationen werden von keinem Emitter geschrieben** — obwohl `setting-first-policy.ts` „native zuerst" als Prinzip formuliert.

Sieben Arbeitspakete (P0–P6) beheben das. **P0 ist der Hebel**: Ein VisualIR-Producer entschärft sechs der neun Abbrüche auf einen Schlag, weil der Konsument bereits gebaut und getestet ist.

**Realistische Zielmarke** (Marktkalibrierung, kommerzielle Referenz `aitoelementor.com`): ~84 % native Widget-Quote, ~95 % Pixel-Fidelity. 100 % native ist explizit **nicht** das Ziel.

---

## 1. Beweislage — Der reale Fehlfall

### 1.1 Was gemessen wurde

| Kennzahl | Original (Framer, live) | Repo-Pipeline `--url` | Manueller Rebuild |
|---|---|---|---|
| Seitenhöhe | 7534 px | — (keine Seite gebaut) | 6666 px (88 %) |
| Top-Level-Sektionen | 9 `<section>` | **1** | 9 |
| `data-framer-name`-Marker | 696 | **0 gelesen** | 50 gruppiert genutzt |
| Widgets | ~264 äquivalent | **0** | 132 |
| Design-Tokens | 10 `--token-*` + 4 Fontfamilien | **0** | 6 Farben + 2 Fonts (hart) |
| Bilder | 23 (`/assets/img` + framerusercontent) | 23 heruntergeladen, **0 im Tree** | 68 in Mediathek, 10 im Tree |
| Animationen | Framer Motion (Scroll, Reveal, Before/After) | **0 Snippets** | 0 |
| Baumgröße | — | 309 Bytes | 35,7 KB |

**Kommando und Ergebnis:**

```text
$ elconv convert --target v3 --url https://original-tables-638990.framer.app/ ...
Guards passed: 100/100
✓ V3 tree written (496 bytes)
```

Der Guard-Score von 100/100 bei einem 496-Byte-Tree ist der schärfste Einzelbefund dieses Dokuments: **die Guards messen Struktur, nicht Substanz.** Ein leerer Baum ist strukturell perfekt.

`conversion-report.json` bestätigt:
```json
"summary": { "sectionCount": 1, "widgetCount": 0, "classCount": 0 }
"summary": { "images": 23, "fonts": 5, "svgs": 59 }   ← Assets DA, aber nie im Tree
"summary": { "snippetCount": 0, "hasAnimations": false }
```

### 1.2 Der Deploy-Fehler beim manuellen Rebuild (Beweis für fehlendes Schema-Gate)

Erster Versuch mit plausibel benannten Settings:

```text
Deploy failed: Tree validation failed: 110 unknown key(s).
unknown_key widget="__container__" key="gap"
unknown_key widget="__container__" key="align_items"
unknown_key widget="heading"       key="text_color"
unknown_key widget="button"        key="text_color"
unknown_key widget="__container__" key="box_shadow"
```

Der Server liefert dabei **das vollständige Schema inline in der Fehlermeldung** zurück. Diese Information ist beschaffbar — der Build fragt sie nur nie ab.

---

## 2. Die Ursachenkette — neun Abbrüche, verifiziert

Pfad: `elconv convert --target v3 --url <framer>` → `cmd-convert.ts:97` → `analysis/pipeline.ts`

### Abbruch 1 — Section-Detector sieht Framer-Sektionen nicht

`packages/extractors/src/browser/section-detector.ts:28-34`

```ts
const SECTION_SELECTORS = [
  'section[id]', 'section[class*="section"]', '[data-section]',
  '[role="region"]', 'article', 'aside',
  'header[role="banner"]', 'footer[role="contentinfo"]',
  'main[role="main"]', 'nav[role="navigation"]',
  'header', 'footer', 'main', 'nav',
].join(', ');
```

Drei Gründe für „1 Sektion":

1. **`section` allein fehlt.** Nur `section[id]` und `section[class*="section"]`. Framer emittiert `<section class="framer-1a2b3c">` — kein `id`, und `framer-…` enthält nicht den Substring `section`. Die 9 `<section>`-Tags werden **komplett übersprungen**.
2. **`[data-framer-name]` steht nicht im Selektor.** 696 Marker sind unsichtbar.
3. Übrig bleibt genau ein Treffer aus `header|footer|main|nav|article|aside` mit ≥ 200 px Höhe (`:41`, `:56`).

**Verwandter Befund:** `browser/framer-data-extractor.ts:80` liest `data-framer-name` bereits korrekt und `:104-112` liest `<script id="__framer__breakpoints">` mit `{hash, mediaQuery}`. **Kein Aufrufer** — nur `export *` in `extractors/src/index.ts:23`.

**Verwandter Befund 2:** Der Merger ist toter Code. `extract-pipeline.ts:146-147` lässt `backgroundColor` bewusst leer, wodurch Regel (b) in `areMergeable()` (`section-detector.ts:110-117`) nie greift.

### Abbruch 2 — Computed Styles werden bei Live-URLs nie erhoben

`packages/extractors/src/browser/playwright-extractor.ts:103-107, 124`

```ts
if (options.detectResponsiveStyles) {
  computedStyles[vp.label] = await walkComputedStyles(page, {...});
}
// :124
computedStyles: options.detectResponsiveStyles ? computedStyles : undefined,
```

`detectResponsiveStyles` wird im gesamten `packages/`-Baum **von keinem CLI gesetzt**. Nur:
- `scripts/smoke-sprint2c.ts:30`, `smoke-sprint3.ts:30`, `smoke-sprint4.ts:41` → `true`
- `tests/integration/browser-extraction.test.ts:32` → `false`

Nicht gesetzt in: `cmd-convert.ts`, `cmd-wizard.ts:970-986`, `analysis/pipeline.ts:259-275`.

Folge in `analysis/pipeline.ts:351`:
```ts
computedStyles: extraction!.computedStyles ?? { desktop: [] },
```

Die Extraktion selbst (`computed-styles.ts:7-25`, `CURATED_PROPERTIES`) ist **vollständig und korrekt** — 60+ Properties inkl. `background-color`, `padding-*`, `font-size`, `font-family`, `color`, `gap`, `flex-direction`, `border-*-radius`, `box-shadow`. Sie wird nur nie aufgerufen.

### Abbruch 3 — Selektor-Formate sind strukturell inkompatibel

`packages/target-v3/src/classifier/section-picker.ts:69-72`

```ts
const allSnapshots = input.computedStyles.desktop ?? [];
const scoped = allSnapshots.filter(
  (s) => s.selector === section.selector || s.selector.startsWith(`${section.selector} >`),
);
```

| Quelle | Zeile | Format | Beispiel |
|---|---|---|---|
| `section-detector` | `section-detector.ts:62` | `tag` + `#id` **oder** `.` + **erste** Klasse | `section.framer-1a2b` |
| `computed-styles` | `computed-styles.ts:80-84` | `tag` + `#id` + `.` + **erste zwei** Klassen | `section.framer-1a2b.framer-9x8y` |

- **Gleichheit** scheitert, sobald ein Element mehr als eine Klasse hat — bei Framer immer.
- **`startsWith(sel + ' >')`** kann **nie** matchen: `walkComputedStyles` erzeugt niemals ein `>` (`:84` ist ein flacher `tag#id.cls`-String, **kein Pfad**). Es gibt keine Parent-Beziehung im Snapshot.

### Abbruch 4 — Section-Settings und Widgets bleiben leer

`section-picker.ts:228-229`

```ts
const sectionSnap = snapshots.find((s) => s.selector === section.selector);
const children = snapshots.filter((s) => s.selector.startsWith(`${section.selector} >`));
```

Folge (`:235`): `v3_section.settings = {}`, `columns = [{ width: '100%', widgets: [] }]`.

### Abbruch 5 — Text wird nirgends extrahiert

`packages/core/src/contracts/shared.contract.ts:26-30`

```ts
export interface ComputedStyleSnapshot {
  selector: string;
  tag: string;
  styles: Record<string, string>;
}
```

**Kein `text`-Feld.** `computed-styles.ts` capturet keinen `textContent`. Folge in `section-picker.ts:301`:

```ts
const widget = mapElementsToWidgets([{ tag: snap.tag, selector: snap.selector, styles: snap.styles }])[0];
```

`content` wird nicht übergeben, weil es nicht existiert. `widget-mapper.ts:176` setzt `title: ''`, `:196` setzt `editor: ''`. **Selbst bei funktionierendem Scoping wären alle Widgets textlos.**

### Abbruch 6 — Mehrspaltigkeit wird beim Bauen plattgemacht

`packages/target-v3/src/builder.ts:464-498` (`buildSectionV1`), Zeile `:471`:

```ts
const widgets = section.columns.flatMap((c) => c.widgets);   // ← Spalten verworfen
return {
  elType: 'section',
  settings: applySettings({
    content_width: { size: 1200, unit: 'px' },
    gap: 'no',
    _css_classes: animationClass,       // ← Control heißt css_classes
    custom_css: `...`,                  // ← Pro-only
  }, layout, breakpoint),
  elements: [{ elType: 'column', settings: { _column_size: 100 }, elements: widgets }],
};
```

Der Klassifizierer erkennt Mehrspaltigkeit korrekt (`section-picker.ts:262-298`, `detectGridColumns:329-339`). Der Emitter wirft sie weg. **Das ist die direkte Ursache für „flach".**

### Abbruch 7 — Stage 4 (Global Kit + Fonts) läuft nie

`analysis/pipeline.ts:496`

```ts
if (!skip.has(4) && extraction?.designTokens && options.syncToMcp) {
```

`designTokens` ist in `browser/types.ts:104-105` deklariert („*filled when token extraction ran*") — **wird aber nie zugewiesen**. Das Return-Objekt von `extractFromPage` (`playwright-extractor.ts:114-128`) enthält kein `designTokens`-Feld. Es gibt **keinen Producer**.

Folge: `syncTokens` (`token-sync.ts:43-155`) und `syncFontsToKit` (`font-kit-bridge.ts:69-103`) werden **immer** übersprungen. `spec-builder.ts:140-142` pusht die Warnung `'No design tokens provided — using empty token snapshot'`.

### Abbruch 8 — Responsive-Matrix wird nie erzeugt und nie gelesen

`analysis/pipeline.ts:283-293` — Aufruf nur `if (result.extraction.computedStyles && Object.keys(...).length >= 2)`. Per Abbruch 2 immer `undefined`.

Zusätzlich: das Artefakt `responsive-matrix.json` wird von **keinem** Builder gelesen (Grep `responsiveMatrix`: nur die Schreibstelle `pipeline.ts:292`).

### Abbruch 9 — Animationen sind hartkodiert leer

`packages/extractors/src/browser/playwright-extractor.ts:152-171`

```ts
return {
  has_keyframes: false,      // ← hartkodiert
  keyframe_names: [],        // ← hartkodiert
  has_gsap: typeof gsap === 'object' && gsap !== null,
  has_scrolltrigger: ...,
  has_framer_motion: framer !== null,
  has_lenis: lenis !== null,
};
```

- `has_keyframes` konstant `false` → `buildKeyframeSnippet` returned `null` (`animation-injector.ts:128`)
- `transitions` wird nie gesetzt → `buildTransitionSnippet` returned `null` (`:170`)
- **`has_framer_motion` wird von `buildAnimationPlan` nicht ausgewertet** (`:337-346` prüft nur `has_gsap` und `has_lenis`)

Eine Framer-Seite ohne globales `window.gsap` erzeugt also `snippets: []`.

**Vorhandene, nie aufgerufene Extractor-Module:**
- `browser/keyframes-discovery.ts`
- `browser/animation-property-extractor.ts:132` (`extractAnimationProperties`)
- `browser/pseudo-state-capture.ts:131` (`capturePseudoStates`)
- `browser/custom-property-extractor.ts:148`

Grep: nur `export *` in `browser/index.ts:9-12` + je ein Unit-Test.

### 2.1 Übersichtstabelle

| # | Stelle | Effekt |
|---|---|---|
| 1 | `section-detector.ts:28-34` | 9 `<section>` + 696 `data-framer-name` unsichtbar → 1 Sektion |
| 2 | `playwright-extractor.ts:103,124` | `computedStyles = undefined` → `pipeline.ts:351` liefert `{desktop: []}` |
| 3 | `section-picker.ts:69-72` | Selektor-Formate inkompatibel, `' >'` existiert nie → `scoped = []` |
| 4 | `section-picker.ts:228-235` | `settings = {}`, `widgets = []` |
| 5 | `shared.contract.ts:26-30` | kein Text im Snapshot → `title: ''`, `editor: ''` |
| 6 | `builder.ts:471` | `flatMap` über Columns → Mehrspaltigkeit verworfen |
| 7 | `pipeline.ts:496` | `designTokens` ohne Producer → kein Kit, keine Fonts |
| 8 | `pipeline.ts:283` | Responsive-Matrix nie erzeugt, ohnehin nicht gelesen |
| 9 | `playwright-extractor.ts:162-163` | `has_keyframes` hart `false` → `snippets: []` |

---

## 3. Strukturelle Befunde — schwerer als die Bugliste

### 3.1 Der Vertrag existiert, der Producer fehlt

`packages/core/src/contracts/visual-ir.contract.ts:126-173` definiert genau das richtige Modell:

```ts
export interface VisualNodeIR {
  sourceId: string;
  role: 'layout' | 'heading' | 'text' | 'image' | 'button' | 'icon' | 'component' | 'unknown';
  text?: string;                                              // ← Text DA
  assetId?: string;
  href?: string;
  tag?: string;
  bboxByViewport?: Record<string, {x,y,width,height}>;         // ← Geometrie pro Viewport
  styles?: Record<string, string>;                             // ← Styles DA
  responsiveOverrides?: Record<string, Record<string, string>>; // ← Breakpoints DA
  children: VisualNodeIR[];                                    // ← echte Hierarchie
  evidence: Evidence;
}
```

`VisualSectionIR:140-151` ergänzt `layoutArchetype`, `background`, `nodes`. `VisualPageIR:153-173` ergänzt `tokens` (colors, fonts, textStyles, spacing), `assets`, `animations`, `warnings`. Validierung existiert: `validateVisualPageIR:182`.

Der **Konsument ist gebaut und getestet**: `packages/target-v3/src/visual-ir-to-v3.ts` (303 Zeilen). Er hat:
- korrektes Style-Mapping mit `typography_typography: 'custom'`-Companion (`:124-126`)
- **kontextsensitives `color`-Handling** (`:271-275`) — die einzige korrekte Implementierung im Repo
- Fidelity-Decisions pro Node (`native` / `css-fallback` / `static-approximation` / `unsupported`)
- Blocking-Gate über `canContinueWithFidelityDecisions` (`:245`)

**Es gibt keinen Producer.** Grep auf `VisualPageIR` in `packages/extractors`, `packages/cli`, `packages/target-v4`: **kein Treffer**. Nur der Contract, der Emitter selbst und `tests/unit/target-v3/visual-ir-to-v3.test.ts`.

Die in `AGENTS.md` und `REPOSITORY-CHARTA.md` als **verbindlich** bezeichnete Visual-IR-Grenze ist auf der Eingangsseite nicht implementiert.

### 3.2 Vier konkurrierende CSS→Setting-Tabellen

| Datei:Zeile | Name | Umfang |
|---|---|---|
| `target-v3/src/setting-first-policy.ts:60-83` | `ATTRIBUTE_TO_SETTING` | 21 Properties |
| `extractors/src/framer/setting-map.ts:39-203` | `FRAMER_TO_ELEMENTOR_MAP` | 24 Einträge + `v4Reliable`-Flag |
| `target-v3/src/visual-ir-to-v3.ts:256-277` | `toV3SettingKey` | 9 Properties, **kontextsensitiv** |
| `target-v3/src/classifier/responsive-settings.ts:96-104` | `cssPropToV3Key` | naives `prop.replace(/-/g,'_')` |

**Konkrete Widersprüche:**

**`color`** — der teuerste Fehler, weil er jedes Text-Widget betrifft:

| Datei | Verhalten | korrekt? |
|---|---|---|
| `visual-ir-to-v3.ts:271-275` | `button`→`button_text_color`, `text`→`text_color`, sonst `title_color` | ✅ **korrekt** |
| `setting-first-policy.ts:66-67` | zwei Pseudo-Properties: `'color'`→`title_color`, `'text-color'`→`text_color` | ⚠️ Krücke |
| `framer/setting-map.ts:147-152` | hart `title_color`, Kommentar „text-editor uses text_color" ohne Umsetzung | ❌ |
| `framer-tree-to-v3.ts:581,624` | immer `title_color`, auch für `text-editor` | ❌ |

**`background_background: 'classic'`** — der obligatorische Companion für `background_color` wird **nirgends im Mapping-Pfad gesetzt**. Grep: nur in handgeschriebenen Templates (`patterns/stat-row.ts:63,81`, `patterns/service-cards.ts:96,174`, `patterns/glass-header.ts:114`).

`setting-first-policy.ts:68` deklariert `background-color: { settingKey: 'background_color', reliable: true }` **ohne Companion**. `references/v3-v4-render-compat.json:52-59` führt `background_color` mit `"requires": {}` — der Validator kann den fehlenden Companion also gar nicht melden.

**`font-size` → `typography_font_size` + `typography_typography: 'custom'`** ist dagegen an **vier Stellen unabhängig korrekt** implementiert: `widget-mapper.ts:182-183`, `visual-ir-to-v3.ts:124-126`, `framer/setting-map.ts:242-244`, `framer-tree-to-v3.ts:571,617`.

### 3.3 Zwei Breakpoint-Konventionen, eine davon falsch

Elementor verwendet **Suffixe**: `padding_tablet`, `typography_font_size_mobile`.

| Datei:Zeile | Erzeugt | Korrekt? |
|---|---|---|
| `builder.ts:433,437` | `` `${key}${suffix}` `` mit `suffix = '_tablet'` | ✅ |
| `classifier/responsive-settings.ts:58,62` | `` `${v3Key}_tablet` `` | ✅ |
| `responsive-breakpoint-mapper.ts:64` | `` `${bp}_${key}` `` → `tablet_padding` | ❌ **Präfix** |
| `visual-ir-to-v3.ts:108` | `` `${breakpoint}_${key}` `` → `mobile_padding` | ❌ **Präfix** |

**Der Guard erkennt es nicht.** `guards.ts:210-230` (`G4:breakpoint-coverage`) prüft:
```ts
Object.keys(settings).some(k => k.endsWith('_tablet'))
```
Präfix-Keys fallen durch das Raster und gelten als „keine Overrides vorhanden". Der Guard schlägt also nicht an, obwohl die Keys von Elementor verworfen werden.

**Nebenbefund:** `responsive-breakpoint-mapper.ts:76-93` (`findElements`) matcht über `css_classes` an Containern — ein Feld, das V4 laut `references/v3-v4-render-compat.json:61-68` strippt und das die Emitter gar nicht setzen (`builder.ts:483` setzt `_css_classes`).

### 3.4 Drei V3-Emitter, der URL-Pfad benutzt den ärmsten

| Emitter | Datei | Style-Mapping | Erreichbar über |
|---|---|---|---|
| **arm** | `builder.ts:464-498` (`buildSectionV1`) | 4 Keys: `content_width`, `gap`, `_css_classes`, `custom_css` | **`--url` (der Produktionspfad)** |
| **reich** | `framer-tree-to-v3.ts:556-640` (`mapSettings`) | `background_color`, `background_image`, `typography_*` + Companion, `padding`, `flex_direction`, `flex_gap`, `border_radius`, `width`, `min_height`, `_element_id` | nur `--xml` (`framer-build-orchestrator.ts:92` ← `clone-v3.ts:402`) |
| **bester** | `visual-ir-to-v3.ts:114-129, 256-277` | vollständig + kontextsensitives `color` + Fidelity-Decisions | **kein Producer** |

### 3.5 Kein Schema-Gate — obwohl der Server es anbietet

`novamira/elementor-get-schema` erscheint im Repo **ausschließlich als Datum, nie als Aufruf**:

- `packages/mcp/src/ability-registry.ts:250` — Eintrag in `KNOWN_ABILITIES`
- `packages/mcp/src/ability-registry.ts:251` — `novamira/elementor-get-style-schema`, ebenfalls nur Eintrag
- `schemas/novamira-abilities.schema.json:288`, `docs/NOVAMIRA-LIVE-ABILITIES-2026-07-30.txt:230` — Inventar
- `docs/NOVAMIRA-ABILITY-PLAYBOOK.md:29` — explizit als **optional** deklariert: „*OPTIONALE Discovery — Validierung läuft ohnehin serverseitig*"

Diese Einschätzung ist der Kern des Problems: Serverseitige Validierung **rejectet den Deploy**, statt dass der Build den Fehler früh meldet. Grep nach `getSchema`, `get-schema`, `allowedControls`, `ALLOWED_CONTROLS`, `validateSettings`: **kein Treffer**.

Was es stattdessen gibt:
- `classifier/widget-validator.ts:36-47` — `REQUIRED_V3_SETTINGS`, nur **Pflichtfelder** (`heading: ['title','header_size']`), keine Whitelist erlaubter Controls
- `setting-validator.ts:99-194` — prüft gegen `references/v3-v4-render-compat.json`, aber die Tabelle hat nur **19 Einträge**. Nicht enthalten: `flex_gap`-Companions, `background_background`, `text_padding`, `image_border_radius`, `_element_width`, alle `*_tablet`/`*_mobile`-Varianten
- `cmd-convert.ts:384-407` — `validateTree()` ruft nur `assertNoContamination` + `runGuards(V3_GUARDS)`. Die 13 Guards (`guards.ts:274-288`) prüfen **Struktur** (IDs, elType, Nesting, HTML-Budget), **keine Setting-Namen**

**Konsequenz:** Tippfehler wie `_css_classes` (`builder.ts:483`) oder Typkonflikte (`content_width: 'boxed'` in `visual-ir-to-v3.ts:228` vs. `content_width: {size:1200,unit:'px'}` in `builder.ts:481`, **beide** auf `elType:'section'`) werden von keiner Stufe erkannt — sie werden erst beim Rendern still ignoriert.

### 3.6 Native Entrance-Animationen werden nie versucht

Grep nach `_animation`, `animation_duration`, `animation_delay`, `entrance` über `packages/` und `skills/`:

- `classifier/widget-mapper.ts:536` — `animation_duration` als Pro-`animated-headline`-Setting, **nicht** als Entrance
- `references/v3-v4-render-compat.json:160` — `hover_animation` als Tabelleneintrag
- `patterns/glass-header.ts:100` — `hover_animation: 'grow'` in einem Template
- `extractors/src/framer/interactions.ts:148` — `type: 'entrance'` als **Klassifikations-Label**, wird zu keinem Elementor-Setting

Die Elementor-Controls `_animation`, `_animation_delay`, `animation_duration`, `motion_fx_*`, `sticky` werden von **keinem** Emitter geschrieben. Alles läuft über WPCode-CSS/JS — obwohl `setting-first-policy.ts` genau das Gegenteil als Prinzip formuliert und §2 der Charta „native" als erste Fallback-Stufe definiert.

### 3.7 Zwei defekte Nebenpfade (Reparatur, kein Neubau)

**`setting-first-css-generator.ts:35-38` — falscher Pfad, wirft beim ersten Aufruf:**

```ts
const COMPAT_PATH = path.resolve(__dirname,
  '../../skills/framer-to-elementor-v3/references/v3-v4-render-compat.json');
```

Aus `packages/target-v3/src/` resolved das zu `packages/skills/…` — **existiert nicht** (verifiziert: `Test-Path packages\skills` → `False`). Die Datei liegt in `<repo>/skills/…`, also drei Ebenen höher. `loadCompat()` (`:41-45`) wirft. `framer-build-orchestrator.ts:120` ruft ungeschützt auf → **der Framer-XML-Build bricht dort ab**. Kein Test deckt das Modul ab.

Zweite Inkonsistenz: das Modul erwartet `settings` als **Record** (`:24-32`, Zugriff `compat.settings[risk.setting]` `:98`), `setting-validator.ts:19` liest dieselbe Datei als **Array**. Die zwei JSON-Dateien haben tatsächlich unterschiedliche Shapes (`packages/target-v3/references/…json:5` = Array, `skills/…/references/…json:6` = Objekt).

**`framer-animation-detector.ts:182` — Operator-Präzedenz:**

```ts
gsap.from("." + el.classList[0] ? ... : ...)
```

`"." + el.classList[0]` ist **immer truthy** → der Ternary wählt konstant den ersten Zweig. Der Fallback ist toter Code.

**Verwandt:** Der `v3TreeClasses`-Kanal wird in `framer-build-orchestrator.ts:123-126` aus `element.settings?.css_classes` gefüllt — die Emitter setzen aber `_css_classes` (`builder.ts:483`) bzw. gar keine Klassen. `treeClasses` ist praktisch immer leer.

### 3.8 Global Kit: fertiger Code ohne Aufrufer

`packages/core/src/token-pipeline.ts:84-106` (`runTokenPipeline`) baut die **kompletten** MCP-Calls für Kit-Colors **und** Kit-Typography:

```ts
calls.push({ ability: 'novamira-adrianv2/set-active-kit', params: { section: 'colors', ... } });      // :179
calls.push({ ability: 'novamira-adrianv2/set-active-kit', params: { section: 'typography', ... } });  // :188
calls.push({ ability: 'novamira-adrianv2/register-google-font', ... });                               // :207
calls.push({ ability: 'novamira-adrianv2/create-wpcode-snippet', ... });                              // :214
```

Aufrufer: **ausschließlich** `tests/unit/core/token-pipeline.test.ts`. Die Funktion gibt nur eine Call-Liste zurück und führt nichts aus; niemand führt die Liste aus.

**Zusätzlich falsch:** Die live verifizierte Signatur von `set-active-kit` ist `{ kit_id: integer }` — **nicht** `{ section, values }`. Die Annahme in `token-pipeline.ts:179-197` ist nicht schema-verifiziert.

**Die tatsächlich richtigen V3-Kit-Abilities** (live verifiziert, siehe §4.4) stehen nur als Registry-Einträge in `ability-registry.ts:233-234`, ohne Aufruf:
- `novamira/elementor-create-v3-color` → `{ title, color }`
- `novamira/elementor-create-v3-typography` → `{ title, font_family?, font_size?{size,unit}, font_weight?, line_height?, letter_spacing?, text_transform?, ... }`

---

## 4. Verifiziertes Server-Wissen (Live-Discovery 2026-08-23)

Alle Angaben in diesem Abschnitt stammen aus `novamira/elementor-get-schema` und `mcp-adapter-get-ability-info` gegen `testseite.nick-webdesign.de` (Elementor 4.2.1 + Pro 4.1.0). **Sie sind nicht geraten.** Sie sind das Wissen, das dem Repo bisher fehlt.

### 4.1 Ziel-Umgebung

```json
{ "elementor": { "active": true, "version": "4.2.1" },
  "elementor_pro": { "active": true, "version": "4.1.0" },
  "atomic": { "runtime_available": true, "style_schema_available": true,
              "global_classes_available": true, "variables_available": true,
              "interactions_available": true },
  "kit": { "container_width": { "unit": "px", "size": 1140 },
           "active_breakpoints": ["desktop", "mobile", "tablet"] },
  "issues": [] }
```

**Konsequenz für den Bauplan:** `container_width` ist **1140 px**, nicht 1200. `builder.ts:481` hartkodiert `1200` — das erzeugt bereits eine Abweichung. Die aktiven Breakpoints sind exakt `desktop`, `mobile`, `tablet` — mehr Suffixe zu erzeugen ist sinnlos.

### 4.2 Container-Controls (`__container__`) — die korrekten Namen

| Falsch (Repo / naive Annahme) | ✅ Korrekt | Typ / Shape |
|---|---|---|
| `gap` | **`flex_gap`** | `{ column, row, isLinked, unit }` — Typ `gaps` |
| `align_items` | **`flex_align_items`** | `choose`: `flex-start\|center\|flex-end\|stretch` |
| `justify_content` | **`flex_justify_content`** | `choose`: `flex-start\|center\|flex-end\|space-between\|space-around\|space-evenly` |
| `_padding` | **`padding`** | `dimensions` |
| `_margin` | **`margin`** | `dimensions` |
| `box_shadow` | **`box_shadow_box_shadow`** + **`box_shadow_box_shadow_type: 'yes'`** | `box_shadow` + `popover_toggle` |
| `_css_classes` | **`css_classes`** | `text` |
| `width` (bei boxed) | **`boxed_width`** | `slider`, `if: content_width == 'boxed'` |

**Vollständige Liste verfügbarer Container-Controls (alle `r:1` = responsiv-fähig, wo markiert):**

```text
Layout:      container_type (flex|grid), content_width (boxed|full),
             width (if full, r), boxed_width (if boxed, r), min_height (r),
             flex_direction (row|column|row-reverse|column-reverse, r),
             flex_justify_content (r), flex_align_items (r), flex_gap (r),
             flex_wrap (nowrap|wrap, r), flex_align_content (if wrap, r),
             overflow ("" |hidden|auto), html_tag ("" |div|header|footer|main|
                                          article|section|aside|nav|a),
             link (if html_tag == 'a')
Grid:        grid_columns_grid (r), grid_rows_grid (r), grid_gaps (r),
             grid_auto_flow (r), grid_justify_items (r), grid_align_items (r),
             grid_outline
Background:  background_background (classic|gradient|video|slideshow),
             background_color, background_image (media, r),
             background_position (r), background_size (r),
             background_overlay_background, background_overlay_color,
             background_overlay_opacity (r)
Border:      border_border ("" |none|solid|double|dotted|dashed|groove),
             border_width (if border_border, r), border_color (if border_border),
             border_radius (dimensions, r),
             box_shadow_box_shadow_type, box_shadow_box_shadow
Spacing:     margin (r), padding (r)
Flex-Child:  _flex_align_self (r), _flex_order (r),
             _flex_size (none|grow|shrink|custom, r),
             _flex_grow (if _flex_size == custom, r)
Position:    position ("" |absolute|fixed), z_index (r)
Effects:     animation (r), animation_duration (slow|""|fast),
             animation_delay (number),
             motion_fx_motion_fx_scrolling (switcher),
             motion_fx_translateY_effect, motion_fx_opacity_effect,
             sticky ("" |top|bottom), sticky_on (["desktop","tablet","mobile"])
Custom:      css_classes, custom_css (Pro)
```

### 4.3 Widget-Controls — Farbschlüssel sind pro Widget unterschiedlich

**Das ist der Fehler, der jedes Text-Widget betrifft:**

| Widget | Farb-Control | Verifiziert |
|---|---|---|
| `heading` | **`title_color`** | ✅ |
| `text-editor` | **`text_color`** | ✅ |
| `button` | **`button_text_color`** (+ `hover_color` für Hover) | ✅ |
| `accordion` | **`title_color`** | ✅ |
| `icon-box` | **`title_color`** | ✅ |
| `divider` | **`text_color`** (nur `if look == 'line_text'`) | ✅ |
| `image` | `text_color` (nur Caption, `if caption_source != 'none'`) | ✅ |

**Typografie — identisch für `heading`, `text-editor`, `button`, `divider`:**
```text
typography_typography: 'custom'        ← OBLIGATORISCHER Companion, sonst wird alles ignoriert
typography_font_family                 (font)
typography_font_size    (slider, r)    { unit, size }
typography_font_weight  (select)       100..900 | "" | normal | bold
typography_text_transform (select)     "" | uppercase | lowercase | capitalize | none
typography_line_height  (slider, r)    { unit, size }
typography_letter_spacing (slider, r)  { unit, size }
```

**Advanced-Tab — identisch für ALLE Widgets:**
```text
_margin (dimensions, r)          _padding (dimensions, r)
_element_width ("" |inherit|auto|initial, r)
_element_custom_width (slider, r, if _element_width == 'initial')
_flex_align_self (r)   _flex_size (r)   _flex_grow (r, if _flex_size == custom)
_css_classes (text)
_animation (animation, r)        ← ENTRANCE-ANIMATION (Widget)
_animation_delay (number, ms, if _animation)
animation_duration (slow|""|fast, if _animation)
motion_fx_motion_fx_scrolling (switcher)
motion_fx_translateY_effect / motion_fx_opacity_effect (if scrolling == 'yes')
sticky ("" |top|bottom)          sticky_on (["desktop","tablet","mobile"])
```

**Widget-spezifisch:**

| Widget | Zusätzliche Controls |
|---|---|
| `heading` | `title` (textarea), `header_size` (h1..h6\|div\|span\|p), `link` (url), `align` (start\|center\|end\|justify, r), `size` (default\|small\|medium\|large\|xl\|xxl) |
| `text-editor` | `editor` (wysiwyg), `align` (r), `drop_cap` (switcher), `text_columns` (r), `column_gap` (r) |
| `image` | `image` `{url,id,size}`, `image_size` (thumbnail…full\|custom), `align` (start\|center\|end, r), **`width`** (slider, r), **`space`** (max-width, r), **`height`** (slider, r), **`object-fit`** (fill\|cover\|contain\|scale-down, if height), `image_border_radius` (dimensions, r) |
| `button` | `text`, `link` (url), `button_type` (""\|info\|success\|warning\|danger), `size` (xs..xl), `selected_icon` (icons, `arr: true`), `icon_align` (row\|row-reverse), `icon_indent` (slider), `align` (left\|center\|right\|justify, r), `background_background` (classic\|gradient, def `classic`), `background_color`, `border_radius` (dimensions, r), **`text_padding`** (dimensions, r), `button_css_id` |
| `divider` | `width` (slider, def 100 %, r), `align` (left\|center\|right, r), `look`, `border_radius` (slider, if `look == line_icon`) |
| `spacer` | `space` (slider, def 50 px, r) |
| `accordion` | `tabs` (repeater: `{_id, tab_title, tab_content}`), `title_color` |

**Wichtig:** `accordion.tabs` erwartet `_id` (Unterstrich), nicht `id`.

### 4.4 Kit-Abilities — live verifizierte Signaturen

```text
novamira/elementor-create-v3-color
  → { title: string, color: string }                        // color = Hex "#ff0000"
  ← { success, color: object }

novamira/elementor-create-v3-typography
  → { title: string,
      font_family?: string,
      font_size?: { size: number|string, unit: 'px'|'em'|'rem'|'vw'|'vh'|'%'|'custom' },
      font_weight?: string, text_transform?: string, font_style?: string,
      text_decoration?: string,
      line_height?: {size,unit}, letter_spacing?: {size,unit} }
  ← { success, typography: object }
  // unit:'custom' + size als String erlaubt raw CSS: "clamp(1rem, 2vw, 2.5rem)"

novamira-adrianv2/set-active-kit
  → { kit_id: integer }                                     // NICHT { section, values } !
  ← { success, kit_id, title, summary }
  // destructive: true — regeneriert CSS-Cache

novamira-adrianv2/create-wpcode-snippet
  → { title, code, code_type: 'php'|'universal'|'css'|'html'|'js'|'text'|'blocks'|'scss',
      location?, auto_insert?, insert_number?, tags?, priority? (1-99),
      device_type? ('any'|'desktop'|'mobile'), schedule?, use_rules?, rules?,
      custom_shortcode?, compress_output?, active? (default false),
      cache_bust_token? }
  ← { snippet_id, status ('publish'|'draft'), active, last_error, edit_url, ... }
  // Default inaktiv (draft). active:true → WPCode prüft und kann auf draft
  //   zurückfallen; die Response spiegelt den TATSÄCHLICHEN Zustand.
  // Für 'php': KEIN öffnendes <?php.
  // cache_bust_token hängt ?v={token} an CDN-URLs (jsdelivr/unpkg/cdnjs).

novamira-adrianv2/batch-media-upload
  → { files: [{ filename, mime_type?, content_base64, alt_text?, title? }] }  // max 30, je ≤10MB
  ← { success, uploaded, failed, results: [{ filename, wp_media_id, wp_url, error }] }
  // GOTCHA: wp_url kann "-scaled" enthalten (WP Large-Image-Handling) und
  //   bei Duplikaten "-2"/"-3" — der zurückgegebene Name ≠ eingesandter Name.
  //   Mapping MUSS über den Basenamen normalisieren.

novamira/elementor-get-schema
  → { action: 'list'|'get', widget_types?: string[], include_styles?: bool,
      control_names?: string[], tab?: string, section?: string, verbose?: bool,
      category?, name_contains?, is_atomic?, source? }
  ← { success, widgets: { <type>: { controls: { <name>: {t, opts?, def?, if?, r?, arr?} } } } }
  // "__container__" als widget_type erlaubt.
  // include_styles:true + control_names ist der günstige Weg; breites
  //   include_styles auf v3-Widgets ist sehr groß.

novamira/elementor-set-content
  → { post_id, content: [...], template_type? }
  ← { success, post_id, edit_url, assigned_ids }
  // Validiert serverseitig; bei unbekanntem Key wird NICHTS persistiert und
  //   das Schema kommt INLINE im Fehler zurück.
  // Akzeptiert BEIDE Key-Stile: element_type+widget_type ODER elType+widgetType.
```

### 4.5 Wert-Shapes (aus `elementor-set-content`-Doku, verbindlich)

```text
switcher    → 'rv' (an, bzw. der in "rv" deklarierte Wert) | '' (aus)
dimensions  → { unit, top, right, bottom, left, isLinked }
slider      → { size, unit }
gaps        → { column, row, isLinked, unit }
color       → '#RRGGBB'
typography  → typography_typography:'custom' MUSS zuerst gesetzt sein
select/choose → Wert MUSS aus "opts" stammen
arr:true    → Skalar wird serverseitig in ein 1-Element-Array gewrappt
responsive  → Controls mit "r" akzeptieren <key>_<breakpoint>
              (r:1 = alle; r:{min|max} = Fenster in der Reihenfolge
               mobile < mobile_extra < tablet < tablet_extra < laptop
               < desktop < widescreen)
```

### 4.6 Content-Feld-Regeln (verbindlich, aus Server-Doku)

- **Single-line-Text-Controls** (`heading.title`, `button.text`, `icon-list[].text`, `image.caption`): **nur Plaintext**.
- **WYSIWYG-Controls** (`text-editor.editor`, `testimonial.testimonial_content`): **nur Inline-Formatierung** (`<strong>`, `<em>`, `<a>`, `<br>`).
- **Niemals** Inhalt in `<p style="…">` oder anderes Layout-Markup wickeln. Ausrichtung → `align`, Größe/Gewicht/Familie → `typography_*`, Max-Breite → `_element_custom_width`, Abstände → `_padding`/`_margin`.
- Der `html`-Widget ist der einzig legitime Ort für beliebiges HTML.
- Controls, deren `if`-Bedingung nicht erfüllt ist, dürfen **nicht** emittiert werden.

### 4.7 Ability-Drift (aktueller Stand)

`elconv doctor --sync-abilities` gegen das Ziel: **Live 263, Snapshot 269**. Sechs Namen sind serverseitig entfallen:

```text
novamira-adrianv2/elementor-tree-chunk-append
novamira-adrianv2/elementor-tree-chunk-commit
novamira-adrianv2/elementor-tree-chunk-start
novamira-adrianv2/tree-chunk-append
novamira-adrianv2/tree-chunk-commit
novamira-adrianv2/tree-chunk-start
```

**Konsequenz:** Die `tree-chunk`-Deploy-Strategie ist auf diesem Ziel nicht verfügbar. `deploy.ts` muss das als `capability-unavailable` melden (nicht als Fehler beim Aufruf).

---

## 5. Zielarchitektur

### 5.1 Der kanonische Pfad (Soll)

```text
Framer-Quelle (Live-URL | HTML-Export | XML)
  │
  ├─ [P3] Framer-Sektionierer ──────── data-framer-name + __framer__breakpoints
  │                                     + Geometrie-Bänder
  ▼
[P0] VisualIR-Producer  ◄──── EIN Playwright-Durchlauf pro Viewport
  │    • stabile Node-ID (kein String-Selektor)
  │    • text + styles + bbox + Parent/Kind-Hierarchie
  │    • responsiveOverrides als Diff gegen Desktop
  │    • tokens (colors/fonts/textStyles/spacing)
  │    • assets + animations
  ▼
VisualPageIR  ── validateVisualPageIR()  ← Contract existiert bereits
  │
  ├─ [P6] Global-Kit-Sync  ─── create-v3-color / create-v3-typography
  │                            (Farben+Fonts global, nicht pro Widget)
  ▼
[P1] Kanonische Setting-Map  ── (cssProperty, widgetType) → (settingKey, companions[], suffix)
  │
  ├─ [P4] Animation-Mapper ─── native (_animation, motion_fx_*, sticky)
  │                            │
  │                            └─ Rest → WPCode (mit Begründung im Report)
  ▼
visual-ir-to-v3.ts  ◄──── EXISTIERT, ist der beste Emitter
  │    + Fidelity-Decisions pro Node
  ▼
[P2] Schema-Gate  ── elementor-get-schema (gecacht pro Ziel)
  │    unbekannter Key → Build-Fehler, NICHT Server-Reject
  ▼
Guards (erweitert: [P5] Breakpoint-Suffix, Substanz-Guards)
  ▼
Snapshot → Deploy → Read-back → Cache-Clear
  ▼
Multi-Viewport-QA gegen echte Referenz
  ▼
Report: native % | css-fallback % | js-fallback % | unsupported (mit Grund)
```

### 5.2 Was aus dem Bestand wiederverwendet wird

| Baustein | Datei | Zustand |
|---|---|---|
| IR-Contract + Validator | `core/src/contracts/visual-ir.contract.ts` | ✅ fertig, ungenutzt |
| IR→V3-Emitter | `target-v3/src/visual-ir-to-v3.ts` | ✅ fertig + getestet, ohne Producer |
| Style-Extraktion | `extractors/.../computed-styles.ts` | ✅ 60+ Properties, nie aufgerufen |
| Framer-DOM-Leser | `extractors/.../framer-data-extractor.ts` | ✅ liest Names + Breakpoints, nie aufgerufen |
| Keyframe-Discovery | `extractors/.../keyframes-discovery.ts` | ✅ fertig, nie aufgerufen |
| Animation-Properties | `extractors/.../animation-property-extractor.ts` | ✅ fertig, nie aufgerufen |
| Pseudo-States (Hover) | `extractors/.../pseudo-state-capture.ts` | ✅ fertig, nie aufgerufen |
| Responsive-Matrix | `extractors/src/responsive-matrix.ts` | ✅ 40 Properties, Aufruf-Guard blockt |
| Fidelity-Decisions | `core` (`canContinueWithFidelityDecisions`) | ✅ genutzt vom IR-Emitter |
| Snapshot/Rollback | `mcp/src/snapshot.ts` | ✅ produktiv |
| Read-back/Cache | `mcp/src/readback.ts` | ✅ produktiv, live verifiziert |
| WPCode-Generator | `target-v3/src/wpcode.ts` | ⚠️ fertig, kein Aufrufer |
| Kit-Call-Builder | `core/src/token-pipeline.ts` | ⚠️ falsche `set-active-kit`-Signatur |

**Der Umbau ist überwiegend Verdrahtung, nicht Neuentwicklung.** Das ist die zentrale Aufwandsaussage dieses Plans.

### 5.3 Bindende Prinzipien

1. **Native zuerst.** Ein Attribut darf nur dann per CSS/WPCode gelöst werden, wenn nachgewiesen ist, dass kein Elementor-Control es abdeckt. Der Nachweis ist das Schema-Gate (P2), nicht eine Vermutung im Code.
2. **Eine Wahrheit pro Konzept.** Eine Setting-Map, ein IR, ein Emitter pro Target, eine Breakpoint-Konvention.
3. **Kein stiller Verlust.** Jeder nicht native umgesetzte Knoten erscheint mit Grund im Report (`css-fallback` / `js-fallback` / `static-approximation` / `unsupported`).
4. **Substanz vor Struktur.** Guards müssen Leere erkennen. Ein 496-Byte-Tree darf nie 100/100 erreichen.
5. **Schema vor Deploy.** Unbekannte Keys sind Build-Fehler, keine Server-Rejects.

---

## 6. Arbeitspaket P0 — VisualIR-Producer

> **Der Hebel.** Entschärft die Abbrüche 1–6 und 8. Ohne P0 ist jedes andere Paket wirkungslos.

### 6.1 Ziel

Ein Playwright-Extraktor, der pro DOM-Knoten **in einem Durchlauf** liefert: stabile ID, Rolle, Text, alle relevanten computed styles, Bounding-Box pro Viewport, echte Parent/Kind-Hierarchie. Ausgabe ist ein `VisualPageIR` nach dem bestehenden Contract.

### 6.2 Neue Dateien

```text
packages/extractors/src/visual-ir/
  ├── producer.ts              buildVisualPageIR(page, options) → VisualPageIR
  ├── node-walker.ts           DOM-Walk mit stabiler ID + Hierarchie
  ├── role-classifier.ts       DOM-Knoten → VisualNodeIR['role']
  ├── style-capture.ts         computed styles pro Knoten (nutzt CURATED_PROPERTIES)
  ├── responsive-differ.ts     Desktop-Baseline vs. Tablet/Mobile → responsiveOverrides
  ├── token-harvester.ts       CSS-Custom-Properties + @font-face → IR.tokens
  └── index.ts
```

### 6.3 Stabile Node-ID (ersetzt String-Selektoren)

Der Kernfehler von Abbruch 3 ist die Verwendung von CSS-Selektor-Strings als Join-Key. Ersatz: eine **während des Walks vergebene Positions-ID**, die im gleichen Durchlauf sowohl an den Style-Snapshot als auch an die Hierarchie geht.

```ts
// node-walker.ts (Konzept, läuft im page.evaluate-Kontext)
// ID-Schema: Pfad-Index vom Root, z.B. "n0.3.1.7"
// Eigenschaften:
//   - eindeutig ohne Klassennamen
//   - stabil zwischen Viewports (gleicher DOM, nur andere Styles)
//   - erlaubt Parent-Ableitung durch Präfix-Kürzung
function walk(root: Element, path: number[] = []): RawNode[] {
  const out: RawNode[] = [];
  const kids = Array.from(root.children);
  for (let i = 0; i < kids.length; i++) {
    const el = kids[i];
    const nodePath = [...path, i];
    const sourceId = 'n' + nodePath.join('.');
    out.push({
      sourceId,
      parentId: path.length ? 'n' + path.join('.') : null,
      tag: el.tagName.toLowerCase(),
      framerName: el.getAttribute('data-framer-name') ?? undefined,
      // ↓ Text nur von Blatt-Text-Knoten, nicht kumuliert von Containern
      ownText: directTextOf(el),
      styles: captureStyles(el),
      bbox: rectOf(el),
      href: el.getAttribute('href') ?? undefined,
      imgSrc: el.tagName === 'IMG' ? (el.currentSrc || el.src) : undefined,
    });
    out.push(...walk(el, nodePath));
  }
  return out;
}
```

**`directTextOf` (kritisch):** Nur `Node.TEXT_NODE`-Kinder des Elements, **nicht** `textContent`. Sonst trägt jeder Container den gesamten Seitentext und die Rollenklassifikation kollabiert.

```ts
function directTextOf(el: Element): string {
  let s = '';
  for (const n of Array.from(el.childNodes)) {
    if (n.nodeType === 3) s += n.textContent ?? '';
  }
  return s.replace(/\s+/g, ' ').trim();
}
```

### 6.4 Rollen-Klassifikation

Reihenfolge ist bindend (erste Regel gewinnt):

| Priorität | Bedingung | `role` |
|---|---|---|
| 1 | `tag` ∈ `h1..h6` | `heading` |
| 2 | `tag === 'img'` **oder** `background-image != none` **und** keine Kinder mit Text | `image` |
| 3 | `tag ∈ {a, button}` **und** `ownText.length > 0` **und** `bbox.height < 80` | `button` |
| 4 | `tag === 'svg'` **oder** (`bbox.width ≤ 48 && bbox.height ≤ 48` **und** kein Text) | `icon` |
| 5 | `ownText.length > 0` | `text` |
| 6 | `children.length > 0` | `layout` |
| 7 | sonst | `unknown` |

**Heading-Fallback für Framer:** Framer emittiert Überschriften häufig als `<div>` mit großer Schrift. Zusatzregel nach Priorität 5: `role: 'text'` wird zu `'heading'` **hochgestuft**, wenn `fontSize ≥ 28px` **und** `ownText.length ≤ 120` **und** `font-family` der Serif/Display-Familie der Seite entspricht. Der `header_size` wird dann aus einer Größen-Rangliste abgeleitet (größte auf der Seite → `h1`, danach `h2` …).

**Diese Hochstufung muss im `evidence`-Feld vermerkt werden** (`inferredHeading: true`), damit der Report sie ausweist.

### 6.5 Container-Kollaps (verhindert 5+ Ebenen Div-Suppe)

Framer verschachtelt tief. Ohne Kollaps entstehen unbenutzbare Elementor-Bäume.

**Regel:** Ein `layout`-Knoten wird in seinen Parent kollabiert, wenn **alle** gelten:
- genau **ein** Kind
- keine eigenen Styles außerhalb einer Ignoreliste (`display`, `position:relative`, `width:100%`, `height:100%`)
- kein `background-*`, kein `border-*`, kein `padding`, kein `box-shadow`
- kein `data-framer-name`

Der Kollaps wird gezählt und im Report gemeldet (`collapsedWrappers: N`).

### 6.6 Responsive-Diff

```ts
// responsive-differ.ts
// Desktop ist Baseline. Für jeden weiteren Viewport wird pro sourceId
// die Style-Differenz gebildet — nur Änderungen landen in responsiveOverrides.
// Die Viewport-Labels MÜSSEN den aktiven Kit-Breakpoints entsprechen
// (live verifiziert: desktop | tablet | mobile).
function diffViewports(
  base: Map<string, Styles>,          // desktop
  variant: Map<string, Styles>,       // tablet | mobile
): Map<string, Styles> { /* nur !== Werte */ }
```

**Wichtig:** Der Walk muss pro Viewport **denselben DOM** sehen. Framer rendert Desktop-/Tablet-/Phone-Varianten teils als **separate Knoten** (`display:none`). Deshalb:
- Knoten mit `display:none` im aktuellen Viewport werden **nicht verworfen**, sondern als `hiddenIn: ['mobile']` markiert.
- P3 nutzt genau diese Markierung, um Varianten zu einer Sektion zu mergen.

### 6.7 Token-Harvest

```ts
// token-harvester.ts
// 1. CSS-Custom-Properties von :root und body auslesen (Framer: --token-<uuid>)
// 2. Häufigkeitsanalyse der Farbwerte im Baum → Kandidaten für Kit-Colors
// 3. @font-face-Regeln aus document.styleSheets → IR.tokens.fonts
// 4. Text-Style-Cluster (fontFamily+size+weight+lineHeight) → IR.tokens.textStyles
```

Verifiziert am Beispiel: 10 `--token-*` und 4 `@font-face`-Familien (`Inter`, `Inter Placeholder`, `Lora`, `Lora Placeholder`) sind vorhanden. Die `* Placeholder`-Varianten sind Framer-Ladeplatzhalter und **müssen gefiltert** werden.

### 6.8 Verdrahtung

| Datei | Änderung |
|---|---|
| `cli/src/analysis/pipeline.ts` | Stage 1 ruft `buildVisualPageIR()`; Ergebnis als `visual-ir.json` persistieren |
| `cli/src/analysis/pipeline.ts` | Stage 5 (build) ruft `emitV3FromVisualIr()` statt `buildV3PageDataFromSections()` |
| `cli/src/cmd-convert.ts` | keine Flag-Änderung nötig — `--url` nutzt automatisch den neuen Pfad |
| `extractors/src/index.ts` | `export * from './visual-ir/index.js'` |

**`detectResponsiveStyles` wird obsolet** — der IR-Producer erhebt Styles immer. Das Flag bleibt für Rückwärtskompatibilität, hat aber keine Wirkung mehr auf den IR-Pfad.

### 6.9 Akzeptanzkriterien P0

- [ ] `buildVisualPageIR()` gegen die Framer-Fixture liefert **≥ 8 Sektionen** (Referenz: 9)
- [ ] **≥ 200 Nodes** mit `role !== 'unknown'`
- [ ] **≥ 150 Nodes** mit nicht-leerem `text` (Referenz: 264 Text-Widgets im manuellen Rebuild)
- [ ] Jeder Node hat `bboxByViewport.desktop`
- [ ] `responsiveOverrides` ist bei mindestens 20 Nodes nicht leer
- [ ] `tokens.colors` enthält ≥ 5 Einträge, `tokens.fonts` ≥ 2 (ohne `* Placeholder`)
- [ ] `validateVisualPageIR(ir).valid === true`
- [ ] Offline-Fixture-Test: gespeichertes HTML → IR, deterministisch, ohne Netz
- [ ] `emitV3FromVisualIr(ir)` erzeugt **≥ 100 Widgets** und **≥ 8 Top-Level-Container**
- [ ] Kein Node verliert Text still: Anzahl `text`-Felder im IR == Anzahl Text-tragender Widgets + explizit gemeldete Verluste

---

## 7. Arbeitspaket P1 — Kanonische Setting-Map

> Ersetzt vier konkurrierende Tabellen durch eine. Behebt das `color`-Problem und die fehlenden Companions.

### 7.1 Neue Datei

```text
packages/core/src/elementor/setting-map.ts
```

### 7.2 Vertrag

```ts
export type ElementorWidgetType =
  | 'container' | 'heading' | 'text-editor' | 'image' | 'button'
  | 'divider' | 'spacer' | 'icon' | 'icon-box' | 'accordion' | 'html';

export interface SettingMapping {
  /** Ziel-Control-Name, wie vom Server-Schema bestätigt. */
  settingKey: string;
  /** Zwingend zusätzlich zu setzende Companions. */
  companions?: Record<string, string>;
  /** Wertform. */
  valueShape: 'raw' | 'color' | 'dimensions' | 'slider' | 'gaps' | 'select' | 'switcher';
  /** Darf ein Breakpoint-Suffix tragen (Schema-"r"-Flag). */
  responsive: boolean;
  /** Erlaubte Werte bei select/choose — Server-"opts". */
  opts?: readonly string[];
  /** Wenn true: nur per CSS lösbar, native nicht verfügbar. */
  cssOnly?: boolean;
}

/**
 * Zweidimensional: (cssProperty, widgetType) → Mapping.
 * '*' als widgetType = Default für alle, spezifischer Eintrag gewinnt.
 */
export const SETTING_MAP: Record<string, Partial<Record<ElementorWidgetType | '*', SettingMapping>>> = {
  'color': {
    'heading':     { settingKey: 'title_color',       valueShape: 'color', responsive: false },
    'text-editor': { settingKey: 'text_color',        valueShape: 'color', responsive: false },
    'button':      { settingKey: 'button_text_color', valueShape: 'color', responsive: false },
    'accordion':   { settingKey: 'title_color',       valueShape: 'color', responsive: false },
    'icon-box':    { settingKey: 'title_color',       valueShape: 'color', responsive: false },
  },
  'background-color': {
    '*': { settingKey: 'background_color', valueShape: 'color', responsive: false,
           companions: { background_background: 'classic' } },      // ← der fehlende Companion
  },
  'font-size': {
    '*': { settingKey: 'typography_font_size', valueShape: 'slider', responsive: true,
           companions: { typography_typography: 'custom' } },
  },
  'gap': {
    'container': { settingKey: 'flex_gap', valueShape: 'gaps', responsive: true },
  },
  'align-items': {
    'container': { settingKey: 'flex_align_items', valueShape: 'select', responsive: true,
                   opts: ['flex-start','center','flex-end','stretch'] },
  },
  'justify-content': {
    'container': { settingKey: 'flex_justify_content', valueShape: 'select', responsive: true,
                   opts: ['flex-start','center','flex-end','space-between','space-around','space-evenly'] },
  },
  'padding': {
    'container': { settingKey: 'padding',  valueShape: 'dimensions', responsive: true },
    '*':         { settingKey: '_padding', valueShape: 'dimensions', responsive: true },  // Widgets!
  },
  'margin': {
    'container': { settingKey: 'margin',  valueShape: 'dimensions', responsive: true },
    '*':         { settingKey: '_margin', valueShape: 'dimensions', responsive: true },
  },
  'box-shadow': {
    '*': { settingKey: 'box_shadow_box_shadow', valueShape: 'raw', responsive: false,
           companions: { box_shadow_box_shadow_type: 'yes' } },
  },
  // … vollständige Tabelle: siehe §4.2 / §4.3
};
```

### 7.3 Auflösungsfunktion

```ts
export interface ResolvedSetting {
  key: string;
  value: unknown;
  companions: Record<string, unknown>;
}

export function resolveSetting(
  cssProperty: string,
  cssValue: string,
  widgetType: ElementorWidgetType,
  breakpoint?: 'tablet' | 'mobile',
): ResolvedSetting | { unsupported: true; reason: string };
```

**Breakpoint-Suffix (nicht Präfix!):**
```ts
const key = breakpoint && mapping.responsive
  ? `${mapping.settingKey}_${breakpoint}`     // padding_tablet  ✅
  : mapping.settingKey;
```

### 7.4 Migration der Altlasten

| Datei | Aktion |
|---|---|
| `target-v3/src/setting-first-policy.ts:60-83` | `ATTRIBUTE_TO_SETTING` löschen, auf `resolveSetting()` umstellen |
| `extractors/src/framer/setting-map.ts:39-203` | auf `SETTING_MAP` delegieren; `v4Reliable`-Flag als `cssOnly` übernehmen |
| `target-v3/src/visual-ir-to-v3.ts:256-277` | `toV3SettingKey` durch `resolveSetting()` ersetzen |
| `target-v3/src/classifier/responsive-settings.ts:96-104` | `cssPropToV3Key` löschen |

### 7.5 Akzeptanzkriterien P1

- [ ] `resolveSetting('color', '#fff', 'heading')` → `title_color`
- [ ] `resolveSetting('color', '#fff', 'text-editor')` → `text_color`
- [ ] `resolveSetting('color', '#fff', 'button')` → `button_text_color`
- [ ] `resolveSetting('background-color', …)` liefert Companion `background_background: 'classic'`
- [ ] `resolveSetting('font-size', …)` liefert Companion `typography_typography: 'custom'`
- [ ] `resolveSetting('padding', …, 'container')` → `padding`; `…, 'heading'` → `_padding`
- [ ] `resolveSetting('gap', …, 'container')` → `flex_gap` mit `gaps`-Shape
- [ ] Breakpoint erzeugt **Suffix**: `padding_tablet`, nie `tablet_padding`
- [ ] Unbekanntes Property → `{ unsupported, reason }`, **kein** stiller Drop
- [ ] Drift-Test: **jeder** `settingKey` in `SETTING_MAP` existiert im Server-Schema-Snapshot (siehe P2)
- [ ] Die vier Alt-Tabellen sind gelöscht; kein Produktionsimport verweist noch darauf

---

## 8. Arbeitspaket P2 — Schema-Gate

> Beendet die „unknown key"-Fehlerklasse. Verschiebt Fehler vom Deploy in den Build.

### 8.1 Neue Dateien

```text
packages/mcp/src/widget-schema.ts        fetchWidgetSchema() + Cache
packages/core/src/elementor/schema-gate.ts   validateSettingsAgainstSchema()
schemas/elementor-v3-controls.snapshot.json  committeter Fallback-Snapshot
```

### 8.2 Beschaffung und Cache

```ts
// mcp/src/widget-schema.ts
export interface WidgetControlSchema {
  t: string;                     // Control-Typ (select|slider|color|dimensions|gaps|…)
  opts?: readonly unknown[];     // erlaubte Werte
  def?: unknown;
  if?: Record<string, unknown>;  // Bedingung
  r?: 1 | { min?: string; max?: string };  // responsive-Fähigkeit
  arr?: boolean;
  rv?: string;                   // switcher-„an"-Wert
}

export type WidgetSchemaMap = Record<string, Record<string, WidgetControlSchema>>;

/**
 * Holt die Schemas der benötigten Widget-Typen live über
 * novamira/elementor-get-schema (action:'get', include_styles:true).
 * Cache: <cacheDir>/elementor-schema-<host>.json mit TTL.
 * Fällt bei Nichtverfügbarkeit auf den committeten Snapshot zurück und
 * meldet das ehrlich als degradedMode.
 */
export async function fetchWidgetSchema(
  adapter: McpAdapter,
  widgetTypes: readonly string[],
  options?: { cacheDir?: string; ttlHours?: number; forceRefresh?: boolean },
): Promise<{ schema: WidgetSchemaMap; source: 'live' | 'cache' | 'snapshot' }>;
```

**Aufrufkosten:** Ein Call für alle benötigten Typen. Verifiziert funktionierend mit `include_styles: true` + `control_names: [...]`. Die Server-Doku warnt explizit, dass breites `include_styles` auf V3-Widgets „sehr groß" wird — deshalb ist `control_names` aus `SETTING_MAP` abzuleiten, nicht `include_styles` pauschal.

### 8.3 Validierung

```ts
export interface SchemaViolation {
  elementId: string;
  widgetType: string;
  key: string;
  kind: 'unknown-key' | 'invalid-enum' | 'missing-companion'
      | 'unsatisfied-condition' | 'non-responsive-suffix' | 'wrong-shape';
  detail: string;
  /** Vorschlag aus Levenshtein-Nähe zu bekannten Keys. */
  suggestion?: string;
}

export function validateSettingsAgainstSchema(
  tree: V3Element[],
  schema: WidgetSchemaMap,
): { ok: boolean; violations: SchemaViolation[] };
```

**Sechs Prüfungen:**

1. **`unknown-key`** — Key existiert nicht in `schema[widgetType]`. Ausnahme-Whitelist: `_id`, `__globals__`, `_element_id`.
2. **`invalid-enum`** — Wert nicht in `opts` bei `t ∈ {select, choose, select2}`.
3. **`missing-companion`** — `background_color` ohne `background_background`; `typography_*` ohne `typography_typography:'custom'`; `box_shadow_box_shadow` ohne `box_shadow_box_shadow_type`.
4. **`unsatisfied-condition`** — Control hat `if`, dessen Bedingung im Settings-Objekt nicht erfüllt ist. (Server-Doku: „*do not emit controls whose `if` condition is not satisfied*".)
5. **`non-responsive-suffix`** — `<key>_tablet` bei einem Control ohne `r`-Flag.
6. **`wrong-shape`** — `dimensions` ohne `unit`/`isLinked`, `slider` ohne `{size,unit}`, `gaps` ohne `{column,row}`, `switcher` mit `true` statt `rv`-Wert.

### 8.4 Verdrahtung

| Stelle | Verhalten |
|---|---|
| `cli/src/schema-gate-cli.ts` | Gemeinsame Verdrahtung: `runSchemaGateOffline` (nur Snapshot) und `runSchemaGateLive` (Cache → Live → Snapshot), ein Verdikt-Shape für alle vier Kommandos. |
| `cli/src/cmd-convert.ts` `validateTree()` | Schema-Gate nach den Guards. Violations → Exit 1 mit Liste; `--skip-schema-gate` schaltet ab. Der URL-Report trägt `schemaGate` mit Quelle und Zählern. |
| `cli/src/cmd-doctor.ts` | Flag `--schema-check --tree <path>` (live mit `--target-name` bzw. `--mcp-url` + `--auth-env`, sonst Snapshot); `--json` liefert `SchemaViolation[]`. Der normale Doctor-Lauf zeigt das Gate zusätzlich als Preflight-Check. |
| `cli/src/cmd-deploy.ts` | Gate **vor** Snapshot. Kein Snapshot, kein Write bei Violations; `--force` übersteuert wie bei den Guards. |
| `cli/src/cmd-wizard.ts` | Phase `validate` schlägt fehl statt Phase `deploy`; live wenn Credentials konfiguriert sind, sonst Snapshot. |

**Offline-Verhalten:** Ohne MCP-Zugang wird gegen `schemas/elementor-v3-controls.snapshot.json` validiert und `source: 'snapshot'` gemeldet. Ein Drift-Test hält den Snapshot gegen das Live-Schema aktuell (analog `ability-schema.test.ts`).

### 8.5 Akzeptanzkriterien P2

Verdrahtung und Prüfungen sind implementiert; Nachweis in `tests/unit/core/schema-gate.test.ts` (67 Tests, Fixtures wortgleich aus dem committeten Snapshot), `tests/unit/cli/cmd-doctor.test.ts` (`--schema-check`, offline + live) und `tests/unit/cli/cmd-wizard.test.ts` (Abbruch in Phase `validate`).

- [x] `fetchWidgetSchema()` holt live und cached; zweiter Aufruf ohne Netz
- [x] `container` mit `gap` → `unknown-key`, `suggestion: 'flex_gap'`
- [x] `heading` mit `text_color` → `unknown-key`, `suggestion: 'title_color'`
- [x] `background_color` ohne Companion → `missing-companion` (aus der `if`-Bedingung abgeleitet, nicht aus einer Tabelle: `__container__` verlangt den Companion, `button` nicht, weil dort `background_background` einen `def` hat)
- [x] `flex_direction: 'vertical'` → `invalid-enum` (erlaubt: `row|column|row-reverse|column-reverse`)
- [x] `title_color_tablet` → `non-responsive-suffix` (`title_color` hat kein `r`)
- [x] `padding: 20` (Zahl statt `dimensions`) → `wrong-shape`
- [x] Der **real gescheiterte Baum** (110 unknown keys) wird vom Gate mit **allen** Violations in einem Durchlauf erkannt, bevor ein Deploy startet
- [x] `elconv deploy` bricht bei Violations **vor** dem Snapshot ab (`--force` übersteuert, `--skip-schema-gate` schaltet ab)
- [ ] Drift-Test: committeter Snapshot == Live-Schema für alle in `SETTING_MAP` referenzierten Keys

**Ehrlichkeitsgrenze (bewusst so gebaut):** Offline ist der Snapshot die einzige Quelle, also wird ein unbekannter Key zu `unverified-key` (Warning) herabgestuft statt zu `unknown-key` (Error) — ein veralteter Snapshot darf keinen Build wegen eines Controls scheitern lassen, das live existiert. Ein harter `unknown-key` entsteht nur gegen ein Live-Schema (`elconv doctor --schema-check` mit Credentials). Ebenso gilt das Gate nur für V3; ein V4-Atomic-Baum wird mit `skipped: 'target-v4'` übersprungen, weil `$$type`-Settings einer anderen Schema-Familie folgen.

---

## 9. Arbeitspaket P3 — Framer-Sektionierer

> Nutzt die Framer-Signale, die bereits gelesen werden können, aber nie gelesen werden.

### 9.1 Neue Dateien

```text
packages/extractors/src/framer/
  ├── section-segmenter.ts     data-framer-name + Geometrie → Sektionsgrenzen
  ├── variant-merger.ts        Desktop/Tablet/Phone-Varianten → eine Sektion
  └── breakpoint-reader.ts     __framer__breakpoints → Viewport-Profile
```

### 9.2 Drei Signale, in dieser Priorität

**Signal 1 — `data-framer-name` (primär).** Verifiziert: 696 Marker, davon 50 gruppierbare Blöcke ≥ 200 px Breite. Die Namen sind sprechend:

```text
Navbar (Dekstop)  Section Hero  Section About us  Section Process
Section Poduct    Testimonial Section  Section After/before  Section Blog
FAQs (DEKSTOP)    CTA (Dekstop)  Footer dekstop
```

Regel: Ein Knoten ist Sektionskandidat, wenn `data-framer-name` matcht:
```ts
/^(section|footer|navbar|header|cta|faqs?|testimonial)/i
```
**oder** wenn er direktes Kind des Seiten-Root-Containers ist mit `bbox.width ≥ 0.9 × viewportWidth` und `bbox.height ≥ 120`.

**Signal 2 — Geometrie-Bänder (Fallback).** Wenn Signal 1 < 3 Sektionen liefert: y-Achsen-Segmentierung über Background-Wechsel und Top-Level-Kinder. Diese Heuristik hat im manuellen Vorgehen funktioniert (9 Bänder korrekt erkannt).

**Signal 3 — `<section>`-Tags (Backstop).** `document.querySelectorAll('section')` — **ohne** Attribut-Einschränkung. Behebt Abbruch 1 direkt.

### 9.3 Varianten-Merge

Framer erzeugt pro Breakpoint **separate DOM-Knoten**. Verifizierte Namensmuster (inkl. Tippfehler „Dekstop" im Original):

```text
"CTA (Dekstop)"  "CTA (tablet)"  "CTA (phone)"
"FAQs (DEKSTOP)" "FAQs (TABLET)" "FAQs (PHONE)"
"Footer dekstop" "Footer Tablet" "Footer Phone"
"FAQs item open (dekstop)"  "FAQs itemClose (phone)"
```

**Normalisierung (bindend):**
```ts
const VARIANT_RE = /\s*\(?\s*(dekstop|desktop|tablet|phone|mobile)\s*\)?\s*$/i;

function normalizeVariantName(raw: string): { base: string; viewport: Viewport | null } {
  const m = raw.match(VARIANT_RE);
  if (!m) return { base: raw.trim(), viewport: null };
  const vp = m[1].toLowerCase();
  return {
    base: raw.replace(VARIANT_RE, '').replace(/\\/g, '').trim(),
    viewport: vp === 'dekstop' || vp === 'desktop' ? 'desktop'
            : vp === 'tablet' ? 'tablet' : 'mobile',
  };
}
```

**Merge-Regel:** Varianten mit gleichem `base` werden zu **einer** `VisualSectionIR`:
- Die **Desktop**-Variante liefert die Basis-Struktur und Basis-Styles.
- Tablet/Mobile liefern ausschließlich `responsiveOverrides` (Style-Diff gegen Desktop).
- Struktur-Unterschiede (Tablet hat andere Kindanzahl) → `evidence.structuralVariance: true` + Warnung im Report. Es wird **nicht** stillschweigend die Desktop-Struktur unterstellt.
- Fehlt Desktop, gewinnt die Variante mit der größten `bbox.height` (verifizierte Heuristik aus dem manuellen Rebuild).

### 9.4 Breakpoint-Reader

`<script type="framer/appear" id="__framer__breakpoints">` ist reines JSON-Array `[{hash, mediaQuery}]` (dokumentiert in `framer-data-extractor.ts:14-16`, verifiziert am Live-DOM). Daraus werden die Capture-Viewports abgeleitet, statt `[1440, 768, 390]` zu raten.

**Mapping auf Elementor:** Die Kit-Breakpoints sind live `desktop | tablet | mobile` (§4.1). Framer-Media-Queries werden auf diese drei projiziert; zusätzliche Framer-Breakpoints werden zum nächstgelegenen Elementor-Breakpoint zusammengefasst und die Zusammenfassung wird gemeldet.

### 9.5 Akzeptanzkriterien P3

- [ ] Framer-Fixture → **≥ 8 Sektionen** (Referenz: 9)
- [ ] `"CTA (Dekstop)"` + `"CTA (tablet)"` + `"CTA (phone)"` → **eine** Sektion mit 2 Override-Sets
- [ ] Der Tippfehler `Dekstop` wird als `desktop` erkannt
- [ ] `"Footer dekstop"` (ohne Klammern) wird ebenso normalisiert
- [ ] Signal 3 allein (`<section>` ohne Attribut) findet auf der Fixture 9 Kandidaten
- [ ] `__framer__breakpoints` wird gelesen; bei Fehlen greift der Default ohne Fehler
- [ ] **Keine leere Sektion** im Output — leere Kandidaten werden verworfen und gezählt
- [ ] Strukturelle Varianz zwischen Viewports erzeugt eine Warnung, keinen stillen Merge
- [ ] Regressionstest gegen die 3× FAQ / 3× CTA / 3× Footer-Duplikate des realen Falls: Ergebnis ist je **eine** Sektion

---

## 10. Arbeitspaket P4 — Native-First-Animationen

> Deine Anforderung wörtlich: Animationen möglichst übernehmen, WPCode nur wenn nativ nicht geht.

### 10.1 Was Elementor nativ kann (live verifiziert, §4.2/§4.3)

| Elementor-Control | Deckt ab |
|---|---|
| `_animation` (Widget) / `animation` (Container) | Entrance: `fadeIn`, `fadeInUp/Down/Left/Right`, `zoomIn`, `slideInUp`, `bounceIn`, … |
| `_animation_delay` (ms) / `animation_delay` | Stagger-Effekte über inkrementelle Delays |
| `animation_duration` | `slow` \| `""` \| `fast` |
| `motion_fx_motion_fx_scrolling: 'yes'` | Scroll-gekoppelte Effekte aktivieren |
| `motion_fx_translateY_effect` | Parallax vertikal |
| `motion_fx_opacity_effect` | Scroll-Fade |
| `sticky: 'top'\|'bottom'` + `sticky_on` | Sticky Header/Elemente |
| `hover_animation` | Hover-Effekte (`grow`, `shrink`, `pulse`, …) |

### 10.2 Mapping-Matrix Framer → Elementor

| Framer-Intent | Native Umsetzung | Fallback |
|---|---|---|
| Appear / Fade-in on scroll | `_animation: 'fadeIn'` | — |
| Appear + Y-Offset (Slide-up) | `_animation: 'fadeInUp'` | — |
| Appear + X-Offset | `_animation: 'fadeInLeft'` / `'fadeInRight'` | — |
| Appear + Scale | `_animation: 'zoomIn'` | — |
| Staggered children | pro Kind `_animation_delay = index × step` | — |
| Parallax (Scroll-Y) | `motion_fx_motion_fx_scrolling: 'yes'` + `motion_fx_translateY_effect` | — |
| Scroll-Opacity | `motion_fx_motion_fx_scrolling: 'yes'` + `motion_fx_opacity_effect` | — |
| Sticky Nav | `sticky: 'top'` + `sticky_on: ['desktop','tablet','mobile']` | — |
| Hover Scale / Lift | `hover_animation: 'grow'` | CSS `:hover` |
| **Marquee / Endlos-Loop** | ✗ | **WPCode CSS** (`@keyframes` + `animation: … infinite`) |
| **Counter / Zahl hochzählen** | Pro-Widget `counter` prüfen | WPCode JS |
| **Before/After-Slider** | ✗ | **WPCode JS + CSS** |
| **Scroll-Pin / Scrub** | ✗ | **WPCode GSAP ScrollTrigger** |
| **Text-Reveal (Zeichen/Wort)** | ✗ | **WPCode JS** (SplitText-Äquivalent) |
| **SVG-Path-Draw** | ✗ | **WPCode CSS** (`stroke-dashoffset`) |
| **Canvas / WebGL** | ✗ | `unsupported` mit Grund |

### 10.3 Neue Datei

```text
packages/target-v3/src/animation/
  ├── animation-mapper.ts      AnimationIR → native Settings | WPCode-Bedarf
  ├── native-animation-map.ts  die Matrix aus §10.2 als Daten
  └── wpcode-residual.ts       erzeugt Snippets NUR für den nicht-nativen Rest
```

```ts
export interface AnimationResolution {
  targetSourceId: string;
  strategy: 'native' | 'css-fallback' | 'js-fallback' | 'unsupported';
  /** Bei 'native': direkt in die Element-Settings mergebar. */
  settings?: Record<string, unknown>;
  /** Bei css/js-fallback: der zu erzeugende Snippet-Anteil. */
  snippet?: { kind: 'css' | 'js'; code: string };
  /** Immer gesetzt: warum diese Strategie. */
  reason: string;
}

export function mapAnimations(
  animations: readonly AnimationIR[],
  tree: V3Element[],
): { resolutions: AnimationResolution[]; nativeCount: number; fallbackCount: number };
```

### 10.4 Extraktionsseite (behebt Abbruch 9)

Die vier vorhandenen, nie aufgerufenen Module werden verdrahtet:

| Modul | Liefert |
|---|---|
| `browser/keyframes-discovery.ts` | echte `@keyframes`-Namen und -Bodies aus `document.styleSheets` (ersetzt `has_keyframes: false`) |
| `browser/animation-property-extractor.ts:132` | `animation-*` / `transition-*` pro Knoten |
| `browser/pseudo-state-capture.ts:131` | `:hover`-Styles → Hover-Animationen |
| `browser/custom-property-extractor.ts:148` | CSS-Custom-Properties für Token-Harvest (P0) |

Zusätzlich: **Framer-Motion-Erkennung auswerten.** `has_framer_motion` wird derzeit erhoben, aber von `buildAnimationPlan:337-346` ignoriert. Framer-Motion-Knoten tragen im DOM Marker (`data-framer-appear-id`, Inline-`opacity:0` + `transform` vor dem Reveal) — diese sind das Signal für `AnimationIR.kind: 'scroll'` bzw. `'load'`.

### 10.5 WPCode-Regeln (verbindlich)

- **Ein** Snippet pro Kategorie und Seite: `css` und `js` getrennt, nicht pro Element.
- Titelkonvention: `elconv-<pageId>-anim-css`, `elconv-<pageId>-anim-js`.
- `code_type: 'css'` bzw. `'js'`; für inline-HTML-Bedarf `'html'` (dokumentierter Gotcha in `AGENTS.md`).
- **`priority` niemals senden** (dokumentierter Gotcha, bestätigt durch `token-pipeline.ts:222`-Kommentar).
- Footer-Location ist `site_wide_footer`, **nicht** `site_footer`.
- `active: false` beim Erzeugen (Server-Default), dann bewusst aktivieren; die Response spiegelt den tatsächlichen Zustand (`status`, `last_error`).
- Jedes Snippet **page-scoped**: Wrapper `body.elementor-page-<id>` bzw. JS-Guard auf `document.body.classList`.
- Jedes JS-Snippet respektiert `prefers-reduced-motion` (bereits korrekt in `framer-animation-detector.ts:158-161` umgesetzt).
- CDN-URLs mit `cache_bust_token` versehen.

### 10.6 Akzeptanzkriterien P4

- [ ] `mapAnimations()` liefert für Fade-in/Slide-up/Zoom **native** Settings, kein Snippet
- [ ] Staggered children erhalten aufsteigende `_animation_delay`-Werte
- [ ] Sticky Nav → `sticky: 'top'` + `sticky_on`
- [ ] Parallax → `motion_fx_motion_fx_scrolling: 'yes'` + `motion_fx_translateY_effect`
- [ ] Marquee/Before-After/Scroll-Pin → `js-fallback` **mit Begründung**
- [ ] Canvas/WebGL → `unsupported` **mit Grund und Folgeaktion**
- [ ] `keyframes-discovery` liefert auf der Fixture ≥ 1 echten Keyframe-Namen (statt hartkodiert `[]`)
- [ ] `has_framer_motion: true` erzeugt tatsächlich `AnimationIR`-Einträge
- [ ] Report weist `nativeCount` und `fallbackCount` getrennt aus
- [ ] Maximal **2** WPCode-Snippets pro Seite (1× CSS, 1× JS)
- [ ] Kein Snippet ohne Page-Scope
- [ ] `priority` wird in keinem `create-wpcode-snippet`-Call gesendet
- [ ] Operator-Präzedenz-Bug `framer-animation-detector.ts:182` behoben + Regressionstest

---

## 11. Arbeitspaket P5 — Breakpoint-Suffix + Substanz-Guards

> Kleines Paket, große Wirkung: behebt zwei falsche Pfade und die Blindheit der Guards.

### 11.1 Suffix-Fix

| Datei:Zeile | Vorher | Nachher |
|---|---|---|
| `target-v3/src/responsive-breakpoint-mapper.ts:64` | `` `${bp}_${key}` `` | `` `${key}_${bp}` `` |
| `target-v3/src/visual-ir-to-v3.ts:108` | `` `${breakpoint}_${key}` `` | `` `${key}_${breakpoint}` `` |

Beide werden nach P1 durch `resolveSetting(prop, val, widgetType, breakpoint)` ersetzt, das den Suffix zentral erzeugt. Der direkte Fix bleibt trotzdem nötig, weil er unabhängig testbar ist und `responsive-breakpoint-mapper` auch vom XML-Pfad genutzt wird.

### 11.2 Guard-Fix

Der `endsWith`-Test existiert an **drei** Stellen, nicht nur im V3-Guard. Alle drei sind blind für Präfix-Keys und müssen mit:

| Datei:Zeile | Kontext | Wirkung des Fehlers |
|---|---|---|
| `target-v3/src/guards.ts:218-219` | `G4:breakpoint-coverage` | meldet Coverage 0, obwohl Präfix-Keys vorhanden sind — und meldet keinen Fehler |
| `packages/qa/src/cross-validator.ts:299` | `hasAnyBreakpoint` | Cross-Validation hält einen Präfix-Baum für „nicht responsive" statt für „falsch verdrahtet" |
| `target-v3/src/builder.ts:433` | erzeugt korrekt `_${breakpoint}` | **kein Fehler** — dient als Referenzimplementierung für die zentrale Helper-Funktion |

`target-v3/src/guards.ts:210-230` (`G4:breakpoint-coverage`) prüft nur `endsWith('_tablet')`. Erweiterung:

```ts
// Erkennt BEIDE Formen und schlägt bei der falschen an.
const PREFIX_RE = /^(tablet|mobile)_/;
const SUFFIX_RE = /_(tablet|mobile)$/;

// 1. Suffix-Keys zählen → Coverage-Metrik (wie bisher)
// 2. Präfix-Keys finden → NEUER Fehler 'G4b:breakpoint-prefix-misuse' (critical)
//    Message: "N settings use the tablet_/mobile_ prefix; Elementor requires
//              the _tablet/_mobile suffix. These settings are silently ignored."
```

Damit die drei Fundorte nicht auseinanderlaufen, wandern beide Regexe plus ein
`hasBreakpointSuffix(key)` / `hasBreakpointPrefix(key)`-Paar in **eine** Quelle
(`packages/core/src/breakpoints.ts`) und werden von `guards.ts` und
`cross-validator.ts` importiert. Kein lokales `endsWith` mehr.

### 11.3 Substanz-Guards (neu) — verhindert „100/100 bei 496 Bytes"

Der schärfste Einzelbefund dieses Plans ist, dass ein leerer Baum die Guards perfekt passiert. Vier neue Guards:

```ts
// G_SUBSTANCE_WIDGETS  (critical)
//   Mindestens 1 Widget pro Top-Level-Container.
//   Fail: "Container <id> has no widgets — extraction produced an empty section."

// G_SUBSTANCE_TEXT  (critical)
//   Jedes heading/text-editor/button hat nicht-leeren Content
//   (title / editor / text).
//   Fail: "N text-bearing widgets have empty content."

// G_SUBSTANCE_RATIO  (warning)
//   widgetCount / sectionCount >= 3.
//   Warn: "Only N widgets across M sections — likely under-extraction."

// G_SUBSTANCE_STYLED  (warning)
//   Anteil der Elemente mit mindestens einem Style-Setting
//   (background_*, typography_*, padding, margin, *_color) >= 50 %.
//   Warn: "Only N% of elements carry visual settings — styles may be lost."
```

**Diese Guards sind bindend `critical` bzw. `warning` wie angegeben.** `G_SUBSTANCE_WIDGETS` und `G_SUBSTANCE_TEXT` müssen den heutigen Fehlfall (1 Sektion, 0 Widgets) mit Exit 1 ablehnen.

### 11.4 Akzeptanzkriterien P5

- [x] `padding_tablet` wird erzeugt, `tablet_padding` nirgends mehr
- [x] Guard `G4b` schlägt bei Präfix-Keys an (`critical`)
- [x] Guard `G4` zählt Suffix-Keys korrekt als Coverage
- [x] `qa/src/cross-validator.ts` erkennt Präfix-Keys und meldet sie als Fehlverdrahtung, nicht als „nicht responsive"
- [x] Breakpoint-Erkennung existiert nur noch einmal (`packages/core/src/breakpoints.ts`); kein lokales `endsWith('_tablet')` mehr im Repo
- [x] **Der heutige 496-Byte-Tree erreicht nicht mehr 100/100**, sondern fällt mit `G_SUBSTANCE_WIDGETS` durch
- [x] Ein Tree mit leeren `title`/`editor` fällt mit `G_SUBSTANCE_TEXT` durch
- [ ] Der manuelle Rebuild-Tree (132 Widgets, 9 Sektionen) besteht alle neuen Guards
- [x] Bestehende 13 Guards bleiben grün (Regression)

### 11.5 Umsetzungsstand P5 (2026-08-24)

**Erledigt.** Vollsuite 127 Dateien / 1546 Tests grün, `tsc --build` und ESLint sauber.

Neue Datei:

| Datei | Inhalt |
|---|---|
| `packages/core/src/breakpoints.ts` | `RESPONSIVE_BREAKPOINTS`, `BREAKPOINT_SUFFIX_RE`, `BREAKPOINT_PREFIX_RE`, `hasBreakpointSuffix/Prefix`, `isBreakpointKey`, `breakpointOf`, `breakpointKey`, `baseControlId`, `findPrefixedBreakpointKeys`, `findSuffixedBreakpointKeys` |

Geänderte Dateien:

| Datei | Änderung |
|---|---|
| `packages/core/src/index.ts` | Barrel-Export |
| `target-v3/src/responsive-breakpoint-mapper.ts` | `${bp}_${key}` → `breakpointKey(key, bp)`; neues `rejectedKeys` im Report statt stiller Doppel-Suffixe |
| `target-v3/src/visual-ir-to-v3.ts` | `${breakpoint}_${key}` → `breakpointKey(...)`; `RESPONSIVE_BREAKPOINTS` aus core |
| `target-v3/src/guards.ts` | `G4` nutzt `isBreakpointKey`; **`G4b`** neu (critical); **4 Substanz-Guards** neu → 18 statt 13 Guards |
| `qa/src/cross-validator.ts` | `CV4` unterscheidet Präfix-Fehlverdrahtung (`error`) von „keine Overrides" (`warning`) |
| `target-v3/src/framer-build-orchestrator.ts` | warnt bei `rejectedKeys` in Stage 4 |

Neue Tests: `tests/unit/core/breakpoints.test.ts` (24), `tests/unit/qa/cross-validator-breakpoints.test.ts` (7), `tests/unit/target-v3/responsive-breakpoint-mapper.test.ts` (6), Erweiterungen in `json-guard.test.ts` (+18) und `visual-ir-to-v3.test.ts` (+2).

**Zwei Fundorte, die im Plan fehlten** (beim Umsetzen aufgetaucht):

1. `hide_tablet` / `hide_mobile` sind **echte Elementor-Controls** (Sichtbarkeits-Switcher), die auf ein Breakpoint-Wort enden, ohne responsive Overrides zu sein. Ein naiver Suffix-Test zählt sie als Tablet-Override und fordert dann einen Mobile-Override, der nicht existieren darf. Live verifiziert per `elementor-get-schema` (`__container__`, `heading`, 2026-08-24): registriert sind genau `hide_desktop` / `hide_tablet` / `hide_mobile` (`t: switcher`, `rv: hidden-*`). Ausnahmeliste: `NON_RESPONSIVE_BREAKPOINT_SUFFIXED_CONTROLS`.
2. Zwei bestehende Tests kodierten den Fehlfall als Soll-Zustand und mussten korrigiert werden — genau die Klasse, die §11.3 aufdeckt:
   - `tests/unit/cli/cmd-convert.test.ts`: Fixture war 1 Sektion / 1 Widget ohne Styles und erwartete `guardScore: 100`. Jetzt substanzhaltig (3 Widgets, Styles auf jedem Element).
   - `tests/unit/cli/cmd-wizard.test.ts`: erwartete Exit `0` bei leerem Tree nach `--sections`-Filter. Jetzt Exit `1` bei leerem Artefakt — der Durchstich wird über das leere Artefakt **plus** den Fehlercode belegt.

Offen bleibt nur das letzte Kriterium: der manuelle Rebuild-Tree (132 Widgets / 9 Sektionen) liegt nicht als Fixture im Repo und ist erst nach P0/P3 reproduzierbar.

---

## 12. Arbeitspaket P6 — Global-Kit-Sync

> Farben und Fonts global setzen statt pro Widget wiederholen. Macht den Output editierbar und wartbar.

### 12.1 Korrektur der falschen Annahme

`core/src/token-pipeline.ts:179-197` baut Calls mit `{ ability: 'set-active-kit', params: { section, values } }`. Die **live verifizierte** Signatur ist `{ kit_id: integer }` (§4.4). Der Baustein ist damit gegen ein Schema gebaut, das nicht existiert.

**Korrekter Weg:**

```text
1. novamira/elementor-create-v3-color        pro Farbe → { title, color }
2. novamira/elementor-create-v3-typography   pro Textstil → { title, font_family, font_size{size,unit}, ... }
3. novamira-adrianv2/register-google-font    pro Google-Font-Familie
4. (optional) novamira-adrianv2/set-active-kit { kit_id }  nur wenn Kit gewechselt wird
```

Alternativ der bereits funktionierende PHP-Weg aus `font-kit-bridge.ts:176-207`, der `_elementor_page_settings.system_typography` des aktiven Kits idempotent erweitert. Dieser Ansatz ist korrekt implementiert und sollte für Typography beibehalten werden; für Colors kommt `elementor-create-v3-color` dazu.

### 12.2 Producer für `designTokens` (behebt Abbruch 7)

Der Grund, warum Stage 4 nie läuft, ist ein fehlendes Feld. P0 löst das: `IR.tokens` ist der Producer. Die Pipeline-Bedingung wird umgestellt:

```ts
// analysis/pipeline.ts:496 — vorher
if (!skip.has(4) && extraction?.designTokens && options.syncToMcp) {

// nachher
if (!skip.has(4) && visualIr?.tokens && options.syncToMcp) {
```

### 12.3 Token-Auswahl (nicht alles synchronisieren)

Nicht jede Farbe im DOM gehört ins Kit. Regeln:

- **Farbe wird Kit-Color**, wenn sie an ≥ 3 Elementen vorkommt **oder** aus einer CSS-Custom-Property stammt (`--token-*`).
- **Textstil wird Kit-Typography**, wenn das Cluster (family+size+weight+lineHeight) an ≥ 2 Elementen vorkommt.
- Framer-`* Placeholder`-Fontfamilien werden **immer** verworfen.
- Maximal 12 Kit-Colors und 10 Kit-Typographies pro Seite; darüber hinaus bleiben Werte inline (mit Meldung im Report).

**Verifiziert am Beispiel:** 10 `--token-*` (davon 8 sinnvoll: `#1c1812`, `#3f5030`, `#fff8f1`, `#fff`, `#737373`, `#3e4f2f4d`, `#3f503026`, `#ffffff80`) und 2 echte Familien (`Inter`, `Lora`).

### 12.4 Reihenfolge im Deploy

Kit-Sync muss **vor** dem Seiten-Deploy laufen, damit Widgets auf Globals verweisen können. Für V3 geschieht das über `__globals__`:

```json
{ "elType": "widget", "widgetType": "heading",
  "settings": { "title": "…", "__globals__": { "title_color": "globals/colors?id=primary" } } }
```

Dieser Mechanismus ist **nicht** schema-verifiziert und daher zunächst **nicht** produktiv zu nutzen. P6 setzt Globals im Kit an und schreibt die Werte weiterhin inline; die `__globals__`-Verlinkung ist ein Folgepaket mit eigener Live-Verifikation.

### 12.5 Akzeptanzkriterien P6

- [ ] `IR.tokens.colors` → Kit-Colors über `elementor-create-v3-color`, idempotent (kein Duplikat bei Zweitlauf)
- [ ] `IR.tokens.textStyles` → Kit-Typographies, idempotent
- [ ] Google-Fonts werden über `register-google-font` registriert; lokale woff2 werden ausgewiesen
- [ ] `* Placeholder`-Familien werden verworfen
- [ ] `set-active-kit` wird **nur** mit `{ kit_id }` aufgerufen — nie mit `{ section, values }`
- [ ] Stage 4 läuft, wenn `IR.tokens` vorhanden ist (nicht mehr blockiert)
- [ ] Ohne MCP-Zugang: `unavailable` mit Grund, **kein** Fehlschlag
- [ ] Read-back bestätigt die Kit-Einträge nach dem Sync
- [ ] `token-pipeline.ts` ist entweder korrigiert oder als toter Code entfernt — kein Zwischenzustand

---

## 13. Reihenfolge, Abhängigkeiten, Aufwand

### 13.1 Abhängigkeitsgraph

```text
P2 (Schema-Gate) ──────────────┐
                               ├──► P1 (Setting-Map)  ──┐
P0 (VisualIR-Producer) ────────┤                        ├──► P4 (Animationen)
                               │                        │
P3 (Framer-Sektionierer) ──────┘                        ├──► P6 (Global Kit)
                                                        │
P5 (Suffix + Substanz-Guards) ──── unabhängig ──────────┘
```

**Begründung der Reihenfolge:**
- **P2 zuerst**, weil P1 seine Keys gegen das Schema verifizieren muss. Ohne P2 baut P1 wieder auf Annahmen.
- **P0 parallel zu P2** möglich (unterschiedliche Pakete, keine gemeinsamen Dateien).
- **P1 nach P2+P0**, weil es beide braucht: Schema als Wahrheit, IR als Datenquelle.
- **P3 nach P0** (erweitert den Producer).
- **P5 jederzeit** — reine Reparatur, keine Abhängigkeit. Kann als Erstes gemacht werden, um sofort ehrliche Guards zu haben.
- **P4 und P6 zuletzt**, weil sie auf der fertigen Map aufsetzen.

### 13.2 Priorisierung

| Prio | Paket | Warum | Aufwand (grob) |
|---|---|---|---|
| **P0** | P5 Substanz-Guards | Sofort ehrliche Ergebnisse; verhindert falsches Vertrauen | 3–4 h |
| **P0** | P2 Schema-Gate | Beendet die teuerste Fehlerklasse; Voraussetzung für P1 | 6–8 h |
| **P0** | P0 VisualIR-Producer | Der Hebel: 7 von 9 Abbrüchen | 12–16 h |
| **P1** | P1 Setting-Map | Behebt `color`/Companion-Klasse; eine Wahrheit | 6–8 h |
| **P1** | P3 Framer-Sektionierer | Sektionen + Varianten-Merge | 8–10 h |
| **P2** | P4 Animationen | Deine explizite Anforderung | 10–12 h |
| **P2** | P6 Global Kit | Wartbarkeit, Editierbarkeit | 5–7 h |
| **P3** | Reparaturen §3.7 | `setting-first-css-generator`-Pfad, Präzedenz-Bug | 2–3 h |

**Gesamt: ca. 52–68 h.** Der Anteil echter Neuentwicklung ist gering (P0-Producer, P1-Tabelle, P2-Gate); der Rest ist Verdrahtung bereits vorhandener, getesteter Module.

### 13.3 Was NICHT Teil dieses Plans ist

- V4-Atomic-Pfad (bleibt unberührt; die V3/V4-Isolation gilt weiter)
- `upload-php`/`split`-Deploy-Freischaltung (eigener Fahrplan: `docs/LARGE-DEPLOY-VERIFICATION-2026-08-04.md`)
- Code Components, Canvas/WebGL, authentifizierte App-Zustände (Charta §2: außerhalb eines statischen V3-Trees)
- CMS-Collections (Framer-CMS → WP-Posts) — separates Thema
- Multi-Page-Konvertierung (`elconv batch` existiert; profitiert automatisch von P0–P6)

---

## 14. Definition of Done (Gesamtpaket)

### 14.1 Funktionale Gates

- [ ] `elconv convert --target v3 --url <framer>` erzeugt auf der Referenz-Fixture:
  - ≥ 8 Top-Level-Container
  - ≥ 100 Widgets
  - ≥ 80 Widgets mit nicht-leerem Text
  - ≥ 50 % Elemente mit Style-Settings
- [ ] Schema-Gate: **0** Violations vor dem Deploy
- [ ] Deploy gegen isoliertes Ziel: erfolgreich **ohne** Retry und ohne „unknown key"
- [ ] Read-back bestätigt Elementanzahl und Content-Stichproben
- [ ] Cache-Clear ausgeführt, Frontend erreichbar
- [ ] Multi-Viewport-Capture (desktop/tablet/mobile) erfolgreich
- [ ] `elconv qa --url <permalink> --ref-url <framer>`: **SSIM/Pixel-Score ≥ 0,85** (`balanced`)
- [ ] Höhenverhältnis Rebuild/Original zwischen **0,9 und 1,1**
- [ ] Animationen: nativ umgesetzte Anteile sichtbar; Fallback-Anteile im Report begründet
- [ ] Maximal 2 WPCode-Snippets, beide page-scoped

### 14.2 Report-Gate (Charta §2)

Der Report weist **pro Sektion** aus:

```text
native %  |  css-fallback %  |  js-fallback %  |  static-approximation %  |  unsupported (Liste mit Grund)
```

- [ ] **native ≥ 80 %** aller Nodes (Marktkalibrierung: ~84 %)
- [ ] **unsupported ≤ 5 %**, jeder Eintrag mit Grund und Folgeaktion
- [ ] Kein Node ohne Fidelity-Decision
- [ ] `collapsedWrappers`, `inferredHeading`, `structuralVariance` sind ausgewiesen

### 14.3 Technische Gates (bindend, aus `AGENTS.md`)

```bash
npx tsc --build --clean
npx tsc --build --pretty false                                    # Exit 0
npx vitest run --pool=forks --maxWorkers=1 --minWorkers=1 --testTimeout=15000
npx eslint packages/core/src packages/extractors/src packages/target-v3/src packages/mcp/src packages/cli/src
git diff --check
```

- [ ] Clean-Build grün
- [ ] Serielle Vollsuite grün
- [ ] Lint 0 Fehler / 0 Warnungen
- [ ] V3/V4-Isolation intakt (`assertNoContamination`)
- [ ] Keine Secrets in Code, Doku, Reports oder Git
- [ ] Ein Fund pro Commit
- [ ] `git fetch origin` vor jedem Push (parallele Sessions sind real)

### 14.4 Regressionsnachweise (pro Paket bindend)

| Paket | Regressionstest |
|---|---|
| P0 | Offline-HTML-Fixture → IR mit ≥ 8 Sektionen, ≥ 150 Texten, deterministisch |
| P1 | `color`-Matrix über 5 Widget-Typen; Companion-Vollständigkeit; Suffix-Form |
| P2 | Der real gescheiterte Baum (110 unknown keys) wird vollständig erkannt |
| P3 | 3× FAQ / 3× CTA / 3× Footer → je **eine** Sektion; `Dekstop`-Tippfehler |
| P4 | Fade/Slide/Zoom → native; Marquee/Before-After → begründeter Fallback |
| P5 | 496-Byte-Tree fällt durch; Präfix-Keys lösen `G4b` aus |
| P6 | Zweitlauf erzeugt keine Duplikate im Kit |

---

## 15. Risiken und Gegenmaßnahmen

| Risiko | Auswirkung | Gegenmaßnahme |
|---|---|---|
| Framer ändert DOM-Struktur (Klassennamen, `data-framer-name`) | Sektionierer bricht | Drei-Signal-Kaskade (P3 §9.2): Geometrie und `<section>` funktionieren ohne Framer-Spezifika |
| Elementor-Version ändert Control-Namen | Alle Deploys brechen | Schema-Gate (P2) fängt das im Build; Drift-Test hält Snapshot aktuell |
| Server-Schema nicht abrufbar | Kein Gate | Committeter Snapshot + `degradedMode`-Meldung; Deploy bleibt möglich, aber Report weist die Degradierung aus |
| Tiefe Framer-Verschachtelung → unbenutzbarer Elementor-Baum | Kunde kann nicht editieren | Container-Kollaps (P0 §6.5) mit gezählter Meldung |
| Framer-Motion-Marker fehlen (SSR-Variante) | Animationen unerkannt | Zusätzlich Keyframes + Transitions + Pseudo-States auswerten (P4 §10.4); bei 0 Treffern ehrlich `hasAnimations: false` |
| WPCode nicht installiert | Fallbacks nicht deploybar | `elconv preflight` blockt heute korrekt; P4-Report weist die betroffenen Animationen als `unavailable` aus statt sie zu verschweigen |
| Bild-Duplikate in der Mediathek (`-2`, `-3`) | Zugemüllte Mediathek | Hash-basierte Dedup vor Upload; `batch-media-upload`-Response-Namen normalisieren (§4.4-Gotcha) |
| Guard-Verschärfung (P5) lässt Bestandsfixtures durchfallen | CI rot | Fixtures prüfen: fallen sie zu Recht durch (leer) oder ist der Guard zu streng? Erst dann Schwellwert justieren |
| Kit-Sync überschreibt Kundenfarben | Datenverlust im Kit | Nur **hinzufügen**, nie überschreiben; Idempotenz per Titel-Match; Snapshot des Kits vor dem Sync |

---

## 16. Verbindliche Arbeitsregeln (aus `AGENTS.md`, gelten für jedes Paket)

1. **Modulquelle vollständig lesen**, bevor sie geändert wird.
2. **Tests mit echten Assertions** für jede Änderung — keine Smoke-Only-Tests.
3. **Verifikationskette:** `tsc --build` → betroffene Tests → Vollsuite (seriell) → Lint.
4. **Ein Fund pro Commit.**
5. **`git fetch origin` vor jedem Push** — parallele Sessions sind auf diesem Repo real.
6. **Sprache:** Deutsch mit dem Nutzer, Englisch in Code-Kommentaren.
7. **ESM:** `type: "module"`, `.js`-Endungen in Imports.
8. **Windows-sichere Pfade:** `os.homedir()`, niemals `~/`.
9. **Keine Secrets** in Code, Doku, Remote-URLs oder Reports.
10. **Ehrliche Statusbegriffe:** `ok` / `skipped` / `unavailable` / `failed` / `not-scored` (`REPOSITORY-MAP.md` §5). Ein erfolgreicher MCP-Write ohne Read-back und Frontendprüfung ist **kein** visueller Erfolg.

---

## 17. Nächste Schritte

1. ~~**P5 Substanz-Guards** (3–4 h)~~ — **erledigt 2026-08-24**, siehe §11.5. Die Guards lügen nicht mehr; ab hier ist jeder Fortschritt messbar.
2. **P2 Schema-Gate** (6–8 h) — beendet die teuerste Fehlerklasse, Voraussetzung für P1.
3. **P0 VisualIR-Producer** (12–16 h) — der Hebel.
4. Danach P1 → P3 → P4 → P6 nach §13.

**Referenz-Fixture für alle Pakete:** `FramerSites/original-tables-638990-framer-app-optimized/index.html` (604 KB, 9 Sektionen, 696 `data-framer-name`, 10 `--token-*`, 4 `@font-face`, 23 Bilder). Als Offline-Fixture einfrieren, damit alle Tests ohne Netz laufen.

**Referenz-Zielwerte** (aus dem manuellen Rebuild, dokumentiert in dieser Session):
- 9 Top-Level-Container, 132 Widgets
- Fonts: Lora (H1 70 px, H2 50 px), Inter (Eyebrow 14 px)
- Farben: `#FFF8F1` (Creme), `#1C1812` (Ink), `#3F5030` (Grün), `#737373` (Gray)
- Höhe 6666 px vs. Original 7534 px (88 %)

---

## 18. Querverweise

| Dokument | Rolle |
|---|---|
| [`REPOSITORY-CHARTA.md`](./REPOSITORY-CHARTA.md) | Verbindlicher Zielvertrag, Fallback-Stufen, Definition of Done |
| [`REPOSITORY-MAP.md`](./REPOSITORY-MAP.md) | Lesereihenfolge, Statusbegriffe, Sicherheitsgrenzen |
| [`AGENTS.md`](../AGENTS.md) | Arbeitsregeln, CLI, Gotchas |
| [`NOVAMIRA-ABILITY-PLAYBOOK.md`](./NOVAMIRA-ABILITY-PLAYBOOK.md) | Ability-Lookup pro Pipeline-Schritt — **§4 dieses Dokuments korrigiert die Aussage, `elementor-get-schema` sei optional** |
| [`TODO-OFFEN-2026-07-31.md`](./TODO-OFFEN-2026-07-31.md) | Aktueller Arbeitsstand vor diesem Plan |
| [`BAUPLAN-v5.0`](./BAUPLAN-v5.0-KONVERGENZ-NOVAMIRA-WIZARDS-2026-07.md) | Vorgänger (Phasen 100–115, abgeschlossen) |
| [`LARGE-DEPLOY-VERIFICATION-2026-08-04.md`](./LARGE-DEPLOY-VERIFICATION-2026-08-04.md) | Separater Fahrplan für `upload-php`/`split` |

---

**Ende BAUPLAN v6.0**

# BAUPLAN v7.0 — Generischer Framer→Elementor-V3-Pfad

**Datum:** 2026-08-26
**Auslöser:** Realer Konvertierungsversuch `loud-alternative-352151.framer.app` (Projekt „Humeen", 10 Seiten, 56 Komponenten). Beide vorhandenen Eingangspfade liefern unbrauchbare Ergebnisse; Animationen werden zu 0 % übernommen.
**Verhältnis zu v6.0:** `BAUPLAN-v6.0-FRAMER-FIDELITY-2026-08.md` bleibt gültig. v7.0 ergänzt es um **neu verifizierte Befunde** (Unframer-MCP als nutzbare Quelle, WPCode-Vertragsdrift gegen das Live-Schema, `css_classes`-Namensspaltung) und ordnet die Arbeit neu, weil sich der Zugang zur Quelle geändert hat.
**Zielbild:** Ein beliebiges Framer-Projekt wird über **eine** Quell-Adapter-Schnittstelle eingelesen, passiert `VisualPageIR`, und wird mit **nativen Elementor-Settings zuerst** emittiert. WPCode nur für nachweislich nicht-nativen Rest.

> Jeder Befund in diesem Dokument ist durch Messung oder Schema-Abfrage belegt. Wo etwas nicht verifiziert ist, steht das ausdrücklich dabei.

---

## 1. Messbasis dieses Bauplans

| Prüfung | Kommando / Methode | Ergebnis |
|---|---|---|
| URL-Pfad | `elconv convert --target v3 --url <framer>` | 2 Sektionen, **0 Widgets**, 0 Styles, Guard 70/100 FAILED |
| HTML-Pfad | `elconv convert --target v3 --html index.html` | 388 Knoten, aber Wortsalat; Guard 95/100, Schema-Gate FAIL (6 Fehler) |
| Unframer-MCP | `getProjectXml` + `getNodeXml(augiA20Il)` | **funktioniert**; echter Layer-Tree mit Namen, Layout, Textstil-Referenzen |
| Animations-Evidenz | Playwright, 7 Scroll-Positionen, Computed-Style-Diff | 31 animierte Elemente, klassifiziert (§4.1) |
| Elementor-Controls | `schemas/elementor-v3-controls.snapshot.json` (live von `testseite.nick-webdesign.de`, 2026-08-24) | alle Animations-Controls vorhanden, `missing: []` |
| WPCode | `mcp-adapter-get-ability-info` live | Input-Schema weicht vom Repo-Payload ab (§5) |
| WPCode-Setup | `novamira-adrianv2/wpcode-check-setup` | aktiv, 2.3.8, `permissions_ok: true`, `issues: []` |

Alle Artefakte liegen unter `output/loud-alt-2026-08-26/` (gitignored). Die Messskripte sind derzeit **Wegwerf-Code** — sie zu Modulen zu machen ist Arbeitspaket A2.

---

## 2. Kernproblem in einem Satz

Das Repo hat einen sauberen target-neutralen Vertrag (`VisualPageIR`) und einen funktionierenden Consumer (`visual-ir-to-v3.ts`) — **aber keinen einzigen Producer**. Deshalb laufen alle realen Konvertierungen über zwei Legacy-Pfade, die beide strukturell zu schwach sind, und der native-first-Grundsatz aus `setting-first-policy.ts` wird an der wichtigsten Stelle (Animationen) nie angewendet.

Belege:

```
grep "SourceAdapter"  → nur core/src/contracts/visual-ir.contract.ts:79  (Interface, 0 Implementierungen)
grep "VisualPageIR"   → nur contract (153, 182) + target-v3/visual-ir-to-v3.ts  (0 Producer)
grep "_animation"     → kein Emitter schreibt es; nur Schema + Doku
```

---

## 3. Arbeitspaket A — Quelle (P0, blockiert alles)

### 3.1 Befund: `html-parser.ts` ist für Framer strukturell untauglich

`packages/extractors/src/html-parser.ts` (202 Zeilen) arbeitet regex-basiert und flach. Gegen Framer-Output bedeutet das konkret:

| Zeile | Code | Wirkung auf Framer |
|---|---|---|
| `85` | `headingRegex = /<h([1-6])[^>]*>…/` | Framer setzt **pro Wort** ein `<h3>` in `stackWrap`-Layouts → gemessen 140 Heading-Widgets mit Inhalten `"We're"`, `"Wegency"`, `"digital"`, `"studio"` |
| `92` | `font-size: max(48-(level-1)*8, 16)px` | **erfundene** Größe; die echte steht im Textstil (`/Heading 3` = 68px) |
| `117` | `btnRegex` verlangt `class="…btn…"` | Framer nutzt nie `btn` → **0 Buttons** von 86 `<a>`-Tags erkannt |
| `81–128` | `parseWidgets` gibt eine **flache** Liste | keine Container-Verschachtelung; Framers Stack/Grid-Struktur ist verloren |
| `44` | `sectionRegex` über den ganzen String | Desktop-/Phone-/Tablet-Varianten des Exports werden **alle** übernommen → jeder Text doppelt bis dreifach |
| `141–159` | `extractTokensFromCss` zählt Hex-Codes | ignoriert Framers `var(--token-…)`-System vollständig |

**Entscheidung:** `extractFromHtml` wird **nicht reparariert**. Es bleibt als Kompatibilitätspfad für echte statische HTML-Seiten und bekommt eine Framer-Erkennung, die ehrlich abbricht:

```ts
// html-parser.ts — refuse to silently under-extract Framer output.
if (/data-framer-name|__framer__breakpoints/.test(html)) {
  spec.warnings.push(
    'framer-output-detected: the regex HTML path cannot preserve Framer text nodes, ' +
    'component instances or nesting. Use the Unframer adapter (--framer-project) ' +
    'or the live-DOM adapter (--url) instead.',
  );
}
```

**Akzeptanz:** Ein Framer-HTML-Export durch `--html` erzeugt eine sichtbare Warnung und wird in `conversion-report.json` als `source-degraded` geführt — nicht mehr als stiller Erfolg.

### 3.2 Befund: `section-detector.ts` findet Framer-Sektionen nicht

`packages/extractors/src/browser/section-detector.ts:28-34` sucht:

```
'section[id]', 'section[class*="section"]', '[data-section]', '[role="region"]', …
```

Framer liefert aber:

```html
<section class="framer-gemdf9" data-framer-name="Hero">
```

Kein `id`, kein `section` im Klassennamen, kein `data-section`. Von 18 `<section>`-Tags trifft **keines**. Übrig bleiben nur die generischen `main` und `footer` — daher die gemessenen 2 Sektionen mit 0 Widgets.

**Fix (klein, sofort):** `data-framer-name` als Selektor ergänzen und den `minHeightPx`-Filter nicht auf Framer-benannte Knoten anwenden:

```ts
const SECTION_SELECTORS = [
  'section[id]', 'section[class*="section"]', '[data-section]',
  // Framer emits <section class="framer-xxx" data-framer-name="Hero"> — no id,
  // no "section" in the class name. Verified against real Framer output.
  'section[data-framer-name]', 'div[data-framer-name][class*="framer-"]',
  '[role="region"]', 'article', 'aside',
  'header[role="banner"]', 'footer[role="contentinfo"]',
  'main[role="main"]', 'nav[role="navigation"]',
  'header', 'footer', 'main', 'nav',
].join(', ');
```

**Wichtig:** Das ist ein Pflaster, kein Ersatz für A3. Es hebt den `--url`-Pfad von „0 Widgets" auf „Sektionen erkannt", löst aber Textstile, Komponenten und Varianten nicht.

**Akzeptanz:** `detectSections` liefert für diese Seite ≥ 10 Sektionen mit den Namen `Hero, About, Projects, Partners, Services, Awards, Rating, CTA, Blogs, …`. Regressionstest mit einem eingefrorenen Framer-DOM-Fixture.

### 3.3 Neu: `UnframerSourceAdapter` — der fehlende Producer

Der Unframer-MCP ist **verifiziert nutzbar** und die mit Abstand beste Quelle. Er liefert:

| Aufruf | Inhalt (gemessen) |
|---|---|
| `getProjectXml` | 10 Seiten mit `nodeId`+`path`, 56 Komponenten mit `nodeId`+`name`, 2 Code-Components, 14 Farbstile (`/Purple` = `rgb(127,81,255)`, …), 14 Textstile (`/Heading 1` = 150px/1em/-6px, tag `h1`, …) |
| `getNodeXml(pageId)` | echter Layer-Tree: `layout="stack"`, `stackDirection`, `stackDistribution`, `gap`, `padding`, `maxWidth`, `backgroundColor="/Dark"`, `inlineTextStyle="/Heading 1"`, `position="sticky"` + `top` |
| `getNodeXml(componentId)` | die echte Komponenten-Definition statt Namensraten |
| `readCodeFile(id)` | vollständiger Quellcode der Code-Components |

Das ist genau das, was `VisualPageIR` braucht — inklusive der Dinge, die aus dem DOM **nicht** rekonstruierbar sind: Textstil-Zuordnung, Farbstil-Referenz, Komponenten-Identität, Instanz-Overrides.

**Neue Dateien:**

```
packages/extractors/src/framer/
  unframer-source-adapter.ts     implements SourceAdapter (contract:79)
  unframer-xml-parser.ts         Unframer-XML → generischer Knotenbaum
  unframer-ir-builder.ts         Knotenbaum + Styles → VisualPageIR
  unframer-style-resolver.ts     /Heading 1 → TextStyleIR, /Dark → colors
```

`unframer-bridge.ts` (383 Zeilen, JSON-RPC + Retry + Idempotency) bleibt der Transport und wird **nicht** angefasst.

**Vertrag:** Der Adapter implementiert `SourceAdapter` exakt wie deklariert:

```ts
export class UnframerSourceAdapter implements SourceAdapter {
  readonly id = 'unframer';
  canHandle(input: SourceInput): Promise<CapabilityResult>;
  discover(input: SourceInput): Promise<SourceManifest>;   // getProjectXml
  extractPage(m, page): Promise<RawPageEvidence>;          // getNodeXml
  resolveComponent(m, componentId): Promise<RawComponentEvidence>;
  close(): Promise<void>;
}
```

**Semantische Validierung ist Pflicht** (Charta §4.1). Der historische Befund aus `FRAMER-V3-CONVERSION-GELAF-2026-08-01.md` §14 ist verbindlich: Proofly antwortete für neun Seiten mit **HTTP 200 und 71–89 Byte leerem `<WebPageNode>`**. Deshalb:

```ts
// A 200 with an empty wrapper is NOT a successful extraction.
// Verified failure mode: Proofly returned 200 + 71-89 byte empty
// <WebPageNode> for 9 of 10 routes (see FRAMER-V3-CONVERSION-GELAF §14).
function assertPageEvidenceIsSubstantial(xml: string, route: string): void {
  if (xml.length < 500 || !/<[A-Z]\w+[\s>]/.test(xml)) {
    throw new SourceIncompleteError(route, xml.length);
  }
}
```

**Akzeptanz:**
- `discover()` liefert für dieses Projekt genau 10 `pages` und 56 `componentIds`.
- `extractPage('/')` liefert ein `VisualPageIR`, das `validateVisualPageIR()` mit `valid: true` passiert.
- Ein leerer/zu kurzer Payload wird als `source-incomplete` geworfen, **nicht** als leere IR weitergegeben.
- Kein Textknoten ist ein Einzelwort, wenn er im Framer-XML ein zusammenhängender Textknoten war.

### 3.4 Hybrid-Modus: Unframer-Struktur + Live-DOM-Geometrie

Unframer kennt die Absicht, das DOM kennt das Ergebnis. `VisualPageIR` verlangt beides (`bboxByViewport`, `Evidence.methods`).

```
UnframerSourceAdapter  → Struktur, Textstile, Farbstile, Komponenten
       ⊕
live-DOM (Playwright)  → bboxByViewport, Computed Styles, Animations-Evidenz
       ↓
VisualPageIR mit evidence.methods: ['mcp', 'dom', 'computed-style']
```

Die Zuordnung läuft über `data-framer-name` + Reihenfolge. Wo sie nicht eindeutig ist, wird ein `conflict` in `Evidence.warnings` gespeichert und **nicht** überschrieben (Charta §5.1).

**Akzeptanz:** Jede sichtbare Sektion trägt `bboxByViewport` für alle angeforderten Viewports und `evidence.methods.length >= 2`. Nicht zuordenbare Knoten erscheinen als Konflikt im Report, nicht als stille Annahme.

### 3.5 Komponenten: Raten abschaffen

`packages/extractors/src/framer/component-resolver.ts:115-124`:

```ts
export function inferStructure(name: string): InferredWidget[] {
  for (const { pattern, structure } of NAME_PATTERNS) { … }
  // Default: heading + text
  return [{ type: 'heading', … }, { type: 'text', … }];
}
```

Bei 56 Komponenten heißt das: alles, was nicht auf eine der ~8 Regexes passt, wird zu „Heading + Text". Das verstößt gegen Charta §6 („Namensheuristiken dürfen nur schwache Signale sein") und §6.4 („Definition und Instanz müssen getrennt werden").

**Neu:** `resolveComponent()` ruft `getNodeXml(componentId)` auf und liefert die **echte** Definition. `inferStructure` bleibt als letzte Stufe, aber:

- nur wenn der MCP-Abruf fehlschlägt,
- mit `confidence <= 0.5`,
- und einem `FidelityDecisionRecord` mit `decision: 'static-approximation'`.

Zusätzlich: Definition wird **einmal** geholt und gecacht (`ExtractionCache` existiert in `core/src/cache.ts`), Instanz-Overrides (die `cqG8eFcvI="A fearless digital studio"`-Props im XML) werden getrennt gespeichert.

**Akzeptanz:** Für dieses Projekt werden ≥ 50 der 56 Komponenten mit `confidence >= 0.85` und echter Definition aufgelöst. Jede geratene Komponente steht namentlich im Report.

### 3.6 Code-Components ehrlich behandeln

`Counter_FX.tsx` (Odometer mit `framer-motion`, IntersectionObserver, Scroll-Modus) und `CarouselControl.tsx` sind React. In Elementor V3 laufen sie nicht.

Regel: Ein Code-Component wird **nie** stillschweigend zu „Heading + Text". Er erhält eine explizite Entscheidung:

| Fall | `FidelityDecisionKind` | Umsetzung |
|---|---|---|
| Zähler mit `to`-Prop lesbar | `js-fallback` | WPCode-JS aus den Props (`from`, `to`, `duration`, `suffix`) |
| Slider/Carousel | `static-approximation` | erster Zustand als Bild/Container, Verhalten dokumentiert |
| unlesbar / WebGL / Canvas | `unsupported` | Grund + nächste Aktion im Report |

**Akzeptanz:** Kein Code-Component ohne `FidelityDecisionRecord`. `canContinueWithFidelityDecisions()` (contract) blockt, wenn ein `unsupported` mit `severity: 'critical'` unapproved ist.

---

## 4. Arbeitspaket B — Animationen (P0, explizite Anforderung)

### 4.1 Befund: Was auf dieser Seite wirklich animiert

Gemessen mit Playwright über 7 Scroll-Positionen (0 %–90 %), Computed-Style-Diff aller `[data-framer-name]`- und `[class*="framer-"]`-Knoten. 31 Elemente ändern ihren Zustand:

| Effekt | Anzahl | Gemessene Signatur | Elementor-Weg |
|---|---|---|---|
| Fade-in + 50 px hoch | **14** | `opacity 0→1`, `matrix(1,0,0,1,0,50)→none` | **native** `_animation: 'fadeInUp'` |
| Scale-in / Bild-Zoom | **7** | `matrix(0.7,…)→none` bzw. `1.0↔1.1` | **native** `motion_fx_scale_*` |
| Scroll-Rotation ±8° | **4** | `matrix(0.990268,-0.139173,…)` | **native** `motion_fx_rotateZ_*` |
| Horizontal-Fahrt | **1** | `translateX 1900px → −1049px` | **WPCode** GSAP ScrollTrigger |
| Karten-Stack | **2** | `translateY 365px → 0` (`Content-box`) | **WPCode** GSAP |
| Sticky-Sektionen | **2** | `position: sticky`, `top: 50px` / `0px` | **native** `sticky: 'top'` + `sticky_offset` |
| Odometer-Zähler | **1** | Code-Component, `framer-motion` | **WPCode** JS |

**~27 von 31 sind nativ machbar. 4 brauchen WPCode.** Das ist das Gegenteil dessen, was der Code heute tut.

Weitere Messwerte:
- `data-framer-appear-id`: nur **2** Elemente → das deklarative Framer-Payload deckt die Seite **nicht** ab
- `@keyframes`: **2**, beide gehören zur Framer-Editorbar (`__framer-loading-spin`), also **0** inhaltlich
- CSS-`transition`: **2**, beide Editorbar
- `document.getAnimations()`: **0** — Framer nutzt direkte Style-Mutation, keine WAAPI

Konsequenz: **Die Scroll-Probe ist die einzige belastbare Quelle** für 29 der 31 Effekte. Ohne sie ist eine Animationsübernahme auf dieser Seite unmöglich.

### 4.2 Befund: Fünf konkrete Bugs im Animations-Pfad

**B-1 — `has_keyframes` ist hartkodiert `false`.**
`packages/extractors/src/browser/playwright-extractor.ts:163` und `:76`:
```ts
has_keyframes: false,
keyframe_names: [],
```
Folge: `buildKeyframeSnippet` (`animation-injector.ts:128`) gibt immer `null` zurück. Dabei existiert `keyframes-discovery.ts:103 discoverAnimations()` — **null Aufrufer** (grep bestätigt).

**B-2 — `has_framer_motion` wird erhoben und ignoriert.**
`animation-injector.ts:337-346` prüft nur `has_gsap` und `has_lenis`. Auf dieser Seite sind beide `false`, `has_framer_motion` ist `true`. Ergebnis meines Testlaufs: `{"snippetCount": 0, "hasAnimations": false}`.

**B-3 — Kein Emitter schreibt jemals ein natives Animations-Setting.**
Grep über alle Packages nach `_animation`, `animation_delay`, `motion_fx_`, `sticky`: nur `hover_animation: 'grow'` in `patterns/glass-header.ts:100` und `animation_duration` als Pro-`animated-headline`-Setting in `classifier/widget-mapper.ts:536`. **Kein Entrance, kein Motion-Effect, kein Sticky.**

**B-4 — Operator-Präzedenz-Bug.**
`framer-animation-detector.ts:182`:
```ts
gsap.from("."+el.classList[0] ? ".${cls} .oc-word" : ".oc-word", {…})
```
`"." + el.classList[0]` ist immer ein truthy String → der Ternary wählt immer den ersten Zweig. Der `.oc-word`-Fallback ist unerreichbar.

**B-5 — Drei fertige Extraktoren ohne Aufrufer.**
| Modul | Zweck | Aufrufer |
|---|---|---|
| `browser/keyframes-discovery.ts:103` | `@keyframes`-Bodies einsammeln | **0** |
| `browser/animation-property-extractor.ts:132` | `animation-*`/`transition-*` pro Knoten | **0** |
| `browser/pseudo-state-capture.ts:131` | `:hover`-Styles | **0** (nur eigener Re-Export) |

Alle drei sind in `browser/index.ts` exportiert und in keiner Pipeline verdrahtet.

### 4.3 Verifizierte Control-Namen — der Fallstrick

Das Live-Schema (`schemas/elementor-v3-controls.snapshot.json`, gezogen von `testseite.nick-webdesign.de` am 2026-08-24, `missing: []`) zeigt eine **Namensspaltung**, die man nicht raten kann:

```
__container__   animation, animation_delay, animation_duration, sticky, motion_fx_*
alle Widgets    _animation, _animation_delay, animation_duration, sticky, motion_fx_*
```

**Der Container benutzt `animation` OHNE Unterstrich, jedes Widget `_animation` MIT.** `animation_duration` ist bei beiden ohne Unterstrich. Dieselbe Spaltung gilt für Klassen:

```
__container__   css_classes
alle Widgets    _css_classes
```

Und `builder.ts:483` schreibt `_css_classes` auf ein `elType: 'section'` — das ist für Sections vermutlich richtig, für Container aber falsch. Das muss aus dem Schema abgeleitet werden, nicht hartkodiert.

Companion-Pflichten aus dem Schema:
```json
animation_delay      { "if": { "animation!": "" } }      // Container
_animation_delay     { "if": { "_animation!": "" } }     // Widget
animation_duration   { "if": { "_animation!": "" }, "opts": ["slow","","fast"] }
sticky_offset        { "if": { "sticky!": "" } }
motion_fx_*_effect   { "if": { "motion_fx_motion_fx_scrolling": "yes" } }
motion_fx_*_speed    { "if": { "motion_fx_motion_fx_scrolling": "yes", "motion_fx_*_effect": "yes" } }
```

Ohne den jeweiligen Companion **ignoriert Elementor das Setting stillschweigend**. Genau dieser Fehler steckt schon im aktuellen Output: mein `--html`-Lauf produzierte 6 Schema-Gate-Fehler vom Typ `missing-companion` für `background_color` ohne `background_background: 'classic'`.

`animation_duration` ist **kein** Millisekundenwert, sondern ein Enum aus drei Werten. Framers `duration: 0.5` muss also gemappt werden: `< 0.4s → 'fast'`, `0.4–0.8s → ''`, `> 0.8s → 'slow'`. Feinere Werte gehen nur über `custom_css` — das ist eine bewusste Präzisionsgrenze und gehört in den Report.

### 4.4 Neu: `packages/target-v3/src/animation/`

```
animation/
  native-animation-map.ts    Matrix aus §4.1 als Daten, keine Logik
  animation-mapper.ts        AnimationIR → native Settings | WPCode-Bedarf
  wpcode-residual.ts         Snippets NUR für den nicht-nativen Rest
  control-names.ts           liest Container-vs-Widget-Namen AUS DEM SCHEMA
```

Kernvertrag:

```ts
export interface AnimationResolution {
  targetSourceId: string;
  decision: 'native' | 'css-fallback' | 'js-fallback' | 'static-approximation' | 'unsupported';
  /** Settings to merge into the element. Empty for non-native decisions. */
  nativeSettings: Record<string, unknown>;
  /** Why this decision — goes into the report verbatim. */
  reason: string;
  /** Companion controls this resolution required (audit trail). */
  companionsApplied: string[];
}

export function mapAnimations(
  animations: readonly AnimationIR[],
  ctx: { schema: ResolvedWidgetSchema; elType: 'container' | 'widget'; widgetType?: string },
): { resolutions: AnimationResolution[]; nativeCount: number; fallbackCount: number };
```

`control-names.ts` löst §4.3 auf, statt es zu raten:

```ts
// The container control is `animation`; every widget uses `_animation`.
// Verified against the live schema snapshot (missing: []). Never hardcode —
// resolve through the schema so a future Elementor rename is caught by the gate.
export function entranceControlId(schemaKey: string): 'animation' | '_animation' {
  return schemaKey === CONTAINER_SCHEMA_KEY ? 'animation' : '_animation';
}
```

**Staggering:** Für Geschwister-Knoten mit gleichem Effekt wird `_animation_delay` inkrementell gesetzt (`index * step`, Default 100 ms). Das ersetzt GSAPs `stagger` vollständig nativ.

**Akzeptanz A (nativ):**
- Die 14 Fade-up-Elemente erhalten `_animation: 'fadeInUp'` + gültigen Companion; **kein** Snippet.
- Die 4 Rotationen erhalten `motion_fx_motion_fx_scrolling: 'yes'` + `motion_fx_rotateZ_effect: 'yes'` + `motion_fx_rotateZ_speed`.
- Die 2 Sticky-Sektionen erhalten `sticky: 'top'` + `sticky_offset: 50` bzw. `0`.
- Geschwister erhalten aufsteigende Delays.
- Jedes gesetzte Setting passiert das Schema-Gate **ohne** `missing-companion`.

**Akzeptanz B (Residual):**
- Maximal **2** WPCode-Snippets pro Seite (1 × CSS, 1 × JS), beide page-scoped.
- Jedes Snippet nennt im Kommentar, welche `targetSourceId`s es abdeckt und warum nativ nicht ging.
- `prefers-reduced-motion` respektiert (in `framer-animation-detector.ts:158-161` schon korrekt).
- Bei 0 nicht-nativen Effekten: **0 Snippets**, `hasAnimations: true` (nativ), nicht `false`.

**Akzeptanz C (Ehrlichkeit):**
- `has_framer_motion: true` **muss** `AnimationIR`-Einträge erzeugen oder eine Warnung.
- Bei 0 Treffern trotz `has_framer_motion: true`: `animations-undetected` als Warnung, nicht stilles `hasAnimations: false`.
- WPCode fehlt → betroffene Effekte als `unavailable`, nicht verschweigen.

### 4.5 Die Scroll-Probe muss ins Repo

Neu: `packages/extractors/src/browser/motion-evidence-probe.ts`

Was mein Wegwerf-Skript macht und was das Modul übernehmen muss:

1. `__framer__appearAnimationsContent` + `__framer__breakpoints` parsen (JSON, direkt lesbar)
2. Über N Scroll-Positionen `opacity`/`transform`/`position`/`clipPath`/`filter` je Knoten aufnehmen
3. Diff → nur geänderte Knoten behalten
4. Signatur klassifizieren → `AnimationIR.kind` + Effekt-Typ
5. `position: sticky` separat inventarisieren (native `sticky`-Kandidaten)
6. `document.getAnimations()` als Zusatzsignal
7. `discoverAnimations()`, `extractAnimationProperties()`, `capturePseudoStates()` aus B-5 **hier** aufrufen

**Wichtig:** Die Klassifikation braucht eine Toleranz. Gemessen wurden Werte wie `matrix(0.999915, …)` — praktisch Identität, aber ≠ `none`. Ohne Epsilon (~0,005) entstehen falsche Positive.

**Breakpoints aus der Quelle statt geraten.** `browser/types.ts` hat:
```ts
export const DEFAULT_VIEWPORTS = [
  { label: 'desktop', width: 1440, height: 900 },
  { label: 'tablet',  width: 768,  height: 1024 },
  { label: 'mobile',  width: 390,  height: 844 },
];
```
Framer sagt aber:
```json
[{"hash":"72rtr7","mediaQuery":"(min-width: 1200px)"},
 {"hash":"5umvoy","mediaQuery":"(min-width: 810px) and (max-width: 1199.98px)"},
 {"hash":"5a698","mediaQuery":"(max-width: 809.98px)"}]
```
Die echten Grenzen sind **1200 / 810**, nicht 1440 / 768. `extractFramerData()` (`framer-data-extractor.ts:58`) liest sie bereits korrekt — der Wert wird nur nie an die Capture-Viewports weitergegeben. Bei 768 px Capture testet man derzeit die falsche Seite der 810-px-Grenze.

**Akzeptanz:** ≥ 25 der 31 gemessenen Effekte werden erkannt und korrekt klassifiziert (Fixture-basierter Regressionstest gegen einen eingefrorenen Probe-Output). Viewports werden aus `__framer__breakpoints` abgeleitet, `DEFAULT_VIEWPORTS` nur als Fallback bei fehlendem Payload.

---

## 5. Arbeitspaket C — WPCode-Vertragsdrift (P1, live verifiziert)

Ich habe das Live-Input-Schema von `novamira-adrianv2/create-wpcode-snippet` und `update-wpcode-snippet` abgefragt und gegen das verglichen, was das Repo sendet.

### 5.1 `status` ist kein Input-Feld

`core/src/wpcode-helper.ts:147-155` (`buildSafePayload`) sendet:
```ts
{ title, code, code_type, location, status: 'active' | 'inactive', tags }
```
`novamira-client.ts:127` (`buildCreateWpcodeCall`) sendet ebenfalls `status: 'active'`.

Das Live-Input-Schema kennt **kein** `status`. Es kennt `active: boolean`. `status` erscheint nur im **Output** (`"WPCode post_status: publish (active) or draft (inactive)"`).

Folge: Der Aktivierungswunsch geht verloren. Da `active` per Schema `Default: false` ist, landet jedes Snippet als **Draft** — unsichtbar im Frontend. Das erklärt die Klasse „MCP-Write erfolgreich, aber nichts sichtbar" aus den Gotchas.

### 5.2 `auto_insert` fehlt komplett

Schema: *„`location` … only meaningful when `auto_insert=true`"*. Das Repo sendet nie `auto_insert`. Ein Snippet mit `location: 'site_wide_footer'` aber ohne `auto_insert: true` wird als **Shortcode-Snippet** behandelt und nie automatisch ausgegeben.

Interessant: `core/src/lib/wpcode-adapter.ts:62` setzt `_wpcode_auto_insert: '1'` — aber das ist der direkte Meta-Pfad, nicht der Ability-Pfad. Die beiden Wege sind inkonsistent.

### 5.3 Der Ability-Alias verbirgt einen Widerspruch

```
resolveAbilityName('novamira-adrianv2/execute-php') → 'novamira/execute-php'
```

Fünf Stellen senden `novamira-adrianv2/execute-php` (`novamira-client.ts:94,146`, `render-preview.ts:103,148`, `wpcode-helper.ts:205`), das es live nicht gibt. Der Alias fängt das ab — funktional korrekt, aber der Code liest sich als gäbe es zwei verschiedene Abilities. Das ist genau die Namensdrift, die `ability-registry.ts` verhindern soll.

### 5.4 `buildDualWriteCalls` ist ungetestet und riskant

`wpcode-helper.ts:195-241` baut einen PHP-Aufruf, der `wpcode_snippets` per `update_option` synchronisiert. Probleme:

- **Kein Test.** Grep über `tests/`: 0 Treffer für `buildDualWriteCalls`.
- **Kein Aufrufer.** Grep über `packages/`: nur die Definition.
- `buildOptionSyncPhp` interpoliert `payload.title` mit einfachem `replace(/'/g, "\\'")` in PHP-Quelltext — für einen Titel aus einem Framer-Projektnamen ist das eine Injection-Fläche.
- Der Kommentar nennt „Missing dual-write" als Failure-Mode Nr. 5. Das Live-Schema deutet auf einen einfacheren Weg: `bypass_kses: true` bei `update-wpcode-snippet` macht laut Schema *„post row + compiled-asset cache purge"* — genau das, was der PHP-Hack nachbaut.

### 5.5 Was zu tun ist

```ts
export interface SafeWpcodePayload {
  title: string;
  code: string;
  code_type: 'css' | 'html';
  location: string;
  /** Live schema field. `status` is OUTPUT-only — sending it is a silent no-op. */
  active: boolean;
  /** `location` is only honoured when this is true. */
  auto_insert: boolean;
  tags: string[];
  /** Force CDN cache invalidation after a versioned deploy. */
  cache_bust_token?: string;
  // priority: INTENTIONALLY OMITTED (private property crash)
}
```

Zusätzlich:
1. `active` aus dem Response **zurücklesen** und mit dem Wunsch vergleichen. WPCode kann auf Draft demoten (`last_error`) — das muss als `failed` erscheinen, nicht als Erfolg.
2. Die fünf `novamira-adrianv2/execute-php`-Stellen auf den kanonischen Namen umschreiben. Alias bleibt für externe Aufrufer.
3. `buildDualWriteCalls` entweder durch `bypass_kses: true` ersetzen oder mit Tests + Escaping absichern. Nicht ungetestet stehen lassen.
4. `cache_bust_token` mit der Build-ID füllen — löst die CDN-Cache-Klasse für GSAP-Snippets.

**Akzeptanz:** Ein Regressionstest pinnt den Payload gegen das Live-Input-Schema (analog zum bestehenden `--verify-large-deploy`-Muster). Nach dem Deploy bestätigt ein Read-back `active: true` und `status: 'publish'`. Ein demotetes Snippet wird `failed`.

---

## 6. Arbeitspaket D — Guards und QA schärfen (P1)

### 6.1 Der Guard-Score hat mich angelogen

Mein `--html`-Lauf: **95/100, bestanden**. Inhalt: 140 Einzelwort-Headings, jeder Text doppelt, 0 Buttons. Der `--url`-Lauf: 70/100 mit korrektem `G_SUBSTANCE_WIDGETS`-Fehler.

Der HTML-Lauf kommt durch, weil alle Substanz-Guards zufrieden sind: Widgets existieren (388), Texte sind nicht leer, Dichte ist hoch. Es fehlt ein Guard für **Fragmentierung**.

Neu, in `packages/target-v3/src/guards.ts`:

```
G_SUBSTANCE_FRAGMENTS  Anteil text-tragender Widgets mit < 3 Zeichen ODER
                       einem einzelnen Wort ohne Satzzeichen.
                       > 30 % ⇒ critical ("source was tokenized, not parsed")

G_SUBSTANCE_DUPES      Anteil identischer (widgetType, text)-Paare.
                       > 25 % ⇒ critical ("responsive variants were not deduplicated")

G_ANIMATION_PARITY     Anzahl erkannter AnimationIR vs. Anzahl Elemente mit
                       nativem Animations-Setting ODER WPCode-Abdeckung.
                       Lücke ⇒ warning mit Liste der unbehandelten sourceIds
```

Ohne `G_SUBSTANCE_FRAGMENTS` hätte dieser Lauf produktiv deployt werden können.

**Akzeptanz:** Der aktuelle `--html`-Output fällt auf < 85 und wird abgelehnt. Der zukünftige Unframer-Output besteht. Beides als Fixture-Test.

### 6.2 Schema-Gate: `missing-companion` muss den Build stoppen

Das Gate arbeitet und findet die richtigen Fehler:
```
✗ [missing-companion] __container__.background_color ([6]) —
  "background_color" only applies while background_background = ["classic",…]
  → add background_background: "classic"
```
6 solche Fehler. Aber `--skip-schema-gate` hat sie einfach umgangen und die Datei wurde geschrieben.

Für Animationen ist das fatal: `_animation: 'fadeInUp'` ohne den Companion tut **gar nichts**, und der Nutzer sieht eine Seite ohne Animationen bei „Deploy erfolgreich".

Änderung: `missing-companion` wird für Animations- und Motion-FX-Controls **nicht** durch `--skip-schema-gate` überschreibbar. Wer die Animation anfordert, bekommt sie korrekt oder eine harte Fehlermeldung.

### 6.3 QA-Viewports aus der Quelle

Siehe §4.5. Zusätzlich: Die Charta §9 verlangt pro Viewport ein `CaptureManifest` mit eigenem Status. Der Gelaf-Lauf zeigte, dass drei fehlende Elementor-Pro-Stylesheets (`widget-blockquote.min.css`, `widget-mega-menu.min.css`, `widget-nav-menu.min.css`) den Capture zu Recht auf `not-scored` setzen. Das ist richtiges Verhalten und darf nicht „weggefixt" werden — aber es braucht eine Allowlist für nachweislich optionale Assets, sonst ist nie ein Score möglich.

**Akzeptanz:** Eine dokumentierte, begründete Allowlist optionaler Pro-Stylesheets. Jeder Eintrag mit Nachweis, dass er für die gebaute Seite nicht gebraucht wird. Kein pauschales Ignorieren von Request-Fehlern.

---

## 7. Arbeitspaket E — CLI-Oberfläche (P2)

Heute: `--url` | `--xml` | `--html`, gegenseitig exklusiv. Der Unframer-Pfad hat keinen Platz.

Neu:

```
elconv convert --target v3 --framer-project <id>            # Unframer, ganzes Projekt
elconv convert --target v3 --framer-page <nodeId>           # eine Seite
elconv convert --target v3 --url <live> --framer-project <id>  # Hybrid (§3.4)
```

Auth über Env (`UNFRAMER_MCP_URL`, `UNFRAMER_MCP_ID`, `UNFRAMER_MCP_SECRET`) — **nie** als CLI-Argument, weil das in der Prozessliste landet. Die bestehende `.env.local`-Konvention bleibt.

Der Wizard bekommt eine Quellenauswahl-Phase mit ehrlicher Fähigkeitsanzeige:

```
Quelle wählen:
  1) Unframer MCP      ✓ Struktur ✓ Textstile ✓ Komponenten ✗ Geometrie
  2) Live-URL          ✗ Struktur ✗ Textstile ✗ Komponenten ✓ Geometrie ✓ Animationen
  3) Hybrid (1+2)      ✓ alles                              ← empfohlen
  4) HTML-Export       ⚠ nur statisches HTML, für Framer ungeeignet
```

Das ist keine Kosmetik: die Fähigkeitsmatrix ist gemessen und verhindert, dass jemand wieder `--html` auf ein Framer-Projekt wirft.

**Akzeptanz:** `wizard-contract.json` führt die gewählte Quelle und ihre `CapabilityResult` maschinenlesbar. Der bestehende Vertrag (`schemaVersion: 1`) braucht dafür `schemaVersion: 2` + Migration — das Migrationsmuster existiert bereits (`migrateWizardContract`).

---

## 8. Reihenfolge und Abhängigkeiten

```
A3 UnframerSourceAdapter ──┬──> A5 Komponenten (braucht resolveComponent)
   (der fehlende Producer) │
                           ├──> A4 Hybrid ──┐
B5 motion-evidence-probe ──┴────────────────┼──> B4 animation-mapper
   (braucht A4 für Zuordnung)               │      (braucht IR + Evidenz)
                                            │
A2 section-detector (Pflaster) ─────────────┘
                                                    │
C  WPCode-Vertrag ──────────────────────────────────┼──> Deploy
   (unabhängig, sofort machbar)                     │
                                                    │
D  Guards ──────────────────────────────────────────┴──> QA
   (unabhängig, sofort machbar)
```

| Reihenfolge | Paket | Warum zuerst | Aufwand |
|---|---|---|---|
| 1 | **C** WPCode-Vertrag | unabhängig, live verifiziert, verhindert „unsichtbare" Deploys | 3–4 h |
| 2 | **D** Guards | unabhängig, verhindert dass Müll durchkommt | 3–4 h |
| 3 | **A2** section-detector | Einzeiler, hebt `--url` von 0 Widgets | 1–2 h |
| 4 | **A3** UnframerSourceAdapter | der fehlende Producer, blockiert alles Weitere | 10–14 h |
| 5 | **B5** motion-evidence-probe | einzige Animationsquelle | 6–8 h |
| 6 | **A4** Hybrid-Merge | braucht 4+5 | 5–6 h |
| 7 | **B4** animation-mapper | braucht 6 | 8–10 h |
| 8 | **A5/A6** Komponenten + Code-Components | braucht 4 | 6–8 h |
| 9 | **E** CLI/Wizard | Oberfläche zum Fertigen | 4–5 h |

C, D und A2 sind sofort machbar und liefern schon vor dem großen Umbau Wert: sie machen die bestehenden Fehler **sichtbar** statt sie zu verstecken.

---

## 9. Was dieser Bauplan bewusst NICHT löst

Ehrlichkeit über Grenzen ist Teil der Charta:

- **Framer-Motion-Spring-Physik.** `{"type":"spring","bounce":0.2}` ist mit `animation_duration: 'fast'|''|'slow'` nicht nachbaubar. Annäherung + Report-Eintrag, keine Gleichheit.
- **`delay: 4`** aus dem gemessenen Appear-Payload — vier Sekunden Verzögerung ist mit `_animation_delay` (ms) darstellbar, aber Elementor triggert beim In-View-Ereignis, Framer beim Page-Load. Anderes Verhalten, dokumentierte Abweichung.
- **CMS-Collections.** Das Projekt hat `/blogs/:slug` und `/projects/:slug` als dynamische Routen. Diese auf WordPress-Custom-Post-Types abzubilden ist ein eigenes Arbeitspaket, nicht Teil von v7.0.
- **Die 9 Unterseiten.** v7.0 zielt auf einen belastbaren Einzelseiten-Pfad. Multi-Page braucht `site.contract.ts` (existiert) und ein Shared-Component-Konzept.
- **`upload-php` / `split`.** Bleiben gesperrt (`requiresSchemaVerification: true` als Literal). Der V3-Tree dieser Seite wird nach A3 vermutlich > 400 KB — dann greift die Bandenwahl. Das ist ein bekannter, dokumentierter Blocker mit eigener Checkliste (`LARGE-DEPLOY-VERIFICATION-2026-08-04.md`).

---

## 10. Definition of Done für v7.0

Ein beliebiges Framer-Projekt gilt erst als konvertiert, wenn:

- [ ] `UnframerSourceAdapter` implementiert `SourceAdapter` und produziert valides `VisualPageIR`
- [ ] Leere/zu kurze MCP-Antworten werden als `source-incomplete` geworfen, nicht als leere IR
- [ ] Kein Textknoten ist fragmentiert (`G_SUBSTANCE_FRAGMENTS` grün)
- [ ] Keine Responsive-Variante doppelt (`G_SUBSTANCE_DUPES` grün)
- [ ] Komponenten werden aus echten Definitionen aufgelöst; jede geratene steht namentlich im Report
- [ ] Jeder Code-Component hat einen `FidelityDecisionRecord`
- [ ] Animationen: ≥ 80 % der erkannten Effekte **nativ**; Rest in ≤ 2 page-scoped WPCode-Snippets
- [ ] Jedes Animations-Setting passiert das Schema-Gate ohne `missing-companion`
- [ ] Container-vs-Widget-Control-Namen werden aus dem Schema aufgelöst, nicht hartkodiert
- [ ] WPCode-Payload entspricht dem Live-Input-Schema (`active`, `auto_insert`); Read-back bestätigt `status: 'publish'`
- [ ] QA-Viewports aus `__framer__breakpoints` abgeleitet
- [ ] `G_ANIMATION_PARITY` zeigt keine unbehandelten Effekte
- [ ] Multi-Viewport-QA mit echter Referenz-URL, Pixel/SSIM nur bei gültigem Paar
- [ ] Jede Abweichung im Report begründet — kein stiller Verlust

---

## 11. Verbindliche Prüfkommandos

```bash
npx tsc --build --clean
npx tsc --build --pretty false
npx vitest run --pool=forks --maxWorkers=1 --minWorkers=1 --testTimeout=15000
npx eslint packages/cli/src packages/core/src packages/extractors/src packages/target-v3/src packages/target-v4/src packages/mcp/src packages/qa/src
git diff --check
```

Pro Arbeitspaket: echte Assertions, keine Smoke-Tests. Ein Fixture je Paket, eingefroren aus einem realen Lauf.

---

## Verwandte Dokumente

- [`REPOSITORY-CHARTA.md`](./REPOSITORY-CHARTA.md) — Plattformvertrag, Definition of Done
- [`BAUPLAN-v6.0-FRAMER-FIDELITY-2026-08.md`](./BAUPLAN-v6.0-FRAMER-FIDELITY-2026-08.md) — die 9 Abbrüche, Control-Schema, P0–P6
- [`FRAMER-V3-CONVERSION-GELAF-2026-08-01.md`](./FRAMER-V3-CONVERSION-GELAF-2026-08-01.md) — der HTTP-200-mit-leerem-Payload-Befund
- [`NOVAMIRA-ABILITY-PLAYBOOK.md`](./NOVAMIRA-ABILITY-PLAYBOOK.md) — Ability-Parameter pro Pipeline-Schritt
- [`TODO-OFFEN-2026-07-31.md`](./TODO-OFFEN-2026-07-31.md) — aktueller Status und Blocker

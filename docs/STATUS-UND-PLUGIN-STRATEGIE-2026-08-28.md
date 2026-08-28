# Status v7.0 und Plugin-Strategie — 2026-08-28

> Momentaufnahme nach den Arbeitspaketen B5, A4 und B4. Jede Zahl in diesem Dokument
> ist gemessen — entweder gegen die eingefrorenen Fixtures aus einem realen Lauf oder
> live gegen `testseite.nick-webdesign.de`. Wo etwas ungeprüft ist, steht das dabei.

---

## 1. Der zentrale Befund: die Kette ist gebaut, aber nicht verdrahtet

Grep über alle Packages nach Aufrufern **außerhalb** der Tests:

| Funktion | Paket | Produktions-Aufrufer |
|---|---|---|
| `probeMotionEvidence` | B5 | **0** |
| `mergeLiveDomIntoIr` | A4 | **0** |
| `mapAnimations` / `mapSticky` | B4 | **0** |
| `emitVisualIrToV3` | — | **0** |

Das ist strukturell derselbe Befund wie **B-5** im Bauplan (drei fertige Extraktoren
ohne Aufrufer), nur eine Ebene höher. `visual-ir-to-v3.ts:309` macht mit Animationen
weiterhin ausschließlich das:

```ts
for (const animation of ir.animations) {
  addDecision(…, 'static-approximation', 'animation', 'warning', …);
}
```

Ein Warnhinweis pro Animation. **Kein `_animation`, kein `motion_fx_*`, kein `sticky`
landet im Tree.** Der Mapper existiert und rechnet korrekt; der Emitter fragt ihn nicht.

**Konsequenz für die Definition of Done:** Der Punkt „≥ 80 % der erkannten Effekte
nativ" steht derzeit bei **0 %**, unabhängig von der Qualität des Mappers. Solange die
Verdrahtung fehlt, ist er nicht einmal messbar.

Deshalb ist die Verdrahtung der nächste Schritt — nicht ein weiteres neues Modul.

---

## 2. Was fertig ist

### B5 — `motion-evidence-probe.ts`

Die Scroll-Probe ist ein Modul statt Wegwerf-Code. Warum sie überhaupt nötig ist, ist
gemessen: auf der Humeen-Seite liefert `document.getAnimations()` **0**, es gibt **0**
inhaltliche `@keyframes`, **0** inhaltliche CSS-Transitions — und die 2
`data-framer-appear-id`-Elemente sind **beide das „Made in Framer"-Badge**. Das
deklarative Payload deckt keinen einzigen Inhaltsknoten ab. Nur der Style-Sweep über
Scroll-Positionen sieht die 31 bewegten Elemente.

Klassifikation trennt `entrance` von `scroll-linked` über **Opacity**, nicht über
Monotonie: der horizontale Kartenlauf (1900px → −1050px) ist perfekt monoton und
trotzdem ein Scrub, während die Bild-Zooms oszillieren.

`MOTION_EPSILON = 0.005` ist kein Ratewert — ein Bild (`framer-tw203r`) pendelt über
den ganzen Sweep zwischen `matrix(0.999262…)` und `none`, Gesamtspanne 0.0021. Ohne
Schwelle ein Phantom-Zoom auf einem statischen Bild.

Behobene Bugs: `has_keyframes: false` war hartkodiert und deaktivierte den gesamten
Keyframe-Pfad (`discoverAnimations()` hatte 0 Aufrufer); ein zweiter
`page.route('**/*')` hätte die Font-Interception still leergeräumt; der
Operator-Präzedenz-Bug in `framer-animation-detector.ts:182`.

### A4 — `hybrid-ir-merge.ts`

Der Bauplan sah Matching über `data-framer-name` vor. Gemessen:

```
XML-Layer : Hero About Projects Partners Services Awards Testimonial Rating Cta Faq  Blogs
DOM-Namen : Hero About Projects Partners Services Awards Desktop     Rating CTA Desktop Blogs
```

`Testimonial` und `Faq` sind genau die zwei Sections mit `componentId` — und eine
gerenderte Framer-Komponenten-Instanz heißt nach ihrer **aktiven Variante**
(`Desktop`/`Tablet`/`Phone`), nicht nach dem Layer. Ein Name-First-Merge verliert also
die zwei Sections, deren Struktur aus dem DOM am wenigsten rekonstruierbar ist.
Dokumentreihenfolge stimmte über alle drei Viewports exakt → Reihenfolge als
Primärschlüssel, Name als Verifikation, Varianten-Umbenennung als erklärter Sonderfall.

Zwei DOM-Ausschlussregeln, ebenfalls gemessen: `div.framer-*-container`-Wrapper liegen
auf exakt derselben Box wie die Section (14 Kandidaten → 11 Sections), und
`section.framer-slideshow` liegt *innerhalb* der Testimonial-Section.

### B4 — `packages/target-v3/src/animation/`

Drei Module: `control-names.ts`, `native-animation-map.ts`, `animation-mapper.ts`.

**Der Namens-Split wird aus dem Schema gelesen, nicht kodiert.** Doppelt verifiziert —
Snapshot und Plugin-Quelle live:

| | Entrance | Delay | Duration |
|---|---|---|---|
| `__container__`, `section`, `column` | `animation` | `animation_delay` | `animation_duration` |
| jedes Widget | `_animation` | `_animation_delay` | `animation_duration` |

`animation_duration` ist bei beiden ohne Unterstrich. Elementors Handler liest das Paar
als Either/Or: `getCurrentDeviceSetting('animation') || getCurrentDeviceSetting('_animation')`.

**Warum ein falscher Entrance schlimmer ist als keiner:** `element-base.php` setzt
`class="elementor-invisible"` auf jedes Element mit Entrance, `frontend.css` definiert
dazu `visibility: hidden`. Die Klasse entfernt nur der JS-Handler beim Scroll-in. Ein
geratener Entrance macht Inhalt also potenziell **permanent unsichtbar**. Deshalb:
`motionClass` fehlt oder `indeterminate` ⇒ nie ein Entrance.

**Contract-Erweiterung war zwingend.** Elementors Motion-Effects sind *Amplituden*:

```js
getElementStep(passedPercents, options) { return -(passedPercents - 50) * options.speed; }
scale(actionData, passedPercents) { /* 1 + speed * movePoint / 1000 */ }
```

Ein `speed` ohne gemessene Weite ist erfunden. `AnimationIR` trug nur `intent: string`;
die Amplituden starben am Merge-Übergang. Jetzt `effects?: AnimationEffectIR[]` und
`motionClass` im Contract.

**Vier benannte Präzisionsgrenzen:**

| Grenze | Messung | Umgang |
|---|---|---|
| `animation_duration` ist Drei-Wert-Enum | `.animated` 1.25s, `-slow` 2s, `-fast` 0.75s | Nearest-Neighbour bei 1000/1625ms |
| Entrance-Travel ist relativ | `fadeInUp` startet bei `translate3d(0,100%,0)` | Framers feste 50px als `precisionLoss` |
| Slider-Step 0.1 | ±8° braucht speed 0.08 | gesnappt auf 0.1 → rendert 10°, gemeldet |
| Slider-Max 10 | 2950px braucht speed 29.5 | **nicht geklemmt** → `js-fallback` |

**Sticky war nicht adressierbar.** Die alte `StickyObservation` hatte nur `framerName` +
`top`. `Container` kommt mehrfach vor. Sticky läuft jetzt durch denselben Meta-Walk wie
die Motion-Kandidaten (Section + Name + Ordinal) und liest zusätzlich `bottom` — ohne
das wäre jedes Sticky-Element `sticky: 'top'` geworden.

Zusätzlich gemessen: Pros Sticky-Modul hookt **nur** `section`, `container`, `common` —
`column` fehlt, während motion-fx alle vier hookt. Da für `column` kein Schema
existiert, würde ein `sticky` dort von keinem Gate abgefangen. Als
`STICKY_UNSUPPORTED_EL_TYPES` eingebaut.

### PRO Elements statt Elementor Pro

Live gemessen (2026-08-28):

```
elementor-pro/elementor-pro.php   installiert, INAKTIV  (3.35.1)
pro-elements/pro-elements.php     AKTIV                 (4.2.2)
ELEMENTOR_PRO_VERSION             4.2.2
ELEMENTOR_PRO_PATH                .../plugins/pro-elements/
geladene Module                   motion-fx, sticky, popup, forms, interactions, …
```

`modules/motion-fx/controls-group.php` ist **byteidentisch** (md5 `a391f93e…`), ebenso
`motion-fx/module.php`. Die Amplituden-Formeln in PRO Elements' eigenem `frontend.js`
sind identisch.

**Der Mapper war nie betroffen** — er fragt das Schema, nicht die Plugin-Liste.
Betroffen war der Preflight, der hart auf `slug === 'elementor-pro'` matchte und auf
diesem Server `inactive` gemeldet hätte. Behoben über `alternativeSlugs` +
`ELEMENTOR_PRO_PROVIDERS`; ein aktives Alternativ schlägt ein inaktives Primary, und
`satisfiedBySlug` benennt den Provider im Report.

**Verifikation Stand jetzt:** `tsc --build` clean, ESLint clean, **1936 Tests grün** in
134 Dateien.

---

## 3. Offene Punkte

Reihenfolge nach Abhängigkeit, nicht nach Bauplan-Nummer.

### 3.1 Verdrahtung (blockiert alles Weitere)

`emitVisualIrToV3` muss `mapAnimations` und `mapSticky` aufrufen und die
`settingsByTarget` in die erzeugten Elemente mergen. Dazu braucht der Emitter einen
`resolveTarget`, der `AnimationIR.targetSourceId` auf `{ schemaKey, parentSourceId,
indexInParent }` abbildet — die Information entsteht ohnehin beim Emittieren.

Offene Entscheidung: Das Schema muss in den Emitter. `emitVisualIrToV3` ist heute
offline-fähig und wirft bei invalider IR; ein Schema-Parameter darf das nicht brechen.
Vorschlag: optionaler Parameter, ohne Schema werden Animationen wie heute nur als
Decision gemeldet — aber mit ehrlicher Begründung statt pauschalem
`static-approximation`.

### 3.2 `G_ANIMATION_PARITY`

Fehlt vollständig (0 Treffer). Er ist die Absicherung gegen genau das Loch aus §1:
erkannte `AnimationIR` vs. Elemente mit nativem Setting oder Snippet-Abdeckung. Lücke ⇒
`warning` mit Liste der unbehandelten `sourceId`s.

**Hätte er existiert, hätte er die fehlende Verdrahtung gemeldet.** Das ist das
Argument, ihn direkt nach der Verdrahtung zu bauen und nicht später.

### 3.3 `wpcode-residual.ts`

Aus §4.4 noch offen. Snippets **ausschließlich** für die nicht-nativen Klassen, max.
1 CSS + 1 JS, page-scoped, `prefers-reduced-motion` respektiert. Jedes Snippet nennt im
Kommentar die abgedeckten `targetSourceId`s und warum nativ nicht ging.
`residualTargets()` liefert die Gruppierung bereits.

Akzeptanz aus dem Bauplan: bei 0 nicht-nativen Effekten **0 Snippets** und
`hasAnimations: true` (nativ), nicht `false`.

### 3.4 Schema-Gate: `missing-companion` härten (§6.2)

`--skip-schema-gate` umgeht heute alles. Für Animationen ist das fatal: `_animation`
ohne Companion tut gar nichts, und der Nutzer sieht eine Seite ohne Animationen bei
„Deploy erfolgreich". Für Animations- und Motion-FX-Controls darf
`missing-companion` nicht überschreibbar sein.

### 3.5 `cache_bust_token` (§5.5 Punkt 4)

Kein Treffer im Code. Löst die CDN-Cache-Klasse für Snippets.

Der Rest von Paket C ist erledigt: `active: boolean`, `auto_insert`, `status` als
verbotenes Feld, `verifyWpcodeWrite` mit Read-back auf `status: 'publish'`. Die fünf
`novamira-adrianv2/execute-php`-Stellen sind weg, `buildDualWriteCalls` existiert nicht
mehr.

### 3.6 QA-Allowlist optionaler Pro-Stylesheets (§6.3)

Kein Treffer auf `widget-blockquote` o. ä. Der Gelaf-Lauf setzte den Capture wegen drei
fehlender Pro-Stylesheets zu Recht auf `not-scored`. Das ist richtiges Verhalten und
darf nicht weggefixt werden — aber ohne begründete Allowlist ist nie ein Score möglich.
Jeder Eintrag mit Nachweis, dass er für die gebaute Seite nicht gebraucht wird. Kein
pauschales Ignorieren von Request-Fehlern.

### 3.7 CLI/Wizard (Paket E)

`--framer-project` / `--framer-page` existieren nicht. Wizard-Contract steht auf
`schemaVersion: z.literal(1)`, §7 verlangt 2 plus Quellenauswahl mit gemessener
Fähigkeitsmatrix. Migrationsmuster existiert (`migrateWizardContract`).

### 3.8 Ungeprüft

`component-resolver.ts` hat `resolveComponents` und `inferStructure(name)`, das aus
einem Namen rät. Die DoD verlangt, dass jede geratene Komponente namentlich im Report
steht. **Ob das erfüllt ist, habe ich nicht geprüft.**

### 3.9 Bereits erledigt (aus Paket D)

`G_SUBSTANCE_FRAGMENTS` (`guards.ts:541`) und `G_SUBSTANCE_DUPES` (`guards.ts:579`) sind
implementiert und registriert.

---

## 4. Plugin-Strategie

### 4.1 Ein „Framer2Elementor"-Konverter-Plugin wäre der falsche Zuschnitt

Die Extraktion braucht Playwright, einen Scroll-Sweep über mehrere Viewports und
Pixel-Diffs. Das gehört nicht in PHP auf einem Shared Host. Die Charta verlangt
Multi-Viewport-QA mit echter Referenz-URL — ein WordPress-Plugin kann den Referenz-Zustand
per Definition nicht sehen.

Wo ein Plugin echten Hebel hätte, ist dort, wo **Präzision verloren geht, weil Elementor
die Fähigkeit nicht hat.**

### 4.2 Motion-Bridge (empfohlen)

Die vier nicht-nativen Klassen aus der Messung sind genau die, an denen der Mapper heute
auf WPCode ausweicht:

| Klasse | Anzahl | Blocker |
|---|---|---|
| Horizontal-Fahrt | 1 | 2950px braucht speed 29.5, Slider-Max 10 |
| Karten-Stack | 2 | zwei Elemente in Lockstep, motion-fx hat keine Kopplung |
| Odometer | 1 | Textinhalt animiert, kein Control kann das |
| Scale-from-Zero | 1 | `zoomIn` startet bei 0.3, motion-fx skaliert um 1 |

Ein Plugin könnte:

- über `elementor/controls/animations/additional_animations` eigene Entrance-Keys
  registrieren — **der Filter existiert**, gelesen in `Control_Animation::get_animations()`
- über eine eigene Control-Group Amplituden ohne Slider-Deckel anbieten
- gekoppelte Effekte als ein Control-Paar modellieren

**Der Mapper würde sie automatisch finden, weil er das Schema fragt.** Genau das hat
sich bei PRO Elements bewährt: Fork rein, Fähigkeit da, keine Codeänderung nötig. Ein
Motion-Plugin dockt exakt so an — das ist kein Zufall, sondern die Konsequenz aus der
Entscheidung, nie Control-Namen zu hartkodieren.

**Voraussetzung:** erst nach der Verdrahtung. Sonst optimieren wir eine Kette, die noch
nichts überträgt.

### 4.3 Snippet-Manager statt WPCode (mittlerer Nutzen)

Paket C beschreibt drei verifizierte Vertragsfallen: `status` ist Output-only,
`auto_insert` fehlt, `priority` crasht. Ein eigenes Plugin mit page-scoped Snippets,
deterministischer ID und Read-back wäre weniger Fläche als WPCode-Eigenheiten zu
umschiffen.

Aber: Die Fallen sind inzwischen umgangen und getestet. Der Zusatznutzen ist die
Determinismus-Garantie, nicht die Funktion.

### 4.4 Verify-Endpoint (geringer Nutzen)

„MCP-Write erfolgreich ≠ sichtbar" ist eine ganze Gotcha-Klasse. Ein Plugin, das nach
dem Write die *gerenderte* Geometrie zurückgibt, würde den Playwright-Roundtrip für die
Grobprüfung sparen.

Aber: Novamira kann bereits `execute-php`, und die QA braucht ohnehin einen echten
Browser für Pixel-Diffs. Der Endpoint spart einen Schritt, ersetzt keinen.

### 4.5 Empfehlung

**Motion-Bridge ja, Konverter-Plugin nein** — und erst nach der Verdrahtung.

---

## 5. Verbindliche Prüfkommandos

```bash
npx tsc --build --clean
npx tsc --build --pretty false
npx vitest run --pool=forks --maxWorkers=1 --minWorkers=1 --testTimeout=15000
npx eslint packages/cli/src packages/core/src packages/extractors/src packages/target-v3/src packages/target-v4/src packages/mcp/src packages/qa/src
git diff --check
```

Pro Arbeitspaket: echte Assertions, keine Smoke-Tests. Ein Fixture je Paket,
eingefroren aus einem realen Lauf.

---

## Verwandte Dokumente

- [`REPOSITORY-CHARTA.md`](./REPOSITORY-CHARTA.md) — Plattformvertrag, Definition of Done
- [`BAUPLAN-v7.0-FRAMER-GENERIC-2026-08-26.md`](./BAUPLAN-v7.0-FRAMER-GENERIC-2026-08-26.md) — Arbeitspakete A–E
- [`NOVAMIRA-ABILITY-PLAYBOOK.md`](./NOVAMIRA-ABILITY-PLAYBOOK.md) — Ability-Parameter pro Pipeline-Schritt
- [`TODO-OFFEN-2026-07-31.md`](./TODO-OFFEN-2026-07-31.md) — älterer Status, teils überholt

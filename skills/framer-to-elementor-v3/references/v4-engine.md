# V4 Engine Compatibility Rules & Anti-Pattern Catalog

> **Context:** Elementor 4.2.0 renders V3 `_elementor_data` with V4 container markup (`e-con-full`, `e-flex`).
> The page data is V3, but the DOM output follows V4 rules. This creates silent CSS failures.
> **Discovered via:** 15+ failed iteration attempts on a live ClinicHub rebuild (post 4868, testseite.nick-webdesign.de).

---

## 1. Selector Mapping: V3 → V4 Output

| Intent | V3 Selector (broken) | V4 Selector (works) | Why |
|--------|---------------------|---------------------|-----|
| Root container | `.elementor-section` | `.e-con` or `[data-id]` | V4 uses `.e-con` |
| Full-width inner | `.elementor-section > .elementor-container` | `.e-con-full` (no inner wrapper!) | No `.e-con-inner` on full-width |
| Boxed container inner | `.elementor-section > .elementor-container` | `.e-con-boxed > .e-con-inner` | `.e-con-inner` exists only on boxed |
| Widget wrapper | `.elementor-widget-wrap` | `.e-con .elementor-widget` | Direct child |
| Row direction | `.elementor-row` | `.e-flex` | Auto-applied |

## 2. CSS Property Compatibility

| Property | Status | Workaround |
|----------|--------|------------|
| `transform: translateX()` | **BLOCKED** | V4 sets `transform: none !important` on containers |
| `translate: Xpx Ypx` | **SAFE** | Atomic CSS property, immune to transform override |
| `rotate: 45deg` | **SAFE** | Atomic rotation property |
| `scale: 1.2` | **SAFE** | Atomic scale property |
| `left` / `top` | **RISKY** | Collides with V4 layout engine; use `translate` |
| `width: auto` on `e-con-full` | **Needs !important** | V4 forces 100%; override per child |
| `flex-direction: row` on parent | **Children still 100%** | Must fix each child's width individually |

## 3. Specificity Ladder (highest → lowest)

```
1. body.page-id-X [data-id="containerId"] .class  ← Most reliable
2. body.page-id-X .section-class .widget-class
3. .section-class .widget-class                    ← Often overridden by V4
4. Elementor inline styles                          ← V4 injects these
5. Elementor default CSS                            ← Lowest
```

## 4. When to use `!important`

| Scenario | Use? | Better alternative |
|----------|------|--------------------|
| V4 `width: 100%` on `e-con-full` children | ✅ Yes | `body.page-id-X [data-id="id"] { width: 280px !important; }` |
| Color overrides | ❌ No | Increase specificity with body.page-id-X |
| Font family | ❌ No | Target .elementor-heading-title directly |
| Padding/margin | ❌ No | body.page-id-X + class selector |
| Transform/translate | ❌ NEVER | Use atomic `translate` property |

---

## 5. Anti-Pattern Catalog

### AP-1: CSS transform = überhaupt nicht benutzen

**Symptom:** GSAP `gsap.set(el, {x, y})` tut nichts. Orbit-Bilder kleben am Zentrum.

**Root Cause:** Elementor V4 setzt `transform: none !important` auf `.e-con` Containern. Das überschreibt jeden `element.style.transform`.

**Solution:** `element.style.translate = 'Xpx Ypx'` — die atomare CSS-Property aus CSS Transforms Level 2. Elementors !important-Override fasst translate nicht an.

---

### AP-2: Orbit mit CSS @keyframes

**Symptom:** Bilder verzerren zu Sechsecken, Radius schrumpft, Bilder liegen irgendwann übereinander.

**Root Cause:** `@keyframes` mit `transform: rotate() translateY() rotate()` kollidiert mit V4s transform-Override. Die Wrapper-Rotation wird von V4 überschrieben, die innere Gegenrotation läuft allein.

**Solution:** `requestAnimationFrame` + `item.style.translate` für jedes Bild einzeln berechnet (sin/cos × radius). Keine Rotation nötig — Bilder bleiben von allein aufrecht weil nur verschoben wird.

---

### AP-3: Stats-Items stacken statt nebeneinander

**Symptom:** `flex_direction: row` + `justify-content: center` auf dem Parent ist gesetzt, aber die 3 Stats stapeln vertikal.

**Root Cause:** V4 rendert Kinder als `e-con-full` → `width: 100%`. In einer Row mit 100%-breiten Kindern wird jedes Kind auf eine eigene Zeile umgebrochen.

**Solution A (CSS):**
```css
body.page-id-X [data-id="child1"],
body.page-id-X [data-id="child2"],
body.page-id-X [data-id="child3"] {
  width: auto !important;
  flex: 0 1 auto !important;
  max-width: none !important;
}
```

**Solution B (Elementor settings):** Each child container needs `_element_width: "initial"` + `_element_custom_width: { unit: "px", size: 280 }` and `isInner: true`.

---

### AP-4: GSAP scrub durch toggleActions ersetzt

**Symptom:** Wort-für-Wort-Text-Animation läuft einmal komplett durch statt mit dem Scrollen verknüpft zu sein.

**Root Cause:** Bei der Iteration wurde `scrub: 1` durch `toggleActions: "play none none reverse"` ersetzt. Beide dürfen nie zusammen im selben ScrollTrigger sein.

**Solution:** Für scroll-verknüpfte Animationen IMMER `scrub: 1` benutzen. `toggleActions` ist für einmal-getriggerte Animationen.

```js
// ✅ Richtig: Text-Reveal mit Scrub
gsap.fromTo('.word', {opacity: 0.2}, {
  opacity: 1, stagger: 0.04,
  scrollTrigger: { trigger: '.section', start: 'top 80%', end: 'bottom 40%', scrub: 1 }
});

// ✅ Richtig: Stagger-Animation (einmalig)
gsap.from('.card', {
  y: 40, opacity: 0, stagger: 0.12,
  scrollTrigger: { trigger: '.section', start: 'top 80%', toggleActions: 'play none none reverse' }
});
```

---

### AP-5: `gsap.from()` statt `gsap.fromTo()` bei Scroll-Animationen

**Symptom:** Animation verhält sich falsch beim Rückwärtsscrollen. Elemente bleiben in falschem Zustand hängen.

**Root Cause:** `from()` setzt den Startzustand imperativ und kollidiert mit ScrollTriggers State Management.

**Solution:** Immer `gsap.fromTo(target, {startState}, {endState, scrollTrigger: {...}})`.

---

### AP-6: Leere Strings bei `text.split(' ')`

**Symptom:** Extra leere `<span>` Elemente im DOM, Layout-Lücken oder Animations-Ruckler.

**Root Cause:** `"Hello  World".split(' ')` → `["Hello", "", "World"]`

**Solution:** `text.split(' ').filter(Boolean)` filtert leere Strings raus.

---

### AP-7: Monolithisches CSS/JS pro Seite

**Symptom:** 300 Zeilen CSS + 100 Zeilen JS kopiert pro Seite. 10 Seiten = 10 Kopien. Updates unmöglich.

**Root Cause:** Keine Komponententrennung. Die gesamte Pipeline gibt einen einzigen CSS/JS-Block pro Seite aus.

**Solution:** Komponentenweise Dateien (`hero.css`, `stats.css`, …) + Conditional Loader über `_framer_converter_components` Post Meta. Oder: Community WPCode Snippets (site_wide) mit `body.page-id-X` Scoping akzeptieren, aber das CSS als Referenzdateien versionieren.

---

### AP-8: Schriftarten nicht geladen

**Symptom:** `typography_font_family: "Lora"` in den Elementor-Settings gesetzt, aber die Schrift wird nicht angewendet.

**Root Cause:** Die Schrift-Datei wurde nie geladen. Elementor injectet nur den Font-Family-Namen, kein `<link>` Tag.

**Solution:** Google Fonts `<link>` Tag im WPCode Header Snippet:
```html
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Lora:ital,wght@0,400;0,500;0,600;0,700;1,400&display=swap" rel="stylesheet">
```

---

### AP-9: Elementor Document Cache liefert altes CSS

**Symptom:** Änderungen an Elementor-Settings sind im Editor sichtbar, aber nicht im Frontend.

**Root Cause:** `has_element_cache: true` — der post-Cache wurde nicht invalidiert.

**Solution:** Immer nach programmatischen Änderungen:
```
novamira-adrianv2/clear-cache { post_id: X, scope: "css" }
```

---

### AP-10: `_element_custom_width` ohne `_element_width: "initial"`

**Symptom:** Custom Width in den Elementor-Daten gespeichert, aber kein CSS-Output.

**Root Cause:** Der Begleitschalter `_element_width: "initial"` fehlt.

**Solution:**
```json
{
  "_element_width": "initial",
  "_element_custom_width": { "unit": "px", "size": 280 }
}
```

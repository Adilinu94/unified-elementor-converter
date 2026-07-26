# Reusable patterns (Framer → Elementor V3) — **widget-first**

HTML is an escape hatch, not the default. See `widget-first.md` for the decision tree.

---

## Pattern A — Floating glass header (widgets)

**When:** Sticky nav = two floating glass pills over the hero.

### Structure (preferred)

```
container.site-header          // fixed, transparent, z-index high
  container.header-inner       // row, space-between, isInner
    container.logo-pill        // isInner, width initial
      image | icon             // mark
      heading                  // brand name
    container.nav-pill         // isInner, width initial, row, gap
      button (link style) × N  // or text links via buttons "link" type
      button.book-cta          // solid fill white / dark text
```

### CSS (WPCode) — style **pills**, never the full header bar

```css
.site-header {
  position: fixed !important;
  top: 16px !important;
  left: 0; right: 0;
  z-index: 9999 !important;
  background: transparent !important;
  pointer-events: none;
}
.site-header .header-inner { pointer-events: auto; max-width: 1200px; margin: 0 auto; }
.logo-pill, .nav-pill {
  background: rgba(20,36,36,.55);
  backdrop-filter: blur(14px);
  border-radius: 999px;
}
.site-header.header-scrolled .logo-pill,
.site-header.header-scrolled .nav-pill {
  background: rgba(9,41,43,.92);
}
```

### Escape hatch

Single HTML nav only if multi-link glass pill cannot match with buttons — still keep CTA as real `button` when possible.

### Anti-pattern

- Full-width background on `.site-header.header-scrolled`
- Outline Elementor button as primary CTA when source is solid white fill

---

## Pattern B — Horizontal stats row (widgets)

```
container.stats-row   // flex row, center, wrap, gap
  container.stat-item // isInner + _element_width:initial + custom width or auto
    heading           // number
    text-editor       // label
  divider | 1px container
  …
```

**Critical:** every `stat-item` must **not** be unconstrained full width (see `v3-gotchas.md`). Prefer width fix over HTML.

---

## Pattern C — Orbit cluster (image widgets + heading)

```
container.orbit-section
  container.orbit-stage       // position:relative, fixed size, overflow:hidden
    container.orbit-wrapper   // position:absolute, inset:0, pointer-events:none
      image.orbit-item × 6    // position:absolute, top/left 50%, negative margin
    heading.orbit-title       // position:absolute, centered, z-index:20
```

**CRITICAL:** The orbit animation runs via JavaScript (`requestAnimationFrame`), NOT CSS `@keyframes`. See `v4-engine.md` for full explanation. The old CSS `transform: rotate() translateY()` approach fails because Elementor V4 engine overrides `transform` with `!important`.

```css
.orbit-stage { position: relative; width: min(900px,100%); height: 720px; overflow: hidden; }
.orbit-wrapper { position: absolute; inset: 0; pointer-events: none; }
.orbit-item {
  position: absolute; top: 50%; left: 50%;
  width: 160px; height: 160px;
  margin-left: -80px; margin-top: -80px;
  border-radius: 18px; overflow: hidden;
  will-change: translate;
}
.orbit-item img { width: 100%; height: 100%; object-fit: cover; }
.orbit-title {
  position: absolute; top: 50%; left: 50%;
  translate: -50% -50%; /* atomic property, not blocked by V4 */
  z-index: 20; pointer-events: none;
  text-align: center; max-width: 420px;
}
```

```js
// WPCode footer snippet — requestAnimationFrame + style.translate
// NEVER use gsap.set with transform, CSS @keyframes, or left/top.
(function(){
  var items = document.querySelectorAll('.orbit-item');
  if (!items.length) return;
  var DESKTOP_R = 320, MOBILE_R = 190, DURATION = 28;
  var n = items.length, step = (2*Math.PI)/n, t0 = null;
  function getR(){ return innerWidth<768 ? MOBILE_R : DESKTOP_R; }
  function tick(ts){
    if (!t0) t0 = ts;
    var f = ((ts-t0)/1000 % DURATION) / DURATION;
    var r = getR();
    for (var i = 0; i < n; i++) {
      var a = step*i + f*2*Math.PI - Math.PI/2;
      items[i].style.translate = (Math.cos(a)*r).toFixed(2)+'px '+(Math.sin(a)*r).toFixed(2)+'px';
    }
    requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);
})();
```

**Why this works:** `style.translate` is an atomic CSS property (CSS Transforms Level 2). Elementor V4's `transform: none !important` does NOT override it. No counter-rotation, no sechseck distortion, no shrunken radius.

**Never** put orbit photos inside an HTML string. Never use CSS `@keyframes` for orbit.

---

## Pattern D — Team / logo marquee (widgets + CSS)

```
container.team-marquee        // overflow:hidden
  container.team-track        // flex row, nowrap; animated
    container.doctor-card     // fixed width via _element_custom_width
      image
      heading
      text-editor
    … duplicate set for seamless loop
```

```css
.team-marquee { overflow: hidden; width: 100%; }
.team-track {
  display: flex;
  gap: 16px;
  width: max-content;
  animation: ch-marquee 40s linear infinite;
}
@keyframes ch-marquee { to { transform: translateX(-50%); } }
```

Motion is CSS/GSAP. Cards are real widgets.

---

## Pattern E — Service / feature cards (widgets)

**Photo card**

```
container.services-grid // wrap row
  container.service-card
    image
    container.meta
      heading
      text-editor?
      button?
```

**Icon feature**

```
container → icon-box
// or icon + heading + text-editor + button
```

Use Elementor border-radius / box-shadow on the card container; image object-fit via CSS class if needed.

---

## Pattern F — GSAP text (heading + WPCode)

```
heading | text-editor
  css_classes: gsap-split-text
  full copy in widget settings
```

WPCode targets `.gsap-split-text` — no HTML paragraph widget.

---

## Pattern G — WPCode split

| Snippet | Location | Role |
|---|---|---|
| Fonts + CSS | `site_wide_header` | Google Fonts + structural CSS, scoped `body.page-id-N` |
| GSAP | `site_wide_footer` | gsap + ScrollTrigger + init |

```js
if (!document.body.classList.contains('page-id-4868')) return;
```

---

## Pattern H — Offline tree builder

Generate JSON locally for large pages; still **emit native widgets**, not HTML dumps.

```js
const image = (url, alt, classes) => ({
  id: id('w'),
  elType: 'widget',
  widgetType: 'image',
  settings: { image: { url, alt }, css_classes: classes },
});
const heading = (title, tag, classes, extra = {}) => ({
  id: id('w'),
  elType: 'widget',
  widgetType: 'heading',
  settings: { title, header_size: tag, css_classes: classes, ...extra },
});
```

Deploy: upload-link → PHP inject → `elementor-clear-document-cache`.

---

## Pattern Z — HTML escape hatch (rare)

Use only for:

- Tiny custom SVG without media asset
- Third-party embed iframe
- Temporary debug

If a pattern above can be done with containers + widgets + CSS, **do that**.

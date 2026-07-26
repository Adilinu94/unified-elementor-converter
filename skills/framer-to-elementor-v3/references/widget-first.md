# Widget-first decision guide (any page)

**Goal:** Rebuild arbitrary marketing sites in Elementor V3 so the page stays editable in the Elementor UI — not as a bag of HTML blobs.

**Rule of three layers**

| Layer | Tool | Examples |
|---|---|---|
| Structure | `container` (flex row/column, gap, pad, bg) | sections, cards, grids, pills |
| Content | native widgets | `heading`, `text-editor`, `image`, `button`, `icon-box`, `icon`, `divider`, `image-box`, `star-rating`, `video`, `nested-accordion` / `toggle` / `accordion` |
| Behavior | CSS class + **WPCode** (CSS/JS/GSAP) | orbit spin, marquee, split-text, sticky glass, scroll reveals |

`html` widget = **last resort only** (see §4).

---

## 1. Per-node classifier (run before every section)

For each visual node in the source (Framer / screenshot / DOM):

```
Q1. Is it a layout box?          → container
Q2. Is it a photo / icon asset?  → image  (or icon widget)
Q3. Is it a title / one line?    → heading
Q4. Is it body / multi-line?     → text-editor
Q5. Is it a clickable CTA?       → button
Q6. Is it icon + title + blurb?  → icon-box (or image-box)
Q7. Is it only motion/effect?    → keep native widget, add css_classes, animate in WPCode
Q8. Truly no V3 widget?          → html (document why)
```

Never start from “this is complex → HTML”. Start from the table above, then compose containers.

---

## 2. Universal section recipes

### 2.1 Animated / GSAP text (word reveal, scrub, split)

**Wrong:** one `html` with the full paragraph.

**Right:**

```
container.manifesto-section
  └─ heading | text-editor
       settings.title / editor = full copy
       settings.css_classes = "gsap-split-text"
       typography + color in widget settings
```

WPCode (footer):

```js
// page guard
if (!document.body.classList.contains('page-id-XXXX')) return;
const el = document.querySelector('.gsap-split-text');
// SplitText or wrap words, then ScrollTrigger scrub
```

Same pattern for any scroll-linked copy on **any** site: native text widget + class + GSAP.

### 2.2 Orbit / radial image cluster

**Wrong:** one HTML blob with `<img>` tags + title.

**Right:**

```
container.orbit-stage          // relative, fixed height via min-height / CSS
  ├─ container.orbit-wrapper   // absolute inset 0; CSS animation rotate
  │    ├─ container.orbit-item.orbit-i-0  // absolute; transform via CSS --i
  │    │    └─ image  (media URL / id)
  │    ├─ container.orbit-item.orbit-i-1
  │    │    └─ image
  │    └─ …
  └─ heading.orbit-title       // centered, z-index 2, white color in settings + CSS !important
```

- Every photo is an **image** widget (editable, alt text, media library).
- Position math lives in WPCode CSS (same as HTML version, but selectors target `.orbit-item`).
- Title is a **heading**, never baked into HTML.

Width trap: each `orbit-item` needs `_element_width: "initial"` + fixed `_element_custom_width` (e.g. 120px) and `isInner: true`.

### 2.3 Service / expertise cards (image + label)

**Wrong:** card as single HTML string with `<img>` + text.

**Right (image card with overlay label):**

```
container.services-grid   // flex row, wrap, gap
  └─ container.service-card   // flex column; border-radius; overflow hidden
       ├─ image               // cover, aspect ratio via CSS or object-fit CSS class
       └─ container.service-meta  // absolute bottom or stacked under image
            ├─ heading        // service name
            └─ text-editor    // optional blurb
            └─ button         // optional CTA
```

**Right (icon feature card):**

```
container.feature-card
  └─ icon-box   // icon + title + description in one widget
  // OR: icon + heading + text-editor + button as siblings
```

Prefer `icon-box` when the source is icon+title+text. Prefer `image` + `heading` when the source is photo-led.

### 2.4 Team marquee / logo strip / infinite slider

**Wrong:** one HTML track with duplicated cards.

**Right:**

```
container.team-marquee          // overflow:hidden (CSS)
  └─ container.team-track       // flex row, nowrap, gap; CSS/GSAP translateX loop
       ├─ container.doctor-card // width constrained!
       │    ├─ image
       │    ├─ heading          // name
       │    └─ text-editor      // role
       ├─ container.doctor-card
       │    └─ …
       └─ (duplicate set of cards for seamless loop — still real widgets)
```

- Marquee motion = CSS `@keyframes` or GSAP on `.team-track`, **not** HTML structure.
- Duplicate cards as real Elementor elements (or clone via build script) so names/photos stay editable.
- Card width: `_element_width: "initial"` + `_element_custom_width` (e.g. 280px).

### 2.5 Stats / keyfacts row

**Wrong (legacy):** whole row as HTML — only needed when flex width bugs were unfixed.

**Right (after G6c/G7c normalize):**

```
container.stats-row   // flex row, center, gap
  ├─ container.stat-item   // isInner, width initial, custom % or auto
  │    ├─ heading          // "15+"
  │    └─ text-editor      // label
  ├─ divider | thin container as 1px line
  └─ …
```

If nested flex still stacks once, fix **widths** first (gotchas). HTML only if still broken after width fix.

### 2.6 Floating glass header

**Preferred (widgets):**

```
container.site-header   // fixed, transparent shell, css class
  └─ container.header-inner  // row, space-between, max-width via boxed or CSS
       ├─ container.logo-pill
       │    ├─ image | icon   // mark
       │    └─ heading        // wordmark
       └─ container.nav-pill
            ├─ button | heading links  // or text-editor with links only if needed
            └─ button.book-cta         // solid white fill in button settings
```

CSS (WPCode) styles pills; scroll class toggles pill background only.

**Acceptable HTML escape:** dense multi-link nav when button widgets fight glass styling — still keep CTA as real `button` if possible. Document the exception.

### 2.7 FAQ

Prefer Elementor **accordion** / **toggle** / **nested-accordion** over `<details>` HTML when available on the site.

Fallback: container + heading (question) + text-editor (answer) with simple expand CSS — still no bulk HTML.

### 2.8 Testimonials

```
container.testimonial-card
  ├─ text-editor   // quote
  ├─ heading       // name
  └─ text-editor   // role / clinic
```

Stars: `star-rating` widget or icon row — not HTML spans if avoidable.

---

## 3. Container discipline (makes widgets possible)

Without these, agents “give up” and paste HTML:

1. Nested containers: always `isInner: true`
2. Flex-row children: never unconstrained `content_width: full` → use `_element_width: "initial"` + custom width
3. Every animated/targetable node gets a stable `css_classes` string
4. Visual polish that Elementor settings cannot do (backdrop-filter, complex absolute orbit math) → **CSS in WPCode**, not HTML structure

---

## 4. When `html` is allowed

| Allowed | Not allowed |
|---|---|
| Tiny decorative SVG mark with no media file | Entire sections of copy |
| One-off embed (map iframe, third-party widget) | Service cards, team cards, orbit images |
| Temporary prototype while debugging layout | Production “done” page with majority HTML |
| Truly custom markup with no free/pro widget | GSAP text (use heading + class) |

**Hard budget for production clones:**

- `htmlWidgetCount / totalWidgets ≤ 0.15` (15%) preferred
- Any section that is 100% one HTML widget and contains `<img>` or multi-paragraph text = **fail QA**
- Log every HTML usage with a one-line reason in the session report

---

## 5. Section → widget planning sheet (use every build)

Before writing JSON, fill for **each** section (works for any URL):

```markdown
### Section: <name>
- Layout: row|column | wrap? | gap | bg
- Nodes:
  - [text] "…" → heading|text-editor | class=
  - [image] url → image | class=
  - [cta] "…" → button | class=
  - [motion] orbit|marquee|split|sticky → class + WPCode note
- HTML exceptions: none | reason=
```

If the sheet has more HTML than widgets, replan.

---

## 6. ClinicHub debt (post-4868 lesson)

Shipped with ~28 `html` widgets and **0** `image` widgets. User feedback:

- Manifesto GSAP text → heading + class + WPCode  
- Orbit → image widgets + heading  
- Service cards → containers + image + heading/button  
- Team marquee → containers + image + heading + track CSS  

Treat that build as a **negative example** for structure; keep its visual CSS/GSAP as motion reference only.

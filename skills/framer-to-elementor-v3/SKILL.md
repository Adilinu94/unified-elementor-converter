---
name: framer-to-elementor-v3
description: >
  Framer (or any marketing site) → Elementor V3 rebuild on WordPress via Novamira.
  NOT V4 Atomic (no e-flexbox, e-heading, e-button, Global Classes $$type).
  Use when: Framer clone, Framer→Elementor, Elementor V3 rebuild, site-clone-to-v3,
  Unframer MCP, FramerExport, glass/sticky header, GSAP via WPCode, ClinicHub-style
  pixel rebuild, "baue Framer in Elementor nach", or /framer-to-elementor-v3.
metadata:
  short-description: "Framer → Elementor V3 (Novamira + WPCode + QA)"
---

# Framer → Elementor V3

Production workflow distilled from real ClinicHub and pipeline runs.
**Default stack:** Elementor V3 containers/widgets only · Novamira MCP · WPCode (fonts/CSS/GSAP) · screenshot QA.

Load companion references when needed:
- `references/widget-first.md` — **mandatory** section→widget decision tree (any page)
- `references/v3-gotchas.md` — silent write failures + flex width fixes
- `references/patterns.md` — header / stats / orbit / marquee / cards as **native widgets**
- `references/v4-engine.md` — **critical** V4 engine CSS rules, anti-patterns, atomic `translate` fix
- `references/component-playbooks.md` — step-by-step build instructions per component type
- `references/qa-checklist.md` — pre-ship visual + HTML-budget checks

**Repo docs (if site-clone-to-v3 is available):**
- `docs/AI-EXECUTOR-PLAYBOOK.md` — full pipeline + Novamira/WPCode practice for any URL
- `docs/PRODUCT-BACKLOG-P1-P10.md` — product improvements
- `docs/DESIGN-CRITIC-ARCHITECTURE-2026-07.md` — post-build designer QA

Do **not** use `elementor-v4-atomic-builder` unless the user explicitly wants V4.

---

## 0. Hard rules

1. **V3 only** unless user says V4: `container` + `heading` / `text-editor` / `button` / `image` / `icon-box` / `icon` / `divider` / `html` — never `e-flexbox`, `e-heading`, `e-button`, `$$type` styles.
2. **Screenshot-first truth** beats Blueprint text when they conflict — unless the user chose Hybrid / Blueprint-wins.
3. **A successful write ≠ visible result.** Always verify frontend HTML + hard-reload + clear Elementor element cache.
4. **Widget-first (critical):** structure = containers · content = native widgets · motion = CSS class + WPCode.  
   - Photos → `image` (never `<img>` in HTML)  
   - Titles / GSAP text → `heading` or `text-editor` + class + GSAP in WPCode  
   - Cards → container + image/heading/text/button or `icon-box`  
   - Marquee / orbit → containers + widgets; animate the track/wrapper in CSS/GSAP  
   - `html` only as last resort (SVG mark, third-party embed). Budget: ≤15% of widgets. See `widget-first.md`.
5. Animations (GSAP/ScrollTrigger) go into **WPCode**, not inline Elementor custom JS when possible.

---

## 1. Preflight (before any build)

### 1.1 Clarify scope (ask once if missing)

| Question | Why |
|---|---|
| Homepage only or all routes? | Scope creep killer |
| New page vs overwrite existing? | post_id / slug |
| Pure Framer fidelity vs Hybrid (Blueprint layout + Framer tokens)? | Source of truth |
| V3 only confirmed? | Site may be V4-capable |

### 1.2 Tooling

```
[ ] Novamira MCP connected (discover-abilities)
[ ] Unframer MCP (project XML / components) if Framer source
[ ] FramerExport / framerusercontent image URLs
[ ] Screenshots folder (1 section per image ideal)
[ ] Blueprint / SPEC if provided — cross-check vs Framer
[ ] site-clone-to-v3 repo available for pipeline hints (optional)
```

### 1.3 Detect Elementor mode on target page

- Use Novamira version/detect abilities.
- Confirm page will stay **V3** (`page_is_v4: false` after save).
- Template: prefer `elementor_canvas` for full-bleed Framer clones (no theme header chrome).

---

## 2. Extract → Spec

### 2.1 Visual map

For each screenshot / viewport section note:

- Background (color / image / overlay / radius)
- Layout axis (row vs column), alignment, gaps
- Typography (family, size, weight, color) — measure hero vs body
- Buttons (fill vs outline, radius, hover)
- Overlays (sticky glass nav over hero?)
- Motion cues (orbit, marquee, scroll reveal) → WPCode later

### 2.2 Tokens (Hybrid default if both sources exist)

| Token | Prefer from Framer | Prefer from Blueprint |
|---|---|---|
| Colors / fonts | ✓ | |
| Section order / copy structure | | ✓ if user said Hybrid |
| Exact spacing | Screenshots | |

Document conflicts in one line before building, e.g.:

> Framer: Lora + `#09292B` · Blueprint: Playfair + `#0F2E2E` → **use Framer tokens**.

### 2.3 Assets

- Prefer durable `framerusercontent.com` URLs or upload to WP media.
- List every image with section ownership (hero, orbit[i], doctor[i], …).

---

## 3. Build strategy

### 3.1 Page shell

1. Create page (or reuse post_id).
2. Set Elementor edit mode + `elementor_canvas` if full-bleed.
3. Create kit colors/typography only if useful (V3 kit) — fonts often still need WPCode Google Fonts link.
4. Build tree offline as JSON (`build-tree.mjs` pattern) when > ~5 sections — MCP payload limits bite.

### 3.2 Section inventory (typical Framer marketing home)

```
header (overlay) → hero → metrics → manifesto/story → orbit/feature
→ expertise grid → how-it-works → why-us → team marquee
→ testimonials → faq + side CTA → footer CTA
```

Give every section a stable CSS class: `hero-section`, `stats-section`, `orbit-section`, …

### 3.3 Widget choice (widget-first)

| Need | Prefer |
|---|---|
| H1–H3, one-line titles | `heading` |
| Body / multi-line / GSAP split text | `text-editor` or `heading` + `css_classes` + WPCode GSAP |
| Photo / avatar / card media | **`image`** |
| CTA | `button` (full bg/radius/typography) |
| Icon + title + blurb | `icon-box` (or icon + heading + text-editor) |
| FAQ | `accordion` / `toggle` / nested-accordion |
| Stars | `star-rating` |
| Layout grids, cards, orbit shells, marquee tracks | **`container` flex** + classes |
| Motion (orbit, marquee, sticky glass, scroll) | class on container/widget + **WPCode CSS/JS** |
| Truly no widget (SVG mark, iframe embed) | `html` — log reason |
| Background image section | container `background_background: classic` + overlay |

**Before each section:** fill the planning sheet in `references/widget-first.md` §5.

### 3.4 Container rules (V3)

```
Root sections:     isInner: false, content_width: full
Nested layout:     isInner: true  (always for children)
Flex row children: NEVER leave as content_width full without width constraint
                   → use _element_width: "initial" + _element_custom_width
                   → fix widths first; do NOT jump to HTML for layout
```

See `references/v3-gotchas.md`.

### 3.5 Patterns to copy

Load `references/patterns.md` + `widget-first.md` for:

- Floating glass header (logo/nav pills as containers + button CTA)
- Stats row as heading/text widgets with constrained widths
- Orbit as image widgets + center heading
- Team marquee as card containers + track CSS
- Service cards as image + heading + button
- WPCode split: fonts+CSS header · GSAP footer

---

## 4. Deploy (Novamira)

### 4.1 Small edits

- `novamira/elementor-edit-element` for single widgets.
- `novamira/elementor-get-content` skeleton first, then `element_id` drill.

### 4.2 Full tree (large pages)

1. `novamira/create-upload-link` → PUT JSON to `wp-content/novamira-sandbox/…`
2. `novamira/execute-php` → decode JSON → `documents->save` / update `_elementor_data`
3. **Always** `novamira/elementor-clear-document-cache` with `post_ids: [id]`
4. `clean_post_cache` / Elementor files_manager clear if available

### 4.3 WPCode

| Snippet | Location | Content |
|---|---|---|
| Fonts + base CSS | `site_wide_header` | Google Fonts + page-scoped CSS (`body.page-id-N`) |
| GSAP + ScrollTrigger | `site_wide_footer` | CDN scripts + init, prefer page check |

Optional: conditional logic / `page-id-N` so snippets don't pollute the whole site.

`create-wpcode-snippet`: omit private fields that fail schema (e.g. some `priority` shapes). Prefer `update-wpcode-snippet` for iterations.

### 4.4 PHP namespace gotcha

In execute-php code strings use **single** backslash for `\Elementor\Plugin` — over-escaping (`\\Elementor`) causes ParseError.

---

## 5. QA loop (mandatory before "done")

Run `references/qa-checklist.md` against:

1. Live frontend (hard reload)
2. Reference screenshots side-by-side
3. Framer live URL if still available

**Never** mark done only because MCP returned `success: true`.

Known false "done" modes:

- Elementor element cache still serving old HTML (`has_element_cache: true`)
- CSS applied site-wide but page class missing
- Nested stats stacked (100% width children)
- Header full-width solid color instead of glass pills
- Text color overridden by theme (`h2` black on dark section) → force inline + `!important` in WPCode

---

## 6. Polish protocol

When user reports visual bugs:

1. Name section + expected vs actual in one line.
2. Open screenshot + live HTML for that section only.
3. Prefer surgical fix (edit-element + CSS) over full redeploy when possible.
4. After structural layout bugs in flex rows → **fix widths / isInner first**; HTML only if still broken and documented.
5. Re-clear document cache.
6. Log the learning into this skill / repo docs if new.

---

## 7. Repo pipeline (`site-clone-to-v3`) — optional path

If using the automated pipeline:

```bash
npx clone-v3 preflight <url>
npx clone-v3 clone <url> --target <name> --output-format v3
```

Still apply this skill's **V3 gotchas + visual QA** after pipeline output — the pipeline does not replace screenshot QA for glass headers / nested flex / orbit typography.

Suggested future pipeline fixes (from ClinicHub):

- Nested flex children default `isInner: true` + non-100% width
- Patterns: sticky-glass-header, stat-row, orbit-cluster
- QA rule: flex-row children must not compute to 100% width stack
- QA rule: overlay header must not paint full solid background

---

## 8. Anti-patterns (do not)

- Building V4 atomic widgets "because the site supports V4"
- **Dumping whole sections into `html` widgets** (orbit, cards, marquee, GSAP text, photos)
- Full-width solid scroll header when Framer uses floating pills
- Transparent outline CTA when Framer shows white fill
- Nested full-width containers that stack a row (fix widths — don't HTML-bail immediately)
- Declaring fonts only in Elementor kit without actual font load
- Site-wide GSAP without page guard on multi-site installs
- Shipping without cache clear after tree inject
- Trusting Blueprint numbers that contradict FramerExport/screenshots without documenting Hybrid choice
- Shipping with zero `image` widgets when the source has photos

---

## 9. Minimal session template

```markdown
## Clone brief
- Source: <framer url>
- Target WP: <url> post_id=<n>
- Mode: V3 only · Hybrid|Framer-pure|Blueprint-pure
- Scope: homepage | …

## Tokens
- Primary: #
- Fonts: display / body
- Conflicts resolved: …

## Sections (order)
1. …
2. …

## WPCode
- CSS snippet id:
- GSAP snippet id:

## QA
- [ ] checklist green
- [ ] cache cleared
- Live: <url>
```

---

## Worked-example note

Past production rebuilds taught **generic** lessons (glass header shell, flex widths, WPCode dual-write, html budget).  
Do **not** hardcode one client's class names or copy into core generators — use project config / section class prefixes.  
See `docs/AI-EXECUTOR-PLAYBOOK.md` and `references/widget-first.md`.

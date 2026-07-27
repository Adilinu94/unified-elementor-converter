# Session lessons archive — production V3 rebuild (Juli 2026)

**Status:** Historical incident log for one production rebuild.  
**Do not** copy brand names, post IDs, or class prefixes into product code or umbauplan phases.  
**Generalize** every lesson via `AI-EXECUTOR-PLAYBOOK.md` + backlog P1–P10.

**Skill capture:** `framer-to-elementor-v3`  
This file lists pipeline improvements suggested by the run — productized elsewhere.

---

## 1. Visual bugs that the first V3 tree shipped with

| Symptom | Root cause | Fix pattern |
|---|---|---|
| Header full green bar, not over hero | Full-width container + scroll CSS painted entire bar | Glass pills HTML; header shell always transparent |
| Book a Visit no white fill | Outline/transparent Elementor button outside pill | CTA inside nav pill, `background:#fff` |
| "Reviews" looked wrong | CTA orphaned next to pill edge | Same pill as nav links |
| Stats 15+/10K/99% stacked | Nested `content_width:full` children = 100% width | Fix widths (`isInner` + `_element_width:initial`) — **not** HTML-first |
| Orbit title black + wrong font | Theme h2 color; weak CSS | Native `heading` + white + Lora + WPCode `!important` |
| Too many HTML widgets (~28, 0 images) | HTML escape used as default for complex UI | **Widget-first** (see skill `widget-first.md`) |

---

## 2. Recommended pipeline code changes (`site-clone-to-v3`)

### P0 — Builder ✅ (implemented 2026-07)

1. **Nested containers:** `normalizeV3ContainerTree()` sets `isInner: true` for nested containers.
2. **Flex-row children:** unconstrained row children get companion `_element_width: "initial"` + equal `%` width.
3. **Auto-apply:** `pushToWordPress()` normalizes before inject; guards `G6c` / `G7c` warn pre-push.
4. **Patterns registry (widget-first — not `*-html`):**
   - `sticky-glass-header` → containers + image/heading/button
   - `stat-row` → heading + text-editor + width constraints
   - `orbit-cluster` → image widgets + center heading
   - `marquee-row` → card containers + track CSS
   - `service-cards` → image + heading + button | icon-box  
   (skill: `references/widget-first.md` + `patterns.md`)

### P1 — QA (`issue-detector` / visual)

1. Flag **flex-row with N children each computing ~100% width** (stack risk).
2. Flag **overlay/fixed header whose background is opaque full-width** when source header is glass/transparent.
3. Flag **text on dark background with near-black computed color**.
4. Keep existing `missing-texture` detector.

### P2 — Docs / skill bridge

1. Link this file from `TROUBLESHOOTING.md` and `novamira-skill/clone-workflow.md`.
2. Session-start checklist: require screenshot inventory + Hybrid token table before build.

### P3 — Deploy helpers

1. After `wp-push` / set-content: always clear `_elementor_element_cache`.
2. Document upload-link + PHP inject path for large trees (MCP payload limits).

---

## 3. Hybrid source-of-truth rule (product)

When Blueprint and Framer disagree:

1. Ask user once: Framer-pure | Blueprint-pure | Hybrid.
2. Default Hybrid used here: **Framer colors/fonts**, Blueprint layout/GSAP notes, **screenshots win pixel disputes**.
3. Write the decision into the run report.

---

## 4. Novamira ability notes

- `elementor-set-content` large trees → prefer sandbox upload + PHP.
- `elementor-clear-document-cache` uses `post_ids: number[]` (not `post_id`).
- WPCode: `update-wpcode-snippet` for iteration; omit invalid priority shapes on create.
- execute-php: single-backslash namespaces for `\Elementor\Plugin`.

---

## 5. Definition of done (clone)

Not "JSON written". Done = QA checklist A2 + B–F green against screenshots  
(see skill `references/qa-checklist.md`) — including **widget-first budget**.

## 6. User feedback 2026-07 (structure debt — HTML overuse)

Live page overused HTML widgets. Required direction for **all future pages**:

| Section | Was | Should be |
|---|---|---|
| GSAP manifesto text | HTML paragraph | `heading`/`text-editor` + class + WPCode GSAP |
| Orbit photos | HTML `<img>` cluster | `image` widgets in positioned containers |
| Service cards | HTML card blobs | Flex containers + image + heading/button or icon-box |
| Team marquee | HTML track | Flex track + card widgets; CSS/GSAP for motion |

Principle: **editable Elementor tree first**, visual parity via WPCode CSS/JS second.

## 7. Visual QA (how to detect remaining layout bugs)

**Do not** ship on tree write success. Use:

1. `node scripts/visual-diff.mjs --v3-url <framer> --v4-url <live> --section hero --mode fold`  
   - Example: `node scripts/visual-diff.mjs --v3-url <ref> --v4-url <live> --section hero`
2. Playwright geometry: `getBoundingClientRect` / `getComputedStyle`  
   - Header `backgroundColor` alpha 0; video `x` > copy `x`; stats `justify-content: center`
3. Widget-first budget + skill QA checklist A2

**Full backlog:** [`VISUAL-QA-IMPROVEMENTS-2026-07.md`](./VISUAL-QA-IMPROVEMENTS-2026-07.md)  
→ implement under Umbauplan **Phase F**.

### WPCode pitfall

Updating `post_content` alone is not enough — WPCode serves from option **`wpcode_snippets`**. Always sync both (or CSS never reaches the frontend).

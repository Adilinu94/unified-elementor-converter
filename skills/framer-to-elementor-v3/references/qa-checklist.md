# QA checklist — Framer → Elementor V3

Run after every deploy and after every polish pass. **Do not ship on MCP success alone.**

**Visual automation (recommended):**  
`site-clone-to-v3` → `node scripts/visual-diff.mjs --v3-url <framer> --v4-url <live> --section hero --mode fold`  
Full backlog: `site-clone-to-v3/docs/VISUAL-QA-IMPROVEMENTS-2026-07.md`

---

## A. Technical

```
[ ] Page is V3 (not atomic V4 widgets on this document)
[ ] Template elementor_canvas (if full-bleed Framer)
[ ] elementor-clear-document-cache for post_id
[ ] Hard reload frontend (cache bust query ok)
[ ] Google Fonts link present in HTML head
[ ] WPCode CSS + GSAP snippets active (sync post_content AND wpcode_snippets option)
[ ] GSAP scoped or intentional site-wide
[ ] No PHP errors in execute-php / WPCode last_error
[ ] visual-diff or Playwright geometry checks run for changed sections
```

## A2. Widget-first budget (any page)

```
[ ] Photos use image widgets (not <img> inside html widgets)
[ ] Animated copy uses heading/text-editor + class + WPCode (not HTML blob)
[ ] Cards/marquee/orbit are containers + native widgets
[ ] htmlWidgetCount / totalWidgets ≤ 0.15 (or every HTML use has a written reason)
[ ] No section that is a single html widget with multi-paragraph copy or multiple images
```

---

## B. Header / nav (high failure rate)

```
[ ] Header OVERLAPS hero (not pushing content down with solid bar)
[ ] Background of header shell is transparent
[ ] Logo sits in glass pill
[ ] Nav links sit in glass pill
[ ] Primary CTA is white fill + dark text (if Framer shows that)
[ ] CTA is INSIDE the nav pill (not orphaned Elementor button)
[ ] On scroll: pills darken — full-width green/dark bar does NOT appear
[ ] Link labels match Framer (Expertise / Why us / Doctors / Reviews …)
[ ] Mobile: nav degrades cleanly (hide links, keep CTA or hamburger plan)
```

---

## C. Hero

```
[ ] Background image + overlay match screenshot tone
[ ] Rating/stars line present and readable
[ ] Headline font (serif/sans) + white/dark color correct
[ ] Primary hero CTA white/solid as in Framer
[ ] Video/card secondary content position (left/right) correct
```

---

## D. Metrics / keyfacts

```
[ ] Stats are SIDE BY SIDE on desktop (not stacked)
[ ] Dividers vertical between stats
[ ] Numbers use display font; labels muted body font
[ ] Section background white/cream as reference
```

---

## E. Dark sections (manifesto / orbit)

```
[ ] Body text is white/light on dark bg (not theme-black)
[ ] Orbit/center title is white + correct serif
[ ] Font family actually loads (not fallback Arial if Lora expected)
[ ] Orbit images visible and circular motion (if required)
```

---

## F. Grids / cards / team

```
[ ] Card radius, image crop, label chips match
[ ] Service cards editable as image + heading (not one HTML card)
[ ] Team marquee continuous (if present) and built from image/heading widgets
[ ] Orbit images are image widgets (if orbit section exists)
[ ] No broken image URLs
```

---

## G. FAQ / footer / CTA

```
[ ] FAQ expand works (details/summary or Elementor accordion)
[ ] Footer columns + legal links
[ ] Final CTA contrast correct
```

---

## H. Screenshot diff protocol

For each numbered screenshot:

1. Open reference + live side by side (same viewport width, ideally 1440).
2. Note max 3 deltas per section (layout / type / color).
3. Fix highest visual impact first (header, hero, metrics).
4. Re-check only that section after fix (then full scroll once).

---

## I. Frontend HTML smoke (curl / scrape)

Search for presence of:

```
ch-header-inner / glass classes
ch-book-btn
stats-row
orbit-title with color:#FFFFFF or white
hero-section
```

Absence after deploy → cache or inject failure.

---

## J. Done criteria

```
[ ] User-facing URL works without login
[ ] No full-width solid wrong-color header
[ ] No vertical stats on desktop
[ ] Critical headings correct color/font
[ ] Checklist B–E green
[ ] Brief updated with post_id + snippet ids
```

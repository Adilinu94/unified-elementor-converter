# Elementor V3 Gotchas (silent failures)

Values can write to `_elementor_data` without errors and still **not render**. Always verify computed CSS / frontend HTML.

---

## 1. Companion switcher: custom width

`_element_custom_width` only works with:

```json
"_element_width": "initial",
"_element_custom_width": { "unit": "px", "size": 280 }
```

Without `_element_width: "initial"`, the custom width is stored but produces **no CSS**.

Symptom: logo/header too large, flex children full-bleed.

---

## 2. Nested containers stack in a "row"

Parent has `flex_direction: "row"`, but children still stack vertically.

**Cause:** each child container uses `content_width: "full"` → width 100% → wrap/stack.

**Fixes (in order — widget-first):**

A. Constrain children (**default**):

```json
{
  "isInner": true,
  "content_width": "full",
  "_element_width": "initial",
  "_element_custom_width": { "unit": "%", "size": 30 }
}
```

B. Force CSS on the section class:

```css
.stats-section .e-con-inner { display: flex; flex-direction: row; }
.stats-section .stat-item { width: auto !important; flex: 0 1 auto; }
```

C. **HTML escape-hatch** (last resort only — metrics/orbit/cards/marquee must stay native widgets; see `widget-first.md`):

One `html` widget with `display:flex` only if A+B fail and the exception is documented.

---

## 3. `isInner` wrong

- Root page sections: `isInner: false`
- Nested containers: `isInner: true`

Wrong nesting creates `e-parent` on children and full-width layout quirks.

---

## 4. Transparent header becomes solid bar

Framer glass pills ≠ full-width Elementor header with background on scroll.

**Wrong:**

```css
.clinichub-header.header-scrolled {
  background: rgba(9,41,43,.95); /* paints ENTIRE viewport width */
}
```

**Right:** header shell always transparent; only **pills** get blur/bg.

```css
.clinichub-header { background: transparent !important; }
.ch-logo-pill, .ch-nav-pill {
  background: rgba(20,36,36,.55);
  backdrop-filter: blur(14px);
  border-radius: 999px;
}
```

---

## 5. Button looks "unstyled"

- Outline/transparent CTA when Framer uses **white fill**
- Theme CSS overrides Elementor button bg
- Button outside glass pill while nav links are inside → "Reviews" looks wrong

**Fix:** put primary nav CTA **inside** the same nav pill container as the links, with solid white button settings (or explicit CSS). Prefer real `button` widget, not only HTML.

---

## 6. Heading color/font ignored in HTML clusters

Theme `h2 { color: #111 }` beats class-only rules.

**Fix:** inline styles on critical text + WPCode `!important`:

```html
<h2 class="orbit-title" style="font-family:Lora,serif;color:#FFFFFF !important;-webkit-text-fill-color:#FFFFFF;">…</h2>
```

---

## 7. Typography without font load

Setting `typography_font_family: "Lora"` does nothing if Lora is not loaded.

Always inject Google Fonts (or self-host) via WPCode header.

---

## 8. `min-height` in `vh` unpredictability

Prefer explicit `px` for hero min-heights when matching screenshots pixel-tight.

---

## 9. Negative margin does not shrink box height

It only shifts siblings. Don't use negative margin as height compensation.

---

## 10. Elementor document cache

After programmatic edits:

```
has_element_cache: true  → frontend may be STALE
```

Always:

```json
{ "ability_name": "novamira/elementor-clear-document-cache", "parameters": { "post_ids": [POST_ID] } }  // canonical payload; singular post_id is legacy/inconsistent
```

Plus `clean_post_cache` / files_manager clear when injecting via PHP.

---

## 11. MCP payload size

`elementor-set-content` with huge trees fails or truncates.

**Path:** upload JSON to sandbox → PHP decode → document save.

---

## 12. PHP execute-php escaping

Use `\Elementor\Plugin` in the PHP source, not double-escaped `\\Elementor` that becomes invalid.

---

## 13. WPCode schema

Omit fields that fail ability validation (some `priority` shapes). Use `update-wpcode-snippet` for iterations; `active: true` after save.

---

## 14. Canvas template

Framer full-bleed pages: use `elementor_canvas` and hide theme header via page-scoped CSS if theme chrome still appears.

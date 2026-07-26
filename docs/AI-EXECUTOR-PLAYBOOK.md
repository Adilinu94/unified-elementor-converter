# AI Executor Playbook — unified-elementor-converter

**Audience:** Weaker/cheaper models implementing a Bauplan phase or running a live rebuild.
**Rule:** Prefer this file + the target-specific package docs over inventing new approaches.
**No project-specific brand names.** Every step must work for any source URL/export → WordPress/Elementor V3 **or** V4.

---

## 1. Mission

Clone a live page (or Framer export) into **editable Elementor** — V3 containers/widgets or V4 Atomic (`$$type`, e-flexbox, Global Classes), depending on target.
Motion/polish via **WPCode** (CSS/JS/GSAP) on both targets.
**Done** ≠ JSON written. Done = live frontend matches reference + QA gates green.

---

## 2. Hard rules (never violate)

1. **V3/V4 isolation.** V3 code never imports from V4 code, and vice versa. The test: *does this file know what a V3 or V4 element is?* Yes → stays strictly in `target-v3/` or `target-v4/`. No (pure mechanism — WPCode push, preflight, diffing) → may live in `core/`, `mcp/`, `qa/`, `extractors/`.
2. **Confirm target before building.** Never assume V3 when V4 was requested or vice versa — check `--target` explicitly.
3. **Widget-first (V3):** structure = containers · content = native widgets · motion = CSS class + WPCode. `html` widget only for tiny SVG marks / third-party embeds (budget ≤ 15%).
4. **Atomic-correct (V4):** every element has a valid `$$type`; class names never contain hyphens in the atomic class registry; DOM depth stays within the guard limit; no empty classes. See `target-v4/src/guards.ts`.
5. **Photos = `image` widgets / atomic image elements**, never `<img>` inside HTML blobs.
6. Nested containers (V3): `isInner: true`. Flex-row children need real width (`content_width: full` + `width` slider), not unconstrained 100% stacks.
7. A successful MCP write **≠** visible result → clear Elementor element cache + hard reload.
8. **WPCode dual write:** update snippet `post_content` **and** option `wpcode_snippets` (location keys `site_wide_header` / `site_wide_footer`). One without the other leaves the live site on old CSS/JS.
9. **V3 deploy of nested trees: always `elementor-inject-calibrated-page` with the full `_elementor_data` array, never `batch-build-page`.** `batch-build-page` silently ignores nested elements and only saves top-level sections — a real, previously-hit failure mode. `batch-build-page` is for V4 only.
10. No secrets in git. No PAT in remote URLs in commits.
11. Prefer surgical CSS/edit over full tree redeploy when only polish is wrong.

---

## 3. Standard rebuild pipeline (any source)

```
1. Scope          homepage only? new post vs overwrite? target (V3/V4) confirmed?
2. Extract        screenshots + FramerExport/Unframer (if Framer source) + design tokens
3. Plan sheet     per section: layout / text / image / cta / motion / HTML exceptions
4. Build tree     offline JSON if large; emit native widgets (V3) or atomic elements (V4)
5. Guards         V3: html budget, nested isInner, flex widths, empty html
                  V4: $$type correctness, guard suite (target-v4/src/guards.ts), cross-validate
6. Deploy         V3 small: set-content · V3 large: inject-calibrated-page (never batch-build-page)
                  V4: batch-build-page
7. WPCode         fonts+CSS header · GSAP footer · page-scoped · dual write
8. Verify         frontend HTML + hard reload
9. Visual QA      visual-diff / geometry probes
10. Fix loop      top issues → allowlisted patch only → re-verify (max 2–3 rounds)
                  Stop on plateau / regression; escalate with best state.
11. Report        what matched, intentional deltas, remaining risks + scorecard floors
```

---

## 4. Section → element mapping

### V3

| Visual need | Elementor V3 |
|---|---|
| Section shell | root `container` full width, `css_classes: *-section` |
| Row / column layout | nested `container` flex + gap + **width constraints** |
| Title | `heading` |
| Body / multi-line | `text-editor` |
| Photo | `image` |
| CTA | `button` |
| Icon + title + blurb | `icon-box` or icon + heading + text |
| FAQ | `accordion` / `toggle` |
| True one-off SVG / iframe | `html` (document reason) |

### V4 Atomic

| Visual need | Elementor V4 |
|---|---|
| Section shell | `e-flexbox`, Global Class for repeated backgrounds |
| Row / column layout | nested `e-flexbox`, `$$type` correct on every node |
| Title | atomic heading element |
| Photo | atomic image element with media ID (never raw URL) |
| Repeated visual signature (≥2 elements) | promote to Global Class, not inline style |
| Responsive scaling | via `target-v4/src/postprocess/` auto-scale, not manual breakpoints |

---

## 5. Gotchas (silent failures)

### V3

| Symptom | Cause | Fix |
|---|---|---|
| Row stacks vertically | Child `content_width: full` → 100% width | Set child `width` when `content_width: full`; `isInner: true` |
| Button huge / full bleed | Elementor default stretch | CSS: `width: auto; max-width: max-content` |
| Header solid brand bar | Background on full-width shell | Shell always transparent; only pills get fill |
| CSS change not live | Only `post_content` updated | Sync `wpcode_snippets` option |
| Old layout after inject | `_elementor_element_cache` | delete meta + clear cache |
| **Nested elements silently missing after deploy** | **Used `batch-build-page` for a V3 tree** | Always `inject-calibrated-page` for V3 (rule #9) |

### V4

| Symptom | Cause | Fix |
|---|---|---|
| Guard fails on valid-looking tree | Hyphen in atomic class name | Class names must not contain hyphens in the atomic registry |
| Media broken after deploy | Element references raw URL instead of WP media ID | Run `patch-v4-tree-media-ids` post-processing before deploy |
| Visual drift between Framer source and CSS | Framer and CSS disagree on a value | `cross-validate.ts` — check for `GV_ID_DRIFT` |
| Score stuck below threshold | Missing/incorrect `$$type` on a nested node | Re-run `validate-v4-tree` guard, fix flagged nodes only |

---

## 6. Deploy recipes

**Small tree:** `elementor-set-content` with content array → clear document cache.

**Large tree (payload limits):**
1. `create-upload-link` → PUT JSON to sandbox path
2. `execute-php`: decode → update `_elementor_data` → save → clear caches (V3: via `inject-calibrated-page`, never `batch-build-page`)
3. Verify `get_permalink` + frontend fetch

Never trust save without opening the public URL.

---

## 7. WPCode dual-write (copy-paste pattern)

```php
wp_update_post(['ID' => $id, 'post_content' => $code]);
$opt = get_option('wpcode_snippets');
foreach ($opt[$loc] as $i => $snip) {
  if ((int)$snip['id'] === (int)$id) {
    $opt[$loc][$i]['code'] = $code;
    $opt[$loc][$i]['compiled_code'] = '';
  }
}
update_option('wpcode_snippets', $opt, false);
```

Locations: `site_wide_header` (fonts+CSS), `site_wide_footer` (GSAP). Always page-guard JS.

Ability names on the WordPress side (via `novamira-adrianv2`): `wpcode-{list,get,create,update,set-status,duplicate,delete,check-setup}`.

---

## 8. QA gates before "done"

- **V3 widget budget:** `htmlWidgets / totalWidgets ≤ 0.15`; zero `<img>` inside html widgets
- **V4 guard suite:** all registered guards pass, cross-validate score ≥ 85
- **Visual:** `visual-diff` pass ≥ 85%, viewports desktop + mobile
- **Geometry (Playwright):** header shell background alpha ≈ 0, primary media side matches reference, CTA button height sane

---

## 9. Fix loop protocol

1. Name section + expected vs actual (one line).
2. Prefer CSS / single-element edit.
3. Width/stack bugs (V3) → fix widths first, never dump section to HTML.
4. Re-clear caches.
5. Re-run visual/geometry.
6. Stop after 2–3 rounds; report remaining as intentional or blocked.

---

## 10. Anti-patterns (instant fail review)

- Whole section as one HTML widget with images + copy (V3)
- `batch-build-page` on a nested V3 tree
- Importing `target-v3` from `target-v4` or vice versa, for any reason
- Declaring done on MCP success only, without frontend verification
- Site-wide GSAP without page guard
- Hardcoding one client's class names as the only supported pattern

---

## 11. When stuck

1. Read frontend HTML + computed CSS for **one** broken section.
2. Compare reference screenshot for that section only.
3. Check WPCode option sync and element cache (V3) or guard/cross-validate output (V4).
4. Escalate with: section name, expected, actual, selector, last fix tried.

---

## Related

- `docs/BAUPLAN-v1.0.md` — phases 0–50
- `docs/BAUPLAN-v2.0-VOLLSTAENDIGE-INTEGRATION-2026-07.md` — full audit + phases 51–58
- `docs/CRITICAL-FAILURE-POINTS.md` — regressions that have actually happened
- `docs/ARCHITECTURE.md`, `docs/API.md`

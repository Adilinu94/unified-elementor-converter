# Visual QA Improvements

**Scope:** Any Framer / marketing URL → Elementor V3 live page.  
**No client-specific brand assumptions.**

**Existing tooling:**

```bash
node scripts/visual-diff.mjs \
  --v3-url "https://SOURCE.example/" \
  --v4-url "https://LIVE-WORDPRESS.example/page/" \
  --viewports desktop,mobile \
  --mode fold \
  --section hero \
  --output diff-output/run-label \
  --pass-pct 85 \
  --threshold 0.1
```

CLI flags currently say `--v3-url` / `--v4-url` (source vs target). Add aliases `--ref-url` / `--live-url` (see P3 / Phase F).

---

## 1. Mandatory verification workflow

After every deploy / polish pass, **do not** ship on MCP `success: true` alone.

| Layer | Tool | Catches |
|---|---|---|
| A. Pixel / fold | `scripts/visual-diff.mjs` or Playwright capture | Missing sections, wrong crop, color/layout shifts |
| B. Geometry | Playwright `getBoundingClientRect` + `getComputedStyle` | Full-width header bar, media on wrong side, stats not centered, button full-bleed |
| C. Heuristics | DOM checks on live HTML | Header shell opaque, html budget, zero image widgets, missing fonts |
| D. Design Critic | rules / vision (when implemented) | Spacing, type scale, component polish |
| E. Human gate | report.html + skill QA checklist | Motion, copy tone, micro polish |

**Section done:** geometry green **and** pixel match ≥ pass threshold (default 85%) **or** documented intentional Hybrid delta.

---

## 2. Product backlog (maps to P3, P6, P9)

### 2.1 Capture reliability

| Gap | Improvement |
|---|---|
| Live `hasContent=false` retries | Wait Elementor body, fonts, network idle, lazyload |
| Lazy images blank | Scroll + `img.complete` before shot |
| WPCode CSS stale | Preflight: `post_content` vs `wpcode_snippets` option |

### 2.2 Structural probes (P3)

Emit `issues.json` with probe IDs (generic selectors via config / section classes):

| Probe ID | Intent |
|---|---|
| `header-shell-transparent` | Fixed/overlay header shell background alpha ≈ 0 |
| `header-visible` | Header cluster not `display:none` |
| `hero-media-side` | Primary media box left/right matches reference |
| `stats-centered` | Metrics row justify/mid aligns with design |
| `button-not-full-width` | Primary CTAs not stretched to section width |
| `html-budget` | htmlWidgets / total ≤ 0.15 |
| `image-widgets-present` | Source has photos ⇒ live has `image` widgets |

### 2.3 Section auto-map (P6)

Crop by stable CSS classes (`hero-section`, `stats-section`, …) or config map — not only fixed pixel bands.

### 2.4 Multi-viewport (P9)

Desktop + mobile (e.g. 1440 and 390): overflow-x, tap targets, stack order.

### 2.5 CLI / DX

| Current | Target |
|---|---|
| `--v3-url` / `--v4-url` | Aliases `--ref-url` / `--live-url` |
| Limited `--section` | header, hero, stats, cards, team, faq, class-based |
| stdout JSON | + `issues.json` + `summary.md` |

### 2.6 Product CLI

```bash
npx clone-v3 qa-gate \
  --url <live> \
  --ref-url <source> \
  --checklist fixtures/qa/checklist-default.json \
  --section all \
  --out ./research/<host>/qa/
```

---

## 3. Fix loop

```
capture ref + live
  → pixelmatch + structural probes
  → issues[] (severity, selector, expected, actual)
  → agent patch (CSS / tree / WPCode dual-write)
  → re-diff until critical clear or max rounds
```

---

## 4. Report layout (local, gitignored)

```
diff-output/<run>/
  report.html
  desktop-v3.png / desktop-v4.png / desktop-diff.png
  summary.json
  issues.json    # to implement
```

---

## Related

- Backlog P1–P10: `UMBAUPLAN-FRAMER-V3-COMPLETENESS-2026-07.md`  
- Design Critic: `DESIGN-CRITIC-ARCHITECTURE-2026-07.md`  
- Executor: `AI-EXECUTOR-PLAYBOOK.md`  
- Script: `scripts/visual-diff.mjs`


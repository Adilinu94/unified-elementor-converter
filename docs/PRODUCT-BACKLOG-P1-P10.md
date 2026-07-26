# Product backlog P1–P10 (generic, any Framer → V3 site)

**Status:** planning backlog for implementers.  
**Rule:** No client- or page-specific names. All items must work for arbitrary source URLs.

**Ship definition:** multi-metric scorecard (V/E/T/R/M) with hard floors on **E** and **M** — see [`SCORECARD-V1-FROM-STRONGER-AI.md`](./SCORECARD-V1-FROM-STRONGER-AI.md).  
Pixel-diff alone is never enough to call a clone shippable.

Implement in order unless a phase dependency blocks (see mapping).

---

## P1 — Design Critic S1 (rules engine + CLI)

**What:** `npx clone-v3 design-critic --url <live> --layers rules`  
Playwright samples computed styles; flags button size, fonts, overflow, contrast, section padding.

**Why:** Catches “looks broken” without a reference URL.  

**Docs:** `DESIGN-CRITIC-ARCHITECTURE-2026-07.md`  
**Phase:** F / new module under `src/qa/design-critic/` · Sprints S1  

**DoD:**

```
[ ] CLI exits 0/1 by severity gate
[ ] report.json + report.md
[ ] unit tests with mocked page metrics
[ ] documented in AI-EXECUTOR-PLAYBOOK
```

---

## P2 — WPCode dual-write helper

**What:** Single function/ability path that always updates:

1. Snippet post `post_content`  
2. Option `wpcode_snippets` entry for that snippet id + location  

**Why:** Live site often keeps serving **stale** CSS/JS if only the post is updated.

**Phase:** K (WPCode) + deploy helpers  

**DoD:**

```
[ ] src/wpcode/sync-snippet.ts (or equivalent) + tests
[ ] Playbook + skill mention dual-write as mandatory
[ ] execute-php examples use helper pattern
```

---

## P3 — Structural probes in visual-diff / qa-gate

**What:** Besides pixel %, emit `issues.json` with probe results (header shell, media side, stats center, button width, html budget).

**Why:** Weaker models act better on named issues than on red pixel maps alone.

**Phase:** F  
**Docs:** `VISUAL-QA-IMPROVEMENTS-2026-07.md`  

**DoD:**

```
[ ] probes configurable via checklist JSON
[ ] issues.json written next to report.html
[ ] unit tests with fixture HTML/geometry
```

---

## P4 — Widget-first guards in builder / pre-push

**What:** Guards before deploy:

- `htmlWidgetCount / totalWidgets ≤ 0.15` (configurable)  
- Fail if `html` settings contain `<img`  
- Fail/warn if source inventory has images but tree has zero `image` widgets  
- Warn long marketing copy inside `html`  

**Why:** Prevents regression to “everything is HTML”.

**Phase:** B (guards) + E (patterns)  
**Skill:** widget-first.md  

**DoD:**

```
[ ] Guard codes documented (e.g. G_HTML_BUDGET, G_HTML_HAS_IMG)
[ ] unit tests on trees
[ ] push path runs guards by default
[ ] report includes editabilityScore E (0–100); hard fail if E < 70 or html budget exceeded
[ ] E formula aligns with SCORECARD-V1 (native ratio, html budget, structure, no img-in-html)
```

---

## P5 — Widget-first pattern library generators

**What:** Generators for common marketing clusters using **native widgets**:

- sticky glass header (containers + buttons)  
- stats/metrics row (heading + text + widths)  
- orbit / radial media (image widgets + center heading)  
- marquee / logo strip (card containers + track CSS)  
- service/feature cards (image + heading + button | icon-box)  

Motion CSS in WPCode, not HTML structure.

**Phase:** E  
**Forbidden default:** single HTML blob per pattern  

**DoD:**

```
[ ] generators + snapshot tests
[ ] fixtures assert no content <img> in html widgets
[ ] skill patterns.md stays widget-first
```

---

## P6 — Section auto-map for QA crops

**What:** Discover sections by stable `css_classes` (and optional config map), crop ref + live per section for diff/critic.

**Why:** Fixed pixel bands break on different page lengths.

**Phase:** F / L  

**DoD:**

```
[ ] section map from live DOM + optional clone.config
[ ] qa-gate --section all iterates map
[ ] docs list recommended class naming convention
```

---

## P7 — Design profile in `clone.config`

**What:** YAML/JSON profile:

```yaml
designProfile:
  fonts: { display: "…", body: "…" }
  colors: { text: "#…", muted: "#…", surface: "#…" }
  button: { heightPx: [40, 48], radius: "pill" }
  sectionClassPrefix: ""   # optional
  htmlWidgetBudget: 0.15
```

Rules engine + Hybrid tokens read this — **no hard-coded client brands in core**.

**Phase:** M  

**DoD:**

```
[ ] schema + loader + defaults
[ ] design-critic and guards consume profile
[ ] example clone.config in fixtures/
```

---

## P8 — Healing loop ↔ Design Critic / QA issues

**What:** Feed critical findings into existing healing / auto-fix path (allowlisted CSS or element edits), then re-run critic/diff (max N rounds).

**Architecture (binding):** [`REPAIR-LOOP-V1-FROM-STRONGER-AI.md`](./REPAIR-LOOP-V1-FROM-STRONGER-AI.md)  
— normalized issues, mutation allowlist, regression guard, PASS/PLATEAU/MAX/ESCALATE; never `html` as layout fix; **E floor cannot regress**.

**Phase:** J  

**DoD:**

```
[ ] issue → fixer registry for top probe/rule IDs
[ ] maxRounds config (default ≤ 5) + plateau + regression rollback
[ ] tests with mock fixer
[ ] never-list enforced (no html_widget layout fix, no absolute positioning as repair)
[ ] ESCALATE payload: best_state + reason + open issues
[ ] prefer IR locations when IR exists (see IR-V1-FROM-STRONGER-AI.md)
```

---

## P9 — Multi-viewport design + visual QA

**What:** Desktop + mobile (e.g. 1440 / 390) in visual-diff and design-critic.

**Checks:** overflow-x, tap target ≥ 44px, stack order, nav collapse behavior.

**Phase:** L  

**DoD:**

```
[ ] both viewports in default qa-gate
[ ] mobile-specific probes
[ ] report shows per-viewport pass
```

---

## P10 — Offline E2E golden path (CI)

**What:** Deterministic fixture (HTML or stored tree + mock MCP):

1. Build / normalize tree  
2. Run guards (P4)  
3. Optional pixel compare against baseline screenshots  
4. Fail CI if score &lt; threshold or critical probes fail  

**Why:** Stops regressions without a live Framer site.

**Phase:** N  

**DoD:**

```
[ ] fixtures under tests/e2e or fixtures/golden/
[ ] npm script in CI
[ ] no network required for default job
[ ] CI asserts scorecard hard floors (E ≥ 70, M ≥ 60 when measurable, critical probes) — not pixel % alone
```

---

## Dependency sketch

```
P4 (guards) ──► P5 (patterns)
P2 (wpcode) ──► P8 (healing CSS)
P3 + P6 ──► P1 L2 / P9
P7 ──► P1 rules thresholds
P1 + P3 + P9 ──► P8 + P10
```

Suggested implement order: **P2 → P4 → P3 → P1 → P5 → P6 → P7 → P9 → P8 → P10**.

---

## Related

- `SCORECARD-V1-FROM-STRONGER-AI.md` — shippable definition (V/E/T/R/M)  
- `IR-V1-FROM-STRONGER-AI.md` — semantic IR between source and Elementor emit  
- `REPAIR-LOOP-V1-FROM-STRONGER-AI.md` — closed-loop repair for P8  
- `AI-EXECUTOR-PLAYBOOK.md` — how weaker models should execute  
- `UMBAUPLAN-FRAMER-V3-COMPLETENESS-2026-07.md` — phase mapping  
- Progress tracker rows for P1–P10 / phases


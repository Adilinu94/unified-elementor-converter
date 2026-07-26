# Design Critic — post-build designer QA (any site)

**Status:** Architecture / specification  
**Goal:** After a page is built, audit it **like a web designer** (spacing, type, buttons, hierarchy) — for **any** source URL → Elementor V3.  
**Related:** `VISUAL-QA-IMPROVEMENTS-2026-07.md`, Phase F / J / P1, `AI-EXECUTOR-PLAYBOOK.md`.

---

## 1. Problem

Pixel-diff says something differs.  
A designer asks: wrong rhythm? type scale? buttons oversized? hierarchy weak?

**Answer:** three-layer **Design Critic** after deploy → structured findings + fix hints.

---

## 2. Designer checklist (generic)

### Layout & spacing

- Section vertical rhythm relatively even or matches source  
- Section padding adequate (marketing often ≥ 48px desktop)  
- Flex/grid gaps consistent inside a section  
- Alignment / no 1–3px drift  
- No horizontal page scroll  
- Sticky header: transparent shell; no full-width solid brand bar  

### Typography

- Expected display/body fonts actually loaded  
- Hierarchy H1 ≫ H2 ≫ body  
- Body ≥ 16px desktop default floor  
- Line-height body ~1.45–1.7; heads tighter  
- Text color readable on background  

### Color

- WCAG AA contrast (text 4.5:1, large 3:1)  
- Brand tokens from project profile, not random theme defaults  
- Text on photo heroes remains legible  

### Components

- Button height ~40–56px desktop; touch ≥ 44px mobile  
- Buttons not full-bleed unless design requires  
- Radius consistent within the page  
- Images constrained; `object-fit` where cards  
- Cards in a row share padding/radius  

### Hierarchy & responsive

- One primary CTA per hero cluster  
- Mobile stack order sensible; no overflow  

---

## 3. Three layers

| Layer | Method | Needs source? |
|---|---|---|
| **L1 Rules** | Playwright computed styles + boxes | No |
| **L2 Diff** | visual-diff + paired geometry vs reference | Yes |
| **L3 Vision** | LLM “senior web designer” on screenshots | Yes (recommended) |

```
deploy → Design Critic orchestrator
           ├─ L1 rules
           ├─ L2 source diff
           └─ L3 vision (optional)
                → DesignCritiqueReport
                → optional auto-fix rounds
```

---

## 4. Product shape

```bash
npx clone-v3 design-critic \
  --url <live> \
  [--ref-url <source>] \
  --viewports desktop,mobile \
  --layers rules,diff,vision \
  --out ./research/<host>/design-critic/
```

Default layers: `rules,diff`. Vision optional (API cost).

### Finding schema

```json
{
  "id": "primary-cta-oversized",
  "layer": "rules",
  "severity": "high",
  "principle": "components",
  "section": "hero",
  "selector": ".hero-cta .elementor-button",
  "expected": "height 40–56px, width auto",
  "actual": "height 72px, width 100%",
  "fixHint": "CSS width:auto; padding; Elementor size sm"
}
```

### Agent flow

1. Deploy + cache clear  
2. design-critic  
3. Fix critical/high  
4. Re-run (max 2–3 rounds)  
5. Only then mark design OK  

---

## 5. Map to existing code

| Piece | Role |
|---|---|
| `scripts/visual-diff.mjs` | L2 pixel |
| `src/qa/vision-qa.ts` | L3 base — extend designer persona |
| `src/qa/phase8-issue-types.ts` | padding/margin/font mismatch types |
| `src/qa/healing-loop.ts` | fix rounds (P8) |
| **New** `src/qa/design-critic/*` | orchestrator + rules |

```
src/qa/design-critic/
  types.ts
  orchestrator.ts
  rules/{spacing,typography,contrast,components,overflow}.ts
  collect-computed.ts
  pair-with-source.ts
  report.ts
  prompts/designer-vision.md
```

---

## 6. Default rule thresholds (overridable via design profile)

```ts
{
  bodyMinFontPx: 16,
  h1MinFontPx: 32,
  h1MaxFontPx: 72,
  buttonMinHeightPx: 40,
  buttonMaxHeightPx: 56,
  buttonMaxWidthRatio: 0.5,
  touchTargetMinPx: 44,
  sectionMinPaddingY: 40,
  contrastAA: 4.5,
  contrastLarge: 3,
  centerTolerancePx: 24
}
```

Project profile (`clone.config` / Phase M) supplies fonts, colors, button radius — **not** hard-coded client brands in core.

---

## 7. Sprints

| Sprint | Deliverable |
|---|---|
| S1 | L1 rules + CLI `--layers rules` |
| S2 | Wire visual-diff + structural probes |
| S3 | Designer vision prompt + issue types |
| S4 | Healing top-N auto suggestions |
| S5 | Skill + Phase F/J wiring |

**Start with S1** — highest value, no vision cost.

---

## 8. Success

- [ ] One command after deploy, desktop &lt; 2 min  
- [ ] Findings include selector + fixHint  
- [ ] Score ≥ 85 and 0 critical ⇒ skill may say design OK  
- [ ] Works on arbitrary marketing URLs with only config/token changes  

---

## Related

- P1 in umbauplan backlog  
- `AI-EXECUTOR-PLAYBOOK.md`  
- `VISUAL-QA-IMPROVEMENTS-2026-07.md`


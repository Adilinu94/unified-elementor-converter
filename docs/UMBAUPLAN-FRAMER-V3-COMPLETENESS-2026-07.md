# Umbauplan — site-clone-to-v3 Completeness (+ Port aus V4-Pipeline)

**Status:** aktive Spezifikation (Phasen A–P).  
**Zielgruppe:** schwächere / billigere KI oder Junior. Jede Phase ist so geschrieben, dass sie **ohne Rückfragen** an die Planungs-KI umsetzbar ist.

**Repo:** `Adilinu94/site-clone-to-v3`  
**Schwester-Repo (nur lesen / portieren, nicht mischen):**  
`Adilinu94/Framer-to-Elementor-V4-Pipeline` (lokal z. B. `…/FramerPipline/Framer-to-Elementor-V4-Pipeline/`)

**Anlass:** Production rebuilds + Vergleich mit der V4-Pipeline.  
Portiert die echten Stärken der V4-Pipeline nach V3 (Preflight, Score-Guards, Dual-Source, Large-Tree, …), ohne V4-Atomic-Schema einzuschleppen.  
**Gilt für beliebige Framer-/Marketing-URLs** — keine client-spezifischen Hardcodes im Kern.

**Pflicht-Lektüre für ausführende KIs:**  
[`docs/AI-EXECUTOR-PLAYBOOK.md`](./AI-EXECUTOR-PLAYBOOK.md) ·  
[`docs/PRODUCT-BACKLOG-P1-P10.md`](./PRODUCT-BACKLOG-P1-P10.md)

---

## Scope dieses Plans (Executive Summary)

| Kern (V3-Produkt) | Aus V4-Pipeline portiert |
|---|---|
| Patterns, deploy-tree, screenshot gate, config (Phasen A–E, …) | **Dual-Source** (Unframer + FramerExport/CSS-Fallback + Match-Check) |
| Container-Normalize, flex-width Guards | **Score-Guards ≥85 %** mit benannten Invariants + Report |
| Hybrid tokens / screenshot-truth | **Preflight-Suite** (`doctor` / `preflight`) |
| Widget-first rebuild + Design Critic backlog | **Large-tree deploy**: Upload + PHP inject + split |
| | **Asset-Manifest → Media-IDs** |
| | **Section-compare** Framer-vs-WP |
| | **Session-init + pipeline-state** |
| | **Rollback** vor Deploy |
| | **Post-build auto-fix** (allowlist) |
| Optional V3→V4 gate | erst nach V3-Pixel-Match; Bridge-JSON strenger |

**Hard rule:** **Kein** `e-flexbox` / `e-heading` / `$$type` / Global Classes im V3-Build-Pfad.

---

## 0. Pflichtregeln (BINDEND)

### 0.1 Arbeitsweise

1. **Eine Phase nach der anderen.** DoD grün → erst dann nächste.
2. **Kleine Commits** (1 Phase ≈ 1 Commit, >400 LOC → Sub-Commits pro Sub-Task).
3. **Kein Scope-Creep.** Nur was in der Phase steht.
4. **Tests:** `npm run test:unit` + betroffene Dateien; `npx tsc --noEmit`.
5. **APIs additiv** — keine Breaking Changes ohne Phase „Breaking“.
6. **Konservativ:** Feature-Flags, default OFF, wenn unsicher.
7. **Keine Secrets** committen. Remote-URL **ohne** PAT.
8. **ESM:** `"type": "module"`, Imports mit `.js`-Suffix.
9. **Port-Regel:** Code aus V4 **adaptieren** (V3-Typen, kein Copy-Paste von `$$type`). Dateipfade der V4-Quelle im Commit-Body nennen.

### 0.2 Verboten

- V4 Atomic Widgets im V3-Tree.
- `batch-build-page` für nested V3-Trees (siehe `wp-push.ts`).
- Assertions löschen, um Tests grün zu machen.
- `node_modules` committen.
- Hardcodierte `C:\…` / `solar.local` / produktive Secrets.

### 0.3 Definition „Phase grün“

```
[ ] Dateien aus Phase existieren / geändert
[ ] Alle Acceptance Criteria erfüllt
[ ] npm run test:unit → exit 0
[ ] npx tsc --noEmit → exit 0
[ ] CHANGELOG.md [Unreleased] ergänzt
[ ] docs/UMBAUPLAN-FRAMER-V3-PROGRESS.md Zeile updated
[ ] Commit: feat|fix|docs|test|chore(scope): …
[ ] Keine Secrets
```

### 0.4 Commit-Schema

```
feat(preflight): add doctor command with unframer and tree size checks
feat(deploy): large tree upload and php inject path
docs(umbauplan): mark phase G done
```

### 0.5 Verzeichnis-Konventionen (neu / erweitert)

```
src/patterns/                 # widget-first pattern generators (no HTML default)
src/config/                   # clone.config + designProfile
src/deploy/                   # one-shot + large-tree + rollback
src/preflight/                # doctor / connectivity / project-match
src/sources/                  # dual-source: unframer + css-fallback + export
src/assets/                   # manifest + media-id patch
src/wpcode/                   # dual-write sync (post + wpcode_snippets option)
src/qa/screenshot-gate/       # checklist + structural probes
src/qa/section-compare/       # framer vs wp section screenshots
src/qa/design-critic/         # post-build designer rules (P1)
src/session/                  # session-init + pipeline-state
src/metrics/                  # quality metrics (optional, late)
fixtures/patterns/
fixtures/qa/
fixtures/preflight/
fixtures/golden/              # offline E2E (P10)
skills/framer-to-elementor-v3/
docs/
```

### 0.6 Transfer-Matrix: V4-Feature → V3-Ziel

| # | V4-Quelle (Repo Framer-to-Elementor-V4-Pipeline) | V3-Zielmodul | Phase |
|---|---|---|---|
| T1 | `scripts/preflight/*`, `cmd-doctor` | `src/preflight/*`, `clone-v3 doctor` | **C** |
| T2 | `framer-pre-build-validate` + Score ≥85 | `src/validator/*` expand | **B** |
| T3 | `css-fallback-extractor`, dual-source-workflow | `src/sources/*` | **H** |
| T4 | `check-unframer-connectivity`, `verify-xml-project-match` | `src/preflight/*` | **C, H** |
| T5 | `asset-to-wp-media`, `patch-v4-tree-media-ids` | `src/assets/*` (V3 settings keys!) | **I** |
| T6 | `split-large-tree`, upload+PHP pattern | `src/deploy/large-tree.ts` | **D** |
| T7 | `scripts/lib/rollback.ts` | `src/deploy/rollback.ts` | **D** |
| T8 | `section-compare.ts` | `src/qa/section-compare/*` | **F** |
| T9 | `pipeline-state.ts`, `session-init.ts` | `src/session/*` | **G** |
| T10 | `post-build-auto-fix.ts` Idee | `src/qa/post-build-autofix.ts` | **J** |
| T11 | `visual-qa.ts` + a11y | erweitere existing `src/qa/*` | **F / L** |
| T12 | `inject-animation-code` / animation plan | `src/patterns` + WPCode helpers Phase E/K | **E, K** |
| T13 | `measure-quality-metrics` | `src/metrics/quality.ts` | **N** (nice) |
| T14 | `mcp-bridge` / `mcp-client` Retry | nur falls V3 MCP schwächer — expand `phase10-*` | **D** (nur wenn nötig) |

**Nicht portieren:** `generate-global-classes`, `$$type`-Validatoren, `ensure-elementor-experiments` als Pflicht (V3 braucht das nicht; optional nur Warnung „Site ist V4-only?“).

### 0.7 Phasen-Reihenfolge (BINDEND)

```
A  Prep / Branch / Baseline
B  Guard Score System (expand json-guard)
C  Preflight / Doctor CLI
D  Deploy One-Shot + Large-Tree + Rollback
E  Pattern Library (glass/stats/orbit/marquee)
F  Screenshot Gate + Section-Compare
G  Session-Init + Pipeline-State
H  Dual-Source (Unframer + CSS-Fallback + Match)
I  Asset Manifest + Media-ID Patch
J  Post-Build Auto-Fix (strukturiert)
K  WPCode page-scope + GSAP presets
L  Mobile viewport matrix + Diff HTML report
M  clone.config.yaml Hybrid
N  Quality metrics + Skill sync + E2E fixture
O  Optional V3→V4 bridge gate (nur nach Pixel-Match)
P  Final freeze, version bump, docs
```

**Parallel (nur mit 2 Agents):**  
- E parallel zu C (nach B)

---

## Product backlog P1–P10 (BINDEND priorisiert)

Vollständige AC/DoD: [`PRODUCT-BACKLOG-P1-P10.md`](./PRODUCT-BACKLOG-P1-P10.md).

| ID | Item | Phase |
|---|---|---|
| **P1** | Design Critic S1 — rules engine + CLI | F (+ `src/qa/design-critic`) |
| **P2** | WPCode dual-write helper (`post_content` + `wpcode_snippets`) | K |
| **P3** | Structural probes + `issues.json` in visual-diff / qa-gate | F |
| **P4** | Widget-first guards (html budget, no img-in-html, image presence) | B |
| **P5** | Widget-first pattern generators (header/stats/orbit/marquee/cards) | E |
| **P6** | Section auto-map by CSS classes for QA crops | F / L |
| **P7** | `designProfile` in `clone.config` | M |
| **P8** | Healing loop ↔ critic / QA issues | J |
| **P9** | Multi-viewport (desktop + mobile) critic + visual QA | L |
| **P10** | Offline E2E golden path in CI | N |

**Empfohlene Code-Reihenfolge:** P2 → P4 → P3 → P1 → P5 → P6 → P7 → P9 → P8 → P10.

**Executor-Wissen** (Novamira, Widths, Caches): [`AI-EXECUTOR-PLAYBOOK.md`](./AI-EXECUTOR-PLAYBOOK.md).  
- K parallel zu I (nach D+E)  
- L parallel zu J  

**Strikt sequentiell:** A → B → C → D → F → G → H → I → … → P  

**Geschätzter Aufwand gesamt:** 45–60 h (schwächere KI: eher 60–80 h).

### 0.8 Progress-Datei

Nach **jeder** Phase updaten:  
`docs/UMBAUPLAN-FRAMER-V3-PROGRESS.md`  
(Vorlage am Ende dieses Dokuments / bereits vorhanden — Spalten auf A–P umstellen.)

---

# Phase A — Prep, Baseline, Tracking

## Ziel

Sauberer Branch, grüne Baseline, Progress-Tracking auf V2.

## Schritte

### A.1 Git

```bash
cd site-clone-to-v3
git checkout main
git pull origin main
git checkout -b feat/framer-v3-completeness-v2
npm ci
npm run test:unit
npx tsc --noEmit
```

Bei Failures: `docs/BASELINE-TEST-STATUS.md` mit Output anlegen, dann fortfahren (nur mit dokumentierter Baseline).

### A.2 Progress-Datei

`docs/UMBAUPLAN-FRAMER-V3-PROGRESS.md` auf Phasen **A–P** umstellen (Status `pending` außer A).

### A.3 CHANGELOG

Unter `## [Unreleased]` Abschnitte Added/Changed/Fixed vorbereiten.

### A.4 Sibling-Path (nur Docs, kein Hardcode im Code)

In Progress-Datei notieren:

```
V4_SIBLING=../Framer-to-Elementor-V4-Pipeline
```

Zum Portieren Dateien dort **lesen**, nicht als Runtime-Dependency linken.

## DoD A

```
[ ] Branch feat/framer-v3-completeness-v2
[ ] Tests baseline dokumentiert
[ ] Progress A–P Tabelle
[ ] Commit: chore(docs): start v2 completeness umbauplan tracking
```

---

# Phase B — Guard Score System (≥ 85 %)

## Ziel

Wie V4: **benannte Checks**, prozentualer Score, blockiert Deploy bei `< 85` (außer `--force`).

## Warum (V4-Transfer T2)

V4 `framer-pre-build-validate` + `validate-v4-tree` verhindern stille Müll-Deploys.  
V3 hat nur G6c/G7c — zu dünn für Production-Fehlerklassen.

## Neue / geänderte Dateien

```
src/validator/types.ts              # NEU oder expand
src/validator/json-guard.ts         # EXPAND
src/validator/format-guard-report.ts # NEU
src/validator/invariants.ts         # NEU — pure check functions
tests/unit/validator/guards-v2.test.ts
```

## B.1 API (exakt)

```typescript
export type GuardSeverity = 'error' | 'warning' | 'info';

export interface GuardFinding {
  code: string;           // e.g. 'G6c', 'G_HTML_ESCAPE', 'G_TREE_SIZE'
  severity: GuardSeverity;
  message: string;
  path?: string;          // JSON path like elements[0].elements[2]
}

export interface GuardReport {
  score: number;          // 0–100
  findings: GuardFinding[];
  passed: boolean;        // score >= threshold && no blocking errors if configured
  threshold: number;      // default 85
}

export function runV3Guards(
  tree: unknown,
  options?: { threshold?: number; treatWarningsAsErrors?: boolean },
): GuardReport;

export function formatGuardReport(report: GuardReport): string;
```

## B.2 Pflicht-Checks (V3-adapted)

Jeder Check trägt **gleich viel** zum Score bei (oder dokumentiere Gewichtung in Code-Kommentar).  
Mindestens diese Codes:

| Code | Error wenn | Motivation |
|---|---|---|
| `G6c` | nested container ohne `isInner: true` wo nötig | bereits vorhanden — behalten |
| `G7c` | flex-row child width 100 % Full-Stack-Falle | bereits vorhanden — behalten |
| `G_ELTYPE` | unbekannte `elType` / `widgetType` | Schema-Schutz |
| `G_HTML_EMPTY` | `html` widget mit leerem/whitespace html | stille leere Sektionen |
| `G_TREE_SIZE` | JSON string length > 900_000 (warning), > 1_500_000 (error) | MCP set-content Limit |
| `G_NO_V4` | tree enthält `e-flexbox`/`e-heading`/`$$type` | Cross-contamination |
| `G_SETTINGS_OBJECT` | settings nicht object | silent write fail |
| `G_ID_PRESENT` | fehlende `id` auf Elementen | Diff/Patch |
| `G_HEADER_CTA_OUTLINE` | (heuristic warning) button widget „Book“ mit outline settings außerhalb HTML-Pattern | production |
| `G_STATS_NESTED` | (warning) section class `*stats*` mit >1 nested container columns | production |

**Score-Formel (verbindlich):**

```
totalChecks = number of checks that ran
failedWeight = sum(weight) for findings with severity === 'error'
score = max(0, round(100 * (1 - failedWeight / totalWeight)))
passed = score >= threshold && !findings.some(f => f.severity === 'error' && f.code !== optional)
```

Einfache Variante (erlaubt): jeder Check 1 Gewicht; Error = Check failed komplett.

## B.3 `formatGuardReport`

Menschlich lesbar:

```
V3 Guard Report  score=72/100  threshold=85  PASSED=no
  ERROR G_TREE_SIZE  ...
  WARN  G_STATS_NESTED ...
```

## B.4 Tests

- Tree mit `e-flexbox` → `G_NO_V4` error, score < 85  
- Nested container ohne isInner → G6c  
- Leerer HTML widget → G_HTML_EMPTY  
- Kleiner valider Tree → score ≥ 85, passed true  
- formatGuardReport enthält score und codes  

## DoD B

```
[ ] runV3Guards + formatGuardReport exportiert
[ ] Tests grün
[ ] CHANGELOG
[ ] Commit: feat(validator): score-based v3 guards with anti-v4 and size checks
```

---

# Phase C — Preflight / Doctor CLI

## Ziel

Vor jedem Build: **Hard-Fails früh**, nicht nach 20 Minuten Build.

## V4-Transfer T1/T4

Portiere **Ideen** aus:

- `scripts/preflight/check-unframer-connectivity.ts`
- `scripts/preflight/verify-xml-project-match.ts`
- `src/cli/cmd-doctor.ts` / `cmd-preflight.ts`

**Nicht** portieren: `ensure-elementor-experiments` als Hard-Fail (nur Info: „V4 experiments active — you may be on V4 site“).

## Neue Dateien

```
src/preflight/types.ts
src/preflight/check-mcp.ts
src/preflight/check-unframer.ts
src/preflight/check-tree-file.ts
src/preflight/check-project-match.ts
src/preflight/run-preflight.ts
src/cli/doctor.ts          # or wire into clone-v3.ts
tests/unit/preflight/*.test.ts
```

## C.1 Checks

| ID | Was | Fail/Warn |
|---|---|---|
| `mcp_reachable` | `novamira/greet` oder leichtes Ability | **fail** |
| `mcp_elementor` | Ability list enthält set-content o. Ä. | **fail** |
| `unframer_reachable` | optional wenn `--unframer-url` | **fail** nur wenn Flag gesetzt |
| `tree_parse` | wenn `--tree` gegeben: JSON parse + `runV3Guards` | **fail** bei score < 85 |
| `tree_size` | Größe warnen | warn/fail wie Guard |
| `project_match` | hostname in state/config vs source URL | **fail** bei mismatch |
| `v4_site_hint` | experiments active? | **warn** only |

## C.2 CLI

```bash
npx clone-v3 doctor \
  [--target <name>] \
  [--mcp-url ...] [--mcp-auth ...] \
  [--tree ./page.json] \
  [--source-url https://….framer.app] \
  [--unframer-url ...] \
  [--json]
```

Exit codes:

- `0` — all required passed  
- `1` — one or more fails  
- `2` — usage error  

## C.3 Tests

Mock MCP success/fail; tree with V4 pollution fails; project_match mismatch fails.

## DoD C

```
[ ] clone-v3 doctor works dry (mocks)
[ ] README short “Doctor” section
[ ] Commit: feat(cli): add doctor preflight suite
```

---

# Phase D — Deploy One-Shot + Large-Tree + Rollback

## Ziel

Ein Befehl: Tree → WP, inkl. **Cache clear**, **Smoke**, **große Payloads**, **Rollback-Plan**.

## V4-Transfer T6/T7

- `scripts/lib/split-large-tree.ts`  
- Upload-then-PHP-inject Pattern (production + V4 asset upload mindset)  
- `scripts/lib/rollback.ts` Idee: vorher `get-content` speichern  

## Neue Dateien

```
src/deploy/deploy-tree.ts
src/deploy/large-tree.ts
src/deploy/rollback.ts
src/deploy/smoke-check.ts
src/cli/deploy-tree.ts   # wiring
tests/unit/deploy/*.test.ts
```

## D.1 CLI

```bash
npx clone-v3 deploy-tree \
  --tree ./elementor-v3-tree.json \
  --post-id <POST_ID> \
  --target <name> | --mcp-url ... --mcp-auth ... \
  [--title "..."] \
  [--template elementor_canvas] \
  [--skip-normalize] \
  [--force] \
  [--dry-run] \
  [--smoke-url https://…] \
  [--smoke-must-contain "ch-header-inner,stats-row"] \
  [--backup-dir ./research/_backups] \
  [--strategy auto|direct|upload-php|split]
```

## D.2 Algorithmus `deploy-tree` (exakt)

```
1. Load tree JSON (array or { content: [] })
2. normalizeV3ContainerTree unless --skip-normalize
3. report = runV3Guards(tree)
   if !report.passed && !--force → exit 1 with formatGuardReport
4. if --dry-run → print report + byte size + strategy decision + exit 0
5. strategy = resolveStrategy(tree, --strategy):
     direct     if bytes < 400_000
     upload-php if bytes < 1_200_000
     split      if bytes >= 1_200_000 OR strategy=split
6. rollback.backup(postId) → write backup-dir/post-{id}-{ts}.json
   (call get elementor content ability if available; else skip with warn)
7. execute strategy:
   A direct:
      pushToWordPress(adapter, tree, opts)
   B upload-php:
      upload JSON as media/file via Novamira upload ability (exact token — no corruption)
      execute PHP snippet that reads file and update_post_meta(_elementor_data)
      DO NOT put full tree in set-content body if over limit
   C split:
      split top-level sections into chunks
      deploy section-by-section OR write multi-step PHP plan
      document chosen approach in code comments
8. clear cache: elementor-clear-document-cache with { post_ids: [postId] }
9. smoke-check if --smoke-url
10. stdout JSON summary
```

## D.3 `large-tree.ts`

```typescript
export function measureTreeBytes(tree: unknown): number;
export function chooseDeployStrategy(bytes: number, forced?: Strategy): Strategy;
export function splitTopLevelSections(tree: V3Element[]): V3Element[][];
```

Split-Regel: nur **Root-Level**-Kinder des Page-Arrays splitten, nie mitten in einem Section-Baum.

## D.4 `rollback.ts`

```typescript
export async function backupPostContent(adapter, postId, dir): Promise<string>; // path
export async function restorePostContent(adapter, backupPath): Promise<void>;
```

## D.5 Tests

- chooseDeployStrategy thresholds  
- deploy dry-run never calls push  
- force allows low score  
- smoke fails on missing token  
- backup called before push (mock order)  

## DoD D

```
[ ] deploy-tree dry-run + unit tests
[ ] README “Deploy an existing tree”
[ ] Commit: feat(deploy): one-shot deploy with large-tree strategies and rollback
```

---

# Phase E — Pattern Library (Core) — **widget-first**

## Ziel

Generatoren für Glass-Header, Stats, Orbit, Marquee, Service-Cards — **native V3 Widgets + Container**.  
HTML nur als dokumentierte Escape-Hatch (≤15% Widgets).  
Skill-Referenz: `skills/framer-to-elementor-v3/references/widget-first.md`.

## Dateien

```
src/patterns/types.ts
src/patterns/sticky-glass-header.ts   # containers + image/heading/button (html nur optional fallback)
src/patterns/stat-row.ts              # containers + heading + text-editor + width constraints
src/patterns/orbit-cluster.ts         # orbit-wrapper + N× (container + image) + heading title
src/patterns/marquee-row.ts           # track container + card containers (image/heading/text)
src/patterns/service-cards.ts         # grid + card (image + heading + button | icon-box)
src/patterns/css/base-patterns.css.ts # motion CSS only (orbit/marquee/glass) — no structure HTML
src/patterns/index.ts
tests/unit/patterns/*.test.ts
fixtures/patterns/*.snapshot.json
```

## Spezifikation (verbindlich — Kurzform)

### sticky-glass-header

- Root `container` + inner row: `logo-pill` + `nav-pill` as **containers**  
- Logo: `image`/`icon` + `heading`; CTA: real `button` (solid white fill)  
- CSS: full bar **transparent**; Scroll-Styles nur auf Pills  
- Optional HTML fallback only if multi-link glass nav cannot match — must log reason  

### stat-row

- Flex-row container, 2–6 `stat-item` children with `_element_width: "initial"`  
- Each item: `heading` (number) + `text-editor` (label)  
- **No** default HTML flex row  

### orbit-cluster

- Center title = **`heading`** with white color + display font (CSS `!important` backup)  
- Each photo = **`image`** widget inside positioned `orbit-item` container  
- Motion = CSS/GSAP on `.orbit-wrapper`  

### marquee-row

- Cards as containers (`image` + `heading` + `text-editor`), **duplicated** for seamless loop  
- Track motion = CSS/GSAP on `.team-track` — not one HTML blob  

### service-cards

- Grid container + card containers: `image` + meta (`heading` / `text-editor` / `button`)  
- Icon features: `icon-box` preferred  

### Guards

- `G_HTML_BUDGET`: warn if `htmlWidgetCount / totalWidgets > 0.15`  
- `G_HTML_HAS_IMG`: fail if html widget contains `<img`  
- `G_HTML_LONG_COPY`: fail if html widget has multi-paragraph marketing copy  

### Public API

```typescript
export function buildPattern(id: PatternId, input: unknown): PatternResult;
```

Export in `src/index.ts`.

## DoD E

```
[ ] patterns emit native widgets (image/heading/button/icon-box), not HTML dumps
[ ] tests assert zero <img> inside html for orbit/cards/marquee fixtures
[ ] Commit: feat(patterns): widget-first glass/stats/orbit/marquee/cards
```

*(Ausführliche Decision-Tree: `skills/framer-to-elementor-v3/references/widget-first.md`.)*

---

# Phase F — Screenshot Gate + Section-Compare

## Ziel

„Done“ = Checkliste + **Pixel-Diff + strukturelle Probes**, nicht nur MCP-OK.

**Ausführliche Backlog-Spezifikation:**  
→ [`docs/VISUAL-QA-IMPROVEMENTS-2026-07.md`](./VISUAL-QA-IMPROVEMENTS-2026-07.md)

## V4-Transfer T8/T11

Portiere Workflow aus V4 `scripts/section-compare.ts` + bestehendes  
`scripts/visual-diff.mjs` (bereits lauffähig: Playwright + pixelmatch).  
Implementiere Probes/CLI-Wrapper in V3-Typen.

## Dateien

```
src/qa/screenshot-gate/types.ts
src/qa/screenshot-gate/checklist.ts
src/qa/screenshot-gate/run-gate.ts
src/qa/screenshot-gate/heuristics.ts      # structural probes
src/qa/section-compare/compare-sections.ts
src/qa/section-compare/capture.ts         # wait fonts/lazyload/Elementor
src/qa/section-compare/probes.ts          # geometry asserts
fixtures/qa/checklist-default.json
tests/unit/screenshot-gate.test.ts
tests/unit/section-compare.test.ts
scripts/visual-diff.mjs                   # EXISTS — wrap, rename flags
```

## F.1 Checklist Schema (+ structural IDs)

```json
{
  "id": "framer-v3-default",
  "items": [
    { "id": "header-transparent-shell", "severity": "critical", "probe": "header-shell-transparent" },
    { "id": "header-visible", "severity": "critical", "probe": "header-visible" },
    { "id": "primary-cta-solid-when-source-solid", "severity": "high", "probe": "cta-fill-matches-source" },
    { "id": "metrics-row-layout", "severity": "high", "probe": "stats-centered-or-matches-source" },
    { "id": "hero-media-side", "severity": "high", "probe": "hero-media-side" },
    { "id": "fonts-loaded", "severity": "medium", "probe": "fonts-link-or-loaded" },
    { "id": "button-not-full-width", "severity": "high", "probe": "button-not-full-width" },
    { "id": "html-budget", "severity": "critical", "probe": "html-budget" },
    { "id": "image-widgets-when-source-has-photos", "severity": "critical", "probe": "image-widgets-present" }
  ]
}
```

## F.2 CLI

```bash
# Existing script (any ref + live pair)
node scripts/visual-diff.mjs \
  --v3-url <source> --v4-url <live> \
  --viewports desktop,mobile --mode fold --section hero \
  --pass-pct 85 --output diff-output/<run>

# Product CLI (implement)
npx clone-v3 qa-gate \
  --url https://example-wp.test/cloned-page/ \
  --checklist fixtures/qa/checklist-default.json \
  [--ref-url https://example.framer.app/] \
  [--section hero|header|stats|all] \
  [--out ./research/qa-report.json]
```

Flag-Rename (aliases): `--ref-url` / `--live-url` zusätzlich zu `--v3-url` / `--v4-url`.

## F.3 Section-compare + probes (MVP → target)

1. Capture viewport screenshots ref + live (Playwright; wait fonts/lazyload)  
2. pixelmatch + threshold → `matchPct`  
3. Structural probes (bounding box / computed style) → `issues[]`  
4. Report: `{ section, mismatchRatio, matchPct, structural[], passed }`  
5. Optional fix-loop: agent patches → re-diff (max N rounds)  
6. Preflight: WPCode `wpcode_snippets` option vs post_content sync  

Bei fehlendem Browser: skip mit warn (nicht crashen in unit tests — mock capture).

## DoD F

```
[ ] qa-gate + section-compare unit tests with mocks
[ ] structural probes: header / hero video side / stats center / button width / html budget
[ ] visual-diff CLI aliases --ref-url --live-url
[ ] issues.json written beside report.html
[ ] Commit: feat(qa): screenshot gate, section-compare, structural probes
```

---

# Phase G — Session-Init + Pipeline-State

## Ziel

Resume-fähige Runs wie V4 `pipeline-state` / `session-init`.

## Dateien

```
src/session/types.ts
src/session/pipeline-state.ts
src/session/session-init.ts
tests/unit/session/*.test.ts
```

## G.1 State Schema

```typescript
export interface PipelineState {
  version: 2;
  sourceUrl: string;
  targetName?: string;
  postId?: number;
  phases: Record<string, 'pending' | 'done' | 'failed' | 'skipped'>;
  lastError?: string;
  updatedAt: string;
  artifacts: Record<string, string>; // logical name → path
}
```

Pfad default: `research/<host>/state.v2.json` (neben bestehendem `state.json` — **nicht** brechen; adapter kann altes lesen).

## G.2 API

```typescript
export function loadState(path: string): PipelineState | null;
export function saveState(path: string, state: PipelineState): void;
export function markPhase(state: PipelineState, id: string, status: ...): PipelineState;
```

## G.3 `session-init`

CLI:

```bash
npx clone-v3 session-init --source-url … --target … [--post-id …]
```

Schreibt State, optional doctor-Lauf (Phase C) und speichert Ergebnis in `artifacts.preflight`.

## DoD G

```
[ ] state load/save/mark tests
[ ] Commit: feat(session): pipeline state v2 and session-init
```

---

# Phase H — Dual-Source (Unframer + CSS-Fallback + Match)

## Ziel

Wie V4 dual-source: Struktur von Unframer **oder** Live-HTML; Styles nie „leer“ ohne Fallback.

## Dateien

```
src/sources/types.ts
src/sources/unframer-client.ts
src/sources/css-fallback.ts
src/sources/project-match.ts
src/sources/merge-sources.ts
tests/unit/sources/*.test.ts
```

## H.1 Verhaltensregeln

1. Wenn Unframer XML/JSON verfügbar → primary structure.  
2. Wenn style map leer → `css-fallback` von `--framer-url` oder lokalem HTML-Export.  
3. `project-match`: XML-Kommentar / project id / hostname muss zu `--source-url` passen — sonst **fail**.  
4. Nie stillschweigend gecachte XML eines **anderen** Projekts verwenden.

## H.2 Port-Hinweis

Lies V4:

- `scripts/css-fallback-extractor.ts`  
- `scripts/preflight/verify-xml-project-match.ts`  
- `novamira-skill/dual-source-workflow.md`  

Adaptiere auf V3: Output ist **kein** V4-Tree, sondern:

```typescript
export interface SourceBundle {
  structure: 'unframer-xml' | 'playwright-dom' | 'html-export';
  xmlPath?: string;
  htmlPath?: string;
  styleHints: Record<string, string>; // css var → value
  warnings: string[];
}
```

## H.3 CLI

```bash
npx clone-v3 enrich-sources \
  --source-url https://….framer.app \
  --out ./research/…/sources/ \
  [--unframer-url …] \
  [--html-export ./FramerExport/index.html]
```

## DoD H

```
[ ] project-match fail on mismatch
[ ] css-fallback fills empty styleHints
[ ] Commit: feat(sources): dual-source unframer and css-fallback with match guard
```

---

# Phase I — Asset Manifest + Media-ID Patch

## Ziel

Bilder nicht als tote Framer-URLs belassen, wenn Upload möglich.

## V4-Transfer T5

Ideen aus `asset-to-wp-media.ts` + `patch-v4-tree-media-ids.ts`, aber **V3 image widget settings**:

- `image.url` / `image.id` / `image.alt` je nach bestehendem Mapper — **erst** bestehenden `widget-mapper` / image settings lesen, dann patchen.

## Dateien

```
src/assets/manifest.ts
src/assets/upload-queue.ts
src/assets/patch-media-ids.ts
tests/unit/assets/*.test.ts
```

## I.1 Manifest

```json
{
  "version": 1,
  "items": [
    { "localPath": "assets/hero.webp", "sourceUrl": "https://framerusercontent.com/…", "wpMediaId": null, "sha256": "…" }
  ]
}
```

## I.2 Patch

```typescript
export function patchTreeMediaIds(tree: V3Element[], idBySourceUrl: Map<string, number>): {
  patched: number;
  tree: V3Element[];
};
```

## I.3 CLI

```bash
npx clone-v3 assets sync --research-dir ./research/… --target … [--execute]
npx clone-v3 assets patch-tree --tree … --manifest … --out …
```

`--execute` führt Uploads aus; default dry-run.

## DoD I

```
[ ] manifest + patch unit tests
[ ] Commit: feat(assets): manifest upload queue and v3 media id patch
```

---

# Phase J — Post-Build Auto-Fix (strukturiert)

## Ziel

Bekannte Issue-Types → **deterministische** Fixes (nicht LLM-raten).

## Dateien

```
src/qa/post-build-autofix.ts
src/qa/fixers/apply-normalize.ts
src/qa/fixers/apply-pattern-hints.ts
tests/unit/qa/post-build-autofix.test.ts
```

## J.1 Erlaubte Auto-Fixes (allowlist)

| Issue type | Fix |
|---|---|
| nested container width | `normalizeV3ContainerTree` |
| missing isInner | normalize |
| stats stacked heuristic | suggest/replace with `buildStatRow` if section annotated |
| tree too large after build fail | re-deploy with upload-php strategy |

**Nicht auto-fix:** Copywriting, Farben raten, Layout neu erfinden.

## J.2 API

```typescript
export function planAutoFixes(issues: Issue[], tree: V3Element[]): AutoFixPlan;
export function applyAutoFixes(tree: V3Element[], plan: AutoFixPlan): V3Element[];
```

Max **4** Fix-Types pro Runde (wie Phase-8 batched-fix im Repo).

## DoD J

```
[ ] plan/apply tests
[ ] Commit: feat(qa): structured post-build autofix allowlist
```

---

# Phase K — WPCode page-scope + GSAP presets

## Ziel

Fonts/CSS/GSAP snippets **seitenbezogen**, wiederverwendbare Presets.

## Dateien

```
src/wpcode/types.ts
src/wpcode/page-scope.ts
src/wpcode/presets/gsap-fade-up.ts
src/wpcode/presets/gsap-header-scroll.ts
src/wpcode/presets/index.ts
tests/unit/wpcode/*.test.ts
```

## K.1 page-scope

Snippet nur auf `post_id` / URL-Pfad laden (PHP condition template):

```php
// generated — do not hand-edit
return is_page(<POST_ID>); // or body.page-id-N
```

## K.2 Presets

Jeder Preset:

```typescript
export interface WpcodePreset {
  id: string;
  title: string;
  codeType: 'css' | 'js';
  body: string; // may contain {{PREFIX}} placeholders
  notes: string[];
}
```

## K.3 CLI

```bash
npx clone-v3 wpcode apply-preset \
  --preset gsap-header-scroll \
  --post-id <POST_ID> \
  --target … \
  [--prefix ch] \
  [--dry-run]
```

## DoD K

```
[ ] presets + page-scope tests
[ ] Commit: feat(wpcode): page-scoped snippets and gsap presets
```

---

# Phase L — Mobile Matrix + Diff HTML Report

## Ziel

Viewports 1440 / 768 / 390; HTML-Report für Menschen.

## Dateien

```
src/qa/viewport-matrix.ts
src/qa/html-report-v2.ts   # or extend html-report.ts
tests/unit/qa/viewport-matrix.test.ts
```

## L.1 Matrix

```typescript
export const DEFAULT_VIEWPORTS = [
  { name: 'desktop', width: 1440, height: 900 },
  { name: 'tablet', width: 768, height: 1024 },
  { name: 'mobile', width: 390, height: 844 },
] as const;
```

## L.2 Report

HTML mit Side-by-side thumbs + mismatch % + checklist results.

## DoD L

```
[ ] matrix + report tests (mock images)
[ ] Commit: feat(qa): viewport matrix and html diff report
```

---

# Phase M — clone.config.yaml Hybrid

## Ziel

Hybrid Framer-Tokens + Blueprint-Layout steuerbar ohne Code-Änderung.

## Dateien

```
src/config/schema.ts
src/config/load-config.ts
fixtures/config/clone.config.example.yaml
tests/unit/config/*.test.ts
```

## M.1 Beispiel

```yaml
version: 1
sourceUrl: https://example.framer.app/
mode: hybrid   # framer-fidelity | hybrid | blueprint
truth: screenshots   # screenshots | blueprint | framer-export
patterns:
  header: sticky-glass-header
  stats: stat-row
  orbit: orbit-cluster
tokens:
  primary: "#09292B"
  fontHeading: "Lora"
deploy:
  strategy: auto
  smokeMustContain: ["ch-header-inner", "stats-row"]
qa:
  checklist: fixtures/qa/checklist-default.json
  viewports: [1440, 768, 390]
```

Loader: fail-fast bei unknown keys (optional warn) + Zod-ähnliche manuelle validation (kein neues heavy dep Pflicht — manuell ok).

## DoD M

```
[ ] load-config tests
[ ] Commit: feat(config): clone.config.yaml hybrid schema
```

---

# Phase N — Metrics + Skill Sync + E2E Fixture

## Ziel

1. Quality metrics (V4 T13 light)  
2. Skill `framer-to-elementor-v3` an V2-Phasen anbinden  
3. Fixture E2E offline: glass + stats  

## N.1 Metrics

```typescript
export function measureTreeQuality(tree: V3Element[]): {
  sectionCount: number;
  htmlWidgetCount: number;
  imageCount: number;
  maxDepth: number;
  bytes: number;
  guardScore: number;
};
```

## N.2 Skill Updates

In `skills/framer-to-elementor-v3/SKILL.md` ergänzen:

- `clone-v3 doctor` vor Build  
- `deploy-tree` statt manuelles set-content  
- Patterns statt freihändigem Header  
- Dual-source rules  
- Large-tree strategy  

References: `v3-gotchas.md` um Tree-Size + upload-php erweitern.

## N.3 E2E Fixture

`tests/unit/e2e/patterns-glass-stats.test.ts`:

- build patterns → merge tree → normalize → guards score ≥ 85  
- kein Netzwerk  

## DoD N

```
[ ] metrics + skill + e2e fixture
[ ] Commit: feat(meta): quality metrics skill sync e2e pattern fixture
```

---

# Phase O — Optional V3→V4 Bridge Gate

## Ziel

Nur wenn User **explizit** V4 will **und** V3 pixel-match grün.

## Regeln

1. `qa-gate` passed critical items  
2. Dann erst `convert-page-v3-to-v4` / dryrun-page-v4  
3. Bridge-JSON muss durch V4-Pipeline Guards (extern) — hier nur **emit + handoff doc**  
4. Verbessere `src/builder/v4-builder.ts` **nicht** zu voller Atomic-Engine in diesem Repo (das ist V4-Repo-Aufgabe). Hier nur:

```typescript
// assert bridge payload has version + elements array + no false "production ready" claim
export function assertV4BridgePayload(x: unknown): asserts x is V4BridgePayload;
```

## DoD O

```
[ ] assertV4BridgePayload tests
[ ] docs note: real GC/$$type only in Framer-to-Elementor-V4-Pipeline
[ ] Commit: feat(bridge): strict v4 handoff payload assert
```

---

# Phase P — Final Freeze

## Schritte

1. `npm run test:unit` + `npm run test:all` wenn vorhanden  
2. `npx tsc --noEmit`  
3. README: Doctor, deploy-tree, patterns, dual-source, config  
4. `docs/CLINICHUB-SESSION-LESSONS-2026-07.md` Link auf V2-Plan  
5. Version bump **0.3.0** (minor — feature drop)  
6. Progress alle Phasen done  
7. Tag optional `v0.3.0`  

## DoD P

```
[ ] All A–O done or explicitly skipped in Progress with reason
[ ] CHANGELOG release notes
[ ] Commit: chore(release): v0.3.0 framer v3 completeness
```

---

## Anhang 1 — Example smoke tokens (template)

```
ch-header-inner
book-btn
stats-row
orbit-title
```

Live-Referenz (kann sich ändern):  
`https://example-wp.test/cloned-page/`  
Source: `https://example.framer.app/`

## Anhang 2 — MCP-Fallen (Copy in Skill)

| Falle | Richtig |
|---|---|
| set-content zu groß | upload-php / split |
| clear-cache ohne post_ids | `{ post_ids: [id] }` |
| Upload-Token „verschönern“ | exact token |
| Success write ≠ visible | frontend HTML + hard reload + document cache |
| Scroll-CSS auf Header-Bar | nur Pills |

## Anhang 3 — Was die ausführende KI **nicht** tun soll

- V4-Repo und V3-Repo in **einen** Builder mergen  
- Framer-to-Elementor-V4 als npm-Dependency hardcoden  
- Production PAT in git remote lassen  
- Blueprint-Text über Screenshot-Truth stellen (außer config `truth: blueprint`)  

---

## Anhang 4 — Progress-Tabelle (Copy für PROGRESS.md)

| Phase | Status | Commit | Date | Notes |
|------|--------|--------|------|-------|
| A Prep | pending | | | |
| B Guards score | pending | | | |
| C Preflight doctor | pending | | | |
| D Deploy large-tree | pending | | | |
| E Patterns | pending | | | |
| F QA gate + section-compare | pending | | | |
| G Session state | pending | | | |
| H Dual-source | pending | | | |
| I Assets media | pending | | | |
| J Autofix | pending | | | |
| K WPCode GSAP | pending | | | |
| L Mobile + HTML report | pending | | | |
| M clone.config | pending | | | |
| N Metrics skill e2e | pending | | | |
| O V4 bridge gate | pending | | | optional |
| P Freeze 0.3.0 | pending | | | |

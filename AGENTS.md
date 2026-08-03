# AGENTS.md — Guide for AI agents working on this repo

> **Read this first.** It tells you what this repo does, how to run a build against a live Novamira WordPress, which abilities exist, and which rules you must never violate.

---

## 1. What this repo is

**unified-elementor-converter** rebuilds any web page (Framer exports, live URLs, static HTML) as an editable Elementor page on a WordPress target running the Novamira plugin — targeting **either** system:

- **V3 Design System** — classic `container` + widgets (`heading`, `text-editor`, `button`, `image`, …)
- **V4 Atomic System** — `e-flexbox` + atomic widgets (`e-heading`, `e-paragraph`, `e-button`, …) with `$$type` settings, Global Classes and Variables

It is the **convergence repo** of two predecessors (both now in maintenance-mode):
- [`site-clone-to-v3`](https://github.com/Adilinu94/site-clone-to-v3) — production V3 cloner (12-phase pipeline)
- [`Framer-to-Elementor-V4-Pipeline`](https://github.com/Adilinu94/Framer-to-Elementor-V4-Pipeline) — V4 Atomic domain logic (schema, guards, Global Classes)

**Start every new build here, not in the predecessors.**

**Binding platform contract:** Before implementing or reviewing generic Framer→Elementor work, read [`docs/REPOSITORY-CHARTA.md`](docs/REPOSITORY-CHARTA.md). A saved Elementor tree is not proof of visual fidelity; source completeness, Visual IR validation, target capability, read-back, renderability, and real multi-viewport QA are mandatory.

---

## 2. Monorepo layout (7 npm workspaces)

| Package | Purpose |
|---|---|
| `packages/core` | Types, guards, orchestrator, AI router, config, WP-target profiles (`~/.clone-v3/profiles.json`) |
| `packages/extractors` | Playwright / HTML / Framer-XML extraction → intermediate representation |
| `packages/target-v3` | IR → V3 tree (normalize, classifier, section builders, progressive deploy) |
| `packages/target-v4` | IR → V4 Atomic tree ($$type, Global Classes, guards) |
| `packages/mcp` | Novamira MCP adapter + **ability-registry** (see §4) + deploy strategies |
| `packages/qa` | pixelmatch/SSIM diff, geometry probe, healing loops, design critic |
| `packages/cli` | `elconv` command router + wizard |

**Hard rule: V3/V4 isolation.** Branded types + `assertNoContamination(tree, target)` keep V3 and V4 trees apart. Never mix `e-flexbox`/`$$type` (V4) into a V3 tree or vice versa. Guards run in `elconv convert` and `elconv doctor`.

---

## 3. CLI reference (`elconv`)

| Command | What it does |
|---|---|
| `elconv wizard` | **Interactive** step-by-step pipeline (no flags needed: prompts target V3/V4 → source → output → deploy → dry-run). Flags: `--target v3\|v4 --url/--html/--xml --out --post-id --dry-run --resume --no-interactive` |
| `elconv convert` | Extract source → build V3/V4 tree → validate → output (`--target`, `--url/--xml/--html`, `--out`, `--skip-guards`) |
| `elconv doctor` | Preflight checks (MCP, guards, contamination). **`--sync-abilities`** diffs the ability-registry against the live server (see §4) |
| `elconv deploy` | Push tree to WordPress via MCP (`--tree`, `--post-id`, `--strategy auto\|direct\|upload-php\|split`, `--dry-run`) |
| `elconv qa` | Visual QA: Playwright capture + **real pixelmatch/SSIM score** (0.6·SSIM + 0.4·pixel). Needs `--url` AND `--ref-url`; without a reference it reports "not scored" (never a fabricated pass) |
| `elconv design-critic` | Layer-1 design critique from computed styles (no reference, no vision model needed) |
| `elconv target` | Manage WP target profiles (`add\|list\|remove`) |
| `elconv session-init` | Initialize a conversion session |
| `elconv batch` | Convert a manifest with concurrency, retry, rate-limit, and resume support |
| `elconv serve` | Expose conversion and QA through the local HTTP API |
| `elconv rollback` | Restore a captured WordPress snapshot |
| `elconv preflight` | Check target plugin/PHP/WordPress compatibility |

Exit codes: `0` ok, `1` guard/deploy/QA failure, `2` usage error.

---

## 4. Novamira MCP — the ability registry is the single source of truth

The live server (`testseite.nick-webdesign.de`, Elementor 4.2.1 + Pro 4.1.0, V4 Atomic fully active) exposes **263 abilities** in 3 namespaces:

- `novamira/*` — core: set-content, execute-php, WPCode, filesystem, WP-CLI
- `novamira-adrianv2/*` — builder/audit/batch/atomic-widgets (`batch-build-page`, `setup-v4-foundation`, `visual-qa`, …)
- `mcp-adapter/*` — meta (list-abilities, …)

**Rules:**
1. Every ability name used in code MUST exist in `packages/mcp/src/ability-registry.ts` (`KNOWN_ABILITIES`, generated from `docs/NOVAMIRA-LIVE-ABILITIES-2026-07-30.txt`). A CI drift-gate test (`tests/unit/mcp/ability-registry.test.ts`) fails on unknown names.
2. Old names (`novamira/adrians-X`, `novamira/upload`, …) are auto-resolved via `ALIAS_MAP` → `resolveAbilityName()` inside `executeAbility()` (adapter.ts). Unknown names throw `UnknownAbilityError` with a suggestion.
3. Check live drift with: `elconv doctor --sync-abilities --target-name <profile>` (or `--mcp-url` + `--auth-env`).
4. Per-step ability lookup: `docs/NOVAMIRA-ABILITY-PLAYBOOK.md`.
5. `browser/execute-js` in QA modules is a **local Playwright probe**, NOT an MCP ability.

**Wire format** (JSON-RPC 2.0 via MCP adapter):
```json
{ "name": "mcp-adapter-execute-ability",
  "arguments": { "ability_name": "novamira-adrianv2/batch-build-page", "parameters": { } } }
```

---

## 5. Standard workflows

### V3 build
```
elconv wizard                       # interactive, or:
elconv convert --target v3 --xml page.xml --out v3-tree.json
elconv doctor  --target v3 --tree v3-tree.json
elconv deploy  --target v3 --tree v3-tree.json --post-id N
elconv qa      --url <permalink> --ref-url <source-url>
```

### V4 Atomic build
Same flow with `--target v4`. Additionally on the server side: `setup-v4-foundation`, `batch-create-variables`, `create-global-class`, then `batch-build-page` with `$$type` settings. Verify with `validate-v4-tree` + `class-audit`/`variable-audit`.

### Server-side V3→V4 conversion (alternative to local bridge)
Abilities `upgrade-page-to-v4` / `convert-page-v3-to-v4` (single page) and `convert-site-v3-to-v4` (whole site).

---

## 6. Gotchas (reproduced, will bite you)

- **V4 silently ignores some V3 settings** (`typography_font_size` without `typography_typography:'custom'`, external `background_image`, widget `css_classes`, `_element_width` in flex rows). The V3 render-compat knowledge from site-clone applies 1:1.
- **`css_classes` must be a string**, never an array (renders literal `"Array"`).
- **Deploy strategy matters:** nested V3 trees need `injectPage`-style direct set-content, not `batch-build-page` (drops nested V3).
- **WPCode:** footer location is `site_wide_footer` (not `site_footer`); inline JS needs `code_type:'html'`; never send `priority`.
- **A successful MCP write ≠ a visible result.** Verify with `elconv qa` or the geometry probe after cache clear.
- **QA scores are only real with a reference.** `elconv qa` without `--ref-url` reports "not scored" by design — don't "fix" that.
- **AI providers read `ANTHROPIC_API_KEY`/`OPENAI_API_KEY` from env.** Tests must `vi.stubEnv(...)` them (see `tests/unit/core/ai-layer-smoke.test.ts`) or ambient keys cause real API calls.

---

## 7. Commands & working rules

```bash
npm ci
npx tsc --build --clean
npx tsc --build --pretty false   # authoritative workspace typecheck
npx vitest run --pool=forks --maxWorkers=1 --minWorkers=1 --testTimeout=15000
npx eslint packages/<p>/src
git diff --check
```

The root `tsc --noEmit` configuration intentionally has no root files; use the project-reference build above as the authoritative typecheck. A serial Vitest run is the deterministic release gate because the existing design-critic test can time out under parallel load while passing in isolation and serial execution.

The legacy `clone-v3` analysis options `--qa-auto-fix`, `--heal`, and `--full-context-repair` are implemented through explicit browser, WordPress, and AI ports. Missing prerequisites are reported as `unavailable`, execution failures or unreached thresholds as `failed`, and diagnostic AI proposals are never presented as applied repairs. Their contracts and prerequisites are tracked in `docs/TODO-OFFEN-2026-07-31.md`.

**Binding working rules** (from HANDOFF, apply to every change):
1. Read the module's source completely before changing it.
2. Tests with real assertions for every change.
3. Verify: tsc → affected tests → full suite → lint.
4. One finding per commit.
5. `git fetch origin` before every push — **parallel sessions are real** on this repo.

---

## 8. Key documents

| Doc | Content |
|---|---|
| [`docs/REPOSITORY-MAP.md`](docs/REPOSITORY-MAP.md) | **Kanonische Repo-Landkarte:** Lesereihenfolge, Workspaces, Statusbegriffe, Aufräumregeln und Sicherheitsgrenzen |
| [`docs/REPOSITORY-CHARTA.md`](docs/REPOSITORY-CHARTA.md) | **Binding platform charter:** arbitrary Framer projects, Visual IR boundary, fallback policy, deploy/render contracts, QA gates, and Definition of Done |
| `docs/BAUPLAN-v5.0-KONVERGENZ-NOVAMIRA-WIZARDS-2026-07.md` | Current phase plan (100–115): registry, wizards, convergence, hardening |
| `docs/NOVAMIRA-ABILITY-PLAYBOOK.md` | Per-pipeline-step ability lookup with parameter shapes |
| `docs/NOVAMIRA-LIVE-ABILITIES-2026-07-30.txt` | The 263 live abilities (registry source) |
| `docs/HANDOFF-2026-07-30.md` | Session handoff + working rules |
| `docs/PROGRESS.md` | Phase history (0–74) |

---

## 9. Conventions

- **Language:** German with the user, English in code comments.
- **ESM:** `type: "module"`, `.js` extensions in imports.
- **No secrets in git** — no tokens in remote URLs or committed files.
- **Windows-safe paths:** use `os.homedir()`, never `~/`.

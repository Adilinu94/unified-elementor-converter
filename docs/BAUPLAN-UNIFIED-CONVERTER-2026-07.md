# Bauplan — Unified Elementor Converter (Neues Repository)

**Status:** Verbindliche Spezifikation für ausführende KI.  
**Zielgruppe:** Schwächere / billigere KI. Jede Phase ist so geschrieben, dass sie **ohne Rückfragen** umsetzbar ist.  
**Repo-Name:** `unified-elementor-converter`  
**Quell-Repos (nur lesen / Ideen portieren, NICHT als Dependency):**
- `Adilinu94/site-clone-to-v3` (V3-Stärken: CLI, Extractor, QA, Patterns)
- `Adilinu94/Framer-to-Elementor-V4-Pipeline` (V4-Stärken: Guards, $$type, GC, Preflight)

**Geschätzter Aufwand:** 80–120 h (schwächere KI: eher 120–160 h).

---

## 0. Executive Summary

Ein **neues, eigenständiges** TypeScript-Monorepo, das:
- **Beliebige Website-Quellen** (URL via Playwright, Framer XML, HTML-Export) extrahiert
- **Elementor V3** (container/section/column/widget) ODER **Elementor V4 Atomic** (e-flexbox, $$type, Global Classes) als Ziel ausgibt
- **Strikte Trennung** zwischen V3- und V4-Logik auf Typ-, Laufzeit- und CLI-Ebene erzwingt
- **Einheitliches CLI** (`npx elconv`) mit target-spezifischen Subcommands bietet
- **Score-basierte Guards** (≥85) vor jedem Deploy erzwingt
- **Large-Tree Deploy** (direct/upload-php/split) + Rollback unterstützt
- **Visual QA** (pixelmatch + structural probes) als Done-Gate nutzt

---

## 1. Pflichtregeln (BINDEND)

### 1.1 Arbeitsweise

1. **Eine Phase nach der anderen.** DoD grün → erst dann nächste.
2. **Kleine Commits** (1 Phase ≈ 1 Commit, >400 LOC → Sub-Commits).
3. **Kein Scope-Creep.** Nur was in der Phase steht.
4. **Tests:** `npm test` muss exit 0 geben bevor Phase als done gilt.
5. **ESM:** `"type": "module"`, Imports mit `.js`-Suffix.
6. **Keine Secrets** committen.
7. **Englisch** in Code, Tests, Commits. Deutsch nur in Docs erlaubt.
8. **Port-Regel:** Code aus Quell-Repos **adaptieren** (neue Typen, neue Pfade). Nie 1:1 copy-paste ohne Anpassung.

### 1.2 VERBOTEN (Hard Rules)

- ❌ `target-v3` importiert aus `target-v4` (oder umgekehrt)
- ❌ V4 `$$type` / `e-flexbox` / `e-heading` in einem V3-Tree
- ❌ V3 `elType: 'container'` / `elType: 'section'` in einem V4-Tree
- ❌ Gemeinsame Pattern-Implementierung für V3 und V4 (jedes Target hat EIGENE Patterns)
- ❌ Assertions löschen um Tests grün zu machen
- ❌ `node_modules` committen
- ❌ Hardcodierte Produktions-URLs / Secrets

### 1.3 Definition „Phase grün"

```
[ ] Alle Dateien aus Phase existieren / geändert
[ ] Alle Acceptance Criteria erfüllt
[ ] npm test → exit 0
[ ] npx tsc --noEmit → exit 0
[ ] CHANGELOG.md [Unreleased] ergänzt
[ ] docs/PROGRESS.md Zeile updated
[ ] Commit: feat|fix|docs|test|chore(scope): …
[ ] Keine Secrets
```

### 1.4 Commit-Schema

```
feat(core): add branded types and contamination guard
feat(target-v3): implement container normalize
feat(target-v4): implement $$type wrapper system
feat(cli): add convert command with target routing
test(qa): add structural probe unit tests
docs(umbauplan): mark phase 3 done
```

---

## 2. Repository-Struktur (EXAKT)

```
unified-elementor-converter/
├── package.json                    # Workspace root
├── tsconfig.json                   # Base TS config
├── tsconfig.build.json             # Build config (references)
├── vitest.config.ts                # Test runner config
├── .gitignore
├── .prettierrc.json
├── eslint.config.mjs
├── CHANGELOG.md
├── README.md
├── docs/
│   ├── BAUPLAN-UNIFIED-CONVERTER-2026-07.md   # ← dieses Dokument
│   ├── PROGRESS.md                             # Phasen-Tracking
│   ├── ARCHITECTURE.md                         # Architektur-Übersicht
│   ├── AI-EXECUTOR-PLAYBOOK.md                 # Regeln für ausführende KI
│   └── CRITICAL-FAILURE-POINTS.md              # Fehleranfällige Stellen
│
├── packages/
│   ├── core/                       # Shared Kernel (KEINE Elementor-Version)
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   └── src/
│   │       ├── index.ts
│   │       ├── types.ts            # SourceSpec, SectionSpec, WidgetSpec
│   │       ├── branded-types.ts    # V3ElementTree, V4ElementTree (branded)
│   │       ├── design-tokens.ts    # DesignTokenSet (canonical)
│   │       ├── contamination.ts    # assertNoContamination() runtime check
│   │       ├── guards.ts           # Guard<T> interface, runGuards(), GuardReport
│   │       ├── pipeline-state.ts   # PipelineState load/save/mark
│   │       ├── deploy-strategy.ts  # chooseStrategy() (direct/upload-php/split)
│   │       └── errors.ts           # ContaminationError, GuardError, etc.
│   │
│   ├── extractors/                 # Input-Adapter (Quelle → SourceSpec)
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   └── src/
│   │       ├── index.ts
│   │       ├── types.ts            # ExtractorOptions, ExtractResult
│   │       ├── playwright/         # Any-URL Scraper (aus site-clone)
│   │       │   ├── index.ts
│   │       │   ├── page-scraper.ts
│   │       │   ├── section-detector.ts
│   │       │   ├── style-extractor.ts
│   │       │   └── font-discovery.ts
│   │       ├── framer-xml/         # Framer XML/Unframer (aus V4-Pipeline)
│   │       │   ├── index.ts
│   │       │   ├── xml-parser.ts
│   │       │   ├── unframer-client.ts
│   │       │   └── project-match.ts
│   │       ├── html-export/        # Statischer HTML-Export
│   │       │   ├── index.ts
│   │       │   └── html-parser.ts
│   │       └── css-fallback/       # CSS-Variablen-Extraktion
│   │           ├── index.ts
│   │           └── css-var-extractor.ts
│   │
│   ├── target-v3/                  # Elementor V3 Output (STRIKT ISOLIERT)
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   └── src/
│   │       ├── index.ts
│   │       ├── types.ts            # V3Element, V3PageData
│   │       ├── builder.ts          # SourceSpec → V3Element[]
│   │       ├── normalize.ts        # Container normalize (isInner, flex-row)
│   │       ├── guards.ts           # V3-spezifische Guards (G1-G7c + neue)
│   │       ├── deploy.ts           # V3 deploy (inject-calibrated-page)
│   │       ├── patterns/           # Widget-first Patterns
│   │       │   ├── index.ts
│   │       │   ├── types.ts
│   │       │   ├── sticky-glass-header.ts
│   │       │   ├── stat-row.ts
│   │       │   ├── orbit-cluster.ts
│   │       │   ├── marquee-row.ts
│   │       │   └── service-cards.ts
│   │       └── wpcode/             # WPCode page-scope + presets
│   │           ├── index.ts
│   │           ├── page-scope.ts
│   │           └── presets/
│   │               ├── index.ts
│   │               ├── gsap-fade-up.ts
│   │               └── gsap-header-scroll.ts
│   │
│   ├── target-v4/                  # Elementor V4 Atomic Output (STRIKT ISOLIERT)
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   └── src/
│   │       ├── index.ts
│   │       ├── types.ts            # V4TreeNode, V4StyleClass, $$type types
│   │       ├── builder.ts          # SourceSpec → V4TreeNode[]
│   │       ├── framer-utils.ts     # wrapType, wrapColor, wrapSize, etc.
│   │       ├── style-id.ts         # generateStyleId, isValidStyleId, sanitize
│   │       ├── guards.ts           # V4-spezifische Guards ($$type, GC, depth)
│   │       ├── global-classes.ts   # GC generation + binding
│   │       ├── deploy.ts           # V4 deploy (batch-build-page / set-content)
│   │       ├── bridge-upgrade.ts   # V3-JSON → echtes Atomic upgrade
│   │       └── patterns/           # Atomic Patterns (EIGENE Implementierung!)
│   │           ├── index.ts
│   │           ├── types.ts
│   │           ├── sticky-glass-header.ts
│   │           ├── stat-row.ts
│   │           └── orbit-cluster.ts
│   │
│   ├── mcp/                        # Unified MCP Transport
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   └── src/
│   │       ├── index.ts
│   │       ├── adapter.ts          # JSON-RPC 2.0 transport
│   │       ├── abilities.ts        # Typed ability wrappers
│   │       ├── circuit-breaker.ts  # Retry + backoff
│   │       ├── targets.ts          # Named WP targets (~/.config)
│   │       ├── preflight/          # Preflight checks
│   │       │   ├── index.ts
│   │       │   ├── run-all.ts
│   │       │   ├── check-mcp.ts
│   │       │   ├── check-experiments.ts
│   │       │   ├── check-unframer.ts
│   │       │   └── check-project-match.ts
│   │       └── deploy/             # Deploy infrastructure
│   │           ├── index.ts
│   │           ├── deploy-tree.ts
│   │           ├── large-tree.ts
│   │           ├── rollback.ts
│   │           └── smoke-check.ts
│   │
│   ├── qa/                         # Shared QA Infrastructure
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   └── src/
│   │       ├── index.ts
│   │       ├── types.ts            # QaReport, ProbeResult
│   │       ├── visual-diff.ts      # Playwright + pixelmatch
│   │       ├── structural-probes.ts# Shared probe IDs
│   │       ├── section-compare.ts  # Framer vs WP section screenshots
│   │       ├── viewport-matrix.ts  # 1440/768/390
│   │       ├── html-report.ts      # Human-readable HTML report
│   │       └── capture-wait.ts     # Wait fonts/lazyload/Elementor
│   │
│   └── cli/                        # Single Entry Point
│       ├── package.json
│       ├── tsconfig.json
│       └── src/
│           ├── main.ts             # Router
│           ├── cmd-convert.ts      # --target v3|v4
│           ├── cmd-doctor.ts       # Preflight suite
│           ├── cmd-deploy.ts       # Deploy with strategy
│           ├── cmd-qa.ts           # Visual QA gate
│           ├── cmd-session.ts      # Session init + state
│           └── cmd-target.ts       # WP target management
│
├── schemas/
│   ├── source-spec.schema.json     # Input format
│   ├── v3-element.schema.json      # V3 output format
│   ├── v4-atomic-schema.json       # V4 output format (aus V4-Pipeline)
│   └── pipeline-state.schema.json
│
├── fixtures/
│   ├── source-specs/               # Test input fixtures
│   │   ├── simple-landing.json
│   │   └── multi-section-page.json
│   ├── v3-trees/                   # Expected V3 outputs
│   │   └── simple-landing.v3.json
│   ├── v4-trees/                   # Expected V4 outputs
│   │   └── simple-landing.v4.json
│   ├── framer-xml/                 # Test XML files
│   │   └── mini-homepage.xml
│   └── qa/                         # QA fixtures
│       └── checklist-default.json
│
├── skills/                         # AI Skill-Dateien (getrennt!)
│   ├── convert-to-v3/
│   │   ├── SKILL.md               # NUR V3-Regeln
│   │   └── references/
│   │       ├── widget-first.md
│   │       └── v3-gotchas.md
│   ├── convert-to-v4/
│   │   ├── SKILL.md               # NUR V4-Regeln
│   │   └── references/
│   │       ├── atomic-schema.md
│   │       └── v4-gotchas.md
│   └── shared/
│       ├── design-tokens.md
│       └── mcp-abilities.md
│
└── tests/
    ├── unit/
    │   ├── core/
    │   ├── extractors/
    │   ├── target-v3/
    │   ├── target-v4/
    │   ├── mcp/
    │   ├── qa/
    │   └── cli/
    ├── integration/
    │   ├── v3-pipeline.test.ts
    │   └── v4-pipeline.test.ts
    └── e2e/
        ├── v3-offline.test.ts
        └── v4-offline.test.ts
```

---

## 3. Phasen-Reihenfolge (BINDEND)

```
Phase 0:  Repo-Setup + Workspace + Baseline
Phase 1:  Core Kernel (types, branded types, guards, contamination)
Phase 2:  MCP Transport (adapter, circuit-breaker, targets)
Phase 3:  Target-V3 Builder + Normalize + Guards
Phase 4:  Target-V4 Builder + $$type + Guards
Phase 5:  Extractors (Playwright + Framer XML + CSS-Fallback)
Phase 6:  CLI Surface (convert, doctor, deploy, qa)
Phase 7:  Deploy Infrastructure (large-tree, rollback, smoke)
Phase 8:  Preflight Suite (always-on before build/deploy)
Phase 9:  V3 Patterns (widget-first: glass, stats, orbit, marquee, cards)
Phase 10: V4 Patterns (atomic: glass, stats, orbit)
Phase 11: QA Infrastructure (visual-diff, probes, section-compare)
Phase 12: Session + Pipeline State
Phase 13: WPCode + Animation Inject
Phase 14: Bridge (V3 → V4 upgrade path)
Phase 15: Config System (elconv.config.yaml)
Phase 16: Skills + Docs + AI-Executor-Playbook
Phase 17: E2E Fixtures + Integration Tests
Phase 18: Final Freeze + Version 0.1.0
```

**Strikt sequentiell:** 0 → 1 → 2 → 3 → 4 → 5 → 6 → 7 → 8 → …  
**Parallel erlaubt (nur mit 2 Agents):** 9 parallel zu 10, 11 parallel zu 12.

---

## 4. Phase 0 — Repo-Setup + Workspace

### Ziel
Leeres Monorepo mit npm workspaces, TypeScript, Vitest, ESLint.

### Schritte

#### 0.1 Root package.json (EXAKT)

```json
{
  "name": "unified-elementor-converter",
  "version": "0.0.1",
  "private": true,
  "type": "module",
  "engines": { "node": ">=18" },
  "workspaces": [
    "packages/core",
    "packages/extractors",
    "packages/target-v3",
    "packages/target-v4",
    "packages/mcp",
    "packages/qa",
    "packages/cli"
  ],
  "scripts": {
    "build": "tsc --build tsconfig.build.json",
    "test": "vitest run",
    "test:unit": "vitest run tests/unit",
    "test:integration": "vitest run tests/integration",
    "test:e2e": "vitest run tests/e2e",
    "test:watch": "vitest",
    "lint": "eslint packages/*/src --ext .ts",
    "format": "prettier --write \"packages/*/src/**/*.ts\" \"tests/**/*.ts\"",
    "typecheck": "tsc --noEmit"
  },
  "devDependencies": {
    "@types/node": "^22.10.0",
    "@typescript-eslint/eslint-plugin": "^8.18.0",
    "@typescript-eslint/parser": "^8.18.0",
    "@vitest/coverage-v8": "^2.1.8",
    "eslint": "^9.17.0",
    "prettier": "^3.4.2",
    "tsx": "^4.19.2",
    "typescript": "^5.7.2",
    "vitest": "^2.1.8"
  }
}
```

#### 0.2 Root tsconfig.json (EXAKT)

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "lib": ["ES2022"],
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true,
    "outDir": "./dist",
    "rootDir": "."
  },
  "exclude": ["node_modules", "dist"]
}
```

#### 0.3 vitest.config.ts (EXAKT)

```typescript
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['packages/*/src/**/*.ts'],
    },
  },
});
```

#### 0.4 .gitignore (EXAKT)

```
node_modules/
dist/
*.tsbuildinfo
.env
.env.local
mcp-server-config.json
research/
_backups/
*.log
coverage/
```

#### 0.5 Jedes Package: package.json Template

Für JEDES Package unter `packages/` (Beispiel `packages/core`):

```json
{
  "name": "@elconv/core",
  "version": "0.0.1",
  "type": "module",
  "main": "./src/index.ts",
  "types": "./src/index.ts",
  "exports": {
    ".": "./src/index.ts"
  },
  "dependencies": {},
  "devDependencies": {}
}
```

**Package-Namen:**
- `@elconv/core`
- `@elconv/extractors`
- `@elconv/target-v3`
- `@elconv/target-v4`
- `@elconv/mcp`
- `@elconv/qa`
- `@elconv/cli`

**Dependencies zwischen Packages (BINDEND):**
```
@elconv/core        → keine internen deps
@elconv/extractors  → @elconv/core
@elconv/target-v3   → @elconv/core (NIEMALS @elconv/target-v4!)
@elconv/target-v4   → @elconv/core (NIEMALS @elconv/target-v3!)
@elconv/mcp         → @elconv/core
@elconv/qa          → @elconv/core, @elconv/mcp
@elconv/cli         → ALLE oben (Router)
```

#### 0.6 Git init + erster Commit

```bash
git init
git add -A
git commit -m "chore: initialize unified-elementor-converter monorepo workspace"
```

### DoD Phase 0

```
[ ] npm install → exit 0
[ ] npx tsc --noEmit → exit 0 (leere src/index.ts in jedem Package)
[ ] npx vitest run → exit 0 (0 tests, no errors)
[ ] docs/PROGRESS.md existiert mit Phasen 0–18
[ ] Commit: chore: initialize unified-elementor-converter monorepo workspace
```

---

## 5. Phase 1 — Core Kernel

### Ziel
Alle shared types, branded types, guard infrastructure, contamination check.

### 5.1 `packages/core/src/types.ts` (EXAKT)

```typescript
/**
 * Version-agnostic source specification.
 * Extractors produce this; target builders consume it.
 */

export type SourceType = 'url' | 'framer-xml' | 'html-export';

export interface SourceSpec {
  /** Where the content came from */
  source: {
    type: SourceType;
    url?: string;
    xmlPath?: string;
    htmlPath?: string;
  };
  /** Extracted design tokens */
  tokens: DesignTokenSet;
  /** Page sections in order */
  sections: SectionSpec[];
  /** Raw CSS variables discovered */
  cssVars: Record<string, string>;
  /** Warnings from extraction */
  warnings: string[];
}

export interface SectionSpec {
  id: string;
  /** Semantic hint: hero, header, stats, services, footer, etc. */
  semanticRole?: string;
  /** CSS class prefix for this section */
  cssClass?: string;
  /** Layout type */
  layout: 'single-column' | 'multi-column' | 'grid' | 'flex-row';
  columns?: number;
  /** Child widgets in order */
  widgets: WidgetSpec[];
  /** Section-level styles (background, padding, etc.) */
  styles: Record<string, string>;
  /** Animation hints */
  animations?: AnimationHint[];
}

export interface WidgetSpec {
  id: string;
  /** Semantic widget type (version-agnostic) */
  type: WidgetType;
  /** Text content (for heading, text, button) */
  text?: string;
  /** Image source URL */
  imageUrl?: string;
  /** Link href (for buttons, links) */
  href?: string;
  /** Computed styles from source */
  styles: Record<string, string>;
  /** Child widgets (for nested structures) */
  children?: WidgetSpec[];
}

export type WidgetType =
  | 'heading'
  | 'text'
  | 'image'
  | 'button'
  | 'icon'
  | 'video'
  | 'divider'
  | 'spacer'
  | 'html'
  | 'form'
  | 'accordion'
  | 'container';

export interface AnimationHint {
  type: 'fade-up' | 'fade-in' | 'slide-left' | 'slide-right' | 'scale' | 'custom';
  selector?: string;
  duration?: number;
  delay?: number;
}

export interface DesignTokenSet {
  colors: DesignToken[];
  fonts: DesignToken[];
  sizes: DesignToken[];
}

export interface DesignToken {
  id: string;
  hex?: string;
  family?: string;
  weight?: number;
  px?: number;
  occurrences: number;
  gv_id: string | null;
  label?: string;
  role?: SemanticRole;
  css_var?: string | null;
}

export type SemanticRole =
  | 'primary' | 'secondary' | 'accent'
  | 'background' | 'surface'
  | 'text' | 'text-muted'
  | 'border' | 'heading' | 'body';

export const EMPTY_DESIGN_TOKEN_SET: DesignTokenSet = {
  colors: [], fonts: [], sizes: [],
};
```

### 5.2 `packages/core/src/branded-types.ts` (EXAKT — KRITISCH)

```typescript
/**
 * Branded types prevent accidental mixing of V3 and V4 trees at compile time.
 * A function accepting V3ElementTree CANNOT receive a V4ElementTree.
 *
 * KRITISCH: Diese Datei ist die wichtigste Anti-Contamination-Maßnahme.
 * NIEMALS ändern ohne Phase "Breaking".
 */

import type { V3Element } from '@elconv/target-v3';
import type { V4TreeNode } from '@elconv/target-v4';

// Unique symbols for branding (exist only at type level)
declare const __v3Brand: unique symbol;
declare const __v4Brand: unique symbol;

/**
 * V3ElementTree is a V3Element[] that has been validated and branded.
 * You CANNOT pass a raw V3Element[] — you must call brandV3Tree() first.
 */
export type V3ElementTree = V3Element[] & { readonly [__v3Brand]: true };

/**
 * V4ElementTree is a V4TreeNode[] that has been validated and branded.
 * You CANNOT pass a raw V4TreeNode[] — you must call brandV4Tree() first.
 */
export type V4ElementTree = V4TreeNode[] & { readonly [__v4Brand]: true };

/**
 * Target discriminator — used throughout the system to route logic.
 */
export type ElementorTarget = 'v3' | 'v4';

/**
 * Brand a validated V3 tree. Call ONLY after guards pass.
 */
export function brandV3Tree(tree: V3Element[]): V3ElementTree {
  return tree as V3ElementTree;
}

/**
 * Brand a validated V4 tree. Call ONLY after guards pass.
 */
export function brandV4Tree(tree: V4TreeNode[]): V4ElementTree {
  return tree as V4ElementTree;
}
```

**WICHTIG FÜR AUSFÜHRENDE KI:** Die branded types importieren von `@elconv/target-v3` und `@elconv/target-v4`. Das erzeugt eine zirkuläre Abhängigkeit auf Typ-Ebene. Lösung: Die konkreten `V3Element` und `V4TreeNode` Interfaces werden in `@elconv/core/src/types.ts` als **Basis-Interfaces** definiert und von den Target-Packages erweitert. Alternativ: Branded types nutzen `unknown[]` als Basis und die Target-Packages casten.

**EMPFOHLENE LÖSUNG (einfacher für schwächere KI):**

```typescript
// packages/core/src/branded-types.ts — EINFACHE VERSION
declare const __v3Brand: unique symbol;
declare const __v4Brand: unique symbol;

export type V3ElementTree = unknown[] & { readonly [__v3Brand]: true };
export type V4ElementTree = unknown[] & { readonly [__v4Brand]: true };
export type ElementorTarget = 'v3' | 'v4';

export function brandV3Tree(tree: unknown[]): V3ElementTree {
  return tree as V3ElementTree;
}

export function brandV4Tree(tree: unknown[]): V4ElementTree {
  return tree as V4ElementTree;
}
```

### 5.3 `packages/core/src/contamination.ts` (EXAKT — KRITISCH)

```typescript
/**
 * Runtime anti-contamination checks.
 * Called BEFORE any build or deploy to catch version mixing.
 *
 * KRITISCH: Diese Checks sind die letzte Verteidigungslinie.
 * Sie MÜSSEN vor jedem Deploy aufgerufen werden.
 */

import type { ElementorTarget } from './branded-types.js';

export class ContaminationError extends Error {
  constructor(
    public readonly target: ElementorTarget,
    public readonly found: string,
    public readonly path?: string,
  ) {
    super(
      `CONTAMINATION: Found "${found}" in ${target.toUpperCase()} tree` +
      (path ? ` at ${path}` : '') +
      `. This indicates V3/V4 mixing. Aborting.`,
    );
    this.name = 'ContaminationError';
  }
}

/** V4-only markers that must NEVER appear in a V3 tree */
const V4_MARKERS = [
  '$$type',
  'e-flexbox',
  'e-heading',
  'e-text',
  'e-button',
  'e-image',
  'e-div-block',
  'e-grid',
  'e-html',
  'global-color-variable',
  'global-font-variable',
];

/** V3-only markers that must NEVER appear in a V4 tree */
const V3_MARKERS = [
  '"elType":"container"',
  '"elType":"section"',
  '"elType":"column"',
  '"isInner":true',
  '"_element_width"',
  '"content_width"',
];

/**
 * Scan a tree (as JSON string) for cross-version contamination.
 * Throws ContaminationError if any marker from the WRONG version is found.
 *
 * @param tree - The element tree (will be JSON.stringify'd)
 * @param target - Which version this tree is supposed to be
 */
export function assertNoContamination(tree: unknown, target: ElementorTarget): void {
  const json = JSON.stringify(tree);

  if (target === 'v3') {
    for (const marker of V4_MARKERS) {
      if (json.includes(marker)) {
        throw new ContaminationError('v3', marker);
      }
    }
  }

  if (target === 'v4') {
    for (const marker of V3_MARKERS) {
      if (json.includes(marker)) {
        throw new ContaminationError('v4', marker);
      }
    }
  }
}

/**
 * Non-throwing version — returns list of violations.
 */
export function findContamination(tree: unknown, target: ElementorTarget): string[] {
  const json = JSON.stringify(tree);
  const violations: string[] = [];

  const markers = target === 'v3' ? V4_MARKERS : V3_MARKERS;
  for (const marker of markers) {
    if (json.includes(marker)) {
      violations.push(marker);
    }
  }
  return violations;
}
```

### 5.4 `packages/core/src/guards.ts` (EXAKT)

```typescript
/**
 * Generic guard system — used by both V3 and V4 targets.
 * Each target defines its own guards; this file provides the runner.
 */

export type GuardSeverity = 'critical' | 'warning' | 'info';

export interface GuardResult {
  readonly passed: boolean;
  readonly message: string;
  readonly details?: string;
}

export interface Guard<T> {
  readonly name: string;
  readonly severity: GuardSeverity;
  check(tree: T): GuardResult;
}

export interface GuardReportEntry {
  readonly name: string;
  readonly severity: GuardSeverity;
  readonly result: GuardResult;
}

export interface GuardReport {
  /** 0–100 score after applying penalties. */
  readonly score: number;
  /** true when score >= threshold AND no critical failures. */
  readonly passed: boolean;
  /** Score threshold used (default 85). */
  readonly threshold: number;
  readonly results: readonly GuardReportEntry[];
}

const SCORE_PENALTY: Record<GuardSeverity, number> = {
  critical: 20,
  warning: 5,
  info: 0,
};

/**
 * Run a suite of guards against a tree.
 * Score starts at 100; each failed guard subtracts its penalty.
 * passed = score >= threshold AND no critical guard failed.
 */
export function runGuards<T>(
  tree: T,
  guards: ReadonlyArray<Guard<T>>,
  threshold = 85,
): GuardReport {
  let score = 100;
  const results: GuardReportEntry[] = [];
  let hasCriticalFailure = false;

  for (const guard of guards) {
    const result = guard.check(tree);
    results.push({ name: guard.name, severity: guard.severity, result });
    if (!result.passed) {
      score = Math.max(0, score - SCORE_PENALTY[guard.severity]);
      if (guard.severity === 'critical') hasCriticalFailure = true;
    }
  }

  return {
    score,
    passed: score >= threshold && !hasCriticalFailure,
    threshold,
    results,
  };
}

/**
 * Format a GuardReport as human-readable CLI output.
 */
export function formatGuardReport(report: GuardReport): string {
  const status = report.passed ? '✅ PASSED' : '❌ FAILED';
  const lines: string[] = [
    `Guard Score: ${report.score}/100 — ${status} (threshold: ${report.threshold})`,
  ];

  for (const entry of report.results) {
    const icon = entry.result.passed ? '✓' : entry.severity === 'critical' ? '✗' : '⚠';
    const line = `  ${icon} [${entry.name}] ${entry.result.message}`;
    lines.push(entry.result.details ? `${line}\n    ↳ ${entry.result.details}` : line);
  }

  return lines.join('\n');
}
```

### 5.5 `packages/core/src/deploy-strategy.ts` (EXAKT)

```typescript
/**
 * Deploy strategy selection based on tree size.
 * Both V3 and V4 use the same thresholds (empirically validated).
 */

export type DeployStrategy = 'direct' | 'upload-php' | 'split';

export const STRATEGY_THRESHOLDS = {
  /** Below this: direct set-content / inject */
  directMaxBytes: 400_000,
  /** Below this: upload file + PHP inject */
  uploadPhpMaxBytes: 1_200_000,
  /** Above uploadPhpMaxBytes: split top-level sections */
} as const;

export function chooseDeployStrategy(
  treeBytes: number,
  forced?: DeployStrategy,
): DeployStrategy {
  if (forced) return forced;
  if (treeBytes < STRATEGY_THRESHOLDS.directMaxBytes) return 'direct';
  if (treeBytes < STRATEGY_THRESHOLDS.uploadPhpMaxBytes) return 'upload-php';
  return 'split';
}

export function measureTreeBytes(tree: unknown): number {
  return Buffer.byteLength(JSON.stringify(tree), 'utf-8');
}
```

### 5.6 `packages/core/src/pipeline-state.ts` (EXAKT)

```typescript
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname } from 'node:path';
import type { ElementorTarget } from './branded-types.js';

export interface PipelineState {
  version: 3;
  target: ElementorTarget;
  source: {
    type: 'url' | 'framer-xml' | 'html-export';
    url?: string;
    xmlPath?: string;
  };
  postId?: number;
  phases: Record<string, 'pending' | 'done' | 'failed' | 'skipped'>;
  lastError?: string;
  updatedAt: string;
  artifacts: Record<string, string>;
}

export function loadState(path: string): PipelineState | null {
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, 'utf-8')) as PipelineState;
  } catch {
    return null;
  }
}

export function saveState(path: string, state: PipelineState): void {
  mkdirSync(dirname(path), { recursive: true });
  state.updatedAt = new Date().toISOString();
  writeFileSync(path, JSON.stringify(state, null, 2), 'utf-8');
}

export function markPhase(
  state: PipelineState,
  phaseId: string,
  status: 'pending' | 'done' | 'failed' | 'skipped',
): PipelineState {
  return {
    ...state,
    phases: { ...state.phases, [phaseId]: status },
    updatedAt: new Date().toISOString(),
  };
}
```

### 5.7 Tests für Phase 1

`tests/unit/core/contamination.test.ts`:
```typescript
import { describe, it, expect } from 'vitest';
import { assertNoContamination, findContamination, ContaminationError } from '@elconv/core';

describe('assertNoContamination', () => {
  it('passes clean V3 tree', () => {
    const v3Tree = [{ id: '1', elType: 'container', settings: {} }];
    expect(() => assertNoContamination(v3Tree, 'v3')).not.toThrow();
  });

  it('throws on V4 marker in V3 tree', () => {
    const badTree = [{ id: '1', type: 'e-flexbox', settings: { '$$type': 'size' } }];
    expect(() => assertNoContamination(badTree, 'v3')).toThrow(ContaminationError);
  });

  it('passes clean V4 tree', () => {
    const v4Tree = [{ id: '1', type: 'e-flexbox', elType: 'e-flexbox', settings: {} }];
    expect(() => assertNoContamination(v4Tree, 'v4')).not.toThrow();
  });

  it('throws on V3 marker in V4 tree', () => {
    const badTree = [{ id: '1', elType: 'container', isInner: true }];
    expect(() => assertNoContamination(badTree, 'v4')).toThrow(ContaminationError);
  });

  it('findContamination returns list', () => {
    const badTree = [{ '$$type': 'color', 'e-flexbox': true }];
    const violations = findContamination(badTree, 'v3');
    expect(violations).toContain('$$type');
    expect(violations).toContain('e-flexbox');
  });
});
```

`tests/unit/core/guards.test.ts`:
```typescript
import { describe, it, expect } from 'vitest';
import { runGuards, formatGuardReport, type Guard } from '@elconv/core';

const alwaysPass: Guard<unknown[]> = {
  name: 'always-pass',
  severity: 'critical',
  check: () => ({ passed: true, message: 'ok' }),
};

const alwaysFail: Guard<unknown[]> = {
  name: 'always-fail',
  severity: 'critical',
  check: () => ({ passed: false, message: 'broken' }),
};

const warnFail: Guard<unknown[]> = {
  name: 'warn-fail',
  severity: 'warning',
  check: () => ({ passed: false, message: 'minor issue' }),
};

describe('runGuards', () => {
  it('all pass → score 100, passed true', () => {
    const report = runGuards([], [alwaysPass]);
    expect(report.score).toBe(100);
    expect(report.passed).toBe(true);
  });

  it('critical fail → score 80, passed false', () => {
    const report = runGuards([], [alwaysFail]);
    expect(report.score).toBe(80);
    expect(report.passed).toBe(false);
  });

  it('warning fail → score 95, passed true (above 85)', () => {
    const report = runGuards([], [warnFail]);
    expect(report.score).toBe(95);
    expect(report.passed).toBe(true);
  });

  it('formatGuardReport contains score', () => {
    const report = runGuards([], [alwaysFail]);
    const text = formatGuardReport(report);
    expect(text).toContain('80/100');
    expect(text).toContain('FAILED');
  });
});
```

### DoD Phase 1

```
[ ] packages/core/src/ enthält: types.ts, branded-types.ts, contamination.ts, guards.ts, deploy-strategy.ts, pipeline-state.ts, errors.ts, index.ts
[ ] Tests: contamination + guards + deploy-strategy + pipeline-state → grün
[ ] npx tsc --noEmit → exit 0
[ ] Commit: feat(core): branded types, contamination guard, guard runner, deploy strategy
```

---

## 6. Phase 2 — MCP Transport

### Ziel
JSON-RPC 2.0 Adapter zu Novamira MCP, Circuit Breaker, Named Targets.

### 6.1 `packages/mcp/src/adapter.ts`

Portiere aus `site-clone-to-v3/src/mcp/mcp-adapter.ts`:
- `McpAdapter` class mit `call()`, `callTool()`, `executeAbility()`, `listAbilities()`
- Retry mit exponential backoff
- Session-ID tracking
- Timeout handling

**Änderungen gegenüber Quelle:**
- Package-Name: `@elconv/mcp`
- Import `undici` für HTTP
- Export als named exports

### 6.2 `packages/mcp/src/circuit-breaker.ts`

Portiere aus `Framer-to-Elementor-V4-Pipeline/src/lib/circuit-breaker.ts`:
- States: CLOSED → OPEN → HALF_OPEN
- Configurable threshold + reset timeout

### 6.3 `packages/mcp/src/targets.ts`

```typescript
/**
 * Named WordPress targets stored in ~/.config/elconv/targets.json
 * Auth ONLY via environment variable name — never store passwords.
 */

export interface WpTarget {
  mcpEndpoint: string;
  authEnv: string;  // Name of env var containing "user:app-password"
  defaultTemplate: 'elementor_canvas' | 'elementor_header_footer' | 'default';
  label?: string;
}

export interface TargetStore {
  targets: Record<string, WpTarget>;
}

export function loadTargets(configPath?: string): TargetStore;
export function saveTargets(store: TargetStore, configPath?: string): void;
export function getTarget(name: string, configPath?: string): WpTarget;
export function resolveAuth(target: WpTarget): string; // reads process.env[target.authEnv]
```

### 6.4 `packages/mcp/src/abilities.ts`

Typed wrappers für Novamira Abilities:

```typescript
export async function injectCalibratedPage(adapter, params: {
  post_id: number;
  _elementor_data: unknown[];
  elementor_version: string;
  wp_page_template: string;
}): Promise<{ post_id: number; permalink: string }>;

export async function batchBuildPage(adapter, params: {
  content: unknown[];
  post_id?: number;
  title?: string;
}): Promise<{ post_id: number; permalink: string }>;

export async function executePhp(adapter, code: string): Promise<string>;
export async function setupV4Foundation(adapter): Promise<V4FoundationData>;
export async function listVariables(adapter): Promise<VariableEntry[]>;
export async function listGlobalClasses(adapter): Promise<GlobalClassEntry[]>;
export async function clearDocumentCache(adapter, postIds: number[]): Promise<void>;
```

### DoD Phase 2

```
[ ] McpAdapter mit retry + circuit breaker
[ ] targets.ts load/save/get + tests (temp dir)
[ ] abilities.ts typed wrappers (mock tests)
[ ] Commit: feat(mcp): adapter, circuit breaker, targets, typed abilities
```

---

## 7. Phase 3 — Target-V3 Builder

### Ziel
SourceSpec → V3Element[] mit Container Normalize + V3 Guards.

### 7.1 `packages/target-v3/src/types.ts` (EXAKT)

```typescript
/**
 * Elementor V3 element types.
 * KRITISCH: Diese Types dürfen NIEMALS $$type, e-flexbox, etc. enthalten.
 */

export interface V3Element {
  id: string;
  elType: 'section' | 'column' | 'widget' | 'container';
  settings?: Record<string, unknown>;
  elements?: V3Element[];
  widgetType?: string;
  isInner?: boolean;
}

export interface V3PageData {
  title: string;
  status: 'publish' | 'draft';
  type: 'page';
  content: V3Element[];
  version: string;
  metadata: {
    generatedAt: string;
    sourceUrl: string;
    sectionCount: number;
    widgetCount: number;
  };
}
```

### 7.2 `packages/target-v3/src/normalize.ts`

Portiere aus `site-clone-to-v3/src/builder/v3-container-normalize.ts`:
- `normalizeV3ContainerTree(tree)` → fixes isInner + flex-row widths
- `findNestedContainersMissingIsInner(tree)` → list of IDs
- `findFlexRowStackRisks(tree)` → list of IDs

### 7.3 `packages/target-v3/src/guards.ts`

Portiere aus `site-clone-to-v3/src/validator/json-guard.ts` (NUR V3_GUARDS):
- G1: unique-ids (critical)
- G2: no-orphan-columns (critical)
- G3: widget-required-settings (warning)
- G4: breakpoint-coverage (warning)
- G5: image-url-present (warning)
- G6c: nested-container-is-inner (warning)
- G7c: flex-row-child-width (warning)

**NEU hinzufügen (aus Umbauplan Phase B):**
- G_ELTYPE: unbekannte elType/widgetType (critical)
- G_HTML_EMPTY: html widget mit leerem html (warning)
- G_TREE_SIZE: JSON > 900k warn, > 1.5M error
- G_NO_V4: tree enthält e-flexbox/$$type (critical) — **Anti-Contamination**
- G_HTML_BUDGET: htmlWidgetCount/totalWidgets > 0.15 (warning)
- G_HTML_HAS_IMG: html widget enthält `<img` (critical)

### 7.4 `packages/target-v3/src/builder.ts`

```typescript
import type { SourceSpec, SectionSpec, WidgetSpec } from '@elconv/core';
import type { V3Element, V3PageData } from './types.js';

/**
 * Convert a version-agnostic SourceSpec into a V3 element tree.
 * KRITISCH: Output enthält NUR V3-Typen (container, section, column, widget).
 * NIEMALS e-flexbox, $$type, oder andere V4-Konstrukte.
 */
export function buildV3Tree(spec: SourceSpec): V3Element[];
export function buildV3PageData(spec: SourceSpec, title?: string): V3PageData;
```

**Widget-Mapping (BINDEND):**

| SourceSpec WidgetType | V3 widgetType |
|---|---|
| heading | `heading` |
| text | `text-editor` |
| image | `image` |
| button | `button` |
| icon | `icon` oder `icon-box` |
| video | `video` |
| divider | `divider` |
| spacer | `spacer` |
| html | `html` |
| form | `form` |
| accordion | `accordion` |
| container | `container` (nested) |

### DoD Phase 3

```
[ ] V3Element types + builder + normalize + 13 guards
[ ] Tests: builder produces valid V3 from fixture SourceSpec
[ ] Tests: normalize fixes isInner + flex-row
[ ] Tests: guards catch V4 contamination (G_NO_V4)
[ ] Commit: feat(target-v3): builder, normalize, scored guards
```

---

## 8. Phase 4 — Target-V4 Builder

### Ziel
SourceSpec → V4TreeNode[] mit $$type Wrappern + V4 Guards.

### 8.1 `packages/target-v4/src/types.ts` (EXAKT)

```typescript
/**
 * Elementor V4 Atomic types.
 * KRITISCH: Diese Types verwenden $$type Envelopes und styles{} maps.
 * NIEMALS elType: 'container' oder 'section' als finaler V4-Output.
 */

export interface V4TreeNode {
  type: string;           // e-flexbox, e-heading, e-button, etc.
  elType: string;         // same as type for containers, 'widget' for widgets
  widgetType: string;     // same as type
  id: string;
  settings: Record<string, unknown>;  // contains $$type wrapped values
  styles: Record<string, V4StyleClass>;  // style-id → class definition
  elements?: V4TreeNode[];
}

export interface V4StyleClass {
  id: string;
  label: string;
  type: string;  // 'class'
  variants: V4StyleVariant[];
}

export interface V4StyleVariant {
  meta: { breakpoint: string | null; state: string | null };
  props: Record<string, unknown>;  // $$type wrapped CSS props
  custom_css: unknown;
}

// $$type wrapper types
export interface TypedValue { '$$type': string; value: unknown; }
export interface TypedSize { '$$type': 'size'; value: { size: number; unit: string }; }
export interface TypedColor { '$$type': 'color'; value: string; }
export interface TypedClasses { '$$type': 'classes'; value: string[]; }
```

### 8.2 `packages/target-v4/src/framer-utils.ts`

Portiere aus `Framer-to-Elementor-V4-Pipeline/src/converter/framer-utils.ts`:
- `wrapType()`, `wrapSize()`, `wrapColor()`, `wrapDimensions()`, `wrapBorderRadius()`
- `wrapClasses()`, `wrapImageSrc()`, `wrapImage()`, `wrapHtmlContent()`
- `wrapGvColor()`, `wrapGvFont()`
- `normalizeHex()`, `rgbToHex()`, `hexToRgb()`
- `generateStyleId()`, `isValidStyleId()`, `sanitizeStyleId()`
- `walkTree()`, `findNodesByType()`, `structuralHash()`

### 8.3 `packages/target-v4/src/guards.ts`

Portiere aus `site-clone-to-v3/src/validator/json-guard.ts` (NUR V4_GUARDS) + V4-Pipeline Guards:
- G6: valid-dollar-type (critical)
- G7: no-hyphen-in-class (critical)
- G8: max-dom-depth ≤ 4 (warning)
- G9: no-empty-class (warning)
- G10: known-atomic-type (warning)
- G11: style-classes-binding (warning)
- G12: image-src-format (warning)

**NEU hinzufügen:**
- G_NO_V3: tree enthält elType container/section/column (critical) — **Anti-Contamination**
- G_GC_BOUND: Global Classes referenced but not in styles{} (warning)
- G_STYLE_ID_VALID: all style IDs match `/^[a-z][a-z0-9_]*$/` (critical)

### 8.4 `packages/target-v4/src/builder.ts`

```typescript
import type { SourceSpec } from '@elconv/core';
import type { V4TreeNode } from './types.js';

/**
 * Convert a version-agnostic SourceSpec into a V4 Atomic tree.
 * KRITISCH: Output enthält NUR V4-Typen (e-flexbox, e-heading, etc.)
 * mit $$type wrapped settings und styles{} maps.
 * NIEMALS elType: 'container' oder V3 widget names.
 */
export function buildV4Tree(spec: SourceSpec): V4TreeNode[];
```

**Widget-Mapping (BINDEND):**

| SourceSpec WidgetType | V4 type |
|---|---|
| heading | `e-heading` |
| text | `e-paragraph` oder `e-text` |
| image | `e-image` |
| button | `e-button` |
| icon | `e-icon` |
| video | `e-video` |
| divider | `e-divider` |
| spacer | `e-spacer` |
| html | `e-html` |
| form | `e-form` |
| container | `e-flexbox` oder `e-div-block` |

### DoD Phase 4

```
[ ] V4TreeNode types + builder + framer-utils + 10 guards
[ ] Tests: builder produces valid V4 from fixture SourceSpec
[ ] Tests: $$type wrappers produce correct envelopes
[ ] Tests: guards catch V3 contamination (G_NO_V3)
[ ] Tests: isValidStyleId rejects hyphens
[ ] Commit: feat(target-v4): builder, $$type wrappers, scored guards
```

---

## 9. Phase 5 — Extractors

### Ziel
Playwright (any-URL) + Framer XML + CSS-Fallback → SourceSpec.

### 9.1 Playwright Extractor (aus site-clone)

Portiere **Ideen** aus:
- `site-clone-to-v3/src/extractor/playwright-extractor.ts`
- `site-clone-to-v3/src/extractor/section-detector.ts`
- `site-clone-to-v3/src/extractor/computed-styles.ts`

Output: `SourceSpec` mit `source.type = 'url'`.

### 9.2 Framer XML Extractor (aus V4-Pipeline)

Portiere **Ideen** aus:
- `Framer-to-Elementor-V4-Pipeline/scripts/convert-xml-to-v4.ts` (XML parsing)
- `Framer-to-Elementor-V4-Pipeline/src/extractor/unframer-bridge.ts`

Output: `SourceSpec` mit `source.type = 'framer-xml'`.

### 9.3 CSS-Fallback (aus V4-Pipeline)

Portiere aus: `Framer-to-Elementor-V4-Pipeline/scripts/css-fallback-extractor.ts`

Füllt `SourceSpec.cssVars` wenn style-map leer.

### DoD Phase 5

```
[ ] Playwright extractor: URL → SourceSpec (mock browser in tests)
[ ] Framer XML extractor: XML file → SourceSpec
[ ] CSS fallback: fills empty cssVars
[ ] project-match check: hostname mismatch → fail
[ ] Commit: feat(extractors): playwright, framer-xml, css-fallback
```

---

## 10. Phase 6 — CLI Surface

### Ziel
Einheitliches `npx elconv` mit target-Routing.

### 10.1 CLI-Struktur (EXAKT)

```bash
npx elconv convert --target v3 --url https://example.framer.app [--out ./out/v3-tree.json]
npx elconv convert --target v4 --xml ./framer-export/homepage.xml [--out ./out/v4-tree.json]
npx elconv convert --target v3 --html ./FramerExport/index.html

npx elconv doctor --target v3 [--mcp-url ...] [--tree ./page.json]
npx elconv doctor --target v4 [--mcp-url ...] [--tree ./page.json]

npx elconv deploy --target v3 --tree ./v3-tree.json --post-id 42 [--strategy auto] [--dry-run]
npx elconv deploy --target v4 --tree ./v4-tree.json --post-id 42 [--execute]

npx elconv qa --url https://wp-site.test/page/ [--ref-url https://framer.app/] [--section hero]

npx elconv session-init --target v3 --source-url https://... [--post-id 42]
npx elconv target add|list|remove
```

### 10.2 KRITISCH: Target-Routing

```typescript
// packages/cli/src/cmd-convert.ts
import { buildV3Tree } from '@elconv/target-v3';
import { buildV4Tree } from '@elconv/target-v4';
import { assertNoContamination } from '@elconv/core';

export async function cmdConvert(opts: {
  target: 'v3' | 'v4';
  url?: string;
  xml?: string;
  html?: string;
  out?: string;
}): Promise<void> {
  // 1. Extract → SourceSpec
  const spec = await extract(opts);

  // 2. Build target-specific tree
  let tree: unknown[];
  if (opts.target === 'v3') {
    tree = buildV3Tree(spec);
  } else {
    tree = buildV4Tree(spec);
  }

  // 3. ANTI-CONTAMINATION CHECK (KRITISCH — immer ausführen!)
  assertNoContamination(tree, opts.target);

  // 4. Run target guards
  // 5. Write output
}
```

### 10.3 Exit Codes (BINDEND)

- `0` — success
- `1` — guard failure / contamination / deploy error
- `2` — usage error (missing flags, invalid target)

### DoD Phase 6

```
[ ] elconv --help lists all subcommands
[ ] convert --target v3 with fixture → valid V3 JSON
[ ] convert --target v4 with fixture → valid V4 JSON
[ ] doctor --target v3 runs preflight checks
[ ] Exit codes correct
[ ] Commit: feat(cli): unified elconv with convert, doctor, deploy, qa
```

---

## 11. Phase 7 — Deploy Infrastructure

### Ziel
Large-tree deploy, rollback, smoke-check. Target-agnostic transport.

### 11.1 Deploy-Algorithmus (EXAKT — für beide Targets gleich)

```
1. Load tree JSON
2. Run target guards (V3 or V4 depending on --target)
3. assertNoContamination(tree, target)
4. if !report.passed && !--force → exit 1
5. if --dry-run → print report + byte size + strategy + exit 0
6. strategy = chooseDeployStrategy(bytes, --strategy)
7. rollback.backup(postId) → write backup-dir/post-{id}-{ts}.json
8. Execute strategy:
   A) direct:
      V3: injectCalibratedPage(adapter, { post_id, _elementor_data: tree })
      V4: batchBuildPage(adapter, { content: tree, post_id })
   B) upload-php:
      Upload JSON file → execute PHP: json_decode → update_post_meta
   C) split:
      Split top-level sections → deploy chunk by chunk
9. Clear cache: elementor-clear-document-cache { post_ids: [postId] }
10. Smoke-check if --smoke-url given
11. stdout JSON summary
```

### 11.2 V3 vs V4 Deploy-Unterschiede (KRITISCH)

| Aspekt | V3 | V4 |
|---|---|---|
| Ability | `elementor-inject-calibrated-page` | `batch-build-page` |
| Payload-Key | `_elementor_data` | `content` |
| Normalize | `normalizeV3ContainerTree()` vor Push | Keine V3-Normalize! |
| Post-Deploy | Clear element cache | CSS cache rebuild + verify-build-binding |
| Template | `elementor_canvas` | `elementor_canvas` |

### DoD Phase 7

```
[ ] deploy-tree dry-run + unit tests
[ ] strategy selection tests (thresholds)
[ ] rollback backup/restore (mock)
[ ] smoke-check (mock HTTP)
[ ] Commit: feat(mcp): deploy infrastructure with large-tree and rollback
```

---

## 12. Phase 8 — Preflight Suite

### Ziel
Immer vor build/deploy: harte Fehler früh erkennen.

### 12.1 Checks (target-aware)

| Check ID | Was | V3 | V4 |
|---|---|---|---|
| `mcp_reachable` | MCP greet | fail | fail |
| `mcp_elementor` | set-content ability exists | fail | fail |
| `tree_parse` | JSON parse + guards | fail if <85 | fail if <85 |
| `tree_size` | byte size | warn/fail | warn/fail |
| `project_match` | hostname vs source URL | fail | fail |
| `v4_experiments` | Elementor V4 experiments active | **warn only** | **fail** |
| `unframer_reachable` | Unframer connectivity | skip | warn |
| `global_classes` | GC exist on site | skip | **fail** |
| `contamination` | assertNoContamination | fail | fail |

### DoD Phase 8

```
[ ] run-all orchestrator with typed PreflightReport
[ ] doctor CLI uses run-all
[ ] --skip-preflight flag for power users
[ ] Commit: feat(mcp): always-on preflight with target-aware checks
```

---

## 13. Phasen 9–18 (Kurzfassung)

### Phase 9 — V3 Patterns
Widget-first: glass-header, stat-row, orbit-cluster, marquee-row, service-cards.  
**Regel:** Native widgets (image/heading/button), HTML nur ≤15% Budget.

### Phase 10 — V4 Patterns
Atomic: glass-header, stat-row, orbit-cluster.  
**Regel:** e-flexbox + $$type styles + GC candidates. EIGENE Implementierung (nicht von V3 kopieren!).

### Phase 11 — QA Infrastructure
visual-diff (pixelmatch), structural probes (shared IDs), section-compare, viewport-matrix (1440/768/390), HTML report.

### Phase 12 — Session + Pipeline State
`elconv session-init`, state.v3.json, resume-fähige Runs.

### Phase 13 — WPCode + Animation
Page-scoped snippets, dual-write (post_content + wpcode_snippets), GSAP presets.

### Phase 14 — Bridge (V3 → V4)
`elconv bridge --input v3-tree.json --out v4-tree.json`  
Upgrade: heading→e-heading, button→e-button, container→e-flexbox.  
Validiere mit V4 guards ≥85.

### Phase 15 — Config System
`elconv.config.yaml` mit sourceUrl, target, mode, tokens, deploy, qa settings.

### Phase 16 — Skills + Docs
Getrennte Skills für V3 und V4. AI-Executor-Playbook. ARCHITECTURE.md.

### Phase 17 — E2E Fixtures
Offline tests: fixture SourceSpec → V3 tree → guards ≥85.  
Offline tests: fixture XML → V4 tree → guards ≥85.

### Phase 18 — Final Freeze
Version 0.1.0, CHANGELOG, README, alle Tests grün, `npx tsc --noEmit` clean.

---

## 14. KRITISCHE FEHLERSTELLEN (Highest Priority)

### 14.1 V3/V4 Contamination (KRITISCHSTE Stelle)

**Problem:** Eine KI baut einen V3-Tree und nutzt versehentlich `e-flexbox` statt `container`.  
**Verteidigung (3 Ebenen):**
1. **Compile-time:** Branded types — `V3ElementTree` ≠ `V4ElementTree`
2. **Runtime:** `assertNoContamination()` vor JEDEM deploy
3. **Guard:** `G_NO_V4` in V3 guards, `G_NO_V3` in V4 guards

**Test-Pflicht:** Jeder Target-Test MUSS einen Contamination-Test enthalten.

### 14.2 MCP Payload-Limits

**Problem:** Trees > 400KB schlagen bei `set-content` / `inject-calibrated-page` still fehl.  
**Verteidigung:** `chooseDeployStrategy()` + `G_TREE_SIZE` guard warnt ab 900KB.

### 14.3 V3 isInner / Flex-Row Stacking

**Problem:** Nested containers ohne `isInner: true` rendern als full-width Blöcke.  
**Verteidigung:** `normalizeV3ContainerTree()` läuft IMMER vor deploy (außer `--skip-normalize`).

### 14.4 V4 Style-ID Format

**Problem:** Style-IDs mit Bindestrichen werden von Elementor V4 abgelehnt.  
**Verteidigung:** `isValidStyleId()` + `G7:no-hyphen-in-class` guard + `sanitizeStyleId()` auto-fix.

### 14.5 WPCode Dual-Write

**Problem:** Nur `post_content` aktualisiert → live site zeigt altes CSS.  
**Verteidigung:** WPCode helper updated IMMER beide (post_content + wpcode_snippets option).

### 14.6 Elementor Cache

**Problem:** Erfolgreicher MCP write ≠ sichtbares Ergebnis.  
**Verteidigung:** Nach JEDEM deploy: `clearDocumentCache(postIds)` + Hinweis auf hard reload.

---

## 15. Teststrategie

### 15.1 Unit Tests (pro Phase)

Jede Phase hat eigene Tests in `tests/unit/<package>/`.  
**Pflicht-Coverage:**
- Contamination checks (beide Richtungen)
- Guard scoring (pass/fail/threshold)
- Builder output shape (V3 vs V4)
- Deploy strategy thresholds
- Style-ID validation

### 15.2 Integration Tests

`tests/integration/v3-pipeline.test.ts`:
```
fixture SourceSpec → buildV3Tree → normalize → runV3Guards → score ≥ 85
→ assertNoContamination(tree, 'v3') → no throw
```

`tests/integration/v4-pipeline.test.ts`:
```
fixture SourceSpec → buildV4Tree → runV4Guards → score ≥ 85
→ assertNoContamination(tree, 'v4') → no throw
```

### 15.3 E2E Offline Tests

Kein Netzwerk. Fixture XML/JSON → full pipeline → valid output.

### 15.4 Contamination Cross-Tests (BINDEND)

```typescript
// tests/unit/core/cross-contamination.test.ts
it('V3 builder output never contains V4 markers', () => {
  const spec = loadFixture('simple-landing.json');
  const tree = buildV3Tree(spec);
  expect(findContamination(tree, 'v3')).toEqual([]);
});

it('V4 builder output never contains V3 markers', () => {
  const spec = loadFixture('simple-landing.json');
  const tree = buildV4Tree(spec);
  expect(findContamination(tree, 'v4')).toEqual([]);
});
```

---

## 16. Konfiguration für Nutzer

### 16.1 `elconv.config.yaml` (Phase 15)

```yaml
version: 1
sourceUrl: https://example.framer.app/
target: v3          # v3 | v4 — BINDEND für alle Befehle
mode: hybrid        # framer-fidelity | hybrid | blueprint
truth: screenshots  # screenshots | blueprint | framer-export

tokens:
  primary: "#09292B"
  fontHeading: "Lora"

deploy:
  strategy: auto    # auto | direct | upload-php | split
  smokeMustContain: ["ch-header-inner", "stats-row"]
  backupDir: ./research/_backups

qa:
  checklist: fixtures/qa/checklist-default.json
  viewports: [1440, 768, 390]
  passPct: 85
```

### 16.2 Target-Wahl (KRITISCH für Nutzer)

Das Target wird **einmal** gewählt und gilt für die gesamte Session:
- `elconv.config.yaml` → `target: v3` oder `target: v4`
- CLI override: `--target v3` / `--target v4`
- **NIEMALS** kann ein Befehl beide Targets gleichzeitig bedienen

---

## 17. Was aus den Umbauplänen übernommen wird

### Aus UMBAUPLAN-FRAMER-V3 (site-clone-to-v3):

| V3-Phase | → Unified Phase | Was |
|---|---|---|
| B Guards score | Phase 3 | Score-System + G_NO_V4 + G_HTML_BUDGET |
| C Preflight | Phase 8 | Doctor CLI + checks |
| D Deploy large-tree | Phase 7 | Strategy + rollback + smoke |
| E Patterns | Phase 9 | Widget-first generators |
| F QA gate | Phase 11 | Screenshot gate + probes |
| G Session state | Phase 12 | Pipeline state v3 |
| H Dual-source | Phase 5 | Unframer + CSS-fallback |
| I Assets | Phase 7 (deploy) | Media-ID patch |
| J Autofix | Phase 11 (qa) | Post-build fix allowlist |
| K WPCode | Phase 13 | Page-scope + GSAP |
| L Mobile matrix | Phase 11 | Viewport matrix |
| M clone.config | Phase 15 | elconv.config.yaml |

### Aus UMBAUPLAN-V4-PIPELINE-HARDENING (V4-Pipeline):

| V4-Phase | → Unified Phase | Was |
|---|---|---|
| V1 CLI surface | Phase 6 | Unified elconv bin |
| V2 One-shot build | Phase 6 | convert command |
| V3 Preflight always-on | Phase 8 | run-all + policy matrix |
| V4 Bridge ingest | Phase 14 | V3→V4 upgrade |
| V5 Large-tree deploy | Phase 7 | Strategy + --execute |
| V6 Patterns | Phase 10 | Atomic patterns |
| V7 Unified QA | Phase 11 | Report schema + probes |
| V8 Animations | Phase 13 | Extract + inject |
| V9 Schema drift | Phase 17 | CI check |
| V10 Targets | Phase 2 | Named targets |
| V11 Docs freeze | Phase 16 | SSOT + skills |
| V12 E2E + release | Phase 17+18 | Fixtures + 0.1.0 |

---

## 18. Progress-Tabelle

| Phase | Status | Commit | Date | Notes |
|------|--------|--------|------|-------|
| 0 Repo setup | pending | | | |
| 1 Core kernel | pending | | | |
| 2 MCP transport | pending | | | |
| 3 Target-V3 | pending | | | |
| 4 Target-V4 | pending | | | |
| 5 Extractors | pending | | | |
| 6 CLI surface | pending | | | |
| 7 Deploy infra | pending | | | |
| 8 Preflight | pending | | | |
| 9 V3 patterns | pending | | | |
| 10 V4 patterns | pending | | | |
| 11 QA infra | pending | | | |
| 12 Session state | pending | | | |
| 13 WPCode + anim | pending | | | |
| 14 Bridge V3→V4 | pending | | | |
| 15 Config system | pending | | | |
| 16 Skills + docs | pending | | | |
| 17 E2E fixtures | pending | | | |
| 18 Freeze 0.1.0 | pending | | | |

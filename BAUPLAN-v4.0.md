# BAUPLAN v4.0 — Production Hardening & Architecture Completion

> **Status:** Geplant  
> **Phasen:** 75–99 (25 Phasen)  
> **Ziel:** Alle 10 Verbesserungen vollständig implementieren  
> **Repo:** `unified-elementor-converter` Monorepo  
> **Vorher:** BAUPLAN v3.0 (Phasen 59–74) abgeschlossen, Commit `59d4edb`

---

## Inhaltsverzeichnis

1. [Verbesserung 1: Cross-Package Import Repair + TS Project References](#v1)
2. [Verbesserung 2: GitHub Actions CI Pipeline](#v2)
3. [Verbesserung 3: WordPress Snapshot/Rollback](#v3)
4. [Verbesserung 4: MCP Circuit Breaker + Health Monitor](#v4)
5. [Verbesserung 5: Configuration Schema Validation (Zod)](#v5)
6. [Verbesserung 6: Intelligent Fix-Learning](#v6)
7. [Verbesserung 7: Plugin Compatibility Pre-Flight](#v7)
8. [Verbesserung 8: Streaming Progress + ETA](#v8)
9. [Verbesserung 9: Visual Regression Pixel-Diff](#v9)
10. [Verbesserung 10: Multi-Page Batch Orchestrator](#v10)

---

<a name="v1"></a>
## Verbesserung 1: Cross-Package Import Repair + TypeScript Project References

### Phase 75: Import-Pfad-Analyse und Mapping-Tabelle

**Ziel:** Alle fehlerhaften relativen Imports in den 237 portierten Dateien identifizieren und eine vollständige Mapping-Tabelle erstellen.

**Dateien:**
- `scripts/analyze-imports.ts` — Neues Analyse-Skript
- `docs/IMPORT-MAPPING.md` — Mapping-Dokumentation

**Implementierung:**

```typescript
// scripts/analyze-imports.ts
import { readdir, readFile } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';

interface ImportIssue {
  file: string;
  line: number;
  importPath: string;
  resolvedTarget: string | null;
  suggestedFix: string;
  targetPackage: string;
}

const PACKAGE_MAP: Record<string, string> = {
  'packages/core/src': '@elconv/core',
  'packages/extractors/src': '@elconv/extractors',
  'packages/target-v3/src': '@elconv/target-v3',
  'packages/target-v4/src': '@elconv/target-v4',
  'packages/mcp/src': '@elconv/mcp',
  'packages/qa/src': '@elconv/qa',
  'packages/cli/src': '@elconv/cli',
  'packages/framer-export/src': '@elconv/framer-export',
};

// Scanne alle .ts Dateien, extrahiere import/export-from Statements
// Prüfe ob relativer Pfad die Package-Grenze überschreitet
// Generiere Korrektur-Vorschläge
```

**Kategorien von Import-Fehlern:**

| Fehler-Typ | Beispiel | Fix |
|---|---|---|
| Cross-Package relativ | `target-v3/src/auto-fix-loop.ts` → `../qa/geometry-probe.js` | `@elconv/qa` |
| Intra-Package falsch | `core/src/lib/wpcode-adapter.ts` → `../analysis/pipeline.js` | `../analysis/pipeline.js` (OK) |
| Fehlende Extension | `import { x } from './module'` | `./module.js` |
| V3→V4 Cross-Import | `target-v3/src/x.ts` → `../../target-v4/src/y.js` | **VERBOTEN** — Shared extrahieren |

**Akzeptanz:**
- [ ] Alle `.ts`-Dateien gescannt
- [ ] Jeder Import klassifiziert (OK / Cross-Package / Forbidden)
- [ ] JSON-Report mit allen Issues generiert

---

### Phase 76: Cross-Package Imports reparieren (Core + Extractors)

**Ziel:** Alle Import-Pfade in `packages/core/` und `packages/extractors/` korrigieren.

**Betroffene Dateien (Core):**
- `packages/core/src/analysis/font-kit-bridge.ts`
- `packages/core/src/analysis/token-sync.ts`
- `packages/core/src/analysis/pipeline.ts`
- `packages/core/src/lib/fonts-plugin-adapter.ts`
- `packages/core/src/lib/source-auth.ts`
- `packages/core/src/lib/wpcode-adapter.ts`
- `packages/core/src/lib/wp-target.ts`
- `packages/core/src/orchestrator/manager-workflow.ts`
- `packages/core/src/orchestrator/phase-orchestrator.ts`
- `packages/core/src/orchestrator/run-report.ts`
- `packages/core/src/validator/index.ts`

**Betroffene Dateien (Extractors):**
- `packages/extractors/src/browser/background-image-parser.ts`
- `packages/extractors/src/browser/browserbase-extractor.ts`
- `packages/extractors/src/browser/font-loading-state.ts`
- `packages/extractors/src/browser/framer-data-extractor.ts`
- `packages/extractors/src/framer/unframer-bridge.ts`

**Regel:** Innerhalb eines Packages bleiben relative Pfade. Cross-Package wird durch `@elconv/<package>` ersetzt.

**Akzeptanz:**
- [ ] `tsc --noEmit -p packages/core/tsconfig.json` — 0 Fehler
- [ ] `tsc --noEmit -p packages/extractors/tsconfig.json` — 0 Fehler

---

### Phase 77: Cross-Package Imports reparieren (Target-V3 + Target-V4)

**Ziel:** Alle Import-Pfade in `packages/target-v3/` und `packages/target-v4/` korrigieren.

**Betroffene Dateien (Target-V3):**
- `packages/target-v3/src/auto-fix-loop.ts` → importiert aus `@elconv/qa`
- `packages/target-v3/src/framer-build-orchestrator.ts` → importiert aus `@elconv/core`, `@elconv/extractors`
- `packages/target-v3/src/framer-image-uploader.ts` → importiert aus `@elconv/mcp`
- `packages/target-v3/src/framer-link-wirer.ts` → importiert aus `@elconv/core`
- `packages/target-v3/src/responsive-breakpoint-mapper.ts`
- `packages/target-v3/src/run-report-generator.ts` → importiert aus `@elconv/core`
- `packages/target-v3/src/setting-first-css-generator.ts`
- `packages/target-v3/src/v3-container-normalize.ts`
- `packages/target-v3/src/v3-tree-types.ts`
- `packages/target-v3/src/framer-animation-detector.ts`

**Betroffene Dateien (Target-V4):**
- `packages/target-v4/src/v4-tree-builder.ts`
- `packages/target-v4/src/mcp-bridge-v4.ts`
- `packages/target-v4/src/types-*.ts` (6 Dateien)

**V3/V4 Isolation prüfen:**
```bash
# Kein V3-File darf aus target-v4 importieren und umgekehrt
grep -r "target-v4" packages/target-v3/src/ # muss leer sein
grep -r "target-v3" packages/target-v4/src/ # muss leer sein
```

**Akzeptanz:**
- [ ] `tsc --noEmit -p packages/target-v3/tsconfig.json` — 0 Fehler
- [ ] `tsc --noEmit -p packages/target-v4/tsconfig.json` — 0 Fehler
- [ ] V3/V4 Isolation bestätigt (0 Cross-Imports)

---

### Phase 78: Cross-Package Imports reparieren (MCP + QA + CLI)

**Ziel:** Alle Import-Pfade in `packages/mcp/`, `packages/qa/`, `packages/cli/` korrigieren.

**Betroffene Dateien (MCP):**
- `packages/mcp/src/convert-page-v3-to-v4.ts`
- `packages/mcp/src/phase10-call-orchestrator.ts`
- `packages/mcp/src/phase10-indirection.ts`
- `packages/mcp/src/phase10-session.ts`
- `packages/mcp/src/upgrade-v4.ts`

**Betroffene Dateien (QA):**
- `packages/qa/src/acceptance.ts`
- `packages/qa/src/browserbase-capture.ts`
- `packages/qa/src/cross-validator.ts`
- `packages/qa/src/phase8-batched-fix.ts`
- `packages/qa/src/phase8-issue-types.ts`
- `packages/qa/src/phase8-render-capture.ts`
- `packages/qa/src/structure-diff.ts`
- `packages/qa/src/v3v4-report.ts`
- `packages/qa/src/visual-capture.ts`

**Betroffene Dateien (CLI — 29 Dateien):**
- Alle V3-CLI: `clone-v3.ts`, `clone.ts`, `wizard.ts`, `incremental.ts`, etc.
- Alle V4-CLI: `v4-build-report.ts`, `v4-cmd-batch.ts`, etc.
- Shared: `pipeline-runner.ts`, `state-manager.ts`, `prompts.ts`

**Akzeptanz:**
- [ ] `tsc --noEmit -p packages/mcp/tsconfig.json` — 0 Fehler
- [ ] `tsc --noEmit -p packages/qa/tsconfig.json` — 0 Fehler
- [ ] `tsc --noEmit -p packages/cli/tsconfig.json` — 0 Fehler

---

### Phase 79: TypeScript Project References + Composite Build

**Ziel:** Monorepo-weites `tsc --build` mit inkrementeller Kompilierung.

**Dateien:**
- `tsconfig.base.json` — Gemeinsame Compiler-Optionen
- `tsconfig.json` (Root) — Solution-File mit References
- `packages/*/tsconfig.json` — Pro Package mit `composite: true`

**Root tsconfig.json:**
```json
{
  "files": [],
  "references": [
    { "path": "packages/core" },
    { "path": "packages/extractors" },
    { "path": "packages/target-v3" },
    { "path": "packages/target-v4" },
    { "path": "packages/mcp" },
    { "path": "packages/qa" },
    { "path": "packages/cli" },
    { "path": "packages/framer-export" }
  ]
}
```

**tsconfig.base.json:**
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true,
    "composite": true,
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "outDir": "dist",
    "rootDir": "src"
  }
}
```

**Package tsconfig.json (Beispiel packages/target-v3):**
```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "dist",
    "rootDir": "src"
  },
  "include": ["src/**/*.ts"],
  "references": [
    { "path": "../core" },
    { "path": "../extractors" },
    { "path": "../mcp" },
    { "path": "../qa" }
  ]
}
```

**Dependency-Graph (gerichteter azyklischer Graph):**
```
core ← extractors ← target-v3 ← cli
core ← extractors ← target-v4 ← cli
core ← mcp ← target-v3
core ← mcp ← target-v4
core ← qa ← target-v3
core ← qa ← cli
```

**Akzeptanz:**
- [ ] `tsc --build` kompiliert alle 8 Packages in korrekter Reihenfolge
- [ ] Inkrementelle Builds funktionieren (2. Build < 2s)
- [ ] `dist/`-Ordner mit `.js`, `.d.ts`, `.js.map` pro Package

---

### Phase 80: Package.json Workspace-Links + npm Resolution

**Ziel:** Alle `package.json`-Dateien mit korrekten Workspace-Dependencies.

**Root package.json:**
```json
{
  "name": "unified-elementor-converter",
  "private": true,
  "workspaces": [
    "packages/core",
    "packages/extractors",
    "packages/target-v3",
    "packages/target-v4",
    "packages/mcp",
    "packages/qa",
    "packages/cli",
    "packages/framer-export"
  ],
  "scripts": {
    "build": "tsc --build",
    "clean": "tsc --build --clean",
    "test": "vitest run",
    "lint": "eslint packages/*/src/**/*.ts",
    "typecheck": "tsc --build --dry"
  },
  "devDependencies": {
    "typescript": "^5.5.0",
    "vitest": "^2.0.0",
    "eslint": "^9.0.0",
    "@typescript-eslint/eslint-plugin": "^8.0.0",
    "@typescript-eslint/parser": "^8.0.0"
  }
}
```

**Pro-Package package.json (Beispiel @elconv/target-v3):**
```json
{
  "name": "@elconv/target-v3",
  "version": "1.0.0",
  "type": "module",
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "exports": {
    ".": { "types": "./dist/index.d.ts", "import": "./dist/index.js" }
  },
  "dependencies": {
    "@elconv/core": "workspace:*",
    "@elconv/extractors": "workspace:*",
    "@elconv/mcp": "workspace:*",
    "@elconv/qa": "workspace:*"
  }
}
```

**Akzeptanz:**
- [ ] `npm install` resolved alle Workspace-Links
- [ ] `npm run build` kompiliert erfolgreich
- [ ] Kein Package importiert sich selbst oder erzeugt Zyklen

---

<a name="v2"></a>
## Verbesserung 2: GitHub Actions CI Pipeline

### Phase 81: CI-Workflow für Typecheck + Lint + Test

**Ziel:** Automatischer Quality-Gate bei jedem Push/PR.

**Datei:** `.github/workflows/ci.yml`

```yaml
name: CI
on:
  push:
    branches: [main, develop]
  pull_request:
    branches: [main]

concurrency:
  group: ci-${{ github.ref }}
  cancel-in-progress: true

jobs:
  typecheck:
    runs-on: ubuntu-latest
    strategy:
      matrix:
        node-version: [20, 22]
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: ${{ matrix.node-version }}
          cache: npm
      - run: npm ci
      - run: npm run build
      - run: npx tsc --build --dry

  lint:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: npm
      - run: npm ci
      - run: npm run lint

  test:
    runs-on: ubuntu-latest
    needs: typecheck
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: npm
      - run: npm ci
      - run: npm run build
      - run: npm test -- --coverage
      - uses: actions/upload-artifact@v4
        with:
          name: coverage
          path: coverage/

  isolation-check:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: V3/V4 Isolation prüfen
        run: |
          # V3 darf nicht aus V4 importieren
          if grep -r "target-v4\|@elconv/target-v4" packages/target-v3/src/; then
            echo "ERROR: V3 imports from V4!"
            exit 1
          fi
          # V4 darf nicht aus V3 importieren
          if grep -r "target-v3\|@elconv/target-v3" packages/target-v4/src/; then
            echo "ERROR: V4 imports from V3!"
            exit 1
          fi
          echo "V3/V4 Isolation: OK"
```

**Akzeptanz:**
- [ ] Workflow läuft grün auf Node 20 + 22
- [ ] V3/V4 Isolation wird automatisch geprüft
- [ ] Coverage-Artefakt wird hochgeladen
- [ ] Concurrency: ältere Runs werden abgebrochen

---

### Phase 82: ESLint-Config mit V3/V4 Isolation-Rule

**Ziel:** Statische Analyse die Cross-Imports sofort erkennt.

**Dateien:**
- `eslint.config.js` (Flat Config, ESLint 9)
- `eslint-rules/no-cross-target-import.js` — Custom Rule

**eslint.config.js:**
```javascript
import tseslint from '@typescript-eslint/eslint-plugin';
import tsparser from '@typescript-eslint/parser';
import { noCrossTargetImport } from './eslint-rules/no-cross-target-import.js';

export default [
  {
    files: ['packages/*/src/**/*.ts'],
    languageOptions: {
      parser: tsparser,
      parserOptions: { project: true }
    },
    plugins: {
      '@typescript-eslint': tseslint,
      'elconv': { rules: { 'no-cross-target-import': noCrossTargetImport } }
    },
    rules: {
      '@typescript-eslint/no-unused-vars': 'error',
      '@typescript-eslint/explicit-function-return-type': 'warn',
      '@typescript-eslint/no-floating-promises': 'error',
      'elconv/no-cross-target-import': 'error'
    }
  }
];
```

**Custom Rule (no-cross-target-import):**
```javascript
export const noCrossTargetImport = {
  meta: {
    type: 'problem',
    docs: { description: 'Verhindert V3↔V4 Cross-Imports' },
    schema: []
  },
  create(context) {
    const filename = context.filename;
    const isV3 = filename.includes('target-v3');
    const isV4 = filename.includes('target-v4');
    if (!isV3 && !isV4) return {};

    return {
      ImportDeclaration(node) {
        const source = node.source.value;
        if (isV3 && (source.includes('target-v4') || source.includes('@elconv/target-v4'))) {
          context.report({ node, message: 'V3 darf nicht aus V4 importieren.' });
        }
        if (isV4 && (source.includes('target-v3') || source.includes('@elconv/target-v3'))) {
          context.report({ node, message: 'V4 darf nicht aus V3 importieren.' });
        }
      }
    };
  }
};
```

**Akzeptanz:**
- [ ] `npm run lint` läuft fehlerfrei auf sauberem Code
- [ ] Absichtlicher V3→V4 Import wird als Error gemeldet
- [ ] CI-Lint-Job wird rot bei Verstoß

---

### Phase 83: Release-Workflow + Changelog-Automation

**Ziel:** Automatisches Versioning + GitHub Release bei Tag-Push.

**Datei:** `.github/workflows/release.yml`

```yaml
name: Release
on:
  push:
    tags: ['v*']

jobs:
  release:
    runs-on: ubuntu-latest
    permissions:
      contents: write
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: npm
      - run: npm ci
      - run: npm run build
      - run: npm test
      - name: Generate Changelog
        run: npx conventional-changelog-cli -p angular -r 1 > CHANGELOG.md
      - name: Create Release
        uses: softprops/action-gh-release@v2
        with:
          body_path: CHANGELOG.md
          generate_release_notes: true
```

**Commit-Convention:** Conventional Commits (`feat:`, `fix:`, `refactor:`, `docs:`, `test:`, `chore:`)

**Akzeptanz:**
- [ ] Tag `v1.0.0` erzeugt GitHub Release mit Changelog
- [ ] Release enthält alle Commits seit letztem Tag
- [ ] Build + Tests müssen grün sein vor Release

---

<a name="v3"></a>
## Verbesserung 3: WordPress Snapshot/Rollback

### Phase 84: Snapshot-Engine (Pre-Deploy Capture)

**Ziel:** Vor jeder Deployment-Aktion den aktuellen Seitenzustand sichern.

**Dateien:**
- `packages/core/src/snapshot/snapshot-engine.ts`
- `packages/core/src/snapshot/snapshot-store.ts`
- `packages/core/src/snapshot/snapshot-types.ts`

**snapshot-types.ts:**
```typescript
export interface PageSnapshot {
  id: string;                    // UUID
  timestamp: string;             // ISO 8601
  siteUrl: string;
  pageId: number;
  pageTitle: string;
  elementorData: string;         // JSON-String der Elementor-Settings
  postContent: string;           // wp_posts.post_content
  postMeta: Record<string, string>;
  wpCodeSnippets: WpCodeSnippet[];
  checksum: string;              // SHA-256 über elementorData
}

export interface WpCodeSnippet {
  id: number;
  title: string;
  code: string;
  location: string;
  status: 'active' | 'inactive';
}

export interface SnapshotManifest {
  version: 1;
  site: string;
  snapshots: SnapshotEntry[];
}

export interface SnapshotEntry {
  id: string;
  timestamp: string;
  pageId: number;
  label: string;
  file: string;                  // Relativer Pfad zur JSON-Datei
}
```

**snapshot-engine.ts:**
```typescript
export class SnapshotEngine {
  constructor(private mcp: McpClient, private store: SnapshotStore) {}

  /**
   * Erstellt einen vollständigen Snapshot einer WordPress-Seite.
   * Wird VOR jeder Deployment-Aktion aufgerufen.
   */
  async capture(pageId: number, label: string): Promise<PageSnapshot> {
    // 1. Elementor-Daten via execute-php auslesen
    const elementorData = await this.mcp.executePhp(`
      $post_id = ${pageId};
      $data = get_post_meta($post_id, '_elementor_data', true);
      return $data ?: '[]';
    `);

    // 2. Post-Content auslesen
    const postContent = await this.mcp.executePhp(`
      $post = get_post(${pageId});
      return $post ? $post->post_content : '';
    `);

    // 3. Post-Meta auslesen
    const postMeta = await this.mcp.executePhp(`
      return get_post_meta(${pageId});
    `);

    // 4. WPCode-Snippets auslesen
    const snippets = await this.captureWpCodeSnippets(pageId);

    // 5. Checksum berechnen
    const checksum = createHash('sha256')
      .update(elementorData)
      .digest('hex');

    const snapshot: PageSnapshot = {
      id: crypto.randomUUID(),
      timestamp: new Date().toISOString(),
      siteUrl: this.mcp.siteUrl,
      pageId,
      pageTitle: await this.getPageTitle(pageId),
      elementorData,
      postContent,
      postMeta,
      wpCodeSnippets: snippets,
      checksum
    };

    await this.store.save(snapshot, label);
    return snapshot;
  }

  private async captureWpCodeSnippets(pageId: number): Promise<WpCodeSnippet[]> {
    const raw = await this.mcp.executePhp(`
      $snippets = get_posts([
        'post_type' => 'wpcode',
        'posts_per_page' => -1,
        'meta_query' => [['key' => 'wpcode_page_id', 'value' => '${pageId}']]
      ]);
      return array_map(fn($s) => [
        'id' => $s->ID,
        'title' => $s->post_title,
        'code' => $s->post_content,
        'location' => get_post_meta($s->ID, 'wpcode_location', true),
        'status' => $s->post_status === 'publish' ? 'active' : 'inactive'
      ], $snippets);
    `);
    return JSON.parse(raw);
  }
}
```

**snapshot-store.ts:**
```typescript
export class SnapshotStore {
  private baseDir: string;

  constructor(projectDir: string) {
    this.baseDir = join(projectDir, '.snapshots');
  }

  async save(snapshot: PageSnapshot, label: string): Promise<void> {
    await mkdir(this.baseDir, { recursive: true });
    const filename = `${snapshot.pageId}_${snapshot.timestamp.replace(/[:.]/g, '-')}.json`;
    await writeFile(join(this.baseDir, filename), JSON.stringify(snapshot, null, 2));
    await this.updateManifest(snapshot, label, filename);
  }

  async list(pageId?: number): Promise<SnapshotEntry[]> { /* ... */ }
  async getLatest(pageId: number): Promise<PageSnapshot | null> { /* ... */ }
  async get(snapshotId: string): Promise<PageSnapshot | null> { /* ... */ }
  async prune(keepLast: number = 10): Promise<void> { /* ... */ }
}
```

**Akzeptanz:**
- [ ] Snapshot enthält vollständige Elementor-Daten + WPCode-Snippets
- [ ] Snapshots werden lokal in `.snapshots/` gespeichert
- [ ] Manifest-Datei listet alle Snapshots chronologisch
- [ ] Prune behält nur die letzten N Snapshots

---

### Phase 85: Rollback-Engine (Restore + Verify)

**Ziel:** Einen beliebigen Snapshot wiederherstellen und verifizieren.

**Dateien:**
- `packages/core/src/snapshot/rollback-engine.ts`
- `packages/cli/src/rollback.ts`

**rollback-engine.ts:**
```typescript
export class RollbackEngine {
  constructor(private mcp: McpClient, private store: SnapshotStore) {}

  /**
   * Stellt einen Snapshot wieder her.
   * Strategie: Elementor-Daten → Post-Meta → WPCode-Snippets → Verify
   */
  async restore(snapshotId: string, options?: RollbackOptions): Promise<RollbackResult> {
    const snapshot = await this.store.get(snapshotId);
    if (!snapshot) throw new Error(`Snapshot ${snapshotId} nicht gefunden`);

    const steps: RollbackStep[] = [];

    // Schritt 1: Elementor-Daten wiederherstellen
    if (!options?.skipElementor) {
      await this.mcp.executePhp(`
        update_post_meta(${snapshot.pageId}, '_elementor_data', ${JSON.stringify(snapshot.elementorData)});
        update_post_meta(${snapshot.pageId}, '_elementor_edit_mode', 'builder');
      `);
      steps.push({ action: 'elementor_data_restored', success: true });
    }

    // Schritt 2: Post-Content wiederherstellen
    if (!options?.skipContent) {
      await this.mcp.executePhp(`
        wp_update_post(['ID' => ${snapshot.pageId}, 'post_content' => ${JSON.stringify(snapshot.postContent)}]);
      `);
      steps.push({ action: 'post_content_restored', success: true });
    }

    // Schritt 3: WPCode-Snippets wiederherstellen
    if (!options?.skipWpCode) {
      for (const snippet of snapshot.wpCodeSnippets) {
        await this.mcp.executePhp(`
          $post = get_post(${snippet.id});
          if ($post) {
            wp_update_post(['ID' => ${snippet.id}, 'post_content' => ${JSON.stringify(snippet.code)}, 'post_status' => '${snippet.status === 'active' ? 'publish' : 'draft'}']);
          }
        `);
      }
      steps.push({ action: 'wpcode_snippets_restored', count: snapshot.wpCodeSnippets.length });
    }

    // Schritt 4: Verifizierung
    const verification = await this.verify(snapshot);
    
    return { snapshotId, pageId: snapshot.pageId, steps, verification };
  }

  private async verify(snapshot: PageSnapshot): Promise<VerificationResult> {
    const currentData = await this.mcp.executePhp(`
      return get_post_meta(${snapshot.pageId}, '_elementor_data', true);
    `);
    const currentChecksum = createHash('sha256').update(currentData).digest('hex');
    return {
      checksumMatch: currentChecksum === snapshot.checksum,
      expectedChecksum: snapshot.checksum,
      actualChecksum: currentChecksum
    };
  }
}
```

**CLI-Befehl (packages/cli/src/rollback.ts):**
```typescript
export const rollbackCommand = {
  command: 'rollback [pageId]',
  describe: 'Stellt den letzten Snapshot einer Seite wieder her',
  builder: (yargs) => yargs
    .option('snapshot', { alias: 's', type: 'string', describe: 'Snapshot-ID' })
    .option('list', { alias: 'l', type: 'boolean', describe: 'Verfügbare Snapshots auflisten' })
    .option('dry-run', { type: 'boolean', describe: 'Nur anzeigen, nicht ausführen' })
    .option('keep', { type: 'number', default: 10, describe: 'Snapshots behalten' }),
  handler: async (argv) => { /* ... */ }
};
```

**Akzeptanz:**
- [ ] `elconv rollback --list` zeigt alle Snapshots
- [ ] `elconv rollback 42` stellt letzten Snapshot von Seite 42 her
- [ ] `elconv rollback 42 --snapshot <id>` stellt spezifischen Snapshot her
- [ ] Verifizierung bestätigt Checksum-Match nach Restore
- [ ] `--dry-run` zeigt was passieren würde ohne Ausführung

---

### Phase 86: Auto-Snapshot Integration in Deployment-Pipeline

**Ziel:** Jeder Deploy-Aufruf erzeugt automatisch einen Pre-Deploy-Snapshot.

**Integration in:**
- `packages/target-v3/src/framer-build-orchestrator.ts`
- `packages/mcp/src/convert-page-v3-to-v4.ts`
- `packages/cli/src/clone-v3.ts`

**Pattern:**
```typescript
// In framer-build-orchestrator.ts, VOR Schritt 7 (Deploy):
const snapshotEngine = new SnapshotEngine(mcp, snapshotStore);
const preSnapshot = await snapshotEngine.capture(pageId, `pre-deploy-${runId}`);
logger.info(`Snapshot ${preSnapshot.id} erstellt (Checksum: ${preSnapshot.checksum.slice(0, 8)})`);

// NACH Deploy + Probe:
if (probeResult.score < threshold) {
  logger.warn(`Probe-Score ${probeResult.score} < ${threshold} — automatischer Rollback`);
  const rollback = new RollbackEngine(mcp, snapshotStore);
  await rollback.restore(preSnapshot.id);
  logger.info('Rollback durchgeführt — Seite auf vorherigem Stand');
}
```

**Akzeptanz:**
- [ ] Jeder Deploy erzeugt automatisch Pre-Deploy-Snapshot
- [ ] Bei Probe-Failure erfolgt automatischer Rollback
- [ ] Snapshot wird im Run-Report dokumentiert
- [ ] `.snapshots/` ist in `.gitignore`

---

<a name="v4"></a>
## Verbesserung 4: MCP Circuit Breaker + Health Monitor

### Phase 87: Circuit-Breaker-Kern

**Ziel:** Zentrale Absicherung aller MCP-Aufrufe gegen Kaskadenfehler.

**Dateien:**
- `packages/core/src/resilience/circuit-breaker.ts`
- `packages/core/src/resilience/circuit-breaker-types.ts`
- `packages/core/src/resilience/health-monitor.ts`
- `packages/core/src/resilience/index.ts`

**circuit-breaker-types.ts:**
```typescript
export enum CircuitState {
  CLOSED = 'CLOSED',       // Normalbetrieb — Requests fließen
  OPEN = 'OPEN',           // Fehler — Requests werden abgelehnt
  HALF_OPEN = 'HALF_OPEN'  // Erholung — Einzelne Test-Requests
}

export interface CircuitBreakerConfig {
  failureThreshold: number;      // Fehler bis OPEN (default: 5)
  resetTimeoutMs: number;        // Wartezeit bis HALF_OPEN (default: 30000)
  halfOpenMaxAttempts: number;   // Test-Requests in HALF_OPEN (default: 3)
  successThreshold: number;      // Erfolge in HALF_OPEN bis CLOSED (default: 2)
  monitorWindowMs: number;       // Zeitfenster für Fehler-Rate (default: 60000)
  failureRateThreshold: number;  // Fehler-Rate % bis OPEN (default: 50)
}

export interface CircuitEvent {
  timestamp: string;
  tool: string;
  state: CircuitState;
  transition: `${CircuitState}->${CircuitState}`;
  reason: string;
  errorCount: number;
  successCount: number;
}

export interface ToolHealth {
  tool: string;
  state: CircuitState;
  totalCalls: number;
  totalFailures: number;
  failureRate: number;
  lastSuccess: string | null;
  lastFailure: string | null;
  lastError: string | null;
  avgResponseMs: number;
  events: CircuitEvent[];
}
```

**circuit-breaker.ts:**
```typescript
export class CircuitBreaker {
  private states = new Map<string, CircuitState>();
  private failures = new Map<string, number[]>();  // Timestamps
  private successes = new Map<string, number>();
  private events: CircuitEvent[] = [];
  private config: CircuitBreakerConfig;

  constructor(config?: Partial<CircuitBreakerConfig>) {
    this.config = {
      failureThreshold: 5,
      resetTimeoutMs: 30_000,
      halfOpenMaxAttempts: 3,
      successThreshold: 2,
      monitorWindowMs: 60_000,
      failureRateThreshold: 50,
      ...config
    };
  }

  async execute<T>(tool: string, fn: () => Promise<T>): Promise<T> {
    const state = this.getState(tool);

    if (state === CircuitState.OPEN) {
      if (this.shouldAttemptReset(tool)) {
        this.transition(tool, CircuitState.HALF_OPEN, 'Reset-Timeout abgelaufen');
      } else {
        throw new CircuitOpenError(tool, this.getTimeUntilRetry(tool));
      }
    }

    try {
      const start = performance.now();
      const result = await fn();
      this.onSuccess(tool, performance.now() - start);
      return result;
    } catch (error) {
      this.onFailure(tool, error);
      throw error;
    }
  }

  private onSuccess(tool: string, durationMs: number): void {
    const state = this.getState(tool);
    if (state === CircuitState.HALF_OPEN) {
      const count = (this.successes.get(tool) ?? 0) + 1;
      this.successes.set(tool, count);
      if (count >= this.config.successThreshold) {
        this.transition(tool, CircuitState.CLOSED, 'Erfolgreich erholt');
        this.reset(tool);
      }
    }
    // Response-Zeit tracken für Health-Monitor
  }

  private onFailure(tool: string, error: unknown): void {
    const now = Date.now();
    const timestamps = this.failures.get(tool) ?? [];
    timestamps.push(now);
    // Alte Fehler außerhalb des Fensters entfernen
    const windowStart = now - this.config.monitorWindowMs;
    const recent = timestamps.filter(t => t >= windowStart);
    this.failures.set(tool, recent);

    const state = this.getState(tool);
    if (state === CircuitState.HALF_OPEN) {
      this.transition(tool, CircuitState.OPEN, 'Fehler in HALF_OPEN');
    } else if (recent.length >= this.config.failureThreshold) {
      this.transition(tool, CircuitState.OPEN, `Fehler-Schwelle erreicht (${recent.length})`);
    }
  }

  private transition(tool: string, to: CircuitState, reason: string): void {
    const from = this.getState(tool);
    this.states.set(tool, to);
    this.events.push({
      timestamp: new Date().toISOString(),
      tool, state: to,
      transition: `${from}->${to}`,
      reason,
      errorCount: this.failures.get(tool)?.length ?? 0,
      successCount: this.successes.get(tool) ?? 0
    });
  }
}

export class CircuitOpenError extends Error {
  constructor(public tool: string, public retryAfterMs: number) {
    super(`Circuit OPEN für "${tool}" — Retry in ${Math.ceil(retryAfterMs / 1000)}s`);
    this.name = 'CircuitOpenError';
  }
}
```

**Akzeptanz:**
- [ ] Circuit öffnet nach 5 aufeinanderfolgenden Fehlern
- [ ] Nach 30s Timeout wechselt Circuit zu HALF_OPEN
- [ ] 2 Erfolge in HALF_OPEN schließen den Circuit
- [ ] CircuitOpenError enthält Retry-After-Information
- [ ] Alle State-Transitions werden als Events geloggt

---

### Phase 88: Health-Monitor + Dashboard-Daten

**Ziel:** Echtzeit-Überblick über alle MCP-Tool-Zustände.

**health-monitor.ts:**
```typescript
export class HealthMonitor {
  private breaker: CircuitBreaker;
  private responseTimes = new Map<string, number[]>();
  private callLog: McpCallRecord[] = [];

  constructor(breaker: CircuitBreaker) {
    this.breaker = breaker;
  }

  recordCall(tool: string, durationMs: number, success: boolean, error?: string): void {
    this.callLog.push({
      timestamp: new Date().toISOString(),
      tool, durationMs, success, error
    });
    const times = this.responseTimes.get(tool) ?? [];
    times.push(durationMs);
    if (times.length > 100) times.shift(); // Rolling window
    this.responseTimes.set(tool, times);
  }

  getHealth(tool: string): ToolHealth {
    const times = this.responseTimes.get(tool) ?? [];
    const calls = this.callLog.filter(c => c.tool === tool);
    const failures = calls.filter(c => !c.success);
    return {
      tool,
      state: this.breaker.getState(tool),
      totalCalls: calls.length,
      totalFailures: failures.length,
      failureRate: calls.length ? (failures.length / calls.length) * 100 : 0,
      lastSuccess: calls.filter(c => c.success).at(-1)?.timestamp ?? null,
      lastFailure: failures.at(-1)?.timestamp ?? null,
      lastError: failures.at(-1)?.error ?? null,
      avgResponseMs: times.length ? times.reduce((a, b) => a + b, 0) / times.length : 0,
      events: this.breaker.getEvents(tool)
    };
  }

  getFullReport(): HealthReport {
    const tools = [...new Set(this.callLog.map(c => c.tool))];
    return {
      timestamp: new Date().toISOString(),
      overallHealthy: tools.every(t => this.breaker.getState(t) === CircuitState.CLOSED),
      tools: tools.map(t => this.getHealth(t)),
      totalCalls: this.callLog.length,
      totalFailures: this.callLog.filter(c => !c.success).length
    };
  }

  /** Schreibt Health-Report in Run-Report */
  async exportToFile(path: string): Promise<void> {
    await writeFile(path, JSON.stringify(this.getFullReport(), null, 2));
  }
}
```

**Integration in MCP-Client:**
```typescript
// packages/mcp/src/mcp-client.ts (erweitern)
export class ResilientMcpClient {
  private breaker = new CircuitBreaker();
  private health = new HealthMonitor(this.breaker);

  async executePhp(code: string): Promise<string> {
    return this.breaker.execute('execute-php', async () => {
      const start = performance.now();
      try {
        const result = await this.rawClient.executePhp(code);
        this.health.recordCall('execute-php', performance.now() - start, true);
        return result;
      } catch (e) {
        this.health.recordCall('execute-php', performance.now() - start, false, String(e));
        throw e;
      }
    });
  }

  // Gleiche Pattern für: browserNavigate, browserScreenshot, wpRestApi, etc.
}
```

**Akzeptanz:**
- [ ] Alle MCP-Aufrufe laufen durch den CircuitBreaker
- [ ] Health-Report zeigt Zustand aller Tools
- [ ] Report wird am Ende jedes Pipeline-Runs exportiert
- [ ] Langsame Tools (>5s) werden im Report markiert

---

### Phase 89: Adaptive Retry-Strategie

**Ziel:** Intelligente Retries basierend auf Fehlertyp und Circuit-Zustand.

**Datei:** `packages/core/src/resilience/adaptive-retry.ts`

```typescript
export interface RetryPolicy {
  maxAttempts: number;
  baseDelayMs: number;
  maxDelayMs: number;
  backoffMultiplier: number;
  retryableErrors: string[];
  nonRetryableErrors: string[];
}

const DEFAULT_POLICIES: Record<string, RetryPolicy> = {
  'execute-php': {
    maxAttempts: 3,
    baseDelayMs: 1000,
    maxDelayMs: 10000,
    backoffMultiplier: 2,
    retryableErrors: ['timeout', 'ECONNRESET', '502', '503'],
    nonRetryableErrors: ['syntax error', 'fatal error', 'permission denied']
  },
  'browser_navigate': {
    maxAttempts: 2,
    baseDelayMs: 2000,
    maxDelayMs: 8000,
    backoffMultiplier: 2,
    retryableErrors: ['timeout', 'net::ERR', 'ECONNREFUSED'],
    nonRetryableErrors: ['404', 'DNS_PROBE_FINISHED']
  },
  'wp_rest_api': {
    maxAttempts: 4,
    baseDelayMs: 500,
    maxDelayMs: 15000,
    backoffMultiplier: 3,
    retryableErrors: ['429', '503', 'timeout'],
    nonRetryableErrors: ['401', '403', '404']
  }
};

export class AdaptiveRetry {
  constructor(private breaker: CircuitBreaker) {}

  async withRetry<T>(tool: string, fn: () => Promise<T>): Promise<T> {
    const policy = DEFAULT_POLICIES[tool] ?? DEFAULT_POLICIES['execute-php'];
    let lastError: Error | undefined;

    for (let attempt = 1; attempt <= policy.maxAttempts; attempt++) {
      try {
        return await this.breaker.execute(tool, fn);
      } catch (error) {
        lastError = error as Error;

        if (error instanceof CircuitOpenError) {
          // Circuit ist offen — warte die angegebene Zeit
          await sleep(error.retryAfterMs);
          continue;
        }

        const errorMsg = String(error);
        if (policy.nonRetryableErrors.some(e => errorMsg.includes(e))) {
          throw error; // Nicht wiederholbar
        }

        if (attempt < policy.maxAttempts) {
          const delay = Math.min(
            policy.baseDelayMs * Math.pow(policy.backoffMultiplier, attempt - 1),
            policy.maxDelayMs
          );
          // Jitter: ±20%
          const jitter = delay * (0.8 + Math.random() * 0.4);
          await sleep(jitter);
        }
      }
    }
    throw lastError;
  }
}
```

**Akzeptanz:**
- [ ] Syntax-Fehler werden NICHT wiederholt (sofortiger Fail)
- [ ] Timeouts werden mit exponentiellem Backoff wiederholt
- [ ] Circuit-Open wird respektiert (Warten statt sofortiger Retry)
- [ ] Jitter verhindert Thundering-Herd bei parallelen Calls
- [ ] Policy pro Tool konfigurierbar

---

<a name="v5"></a>
## Verbesserung 5: Configuration Schema Validation (Zod)

### Phase 90: Zod-Schemas für alle Konfigurationsquellen

**Ziel:** Typsichere Validierung aller Configs mit klaren Fehlermeldungen.

**Dateien:**
- `packages/core/src/config/schemas.ts`
- `packages/core/src/config/loader.ts`
- `packages/core/src/config/errors.ts`

**schemas.ts:**
```typescript
import { z } from 'zod';

// === wp-target.json ===
export const WpTargetSchema = z.object({
  url: z.string().url('Ungültige URL'),
  name: z.string().min(1),
  auth: z.object({
    method: z.enum(['application-password', 'jwt', 'basic']),
    username: z.string().min(1),
    applicationPassword: z.string().min(16).optional(),
    jwtSecret: z.string().optional(),
    basicToken: z.string().optional()
  }).refine(auth => {
    if (auth.method === 'application-password') return !!auth.applicationPassword;
    if (auth.method === 'jwt') return !!auth.jwtSecret;
    if (auth.method === 'basic') return !!auth.basicToken;
    return false;
  }, { message: 'Auth-Methode erfordert passenden Credential' }),
  elementor: z.object({
    version: z.string().regex(/^\d+\.\d+/),
    mode: z.enum(['v3', 'v4']).default('v3')
  }),
  plugins: z.object({
    wpcode: z.boolean().default(true),
    olympusFonts: z.boolean().default(false)
  }).optional()
});

// === .env ===
export const EnvSchema = z.object({
  WP_API_URL: z.string().url(),
  WP_API_USERNAME: z.string().min(1),
  WP_API_PASSWORD: z.string().min(8),
  BROWSERBASE_API_KEY: z.string().optional(),
  BROWSERBASE_PROJECT_ID: z.string().optional(),
  OPENAI_API_KEY: z.string().optional(),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info')
});

// === CLI-Flags ===
export const PipelineFlagsSchema = z.object({
  source: z.string().url('Source muss eine gültige URL sein'),
  target: z.string().url('Target muss eine gültige URL sein'),
  page: z.number().int().positive().optional(),
  mode: z.enum(['full', 'incremental', 'diff-only', 'dry-run']).default('full'),
  elementorVersion: z.enum(['v3', 'v4']).default('v3'),
  skipScreenshots: z.boolean().default(false),
  concurrency: z.number().int().min(1).max(5).default(1),
  timeout: z.number().int().min(30000).max(600000).default(120000)
});

// === Run-Config (zusammengesetzt) ===
export const RunConfigSchema = z.object({
  target: WpTargetSchema,
  flags: PipelineFlagsSchema,
  env: EnvSchema.partial() // Nicht alle Env-Vars sind Pflicht
});

export type WpTarget = z.infer<typeof WpTargetSchema>;
export type EnvConfig = z.infer<typeof EnvSchema>;
export type PipelineFlags = z.infer<typeof PipelineFlagsSchema>;
export type RunConfig = z.infer<typeof RunConfigSchema>;
```

**loader.ts:**
```typescript
export class ConfigLoader {
  static async load(projectDir: string): Promise<RunConfig> {
    const errors: ConfigError[] = [];

    // 1. wp-target.json laden
    const targetRaw = await this.readJsonSafe(join(projectDir, 'wp-target.json'));
    const targetResult = WpTargetSchema.safeParse(targetRaw);
    if (!targetResult.success) {
      errors.push(...this.formatZodErrors('wp-target.json', targetResult.error));
    }

    // 2. .env laden
    const envRaw = this.readEnvFile(join(projectDir, '.env'));
    const envResult = EnvSchema.safeParse(envRaw);
    if (!envResult.success) {
      errors.push(...this.formatZodErrors('.env', envResult.error));
    }

    if (errors.length > 0) {
      throw new ConfigValidationError(errors);
    }

    return {
      target: targetResult.data!,
      flags: {} as PipelineFlags, // Wird vom CLI befüllt
      env: envResult.data!
    };
  }

  private static formatZodErrors(source: string, error: ZodError): ConfigError[] {
    return error.issues.map(issue => ({
      source,
      path: issue.path.join('.'),
      message: issue.message,
      code: issue.code,
      hint: this.getHint(issue)
    }));
  }

  private static getHint(issue: ZodIssue): string {
    if (issue.code === 'invalid_type') return `Erwartet: ${issue.expected}, erhalten: ${issue.received}`;
    if (issue.code === 'too_small') return `Mindestens ${issue.minimum} Zeichen/Werte erforderlich`;
    return '';
  }
}
```

**errors.ts:**
```typescript
export class ConfigValidationError extends Error {
  constructor(public errors: ConfigError[]) {
    const summary = errors.map(e =>
      `  [${e.source}] ${e.path}: ${e.message}${e.hint ? ` (${e.hint})` : ''}`
    ).join('\n');
    super(`Konfigurationsfehler:\n${summary}`);
    this.name = 'ConfigValidationError';
  }
}
```

**Akzeptanz:**
- [ ] Ungültige wp-target.json erzeugt klare Fehlermeldung mit Pfad + Hint
- [ ] Fehlende .env-Variablen werden einzeln aufgelistet
- [ ] Auth-Refinement prüft Methode↔Credential-Konsistenz
- [ ] CLI-Flags werden validiert (URL-Format, Zahlenbereich)
- [ ] `ConfigValidationError` ist maschinenlesbar (JSON-serialisierbar)

---

### Phase 91: Config-Integration in alle Entry-Points

**Ziel:** Jeder CLI-Befehl und jede Pipeline validiert Config vor Ausführung.

**Integration-Punkte:**
- `packages/cli/src/clone-v3.ts` — V3-Pipeline-Start
- `packages/cli/src/v4-convert.ts` — V4-Pipeline-Start
- `packages/cli/src/wizard.ts` — Interaktiver Wizard
- `packages/mcp/src/phase10-call-orchestrator.ts` — MCP-Orchestrator
- `packages/target-v3/src/framer-build-orchestrator.ts` — Framer-Build

**Pattern:**
```typescript
// Am Anfang JEDER Pipeline:
const config = await ConfigLoader.load(projectDir);
// Ab hier: config.target.url ist garantiert eine gültige URL
// config.target.auth.method ist garantiert einer der 3 Werte
// config.env.WP_API_PASSWORD ist garantiert >= 8 Zeichen
```

**Akzeptanz:**
- [ ] Kein Pipeline-Start ohne erfolgreiche Config-Validierung
- [ ] Fehler werden VOR dem ersten MCP-Call abgefangen
- [ ] Wizard zeigt Validierungsfehler inline an

---

<a name="v6"></a>
## Verbesserung 6: Intelligent Fix-Learning

### Phase 92: Fix-History-Store

**Ziel:** Persistente Speicherung aller Fix-Versuche und ihrer Ergebnisse.

**Dateien:**
- `packages/qa/src/fix-learning/fix-history-store.ts`
- `packages/qa/src/fix-learning/fix-strategy-ranker.ts`
- `packages/qa/src/fix-learning/fix-types.ts`

**fix-types.ts:**
```typescript
export interface FixAttempt {
  id: string;
  timestamp: string;
  siteUrl: string;
  pageId: number;
  issueType: IssueType;          // 'spacing' | 'overflow' | 'font' | 'layout' | 'color'
  issueSelector: string;         // CSS-Selector des betroffenen Elements
  strategy: string;              // 'css-override' | 'setting-change' | 'structure-fix'
  fixPayload: Record<string, unknown>; // Konkrete Fix-Parameter
  outcome: FixOutcome;
  probeBefore: GeometryProbeResult;
  probeAfter: GeometryProbeResult | null;
  durationMs: number;
}

export type FixOutcome = 'resolved' | 'improved' | 'no-change' | 'regressed' | 'error';

export interface IssueType {
  category: 'spacing' | 'overflow' | 'font' | 'layout' | 'color' | 'animation';
  severity: 'critical' | 'major' | 'minor';
  element: string;
  description: string;
}

export interface StrategyEffectiveness {
  strategy: string;
  issueCategory: string;
  totalAttempts: number;
  resolvedCount: number;
  improvedCount: number;
  successRate: number;           // (resolved + improved) / total
  avgDurationMs: number;
  lastUsed: string;
  confidence: number;            // 0-1, basiert auf Sample-Size
}
```

**fix-history-store.ts:**
```typescript
export class FixHistoryStore {
  private dbPath: string;
  private attempts: FixAttempt[] = [];

  constructor(projectDir: string) {
    this.dbPath = join(projectDir, '.fix-history', 'attempts.json');
  }

  async load(): Promise<void> {
    try {
      const raw = await readFile(this.dbPath, 'utf-8');
      this.attempts = JSON.parse(raw);
    } catch {
      this.attempts = [];
    }
  }

  async record(attempt: FixAttempt): Promise<void> {
    this.attempts.push(attempt);
    await mkdir(dirname(this.dbPath), { recursive: true });
    await writeFile(this.dbPath, JSON.stringify(this.attempts, null, 2));
  }

  /** Finde ähnliche vergangene Fixes */
  findSimilar(issue: IssueType, siteUrl: string): FixAttempt[] {
    return this.attempts
      .filter(a =>
        a.siteUrl === siteUrl &&
        a.issueType.category === issue.category &&
        a.issueType.element === issue.element
      )
      .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
  }

  /** Aggregierte Effektivität pro Strategie */
  getEffectiveness(issueCategory: string): StrategyEffectiveness[] {
    const grouped = new Map<string, FixAttempt[]>();
    for (const a of this.attempts) {
      if (a.issueType.category !== issueCategory) continue;
      const key = a.strategy;
      grouped.set(key, [...(grouped.get(key) ?? []), a]);
    }

    return [...grouped.entries()].map(([strategy, attempts]) => ({
      strategy,
      issueCategory,
      totalAttempts: attempts.length,
      resolvedCount: attempts.filter(a => a.outcome === 'resolved').length,
      improvedCount: attempts.filter(a => a.outcome === 'improved').length,
      successRate: attempts.filter(a => ['resolved', 'improved'].includes(a.outcome)).length / attempts.length,
      avgDurationMs: attempts.reduce((s, a) => s + a.durationMs, 0) / attempts.length,
      lastUsed: attempts.at(-1)!.timestamp,
      confidence: Math.min(1, attempts.length / 10) // Volle Konfidenz ab 10 Versuchen
    }));
  }
}
```

**Akzeptanz:**
- [ ] Jeder Fix-Versuch wird persistent gespeichert
- [ ] Ähnliche Fixes können abgefragt werden
- [ ] Effektivitäts-Ranking pro Strategie und Issue-Kategorie
- [ ] Konfidenz-Score basiert auf Sample-Size

---

### Phase 93: Strategy-Ranker + Auto-Fix-Loop Integration

**Ziel:** Der Auto-Fix-Loop wählt Strategien basierend auf historischen Erfolgsraten.

**fix-strategy-ranker.ts:**
```typescript
export class FixStrategyRanker {
  constructor(private store: FixHistoryStore) {}

  /**
   * Rankt Strategien für ein gegebenes Issue.
   * Gibt sortierte Liste zurück (beste zuerst).
   */
  rank(issue: IssueType, siteUrl: string): RankedStrategy[] {
    const effectiveness = this.store.getEffectiveness(issue.category);
    const similarFixes = this.store.findSimilar(issue, siteUrl);

    // Bekannte gescheiterte Strategien für dieses exakte Element
    const failedStrategies = similarFixes
      .filter(f => f.outcome === 'no-change' || f.outcome === 'regressed')
      .map(f => f.strategy);

    // Bekannte erfolgreiche Strategien
    const successStrategies = similarFixes
      .filter(f => f.outcome === 'resolved')
      .map(f => f.strategy);

    return effectiveness
      .map(e => ({
        strategy: e.strategy,
        score: this.computeScore(e, successStrategies, failedStrategies),
        effectiveness: e,
        recommendation: this.getRecommendation(e, successStrategies, failedStrategies)
      }))
      .sort((a, b) => b.score - a.score);
  }

  private computeScore(
    e: StrategyEffectiveness,
    successes: string[],
    failures: string[]
  ): number {
    let score = e.successRate * e.confidence;
    if (successes.includes(e.strategy)) score += 0.3; // Bonus für bewiesene Wirkung
    if (failures.includes(e.strategy)) score -= 0.5;  // Malus für bekannte Fehlschläge
    return Math.max(0, Math.min(1, score));
  }

  private getRecommendation(e: StrategyEffectiveness, s: string[], f: string[]): string {
    if (s.includes(e.strategy)) return 'BEWÄHRT — bereits erfolgreich für dieses Element';
    if (f.includes(e.strategy)) return 'ÜBERSPRINGEN — bereits fehlgeschlagen';
    if (e.confidence < 0.3) return 'UNBEKANNT — wenige Daten';
    if (e.successRate > 0.7) return 'EMPFOHLEN — hohe Erfolgsrate';
    return 'NEUTRAL';
  }
}
```

**Integration in auto-fix-loop.ts:**
```typescript
// Erweiterte auto-fix-loop.ts
export async function autoFixLoopEnhanced(options: AutoFixOptions): Promise<AutoFixResult> {
  const store = new FixHistoryStore(options.projectDir);
  await store.load();
  const ranker = new FixStrategyRanker(store);

  for (const issue of probeResult.issues) {
    const ranked = ranker.rank(issue, options.siteUrl);
    
    // Nur Top-3 Strategien versuchen (statt alle)
    const candidates = ranked
      .filter(r => r.recommendation !== 'ÜBERSPRINGEN')
      .slice(0, 3);

    for (const candidate of candidates) {
      const start = performance.now();
      const fixResult = await applyFix(candidate.strategy, issue, options);
      const probeAfter = await runGeometryProbe(options);
      
      const outcome = determineOutcome(probeBefore, probeAfter, issue);
      
      await store.record({
        id: crypto.randomUUID(),
        timestamp: new Date().toISOString(),
        siteUrl: options.siteUrl,
        pageId: options.pageId,
        issueType: issue,
        strategy: candidate.strategy,
        fixPayload: fixResult.payload,
        outcome,
        probeBefore,
        probeAfter,
        durationMs: performance.now() - start
      });

      if (outcome === 'resolved') break; // Issue gelöst — nächstes Issue
    }
  }
}
```

**Akzeptanz:**
- [ ] Auto-Fix-Loop nutzt Ranking statt fester Reihenfolge
- [ ] Bekannte Fehlschläge werden übersprungen
- [ ] Bewährte Strategien werden priorisiert
- [ ] Jeder Versuch wird aufgezeichnet (Lern-Effekt über Runs)
- [ ] Nach 5+ Runs konvergiert die Fix-Zeit messbar

---

<a name="v7"></a>
## Verbesserung 7: Plugin Compatibility Pre-Flight

### Phase 94: Plugin-Matrix + Detection

**Ziel:** Vor Pipeline-Start prüfen ob alle benötigten WordPress-Plugins aktiv sind.

**Dateien:**
- `packages/core/src/preflight/plugin-matrix.ts`
- `packages/core/src/preflight/plugin-detector.ts`
- `packages/core/src/preflight/preflight-check.ts`

**plugin-matrix.ts:**
```typescript
export interface PluginRequirement {
  slug: string;
  name: string;
  minVersion: string;
  required: boolean;
  reason: string;
  installUrl?: string;
}

export const PLUGIN_MATRIX: Record<'v3' | 'v4', PluginRequirement[]> = {
  v3: [
    {
      slug: 'elementor',
      name: 'Elementor',
      minVersion: '3.24.0',
      required: true,
      reason: 'Core-Rendering-Engine für V3-Widgets'
    },
    {
      slug: 'wpcode-lite',
      name: 'WPCode Lite',
      minVersion: '2.0.0',
      required: true,
      reason: 'CSS/JS-Injection für Setting-First-Ansatz',
      installUrl: 'https://wordpress.org/plugins/insert-headers-and-footers/'
    },
    {
      slug: 'olympus-google-fonts',
      name: 'Olympus Google Fonts',
      minVersion: '1.0.0',
      required: false,
      reason: 'Optimiertes Font-Loading (optional, aber empfohlen)',
      installUrl: 'https://wordpress.org/plugins/olympus-google-fonts/'
    }
  ],
  v4: [
    {
      slug: 'elementor',
      name: 'Elementor',
      minVersion: '3.28.0',
      required: true,
      reason: 'V4 Atomic System erfordert Elementor 3.28+'
    },
    {
      slug: 'elementor-pro',
      name: 'Elementor Pro',
      minVersion: '3.28.0',
      required: false,
      reason: 'Erweiterte V4-Features (Loop Grid, etc.)'
    }
  ]
};

export const PHP_COMPATIBILITY = {
  minPhp: '8.0',
  minWordpress: '6.2',
  maxWordpress: '6.8'
};
```

**plugin-detector.ts:**
```typescript
export class PluginDetector {
  constructor(private mcp: McpClient) {}

  async detectAll(): Promise<DetectedPlugin[]> {
    const raw = await this.mcp.executePhp(`
      if (!function_exists('get_plugins')) {
        require_once ABSPATH . 'wp-admin/includes/plugin.php';
      }
      $plugins = get_plugins();
      $active = get_option('active_plugins', []);
      $result = [];
      foreach ($plugins as $file => $data) {
        $slug = dirname($file) === '.' ? basename($file, '.php') : dirname($file);
        $result[] = [
          'slug' => $slug,
          'name' => $data['Name'],
          'version' => $data['Version'],
          'active' => in_array($file, $active),
          'file' => $file
        ];
      }
      return json_encode($result);
    `);
    return JSON.parse(raw);
  }

  async checkCompatibility(mode: 'v3' | 'v4'): Promise<CompatibilityReport> {
    const installed = await this.detectAll();
    const requirements = PLUGIN_MATRIX[mode];
    const results: PluginCheckResult[] = [];

    for (const req of requirements) {
      const found = installed.find(p => p.slug === req.slug);
      
      if (!found) {
        results.push({
          requirement: req,
          status: 'missing',
          message: `${req.name} ist nicht installiert`,
          action: req.installUrl ? `Installieren: ${req.installUrl}` : 'Manuell installieren'
        });
      } else if (!found.active) {
        results.push({
          requirement: req,
          status: 'inactive',
          message: `${req.name} ist installiert aber nicht aktiviert`,
          action: 'Plugin aktivieren'
        });
      } else if (!this.versionSatisfies(found.version, req.minVersion)) {
        results.push({
          requirement: req,
          status: 'outdated',
          message: `${req.name} ${found.version} < benötigte ${req.minVersion}`,
          action: `Update auf ${req.minVersion}+`
        });
      } else {
        results.push({
          requirement: req,
          status: 'ok',
          message: `${req.name} ${found.version} ✓`,
          action: null
        });
      }
    }

    // PHP + WordPress Version prüfen
    const envCheck = await this.checkEnvironment();
    
    return {
      mode,
      timestamp: new Date().toISOString(),
      passed: results.every(r => !r.requirement.required || r.status === 'ok'),
      results,
      environment: envCheck
    };
  }

  private versionSatisfies(current: string, minimum: string): boolean {
    const c = current.split('.').map(Number);
    const m = minimum.split('.').map(Number);
    for (let i = 0; i < 3; i++) {
      if ((c[i] ?? 0) > (m[i] ?? 0)) return true;
      if ((c[i] ?? 0) < (m[i] ?? 0)) return false;
    }
    return true;
  }

  private async checkEnvironment(): Promise<EnvironmentCheck> {
    const raw = await this.mcp.executePhp(`
      return json_encode([
        'php' => phpversion(),
        'wordpress' => get_bloginfo('version'),
        'memoryLimit' => ini_get('memory_limit'),
        'maxExecutionTime' => ini_get('max_execution_time')
      ]);
    `);
    const env = JSON.parse(raw);
    return {
      phpVersion: env.php,
      wordpressVersion: env.wordpress,
      phpOk: this.versionSatisfies(env.php, PHP_COMPATIBILITY.minPhp),
      wpOk: this.versionSatisfies(env.wordpress, PHP_COMPATIBILITY.minWordpress),
      memoryLimit: env.memoryLimit,
      warnings: []
    };
  }
}
```

**Akzeptanz:**
- [ ] Alle installierten Plugins werden erkannt
- [ ] Version-Vergleich funktioniert korrekt
- [ ] Fehlende Required-Plugins blockieren Pipeline-Start
- [ ] Optionale Plugins erzeugen nur Warnungen
- [ ] PHP/WordPress-Version wird geprüft
- [ ] Report enthält konkrete Handlungsanweisungen

---

### Phase 95: Pre-Flight-Check CLI + Auto-Fix

**Ziel:** `elconv preflight` Befehl mit optionalem Auto-Install.

**Datei:** `packages/cli/src/preflight.ts`

```typescript
export const preflightCommand = {
  command: 'preflight',
  describe: 'Prüft Ziel-WordPress auf Kompatibilität',
  builder: (yargs) => yargs
    .option('mode', { choices: ['v3', 'v4'], default: 'v3' })
    .option('fix', { type: 'boolean', describe: 'Fehlende Plugins automatisch installieren' })
    .option('json', { type: 'boolean', describe: 'JSON-Output' }),
  handler: async (argv) => {
    const detector = new PluginDetector(mcpClient);
    const report = await detector.checkCompatibility(argv.mode);

    if (argv.json) {
      console.log(JSON.stringify(report, null, 2));
      return;
    }

    // Menschliche Ausgabe
    console.log(`\n🔍 Pre-Flight Check (${argv.mode.toUpperCase()})\n`);
    for (const r of report.results) {
      const icon = r.status === 'ok' ? '✓' : r.status === 'missing' ? '✗' : '⚠';
      console.log(`  ${icon} ${r.message}`);
      if (r.action) console.log(`    → ${r.action}`);
    }
    console.log(`\n  PHP: ${report.environment.phpVersion} ${report.environment.phpOk ? '✓' : '✗'}`);
    console.log(`  WP:  ${report.environment.wordpressVersion} ${report.environment.wpOk ? '✓' : '✗'}`);

    if (!report.passed) {
      console.log('\n❌ Pre-Flight FEHLGESCHLAGEN — Pipeline kann nicht starten.');
      if (argv.fix) {
        console.log('\n🔧 Auto-Fix: Installiere fehlende Plugins...');
        await this.autoInstallPlugins(report);
      }
      process.exit(1);
    }
    console.log('\n✅ Pre-Flight BESTANDEN — Pipeline kann starten.');
  }
};
```

**Auto-Install (via WP-CLI through execute-php):**
```typescript
private async autoInstallPlugins(report: CompatibilityReport): Promise<void> {
  for (const r of report.results) {
    if (r.status === 'missing' && r.requirement.installUrl) {
      await this.mcp.executePhp(`
        require_once ABSPATH . 'wp-admin/includes/class-wp-upgrader.php';
        require_once ABSPATH . 'wp-admin/includes/plugin-install.php';
        $api = plugins_api('plugin_information', ['slug' => '${r.requirement.slug}']);
        $upgrader = new Plugin_Upgrader(new Automatic_Upgrader_Skin());
        $upgrader->install($api->download_link);
        activate_plugin('${r.requirement.slug}/${r.requirement.slug}.php');
      `);
      console.log(`  ✓ ${r.requirement.name} installiert und aktiviert`);
    }
  }
}
```

**Integration in Pipeline-Start:**
```typescript
// In clone-v3.ts / v4-convert.ts, VOR dem ersten Schritt:
const preflight = await detector.checkCompatibility(mode);
if (!preflight.passed) {
  throw new PreflightError(preflight);
}
```

**Akzeptanz:**
- [ ] `elconv preflight --mode v3` zeigt vollständigen Report
- [ ] `elconv preflight --fix` installiert fehlende Plugins
- [ ] Pipeline-Start ruft automatisch Preflight auf
- [ ] JSON-Output für CI-Integration

---

<a name="v8"></a>
## Verbesserung 8: Streaming Progress + ETA

### Phase 96: Progress-Reporter-Kern

**Ziel:** Echtzeit-Fortschritt mit ETA für alle langen Operationen.

**Dateien:**
- `packages/core/src/progress/progress-reporter.ts`
- `packages/core/src/progress/progress-types.ts`
- `packages/core/src/progress/checkpoint-store.ts`

**progress-types.ts:**
```typescript
export interface ProgressState {
  phase: string;
  phaseIndex: number;
  totalPhases: number;
  stepInPhase: number;
  totalStepsInPhase: number;
  currentItem: string;
  percent: number;
  elapsedMs: number;
  estimatedRemainingMs: number | null;
  itemsCompleted: number;
  itemsTotal: number;
}

export interface PhaseDefinition {
  name: string;
  steps: string[];
  weight: number;  // Relative Gewichtung für Gesamt-%
}

export interface Checkpoint {
  id: string;
  timestamp: string;
  phase: string;
  step: number;
  state: Record<string, unknown>; // Serialisierter Pipeline-Zustand
  resumable: boolean;
}
```

**progress-reporter.ts:**
```typescript
export class ProgressReporter {
  private startTime = performance.now();
  private phaseStartTimes: number[] = [];
  private phaseDurations: number[] = []; // Historische Dauern
  private currentPhase = 0;
  private currentStep = 0;
  private listeners: ProgressListener[] = [];
  private phases: PhaseDefinition[];

  constructor(phases: PhaseDefinition[], private history?: number[]) {
    this.phases = phases;
    this.phaseDurations = history ?? [];
  }

  onProgress(listener: ProgressListener): void {
    this.listeners.push(listener);
  }

  startPhase(index: number): void {
    this.currentPhase = index;
    this.currentStep = 0;
    this.phaseStartTimes[index] = performance.now();
    this.emit();
  }

  advanceStep(stepName?: string): void {
    this.currentStep++;
    this.emit(stepName);
  }

  private emit(itemName?: string): void {
    const state = this.computeState(itemName);
    for (const listener of this.listeners) {
      listener(state);
    }
  }

  private computeState(itemName?: string): ProgressState {
    const elapsed = performance.now() - this.startTime;
    const totalWeight = this.phases.reduce((s, p) => s + p.weight, 0);
    
    // Gewichteter Fortschritt
    let completedWeight = 0;
    for (let i = 0; i < this.currentPhase; i++) {
      completedWeight += this.phases[i].weight;
    }
    const phaseProgress = this.phases[this.currentPhase]
      ? this.currentStep / this.phases[this.currentPhase].steps.length
      : 0;
    completedWeight += (this.phases[this.currentPhase]?.weight ?? 0) * phaseProgress;
    
    const percent = Math.round((completedWeight / totalWeight) * 100);

    // ETA basierend auf historischen Phase-Dauern
    const eta = this.estimateRemaining();

    return {
      phase: this.phases[this.currentPhase]?.name ?? 'Unbekannt',
      phaseIndex: this.currentPhase,
      totalPhases: this.phases.length,
      stepInPhase: this.currentStep,
      totalStepsInPhase: this.phases[this.currentPhase]?.steps.length ?? 0,
      currentItem: itemName ?? '',
      percent,
      elapsedMs: elapsed,
      estimatedRemainingMs: eta,
      itemsCompleted: this.currentPhase,
      itemsTotal: this.phases.length
    };
  }

  private estimateRemaining(): number | null {
    if (this.phaseDurations.length < this.phases.length) {
      // Noch nicht genug Daten — nutze aktuelle Phase als Schätzung
      const currentDuration = performance.now() - (this.phaseStartTimes[this.currentPhase] ?? 0);
      const avgPerPhase = currentDuration / Math.max(1, this.currentStep);
      const remainingSteps = (this.phases[this.currentPhase]?.steps.length ?? 0) - this.currentStep;
      const remainingPhases = this.phases.length - this.currentPhase - 1;
      return avgPerPhase * remainingSteps + remainingPhases * avgPerPhase * 3;
    }
    // Historische Daten verfügbar
    let remaining = 0;
    for (let i = this.currentPhase; i < this.phases.length; i++) {
      remaining += this.phaseDurations[i] ?? 0;
    }
    return remaining;
  }
}
```

**Akzeptanz:**
- [ ] Prozent-Anzeige basiert auf gewichteten Phasen
- [ ] ETA wird nach erster Phase genauer
- [ ] Listener-Pattern erlaubt verschiedene UIs (Terminal, JSON, Web)
- [ ] Fortschritt wird bei jedem Step aktualisiert

---

### Phase 97: Terminal-UI + Checkpoint-Resume

**Ziel:** Schöne Terminal-Ausgabe + Wiederaufnahme nach Abbruch.

**Terminal-Renderer:**
```typescript
// packages/cli/src/progress-terminal.ts
export class TerminalProgressRenderer {
  private lastLineCount = 0;

  render(state: ProgressState): void {
    const lines: string[] = [];
    
    // Phase-Fortschritt
    const bar = this.renderBar(state.percent, 30);
    lines.push(`  ${bar} ${state.percent}%`);
    lines.push(`  Phase ${state.phaseIndex + 1}/${state.totalPhases}: ${state.phase}`);
    lines.push(`  Schritt ${state.stepInPhase}/${state.totalStepsInPhase}${state.currentItem ? ` — ${state.currentItem}` : ''}`);
    
    // Zeit
    const elapsed = this.formatDuration(state.elapsedMs);
    const eta = state.estimatedRemainingMs
      ? `~${this.formatDuration(state.estimatedRemainingMs)}`
      : 'berechnen...';
    lines.push(`  ⏱ ${elapsed} vergangen | ETA: ${eta}`);

    // Vorherige Zeilen überschreiben
    this.clearLines(this.lastLineCount);
    for (const line of lines) process.stdout.write(line + '\n');
    this.lastLineCount = lines.length;
  }

  private renderBar(percent: number, width: number): string {
    const filled = Math.round((percent / 100) * width);
    return `[${'█'.repeat(filled)}${'░'.repeat(width - filled)}]`;
  }

  private formatDuration(ms: number): string {
    const s = Math.floor(ms / 1000);
    if (s < 60) return `${s}s`;
    const m = Math.floor(s / 60);
    return `${m}m ${s % 60}s`;
  }

  private clearLines(count: number): void {
    for (let i = 0; i < count; i++) {
      process.stdout.write('\x1b[A\x1b[2K');
    }
  }
}
```

**Checkpoint-Store (Resume nach Abbruch):**
```typescript
// packages/core/src/progress/checkpoint-store.ts
export class CheckpointStore {
  private dir: string;

  constructor(projectDir: string) {
    this.dir = join(projectDir, '.checkpoints');
  }

  async save(checkpoint: Checkpoint): Promise<void> {
    await mkdir(this.dir, { recursive: true });
    const file = join(this.dir, `${checkpoint.phase}_${checkpoint.step}.json`);
    await writeFile(file, JSON.stringify(checkpoint, null, 2));
    // Latest-Symlink
    await writeFile(join(this.dir, 'latest.json'), JSON.stringify(checkpoint, null, 2));
  }

  async getLatest(): Promise<Checkpoint | null> {
    try {
      const raw = await readFile(join(this.dir, 'latest.json'), 'utf-8');
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }

  async canResume(): Promise<boolean> {
    const latest = await this.getLatest();
    return latest?.resumable ?? false;
  }

  async clear(): Promise<void> {
    await rm(this.dir, { recursive: true, force: true });
  }
}
```

**CLI-Integration:**
```typescript
// In pipeline-runner.ts:
const checkpoint = await checkpointStore.getLatest();
if (checkpoint?.resumable && !argv.fresh) {
  console.log(`⏯ Wiederaufnahme ab Phase ${checkpoint.phase}, Schritt ${checkpoint.step}`);
  pipeline.resumeFrom(checkpoint);
} else {
  pipeline.start();
}
```

**Akzeptanz:**
- [ ] Terminal zeigt animierten Fortschrittsbalken
- [ ] ETA wird nach Phase 1 angezeigt und genauer über Zeit
- [ ] Ctrl+C speichert Checkpoint
- [ ] `elconv clone --resume` nimmt am letzten Checkpoint wieder auf
- [ ] `--fresh` ignoriert Checkpoints und startet neu

---

<a name="v9"></a>
## Verbesserung 9: Visual Regression Pixel-Diff

### Phase 98: Pixel-Diff-Engine

**Ziel:** Pixelgenaue Vergleichsanalyse zwischen Source und Target Screenshots.

**Dateien:**
- `packages/qa/src/visual/pixel-diff-engine.ts`
- `packages/qa/src/visual/diff-report.ts`
- `packages/qa/src/visual/threshold-config.ts`

**pixel-diff-engine.ts:**
```typescript
import { PNG } from 'pngjs';
import pixelmatch from 'pixelmatch';

export interface DiffResult {
  totalPixels: number;
  mismatchedPixels: number;
  mismatchPercent: number;
  pass: boolean;
  diffImagePath: string | null;
  regions: DiffRegion[];
}

export interface DiffRegion {
  x: number;
  y: number;
  width: number;
  height: number;
  mismatchPercent: number;
  category: 'header' | 'content' | 'footer' | 'sidebar' | 'unknown';
}

export interface ThresholdConfig {
  pixelmatchThreshold: number;   // 0-1, Farbtoleranz (default: 0.1)
  maxMismatchPercent: number;    // Max erlaubte Abweichung (default: 2.0%)
  ignoreRegions: BoundingBox[];  // Zu ignorierende Bereiche
  viewportWidth: number;
  viewportHeight: number;
  fullPage: boolean;
}

export class PixelDiffEngine {
  private config: ThresholdConfig;

  constructor(config?: Partial<ThresholdConfig>) {
    this.config = {
      pixelmatchThreshold: 0.1,
      maxMismatchPercent: 2.0,
      ignoreRegions: [],
      viewportWidth: 1920,
      viewportHeight: 1080,
      fullPage: true,
      ...config
    };
  }

  async compare(sourcePath: string, targetPath: string, diffOutputPath?: string): Promise<DiffResult> {
    const sourceImg = PNG.sync.read(await readFile(sourcePath));
    const targetImg = PNG.sync.read(await readFile(targetPath));

    // Größen angleichen
    const width = Math.min(sourceImg.width, targetImg.width);
    const height = Math.min(sourceImg.height, targetImg.height);

    const source = this.cropToSize(sourceImg, width, height);
    const target = this.cropToSize(targetImg, width, height);
    const diff = new PNG({ width, height });

    const mismatchedPixels = pixelmatch(
      source.data, target.data, diff.data,
      width, height,
      { threshold: this.config.pixelmatchThreshold }
    );

    // Ignore-Regions abziehen
    const effectiveMismatch = this.subtractIgnoreRegions(
      mismatchedPixels, diff, width, height
    );

    const totalPixels = width * height;
    const mismatchPercent = (effectiveMismatch / totalPixels) * 100;

    // Diff-Bild speichern
    let savedDiffPath: string | null = null;
    if (diffOutputPath) {
      await writeFile(diffOutputPath, PNG.sync.write(diff));
      savedDiffPath = diffOutputPath;
    }

    // Regionen analysieren
    const regions = this.analyzeRegions(diff, width, height);

    return {
      totalPixels,
      mismatchedPixels: effectiveMismatch,
      mismatchPercent: Math.round(mismatchPercent * 100) / 100,
      pass: mismatchPercent <= this.config.maxMismatchPercent,
      diffImagePath: savedDiffPath,
      regions: regions.filter(r => r.mismatchPercent > 0.5)
    };
  }

  private analyzeRegions(diff: PNG, width: number, height: number): DiffRegion[] {
    // Bild in 10x10 Grid aufteilen und pro Zelle Mismatch-Rate berechnen
    const cellW = Math.floor(width / 10);
    const cellH = Math.floor(height / 10);
    const regions: DiffRegion[] = [];

    for (let gy = 0; gy < 10; gy++) {
      for (let gx = 0; gx < 10; gx++) {
        let mismatch = 0;
        let total = 0;
        for (let y = gy * cellH; y < (gy + 1) * cellH && y < height; y++) {
          for (let x = gx * cellW; x < (gx + 1) * cellW && x < width; x++) {
            total++;
            const idx = (y * width + x) * 4;
            if (diff.data[idx] > 0 || diff.data[idx + 1] > 0) mismatch++;
          }
        }
        if (mismatch > 0) {
          regions.push({
            x: gx * cellW, y: gy * cellH,
            width: cellW, height: cellH,
            mismatchPercent: (mismatch / total) * 100,
            category: this.categorizeRegion(gy)
          });
        }
      }
    }
    return regions;
  }

  private categorizeRegion(gridY: number): DiffRegion['category'] {
    if (gridY <= 1) return 'header';
    if (gridY >= 9) return 'footer';
    if (gridY >= 2 && gridY <= 7) return 'content';
    return 'sidebar';
  }
}
```

**Akzeptanz:**
- [ ] Pixelmatch-Vergleich erzeugt Diff-Bild (rot markierte Abweichungen)
- [ ] Mismatch-Prozent wird berechnet
- [ ] Ignore-Regions werden respektiert (z.B. Cookie-Banner)
- [ ] Regionen-Analyse zeigt WO die Abweichungen sind
- [ ] Pass/Fail basiert auf konfigurierbarem Threshold

---

### Phase 99: Visual-Regression in QA-Pipeline + Reporting

**Ziel:** Automatische Visual-Regression-Tests nach jedem Deploy.

**Integration in QA-Pipeline:**
```typescript
// packages/qa/src/visual-regression-suite.ts
export class VisualRegressionSuite {
  private engine: PixelDiffEngine;
  private capture: VisualCapture;

  constructor(config: VisualRegressionConfig) {
    this.engine = new PixelDiffEngine(config.thresholds);
    this.capture = new VisualCapture(config.captureOptions);
  }

  async runSuite(pages: PageTarget[]): Promise<VisualRegressionReport> {
    const results: PageVisualResult[] = [];

    for (const page of pages) {
      // 1. Source-Screenshot (Framer/Original)
      const sourcePath = await this.capture.capture(page.sourceUrl, `source-${page.id}`);
      
      // 2. Target-Screenshot (WordPress/Elementor)
      const targetPath = await this.capture.capture(page.targetUrl, `target-${page.id}`);
      
      // 3. Pixel-Diff
      const diff = await this.engine.compare(
        sourcePath, targetPath,
        join(this.outputDir, `diff-${page.id}.png`)
      );

      results.push({
        pageId: page.id,
        pageTitle: page.title,
        sourceScreenshot: sourcePath,
        targetScreenshot: targetPath,
        diff
      });
    }

    return {
      timestamp: new Date().toISOString(),
      totalPages: results.length,
      passedPages: results.filter(r => r.diff.pass).length,
      failedPages: results.filter(r => !r.diff.pass).length,
      avgMismatch: results.reduce((s, r) => s + r.diff.mismatchPercent, 0) / results.length,
      results,
      overallPass: results.every(r => r.diff.pass)
    };
  }
}
```

**CLI-Befehl:**
```typescript
// packages/cli/src/visual-regression.ts
export const visualRegressionCommand = {
  command: 'visual-diff',
  describe: 'Pixel-genauer Vergleich Source vs. Target',
  builder: (yargs) => yargs
    .option('source', { type: 'string', demandOption: true })
    .option('target', { type: 'string', demandOption: true })
    .option('threshold', { type: 'number', default: 2.0 })
    .option('output', { type: 'string', default: './visual-reports' })
    .option('full-page', { type: 'boolean', default: true }),
  handler: async (argv) => { /* ... */ }
};
```

**Report-Format (Markdown):**
```markdown
# Visual Regression Report
**Datum:** 2026-07-26 | **Seiten:** 5 | **Bestanden:** 4/5

| Seite | Mismatch | Status | Diff-Bild |
|-------|----------|--------|-----------|
| Home  | 0.8%     | ✓ PASS | Diff-Bild nicht im Unified-Archiv enthalten |
| About | 1.2%     | ✓ PASS | Diff-Bild nicht im Unified-Archiv enthalten |
| Shop  | 4.7%     | ✗ FAIL | Diff-Bild nicht im Unified-Archiv enthalten |

## Problemzonen (Shop)
- **Header** (0-200px): 2.1% — Logo-Position verschoben
- **Content** (200-800px): 6.3% — Produkt-Grid-Abstände
```

**Akzeptanz:**
- [ ] `elconv visual-diff --source X --target Y` erzeugt Report
- [ ] Diff-Bilder werden gespeichert
- [ ] Report zeigt Problemzonen mit Kategorien
- [ ] Integration in Run-Report-Generator
- [ ] CI kann bei FAIL den Build abbrechen

---

<a name="v10"></a>
## Verbesserung 10: Multi-Page Batch Orchestrator

### Phase 100: Batch-Orchestrator-Kern

**Ziel:** Parallele Verarbeitung mehrerer Seiten mit Rate-Limiting.

**Dateien:**
- `packages/core/src/batch/batch-orchestrator.ts`
- `packages/core/src/batch/rate-limiter.ts`
- `packages/core/src/batch/batch-types.ts`

**batch-types.ts:**
```typescript
export interface BatchConfig {
  concurrency: number;           // Max parallele Seiten (default: 2)
  rateLimitPerMinute: number;    // Max MCP-Calls pro Minute (default: 30)
  retryFailedPages: boolean;     // Fehlgeschlagene Seiten erneut versuchen
  maxRetries: number;            // Max Retries pro Seite (default: 1)
  stopOnError: boolean;          // Bei Fehler stoppen (default: false)
  snapshotBeforeBatch: boolean;  // Pre-Batch-Snapshot (default: true)
}

export interface PageJob {
  pageId: number;
  sourceUrl: string;
  targetPageId?: number;
  priority: number;              // 1 = höchste Priorität
  status: 'pending' | 'running' | 'completed' | 'failed' | 'retrying';
  attempts: number;
  error?: string;
  result?: PageResult;
  startedAt?: string;
  completedAt?: string;
}

export interface BatchResult {
  batchId: string;
  startedAt: string;
  completedAt: string;
  totalPages: number;
  completed: number;
  failed: number;
  skipped: number;
  totalDurationMs: number;
  pages: PageJob[];
  healthReport: HealthReport;
}
```

**batch-orchestrator.ts:**
```typescript
export class BatchOrchestrator {
  private queue: PageJob[] = [];
  private running = new Set<number>();
  private config: BatchConfig;
  private rateLimiter: RateLimiter;
  private progress: ProgressReporter;

  constructor(config: Partial<BatchConfig> = {}) {
    this.config = {
      concurrency: 2,
      rateLimitPerMinute: 30,
      retryFailedPages: true,
      maxRetries: 1,
      stopOnError: false,
      snapshotBeforeBatch: true,
      ...config
    };
    this.rateLimiter = new RateLimiter(this.config.rateLimitPerMinute);
  }

  addPage(page: Omit<PageJob, 'status' | 'attempts'>): void {
    this.queue.push({ ...page, status: 'pending', attempts: 0 });
  }

  async execute(processor: PageProcessor): Promise<BatchResult> {
    const batchId = crypto.randomUUID();
    const startTime = performance.now();

    // Nach Priorität sortieren
    this.queue.sort((a, b) => a.priority - b.priority);

    // Pre-Batch-Snapshots
    if (this.config.snapshotBeforeBatch) {
      for (const job of this.queue) {
        if (job.targetPageId) {
          await this.snapshotEngine.capture(job.targetPageId, `pre-batch-${batchId}`);
        }
      }
    }

    // Parallele Ausführung mit Concurrency-Limit
    const results = await this.runParallel(processor);

    // Fehlgeschlagene Seiten retryen
    if (this.config.retryFailedPages) {
      await this.retryFailed(processor);
    }

    return {
      batchId,
      startedAt: new Date(startTime).toISOString(),
      completedAt: new Date().toISOString(),
      totalPages: this.queue.length,
      completed: this.queue.filter(j => j.status === 'completed').length,
      failed: this.queue.filter(j => j.status === 'failed').length,
      skipped: this.queue.filter(j => j.status === 'pending').length,
      totalDurationMs: performance.now() - startTime,
      pages: this.queue,
      healthReport: this.healthMonitor.getFullReport()
    };
  }

  private async runParallel(processor: PageProcessor): Promise<void> {
    const executing = new Set<Promise<void>>();

    for (const job of this.queue) {
      if (this.config.stopOnError && this.queue.some(j => j.status === 'failed')) break;

      // Warten bis Slot frei
      while (executing.size >= this.config.concurrency) {
        await Promise.race(executing);
      }

      const promise = this.processJob(job, processor);
      executing.add(promise);
      promise.finally(() => executing.delete(promise));
    }

    await Promise.allSettled(executing);
  }

  private async processJob(job: PageJob, processor: PageProcessor): Promise<void> {
    job.status = 'running';
    job.attempts++;
    job.startedAt = new Date().toISOString();

    try {
      await this.rateLimiter.acquire();
      job.result = await processor.process(job);
      job.status = 'completed';
    } catch (error) {
      job.error = String(error);
      job.status = 'failed';
    } finally {
      job.completedAt = new Date().toISOString();
    }
  }

  private async retryFailed(processor: PageProcessor): Promise<void> {
    const failed = this.queue.filter(
      j => j.status === 'failed' && j.attempts <= this.config.maxRetries
    );
    for (const job of failed) {
      job.status = 'retrying';
      await this.processJob(job, processor);
    }
  }
}
```

**Akzeptanz:**
- [ ] Max N Seiten werden parallel verarbeitet
- [ ] Rate-Limiter verhindert MCP-Überlastung
- [ ] Fehlgeschlagene Seiten werden automatisch retryed
- [ ] `stopOnError` bricht bei erstem Fehler ab
- [ ] Pre-Batch-Snapshot sichert alle Seiten

---

### Phase 101: Rate-Limiter + Batch-CLI

**Ziel:** Token-Bucket-Rate-Limiter + CLI-Befehl für Batch-Operationen.

**rate-limiter.ts:**
```typescript
export class RateLimiter {
  private tokens: number;
  private maxTokens: number;
  private refillRate: number; // Tokens pro ms
  private lastRefill: number;
  private waitQueue: (() => void)[] = [];

  constructor(perMinute: number) {
    this.maxTokens = perMinute;
    this.tokens = perMinute;
    this.refillRate = perMinute / 60_000;
    this.lastRefill = performance.now();
  }

  async acquire(): Promise<void> {
    this.refill();
    if (this.tokens >= 1) {
      this.tokens--;
      return;
    }
    // Warten bis Token verfügbar
    return new Promise(resolve => {
      this.waitQueue.push(resolve);
      const waitMs = (1 - this.tokens) / this.refillRate;
      setTimeout(() => this.processQueue(), waitMs);
    });
  }

  private refill(): void {
    const now = performance.now();
    const elapsed = now - this.lastRefill;
    this.tokens = Math.min(this.maxTokens, this.tokens + elapsed * this.refillRate);
    this.lastRefill = now;
  }

  private processQueue(): void {
    this.refill();
    while (this.waitQueue.length > 0 && this.tokens >= 1) {
      this.tokens--;
      const resolve = this.waitQueue.shift()!;
      resolve();
    }
  }
}
```

**CLI-Befehl (packages/cli/src/batch.ts):**
```typescript
export const batchCommand = {
  command: 'batch <sitemap>',
  describe: 'Verarbeitet mehrere Seiten parallel',
  builder: (yargs) => yargs
    .positional('sitemap', { type: 'string', describe: 'URL oder Datei-Pfad zur Sitemap' })
    .option('concurrency', { alias: 'c', type: 'number', default: 2 })
    .option('rate-limit', { type: 'number', default: 30 })
    .option('mode', { choices: ['v3', 'v4'], default: 'v3' })
    .option('retry', { type: 'boolean', default: true })
    .option('stop-on-error', { type: 'boolean', default: false })
    .option('resume', { type: 'boolean', describe: 'Letzten Batch fortsetzen' }),
  handler: async (argv) => {
    // 1. Sitemap parsen (XML oder JSON)
    const pages = await parseSitemap(argv.sitemap);
    
    // 2. Batch-Orchestrator konfigurieren
    const batch = new BatchOrchestrator({
      concurrency: argv.concurrency,
      rateLimitPerMinute: argv.rateLimit,
      retryFailedPages: argv.retry,
      stopOnError: argv.stopOnError
    });

    // 3. Seiten hinzufügen
    for (const [i, page] of pages.entries()) {
      batch.addPage({
        pageId: i + 1,
        sourceUrl: page.url,
        priority: page.priority ?? 1
      });
    }

    // 4. Progress-Reporter anschließen
    const reporter = new ProgressReporter(batchPhases);
    reporter.onProgress(new TerminalProgressRenderer().render.bind(renderer));

    // 5. Ausführen
    const result = await batch.execute(createProcessor(argv.mode));

    // 6. Report
    console.log(`\n✅ Batch abgeschlossen: ${result.completed}/${result.totalPages} Seiten`);
    if (result.failed > 0) {
      console.log(`❌ ${result.failed} Seiten fehlgeschlagen:`);
      result.pages.filter(p => p.status === 'failed')
        .forEach(p => console.log(`   - ${p.sourceUrl}: ${p.error}`));
    }
  }
};
```

**Sitemap-Parser:**
```typescript
async function parseSitemap(source: string): Promise<SitemapEntry[]> {
  if (source.startsWith('http')) {
    // XML-Sitemap von URL laden
    const xml = await fetch(source).then(r => r.text());
    return parseXmlSitemap(xml);
  }
  // Lokale JSON-Datei
  const raw = await readFile(source, 'utf-8');
  return JSON.parse(raw);
}
```

**Akzeptanz:**
- [ ] `elconv batch sitemap.xml --concurrency 3` verarbeitet 3 Seiten parallel
- [ ] Rate-Limiter hält MCP-Call-Rate unter Limit
- [ ] Fortschritt wird pro Seite angezeigt
- [ ] Fehlgeschlagene Seiten werden am Ende aufgelistet
- [ ] `--resume` setzt abgebrochenen Batch fort
- [ ] Batch-Report wird als JSON + Markdown gespeichert

---

## Zusammenfassung: Phasen-Übersicht

| Phase | Verbesserung | Titel |
|-------|-------------|-------|
| 75 | V1 | Import-Pfad-Analyse |
| 76 | V1 | Imports reparieren (Core + Extractors) |
| 77 | V1 | Imports reparieren (Target-V3 + V4) |
| 78 | V1 | Imports reparieren (MCP + QA + CLI) |
| 79 | V1 | TS Project References + Composite Build |
| 80 | V1 | Workspace-Links + npm Resolution |
| 81 | V2 | CI-Workflow (Typecheck + Lint + Test) |
| 82 | V2 | ESLint + V3/V4 Isolation-Rule |
| 83 | V2 | Release-Workflow + Changelog |
| 84 | V3 | Snapshot-Engine |
| 85 | V3 | Rollback-Engine + CLI |
| 86 | V3 | Auto-Snapshot in Pipeline |
| 87 | V4 | Circuit-Breaker-Kern |
| 88 | V4 | Health-Monitor + Dashboard |
| 89 | V4 | Adaptive Retry-Strategie |
| 90 | V5 | Zod-Schemas |
| 91 | V5 | Config-Integration |
| 92 | V6 | Fix-History-Store |
| 93 | V6 | Strategy-Ranker + Integration |
| 94 | V7 | Plugin-Matrix + Detection |
| 95 | V7 | Preflight-CLI + Auto-Fix |
| 96 | V8 | Progress-Reporter-Kern |
| 97 | V8 | Terminal-UI + Checkpoint-Resume |
| 98 | V9 | Pixel-Diff-Engine |
| 99 | V9 | Visual-Regression-Suite + Reporting |
| 100 | V10 | Batch-Orchestrator-Kern |
| 101 | V10 | Rate-Limiter + Batch-CLI |

---

## Neue Dependencies

```json
{
  "dependencies": {
    "zod": "^3.23.0",
    "pngjs": "^7.0.0",
    "pixelmatch": "^6.0.0"
  },
  "devDependencies": {
    "typescript": "^5.5.0",
    "vitest": "^2.0.0",
    "eslint": "^9.0.0",
    "@typescript-eslint/eslint-plugin": "^8.0.0",
    "@typescript-eslint/parser": "^8.0.0",
    "conventional-changelog-cli": "^5.0.0"
  }
}
```

---

## Geschätzter Aufwand

| Verbesserung | Phasen | Aufwand |
|---|---|---|
| V1: Import Repair + TS Refs | 75–80 | ~4h |
| V2: CI Pipeline | 81–83 | ~2h |
| V3: Snapshot/Rollback | 84–86 | ~3h |
| V4: Circuit Breaker | 87–89 | ~3h |
| V5: Config Validation | 90–91 | ~2h |
| V6: Fix-Learning | 92–93 | ~2h |
| V7: Plugin Preflight | 94–95 | ~2h |
| V8: Progress + ETA | 96–97 | ~2h |
| V9: Pixel-Diff | 98–99 | ~2h |
| V10: Batch Orchestrator | 100–101 | ~3h |
| **Gesamt** | **27 Phasen** | **~25h** |

---

*Ende BAUPLAN v4.0*

# framer-v4-pipeline-v2

> **Version:** v0.11.0 | **Stand:** 2026-06-14
> **GSD:** ✅ Milestone Complete — 7 Sprints abgeschlossen

---

## What This Is

Ein **Standalone Node.js ESM Projekt** (28+ Scripts/Module), das Framer-Website-Designs automatisiert in Elementor V4 Atomic Widget Trees konvertiert. Zielgruppe: WordPress-Agenturen und Entwickler, die Framer-Designs pixelgenau in Elementor V4 umsetzen wollen.

Die Pipeline orchestriert eine **3-Wege-Symbiose**: Unframer MCP (Live-Struktur-Reader) → Lokale Pre-Build-Processing-Pipeline (28+ Scripts/Module) → Novamira MCP (WordPress Build-Execution). Output ist eine voll funktionsfähige V4-Seite mit Global Classes, Global Variables, Responsive Variants und Animationen.

---

## Core Value

**Token-effizienter, stabiler Framer→V4-Workflow** — eine einzige `wizard.js`-Ausführung wandelt eine Framer-URL in eine V4-Seite. Ohne manuelle Zwischenschritte, ohne V3-Wrapper-Fehler, mit voller Schema-Validierung und Rollback-Sicherheit.

---

## Requirements

### Validated (bereits implementiert & getestet)
- [x] Framer XML → V4 Widget-Tree Konvertierung (`convert-xml-to-v4.js`) — C2 Grid, C6 GV-Sub, C1 Component Preservation
- [x] CSS-Extraktion & Design-Token-Mapping (`design-token-extractor.js`, `extract-framer-styles.js`)
- [x] Global Class Generator mit C4 Semantic Naming (`generate-global-classes.js`)
- [x] Responsive Auto-Scaling mit C5 Breakpoint-Awareness (`auto-scale-responsive.js`)
- [x] Pre-Build-Validierung mit 12 Guards + Score ≥85% (`framer-pre-build-validate.js`)
- [x] V4 Tree Validator mit D1/D2/D3 Checks (`validate-v4-tree.js`)
- [x] MCP-Bridge: JSON-RPC 2.0 + Session-Handshake + p-limit Concurrency (`lib/mcp-bridge.js`)
- [x] Asset-Batch-Upload via McpBridge (`asset-to-wp-media.js --execute`)
- [x] Schema-Sync vom V2-Plugin (`sync-schema.js`)
- [x] Rollback & Split-Large-Tree (`lib/rollback.js`, `lib/split-large-tree.js`)
- [x] Animation-Extraktion mit C3 Native Routing (`framer-animation-extractor.js`)
- [x] A1 Component Extraction (`extract-framer-components.js`)
- [x] A2 Interaction Extraction mit v4-tree Mode (`extract-framer-interactions.js`)
- [x] A3 Form Extraction (`extract-framer-forms.js`)
- [x] Dark Mode Extraction — ENH-10 (`extract-framer-dark-mode.js`) + FIX-10 --format markdown + FIX-12 token_name dedup
- [x] structuralHash in framer-utils.js (ENH-8 Dedup)
- [x] Modularer CLI-Wizard (`wizard.js` ~300 Zeilen) + 6 Subcommands in `scripts/wizard/` + FIX-11 --help
- [x] Standalone Preflight-Check (`scripts/preflight-check.js`) + Batch Multi-Page (`wizard.js batch`)
- [x] convert-xml-to-v4.js JSDoc — 9 Kernfunktionen (ENH-11)
- [x] 100 Pipeline-Tests + 12 E2E-Tests + 4 Integration-Tests = 116 total
- [x] GitHub CI (7 Jobs)
- [x] GSD-Projekt: .planning/ mit 12 Artefakten (PROJECT, REQUIREMENTS, ROADMAP, PLAN-1–7, STATE, MILESTONE-SUMMARY)

### Out of Scope (v2+)

| Feature | Grund |
|---------|-------|
| Loop Grid Support | Dynamische Listendarstellung — kein Framer-Pendant in aktuellen Designs |
| Motion Effects (entrance_animation) | V4-API noch nicht stabil dokumentiert |
| Live-Preview im Wizard | Bereits als `wizard.js preview` implementiert |

---

## Context

### Technische Umgebung
- **Runtime:** Node.js ≥18, ESM (`"type": "module"`)
- **MCP-Server:** Unframer MCP (Live-Struktur-Reader) + Novamira MCP (WordPress-Build)
- **WordPress:** yoursite.local mit `novamira-adrianv2` Plugin (Elementor V4 Atomic)
- **Testing:** Node native test runner (`node --test`), pixelmatch + axe-core
- **CI:** GitHub Actions (7 Jobs)

### Projekt-Historie
- **v0.7.0**: Initiales Pipeline-Repo, 44 Tests, alle Integration-Fixes A-H
- **v0.8.0**: PIPELINE_AUDIT_REPORT — 15 Verbesserungen, Ability-Migration
- **v0.9.0**: Repo-Cleanup, Rollback-Cleanup, Split-Large-Tree Timeout-Fallback, Plugin CI/CD
- **v0.10.0**: Sprint 1–4 — Grid, Components, Interactions, Forms, Native Routing, 77 Tests
- **v0.11.0**: Sprint 5–7 — Dark Mode, Wizard Modularisierung, Quality Hardening, 100 Tests

### Aktuelle Post-4943 Analyse
- DOM-Tiefe 8 (Ziel: ≤3), 0% Global Classes (Ziel: ≥90%), 0 Grid, 0 Components
- `#111111` 45× dupliziert — Root-Cause: fehlender Token-zu-GV-Substitutions-Pass → gefixt in C6

---

## Constraints

| Constraint | Rationale |
|-----------|-----------|
| **Node.js ≥18** | ESM + native test runner + fetch API |
| **Kein V3-Wrapper** | `elementor-set-content` statt `adrians-batch-build-page` für Framer |
| **5 V4-Invarianten** | Style-Bindung (I), Style-Location (II), ID-Format (III), Image-Src (IV), Custom-CSS (V) |
| **Score ≥85%** | Pre-Build-Validierung blockiert Build bei Score <85% |
| **Keine globale npm-Installation** | Alle Packages via `package.json` devDependencies |
| **JSON-RPC 2.0 MCP** | Alle MCP-Calls via Adapter-Wrapper + Session-Handshake |

---

## Key Decisions

| Decision | Rationale | Status |
|----------|-----------|--------|
| Standalone Pipeline (nicht WP-Plugin) | Entkopplung von WordPress, testbar ohne WP | Good |
| ESM Module | Zukunftssicher, native fetch/assert | Good |
| McpBridge statt direkter HTTP-Calls | Einheitliches JSON-RPC 2.0 Protokoll | Good |
| GC-Generator vor Build | Verhindert `#111111 × 45` Duplikate | Good |
| B1–B3 als existierend identifiziert | Kein neues PHP nötig (Plugin-Analyse) | Good |
| Sprint-Reihenfolge korrigiert (C1→Sprint 2) | C1 braucht A1 (Component-Extraktion) | Good |
| C6 als Root-Cause-Fix priorisiert | GV-Substitutions-Pass ist der fehlende Link | Complete |
| structuralHash in framer-utils.js | A1+D1 Doppel-Definition dedupliziert | Complete |
| C3 `--native` als opt-in | Legacy-GSAP-Pfad nicht brechen | Complete |
| B1-B3 existierende Abilities | 3/4 existieren im Plugin, nur Doku nötig | Complete |
| Wizard modular (8 files) | 905→300 Zeilen, testbar, erweiterbar | Complete |
| callParallel() p-limit (concurrency=3) | Verhindert PHP-Timeout bei 10+ Requests | Complete |
| JSDoc für 9 Kernfunktionen | 0→100% JSDoc-Coverage in convert-xml-to-v4.js | Complete |
| Wizard --help in allen 6 Subcommands | Konsistente DX über alle cmd-*.js | Complete |

---

> **Last Updated:** 2026-06-14 — 7 Sprints, 26 Requirements, 100 Pipeline-Tests

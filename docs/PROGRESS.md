# Unified Elementor Converter — Fortschritt

| Phase | Beschreibung | Status |
|-------|-------------|--------|
| 0 | Repo-Setup + Workspace + Baseline | ✅ done |
| 1 | Core: Branded Types + Contamination | ✅ done |
| 2 | Core: Canonical Interfaces | ✅ done |
| 3 | Core: Guards + Scoring | ✅ done |
| 4 | Core: Deploy Strategy + Pipeline State | ✅ done |
| 5 | Extractors: HTML + Framer + Design Tokens | ✅ done |
| 6 | CLI: Command Router (convert, doctor, deploy, qa) | ✅ done |
| 7 | MCP: Deploy + Transaction + Chunked | ✅ done |
| 8 | MCP: Preflight Suite | ✅ done |
| 9 | Target-V3: Patterns (glass-header, stat-row, service-cards) | ✅ done |
| 10 | Target-V4: Patterns (atomic, e-flexbox, $$type) | ✅ done |
| 11 | QA: Semantic Diff + Auto-Fix + Priority + Multi-Viewport | ✅ done |
| 12 | Core: Session + Run-Archive | ✅ done |
| 13 | Target-V3: WPCode + Animation | ✅ done |
| 14 | Target-V4: Bridge V3→V4 | ✅ done |
| 15 | Core: Config System (elconv.config.yaml) | ✅ done |
| 16 | Skills + Docs | ✅ done |
| 17 | E2E: Golden-File Regression | ✅ done |
| 18 | Release 0.1.0 + CI | ✅ done |
| 19 | Playwright-Extraction (Browser) | ✅ done |
| 20 | Asset-Pipeline | ✅ done |
| 21 | Classifier (Widget-Mapper + Style-Classifier) | ✅ done |
| 22 | AI-Engine (Router + Cost-Tracker) | ✅ done |
| 23 | Healing-Loop | ✅ done |
| 24 | Recon (SPA + Mutation-Observer) | ✅ done |
| 25 | Orchestrator (Phase-Pipeline) | ✅ done |
| 26 | Batch-Processing + Idempotency | ✅ done |
| 27 | Build-Pipeline (tsc --build + dist/) | ✅ done |
| 28 | CI/CD (GitHub Actions) | ✅ done |
| 29 | Error-Tracking + Structured Logging | ✅ done |
| 30 | Security + Credential-Management | ✅ done |
| 31 | Performance (Caching) | ✅ done |
| 32 | Integration-Tests (Browser) | ✅ done |
| 33 | Dokumentation + API-Reference | ✅ done |
| 34 | Release 1.0 | ✅ done |
| 35–42 | BAUPLAN v1.0 Basis-Phasen | ✅ done |
| 43 | Scraper (favicon-og-downloader, svg-downloader) | ✅ done |
| 44 | Builder Merge (531-line builder, multi-column, section) | ✅ done |
| 45 | Classifier Expansion (13 files, 598-line widget-mapper) | ✅ done |
| 46 | Recon (mutation-observer, animation-events, state-capture) | ✅ done |
| 47 | MCP/WP-Push (V3 normalize + inject-calibrated-page) | ✅ done |
| 48 | Orchestrator (Kahn's algorithm dependency graph) | ✅ done |
| 49 | CLI Unification (1 unified wizard) | ✅ done |
| 50 | Framer MCP Bridge | ✅ done |
| 51 | Framer Extraction (7 modules) | ✅ done |
| 52 | V4 Tree Postprocessing (global-classes, auto-scale) | ✅ done |
| 53 | V4 Guards (12 guards) + Cross-Validation | ✅ done |
| 54 | WPCode Generalization (shared mechanism, separate codegen) | ✅ done |
| 55 | Framer Preflight Gates (5 new gate types) | ✅ done |
| 56 | MCP Bridges & Asset Upload (chunked-deploy) | ✅ done |
| 57 | (merged into Phase 48) | ✅ done |
| 58 | Post-Build QA Automation | ✅ done |
| — | AI Router (Claude + GPT-4 Vision providers) | ✅ done |
| — | framer-export (8th workspace package) | ✅ done |
| — | V3/V4 Isolation Test (dedicated, enforced) | ✅ done |
| 59 | V3-Setting-Validator & Render-Compat-Tabelle | ✅ implementiert und regression-getestet |
| 60 | WPCode-Helper (Safe-Interaction-Layer) | ✅ implementiert; weitere Vertrags-Tests als Folgearbeit |
| 61 | Render-Preview & Section-Render-Check | ✅ getestet |
| 62 | Setting-First-Policy & Editability-Score | ✅ implementiert; weitere Vertrags-Tests als Folgearbeit |
| 63 | Tree-Flattening & Nesting-Audit | ✅ implementiert; weitere Vertrags-Tests als Folgearbeit |
| 64 | Geometry-Probe & Structured Visual-Diff | ✅ implementiert; weitere Vertrags-Tests als Folgearbeit |
| 65 | Framer→Elementor Setting-Map | ✅ implementiert; weitere Vertrags-Tests als Folgearbeit |
| 66 | Token-Pipeline (Framer → Kit + Fonts + WPCode) | ✅ implementiert; weitere Vertrags-Tests als Folgearbeit |
| 67 | Design Critic (3-Layer QA) | ✅ lokale und serverseitige CLI-Anbindung vorhanden |
| 68 | Component-Resolver & CMS-Resolver | ✅ implementiert; weitere Vertrags-Tests als Folgearbeit |
| 69 | Section-Template-Library | ✅ V3+V4 vollständig, getestet |
| 70 | Novamira-Client & Deploy-Automatisierung | ✅ implementiert; Live-Verifikation nur mit Target/Credentials |
| 71 | Skill-Session & Build-Resume | ✅ implementiert; weitere Vertrags-Tests als Folgearbeit |
| 72 | V4-Pipeline-Hardening | ✅ Code vorhanden, Golden Path vorhanden |
| 73 | Healing-Loop ↔ Design-Critic Integration | ✅ durch serverseitige Design-Critic-Anbindung geschlossen |
| 74 | Offline E2E Golden Path (CI) | ✅ V3 + V4 vorhanden, beide grün |

## Aktueller verifizierter Stand — 2026-08-03

- `npx tsc --build --clean && npx tsc --build --pretty false` — grün.
- Serielle Vollsuite — grün: 114 Testdateien, 1273 Tests bestanden, 2 übersprungen, 0 Fehler/Timeouts; der bekannte Parallel-Timeout bleibt dokumentiert.
- Produktions-Lint — 0 Fehler und 0 Warnungen; die sechs `no-explicit-any`-Stellen wurden durch schmale Strukturtypen ersetzt.
- `git diff --check` — grün.
- Read-only MCP-Preflight — Session/Ability-Discovery und Read-back-/Cache-Verträge geprüft; echter V3-Live-Deploy bleibt wegen fehlendem WPCode Lite und fehlender Mutationsfreigabe blockiert.
- Phasen 100–115 — implementiert; offene Punkte sind vor allem große Deploy-Strategien, Remote-State/Adapter-Parität, Maintenance-Verträge und externe Live-Verifikation.

**Version:** 1.0.0
**Status:** BAUPLAN v5.0 Feature-Phasen 100–115 implementiert. Dieses Dokument ist die historische Phasenübersicht; der aktuelle Übergabestand liegt in `docs/TODO-OFFEN-2026-07-31.md`.

**P6:** Die zentrale `v3-container-normalize.ts`/`normalize.ts`-Kollision wurde behoben. Verbleibende technische Folgearbeiten und Testlücken sind im aktuellen TODO dokumentiert.

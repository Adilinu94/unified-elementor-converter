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
| 59 | V3-Setting-Validator & Render-Compat-Tabelle | 🟡 code vorhanden, ungetestet |
| 60 | WPCode-Helper (Safe-Interaction-Layer) | 🟡 code vorhanden, ungetestet |
| 61 | Render-Preview & Section-Render-Check | ✅ getestet |
| 62 | Setting-First-Policy & Editability-Score | 🟡 code vorhanden, ungetestet |
| 63 | Tree-Flattening & Nesting-Audit | 🟡 code vorhanden, ungetestet |
| 64 | Geometry-Probe & Structured Visual-Diff | 🟡 code vorhanden, ungetestet |
| 65 | Framer→Elementor Setting-Map | 🟡 code vorhanden, ungetestet |
| 66 | Token-Pipeline (Framer → Kit + Fonts + WPCode) | 🟡 code vorhanden, ungetestet |
| 67 | Design Critic (3-Layer QA) | 🟡 code vorhanden, ungetestet, keine CLI-Anbindung |
| 68 | Component-Resolver & CMS-Resolver | 🟡 code vorhanden, ungetestet |
| 69 | Section-Template-Library | ✅ V3+V4 vollständig, getestet |
| 70 | Novamira-Client & Deploy-Automatisierung | 🟡 code vorhanden, ungetestet |
| 71 | Skill-Session & Build-Resume | 🟡 code vorhanden, ungetestet |
| 72 | V4-Pipeline-Hardening | ✅ code vorhanden, golden-path-v4 grün |
| 73 | Healing-Loop ↔ Design-Critic Integration | 🔲 pending |
| 74 | Offline E2E Golden Path (CI) | ✅ V3 + V4 vorhanden, beide grün |

**Version:** 1.0.0
**Status:** BAUPLAN v2.0 complete. v3.0 (Phasen 59–74): Code für alle Module vorhanden.
Testabdeckung nachgezogen für: setting-first-css-generator/widget-mapper (Bugfix h1→h1
statt H1), setting-validator (Bugfix: Companion-Check wurde nie geprüft — golden-path-v3
war 32/100 statt ≥85), flatten-tree (Bugfix: entfernte Container haben ihre Kinder
verloren statt sie zu promoten — realer Content-Verlust), section-templates (V3+V4, neu),
design-critic (via golden-path-v4 + CLI-Test), render-preview, section-render-check
(3 Bugfixes: Farbvergleich hex↔rgb() war inkonsistent formatiert — jeder hex-
Erwartungswert wurde fälschlich als Mismatch gemeldet; gap-Shorthand-Vergleich prüfte
nur den ersten Wert, der zweite nie; `padding: 0` wurde durch einen truthy-Check wie
"nicht gesetzt" behandelt). **Weiterhin ohne dedizierte Tests:**
wpcode-helper, setting-first-policy, editability-score, nesting-audit, geometry-probe,
visual-diff-structured, setting-map, framer-tree-to-v3, token-pipeline,
component-resolver, cms-resolver, novamira-client, skill-session — 13 Module,
~3.300 Zeilen. Gegeben das Muster (3 von 4 bisher geprüften Modulen hatten echte
Bugs), sollte das vor weiterem Ausbau Priorität haben.
**Next:** Testabdeckung für die verbleibenden 13 Module.

**P6 (Barrel-Kollisionen, siehe CRITICAL-FAILURE-POINTS.md):** größter Einzelposten
behoben — `v3-container-normalize.ts` in `normalize.ts` gemerged (Phase 44 jetzt
tatsächlich erledigt, nicht nur markiert). Restliche offene Kollisionen siehe Datei.

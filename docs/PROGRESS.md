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
| 61 | Render-Preview & Section-Render-Check | 🟡 code vorhanden, ungetestet |
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
| 72 | V4-Pipeline-Hardening | 🔲 pending |
| 73 | Healing-Loop ↔ Design-Critic Integration | 🔲 pending |
| 74 | Offline E2E Golden Path (CI) | 🟡 nur V3, kein V4-Golden-Path |

**Version:** 1.0.0
**Status:** BAUPLAN v2.0 complete. v3.0 (Phasen 59–74): Code für 59–61, 63–68, 70–71 existiert bereits
(1:1-Bulk-Port aus site-clone-to-v3), ist aber **ohne dedizierte Unit-Tests** — siehe
`CRITICAL-FAILURE-POINTS.md`. Ein bereits gefundener, schweregrad-verfälschender Bug in
`setting-validator.ts` (Phase 59) kam nur durchs golden-path-v3-E2E ans Licht, nicht durch eigene Tests.
**Next:** Testabdeckung für 59–71 nachziehen, bevor weitere Phasen draufkommen.

# Session Handoff — weiter morgen

**Zuletzt aktualisiert:** 2026-07-25  
**Workspace:** `C:\Users\adini\Desktop\FramerPipline`  
**Antwortsprache mit User:** Deutsch  

Beim Fortsetzen: diese Datei + `docs/AI-EXECUTOR-PLAYBOOK.md` zuerst lesen.

---

## 1. Worum geht es?

Pipeline **beliebige Framer-/Marketing-URL → editierbares Elementor V3** auf WordPress (Novamira MCP).

| Repo | Rolle |
|---|---|
| `site-clone-to-v3` | V3 clone/any-URL, Patterns, QA, Playbook, Backlog |
| `Framer-to-Elementor-V4-Pipeline` | V4 Atomic, getrennt (kein Full-Merge) |
| Skill `framer-to-elementor-v3` | `~/.agents/skills/…` + Kopie unter `site-clone-to-v3/skills/…` |

**Pläne und Core-Code: site-agnostisch** (keine Kundennamen hardcoden).  
Ein Live-Testbeispiel existierte (post 4868, clinichub-2 auf testseite.nick-webdesign.de) — nur als Incident-Referenz, nicht als Produkt-Default.

---

## 2. Entscheidungen (stehen)

1. **Widget-first** — HTML nur Escape-Hatch (Budget ≤15 %).  
2. **Motion** = CSS-Klassen + WPCode (GSAP), nicht HTML-Struktur.  
3. **Design Critic** = 3 Schichten (Rules / Diff / Vision) — Architektur da, Code noch nicht.  
4. **P1–P10** priorisiert; empfohlene Implementierungsreihenfolge:  
   **P2 → P4 → P3 → P1 → P5 → P6 → P7 → P9 → P8 → P10**  
5. Zwei Repos bleiben getrennt; Wissen teilen, Schemas nicht mischen.  
6. **Scorecard shippable (aus starker KI, reviewed):** V/E/T/R/M mit Gewichten 30/30/15/15/10.  
   **Hard floors:** E ≥ 70 und M ≥ 60 — Pixel-Diff allein genügt nie.  
   Details: `docs/SCORECARD-V1-FROM-STRONGER-AI.md`.  
7. **IR (Paket B, reviewed):** Ziel-Pipeline Source→IR→Emitter(V3/V4); Motion = intent; HTML last-resort mit Budget.  
   Code erst **nach P2/P4** (MVP-Nodes). Doc: `docs/IR-V1-FROM-STRONGER-AI.md`.  
8. **Repair-Loop (Paket E, reviewed):** Allowlist-Mutationen, Stop PASS/PLATEAU/MAX, Regression-Guard; **P8**.  
   Doc: `docs/REPAIR-LOOP-V1-FROM-STRONGER-AI.md`.  
   **Plan-Änderung:** Architektur-Docs + P8/P4/P10 DoD — **keine** Umwälzung P2→P4-Reihenfolge.

---

## 3. Kritische Learnings (Praxis)

| Thema | Learning |
|---|---|
| WPCode | Immer **dual-write**: `post_content` **und** Option `wpcode_snippets` |
| Flex | Row-Kinder brauchen Width/`isInner` — sonst Stack → nicht sofort HTML |
| Header | Shell transparent; Pills stylen; Klasse `site-header` kann Theme-Hide treffen |
| Buttons/Images | Elementor-Defaults = full-bleed → page-scoped CSS resets |
| Done | Cache clear + Live-URL + Diff/Probes; nie nur MCP `success` |
| visual-diff | `scripts/visual-diff.mjs` läuft (Playwright, pixelmatch, pngjs) |
| **Orbit-Animation** | **`style.translate` statt `transform` oder `gsap.set`** — `translate` ist atomare CSS-Property und immun gegen V4s `transform: none !important`. CSS @keyframes + wrapper-rotation verursacht Sechseck-Verzerrung. Lösung: `requestAnimationFrame` + `item.style.translate`. Siehe `skills/framer-to-elementor-v3/references/v4-engine.md` und `patterns.md` Pattern C. |
| **V4-Engine Rendering** | Elementor 4.2.0 rendert V3 `_elementor_data` mit V4-Markup (`e-con-full`, `e-flex`, kein `.e-con-inner` auf full-width). CSS-Selektoren müssen das berücksichtigen. Vollständiger Cheat Sheet in `skills/framer-to-elementor-v3/references/v4-engine.md`. |
| **Komponenten-Playbooks** | Step-by-Step Build-Anleitungen pro Komponententyp in `skills/framer-to-elementor-v3/references/component-playbooks.md`.

---

## 4. Wichtige Docs (Repo `site-clone-to-v3`)

| Datei | Inhalt |
|---|---|
| `docs/AI-EXECUTOR-PLAYBOOK.md` | Praxis für schwächere Executor-KIs |
| `docs/PRODUCT-BACKLOG-P1-P10.md` | 10 Produktpunkte + DoD |
| `docs/DESIGN-CRITIC-ARCHITECTURE-2026-07.md` | Webdesigner-Audit-Architektur |
| `docs/VISUAL-QA-IMPROVEMENTS-2026-07.md` | Diff/Probes/Multi-Viewport |
| `docs/QUESTIONS-FOR-STRONGER-AI.md` | Briefings A–L für stärkere KI |
| `docs/SCORECARD-V1-FROM-STRONGER-AI.md` | Ship-Metriken V/E/T/R/M (reviewed) |
| `docs/IR-V1-FROM-STRONGER-AI.md` | Intermediate Representation (Paket B) |
| `docs/REPAIR-LOOP-V1-FROM-STRONGER-AI.md` | Closed-loop repair (Paket E → P8) |
| `docs/UMBAUPLAN-FRAMER-V3-COMPLETENESS-2026-07.md` | Phasen A–P + P1–P10 |
| `docs/UMBAUPLAN-FRAMER-V3-PROGRESS.md` | Status-Tracker |
| `docs/SESSION-HANDOFF.md` | **diese Datei** |

V4: `docs/AI-EXECUTOR-NOTES-V4.md`, Visual-QA, Umbauplan V0–V12.

---

## 5. Git-Stand (ca. Session-Ende)

- `site-clone-to-v3` `main`: u. a. `46397ef` QUESTIONS, `288cf32` scrub, `313878e` playbook/backlog, …  
- `Framer-to-Elementor-V4-Pipeline` `main`: u. a. `cab3a65` executor notes  

Vor Weiterarbeit: `git pull` auf beiden.

---

## 6. Empfohlener Start morgen

1. `git pull` in beiden Repos  
2. Diese Handoff + Playbook lesen  
3. **Code starten mit P2** (WPCode dual-write helper) **dann P4** (widget-first guards)  
4. Optional: restliche KI-Antwort zu Paket A (abgeschnitten) + Paket B (IR) oder E (Repair-Loop)  

**Nicht** als erstes: erneuter Full-Page-Rebuild ohne Gates.

---

## 7. Offene Produktfragen (strategisch)

- ~~IR zwischen Source und Elementor?~~ → **beantwortet** (`IR-V1-…`)  
- ~~Closed-loop repair mit Stop-Kriterien?~~ → **beantwortet** (`REPAIR-LOOP-V1-…`)  
- Eval/Gold-Suite offline? (Paket G noch offen)  
- V3-default vs V4-default 2026–27? (Paket L noch offen)  
- Region-Klassifikation (C), Motion-Policy (D), …  

Details: `QUESTIONS-FOR-STRONGER-AI.md`.

---

## 8. Agent-Memory

Long-term memories/lessons wurden unter agentmemory gespeichert (Konzepte: `framer-to-elementor-v3`, `widget-first`, `wpcode`, `handoff`).  
Retrieval: recall / memory search zu „Framer Elementor widget-first“ oder „WPCode dual-write“.

# IR v1 — Review & Adoption (Fragepaket B)

**Quelle:** Antwort stärkere KI auf `QUESTIONS-FOR-STRONGER-AI.md` Paket B  
**Review-Datum:** 2026-07-21  
**Status:** **architektonisch adopted** — Schema-Richtung fest; Code-IR noch nicht gebaut  
**Volltext-Quelle:** User-Datei `antort .txt` (Desktop)

---

## 1. Kurzbewertung

| Aspekt | Urteil | Kommentar |
|---|---|---|
| Diagnose (Lossy DOM→JSON) | **Stark** | Erklärt inkonsistente Trees, HTML-Escapes, nicht-portable Heuristiken |
| Pipeline Extract→IR→Emit | **Adopt** | Kein direkter Elementor-Emit aus Quellen — Zielzustand |
| Semantic / source-agnostic IR | **Adopt** | Passt zu site-agnostischer Produktregel |
| Node-Taxonomie | **Gut** | hero, stats_row, card_grid, marquee, faq, media_text decken Marketing ab |
| Motion als intent | **Adopt** | Entspricht CSS/GSAP via WPCode, nicht Roh-GSAP im Tree |
| Confidence + multi-source fusion | **Adopt (später)** | Screenshot-only path realistisch konservativ |
| Hybrid Design-System + Page | **Adopt** | Tokens global, Sections lokal; V3/V4 teilen Extractor |
| 90-Tage-Plan | **Zu aggressiv** | Für kleines Team/Agenten: IR-MVP nach P2/P4, nicht parallel alles |
| marquee → html default | **Abschwächen** | Bevorzugt: containers + track-CSS; html nur Escape |
| stats_row → optional html | **Ablehnen als Default** | Immer native heading/text; Animation im Snippet |

**Gesamtnote:** ~8.5/10 Architektur. Implementierung schrittweise, nicht Big-Bang.

---

## 2. Verbindliche Regeln (adopted)

1. **Zielzustand:** `Source → Extractor → IR (versioned JSON) → Validator → Emitter (V3 | later V4)`.  
2. **Kein** Core-Pfad „DOM/Screenshot → Elementor-JSON“ ohne IR (Agent-Workarounds live bleiben vorübergehend erlaubt bis IR existiert).  
3. **HTML im IR** nur mit `escape_reason` + zählt zum Budget (≤15 % leafs; optional Byte-Cap gegen Gaming).  
4. **Verboten im IR:** Roh-CSS der Seite, Elementor-Schema-Keys, Framer-IDs, Roh-JS, absolute Pixel-Layouts (außer bewusstem Overlay).  
5. **Motion:** `intent` + `trigger` + `params` + `fallback` — Emitter erzeugt Snippet/CSS.  
6. **Split:** `design_system` (tokens, typography, motion_system) + `page.sections` + overrides.  
7. **confidence < 0.7** → sichere Defaults (`section_type: generic`), kein spekulatives Fancy-Pattern.

---

## 3. Minimale IR-Oberfläche v1 (MVP)

Nicht alle 14 Node-Typen Tag-1. **MVP-Set:**

| type | Pflicht für MVP |
|---|---|
| `container` | ja |
| `heading` | ja |
| `text` | ja |
| `image` | ja |
| `button` / `button_group` | ja |
| `card` / `card_grid` | ja |
| `media_text` | ja |
| `stats_row` | ja |
| `faq` | ja |
| `navigation` | ja (sticky + glass flags) |
| `marquee` | ja (structure + motion intent; emit widget-first) |
| `html` | ja (last resort) |

Top-level: `ir_version`, `page.meta`, `page.design_system`, `page.sections[]` mit `section_type`, `layout`, `children`, optional `motion`.

Vollständige Schema-Skizze der KI-Antwort: siehe Original in Session/`antort .txt`; bei Implementierung als `schemas/page-ir-v1.json` formalisieren.

---

## 4. Mapping-Highlights (V3)

| IR | V3 Emitter | Guard |
|---|---|---|
| container row ohne child width | **fail** | layout_stack prevention |
| heading/text/image/button | native widgets | E-score |
| card_grid | row wrap + width fractions | |
| faq | accordion/toggle | |
| navigation sticky glass | transparent shell + pills | no theme `site-header` hide |
| marquee | track containers + CSS intent | not default full html blob |
| html | html widget | budget + escape_reason |

---

## 5. Validierung vor Emit (adopted checklist)

- Schema (id, type, layout/content)  
- unique IDs, no cycles  
- html leaf ratio ≤ 0.15  
- policy: hero has text content; card_grid ≥ 2; button has href; image has src/alt  
- **row children need width** (Stacking-Prevention — Live-Learning)  
- depth ≤ 5–8 (soft warn)  
- motion intent in allowlist; duration ≤ 2s  

---

## 6. Plan-Mapping (keine Umwälzung der P2→P4-Reihenfolge)

| Wann | Was |
|---|---|
| Jetzt | Dieses Doc + Scorecard; Code: **P2, P4** |
| Nach P4 | IR-Schema JSON + Validator unit tests (Phase „IR-MVP“) |
| Parallel P5 | Patterns emit from IR nodes, not ad-hoc trees |
| Später | DOM extractor 5 section types; confidence fusion; V4 emitter stub |

**Nicht** IR-Big-Bang vor WPCode dual-write und widget-first guards.

---

## 7. Top-Risiken (übernommen + priorisiert)

1. IR zu abstrakt → Emitter trägt >50 % Logik → iterativ verfeinern  
2. Confidence schlecht kalibriert (Vision-only) → Platform-Penalty  
3. V4-Schema drift → separater Emitter  
4. Overfit Framer → Eval multi-source  
5. HTML-Budget-Gaming (viele kleine html-Widgets) → **Bytes + equivalent count**  

---

## Related

- `SCORECARD-V1-FROM-STRONGER-AI.md` (E-floor erzwingt IR-Qualität am Emit)  
- `REPAIR-LOOP-V1-FROM-STRONGER-AI.md` (re_emit_section kehrt zum IR zurück)  
- `PRODUCT-BACKLOG-P1-P10.md` · `UMBAUPLAN-FRAMER-V3-COMPLETENESS-2026-07.md`

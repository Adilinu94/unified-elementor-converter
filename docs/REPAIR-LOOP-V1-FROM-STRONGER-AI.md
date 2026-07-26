# Closed-Loop Repair v1 — Review & Adoption (Fragepaket E)

**Quelle:** Antwort stärkere KI auf `QUESTIONS-FOR-STRONGER-AI.md` Paket E  
**Review-Datum:** 2026-07-21  
**Status:** **architektonisch adopted** für P8; Code noch nicht  
**Volltext-Quelle:** User-Datei `antort .txt` (Desktop)

---

## 1. Kurzbewertung

| Aspekt | Urteil | Kommentar |
|---|---|---|
| Diagnose (Noise, Ambiguität, Non-termination, Regression) | **Sehr stark** | Trifft exakt Live-Rebuild-Probleme |
| Allowlist-Mutationen | **Adopt** | Pflicht gegen „!important everywhere“ |
| Kanonische Issue-Typen | **Adopt** | deckt layout_stack, cache_stale, html_escape ab |
| Stop: PASS / PLATEAU / MAX / REGRESSION | **Adopt** | maxRounds=5 passt zu Playbook 2–3 (+ Puffer) |
| Match Source vs Absolute Quality | **Adopt** | Loop optimiert nur Match; A = Warnungen |
| Regression-Guard (bbox + tree) | **Adopt** | verhindert Header-fix killt Hero |
| Vision-LLM als Repair-Primäragent | **Ablehnen** (mit KI einig) | teuer, inkonsistent, nicht auditierbar |
| Q-Metriken in Antwort | **Alignen** | Antwort nutzt M=Motion; Scorecard nutzt M=Maintainability → **Scorecard A ist kanonisch** |
| E ≥ 0.80 im PASS | **Adopt als Floor** | konsistent mit Scorecard E hard floor (≥70, target ≥80 im Loop) |

**Gesamtnote:** ~9/10 Operations-Architektur. Bester Bauplan für **P8**.

---

## 2. Verbindliche Loop-Regeln

```
BUILD → DEPLOY → QA → SCORE → ISSUES(normalized)
  → select mutation(allowlist) → apply → flush cache
  → regression guard → converge? → PASS | ESCALATE
```

### Stop-Kriterien

| Kriterium | Bedingung | Aktion |
|---|---|---|
| PASS | Scorecard floors (E, M) + Q target + keine high/critical | fertig |
| PLATEAU | \|ΔQ\| < 0.02 für 2 Rounds | ESCALATE human |
| MAX ROUNDS | ≥ 5 | ESCALATE |
| REGRESSION | Q drop > 0.05 oder outside-bbox diff > 2–3 % | rollback best + forbid mutation |
| DIVERGENCE | marginal_score < -0.1 ×2 | abort + escalate |

### Hard floors (nicht verhandelbar)

- **E (Editability) darf nicht fallen** unter Start oder unter 70 — sonst REGRESSION  
- **html_widget** nie als Fix für Layout/size  
- **absolute_positioning**, Theme-Files, delete page = never-list  

---

## 3. Issue-Typen (Priorität für v1 Implementierung)

Zuerst implementieren (mappt auf Probes + Live-Bugs):

| type | Fix-Pfad |
|---|---|
| `layout_stack` | parent_layout + width_strategy |
| `size_mismatch` (buttons/images) | widget_setting → parent → css page-scoped |
| `cache_stale` | clear_cache (+ dual-write check) **first** |
| `html_escape` | re_emit_as_widget / re_emit_section |
| `position_shift` / media side | parent_layout (row-reverse etc.) |
| `color_deviation` / header glass | widget_setting + fix_snippet pills only |
| `motion_missing` / `motion_broken` | fix_snippet |
| `missing_element` / `extra_element` | add/remove (high risk) |

Schema-Felder pro Issue: `issue_id`, `canonical_type`, `severity`, `location` (section + widget_path + bbox), ref/actual, `allowed_fixes`, `forbidden_fixes`, `detection_method`, `confidence`.

---

## 4. Mutation-Allowlist (adopted)

**Erlaubt (priority order):**  
`clear_cache` (bei CSS-Verdacht zuerst) → `widget_setting` → `parent_layout` → `css_override` (page-scoped) → `fix_snippet` → `token_update` (selten) → `add_widget` / `remove_widget` / `re_emit_section` (high).

**Verboten:**  
`html_widget` als Layout-Fix, absolute positioning, body inline global, theme files, delete page.

**Nach fehlgeschlagener Mutation:** Mutation-Typ für dieses `issue_id` forbiden (kein Retry-Spam).

---

## 5. Match vs Absolute Quality

| Phase | Ziel | Blocker? |
|---|---|---|
| 1 Match Source | pixel/probe/style vs Referenz | ja — Loop arbeitet hier |
| 2 Absolute Quality | Kontrast, Typo, a11y, perf | nein — Warnungen, Human-Decision |

Repair optimiert **nicht** „schöner als Original“, wenn Original absichtlich anders ist.

---

## 6. Kopplung an IR (Paket B)

- Locations in **IR-Pfaden** (`section`, `widget_path`), nicht flüchtigen Elementor-IDs.  
- `re_emit_section`: IR patchen → V3-Emitter neu → nicht manuell kaputtes Elementor-JSON flicken.  
- Ohne IR: Loop darf temporär auf Tree-JSON + probes laufen; **Ziel** ist IR-basiert.

---

## 7. Mapping Backlog

| Item | Rolle |
|---|---|
| **P3** | Issues erzeugen (normalized probes) |
| **P1** | Design Critic → Issue feed |
| **P2** | cache_stale / dual-write = Voraussetzung |
| **P4** | html_escape prevention vor Repair |
| **P8** | dieser Loop (Allowlist + stop + regression) |
| **P10** | offline fixtures für Loop-Tests |
| Scorecard | Q + E/M floors |

**Implement order bleibt:** P2 → P4 → P3 → P1 → … → **P8**.  
P8 ohne P3 Issues und P2 Cache = sinnlos.

---

## 8. P8 DoD-Erweiterung (adopted)

```
[ ] Issue schema + normalize()
[ ] Allowlist mutator registry (min: clear_cache, widget_setting, parent_layout, css_override, fix_snippet)
[ ] maxRounds + plateau + regression rollback
[ ] E floor cannot regress
[ ] never-list enforced in tests
[ ] history log audit (JSON)
[ ] ESCALATE payload: best_state + reason + open issues
```

---

## 9. 90-Tage (realistisch gekürzt)

| Fenster | Fokus |
|---|---|
| Nach P2–P4 | Issue schema + 5 Typen + manuell getriggerter 1-Round fix |
| +P3/P1 | auto issues + 3-round loop local |
| P8 full | regression guard + escalate + CI hook |

KI-Plan „50 Seiten CI in 90 Tagen“ = aspirational, nicht Commitment.

---

## 10. Top-Risiken (übernommen)

1. Pixel-Noise → Phantom-Issues → structural probes priorisieren  
2. Allowlist zu eng → ESCALATE-Review monatlich  
3. cache_stale als Layout missklassifiziert → clear_cache first  
4. Regression-Guard FP → 2–3 % outside-bbox Tolerance  
5. Loop opfert E für V → **E hard floor**  

---

## Related

- `SCORECARD-V1-FROM-STRONGER-AI.md`  
- `IR-V1-FROM-STRONGER-AI.md`  
- `PRODUCT-BACKLOG-P1-P10.md` (P8)  
- `AI-EXECUTOR-PLAYBOOK.md` (fix loop max 2–3; P8 formalisiert)

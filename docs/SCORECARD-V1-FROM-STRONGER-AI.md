# Scorecard v1 — Review & Adoption (Fragepaket A)

**Quelle:** Antwort einer stärkeren KI auf `QUESTIONS-FOR-STRONGER-AI.md` Paket A  
**Review-Datum:** 2026-07-21  
**Status:** **teilweise adopted** — Kern-Idee und Gewichte übernommen; Formeln/Thresholds mit Korrekturen unten  
**Antwort war unvollständig** (ab „Warum nicht die naheliegende Alternative“ abgeschnitten) — fehlende Teile (90-Tage-Plan, Scope, Top-5-Risiken) später nachreichen wenn möglich.

---

## 1. Kurzbewertung der Antwort

| Aspekt | Urteil | Kommentar |
|---|---|---|
| Diagnose | **Stark** | Kernproblem korrekt: ohne Trade-off-Metrik optimieren Agenten auf Pixel-Diff → HTML-Blobs |
| 5-Metrik-Scorecard V/E/T/R/M | **Stark** | Richtige Achsen; deckt Business-Ziel (Editierbarkeit) ab |
| Gewichte 30/30/15/15/10 | **Gut als Start** | V und E gleich gewichtet = explizites Signal gegen Blob-Bias |
| FP/FN pro Metrik | **Sehr gut** | Pflichtlektüre für Executor-AIs und Gate-Design |
| E-Formel (Container-Tiefe) | **Nachbessern** | `1/depth` ungebunden; flache Bäume und tiefe Bäume brauchen Bounds |
| T als 1/T im Score | **Vorsicht** | Braucht Cap/Norm; sonst dominiert oder verschwindet T |
| R mit 20 URLs | **Später** | Für v1 zu teuer; R erst nach Gold-Suite (P10) sinnvoll |
| Binary Pixel-Diff ablehnen | **Richtig** | Passt 1:1 zu unseren Live-Lessons |

**Gesamtnote:** ~8/10 als Product-Contract-Entwurf. Nicht blind als Code-Formel kopieren — Hard Floors + normierte Teil-Scores.

---

## 2. Adoptierte Architektur (verbindlich für Produkt)

### 2.1 Metriken

| ID | Name | Gewicht (Score) | Hard Floor (ship) | Primär messbar wie |
|---|---|---|---|---|
| **V** | Visual Fidelity | 30 % | ≥ 70/100 soft; ≥ 85 target | pixelmatch + optional Vision + structural probes |
| **E** | Editability | 30 % | **≥ 70/100 Pflicht** | Tree: native-widget-Anteil, HTML-Budget, Labels, Hero/CTA ohne HTML-Inhalt |
| **T** | Time-to-Green | 15 % | informativ v1 | Wall-clock Start→Scorecard-PASS |
| **R** | Robustness | 15 % | n/a v1 | Erfolgsrate über URL-Set + Repair-Close-Rate (später) |
| **M** | Maintainability | 10 % | **≥ 60/100 Pflicht** | Snippet-Zahl, CSS-Linien, dual-write/cache check |

### 2.2 Shippable-Regel (wichtiger als die Summe)

```
SHIPPABLE :=
  E >= 70
  AND M >= 60
  AND keine Critical-Probes fail (Header shell, overflow, html-budget hard fail)
  AND (weighted_score >= 75  OR  (V >= 85 AND E >= 80))
```

**Begründung:** Gewichteter Score allein darf keinen HTML-Blob mit V=95 durchlassen.  
Hard Floors auf **E** und **M** sind die Anti-Blob- und Anti-Stale-Cache-Invarianten.

### 2.3 Gewichteter Score (nach Floors)

```
Score = 0.30×V_norm + 0.30×E_norm + 0.15×T_score + 0.15×R_norm + 0.10×M_norm
```

- Alle `*_norm` ∈ [0, 1]  
- **T_score:** linear invertieren mit Cap, z. B.  
  `T_score = clamp(1 - (minutes / 60), 0, 1)`  
  (nicht rohes `1/T` — bei 1 min würde T den Score verzerren)  
- **R:** bis Gold-Suite fehlt → `R_norm = 0.5` (neutral) oder Metrik aus Report ausblenden und Gewichte auf V/E/M umlegen

---

## 3. Metrik-Specs (übernommen + korrigiert)

### V — Visual Fidelity (0–100)

- Messung: Screenshot-Diff (pixelmatch, threshold ~0.1) + optional Vision (Layout, Typo, Farbe, Abstand, Bilder) + **structural probes** (P3)
- Target PASS: ≥ 85  
- Soft warn: 70–84  
- **FP:** Fonts/Antialiasing → hoher Diff trotz guter DOM-Parität  
- **FN:** HTML-Blob sieht perfekt aus → deshalb V nur 30 % und E-Floor

### E — Editability (0–100)

Vorschlag stärkere KI (Roh):

```
E = 50×(native/total)
  + 20×(1/avg_container_depth)
  + 15×(labeled_sections/total_sections)
  + 15×(no_html_in_hero_or_cta ? 1 : 0)
```

**Korrektur v1 (implementierbar, bounded):**

```
E = 40× clamp(native/total, 0, 1)
  + 25× html_budget_score          // 1 if html/total ≤ 0.15; 0 if ≥ 0.40; linear dazwischen
  + 15× structure_score            // sections ≥ N containers mit css_classes; depth in [2, 8] ideal
  + 10× (zero_content_img_in_html ? 1 : 0)
  + 10× (no_html_in_hero_or_cta ? 1 : 0)
```

- PASS Floor: **≥ 70**  
- **FP:** 100 % native, aber ein flacher Mega-Container  
- **FN:** bewusstes HTML für SVG-Animation — Escape mit Reason-Flag darf E nicht hart killen (Budget-Slot)

Mappt direkt auf **P4 guards**.

### T — Time-to-Green

- Ziel aspirational: ≤ 15 min Standard-Landing (5–8 Sections)  
- PASS informativ: ≤ 30 min  
- **Nicht** als Deploy-Blocker v1 (Agent-Umgebung schwankt)  
- **FP:** schneller Blob-Build  
- **FN:** langsamer Widget-first-Build — deshalb nie T über E priorisieren

### R — Robustness (später)

- 50 % Erfolgsrate über diversem URL-Set  
- 30 % Selbstheilungsrate (P8)  
- 20 % niedrige Varianz der anderen Metriken  
- PASS ≥ 60 — erst sinnvoll mit **P10** + ≥5–10 Fixtures (20 URLs = Meilenstein, nicht Tag-1)

### M — Maintainability (0–100)

Roh-Idee (gut):

- 40 % Snippet-Count (≤3 → 100 %, >10 → 0 %)  
- 30 % Cache-Invalidierung / dual-write OK nach Deploy  
- 30 % CSS-Linien pro Snippet (≤200 → 100 %, >1000 → 0 %)

**Korrektur:** Inline-CSS in HTML-Widgets zählt zu „schlecht“ (sonst FP bei wenigen Snippets).  
Mappt auf **P2** (dual-write) + Snippet-Hygiene im Playbook.

---

## 4. Scope (aus Antwort + unserer Praxis ergänzt)

### In scope v1 Pipeline

- Widget-first V3 Tree + HTML-Budget  
- WPCode CSS/JS (Fonts, Layout-Polish, begrenzte GSAP-Motion)  
- Visual QA + Probes + einfache Rules (Design Critic S1)  
- Scorecard: mindestens **E + M floors + V report**  
- Site-agnostische Config (`clone.config` / Design Profile)

### Bewusst out of scope v1

- Volle Framer-Motion-Parität  
- Perfekter Pixel-Match bei Webfonts  
- R über 20 Live-URLs in CI  
- Automatischer V4-Atomic-Default  
- Geschlossener multi-agent Repair ohne Stop-Kriterien (P8 nur allowlisted)

---

## 5. Mapping auf bestehenden Backlog (keine Umwälzung)

| Scorecard | Bereits geplante Arbeit | Aktion |
|---|---|---|
| E | **P4** widget-first guards | E-Score in Guard-Report ausgeben |
| M | **P2** WPCode dual-write | dual-write-Check als M-Teil |
| V | **P1, P3, P6, P9** | probes + critic speisen V |
| R | **P8, P10** | später |
| T | Orchestrator / CLI Timestamps | easy logging, kein Blocker |

**Implement-Order bleibt:**  
**P2 → P4 → P3 → P1 → …**  
Scorecard ändert die **Definition of Done**, nicht die Reihenfolge der Fundamente.

---

## 6. Plan-Änderungen (beschlossen)

1. **Ja, leicht:** Scorecard als verbindliche Ship-Definition (diese Datei + Handoff + Playbook-Hinweis).  
2. **Nein, kein Rewrite** von Umbauplan-Phasen A–P oder P1–P10-Liste.  
3. **P4 DoD erweitern:** Guard-Report enthält `editabilityScore` + hard fail bei E &lt; 70 oder html-budget.  
4. **P10 DoD erweitern:** CI prüft composite scorecard floors, nicht nur pixel %.  
5. Fehlende Antwortteile (90-Tage, Risiken, Experimente) — wenn User restliche KI-Antwort liefert, hier nachziehen.

---

## 7. Nächste Experimente (klein, messbar)

1. Nach erstem P4-PR: E-Score auf ClinicHub-Tree (Referenz) und auf absichtlichem HTML-Blob-Tree laufen lassen — Blob muss failen.  
2. V: visual-diff + 3 structural probes vs. reiner pixel % — Blob darf V nicht allein „retten“.  
3. M: Deploy ohne dual-write → M-Fail simulieren.

---

## Related

- `QUESTIONS-FOR-STRONGER-AI.md` — Paket A  
- `PRODUCT-BACKLOG-P1-P10.md`  
- `AI-EXECUTOR-PLAYBOOK.md`  
- `SESSION-HANDOFF.md`

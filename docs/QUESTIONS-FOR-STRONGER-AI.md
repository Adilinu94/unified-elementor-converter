# Briefings & Fragen an eine deutlich klügere KI (ohne Projektwissen)

**Zweck:** Diese Datei enthält **selbstständige** Fragepakete.  
Jede Frage enthält genug Kontext, dass ein Modell **ohne** Zugang zu diesem Repo, ohne Vorwissen über „ClinicHub“, Novamira oder eure Historie sinnvoll antworten kann.

**Wie nutzen:** Ein Paket (A–L) pro Session kopieren. Antwort erbitten als: Annahmen, Empfehlung, Alternativen, Risiken, messbare Erfolgskriterien, konkrete nächste Experimente.

**Produkt in einem Satz:**  
Automatisierte und agentengestützte Pipeline, die **beliebige moderne Marketing-Websites (häufig Framer)** in **editierbare Elementor-Seiten auf WordPress** überführt — visuell nah am Original, aber mit nativen Widgets statt „Screenshot in HTML“.

---

# Gemeinsamer Kontext (für alle Fragen gültig)

Bitte lies diesen Block, bevor du antwortest.

## Problem

Agenturen und Freelancer sollen Kunden-Websites (oft in **Framer** gebaut: animiert, pixelgenau, flexibles DOM) auf **WordPress + Elementor** nachbauen, damit der Kunde die Seite später **selbst im Page Builder** pflegen kann (Texte, Bilder, Buttons).

Elementor gibt es in zwei Welten:

- **V3 (Legacy Containers):** Flexbox-Container + klassische Widgets (`heading`, `image`, `button`, `html`, …). Weit verbreitet, gut editierbar.
- **V4 (Atomic):** andere Widget-Typen, Global Classes, spezielles Style-Format. Mächtiger, aber anderer Build-Pfad.

Ein naives Vorgehen — „alles als ein HTML-Widget speichern“ — sieht oft schnell gut aus, ist aber **nicht wartbar** (Kunde kann kaum etwas ändern).  
Ziel ist daher **Widget-first**: Struktur = Container, Inhalt = native Widgets, Animationen = externes CSS/JS (z. B. über ein Snippet-Plugin wie WPCode).

## Typische technische Umgebung

- WordPress self-hosted  
- Elementor (+ oft Elementor Pro)  
- Agent steuert WordPress über **MCP/Abilities** (z. B. Content setzen, PHP sandbox, Datei-Upload, Snippets)  
- Quellen für das Original: Live-URL, Screenshots, optional Framer-Export / Drittanbieter-MCP für Framer-Struktur, CSS-Tokens  
- Qualität wird geprüft mit: Screenshot-Diff (pixelmatch), optional Vision-LLM, Heuristiken (Computed Styles, Bounding Boxes)

## Bekannte harte Grenzen

- Framer-Motion ≠ Elementor-Widgets. Komplexe Scroll-/Orbit-/Marquee-Effekte müssen **nachgebildet** werden (CSS/GSAP), nicht 1:1 portiert.  
- Elementor-Flex hat Fallstricke (verschachtelte Container werden oft 100 % breit und „stacken“ statt nebeneinander).  
- CSS kann in mehreren Schichten liegen (Theme, Elementor-Kit, generiertes CSS, Snippet-Plugin-Cache) — ein „Update“ ist sichtbar nicht, wenn der Cache/Option-Store nicht mitgezogen wird.  
- „MCP sagt success“ heißt nicht, dass das Frontend stimmt (Elementor Element-Cache).  
- Jede Quellseite ist anders; feste Pixel-Bänder für „Hero = 0–900px“ brechen.

## Was bereits als Richtung feststeht (nicht neu erfinden, außer du widersprichst mit Begründung)

- Widget-first, HTML nur Escape-Hatch (Budget z. B. ≤15 % der Widgets)  
- Nach Deploy: visuelle QA + optionale „Design Critic“-Schicht (Regeln + Diff + Vision)  
- Pläne und Generatoren sollen **site-agnostisch** sein (keine hardcodierten Kundennamen/Klassen im Core)  
- Zwei Repos: eines für **V3 any-URL/clone**, eines für **V4 Atomic-Pipeline** — absichtlich nicht voll gemerged  

## Gewünschtes Antwortformat (für alle Fragen)

1. **Kurze Diagnose** des Kernproblems  
2. **Empfohlene Architektur** (Komponenten, Datenflüsse)  
3. **Warum nicht die naheliegende Alternative**  
4. **Invarianten / Tests**, die man automatisieren kann  
5. **90-Tage-Plan** in 3 Meilensteinen für ein kleines Team / Agenten-Pipeline  
6. **Top-5 Risiken** und wie man sie früh erkennt  

---

# Fragepaket A — Zielmetrik & Scope

**Rolle:** Du bist Principal Product Engineer für Developer-Tools im Web-Agentur-Markt.

**Kontext:**  
Wir bauen eine Pipeline „Marketing-Site (oft Framer) → WordPress Elementor V3, editierbar“. Stakeholder wollen manchmal „pixel-perfect wie Framer“, manchmal „schnell und vom Kunden pflegbar“. Ohne klare Metrik optimieren Agenten auf das Falsche (z. B. HTML-Blobs oder endloses Polish).

**Frage:**  
Entwirf ein **Scorecard-System** (3–7 Kennzahlen), mit dem wir objektiv sagen können: „Dieser Clone ist shippable.“  
Berücksichtige explizit die Trade-offs:

- visuelle Treue zum Original  
- Editierbarkeit in Elementor (kein HTML-Friedhof)  
- Zeit bis „grün“ (Agent + Mensch)  
- Robustheit über viele unterschiedliche Quell-URLs  
- Wartbarkeit (CSS/JS-Snippets, Caches)

Sag klar:

- was **in scope** für v1 der Pipeline ist  
- was **bewusst out of scope** ist (z. B. volle Framer-Motion-Parität)  
- welche Metriken **automatisch** messbar sind vs. menschliche Review brauchen  
- welche Mindestschwellen du für „PASS“ vorschlägst und warum  

Gib Beispiele für False Positives/Negatives jeder Metrik.

**Antwort-Status:** Teilantwort reviewed 2026-07-21 → Adoption in  
[`SCORECARD-V1-FROM-STRONGER-AI.md`](./SCORECARD-V1-FROM-STRONGER-AI.md)  
(Kern übernommen; E-Formel/T-Norm/R-Scope korrigiert; Hard Floors ergänzt).  
Vollständige Antwort (90-Tage-Plan, Risiken) fehlte / war abgeschnitten.

---

# Fragepaket B — Intermediate Representation (IR)

**Rolle:** Du bist Language/Compiler-Architekt mit Erfahrung in Design-to-Code.

**Kontext:**  
Heute gehen Agenten oft direkt von Screenshots/DOM zu Elementor-JSON. Das führt zu inkonsistenten Trees, HTML-Escapes und schlechter Wiederverwendung.  
Elementor V3 und V4 haben **unterschiedliche** Zielmodelle. Wir wollen trotzdem möglichst **eine** Analyse-Pipeline für die Quelle.

**Frage:**  
Entwirf ein **minimales, versioniertes Intermediate Representation (IR)** für Marketing-Landingpages, das:

1. aus Live-DOM / Screenshots / optional Framer-Export befüllbar ist,  
2. genug Semantik hat (Header, Hero, Metrics, Card-Grid, Marquee, FAQ, Footer-CTA, Tokens, Motion-Intent),  
3. **deterministisch** nach Elementor V3 (Containers + Widgets) mappt,  
4. später auf V4 Atomic erweiterbar ist,  
5. HTML nur als last-resort Node-Typ kennt.

Liefere:

- JSON-Schema-Skizze (Kern-Typen, Pflichtfelder)  
- Regeln, was **nicht** ins IR darf (z. B. rohes CSS der ganzen Seite)  
- Mapping-Tabelle: IR-Node → V3-Widgets  
- wie Motion modelliert wird (`intent` + Parameter, nicht rohes GSAP)  
- wie man IR aus unzuverlässigen Quellen (nur Screenshot) mit Confidence-Scores füllt  
- Validierungsregeln vor dem Elementor-Emit  

Diskutiere, ob IR seitenlokal oder „Design-System + Page-Instance“ splitten sollte.

**Antwort-Status:** Vollantwort reviewed 2026-07-21 → Adoption in  
[`IR-V1-FROM-STRONGER-AI.md`](./IR-V1-FROM-STRONGER-AI.md)  
(Extract→IR→Emit, Motion-intent, Confidence, Hybrid Design-System; MVP-Nodes; kein Big-Bang vor P2/P4).

---

# Fragepaket C — UI-Region-Klassifikation

**Rolle:** Du bist Computer-Vision- und Document-Understanding-Experte.

**Kontext:**  
Um Patterns und QA-Section-Crops zu fahren, müssen wir wissen: „Das ist der Hero, das die Stats-Zeile, das ein Card-Grid.“  
Signale können sein: DOM-Struktur, `data-framer-name`, Screenshots, Textgrößen, Wiederholungsmuster von Karten.

**Frage:**  
Beschreibe ein **produktionsreifes Klassifikationssystem** für Section-/Component-Rollen auf Marketing-Seiten:

- Label-Set (max. 15–25 Labels, begründet)  
- Feature-Quellen (DOM vs. Vision vs. hybrid) und wann welche dominiert  
- wie man mit Mehrdeutigkeit umgeht (z. B. Hero ohne Bild, FAQ ohne Accordion-Markup)  
- Trainings-/Eval-Strategie **ohne** große manuell gelabelte Datensätze am Anfang (bootstrapping)  
- Fehlerkosten: was ist schlimmer — false header vs. false card-grid?  
- wie das Label die **Builder-Strategie** steuert (nicht nur QA)

Gib eine Entscheidungsmatrix: Label → erlaubte Elementor-Strategien → verbotene Shortcuts.

---

# Fragepaket D — Motion-Policy

**Rolle:** Du bist Motion Designer + Frontend-Performance-Lead.

**Kontext:**  
Framer-Seiten nutzen oft Sticky Glass Header, Scroll-getriebene Textreveals, rotierende Bild-Cluster, infinite Marquees, Hover-Microinteractions.  
Elementor V3 hat dafür keine 1:1-Primitives. Wir implementieren Motion typischerweise als:

- CSS auf Widget-/Container-Klassen  
- GSAP/ScrollTrigger in page-scoped Snippets  

Das ist fehleranfällig und schwer zu QA-en.

**Frage:**  
Erstelle eine **Motion-Policy** für die Pipeline:

1. Taxonomie von Motion-Klassen (5–12 Typen)  
2. Pro Typ: **unterstützt / best-effort / droppen** in V3  
3. Kanonische Implementierung (CSS vs. JS, Performance, `prefers-reduced-motion`)  
4. wie Motion im IR beschrieben wird  
5. QA: wie erkennt man „Motion fehlt“ oder „Motion kaputt“ automatisiert (nicht nur Screenshot bei t=0)  
6. wann man dem Kunden kommunizieren muss: „dieser Effekt wird vereinfacht“

Priorisiere nach Impact auf wahrgenommene Qualität vs. Implementierungs- und Wartungskosten.

---

# Fragepaket E — Closed-Loop Repair

**Rolle:** Du bist Forscher für Autonomous Software Agents und Test-Repair-Loops.

**Kontext:**  
Aktueller Wunsch-Workflow:

```
bauen → deployen → visual diff / design critic → issues → fix → erneut messen
```

Probleme:

- Pixel-Diff ist verrauscht (Fonts, Antialiasing)  
- Vision-LLM ist teuer und inkonsistent  
- Elementor-Fixes können Tree, Widget-Settings oder externes CSS sein  
- Ohne Stop-Kriterien polieren Agenten endlos  

**Frage:**  
Entwirf einen **geschlossenen Repair-Loop** mit:

- Issue-Normalisierung (kanonische IDs, Severity, erlaubte Fix-Aktionen)  
- Allowlist von Mutationen (was darf der Agent ändern, was nie)  
- Scoring-Funktion, die **konvergiert** (oder beweisbar terminiert)  
- max rounds, plateau detection, human escalation triggers  
- wie man verhindert, dass ein Fix A Problem B erzeugt (Regressions-Set)  
- Trennung: „match source“ vs. „absolute design quality“ in der Zielfunktion  

Gib Pseudocode für den Loop und ein Beispiel mit 3 typischen Issues (zu großer Button, Header-Volle-Breite-Hintergrund, Media-Spalte vertauscht).

**Antwort-Status:** Vollantwort reviewed 2026-07-21 → Adoption in  
[`REPAIR-LOOP-V1-FROM-STRONGER-AI.md`](./REPAIR-LOOP-V1-FROM-STRONGER-AI.md)  
(Allowlist, Stop-Kriterien, Regression-Guard, Match vs Absolute Quality → P8 DoD erweitert).

---

# Fragepaket F — Elementor-V3-Layout-Invarianten

**Rolle:** Du bist Experte für CSS Flexbox und Page-Builder-Internals.

**Kontext:**  
In Elementor V3 führen verschachtelte Containers mit `content_width: full` oft dazu, dass Flex-**Row**-Kinder faktisch 100 % breit werden und untereinander stacken.  
Agenten „lösen“ das fälschlich mit HTML-Widgets.  
Zusätzlich sind Schema-Keys je nach API inkonsistent (manches Width-Setting wird gespeichert, erzeugt aber kein CSS).

**Frage:**  
Formuliere ein **formales Regelwerk / Invariantenset**, das ein Builder **vor dem Deploy** und ein QA-Modul **nach dem Deploy** prüfen kann:

- welche Tree-Eigenschaften verhindern Stacking in Rows  
- welche Width-Strategien (%, px, grow/shrink) für Cards, Stats, Side-Media  
- wie man absolute/fixed Header-Shells modelliert, ohne Full-Bleed-Background-Bugs  
- welche Checks **statisch am JSON-Tree** möglich sind vs. nur im Browser (computed style)  
- empfohlene Default-Normalisierungspass-Pipeline vor jedem Push  

Liefere die Regeln so, dass eine schwächere KI sie als Checkliste abarbeiten kann, ohne Flexbox-Experte zu sein.

---

# Fragepaket G — Evaluations-Suite (Gold Set)

**Rolle:** Du bist ML-Eval- und Dataset-Designer.

**Kontext:**  
Wir brauchen CI und Offline-Tests, die **nicht** von einer live erreichbaren Kunden-Framer-Seite abhängen.  
Gleichzeitig sollen sie reale Komplexität abdecken (Header overlay, cards, FAQ, motion light).  
Copyright und Datenschutz sind ein Thema, wenn man fremde Sites speichert.

**Frage:**  
Designe eine **Eval-Suite** mit 30–100 Fällen:

- wie du Fixtures generierst (synthetisch vs. anonymisierte Captures vs. selbst gebaute Mini-Sites)  
- Schichten: unit (guards), integration (IR→tree), visual (screenshot baselines), e2e (mock MCP)  
- Labeling: was ist „akzeptables Output“ (mehrere erlaubte Trees?)  
- Flakiness-Kontrolle bei Screenshots  
- Lizenz-/Ethik-Strategie  
- wie schwächere Executor-Modelle an der Suite trainiert/kalibriert werden (wenige Shots, nicht Fine-Tune)  

Schlage ein MVP mit **10 Fixtures** vor (Inhalt jeder Fixture in 2–3 Sätzen).

---

# Fragepaket H — Human-in-the-loop Minimalfragen

**Rolle:** Du bist UX-Researcher für Profi-Tools.

**Kontext:**  
Volle Automatisierung scheitert an Mehrdeutigkeit (Farben aus Blueprint vs. Framer, Header-Typ, Motion-Level).  
Jeder Klick kostet Zeit; zu viele Fragen töten den Flow.

**Frage:**  
Identifiziere die **3–5 Fragen an den Menschen**, die pro neuem Clone-Job den größten Qualitätsgewinn pro Sekunde bringen.

Pro Frage:

- genauer Wortlaut  
- Antwortoptionen  
- was die Pipeline intern umschaltet  
- was passiert bei Default/Skip  
- wann die Frage **nicht** gestellt wird (Auto-Detect confidence hoch)

Ziel: max. 60–90 Sekunden menschliche Interaktion vor dem Build.

---

# Fragepaket I — V3 vs V4 Produktstrategie

**Rolle:** Du bist CTO einer Agentur-Automation-Firma.

**Kontext:**  
Zwei Codepfade:

- V3: bessere Any-URL/Clone-Story, klassische Widgets, breite Host-Kompatibilität  
- V4: Atomic, Global Classes, modern, aber andere Skills/Schemas und oft unreifere Hosts  

Ressourcen sind begrenzt; doppelte Feature-Parität ist teuer.

**Frage:**  
Empfiehl eine **klare Default-Strategie 2026–2027**:

- wann nur V3  
- wann nur V4  
- wann dual  
- welche Features nur in einem Stack existieren dürfen  
- wie man Kunden/Agenten die Entscheidung abnimmt (Capability detection)  
- Exit-Kriterien, wann man V3 einfrieren und nur noch V4 ausbauen sollte  

Beziehe Business-Risiko (Elementor-Roadmap-Unsicherheit) ein.

---

# Fragepaket J — Failure Taxonomy & kanonische Fixes

**Rolle:** Du bist Staff Engineer, der On-Call-Playbooks schreibt.

**Kontext:**  
Wiederkehrende Fehlerklassen aus realen Rebuilds (verallgemeinert):

- Header-Hintergrund über volle Breite statt Glass-Pills  
- Buttons unnatürlich groß / full width  
- Bilder sprengen das Layout  
- Flex-Rows stacken  
- CSS-Änderungen kommen nicht an (Snippet-Cache)  
- falsche Spaltenreihenfolge (Media links/rechts)  
- zu viele HTML-Widgets  
- Theme überschreibt Typo/Farben  
- Motion fehlt oder läuft ohne Page-Scope site-wide  

**Frage:**  
Erstelle eine **Failure Taxonomy** mit 20–30 IDs:

Pro ID:

- Symptom (Mensch)  
- wahrscheinliche Ursache  
- Detektion (automatisch: DOM/CSS/Screenshot/Tree)  
- **ein** kanonischer Fix (nicht fünf Optionen)  
- Severity  
- Prevention (Guard vor Deploy)

Gruppiere nach Phase: extract / build / deploy / runtime CSS / QA.

Die Taxonomy soll so geschrieben sein, dass ein schwächeres Modell **nur die ID + Fix** ausführt, ohne zu improvisieren.

---

# Fragepaket K — Ökonomie für schwache Executor-Modelle

**Rolle:** Du bist AI-Systems Engineer für Cost/Quality-Tradeoffs.

**Kontext:**  
Planung kann mit starken Modellen passieren; **Umsetzung** oft mit billigeren/schwächeren.  
Die ignorieren lange Docs, halluzinieren Schema-Keys, skippen QA.

Wir haben bereits ausführliche Playbooks und Backlogs — aber Papier allein reicht nicht.

**Frage:**  
Welche **20 % der Maßnahmen** bringen **80 % Erfolgsrate**, wenn der Executor schwach ist?

Bewerte u. a.:

- harte Guards im Code vs. längere Prompts  
- kleinere Tools mit strengen Schemas  
- erzwungene Checklisten als Maschinen-Gates  
- weniger Freiheitsgrade im IR→Tree-Compiler  
- wann Vision lohnt vs. nur Regeln  
- wie man „Done“ lügensicher macht (der Executor kann nicht behaupten, grün zu sein, ohne Artefakte)

Gib eine priorisierte Liste mit geschätztem Implementierungsaufwand (S/M/L) und Impact (S/M/L).

---

# Fragepaket L — Täuschungsresistente Definition of Done

**Rolle:** Du bist Auditor für KI-generierte Deliverables.

**Kontext:**  
Executor-Modelle markieren Tasks als erledigt, weil MCP `success: true` zurückgab.  
Stakeholder sehen später eine kaputte Seite.

**Frage:**  
Definiere eine **maschinenprüfbare Definition of Done** für „Framer/Marketing-Site → Elementor-Clone shippable“, die:

- ohne menschliche Gutmütigkeit auskommt  
- aus CI oder einem `qa-gate`-Command als exit code 0/1 resultiert  
- folgende Dimensionen abdeckt: Tree-Guards, Deploy-Verify, Frontend-Presence, Visual/Geometry, Widget-Budget, Snippet-Sync  
- klar trennt: **Blocker** vs. **Warnings**  
- Hybrid-Absicht (bewusste Abweichung vom Source) als signierte Config erlaubt, nicht als Ausrede  

Liefere das als spezifizierten Gate-Report (JSON-Felder) + Policy: was darf Warning bleiben, was nie.

---

# Meta-Frage (optional, am Ende einer Session)

Nachdem du die Pakete A–L (oder eine Teilmenge) beantwortet hast:

> Konsolidiere die **eine Architekturentscheidung**, die den größten multiplikativen Effekt auf Qualität × Kosten × Robustheit über viele URLs hat.  
> Formuliere sie als ADR (Context, Decision, Consequences, Alternatives rejected).

---

# Hinweise an die befragte KI (kurz)

- Antworte konkret und operationalisierbar; vermeide generische „nutze Best Practices“-Phrasen ohne Mechanismus.  
- Wenn du Trade-offs siehst, entscheide dich und begründe.  
- Nenne Annahmen über Elementor/WordPress explizit.  
- Bevorzuge Lösungen, die **schwache Executor-Agenten** entlasten (weniger Freiheit, mehr Gates).  
- Keine Abhängigkeit von einem einzelnen Kundenprojekt oder Branding.

# Deterministic-First-Pipeline mit KI-Fallback — Review & Ergänzung

> **Bezug:** Review des beigefügten Plans „Umbauplan: Deterministic-First-Pipeline mit KI als kontrolliertem Fallback" gegen den tatsächlichen Code- und Dokumentationsstand von `Adilinu94/unified-elementor-converter`, Commit `a376c15` („feat(deploy): add verified large-deploy resume flow", 2026-08-04), 669 versionierte Dateien.
> **Methodik:** Jede Aussage über den Ist-Zustand wurde am Code verifiziert (Grep, gezieltes Lesen der genannten Dateien), nicht nur aus Dokumentation übernommen — Abschnitt 7 des Repository-Charta-Arbeitsauftrags verlangt das explizit („Keine Dokumentationsbehauptung als Implementierungsnachweis akzeptieren"). Was ich nicht verifizieren konnte, steht ehrlich in Abschnitt 6.
> **Format:** Dieses Dokument ist als *Review & Ergänzung* angelegt, nicht als Neufassung — im selben Stil wie `IR-V1-FROM-STRONGER-AI.md`, `REPAIR-LOOP-V1-FROM-STRONGER-AI.md` und `SCORECARD-V1-FROM-STRONGER-AI.md`, auf die es sich mehrfach bezieht. Kapitelverweise (§) beziehen sich auf den beigefügten Originalplan.

---

## 0. Kurzbewertung

| Aspekt | Urteil | Kommentar |
|---|---|---|
| Grunddiagnose („KI läuft heute unkontrolliert mit") | **Bestätigt, code-verifiziert** | `enhanceWithVision()`/`runTokenSemantics()` laufen produktiv ohne belastbares Gate — siehe §1 |
| Philosophie „deterministic-first, KI nur als Fallback" | **Keine Neuerung — bereits verbindlich adoptiert** | deckt sich mit `REPAIR-LOOP-V1`s Ablehnung von Vision-als-Primäragent und `REPOSITORY-CHARTA.md` §5.1 — siehe §2 |
| `DecisionResult<T>`-Vertrag | **Richtige Idee, falscher Ausgangspunkt** | sollte `ConfidentResult<T>` erweitern statt parallel zu existieren — siehe §3 |
| `AiMode`/`FallbackPolicy` | **Gut, gehört in bestehendes Zod-Muster** | `core/config.ts` hat exakt diese Struktur schon für Qa/Deploy/Conversion |
| Schwellenwerte (`minConfidence: 0.82` etc.) | **Nicht mit Bestehendem abgeglichen** | Charta kennt bereits 0.85/0.60 — eine dritte Zahl fragmentiert die Plattform |
| Stage-7-AI-Gate („kein Fortschritt mehr") | **Zustandsmaschine existiert bereits — aber unverdrahtet** | `healing-loop-v2.ts` hat PASS/PLATEAU/MAX/ESCALATE + Never-List, `legacy-repair.ts` nutzt aber nachweislich nur v1 |
| Budget-/Kostenmodell (§6) | **Teilweise so nicht durchsetzbar** | `CostTracker` kennt Kosten erst *nach* dem Call — kein Vorab-Gate möglich |
| Resilienz (Timeout/Retry) | **Echte, von Plan *und* Code unadressierte Lücke** | `AIRouter.execute()` hat weder Timeout noch Circuit-Breaker |

**Gesamturteil:** Der Plan ist architektonisch solide und trifft die richtige Diagnose. Sein größtes Problem ist nicht inhaltlicher, sondern kontextueller Art: Er wurde ohne sichtbaren Abgleich mit `REPOSITORY-CHARTA.md`, den drei „FROM-STRONGER-AI"-Dokumenten und mehreren bereits bestehenden Code-Bausteinen geschrieben, die exakt dasselbe Problem in Teilen schon lösen. Das größte Risiko bei Umsetzung „wie geschrieben" ist nicht ein technischer Fehler, sondern die Fragmentierung einer Plattform, die sich in den letzten Wochen sichtbar um *ein* kanonisches Vokabular bemüht hat (Statusbegriffe, Ability-Registry, Wizard-Contract-Schema).

---

## 1. Der wichtigste Befund: Das Muster existiert schon — einmal, ungated, mit einer Bastel-Heuristik

Der Plan formuliert sein Zielbild (§1) als etwas noch zu Bauendes: Confidence-Gate vor optionalem KI-Fallback. Tatsächlich existiert genau dieses Muster bereits, im Kleinen, an einer einzigen Stelle:

```ts
// packages/target-v3/src/classifier/section-picker.ts, Zeile 136-138
function estimateDomConfidence(pattern: V3LayoutPattern): number {
  return pattern === 'content' ? 0.3 : 0.9;
}

// Zeile 156-175 (gekürzt)
async function enhanceWithVision(spec, section, pattern, pageScreenshotPath, router, threshold = 0.5) {
  const domConfidence = estimateDomConfidence(pattern);
  if (domConfidence >= threshold) return;          // ← genau das Confidence-Gate aus §1

  const croppedPath = await cropSectionForVision(pageScreenshotPath, section);
  const { value, confidence } = await runSectionClassification(router, croppedPath);
  spec.semanticType = value.type;
  spec.visionConfidence = confidence;
}
```

Das ist wörtlich der im Plan skizzierte Ablauf „deterministisches Ergebnis → Gate → optionaler KI-Aufruf". Zwei Dinge daran sind aber genau die Probleme, die der Plan lösen will:

1. **`estimateDomConfidence` ist keine echte Konfidenz, sondern eine binäre Heuristik** — 0.9 für „irgendein Pattern erkannt", 0.3 für den generischen `content`-Fall. Kein Multi-Signal-Scoring, keine Kandidatenmarge, wie der Plan es in §5.2.2 vorschlägt.
2. **Die Schwelle (`threshold = 0.5`) ist ein hartkodierter Funktionsparameter**, nicht Teil einer `FallbackPolicy`, nicht konfigurierbar, nicht reportet. Es gibt kein `fallback.attempted`/`fallback.used`, keine Protokollierung, ob und warum Vision aufgerufen wurde.

**Konsequenz für die Umsetzung:** Die Aufgabe ist kleiner und risikoärmer, als der Plan sie beschreibt. Es geht nicht darum, KI-Governance auf der grünen Wiese zu bauen, sondern darum, ein bereits funktionierendes, aber einmaliges und primitives Muster (a) zu generalisieren, (b) mit einem echten Scoring statt der 0.9/0.3-Heuristik zu versehen, und (c) auf die anderen, komplett ungegateten KI-Aufrufstellen anzuwenden (siehe §3, Zeilen „Token-Semantik" und „Component-Detect").

---

## 2. Der Plan formuliert keine neue Philosophie — er formalisiert eine bereits getroffene Entscheidung

`REPOSITORY-CHARTA.md` (der laut `AGENTS.md` „verbindliche Plattformvertrag") enthält in §5.1 bereits ein Konfidenz-Regime für die Visual IR:

- `>= 0.85`: automatische native Planung zulässig
- `0.60–0.84`: Planung zulässig, aber Review-/QA-Hinweis verpflichtend
- `< 0.60`: keine spekulative Spezialstruktur; sicherer Fallback oder Benutzerentscheidung

`REPAIR-LOOP-V1-FROM-STRONGER-AI.md` hat zusätzlich bereits explizit entschieden: „Vision-LLM als Repair-Primäragent — **Ablehnen** (teuer, inkonsistent, nicht auditierbar)". `IR-V1-FROM-STRONGER-AI.md` hat für die IR-Klassifikation die Regel „confidence < 0.7 → sichere Defaults (`section_type: generic`), kein spekulatives Fancy-Pattern" adoptiert.

Der vorliegende Umbauplan ist damit **keine neue Position**, sondern die überfällige Formalisierung einer bereits mehrfach getroffenen Entscheidung — er verallgemeinert sie nur von „QA/Repair" (wo sie schon gilt) auf „Section-Klassifikation" und „Token-Semantik" (wo sie noch fehlt). Das ist eine Stärke, keine Schwäche — aber es bedeutet auch: **der Plan sollte an das bestehende Vokabular andocken, nicht ein drittes daneben aufbauen.**

Konkret gefundene Inkonsistenz-Kandidaten:

| Quelle | Schwelle/Wert | Bedeutung |
|---|---|---|
| `REPOSITORY-CHARTA.md` §5.1 | ≥ 0.85 | automatische Planung zulässig |
| `REPOSITORY-CHARTA.md` §5.1 | 0.60–0.84 | Review-Hinweis verpflichtend |
| `REPOSITORY-CHARTA.md` §5.1 | < 0.60 | kein spekulatives Pattern |
| `visual-ir.contract.ts` (Validator) | < 0.6 | tatsächlich codierte „low evidence confidence"-Warnung |
| `section-picker.ts::enhanceWithVision` | < 0.5 (Default-Parameter) | AI-Vision wird aufgerufen |
| `section-picker.ts::estimateDomConfidence` | 0.9 vs. 0.3 | binäre Heuristik, keine echte Konfidenz |
| Umbauplan §5.2.3 (Vorschlag) | 0.82 | neues AI-Gate für Section-Klassifikation |

Drei verschiedene Zahlen (0.5 im Code, 0.60/0.85 in der Charta, 0.82 im neuen Plan) für konzeptionell denselben Sachverhalt — **das ist schon heute so, nicht erst durch den Plan verursacht**, aber der Plan hat die Chance, es auf eine Zahl zu konsolidieren, statt eine vierte hinzuzufügen.

**Empfehlung:** `minConfidence` in `FallbackPolicy` auf **0.85** setzen (deckt sich mit dem einzigen bereits „verbindlichen" Wert) oder, falls Section-Klassifikation bewusst eine andere Fehlertoleranz braucht als IR-Klassifikation, das explizit begründen statt stillschweigend abzuweichen. `estimateDomConfidence`s hartkodierte 0.5 sollte bei dieser Gelegenheit ersetzt werden, nicht als dritter Wert stehen bleiben.

Ebenso sollte die Statuslogik nicht komplett neu erfunden werden — siehe folgende Tabelle in §3.

---

## 3. Code-Inventar: was wiederverwendet werden sollte statt neu gebaut zu werden

| Plan-Konzept | Bereits im Code | Zustand | Empfehlung |
|---|---|---|---|
| `DecisionResult<T>` | `ConfidentResult<T>` — `shared.contract.ts`, `{ value: T; confidence: number }` | wird bereits von `runSectionClassification()` und `runTokenSemantics()` zurückgegeben | `DecisionResult<T> extends ConfidentResult<T>`, nicht parallel definieren |
| `DecisionSource` | `ComponentDetectionResult.layer` — `'structure'\|'vision'\|'keyword'\|'unknown'` (`ai.contract.ts`) | eigene, andere Werteliste als der Plan (`dom\|css\|xml\|geometry\|heuristic\|vision\|ai`) | explizite Mapping-Tabelle ergänzen oder `layer` langfristig durch `source` ersetzen |
| `FallbackPolicy.allowedTasks` | `TASK_CATEGORY` — `ai/types.ts` | die 5 Tasknamen (`section-classify`, `component-detect`, `vision-qa`, `repair-block`, `token-semantics`) sind **identisch** mit dem Plan | 1:1 übernehmen, keine neue Taxonomie einführen |
| AI-Fallback-Resolver für Sections | `runSectionClassification()` — `ai/tasks/section-classify.task.ts` | fertig, produktionsreif, JSON-Parsing + Confidence-Extraktion vorhanden | direkt hinter `FallbackCoordinator` verdrahten, **nicht neu schreiben** |
| Confidence-Gate-Muster | `enhanceWithVision()`/`estimateDomConfidence()` — `section-picker.ts:136-175` | genau das Muster aus §1 des Plans — aber binäre Heuristik + hartkodierte Schwelle | ersetzen durch echtes Scoring (siehe §5.2.2) + `FallbackPolicy.minConfidence` |
| AI-Fallback für Token-Semantik | `runTokenSemantics()` — `ai/tasks/token-semantics.task.ts` | fertig, aber **kein Gate am Aufrufer gefunden** (unconditional) | Gate nach demselben Muster wie oben ergänzen |
| `RepairProposal` | `RepairResult`/`repairBlockViaAI()` — `ai.contract.ts` + `repair-block.task.ts` | fertig, aber **ohne `confidence`-Feld**, ohne pfadbasierte `changes[]` | additiv erweitern (siehe Code-Vorschlag in §4), nicht parallel einführen |
| `DecisionStatus` (`unavailable`/`failed`) | `LegacyRepairStatus = 'ok'\|'unavailable'\|'failed'` — `analysis/legacy-repair.ts:36` | exakt die Statuslogik, die der Plan braucht: fehlender Provider → `unavailable`, Exception → `failed`, Erfolg → `ok` | `unavailable`/`failed` unverändert übernehmen, `resolved` → `ok` umbenennen (Konsistenz) |
| Stage-7-AI-Gate-Trigger („kein Fortschritt") | `HealingState = 'PASS'\|'PLATEAU'\|'MAX'\|'ESCALATE'` + `NEVER_LIST` + `violatesNeverList()` — `qa/healing-loop-v2.ts` | **exakt** die von `REPAIR-LOOP-V1` adoptierte Architektur — implementiert, aber laut Import-Suche **nirgends außerhalb eigener Tests aufgerufen** | erst verdrahten (siehe §5, KI-05), dann Stage-7-Gate darauf aufbauen |
| Budget-/Concurrency-Sicherheit | `BatchScheduler` — `mcp/batch-scheduler.ts`, konkurrenzsicheres Rate-/Concurrency-Gate (Phase 113 produktiv) | bewährt, im Einsatz für Multi-Page-Batches | als Vorbild für `maxCallsPerRun`/`maxCallsPerSection`-Zählung im `FallbackCoordinator` nehmen statt eigene Zählung zu bauen |
| AI-Call-Resilienz | `CircuitBreaker` — `mcp/circuit-breaker.ts`, `CLOSED\|OPEN\|HALF_OPEN` | bewährt für MCP-Calls; `AIRouter.execute()` hat **keinen** Timeout/Retry/Breaker | Instanz davon (oder denselben Typ) um `AIRouter.execute()` legen — echte, ungelöste Lücke |
| `AiMode`/`FallbackPolicy`-Validierung | `ElconvConfigSchema` (Zod) — `core/config.ts` | etabliertes Muster für genau solche Config-Objekte (`ViewportSchema`, `QaSchema`, `DeploySchema`, …) | `AiModeSchema`/`FallbackPolicySchema` im selben Stil/derselben Datei |
| Kandidatenscoring-Formel (§5.2.2) | `FixStrategyRanker.computeScore()` — `qa/fix-learning/fix-strategy-ranker.ts` | `successRate × confidence`, `+0.3` bei belegtem Erfolg, `−0.5` bei bekanntem Fehlschlag, auf `[0,1]` geclampt | als direktes Vorbild für die Section-Kandidaten-Gewichtung übernehmen |
| Wizard-Frage „KI-Unterstützung" | bestehende `@inquirer`-Fragenliste — `cli/cmd-wizard.ts` (u. a. Zeile ~676 „V3/V4 strictness") | gleiches `{ name, value }`-Choice-Pattern bereits etabliert | Frage direkt neben der Strictness-Frage einfügen, identisches Pattern |

**Lesart dieser Tabelle:** In elf von vierzehn Zeilen existiert bereits ein funktionierender, getesteter Baustein. Die eigentliche Arbeit des Plans ist zu ~70 % *Verdrahtung und Konsolidierung*, nicht Neubau. Das verschiebt auch die Risikoeinschätzung: Das größte Risiko ist nicht „baut es nicht", sondern „baut eine zweite, leicht andere Version von etwas, das schon da ist" — genau das Muster, das laut `CRITICAL-FAILURE-POINTS.md` (P6, Barrel-Kollisionen) in diesem Repo bereits mehrfach echte Bugs verursacht hat.

---

## 4. Anmerkungen zum Plan, kapitelweise

**§2.1 `AiMode`** — Grundsätzlich richtig geschnitten. Ergänzung: als `z.enum(['deterministic','fallback','required'])` in `core/config.ts` definieren, nicht als freistehendes TS-Type ohne Laufzeitvalidierung — siehe Precedent `ElconvConfigSchema`.

**§2.2 Rückwärtskompatibilität (`visionEnhance` → `fallback`)** — Korrekt priorisiert. `visionEnhance` wird aktuell in mindestens neun Dateien referenziert (`cmd-wizard.ts`, `wizard.ts`, `state-manager.ts`, `pipeline-runner.ts`, `analysis/pipeline.ts`, `analysis/legacy-repair.ts`, `clone-v3.ts`, `repair-block.task.ts`, `wizard-contract.contract.ts`, `schemas/wizard-contract.schema.json`) — die Migration ist nicht trivial und verdient einen eigenen, expliziten Testfall pro Aufrufstelle, nicht nur einen generischen Migrationstest.

**§3.1 `DecisionResult<T>`** — Sollte, wie in §3 gezeigt, `ConfidentResult<T>` erweitern. Zwei konkrete Lücken im vorgeschlagenen Typ:

1. **Kein `conflict`-Status.** §12 des Plans benennt das Risiko „AI erzwingt eine falsche Interpretation" ausdrücklich, aber `DecisionStatus` hat keinen Zustand dafür — nur `unknown` (keine Daten) und `uncertain` (ein Kandidat, niedrige Sicherheit). Ein starker Widerspruch zwischen deterministischem Kandidat und AI-Ergebnis ist ein dritter, andersartiger Fall.
2. **Kein Provider-/Prompt-Feld**, obwohl §11 des Plans genau das für Reproduzierbarkeit verlangt: „Fallback-Runs protokollieren Provider, Prompt-Version, Modell und Entscheidungsgrund." Das ist ein interner Widerspruch im Plan selbst — §11 verspricht etwas, das der in §3.1 definierte Typ nicht speichern kann.

Vorschlag für die korrigierte Fassung:

```ts
// packages/core/src/contracts/decision.contract.ts
import type { ConfidentResult } from './shared.contract.js';

export type DecisionSource =
  | 'dom' | 'css' | 'xml' | 'geometry' | 'heuristic' | 'vision' | 'ai';

export type DecisionStatus =
  | 'ok'          // statt „resolved" — Konsistenz mit LegacyRepairStatus/REPOSITORY-MAP
  | 'uncertain'
  | 'unknown'
  | 'conflict'    // neu — deckt §12-Risiko „AI widerspricht DOM/CSS-Evidenz" ab
  | 'unavailable' // deckungsgleich mit LegacyRepairStatus, nicht neu erfunden
  | 'failed';     // deckungsgleich mit LegacyRepairStatus

export interface DecisionResult<T> extends ConfidentResult<T> {
  status: DecisionStatus;
  source: DecisionSource;
  reasons: string[];
  evidenceIds: string[];
  candidates?: Array<{ value: T; score: number; reasons: string[] }>;
  fallback?: {
    attempted: boolean;
    used: boolean;
    task?: string;
    provider?: string;       // neu — für §11-Reproduzierbarkeit erforderlich
    promptVersion?: string;  // neu — dito
    failureReason?: string;
  };
  warnings: string[];
}
```

**§4.1 `FallbackCoordinator`** — Paketwahl (`packages/core/src/decision/`) ist korrekt gemäß `AGENTS.md`/`REPOSITORY-MAP.md`: „Gemeinsame Mechanismen gehören in `core`, `mcp`, `qa` oder `extractors`" — ein target-neutraler Entscheidungsvertrag gehört genau dorthin, nicht in `target-v3` oder `target-v4`. Zwei Ergänzungen zur beschriebenen Verantwortlichkeitsliste:

- **Cache-Check sollte Schritt 0 sein**, nicht erst Teil von Phase 7 (Budgets/Caching). Ohne Cache-Lookup vor dem Router-Aufruf kann dieselbe Section innerhalb eines Runs (Stage 2 Klassifikation *und* später Stage 7 Repair) zweimal denselben AI-Task auslösen.
- **`AIRouter.execute()` sollte durch `CircuitBreaker` gewrappt werden.** Aktuell wirft `selectProvider()` bei fehlendem Provider einen einfachen `Error('No AI provider available')` — das lässt sich sauber auf `status: 'unavailable'` mappen. Es gibt aber **keinerlei Timeout**: Ein hängender Provider-Call blockiert die ganze Pipeline. `packages/mcp/src/circuit-breaker.ts` existiert bereits und ist bewährt — dieselbe Klasse (oder eine Instanz davon) sollte um den Router-Call im `FallbackCoordinator` gelegt werden.

Eine weitere, bisher unadressierte Lücke direkt im bestehenden `AIRouter.execute()`: JSON-Parse-Fehler werden verschluckt (`catch { /* keep raw */ }`), `response.parsed` bleibt dann `undefined`, ohne dass das nach außen sichtbar wird. Der `FallbackCoordinator` muss `response.parsed !== undefined` explizit prüfen, bevor er ein AI-Ergebnis als verwertbar behandelt — sonst kann eine unparsbare AI-Antwort still als vermeintlicher Erfolg durchrutschen, genau das, was §3.1 des Plans („Ein nicht verfügbarer AI-Provider darf nicht als erfolgreicher AI-Fallback ausgegeben werden") eigentlich verhindern soll.

**§5.2 Section-Klassifikation** — Siehe §1 dieses Dokuments. `minConfidence` mit der Charta abgleichen (siehe §2), nicht 0.82 isoliert festlegen. Die vorgeschlagene Kandidatengewichtung (Positionsbonus, CTA-Bonus, wiederholte Kartenstruktur als Malus) sollte formelmäßig an `FixStrategyRanker.computeScore()` angelehnt werden (Basiswert × Konfidenz plus/minus Evidenzbonus, hart geclampt) — das ist bereits das etablierte Muster für „Score aus mehreren Signalen mit Bonus/Malus" in diesem Repo, nicht neu erfunden werden muss.

**§6 Budget- und Sicherheitsregeln** — `maxCostUsd` ist wie beschrieben **nicht als Vorab-Gate durchsetzbar**: `CostTracker` (siehe `cost-tracker.ts`) berechnet Kosten erst *nach* dem Provider-Call, basierend auf der tatsächlichen Response — es gibt keine Preis-Tabelle für eine Vorab-Schätzung. Empfehlung: `maxCostUsd` explizit als **retrospektives Reporting-/Abbruch-Limit** dokumentieren („nach Überschreitung werden keine *weiteren* Calls mehr ausgelöst", nicht „der Call, der die Grenze reißt, wird verhindert"). Die echten Vorab-Gates sind `maxCallsPerRun`/`maxCallsPerSection` — dafür `BatchScheduler`s Konkurrenzmodell als Vorbild nehmen, damit die Zählung bei parallelen Section-Verarbeitungen nicht durch eine Race Condition unterlaufen wird (dieses Risiko fehlt im Plan komplett, ist aber real, sobald mehr als eine Section gleichzeitig verarbeitet wird).

**Vereinfachungsvorschlag:** Für einen ersten Rollout `maxCostUsd` ganz weglassen (nur `usedCalls`/`maxCalls` durchsetzen, Kosten nur reporten) — das deckt sich mit „Simplicity First": eine Budgetdimension, die ohnehin nur retrospektiv wirkt, muss nicht Teil des ersten Gate-Codes sein.

**§7 CLI/Wizard** — Konkrete Einfügestelle identifiziert: `cmd-wizard.ts` fragt bereits „V3/V4 strictness" mit `{ name, value }`-Choices (`Draft`/`Balanced`/`Pixel-perfect`) unmittelbar gefolgt von Animation- und Font-Strategie-Fragen. Die vorgeschlagene KI-Frage passt exakt in dieselbe Fragengruppe (alle drei sind „Qualitäts-/Aufwands-Dial"-Fragen) und sollte demselben Auswahlmuster folgen, nicht einer neuen UI-Konvention.

**§9 Teststrategie** — Inhaltlich richtig. Zwei bestehende, bindende Konventionen ergänzen: (1) die volle Suite läuft laut `AGENTS.md` ausschließlich seriell (`--pool=forks --maxWorkers=1 --minWorkers=1 --testTimeout=15000`) — neue Fallback-Tests müssen dazu kompatibel sein, nicht auf Parallelität angewiesen; (2) `vi.stubEnv('ANTHROPIC_API_KEY','')`/`OPENAI_API_KEY` ist laut AGENTS.md-Gotcha in jedem Test Pflicht, der `AIRouter`/`createAIRouter()` berührt, sonst lösen ambiente Keys echte API-Calls aus.

**§10 Rollout** — Vorschlag einer **Phase 0.5 vor Phase 1**: Statt direkt mit dem vollen `DecisionResult`/`FallbackCoordinator`-Unterbau zu beginnen, das *bereits bestehende* Gate-Pattern aus `enhanceWithVision()` mechanisch (copy-adapt, keine neue Abstraktion) auf die anderen drei ungegateten Aufrufstellen (`runTokenSemantics`, `repairBlockViaAI` in `legacy-repair.ts`, ggf. `runComponentDetectVision`) anwenden — mit denselben hartkodierten Schwellen wie heute. Das behebt den akutesten Teil des Problems („KI läuft unkontrolliert") in Tagen statt Wochen, bevor in die generische Abstraktion investiert wird, und liefert nebenbei die Referenzimplementierungen, an denen sich `FallbackCoordinator` in Phase 1 orientieren kann.

Außerdem: Die Reihenfolge sollte explizit gegen zwei bestehende Backlogs abgeglichen werden, nicht isoliert stehen:
- **`docs/REPOSITORY-AUDIT-AND-CONVERGENCE-2026-08-01.md`**, O-01 bis O-13 — die aktuellen P1-Prioritäten (O-03 große Deploy-Strategien, O-04 Remote-State/Wizard) berühren andere Dateien und blockieren dieses Vorhaben nicht, sollten aber als eigene Einträge (siehe §5) in dieselbe Liste aufgenommen werden, statt als freischwebendes Extra-Dokument zu existieren.
- **`PRODUCT-BACKLOG-P1-P10.md`** / `REPAIR-LOOP-V1`s Implementierungsreihenfolge „P2 → P4 → P3 → P1 → … → P8" — P8 (der Repair-Loop) ist architektonisch fertig (`healing-loop-v2.ts`) aber nicht verdrahtet (siehe §5, KI-05). Das sollte *vor oder parallel zu* Phase 5 des Umbauplans (deterministische QA-Fixes) passieren, weil beide dieselben Dateien anfassen.

**§11 Abnahmekriterien** — Die „Qualität"-Kriterien sind aktuell vage („keine Verschlechterung der bestehenden Golden-Path-Tests"). Empfehlung: an die bereits adoptierten, konkreten Scorecard-Hard-Floors binden (`SCORECARD-V1-FROM-STRONGER-AI.md`: **E ≥ 70, M ≥ 60**, SHIPPABLE-Formel). Konkret: „Ein AI-Fallback-Ergebnis darf niemals übernommen werden, wenn es den Editability-Score (E) unter seinen Wert vor dem Fallback drückt" — das ist wörtlich `REPAIR-LOOP-V1`s bereits verbindlicher „E darf nicht fallen unter Start"-Hard-Floor, nur bisher nicht in diesem Plan zitiert.

**§12 Risiken** — Vier zusätzliche, code-verifizierte Risiken, die weder im Plan noch (bisher) im bestehenden Code adressiert sind:

1. **Kein Timeout/Circuit-Breaker um `AIRouter.execute()`.** Ein hängender Provider-Call blockiert die Pipeline unbegrenzt (siehe §4, `FallbackCoordinator`).
2. **JSON-Parse-Fehler werden in `AIRouter.execute()` verschluckt**, `response.parsed` bleibt `undefined` ohne Signal nach außen (siehe §4).
3. **Concurrency-Unsicherheit der Call-Budgets.** Werden Sections parallel verarbeitet, kann eine naive Zählung von `usedCalls` race-conditioned werden; `BatchScheduler` löst das bereits für Batch-Deploys, aber nicht automatisch für den neuen Coordinator.
4. **`healing-loop-v2.ts`s PLATEAU/MAX/ESCALATE-Zustandsmaschine ist nicht verdrahtet.** Ein Stage-7-AI-Gate, das auf „kein Fortschritt mehr" triggern soll, hat aktuell kein verlässliches Signal dafür, wenn es (wie heute) gegen `runHealingLoop` (v1) statt `runStructuralHealingLoop` (v2) gebaut wird.

---

## 5. Priorisierte Arbeitspakete

Im Stil von `REPOSITORY-AUDIT-AND-CONVERGENCE-2026-08-01.md` (ID-Präfix `KI-*`, damit es sich neben die bestehenden `O-01`…`O-13` einreiht, ohne deren Nummerierung zu kollidieren):

| ID | Prio | Bereich | Punkt | Abnahmekriterium |
|---|---|---|---|---|
| KI-01 | P0 | `core/contracts` | `DecisionResult<T>` als Extension von `ConfidentResult<T>` in neuer `decision.contract.ts` (inkl. `conflict`-Status, `provider`/`promptVersion`) | Typecheck grün; aus bestehenden `ConfidentResult`-Rückgaben ableitbar |
| KI-02 | P0 | `cli/cmd-wizard` bzw. `core/ai` | Bestehendes Gate-Muster (§1) mechanisch auf `runTokenSemantics` und `repairBlockViaAI`-Aufrufer anwenden (Phase 0.5) | Beide Aufrufstellen überspringen den AI-Call nachweislich bei hoher deterministischer Konfidenz |
| KI-03 | P0 | `core/ai` | `AIRouter.execute()` um Timeout + `CircuitBreaker` (aus `@elconv/mcp`) ergänzen; `response.parsed === undefined` explizit als Fehlerfall behandeln | Test: hängender/kaputt-antwortender Mock-Provider führt zu `unavailable`/`failed`, nie zu Hänger oder Fake-Erfolg |
| KI-04 | P0 | `target-v3/classifier` | `estimateDomConfidence()` durch echtes Multi-Signal-Scoring ersetzen (Vorbild: `FixStrategyRanker.computeScore()`) | Bestehender V3-Golden-Path bleibt grün; neuer Unit-Test für die Scoring-Funktion isoliert vom Router |
| KI-05 | P1 | `qa/healing-loop*` | Entscheiden + umsetzen: `runStructuralHealingLoop` (v2, PASS/PLATEAU/MAX/ESCALATE + Never-List) verdrahten, oder bewusst verwerfen und `CRITICAL-FAILURE-POINTS.md` entsprechend nachführen | Entscheidung dokumentiert; falls verdrahtet: Test, dass `legacy-repair.ts` tatsächlich PLATEAU/MAX erreichen kann |
| KI-06 | P1 | `core/decision` (neu) | `FallbackCoordinator` bauen (Cache-Check → `AiMode`-Prüfung → Budget-Check → Circuit-Breaker-gewrappter Router-Call → Validierung → `DecisionResult`) | Unit-Tests exakt nach der Assertion-Liste in Plan-§9.1, kein echter Provider im Test |
| KI-07 | P1 | `core/config` | `AiModeSchema`/`FallbackPolicySchema` als Zod-Schema in `config.ts`, neben `QaSchema`/`DeploySchema` | `parseConfig()` lehnt ungültigen `aiMode`/negative Budgetwerte hart ab |
| KI-08 | P1 | `cli/cmd-wizard` | AI-Modus-Frage neben der Strictness-Frage einfügen; `--ai-mode`-Flag analog zu `--target` | `elconv wizard` fragt interaktiv nach KI-Unterstützung; `--ai-mode` überspringt die Frage |
| KI-09 | P2 | `core/ai/tasks` | `RepairResult` additiv um `confidence` + pfadbasierte `changes[]` erweitern (`RepairProposal` als Extension, nicht Parallel-Typ) | bestehende `repairBlockViaAI`-Tests bleiben unverändert grün |
| KI-10 | P2 | `docs` | Confidence-Schwellen-Tabelle (§2 dieses Dokuments) als Ergänzung in `REPOSITORY-CHARTA.md` §5.1 aufnehmen | Charta verweist auf eine einzige Quelle der Wahrheit statt mehrerer stiller Zahlen |
| KI-11 | P3 | `core/ai/cost-tracker` | `CostTracker.wouldExceedBudget()`-Hilfsmethode für retrospektives Budget-Reporting/Abbruch | vom `FallbackCoordinator` genutzt; wirkt nachweislich nur nach abgeschlossenen Calls, nie als Vorab-Gate |

---

## 6. Was ich nicht verifizieren konnte

Im Sinne der Charta-Regel „bei Informationsmangel `unsupported`/Unsicherheit melden statt zu raten":

- **`packages/qa/src/vision-qa.ts` und `core/ai/tasks/vision-qa.task.ts`** — beide Dateien existieren; ob die von `CRITICAL-FAILURE-POINTS.md` (P2) behauptete Lücke „`runVisionQA` existiert nirgends" noch aktuell ist oder — wie beim `auto-fix.ts`-Stub-Befund — inzwischen überholt ist, habe ich **nicht** verifiziert.
- **`detect-by-structure.ts`, `style-classifier.ts`, `component-detector.ts`** — die übrigen im Plan genannten Stage-2-Klassifikator-Dateien in `target-v3/src/classifier/` habe ich nicht gelesen; die Aussagen zu Stage 2 stützen sich ausschließlich auf `section-picker.ts`.
- **`visual-ir.contract.ts`** (381 Zeilen) habe ich nur gezielt nach `confidence`/`status` durchsucht, nicht vollständig gelesen — insbesondere die vollständige IR-Knoten-Taxonomie und ob das ≥0.85-Band der Charta dort tatsächlich als Gate kodiert ist (gefunden habe ich nur die <0.6-Warnung), bleibt offen.
- **Ob `TASK_CATEGORY['component-detect']` und `['vision-qa']` über eigene Router-Aufrufe je erreicht werden** — `runComponentDetectVision()` ruft intern `router.execute({ name: 'section-classify', … })` auf, nicht `'component-detect'`. Ob es woanders einen direkten `component-detect`-Aufruf gibt, habe ich nicht geprüft.
- **Kein eigener Testlauf.** Alle Aussagen zu „Tests grün"/„Suite besteht" stammen aus Repository-Dokumentation (`TODO-OFFEN-2026-07-31.md`, `RELEASE-GATES-2026-07-31.md`), nicht aus einem selbst ausgeführten `npx vitest run`. Da laut `HANDOFF-2026-07-30.md` regelmäßig **mehrere parallele Sessions an diesem Repo arbeiten**, sollte jede Aussage aus diesem Dokument vor Umsetzung gegen den dann aktuellen Stand neu verifiziert werden — insbesondere KI-05 (healing-loop-Verdrahtung), da das genau die Art von Befund ist, die sich zwischen Sessions am schnellsten ändert.

---

**Zusammengefasst:** Der Umbauplan sollte umgesetzt werden — die Diagnose ist richtig und durch den Code bestätigt. Der wirksamste erste Schritt ist aber nicht der volle `FallbackCoordinator`-Unterbau, sondern das bereits bewährte Gate-Muster aus `section-picker.ts` auf die drei anderen ungegateten AI-Aufrufstellen zu übertragen (KI-02/KI-03/KI-04) — messbar, klein, ohne neue Abstraktion, und mit sofortiger Wirkung auf genau das Problem, das §1 des Originalplans beschreibt.

# Framer External Agent (Unframer MCP) als optionale Source

> **Status:** Feature-Flag (deaktiviert per default)
> **Hinzugefügt:** 2026-06-16
> **Live-verifiziert:** 2026-06-16 gegen `https://mcp.unframer.co/mcp` (Framer MCP v1.8.0)

## Wann aktivieren

Standardmäßig ruft die Pipeline Framer-Daten aus zwei Quellen ab:

1. **FramerExport ZIP** (Steps 1, 11) — physische HTML/XML-Dateien aus `FramerExport/`
2. **Unframer MCP** (Steps 4-5) — bisher "an Agent delegiert", d.h. der User (oder Agent) ruft die `mcp__framer__*` Tools manuell auf

**Aktiviere den Framer-Agent-Modus wenn:**

- Du die Pipeline headless/CI-fähig machen willst (kein manueller Agent-Eingriff nötig)
- Du konsistentere Daten willst, weil Unframer MCP denselben Datenstrom liefert wie `mcp__framer__*` Tools
- Du den `getProjectXml`-Output direkt in `exports/<page>/unframer/project.xml` archivieren willst (für Re-Runs ohne Re-Export)

**Nicht aktivieren wenn:**

- Du keinen Unfrener-MCP-Zugang hast (z.B. lokal ohne Account)
- Du ausschließlich FramerExport-CLI-Daten nutzt und Schritt 4-5 weiter manuell machen willst
- Du in einer sicheren Umgebung arbeitest, in der Secrets in `.env` nicht erlaubt sind

## Setup

### 1. Unframer-MCP-Endpoint besorgen

Der Framer External Agent wird von [unframer.co](https://unframer.co) gehostet. Du brauchst:

- **URL:** `https://mcp.unframer.co/mcp` (Standard) oder eigener Endpoint
- **ID:** Wird bei der Registrierung vergeben
- **Secret:** Wird bei der Registrierung vergeben

Diese landen in **Query-Params** der HTTP-Requests (`?id=...&secret=...`). Der Server nutzt **keine** Session-Cookies — jeder Call ist self-contained.

### 2. `.env.local` anlegen

Die Datei `.env.local` ist bereits in `.gitignore` — Secrets werden nie committed:

```bash
# .env.local (im Projekt-Root, gitignored)
UNFRAMER_MCP_URL=https://mcp.unframer.co/mcp
UNFRAMER_MCP_ID=<deine-id>
UNFRAMER_MCP_SECRET=<dein-secret>
```

Alternativ können die Werte auch direkt als process.env-Variablen gesetzt werden (z.B. in CI).

### 3. Verifikation

Schnelltest ob die Bridge korrekt konfiguriert ist:

```bash
node scripts/lib/unframer-bridge.js --self-test
```

Erwartete Ausgabe:

```
╔══════════════════════════════════════════════════════════════╗
║       framer-v4-pipeline-v2 — Unframer Bridge v1.0.0        ║
╚══════════════════════════════════════════════════════════════╝

[unframer-bridge] Configured: https://mcp.unframer.co/mcp
[unframer-bridge]   id:     e971...4f2b
[unframer-bridge]   secret: zk0c...uxvV

▶️  [1] initialize
   ✅ Server antwortet (Framer MCP)
▶️  [2] tools/list
   ✅ 22 Tools (22 verfuegbar)
▶️  [3] getProjectXml
   ✅ getProjectXml OK (157ms, type=string)
```

Wenn die Ausgabe `⚠️ Keine .env.local` zeigt: Datei existiert nicht oder Vars sind nicht gesetzt.

### 4. Pipeline-Run

```bash
node wizard.js pipeline --url https://example.framer.app/ --post-id 123
```

In der Step-Liste siehst du dann:

```
   4: ok           Unframer getProjectXml         <- via unframer-bridge
   5: skipped      Unframer getNodeXml (sections) -- project.xml enthält alle Sections
```

Statt vorher:

```
   4: delegated    Unframer getProjectXml         -- an Agent delegiert
   5: delegated    Unframer getNodeXml            -- an Agent delegiert
```

## Architektur

```
.env.local (gitignored)
       ↓
   UnframerBridge.fromEnv()
       ↓
   isConfigured() === true
       ↓
   callTool('getProjectXml', {})
       ↓
   JSON-RPC 2.0 over HTTPS (Streamable-HTTP, Accept: application/json+text/event-stream)
       ↓
   https://mcp.unframer.co/mcp?id=...&secret=...
       ↓
   Response: content[0].text → XML-String
       ↓
   exports/<page>/unframer/project.xml
```

### Wichtige Design-Entscheidungen

| Entscheidung | Begründung |
|---|---|
| **Kein Session-Handshake** | Server v1.8.0 nutzt nur Query-Param-Auth, kein `Mcp-Session-Id`-Header |
| **Accept: application/json + text/event-stream** | Server verlangt Streamable-HTTP-Transport (MCP 2024-11-05) — nur `application/json` gibt HTTP 406 |
| **SSE-Response-Parsing** | Server kann JSON *oder* `data: ...\n\n` Format liefern |
| **Concurrency default 3** | Niedriger als Novamira (5) weil jeder Unframer-Call potentiell teure Framer-Cloud-Roundtrips macht |
| **Feature-Flag via `isConfigured()`** | Pipeline läuft unverändert ohne Env-Vars, kein Hard-Fail |
| **Secret-Maskierung im Log** | `logConfigSummary()` zeigt nur erste/letzte 4 Zeichen, nie den vollen String |
| **Kein Cache** | Unframer-Calls sind read-only aber context-abhängig — anders als Novamira-Design-System braucht es keinen Cache |

## Troubleshooting

### "Keine .env.local oder Env-Vars gefunden"

→ Datei existiert nicht oder Vars sind nicht gesetzt. Prüfe:
```bash
ls -la .env.local         # Linux/Mac
dir .env.local            # Windows
```

### HTTP 406 "Not Acceptable: Client must accept both application/json and text/event-stream"

→ Bug in der Bridge. Sollte nicht passieren — die Bridge sendet immer beide `Accept`-Header. Wenn doch: Issue melden.

### HTTP 503 / 429 (Rate Limit)

→ Server überlastet oder zu viele parallele Calls. Reduziere Concurrency:
```bash
UNFRAMER_CONCURRENCY=1 node wizard.js pipeline ...
```

### HTTP 401 / 403

→ Secret ist falsch oder abgelaufen. Besorge neuen Endpoint von unframer.co.

### Step 4 zeigt `warning` statt `ok`

→ Network-Fehler oder Auth-Problem. Der XML-Download wird einmal retried (Backoff 500ms, 1s, 2s). Bei dauerhaftem Fail: läuft die Pipeline mit `delegated`-Status weiter — der Agent muss dann manuell `getProjectXml` aufrufen.

## Sicherheit

- **Secret-Handhabung:** Secret wird NIE in Logs, Errors oder Build-Artefakten geschrieben. `logConfigSummary()` maskiert auf 4+4 Zeichen.
- **`.gitignore`:** `.env`, `.env.local`, `.mcp.json` sind bereits gitignored.
- **Tests:** Unit-Tests nutzen `new UnframerBridge({url: 'https://x/mcp', id: 'i', secret: 's'})` — keine Live-Secrets in CI.
- **Transport:** HTTPS only (kein HTTP-Fallback).

## Siehe auch

- `scripts/lib/unframer-bridge.js` — Implementation (~370 Zeilen)
- `tests/lib/unframer-bridge.test.js` — 18 Unit-Tests
- `scripts/wizard/cmd-pipeline.js` — Steps 4-5 Feature-Flag-Integration
- [Unframer.co](https://unframer.co) — MCP-Server-Hoster
- [MCP Spec 2024-11-05](https://modelcontextprotocol.io) — Streamable-HTTP-Transport

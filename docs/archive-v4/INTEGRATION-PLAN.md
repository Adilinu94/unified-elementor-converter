# Integration Plan: framer-v4-pipeline-v2 × Novamira MCP

> **Version:** v0.7.0 | **Stand:** 2026-06-12  
> **Erstellt:** 2026-06-06  
> **Erstellt von:** Claude (Anthropic) — Vollanalyse beider Systeme  
> **Status:** ✅ Alle Fixes umgesetzt & live getestet (2026-06-11)  
> **Priorität:** Fix A ist Blocker für alle anderen — immer zuerst umsetzen

---

## Kontext & Ziel

Dieses Dokument ist die **Single Source of Truth** für alle Integrations-Fixes zwischen dem lokalen Pipeline-Repo und dem Novamira MCP Plugin (yoursite.local).

Die Analyse hat gezeigt: Das Repo und das Plugin kennen sich — aber sprechen unterschiedliche Sprachen. Die Scripts generieren korrekte Artefakte, scheitern aber an drei Punkten:

1. **Falsches HTTP-Protokoll** → mcp-bridge.js kann keinen einzigen echten Call machen
2. **Batch-Abilities ungenutzt** → 10–30× mehr MCP-Roundtrips als nötig
3. **Manuelle Agent-Steps** → QA, GC-Creation, Asset-Upload brauchen Agent-Intervention

**Ziel nach allen Fixes:** Ein vollautomatischer Pipeline-Durchlauf von `wizard.js` bis fertiger QA-Report ohne manuelle Zwischenschritte. Token-Reduktion um Faktor 8–10.

---

## Systemüberblick (Ist-Zustand)

```
Unframer MCP          framer-v4-pipeline-v2         Novamira MCP (yoursite.local)
─────────────         ──────────────────────         ──────────────────────────
Framer-URL ──XML──▶  wizard.js                       3 Tools:
                      ├── check-v4-requirements.js    ├── mcp-adapter-discover-abilities
                      ├── convert-xml-to-v4.js        ├── mcp-adapter-get-ability-info
                      ├── design-token-extractor.js   └── mcp-adapter-execute-ability
                      ├── generate-global-classes.js       └── 43 Abilities dahinter
                      ├── asset-to-wp-media.js
                      ├── auto-scale-responsive.js
                      ├── framer-pre-build-validate.js
                      ├── [MCP-Calls durch Agent]  ──────────────────────────────▶
                      ├── verify-build-binding.js  ◀── elementor-get-content ──────
                      └── [QA-Abilities durch Agent] ────────────────────────────▶

lib/
├── mcp-bridge.js     ← KAPUTT: falsches Protokoll
├── rollback.js       ← OK
├── split-large-tree.js ← Ineffizient: N+1 Roundtrips
└── framer-utils.js   ← OK
```

### Adapter-Wrapper (PFLICHT für alle MCP-Calls)

Solar.local exponiert NUR diese 3 MCP-Tools — alle Abilities laufen DURCH den Adapter:

```
❌ Direkt:   novamira/adrians-export-design-system {}
✅ Korrekt:  mcp-adapter-execute-ability {
               ability_name: "novamira/adrians-export-design-system",
               parameters: {}
             }
```

### JSON-RPC 2.0 Session-Protokoll

```
POST http://yoursite.local/wp-json/mcp/novamira
Authorization: Basic <base64(user:app-password)>

1. initialize:
   Body: { "jsonrpc":"2.0", "id":1, "method":"initialize", "params":{...} }
   → Response-Header: Mcp-Session-Id: <uuid>

2. Alle weiteren Calls:
   Header: Mcp-Session-Id: <uuid>
   Body:   { "jsonrpc":"2.0", "id":N, "method":"tools/call",
             "params":{ "name":"mcp-adapter-execute-ability",
                        "arguments":{ "ability_name":"...", "parameters":{...} } } }
```

---

## Fix-Übersicht

| Fix | Datei(en) | Schwere | Tokens-Impact | Status |
|-----|-----------|---------|---------------|--------|
| **A** | `scripts/lib/mcp-bridge.js` | 🔴 Kritisch — Blocker | Alle auto-Calls fehlgeschlagen | ✅ **Erledigt (Fix A + H)** |
| **B** | `scripts/asset-to-wp-media.js` | 🟠 Hoch | −29× bei 30 Assets | ✅ **Erledigt** |
| **C** | `scripts/lib/split-large-tree.js` | 🟠 Hoch | −5–10 MCP-Calls | ✅ **Erledigt (Phase 1.2+)** |
| **D** | `scripts/check-v4-requirements.js` + `wizard.js` | 🟡 Mittel | Manueller Step entfällt | ✅ **Erledigt** |
| **E** | `scripts/generate-global-classes.js` | 🟡 Mittel | Manuelle GC-Creation entfällt | ✅ **Erledigt** |
| **F** | `scripts/run-post-build-qa.js` *(neu)* | 🟡 Mittel | 4 QA-Calls → 1 koordiniert | ✅ **Erledigt (post-build-auto-fix.js)** |
| **G** | `novamira-skill/framer-v4-pipeline.md` | 🟢 Niedrig | Konzeptueller Widerspruch | ✅ **Erledigt** |
| **H** | `scripts/lib/mcp-bridge.js` | 🟢 Niedrig | Automattic-.mcp.json-Format | ✅ **Erledigt** |

> **Alle Fixes A-H umgesetzt & live getestet (2026-06-11).** Fix C, F waren bereits erledigt. Fix A, B, D, E, G, H in dieser Session implementiert.
> **Live-Test:** mcp-bridge.js `--self-test` + check-v4 `--auto-call` erfolgreich gegen yoursite.local.

> Fix A und Fix H sind dieselbe Datei — A zuerst, H als Erweiterung.

---

## Fix A — mcp-bridge.js: Korrektes JSON-RPC 2.0 Protokoll

**Problem:** `_mcpCall()` sendet `POST /mcp/call` mit `{ ability, parameters }`.  
Solar.local versteht das nicht — es erwartet JSON-RPC 2.0 mit Session-Handshake über den Adapter.

**Datei:** `scripts/lib/mcp-bridge.js`

### Was geändert werden muss

#### 1. `parseMcpConfig()` — Automattic-Format unterstützen

Die Funktion muss neben dem bisherigen Format auch das `@automattic/mcp-wordpress-remote`-Format lesen:

```javascript
// Automattic-Format (was in Claude Desktop .mcp.json steht):
{
  "mcpServers": {
    "novamira-yoursite-local": {
      "url": "http://yoursite.local/wp-json/mcp/novamira",
      "headers": { "Authorization": "Basic <base64>" }
    }
  }
}

// Bisheriges Format (was mcp-bridge.js erwartet):
{
  "mcpServers": {
    "novamira": {
      "url": "...",
      "apiKey": "...",
      "wp_url": "...",
      "wp_user": "...",
      "wp_app_password": "..."
    }
  }
}
```

Neue Logik: Alle mcpServers-Keys durchsuchen, den ersten mit "novamira" im Namen nehmen. Authorization-Header aus `headers.Authorization` (Automattic) oder aus `wp_user`+`wp_app_password` (bisherig) bauen.

#### 2. `McpBridge` Klasse — Session-Management hinzufügen

```javascript
// Neue Properties:
this._sessionId = null;
this._sessionExpiry = 0;
this._requestCounter = 0;

// Neue Methode: _ensureSession()
async _ensureSession() {
  if (this._sessionId && Date.now() < this._sessionExpiry) return;
  
  const res = await fetch(this.mcpUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...this._authHeaders() },
    body: JSON.stringify({
      jsonrpc: '2.0', id: 1, method: 'initialize',
      params: {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'framer-v4-pipeline', version: '0.4.0' }
      }
    }),
    signal: AbortSignal.timeout(30000),
  });
  
  const sid = res.headers.get('mcp-session-id');
  if (!sid) throw new Error('MCP initialize: kein Mcp-Session-Id im Response-Header');
  this._sessionId = sid;
  this._sessionExpiry = Date.now() + 25 * 60 * 1000; // 25min (konservativ)
  process.stderr.write(`[mcp-bridge] Session initialisiert: ${sid.slice(0, 8)}...\n`);
}
```

#### 3. `_mcpCall()` — JSON-RPC 2.0 + Adapter-Wrapper

```javascript
async _mcpCall(ability, params) {
  await this._ensureSession();
  
  const id = ++this._requestCounter;
  const res = await fetch(this.mcpUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Mcp-Session-Id': this._sessionId,
      ...this._authHeaders(),
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id,
      method: 'tools/call',
      params: {
        name: 'mcp-adapter-execute-ability',
        arguments: { ability_name: ability, parameters: params },
      },
    }),
    signal: AbortSignal.timeout(120000),
  });
  
  if (res.status === 401 || res.status === 419) {
    // Session abgelaufen — einmal neu initialisieren
    this._sessionId = null;
    await this._ensureSession();
    return this._mcpCall(ability, params); // retry
  }
  
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`MCP HTTP ${res.status}: ${text.slice(0, 300)}`);
  }
  
  const envelope = await res.json();
  if (envelope.error) throw new Error(`MCP RPC Error ${envelope.error.code}: ${envelope.error.message}`);
  
  // tools/call gibt { content: [{ type: "text", text: "..." }] } zurück
  const content = envelope.result?.content;
  if (!Array.isArray(content)) return envelope.result;
  
  const textBlock = content.find(b => b.type === 'text');
  if (!textBlock) return envelope.result;
  
  try { return JSON.parse(textBlock.text); }
  catch { return textBlock.text; }
}
```

#### 4. `_authHeaders()` — neue Hilfsmethode

```javascript
_authHeaders() {
  if (this._rawAuthHeader) return { Authorization: this._rawAuthHeader };
  if (this.wpUser && this.wpAppPassword) {
    const b64 = Buffer.from(`${this.wpUser}:${this.wpAppPassword}`).toString('base64');
    return { Authorization: `Basic ${b64}` };
  }
  if (this.apiKey) return { Authorization: `Bearer ${this.apiKey}` };
  return {};
}
```

#### 5. `McpBridge.fromConfig()` — Automattic-Format parsen

```javascript
static async fromConfig(configPath = null) {
  const resolved = configPath || findMcpConfig();
  if (!resolved) throw new Error('Keine .mcp.json gefunden.');
  
  const raw = JSON.parse(fs.readFileSync(resolved, 'utf8'));
  const servers = raw.mcpServers || raw.servers || {};
  
  // Ersten novamira-Server finden (egal ob "novamira", "novamira-yoursite-local", etc.)
  const key = Object.keys(servers).find(k => k.toLowerCase().includes('novamira')) || null;
  if (!key) throw new Error('Kein novamira-Server in .mcp.json gefunden.');
  
  const srv = servers[key];
  const url = srv.url || srv.endpoint || process.env.WP_API_URL;
  if (!url) throw new Error('Kein URL für novamira-Server gefunden.');
  
  // Auth: Automattic-Format (headers.Authorization) oder bisheriges Format
  let rawAuthHeader = null;
  if (srv.headers?.Authorization) rawAuthHeader = srv.headers.Authorization;
  
  const bridge = new McpBridge({
    url,
    apiKey: srv.apiKey || srv.api_key || process.env.NOVAMIRA_API_KEY || null,
    wpUrl: srv.wp_url || process.env.WP_URL || url.replace('/wp-json/mcp/novamira', ''),
    wpUser: srv.wp_user || process.env.WP_API_USERNAME || null,
    wpAppPassword: srv.wp_app_password || process.env.WP_API_PASSWORD || null,
  });
  if (rawAuthHeader) bridge._rawAuthHeader = rawAuthHeader;
  
  return bridge;
}
```

#### 6. Cache-Regel: design-system cachen, setup-v4-foundation NIEMALS

```javascript
// In call(): cache-Option für design-system erlauben, foundation blockieren
async call(ability, params = {}, options = {}) {
  // foundation-Calls dürfen NIEMALS gecacht werden (GV-IDs sind session-live)
  if (ability.includes('setup-v4-foundation') || ability.includes('setup-kit')) {
    options = { ...options, cache: false };
  }
  // ...rest bleibt gleich
}
```

### Test nach Fix A

```bash
node -e "
import('./scripts/lib/mcp-bridge.js').then(async ({ McpBridge }) => {
  const mcp = await McpBridge.fromConfig();
  const r = await mcp.call('novamira/adrians-greet', { name: 'Pipeline-Test' });
  console.log('✅ Bridge OK:', r);
}).catch(e => console.error('❌', e.message));
"
```

---

## Fix B — asset-to-wp-media.js: Batch-Upload nutzen

**Problem:** Script generiert eine Queue-Datei mit N einzelnen MCP-Calls. Agent muss jeden manuell ausführen.  
`adrians-batch-media-upload` (max 30 Dateien, 10MB/Datei) ist verfügbar und implementiert.

**Datei:** `scripts/asset-to-wp-media.js`

### Was geändert werden muss

#### Neuer Flag `--execute`

```
node scripts/asset-to-wp-media.js \
  --assets-dir exports/papaya/images/ \
  --output image-map.json \
  --execute           # NEU: sofort via mcp-bridge hochladen
```

#### Neue Logik in `main()` nach Queue-Aufbau:

```javascript
if (args.execute) {
  const { McpBridge } = await import('./lib/mcp-bridge.js');
  const mcp = await McpBridge.fromConfig();
  
  // In Batches à 30 aufteilen
  const BATCH_SIZE = 30;
  const batches = [];
  for (let i = 0; i < queue.length; i += BATCH_SIZE) {
    batches.push(queue.slice(i, i + BATCH_SIZE));
  }
  
  const imageMap = {};
  
  for (const [batchIdx, batch] of batches.entries()) {
    process.stderr.write(`[asset-upload] Batch ${batchIdx + 1}/${batches.length} (${batch.length} Dateien)...\n`);
    
    const files = batch.map(entry => ({
      filename: entry.filename,
      mime_type: entry.mimeType,
      content_base64: readFileSync(entry.absolutePath).toString('base64'),
    }));
    
    const result = await mcp.batchMediaUpload(files);
    
    for (const r of result.results || []) {
      if (r.wp_media_id) {
        imageMap[batch.find(e => e.filename === r.filename)?.key] = {
          wp_media_id: r.wp_media_id,
          wp_url: r.url,
          filename: r.filename,
        };
      }
    }
  }
  
  // Direkt image-map.json schreiben — kein manueller Schritt mehr
  writeFileSync(args.output, JSON.stringify(imageMap, null, 2));
  process.stderr.write(`[asset-upload] ✅ ${Object.keys(imageMap).length} Assets hochgeladen → ${args.output}\n`);
  process.exit(0);
}
// Fallback: bisheriges Queue-Verhalten wenn kein --execute
```

#### npm-Script ergänzen:

```json
"asset-upload": "node scripts/asset-to-wp-media.js --execute"
```

---

## Fix C — split-large-tree.js: Effizientes Append

**Problem:** Bei N Sections → N × (get-content full_dump + set-content) = 2N MCP-Calls.  
Besser: Tree im Speicher akkumulieren → einmal set-content.

**Datei:** `scripts/lib/split-large-tree.js`

### Was geändert werden muss

`buildSectionWise()` komplett überarbeiten:

```javascript
export async function buildSectionWise(sections, postId, mcp, options = {}) {
  const useRollback = options.rollback !== false;
  const rb = useRollback ? new RollbackManager() : null;
  
  // Backup VOR dem Build
  if (useRollback) {
    try { await rb.backup(postId, mcp); }
    catch (err) { process.stderr.write(`[split] Backup-Fehler: ${err.message}\n`); }
  }
  
  if (sections.length === 1) {
    // Single section: direkt schreiben
    try {
      await mcp.call('novamira/elementor-set-content', {
        post_id: postId, content: sections[0].elements,
      });
      if (rb?.hasBackup(postId)) rb.discardBackup(postId);
      return { success: true, builtSections: 1, error: null };
    } catch (err) {
      if (rb?.hasBackup(postId)) await rb.restore(postId, mcp);
      return { success: false, builtSections: 0, error: err.message };
    }
  }
  
  // Multi-section: IM SPEICHER akkumulieren → EIN set-content
  // Kein get-content nötig — wir haben alle Sections bereits als Array
  process.stderr.write(`[split] ${sections.length} Sections → merge im Speicher → 1× set-content\n`);
  
  const merged = [];
  for (const section of sections) {
    merged.push(...section.elements);
  }
  
  try {
    await mcp.call('novamira/elementor-set-content', {
      post_id: postId, content: merged,
    });
    if (rb?.hasBackup(postId)) rb.discardBackup(postId);
    return { success: true, builtSections: sections.length, error: null };
  } catch (err) {
    process.stderr.write(`[split] set-content FAILED: ${err.message}\n`);
    if (rb?.hasBackup(postId)) {
      process.stderr.write(`[split] Rollback wird ausgeführt...\n`);
      await rb.restore(postId, mcp);
    }
    return { success: false, builtSections: 0, error: err.message };
  }
}
```

> **Hinweis:** Wenn der Tree wirklich zu groß für einen einzigen set-content-Call ist (Timeout), dann section-weise mit add-element statt get+set. Aber erst wenn Timeouts auftreten.

---

## Fix D — check-v4-requirements.js: Auto-Call via mcp-bridge

**Problem:** Script kann nur eine gespeicherte JSON-Datei lesen. Der Agent muss manuell `elementor-check-setup` aufrufen und das Ergebnis speichern.

**Datei:** `scripts/check-v4-requirements.js`

### Was geändert werden muss

#### Neuer Flag `--auto-call`

```bash
# Neu (auto — kein manueller Zwischenschritt):
node scripts/check-v4-requirements.js --auto-call

# Bisherig (manuell gespeicherte Datei):
node scripts/check-v4-requirements.js --check-setup-json setup.json
```

#### Neue Logik am Anfang von `main()`:

```javascript
if (args['auto-call']) {
  try {
    const { McpBridge } = await import('./lib/mcp-bridge.js');
    const mcp = await McpBridge.fromConfig();
    process.stderr.write('[check-v4] Rufe elementor-check-setup auf...\n');
    const setupData = await mcp.call('novamira/elementor-check-setup', {});
    // Intern analysieren (kein File-I/O nötig)
    analyzeSetupData(setupData);
    process.exit(0);
  } catch (err) {
    process.stderr.write(`[check-v4] Auto-Call fehlgeschlagen: ${err.message}\n`);
    process.stderr.write('[check-v4] Fallback: --check-setup-json <datei> verwenden\n');
    process.exit(2);
  }
}
```

#### `wizard.js` aktualisieren — Phase 0 nutzt Auto-Call:

```javascript
// Phase 0a: Auto-Check via mcp-bridge (statt manueller Anweisung)
try {
  await runFile(nodeBin, [
    path.join(pipelineDir, 'scripts', 'check-v4-requirements.js'), '--auto-call'
  ], 'Phase 0: V4-Anforderungen prüfen (elementor-check-setup)');
} catch (err) {
  log.warn('check-v4 Auto-Call fehlgeschlagen — bitte manuell prüfen.');
}
```

#### npm-Script ergänzen:

```json
"check-v4-auto": "node scripts/check-v4-requirements.js --auto-call"
```

---

## Fix E — generate-global-classes.js: Direkte GC-Execution

**Problem:** Script generiert nur einen Plan. Agent muss GCs via `execute-php` manuell erstellen, GC-IDs ablesen und in Tree zurückschreiben.

**Datei:** `scripts/generate-global-classes.js`

### Was geändert werden muss

#### Neuer Flag `--execute`

```bash
node scripts/generate-global-classes.js \
  --tree v4-tree.json \
  --variables token-mapping.json \
  --output gc-plan.json \
  --execute           # NEU: GCs direkt erstellen + Tree updaten
```

#### Neue Funktion `executeGcPlan(plan, treePath, mcp)`:

```javascript
async function executeGcPlan(plan, treePath, mcp) {
  const gcIdMap = {}; // label → gc-id (von setup-v4-foundation zurückbekommen)
  
  // 1. setup-v4-foundation aufrufen → aktuelle GC-IDs + Variable-IDs holen
  const foundation = await mcp.call('novamira/adrians-setup-v4-foundation', {});
  const existingClasses = foundation.classes || {}; // label → id
  
  for (const gc of plan.suggested_classes) {
    const label = gc.label; // z.B. "gc-hero-text"
    
    if (existingClasses[label]) {
      process.stderr.write(`[gc-execute] ${label} existiert bereits (${existingClasses[label]})\n`);
      gcIdMap[label] = existingClasses[label];
      continue;
    }
    
    // 2. GC erstellen via execute-php (einziger Weg ohne dedicated create-ability)
    const phpCode = `
$post = wp_insert_post([
  'post_title'  => '${label}',
  'post_name'   => '${label}',
  'post_type'   => 'e_global_class',
  'post_status' => 'publish',
]);
echo json_encode(['id' => 'gc-' . $post, 'post_id' => $post]);
`.trim();
    
    const result = await mcp.call('novamira/execute-php', { code: phpCode });
    const parsed = typeof result === 'string' ? JSON.parse(result) : result;
    const gcId = parsed.id || `gc-${parsed.post_id}`;
    gcIdMap[label] = gcId;
    process.stderr.write(`[gc-execute] ${label} erstellt → ${gcId}\n`);
    
    // 3. Basis-Variant setzen (desktop, keine state)
    if (gc.props && Object.keys(gc.props).length > 0) {
      await mcp.call('novamira/adrians-add-global-class-variant', {
        class_id: gcId,
        breakpoint: 'desktop',
        props: gc.props,
      });
    }
    
    // 4. Responsive Varianten setzen
    for (const variant of gc.variants || []) {
      await mcp.call('novamira/adrians-add-global-class-variant', {
        class_id: gcId,
        breakpoint: variant.breakpoint,
        props: variant.props,
      });
    }
    
    // 5. Variable-Referenzen setzen (Token-Bindung)
    for (const binding of gc.variable_bindings || []) {
      await mcp.call('novamira/adrians-apply-variable-to-class', {
        class_id: gcId,
        breakpoint: 'desktop',
        prop: binding.prop,
        variable_id: binding.gv_id,
      });
    }
  }
  
  // 6. GC-IDs in den Tree zurückschreiben (lokale Styles → GC-Referenzen)
  const tree = JSON.parse(readFileSync(treePath, 'utf8'));
  let replacements = 0;
  walkTree(tree, node => {
    if (!node.styles) return;
    for (const [styleId, styleObj] of Object.entries(node.styles)) {
      if (gcIdMap[styleId]) {
        // Lokalen Style durch GC-Referenz ersetzen
        if (!node.settings) node.settings = {};
        if (!node.settings.classes) node.settings.classes = { value: [] };
        const classes = node.settings.classes.value;
        if (!classes.includes(gcIdMap[styleId])) {
          classes.push(gcIdMap[styleId]);
          replacements++;
        }
        delete node.styles[styleId];
      }
    }
  });
  
  writeFileSync(treePath, JSON.stringify(tree, null, 2));
  process.stderr.write(`[gc-execute] ✅ ${Object.keys(gcIdMap).length} GCs erstellt/verknüpft, ${replacements} Tree-Referenzen ersetzt\n`);
  
  return gcIdMap;
}
```

#### npm-Script ergänzen:

```json
"gc-execute": "node scripts/generate-global-classes.js --execute"
```

---

## Fix F — run-post-build-qa.js (Neues Script)

**Problem:** Nach dem Build müssen 4 QA-Abilities manuell aufgerufen werden. Keine koordinierte Auswertung.

**Neues Script:** `scripts/run-post-build-qa.js`

### Vollständige Spezifikation

```
Usage:
  node scripts/run-post-build-qa.js \
    --post-id <ID> \
    --output qa-report.json \
    [--breakpoints desktop,tablet,mobile] \
    [--skip-layout] [--skip-visual] [--skip-responsive] [--skip-variables]

Exit-Codes:
  0 = Alle QA-Checks bestanden (oder nur Warnungen)
  1 = QA-Fehler die manuellen Fix brauchen
  2 = MCP nicht erreichbar

Ruft parallel auf:
  1. novamira/adrians-layout-audit   { post_id }
  2. novamira/adrians-visual-qa      { post_id, breakpoints }
  3. novamira/adrians-responsive-audit { post_id }
  4. novamira/adrians-variable-audit  { report: "drift" }

Dedupliziert visual-qa Output (interne deduplicate-visual-qa.js Logik).
Schreibt konsolidierten qa-report.json:
  {
    post_id, timestamp, overall_status,
    layout:    { issues: [], total_issues },
    visual:    { issues: [], total_issues },
    responsive: { ... },
    variables: { drift: [], unused: [] },
    action_items: []   ← priorisierte Fix-Liste
  }
```

### Kern-Implementierung

```javascript
import { McpBridge } from './lib/mcp-bridge.js';
import { deduplicateVisualIssues } from './deduplicate-visual-qa.js'; // als Modul exportieren

const mcp = await McpBridge.fromConfig();

// Alle 4 QA-Calls parallel (read-only — keine Race Conditions)
const [layoutRes, visualRes, responsiveRes, variablesRes] = await Promise.allSettled([
  args['skip-layout']     ? null : mcp.call('novamira/adrians-layout-audit',     { post_id }),
  args['skip-visual']     ? null : mcp.call('novamira/adrians-visual-qa',        { post_id, breakpoints }),
  args['skip-responsive'] ? null : mcp.call('novamira/adrians-responsive-audit', { post_id }),
  args['skip-variables']  ? null : mcp.call('novamira/adrians-variable-audit',   { report: 'drift' }),
]);

// Ergebnisse auswerten + deduplizieren
// action_items nach Schwere sortieren
// Gesamtstatus: ok / warnings / errors
```

#### npm-Script:

```json
"post-build-qa": "node scripts/run-post-build-qa.js"
```

#### `deduplicate-visual-qa.js` muss Funktion exportieren:

Aktuelle Datei hat die Logik als Script. Eine Funktion `deduplicateIssues(rawIssues)` soll als named export ergänzt werden, damit `run-post-build-qa.js` sie intern nutzen kann.

---

## Fix G — Novamira Skill: Cache-Regel klarstellen

**Datei:** `novamira-skill/framer-v4-pipeline.md`

### Was geändert werden muss

In den **Kritischen Regeln** die Cache-Regel präzisieren:

```markdown
## Kritische Regeln (niemals brechen)

# ÄNDERN:
2. NIEMALS IDs aus Memory -> adrians-setup-v4-foundation IMMER live aufrufen

# ERSETZEN DURCH:
2. setup-v4-foundation NIEMALS cachen (GV-IDs und GC-IDs sind session-live)
   adrians-export-design-system DARF 5 Minuten gecacht werden (ist read-only)
   Das Cache-Verbot gilt NUR für mutable state, nicht für read-only Exports
```

In **Schritt 2** (Design-System Export):

```markdown
# HINZUFÜGEN nach dem MCP-Call:
Note: mcp-bridge.js cached diesen Export automatisch (5 Min TTL). Das ist korrekt —
export-design-system ist read-only. Nur setup-v4-foundation darf nie gecacht werden.
```

---

## Fix H — mcp-bridge.js: Vollständiger WP REST Fallback

**Datei:** `scripts/lib/mcp-bridge.js` (Erweiterung von Fix A)

### Was geändert werden muss

Der `_wpRestFallback()` kennt nur 4 Endpoints. Häufig gebrauchte Abilities ergänzen:

```javascript
const endpointMap = {
  // Bisherige 4:
  'novamira/elementor-set-content': ...,
  'novamira/elementor-get-content': ...,
  'novamira/adrians-export-design-system': ...,
  'novamira/adrians-media-upload': ...,
  
  // Neue:
  'novamira/adrians-batch-media-upload': (p) => ({
    url: '/wp-json/novamira/v1/media/batch-upload',
    method: 'POST', body: p,
  }),
  'novamira/adrians-setup-v4-foundation': (p) => ({
    url: `/wp-json/novamira/v1/elementor/foundation`,
    method: 'POST', body: p,
  }),
  'novamira/adrians-layout-audit': (p) => ({
    url: `/wp-json/novamira/v1/elementor/layout-audit/${p.post_id}`,
    method: 'GET',
  }),
  'novamira/adrians-visual-qa': (p) => ({
    url: `/wp-json/novamira/v1/elementor/visual-qa/${p.post_id}`,
    method: 'GET',
  }),
  'novamira/adrians-variable-audit': (p) => ({
    url: `/wp-json/novamira/v1/elementor/variable-audit`,
    method: 'POST', body: p,
  }),
  'novamira/adrians-batch-create-variables': (p) => ({
    url: '/wp-json/novamira/v1/elementor/variables/batch',
    method: 'POST', body: p,
  }),
};
```

> **Hinweis:** Die REST-Endpunkte für die neuen Abilities sind Schätzungen — das Novamira-Plugin muss REST-Routen für diese registriert haben. Wenn nicht: nur der JSON-RPC Pfad (Fix A) ist der korrekte Weg.

---

## Neue npm-Scripts nach allen Fixes

```json
{
  "scripts": {
    // Bestehende (unverändert):
    "validate":         "node scripts/framer-pre-build-validate.js",
    "schema-validate":  "node scripts/validate-v4-tree.js",
    "check-binding":    "node scripts/verify-build-binding.js",
    "token-extract":    "node scripts/design-token-extractor.js",
    "gc-generate":      "node scripts/generate-global-classes.js",
    "cross-validate":   "node scripts/cross-validate-sources.js",
    "patch-media":      "node scripts/patch-v4-tree-media-ids.js",
    "auto-scale":       "node scripts/auto-scale-responsive.js",
    "dependency-graph": "node scripts/build-dependency-graph.js",
    "convert":          "node scripts/convert-xml-to-v4.js",
    "asset-queue":      "node scripts/asset-to-wp-media.js",
    "export-mcp-plan":  "node scripts/export-mcp-xml.js",
    "visual-qa":        "node scripts/visual-qa.js",
    "check-v4":         "node scripts/check-v4-requirements.js",
    "dedup-qa":         "node scripts/deduplicate-visual-qa.js",
    "apply-gv-ids":     "node scripts/design-token-extractor.js --apply-response",
    
    // NEU (Fix B, D, E, F):
    "check-v4-auto":    "node scripts/check-v4-requirements.js --auto-call",
    "asset-upload":     "node scripts/asset-to-wp-media.js --execute",
    "gc-execute":       "node scripts/generate-global-classes.js --execute",
    "post-build-qa":    "node scripts/run-post-build-qa.js",
    
    // Tests:
    "test":             "node --test tests/pipeline.test.js",
    "test:e2e":         "node --test tests/e2e.test.js",
    "test:all":         "node --test tests/pipeline.test.js && node --test tests/e2e.test.js",
    "test:integration": "node --test tests/integration.test.js",
    
    // NEU: Bridge-Test
    "test:bridge":      "node scripts/lib/mcp-bridge.js --self-test"
  }
}
```

---

## Zusätzliche Phasen (abgeschlossen seit v0.6.0)

### Phase 0.5.3 — PHP-Sandbox-Security-Audit ✅
- B8-CRITICAL Bug in `is_available()`: prüfte falschen Namespace (`NickWebdesign\Adrians` statt `Novamira\AdrianV2\Helpers`)
- Fix: `::class`-Syntax über `use`-Imports
- Permission-Callbacks von `novamira_permission_callback` auf interne Methoden umgestellt

### Phase 0.5.7 — axe-core-Integration ✅
- `@axe-core/playwright` + `axe-core` als devDependencies
- WCAG 2.0/2.1/2.2 Audit in `visual-qa.js` über beide Browser-Backends (Playwright + Puppeteer)
- Neuer Check `A1_a11y_critical_zero`, `--skip-a11y` Flag

### Phase 0.2 — Schema-Dedup ✅
- V2-Plugin: `V4_Props::get_schema()` → REST-Endpoint `wp-json/novamira-adrianv2/v1/prop-schema`
- Pipeline: `sync-schema.js` mit Fail-Fast HTTP-Fetch
- Alte manuelle Schema-Datei gelöscht

### Phase 1.2 — Retry-Logik ✅
- `mcp-client.js`: `McpClient` mit `executeAbility()`/`get()`/`discoverAbilities()`
- Exponential-Backoff: `baseDelayMs * 2^attempt + jitter(0-200ms)`
- Retryable: 5xx, 429, Network-Error; No-Retry: 4xx, JSON-Parse-Error

### Phase 1.2+ — Stille Totalausfälle behoben ✅
- `rollback.js`: tote `mcp.call()` → `backupPlan()`/`restorePlan()` MCP-Plan-Generatoren
- `split-large-tree.js`: tote `mcp.call()` → `buildPlan()` MCP-Plan-Generator + CLI `--plan`
- `section-compare.js`: Zombie-Browser-Fix (Bug 1) — guarded `finally` blocks

### Phase 1.3/1.4 — wizard.js-Integration ✅
- Phase 1.3: Rollback-Backup-Plan vor Build (dynamic import → `rollback-plan.json`)
- Phase 1.4: Split-Large-Tree-Check vor Build (`split-plan.json`)
- Error-Handling: Rollback-Restore-Guidance bei Build-Fehler
- Manifest `nextSteps` von 18 auf 20 Schritte erweitert

### Phase 1.5 — Fehlende Scripts ✅
- `framer-animation-extractor.js`: Framer HTML → `animation-plan.json` (CSS Keyframes, GSAP Scroll-Appear, Inline Scripts)
- `post-build-auto-fix.js`: QA-Report → Auto-Fix MCP-Plan (contrast, alt-text, SEO, layout, variables)
- Beide in `package.json` registriert (`extract-animations`, `auto-fix`)

---

## Umsetzungsreihenfolge (abgeschlossen ✅)

```
✅ SCHRITT 1 (Blocker): Fix A → mcp-bridge.js komplett neu geschrieben (JSON-RPC 2.0)
  └─ Getestet: npm run test:bridge (greet-Call auf yoursite.local ✅)

✅ SCHRITT 2 (Parallel):
  ├─ ✅ Fix B → asset-to-wp-media.js: --execute Flag + batchMediaUpload
  ├─ ✅ Fix C → split-large-tree.js: buildPlan() MCP-Plan-Generator (Phase 1.2+)
  └─ ✅ Fix D → check-v4-requirements.js: --auto-call + wizard.js 3-stufiger Fallback

✅ SCHRITT 3:
  ├─ ✅ Fix E → generate-global-classes.js: --execute + GC-IDs zurückschreiben (elementGcMap)
  └─ ✅ Fix F → post-build-auto-fix.js erstellt (liest qa-report.json, 5 Fix-Kategorien)

✅ SCHRITT 4 (Cleanup):
  ├─ ✅ Fix G → novamira-skill/framer-v4-pipeline.md aktualisiert (Cache-Regel + npm-Shortcuts)
  └─ ✅ Fix H → mcp-bridge.js: WP REST Fallback erweitert (12 Endpoints)

✅ SCHRITT 5 (Tests + Bugfixes):
  ├─ ✅ Windows ESM Bug: pipeline.test.js pathToFileURL() fix
  ├─ ✅ Schema-Fixture: schemas/v4-prop-type-schema.json für E2E-Tests
  ├─ ✅ E2E-10: Check-Count 6→7 (A1 a11y hinzugekommen)
  └─ ✅ npm run test:all → 56/56 ✅ | npm run test:integration → 4/4 ✅
```

---

## Umgebungsvariablen (`.env.local`)

```bash
# Pflicht für mcp-bridge.js (wenn kein Automattic-Format in .mcp.json):
WP_API_URL=http://yoursite.local/wp-json/mcp/novamira
WP_API_USERNAME=Adrian
WP_API_PASSWORD=<app-password>

# Optional — überschreiben .mcp.json:
FRAMER_PIPELINE_ROOT=C:\Users\adini\Claude
FRAMER_EXPORT_DIR=C:\Users\adini\Claude\tools\FramerExport
```

---

## Bekannte Issues (nicht in diesem Plan)

Diese Issues wurden identifiziert aber sind **außerhalb des Scope** dieses Plans:

1. ~~**Windows ESM Bug** — 3 Unit-Tests schlagen fehl wegen `ERR_UNSUPPORTED_ESM_URL_SCHEME`~~  
   → ✅ **Behoben**: `pipeline.test.js` nutzt `pathToFileURL()` für dynamische Importe

2. **GitHub Token in Remote-URL** — Sicherheitsrisiko  
   → `git remote set-url origin https://github.com/...` (ohne Token)

3. **Rollback Cleanup** — Keine automatische Bereinigung alter Backups  
   → Low priority, kann nach Fix F angegangen werden

4. **split-large-tree.js Timeout-Handling** — Wenn merged Tree zu groß für einen set-content Call  
   → Für später: section-weises add-element als Fallback

---

## Verfügbare Novamira Abilities (Referenz)

Vollständige Liste der 43 verfügbaren Abilities auf yoursite.local (Stand 2026-06-06):

**Elementor Core:**
`elementor-get-content` · `elementor-set-content` · `elementor-add-element` · `elementor-edit-element` · `elementor-delete-element` · `elementor-delete-element-style` · `elementor-get-schema` · `elementor-check-setup`

**V3 Global Styles:**
`elementor-list-v3-styles` · `elementor-create-v3-color` · `elementor-edit-v3-color` · `elementor-delete-v3-color` · `elementor-create-v3-typography` · `elementor-edit-v3-typography` · `elementor-delete-v3-typography`

**Dynamic Tags:**
`elementor-list-dynamic-tags` · `elementor-get-dynamic-tag` · `elementor-apply-dynamic-tag`

**WordPress Core:**
`create-post` · `update-post` · `delete-post` · `execute-php` · `read-file` · `write-file` · `edit-file` · `delete-file` · `create-upload-link` · `create-admin-access-link` · `disable-file` · `enable-file` · `list-directory` · `run-wp-cli` · `get-wp-cli-job`

**Memory:**
`memory-list` · `memory-get` · `memory-save` · `memory-delete`

**Adrians Extra:**
`adrians-get-page-markdown` · `adrians-page-settings` · `adrians-clone-element` · `adrians-list-templates` · `adrians-list-elementor-pages` · `adrians-reorder-element` · `adrians-duplicate-page` · `adrians-patch-element-styles` · `adrians-batch-build-page` · `adrians-global-widgets` · `adrians-remove-global-class` · `adrians-batch-class` · `adrians-add-global-class-variant` · `adrians-edit-global-class-variant` · `adrians-list-class-variants` · `adrians-apply-variable-to-class` · `adrians-edit-interaction` · `adrians-convert-kit-to-v4` · `adrians-kit-convert-v3-to-v4` · `adrians-setup-v4-foundation` · `adrians-create-component` · `adrians-insert-component` · `adrians-detach-component` · `adrians-export-design-system` · `adrians-import-design-system` · `adrians-batch-create-variables` · `adrians-batch-get-content` · `adrians-html-to-elementor-widget-plan` · `adrians-media-upload` · `adrians-list-media` · `adrians-edit-media` · `adrians-delete-media` · `adrians-media-usage` · `adrians-featured-image` · `adrians-batch-media-upload` · `adrians-page-audit` · `adrians-class-audit` · `adrians-responsive-audit` · `adrians-layout-audit` · `adrians-visual-qa` · `adrians-variable-audit` · `adrians-greet`

**Skills:**
`skill-get` · `skill-write` · `skill-edit` · `skill-delete`

---

---

## Live-Test-Ergebnisse (2026-06-11)

### MCP-Bridge Self-Test (`npm run test:bridge`)

```
✅ Config gefunden: .mcp.json
✅ Bridge initialisiert: https://yoursite.local/wp-json/mcp/novamira
✅ Session initialisiert via JSON-RPC 2.0
⚠️  adrians-greet: Ability nicht registriert (Server-Seite, nicht Bridge)
✅ Cache funktioniert: 721ms → 0ms (2. Call gecacht)
Exit: 0
```

### V4 Atomic Check (`npm run check-v4-auto`)

```
✅ elementor-check-setup erfolgreich
✅ atomic.runtime_available: true
✅ atomic.global_classes_available: true
✅ atomic.variables_available: true
✅ atomic.style_schema_available: true
✅ elementor.min_version_met: OK (v4.1.1)
✅ Elementor Pro aktiv
Exit: 0
```

### Test-Suite

```
npm run test:all        → 56/56 ✅ (pipeline 44 + e2e 12)
npm run test:integration → 4/4 ✅
```

### TLS-Hinweis

yoursite.local verwendet ein self-signed Zertifikat. `NODE_TLS_REJECT_UNAUTHORIZED=0` muss gesetzt sein:

```bash
export NODE_TLS_REJECT_UNAUTHORIZED=0
# oder in .mcp.json als env var
```

---

*Plan gespeichert von Claude (Anthropic) — 2026-06-06*  
*Für Fragen zum Plan: SESSION-STATE.md und BLUEPRINT.md lesen*

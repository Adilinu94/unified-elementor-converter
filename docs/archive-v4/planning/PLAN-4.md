# PLAN.md — Phase 4: Sprint 4 — Code Review Remediation

> **Phase:** 4 | **Sprint:** 4 | **Geschätzt:** ~5h
> **Erstellt:** 2026-06-13 | **Quelle:** Sprint 2+3 Code-Review Findings

## Ziel

Drei verbleibende Code-Review-Punkte aus Sprint 2 & 3 beheben:
1. **C3 Routing-Fix**: `framer-animation-extractor.js` GSAP-Code-Generator durch natives V4 Interaction Routing ersetzen
2. **structuralHash-Deduplizierung**: Duplizierte `structuralHash()` aus A1 und D1 in `framer-utils.js` zusammenführen
3. **A2 v4-tree mode**: Stub-Implementierung (`log('not yet implemented')`) vollständig ausbauen

---

## Requirements (NEU für Sprint 4)

### ENHANCEMENT-7: C3 Native Routing Completion
- **ID:** `ENH-7`
- **Beschreibung:** `framer-animation-extractor.js` — `--native` Flag: V4-native Interaction-JSON statt GSAP-Code. Easing-Map-Funktion umbenannt. MCP-Routing zu `edit-interaction`.
- **Datei:** `scripts/framer-animation-extractor.js`
- **Akzeptanz:** Mit `--native` produziert der Output `v4_interactions` Objekte (kein GSAP). Ohne `--native` bleibt Legacy-GSAP erhalten.
- **Test:** `--native` Flag → Output enthält `v4_interactions[]` ohne `code`-Strings

### ENHANCEMENT-8: structuralHash in framer-utils.js
- **ID:** `ENH-8`
- **Beschreibung:** `structuralHash()` einmalig in `framer-utils.js` definieren, in `extract-framer-components.js` (A1) und `validate-v4-tree.js` (D1) importieren.
- **Dateien:** `scripts/lib/framer-utils.js`, `scripts/extract-framer-components.js`, `scripts/validate-v4-tree.js`
- **Akzeptanz:** Keine doppelte `structuralHash`-Definition mehr. Beide Scripts importieren aus `framer-utils.js`.
- **Test:** A1 und D1 Tests bestehen unverändert

### ENHANCEMENT-9: A2 v4-tree Mode Implementation
- **ID:** `ENH-9`
- **Beschreibung:** `extract-framer-interactions.js` `--v4-tree` Flag: Walked den V4 Tree, erkennt Elemente mit opacity/transform/transition Styles, generiert V4-native interaction Objekte.
- **Datei:** `scripts/extract-framer-interactions.js`
- **Akzeptanz:** `--v4-tree v4-tree.json` erzeugt `interactions[]` mit V4-native JSON
- **Test:** V4 Tree mit opacity-Styles → erwartete interaction im Output

---

## Task 1: C3 — Native Routing Completion (~2h)

**Datei:** `scripts/framer-animation-extractor.js`

### IST-Zustand
```javascript
// Zeile 330: Falscher Funktionsname
function mapEasingToGSAP(cssEasing) {
  const map = {
    'ease': 'ease-out',
    'ease-in': 'ease-in',
    // ...
  };
  return map[cssEasing] || 'ease-out';
}

// Zeile 314: Aufruf mit altem Namen
easing: mapEasingToGSAP(easing),

// Zeile 343-371: buildTransitionInteractions() generiert IMMER GSAP-Code
function buildTransitionInteractions(animatedRules) {
  // ...
  const gsapCode = generateGSAPInteractionCode(interactions);
  return [{
    title: `V4 Interactions (${interactions.length} elements)`,
    type: 'gsap',        // ← IMMER 'gsap'
    code: gsapCode,      // ← IMMER GSAP-Code
    // ...
  }];
}

// Zeile 374-404: generateGSAPInteractionCode() — rein GSAP
function generateGSAPInteractionCode(interactions) {
  const lines = ['gsap.registerPlugin(ScrollTrigger);', ...];
  // ...
}
```

### SOLL-Zustand

```javascript
// 1. Funktion umbenennen
function mapEasingToElementor(cssEasing) {
  const map = {
    'ease': 'ease',
    'ease-in': 'ease-in',
    'ease-out': 'ease-out',
    'ease-in-out': 'ease-in-out',
    'linear': 'linear',
    'cubic-bezier(0.4, 0, 0.2, 1)': 'ease-out',
    'cubic-bezier(0, 0, 0.2, 1)': 'ease-out',
    'power2.out': 'ease-out',
    'power2.in': 'ease-in',
    'power2.inOut': 'ease-in-out',
    'power4.out': 'ease-out',
    'none': 'linear',
  };
  return map[cssEasing] || 'ease-out';
}

// 2. Neues CLI-Flag: --native
// In parseArgs:
native: { type: 'boolean', default: false },

// 3. buildTransitionInteractions() erkennt --native
function buildTransitionInteractions(animatedRules, isNative = false) {
  const interactions = [];
  for (const rule of animatedRules) {
    if (rule.type === 'transition') {
      const interaction = mapTransitionToV4Interaction(rule.declarations, rule.selector);
      interactions.push(interaction);
    }
  }
  if (interactions.length === 0) return [];

  if (isNative) {
    // C3: V4-native JSON output (kein GSAP)
    return [{
      title: `V4 Native Interactions (${interactions.length} elements)`,
      type: 'v4-native',
      interactions: interactions.map(ix => ({
        selector: ix.selector,
        v4_interaction: {
          type: ix.v4_interaction.type,
          animation: ix.v4_interaction.animation,
          trigger: ix.v4_interaction.type === 'entrance' ? 'page_load' : 'scroll_into_view',
          effects: [{
            type: 'transform',
            [ix.effect.includes('slide') ? 'translateY' :
             ix.effect.includes('zoom') ? 'scale' : 'opacity']:
              ix.effect.includes('zoom')
                ? { from: 0.95, to: 1 }
                : ix.effect.includes('slide')
                  ? { from: 30, to: 0, unit: 'px' }
                  : { from: 0, to: 1 },
            opacity: ix.effect !== 'fade' ? { from: 0, to: 1 } : undefined,
            easing: ix.v4_interaction.easing,
            duration: ix.v4_interaction.duration,
            delay: ix.v4_interaction.delay,
          }],
        },
      })),
      mcpRouting: {
        ability: 'novamira-adrianv2/edit-interaction',
        note: 'C3: Route each interaction via McpBridge.editInteraction()',
      },
      description: `${interactions.length} CSS transitions → V4 Native Interactions (C3 Complete)`,
      tags: ['v4', 'interactions', 'native', 'c3'],
      on_conflict: 'replace',
      priority: 25,
    }];
  }

  // Legacy: GSAP-Code (bestehendes Verhalten)
  const gsapCode = generateGSAPInteractionCode(interactions);
  return [{
    title: `V4 Interactions (${interactions.length} elements)`,
    type: 'gsap',
    code: gsapCode,
    // ... (unverändert)
  }];
}

// 4. Alle mapEasingToGSAP → mapEasingToElementor umbenennen
// In mapTransitionToV4Interaction (Zeile 314):
easing: mapEasingToElementor(easing),
```

### Aufruf-Stelle in main()
```javascript
// Zeile 551-556: buildTransitionInteractions() mit --native flag
const transitionInteractions = buildTransitionInteractions(
  animatedRules,
  args.native  // NEU
);
```

### CLI-Erweiterung
```bash
# Legacy (GSAP):
node scripts/framer-animation-extractor.js --html index.html --output plan.json

# C3 Native (V4 Pro Interactions):
node scripts/framer-animation-extractor.js --html index.html --native --output plan.json
```

---

## Task 2: structuralHash-Deduplizierung (~1h)

**Dateien:** `scripts/lib/framer-utils.js`, `scripts/extract-framer-components.js`, `scripts/validate-v4-tree.js`

### IST-Zustand

```javascript
// ── extract-framer-components.js (Zeile 96-103) ──
function structuralHash(elements) {
  if (!Array.isArray(elements)) return '';
  const parts = elements.map(el => {
    const wt = el.widgetType || el.type || 'unknown';
    const kids = (el.elements || el.children || []).length;
    const styleKeys = Object.keys(el.styles || {}).sort().join(',');
    const tag = el.settings?.tag || '';
    return `${wt}|${kids}|${styleKeys}|${tag}`;
  });
  return createHash('md5').update(parts.join('::')).digest('hex').slice(0, 12);
}

// ── validate-v4-tree.js (Zeile 605-611) ──
function structuralHash(children) {
  if (!Array.isArray(children) || children.length < 2) return null;
  const parts = children.map(el => {
    const wt = el.widgetType || el.elType || 'unknown';
    const kids = (el.elements || el.children || []).length;
    const styleKeys = Object.keys(el.styles || {}).sort().join(',');
    return `${wt}|${kids}|${styleKeys}`;
  });
  return parts.join('::');
}
```

### SOLL-Zustand

```javascript
// ── framer-utils.js: NEU hinzugefügt ──
import { createHash } from 'node:crypto';

/**
 * Erzeugt einen strukturierten Hash für eine Liste von V4-Elementen.
 * Verwendet von A1 (Component Extraction) und D1 (Component Reuse Check).
 *
 * @param {Array} elements - Array von V4-Elementen
 * @param {Object} [options]
 * @param {boolean} [options.short=true] - MD5-Hash (12 chars) oder Raw-String
 * @param {boolean} [options.includeTag=false] - settings.tag in Hash einbeziehen
 * @param {boolean} [options.nullOnSmall=false] - null zurückgeben wenn <2 Elemente
 * @returns {string|null}
 */
export function structuralHash(elements, options = {}) {
  const {
    short = true,
    includeTag = false,
    nullOnSmall = false,
  } = options;

  if (!Array.isArray(elements)) return '';
  if (nullOnSmall && elements.length < 2) return null;

  const parts = elements.map(el => {
    const wt = el.widgetType || el.elType || el.type || 'unknown';
    const kids = (el.elements || el.children || []).length;
    const styleKeys = Object.keys(el.styles || {}).sort().join(',');
    const tag = includeTag ? (el.settings?.tag || '') : '';
    return tag ? `${wt}|${kids}|${styleKeys}|${tag}` : `${wt}|${kids}|${styleKeys}`;
  });

  const raw = parts.join('::');
  if (!short) return raw;

  return createHash('md5').update(raw).digest('hex').slice(0, 12);
}
```

### Aufrufer-Änderungen

```javascript
// ── extract-framer-components.js ──
// ENTFERNEN: import { createHash } from 'node:crypto';
// ENTFERNEN: function structuralHash(elements) { ... }
import { structuralHash } from './lib/framer-utils.js';

// Aufruf (Zeile 115):
const hash = structuralHash(children, { includeTag: true });

// ── validate-v4-tree.js ──
// ENTFERNEN: function structuralHash(children) { ... }
import { structuralHash } from './lib/framer-utils.js';

// Aufruf (Zeile 619):
const hash = structuralHash(children, { nullOnSmall: true });
```

---

## Task 3: A2 v4-tree Mode (~1.5h)

**Datei:** `scripts/extract-framer-interactions.js`

### IST-Zustand

```javascript
// Zeile 147-148
if (args['v4-tree']) {
  log('V4 tree mode not yet implemented');
}
```

### SOLL-Zustand

```javascript
if (args['v4-tree']) {
  if (!fs.existsSync(args['v4-tree'])) {
    process.stderr.write(`Error: v4-tree not found: ${args['v4-tree']}\n`);
    process.exit(2);
  }
  const tree = JSON.parse(fs.readFileSync(args['v4-tree'], 'utf8'));
  const roots = Array.isArray(tree) ? tree : [tree];
  const extractedInteractions = [];

  function walkV4Tree(node, depth = 0) {
    // Checke ob das Element transition/animation Props in styles hat
    const styles = node.styles || {};
    for (const [styleId, styleDef] of Object.entries(styles)) {
      if (styleId.startsWith('gc-')) continue;
      const variants = styleDef.variants || [];
      for (const variant of variants) {
        const props = variant.props || {};

        // Opacity-based entrance
        if (props.opacity !== undefined) {
          const opacityVal = props.opacity?.value ?? props.opacity;
          // Nur wenn opacity < 1 → entrance detection
          if (typeof opacityVal === 'number' && opacityVal < 1) {
            extractedInteractions.push({
              selector: `#${node.id || `el-${depth}`}`,
              elementId: node.id || 'unknown',
              v4_interaction: {
                type: 'entrance',
                trigger: 'page_load',
                effects: [{
                  type: 'transform',
                  opacity: { from: 0, to: 1 },
                  easing: 'ease-out',
                  duration: 600,
                }],
              },
              source: `v4-tree:${node.id}:opacity`,
            });
          }
        }

        // Transform-based (translateY, scale)
        const hasTransform = props.transform?.value;
        if (hasTransform) {
          extractedInteractions.push({
            selector: `#${node.id || `el-${depth}`}`,
            elementId: node.id || 'unknown',
            v4_interaction: {
              type: 'scroll',
              trigger: 'scroll_into_view',
              effects: [{
                type: 'transform',
                translateY: { from: 30, to: 0, unit: 'px' },
                opacity: { from: 0, to: 1 },
                easing: 'ease-out',
                duration: 600,
              }],
            },
            source: `v4-tree:${node.id}:transform`,
          });
        }
      }
    }

    // Recurse
    const children = node.elements || node.children || [];
    for (const child of children) {
      walkV4Tree(child, depth + 1);
    }
  }

  for (const root of roots) walkV4Tree(root);
  interactions.push(...extractedInteractions);
  log(`V4 tree mode: ${extractedInteractions.length} interactions extracted`);
}
```

### Deduplizierung
- Gleiche `elementId` + gleicher `v4_interaction.type` → nur erster Eintrag behalten
- Merged mit `--html` mode (wenn beide Flags gesetzt)

---

## Task 4: Tests (~0.5h)

**Datei:** `tests/pipeline.test.js`

### Test Suite 22: C3 Native Routing
```javascript
suite('S22: C3 Native Routing (ENH-7)', () => {
  test('C3: --native flag produces v4-native interactions (no GSAP code)', () => {
    const html = `<style>.card{transition:opacity .3s ease-out}</style><div class="card"></div>`;
    const htmlFile = tmpFile('c3-native.html', html);
    const outFile = tmpFile('c3-native-plan.json');
    run('framer-animation-extractor.js', ['--html', htmlFile, '--native', '--output', outFile]);
    const plan = readJson(outFile);
    const v4Native = plan.snippets.filter(s => s.type === 'v4-native');
    assert.ok(v4Native.length > 0, 'Should have v4-native snippet');
    assert.strictEqual(v4Native[0].code, undefined, 'No GSAP code');
    assert.ok(v4Native[0].interactions.length > 0, 'Has interactions array');
    assert.ok(v4Native[0].mcpRouting, 'Has mcpRouting');
  });

  test('C3: --native flag NOT set → legacy GSAP output', () => {
    const html = `<style>.card{transition:opacity .3s ease-out}</style><div class="card"></div>`;
    const htmlFile = tmpFile('c3-legacy.html', html);
    const outFile = tmpFile('c3-legacy-plan.json');
    run('framer-animation-extractor.js', ['--html', htmlFile, '--output', outFile]);
    const plan = readJson(outFile);
    const gsapSnippets = plan.snippets.filter(s => s.type === 'gsap');
    assert.ok(gsapSnippets.length > 0, 'Should have GSAP snippet');
  });
});
```

### Test Suite 23: structuralHash Deduplizierung
```javascript
suite('S23: structuralHash Deduplication (ENH-8)', () => {
  test('ENH-8: A1 still detects repeated components', () => {
    const xml = `<div data-framer-name="Card1">A</div><div data-framer-name="Card2">B</div><style>.card{}</style>`;
    const xmlFile = tmpFile('enh8-cards.xml', xml);
    const outDir = tmpDir('components-enh8');
    run('extract-framer-components.js', ['--xml', xmlFile, '--output', outDir]);
    // Check that components-plan.json exists
    const planFile = path.join(outDir, 'components-plan.json');
    assert.ok(fs.existsSync(planFile), 'components-plan.json exists');
  });

  test('ENH-8: D1 still detects component reuse', () => {
    // 2 identical card groups → COMPONENT_REUSE_POTENTIAL warning
    const tree = [
      { widgetType:'e-flexbox', id:'root1', elements:[
        { widgetType:'e-heading', id:'h1', styles:{}, elements:[] },
        { widgetType:'e-paragraph', id:'p1', styles:{}, elements:[] }
      ]},
      { widgetType:'e-flexbox', id:'root2', elements:[
        { widgetType:'e-heading', id:'h2', styles:{}, elements:[] },
        { widgetType:'e-paragraph', id:'p2', styles:{}, elements:[] }
      ]}
    ];
    const treeFile = tmpFile('enh8-tree.json', JSON.stringify(tree));
    const res = runJson('validate-v4-tree.js', [treeFile, '--mode=warn']);
    const reuseWarnings = res.warnings.filter(w => w.rule === 'COMPONENT_REUSE_POTENTIAL');
    assert.ok(reuseWarnings.length > 0, 'Has component reuse warning');
  });
});
```

### Test Suite 24: A2 v4-tree Mode
```javascript
suite('S24: A2 v4-tree Mode (ENH-9)', () => {
  test('ENH-9: --v4-tree extracts interactions from opacity styles', () => {
    const tree = [
      { id:'hero', widgetType:'e-flexbox', styles:{
        s1:{ variants:[{ meta:{breakpoint:'desktop'}, props:{ opacity:0.5 } }] }
      }, elements:[] }
    ];
    const treeFile = tmpFile('a2-v4tree.json', JSON.stringify(tree));
    const outFile = tmpFile('a2-v4tree-plan.json');
    run('extract-framer-interactions.js', ['--v4-tree', treeFile, '--output', outFile]);
    const plan = readJson(outFile);
    assert.ok(plan.interactions.length > 0, 'Has interactions');
    assert.strictEqual(plan.interactions[0].v4_interaction.type, 'entrance');
  });

  test('ENH-9: --v4-tree returns empty interaction for tree without animations', () => {
    const tree = [
      { id:'static', widgetType:'e-flexbox', styles:{}, elements:[] }
    ];
    const treeFile = tmpFile('a2-static.json', JSON.stringify(tree));
    const outFile = tmpFile('a2-static-plan.json');
    run('extract-framer-interactions.js', ['--v4-tree', treeFile, '--output', outFile]);
    const plan = readJson(outFile);
    assert.strictEqual(plan.interactions.length, 0);
  });
});
```

---

## Änderungsreihenfolge

1. **structuralHash-Deduplizierung** (Task 2) — zuerst, da andere Tasks darauf aufbauen können
2. **C3 Native Routing** (Task 1) — hauptsächlich `framer-animation-extractor.js`
3. **A2 v4-tree Mode** (Task 3) — unabhängig von 1 und 2
4. **Tests** (Task 4) — nach allen Code-Änderungen

---

## Impact-Analyse

| Datei | Änderung | Regression-Risiko |
|-------|----------|-------------------|
| `framer-utils.js` | +`structuralHash()` export | Niedrig — neue Funktion |
| `extract-framer-components.js` | Import statt lokaler Definition | Mittel — Hash muss identisch sein |
| `validate-v4-tree.js` | Import statt lokaler Definition | Mittel — Hash muss identisch sein |
| `framer-animation-extractor.js` | Rename + `--native` Flag + neue Funktion | Mittel — Legacy-Pfad unverändert |
| `extract-framer-interactions.js` | v4-tree Mode Implementierung | Niedrig — neuer Code-Pfad |
| `tests/pipeline.test.js` | 3 neue Suiten, 6 Test-Fälle | Kein — nur Additions |

---

## Definition of Done

- [ ] `mapEasingToGSAP` → `mapEasingToElementor` umbenannt (alle Referenzen)
- [ ] `--native` Flag in `framer-animation-extractor.js` → V4-native JSON Output
- [ ] `structuralHash()` in `framer-utils.js` einmalig definiert
- [ ] A1 und D1 importieren `structuralHash` aus `framer-utils.js`
- [ ] A2 `--v4-tree` Modus: Walked V4 Tree, erkennt opacity/transform Styles
- [ ] 71 + 6 = 77 Tests, alle grün
- [ ] Syntax-Check aller 5 Dateien

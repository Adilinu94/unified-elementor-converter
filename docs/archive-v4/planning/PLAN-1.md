# PLAN.md — Phase 1: Sprint 1 — Quick Wins + Root-Cause Fix

> **Phase:** 1 | **Sprint:** 1 | **Geschätzt:** ~5h
> **Erstellt:** 2026-06-13 | **Plan basiert auf:** REQUIREMENTS.md, ROADMAP.md, V4_DESIGN_IMPROVEMENTS_RESEARCH.md (v2)

---

## Ziel

5 Code-Änderungen + 5 neue Tests. Von DOM-Tiefe 8→6, Grid ≥10%, GV-Substitution ≥80%, GCs semantisch, Breakpoint-präzises Responsive.

---

## Task 1: C2 — Strict Grid Mapping (RC-09 Upgrade)

**Datei:** `scripts/convert-xml-to-v4.js`
**Aufwand:** ~1.5h

### IST-Zustand

`determineWidgetType()` nutzt Child-Count-Heuristik für Grid-Erkennung (Zeilen ~140-160):

```javascript
if (childCount >= 2) {
    if (/\b(grid|gallery|cards|stats|features|logos|columns)\b/.test(name))
        return 'e-div-block';
    // ...
}
```

`detectGridLayout()` setzt `grid-template-columns` basierend auf Child-Count (Zeilen ~250-260).

**Problem:** Beide prüfen NICHT auf explizite CSS-Grid-Properties (`display: grid`, `grid-template-columns`). Elemente mit `display:grid` in Framer-CSS werden als `e-flexbox` klassifiziert.

### SOLL

1. **`determineWidgetType()` erweitern** — vor der Name-Pattern-Heuristik prüfen:

```javascript
// NEU: Explizites CSS-Grid erkennen
if (attrs.display === 'grid') return 'e-div-block';
if (attrs['grid-template-columns'] || attrs['grid-template-rows']) return 'e-div-block';
```

2. **`detectGridLayout()` erweitern** — `grid-template-columns` aus CSS-Attributen übernehmen:

```javascript
function detectGridLayout(xmlNode, attrs) {
  // NEU: Explizite grid-template-columns aus CSS
  if (attrs['grid-template-columns']) return attrs['grid-template-columns'];
  // Bestehendes Fallback...
}
```

3. **Compound-Layout-Detection behalten** — aber nur als Fallback nach expliziten CSS-Checks.

### Test (C2)

```javascript
// In pipeline.test.js:
test('C2: display:grid → e-div-block', () => {
  const attrs = { name: 'stats', display: 'grid' };
  expect(determineWidgetType(attrs, { tagName: 'div', children: [] })).toBe('e-div-block');
});

test('C2: grid-template-columns → e-div-block', () => {
  const attrs = { name: 'gallery', 'grid-template-columns': '1fr 1fr 1fr' };
  expect(determineWidgetType(attrs, { tagName: 'div', children: [] })).toBe('e-div-block');
});
```

---

## Task 2: C4 — Semantic GC Naming

**Datei:** `scripts/generate-global-classes.js`
**Aufwand:** ~1h

### IST-Zustand

`suggestName()` generiert `gc-text-md`, `gc-section-1`, `gc-bg-3` — nicht semantisch.

### SOLL

`suggestName()` ersetzen durch `suggestNameSemantic()` mit:

1. **Typ-Präfix**: `text` (font-size) | `surface` (background-color) | `rounded` (border-radius) | `spacing` (gap/padding)
2. **Semantic-Identifier**: Wenn `color` → Token-Name aus Token-Map extrahieren (z.B. `primary`, `neutral`)
3. **Size-Modifier**: `xl` (≥48px), `lg` (≥28px), `md` (≥18px), `sm` (<18px)

```javascript
function suggestNameSemantic(type, props, index, tokenMap) {
  const parts = ['gc'];
  const propKeys = Object.keys(props);

  // 1. Typ-Präfix
  if (type === 'typography') {
    parts.push('text');
    // Size
    const fs = props['font-size'];
    const n = getPxNumber(fs);
    if (n >= 48) parts.push('xl');
    else if (n >= 28) parts.push('lg');
    else if (n >= 18) parts.push('md');
    else parts.push('sm');
    // Color semantic
    const colorVal = props['color']?.value;
    if (colorVal && tokenMap) {
      const token = findTokenByHex(colorVal, tokenMap);
      parts.push(token || 'neutral');
    }
  } else if (type === 'structure') {
    if (propKeys.includes('max-width') && propKeys.some(k => k.startsWith('padding')))
      parts.push('section');
    else if (propKeys.includes('gap'))
      parts.push('grid');
    else if (propKeys.some(k => k.startsWith('padding')))
      parts.push('pad');
    else parts.push('layout');
  } else if (type === 'background') {
    parts.push('surface');
    const bgVal = props['background-color']?.value;
    if (bgVal && tokenMap) {
      const token = findTokenByHex(bgVal, tokenMap);
      parts.push(token || 'neutral');
    }
  }

  return sanitizeGcName(parts.join('-'));
}
```

**Erwartete Outputs:** `gc-text-lg-primary`, `gc-surface-neutral`, `gc-section-md`, `gc-grid-lg`

### Test (C4)

```javascript
test('C4: semantic GC naming — text', () => {
  const props = { 'font-size': wrapSize('48px'), color: wrapColor('#111111') };
  const tokenMap = { '#111111': 'primary' };
  expect(suggestNameSemantic('typography', props, 1, tokenMap)).toBe('gc-text-xl-primary');
});
```

---

## Task 3: C5 — Breakpoint-bewusstes Scaling

**Datei:** `scripts/auto-scale-responsive.js`
**Aufwand:** ~2h

### IST-Zustand

```javascript
const SCALE_FACTORS = { tablet: 0.75, mobile: 0.6 };
```

Harte Faktoren für ALLE Elemente. Framer-spezifische Breakpoints werden ignoriert.

### SOLL

1. **Neues CLI-Flag:** `--breakpoints tokens/responsive-breakpoints.json`
2. **`getElementBreakpointFactors()`** — Element-spezifische Faktoren aus `breakpoints.json`:

```javascript
function loadBreakpoints(breakpointsPath) {
  if (!breakpointsPath || !fs.existsSync(breakpointsPath)) return null;
  return JSON.parse(fs.readFileSync(breakpointsPath, 'utf8'));
}

function getElementScaleFactors(elementId, styleId, breakpointsData) {
  if (!breakpointsData) {
    // Fallback: Pauschalfaktoren
    return { tablet: 0.75, mobile: 0.6 };
  }

  const node = breakpointsData.nodes?.find(n =>
    n.selector?.includes(elementId) || n.name?.includes(styleId)
  );

  if (node?.variants) {
    const base = node.variants.find(v => !v.meta?.breakpoint)?.props || {};
    const tablet = node.variants.find(v => v.meta?.breakpoint === 'tablet')?.props || {};
    const mobile = node.variants.find(v => v.meta?.breakpoint === 'mobile')?.props || {};

    const baseFs = getPxValue(base['font-size']);
    return {
      tablet: baseFs ? (getPxValue(tablet['font-size']) || baseFs * 0.75) / baseFs : 0.75,
      mobile: baseFs ? (getPxValue(mobile['font-size']) || baseFs * 0.6) / baseFs : 0.6,
    };
  }

  return { tablet: 0.75, mobile: 0.6 };
}
```

3. **Integration in `autoScaleResponsive()`** — `SCALE_FACTORS` durch `getElementScaleFactors()` ersetzen:

```javascript
function autoScaleResponsive(tree, breakpointsData) {
  walkTree(tree, (node) => {
    if (node?.styles) {
      for (const [styleId, style] of Object.entries(node.styles)) {
        const factors = getElementScaleFactors(node.id, styleId, breakpointsData);
        // Verwende factors.tablet / factors.mobile statt SCALE_FACTORS.tablet / SCALE_FACTORS.mobile
        // ...
      }
    }
  });
}
```

### Test (C5)

```javascript
test('C5: element-spezifische Breakpoint-Faktoren', () => {
  const bpData = {
    nodes: [{
      name: 'hero-headline',
      variants: [
        { meta: { breakpoint: null }, props: { 'font-size': wrapSize('80px') } },
        { meta: { breakpoint: 'tablet' }, props: { 'font-size': wrapSize('48px') } },
        { meta: { breakpoint: 'mobile' }, props: { 'font-size': wrapSize('32px') } },
      ]
    }]
  };
  const factors = getElementScaleFactors('hero-headline', 'hero-headline', bpData);
  expect(factors.tablet).toBe(0.6);
  expect(factors.mobile).toBe(0.4);
});

test('C5: Fallback ohne breakpoints.json', () => {
  const factors = getElementScaleFactors('any', 'any', null);
  expect(factors.tablet).toBe(0.75);
  expect(factors.mobile).toBe(0.6);
});
```

---

## Task 4: C6 — Token-zu-GV-Substitutions-Pass (Root-Cause Fix)

**Datei:** Neuer Pass in `scripts/convert-xml-to-v4.js` (oder eigenes Script)
**Aufwand:** ~2h

### Entscheidung

**In `convert-xml-to-v4.js` als Nachbearbeitungs-Pass integrieren.** Grund:
- Der Tree ist nach `convertNode()` vollständig aufgebaut
- Token-Mapping ist bereits geladen
- Substitution braucht Walk über den fertigen Tree

### SOLL

1. **Neue Funktion `substituteTokensWithGvIds(tree, tokenMapping)`**:

```javascript
function substituteTokensWithGvIds(tree, tokenMapping) {
  if (!tokenMapping) return { tree, substitutions: 0 };
  let substitutions = 0;

  walkV4Tree(tree, (node) => {
    if (!node.styles) return;
    for (const [styleId, styleDef] of Object.entries(node.styles)) {
      for (const variant of (styleDef.variants || [])) {
        for (const [prop, value] of Object.entries(variant.props || {})) {
          if (!value || typeof value !== 'object') continue;

          // Color → GV
          if (value['$$type'] === 'color') {
            const hex = normalizeHex(value.value);
            if (!hex) continue;
            const gvId = findGvIdForHex(hex, tokenMapping);
            if (gvId) {
              variant.props[prop] = wrapGvColor(gvId);
              substitutions++;
            }
          }

          // Font → GV
          if (prop === 'font-family' && value['$$type'] === 'string') {
            const family = value.value;
            const gvId = findGvIdForFont(family, tokenMapping);
            if (gvId) {
              variant.props[prop] = wrapGvFont(gvId);
              substitutions++;
            }
          }
        }
      }
    }
  });

  return { tree, substitutions };
}

function findGvIdForHex(hex, tokenMapping) {
  for (const [name, data] of Object.entries(tokenMapping.colors || {})) {
    if (data.hex === hex && data.gv_id) return data.gv_id;
  }
  return null;
}

function findGvIdForFont(family, tokenMapping) {
  for (const [name, data] of Object.entries(tokenMapping.fonts || {})) {
    if (data.family === family && data.gv_id) return data.gv_id;
  }
  return null;
}
```

2. **Integration in `main()`** — nach `convertNode()` und vor Output:

```javascript
// Nach der Konvertierung:
if (tokenMapping) {
  const roots = Array.isArray(result) ? result : [result];
  for (const root of roots) {
    const { substitutions } = substituteTokensWithGvIds(root, tokenMapping);
    log(`GV substitution: ${substitutions} hardcoded → GV references`);
  }
}
```

3. **Neues CLI-Flag:** `--substitute-gv` (default `true` wenn `--tokens` gesetzt)

### Test (C6)

```javascript
test('C6: #111111 → e-gv-abc123 substitution', () => {
  const tree = {
    id: 'test',
    widgetType: 'e-heading',
    styles: {
      testStyle: {
        variants: [{
          meta: { breakpoint: null, state: null },
          props: { color: wrapColor('#111111') }
        }]
      }
    },
    settings: { classes: { '$$type': 'classes', value: ['testStyle'] } }
  };

  const tokenMapping = {
    colors: { 'primary-black': { hex: '#111111', gv_id: 'e-gv-abc123' } }
  };

  const result = substituteTokensWithGvIds(tree, tokenMapping);
  expect(result.substitutions).toBe(1);
  const color = result.tree.styles.testStyle.variants[0].props.color;
  expect(color['$$type']).toBe('gv-color');
  expect(color.value).toBe('e-gv-abc123');
});
```

---

## Task 5: D3 — GRID_VS_FLEXBOX_COVERAGE Validierungs-Check

**Datei:** `scripts/validate-v4-tree.js`
**Aufwand:** ~0.5h

### SOLL

Neue Funktion `checkGridVsFlexboxCoverage()` in `validate-v4-tree.js`:

```javascript
function checkGridVsFlexboxCoverage(el, path, errors, warnings) {
  const elType = getElementType(el);
  if (elType !== 'e-flexbox') return;

  const styles = el.styles || {};
  const children = el.elements || [];

  for (const [styleId, styleDef] of Object.entries(styles)) {
    for (const variant of (styleDef.variants || [])) {
      const props = variant.props || {};

      // Check 1: flex-wrap: wrap → sollte Grid sein
      if (props['flex-wrap']?.value === 'wrap') {
        warnings.push({
          check: 8, rule: 'GRID_VS_FLEXBOX',
          elementId: getElementId(el), path,
          message: `e-flexbox with flex-wrap:wrap — consider e-div-block with display:grid`,
        });
        return;
      }
    }
  }

  // Check 2: ≥4 direkte Kinder → Grid-Kandidat
  if (children.length >= 4) {
    warnings.push({
      check: 8, rule: 'GRID_VS_FLEXBOX',
      elementId: getElementId(el), path,
      message: `e-flexbox with ${children.length} children — consider grid-template-columns`,
    });
  }
}
```

**Integration in `validate()`** — `checkGridVsFlexboxCoverage(el, path, errors, warnings)` aufrufen.

**Scoring-Update:** C8 zum `vital: false, weight: 5` Set hinzufügen.

### Test (D3)

```javascript
test('D3: e-flexbox with flex-wrap:wrap → warning', () => {
  const el = {
    id: 'flex-wrap-container',
    elType: 'e-flexbox',
    styles: {
      s1: { variants: [{ meta: { breakpoint: null, state: null }, props: { 'flex-wrap': wrapType('string', 'wrap') } }] }
    },
    elements: [],
    settings: {}
  };
  const warnings = [];
  checkGridVsFlexboxCoverage(el, '0', [], warnings);
  expect(warnings.length).toBe(1);
  expect(warnings[0].rule).toBe('GRID_VS_FLEXBOX');
});

test('D3: e-flexbox with 4+ children → warning', () => {
  const el = {
    id: 'many-children',
    elType: 'e-flexbox',
    styles: {},
    elements: [{ id: 'c1' }, { id: 'c2' }, { id: 'c3' }, { id: 'c4' }],
    settings: {}
  };
  const warnings = [];
  checkGridVsFlexboxCoverage(el, '0', [], warnings);
  expect(warnings.length).toBe(1);
});
```

---

## Task 6: Tests — 5 neue Test-Blöcke

**Datei:** `tests/pipeline.test.js`
**Aufwand:** ~1h

| # | Test-Block | Beschreibung |
|---|-----------|-------------|
| 1 | C2 Grid Detection | `display:grid` → `e-div-block`, `grid-template-columns` → `e-div-block` |
| 2 | C4 Semantic GC Names | `suggestNameSemantic()` mit Token-Map → `gc-text-xl-primary` |
| 3 | C5 Breakpoint Factors | Element-spezifische Faktoren aus `breakpoints.json`, Fallback |
| 4 | C6 GV Substitution | `#111111` → `e-gv-abc123`, Font-Substitution |
| 5 | D3 GRID_VS_FLEXBOX | `flex-wrap:wrap` → Warning, 4+ Kinder → Warning |

**Integration in `pipeline.test.js`** — Neue `describe()` Blöcke am Ende der Datei hinzufügen, `import`-Statements für neue Exports ergänzen.

---

## Implementierungs-Reihenfolge

```
1. C2 (convert-xml-to-v4.js)        ← kein Dependency
2. C4 (generate-global-classes.js)  ← kein Dependency
3. C5 (auto-scale-responsive.js)    ← braucht extract-responsive-breakpoints.js Output (existiert)
4. C6 (convert-xml-to-v4.js)        ← braucht design-token-extractor.js Output (existiert)
5. D3 (validate-v4-tree.js)         ← kein Dependency
6. Tests (pipeline.test.js)         ← nach allen Code-Änderungen
```

C2, C4, C5, D3 können parallel implementiert werden. C6 sequentiell nach C2 (gleiche Datei).

---

## Verifikation

```bash
node --check scripts/convert-xml-to-v4.js
node --check scripts/generate-global-classes.js
node --check scripts/auto-scale-responsive.js
node --check scripts/validate-v4-tree.js
npm test    # Erwartet: 49→54 Tests, alle grün
```

---

## Akzeptanzkriterien (Sprint 1)

- [ ] `display:grid` in Framer-CSS → `e-div-block` im V4-Tree
- [ ] `grid-template-columns` aus CSS wird übernommen
- [ ] GC-Namen folgen BEM-Pattern (`gc-text-xl-primary` nicht `gc-text-1`)
- [ ] `auto-scale-responsive.js` liest Breakpoints aus `tokens/responsive-breakpoints.json`
- [ ] 0 Hardcoded-Hex-Werte im Output wenn gv_id im Token-Mapping vorhanden
- [ ] `e-flexbox` mit `flex-wrap:wrap` oder 4+ Kindern → Warning im Validator
- [ ] `npm test` → ≥54/54

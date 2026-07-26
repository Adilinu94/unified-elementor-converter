# PLAN.md — Phase 2: Sprint 2 — Components & Interactions

> **Phase:** 2 | **Sprint:** 2 | **Geschätzt:** ~8h
> **Erstellt:** 2026-06-13

## Ziel

2 neue Scripts (A1, A2), 2 Enhancements (C1, C3), 1 Integration (B1-B3), 1 Validation-Check (D1), 4 Tests.

---

## Task 1: A1 — extract-framer-components.js (NEU)

**Aufwand:** ~3h | **Datei:** `scripts/extract-framer-components.js`

### Funktion
- Analysiert Framer HTML/XML auf wiederholte Container-Muster
- Erkennt ≥2 strukturell identische Element-Gruppen
- Extrahiert Template + variable Properties
- Output: `components/<name>.json`

### Kern-Logik
```javascript
function detectRepeatingComponents(xmlTree) {
  // 1. Finde alle Container mit direkten Kindern
  // 2. Gruppiere nach Kinder-Struktur (widgetType + Kinder-Anzahl)
  // 3. ≥2 identische Strukturen → Component-Kandidat
  // 4. Extrahiere eine Instanz als Template
  // 5. Identifiziere variable Felder (Text, Image, Link)
}
```

### CLI
```bash
node scripts/extract-framer-components.js --xml framer-export/index.html --output components/
```

---

## Task 2: A2 — extract-framer-interactions.js (NEU)

**Aufwand:** ~3h | **Datei:** `scripts/extract-framer-interactions.js`

### Funktion
- Extrahiert Framer Scroll/Trigger-Animationen aus HTML
- Mapped auf V4 Pro Interactions (native JSON, KEIN GSAP)
- Output: `interactions-plan.json`

### Kern-Logik
```javascript
const TRIGGER_MAP = {
  'scroll-into-view': 'scroll',
  'hover': 'mouse',
  'click': 'click',
  'page-load': 'entrance',
};
```

---

## Task 3: C1 — Component Preservation (Enhancement)

**Aufwand:** ~2h | **Datei:** `scripts/convert-xml-to-v4.js`

`determineWidgetType()`: `attrs.componentId` → `'e-component'` zurückgeben. Properties als Overrides speichern.

---

## Task 4: C3 — V4-Native Routing (Fix)

**Aufwand:** ~1h | **Datei:** `scripts/framer-animation-extractor.js`

Easing-Map: GSAP-Namen → Elementor-Namen. Route: `inject-animation-code.js` → `edit-interaction`.

---

## Task 5: B1-B3 — Pipeline-Integration

**Aufwand:** ~1h | Routing via McpBridge documentation in A1/A2 Output.

---

## Task 6: D1 — COMPONENT_REUSE_POTENTIAL

**Aufwand:** ~0.5h | **Datei:** `scripts/validate-v4-tree.js`

Duplizierte Element-Gruppen erkennen → Warning.

---

## Task 7: Tests — 4 neue Test-Blöcke

**Aufwand:** ~1h | **Datei:** `tests/pipeline.test.js`

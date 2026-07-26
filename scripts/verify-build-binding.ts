#!/usr/bin/env node
/**
 * Slim Post-Build Binding Validation
 *
 * Prüft einen Elementor Content Dump ausschließlich auf Verletzungen von Invariant I:
 * "Jede ID im styles-Map MUSS auch im settings.classes.value-Array vorhanden sein."
 *
 * Dies ersetzt den token-verschwendenden `full_dump: true` Parse-Job des Agents
 * durch eine lokale, millisekundenschnelle Filterung.
 *
 * Usage:
 *   node --import tsx scripts/verify-build-binding.ts [elementor-dump.json]
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// ─────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────

interface BindingViolation {
  elementId: string;
  widgetType: string;
  definedStyles: string[];
  boundClasses: string[];
  missingBindings: string[];
}

interface V4Element {
  id?: string;
  settings?: { classes?: string[] | { value?: string[] } };
  styles?: Record<string, unknown>;
  elements?: V4Element[];
  children?: V4Element[];
  content?: V4Element[];
  widgetType?: string;
  widget_type?: string;
  elType?: string;
  el_type?: string;
  [key: string]: unknown;
}

// ─────────────────────────────────────────────
// BINDING CHECK
// ─────────────────────────────────────────────

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');

function checkBinding(obj: unknown, violations: BindingViolation[], currentId = 'root'): void {
  if (typeof obj !== 'object' || obj === null) return;

  const o = obj as V4Element;

  // Prüfe auf Element-Struktur
  if (o.id && o.settings && o.styles) {
    const elementId = o.id;
    const styleIds = Object.keys(o.styles);

    // Hole gebundene Klassen (kann in value sein oder direkt ein Array, je nach V4 Struktur)
    let boundClasses: string[] = [];
    if (o.settings.classes) {
      if (Array.isArray(o.settings.classes)) {
        boundClasses = o.settings.classes;
      } else if (o.settings.classes.value && Array.isArray(o.settings.classes.value)) {
        boundClasses = o.settings.classes.value;
      }
    }

    // Nur lokale Style-IDs pruefen (gc- = Global Classes, brauchen kein Binding in settings.classes)
    const localStyleIds = styleIds.filter(sid => !sid.startsWith('gc-'));
    // Finde ungebundene lokale Styles
    const unboundStyles = localStyleIds.filter(styleId => !boundClasses.includes(styleId));

    if (unboundStyles.length > 0) {
      violations.push({
        elementId,
        widgetType: o.widgetType || o.widget_type || o.elType || o.el_type || 'unknown',
        definedStyles: styleIds,
        boundClasses,
        missingBindings: unboundStyles,
      });
    }
  }

  // Kinder traversieren - unterstuetzt alle Novamira/Elementor Strukturen:
  // MCP elementor-get-content: elements[]
  // Pipeline convert-xml-to-v4: children[]
  // batch-build-page input: elements[] oder children[]
  const kids = o.elements ?? o.children ?? o.content ?? [];
  if (Array.isArray(kids)) {
    for (const child of kids) checkBinding(child, violations, o.id || currentId);
  }
}

// ─────────────────────────────────────────────
// MAIN
// ─────────────────────────────────────────────

async function main(): Promise<void> {
  const dumpPath = process.argv[2] || path.join(rootDir, 'elementor-dump.json');

  if (!fs.existsSync(dumpPath)) {
    console.error(`❌ Dump-Datei nicht gefunden: ${dumpPath}`);
    console.log('💡 Tipp: Speichere die Ausgabe von `novamira/elementor-get-content` als elementor-dump.json');
    process.exit(1);
  }

  console.log(`▶️  Lade Elementor Dump von: ${dumpPath}`);
  const dump = JSON.parse(fs.readFileSync(dumpPath, 'utf8'));

  console.log('▶️  Prüfe Styles-Classes-Binding (Invariant I)...');
  const violations: BindingViolation[] = [];

  // Der Dump kann direkt der Tree sein oder in einem 'content' Schlüssel liegen
  // Novamira elementor-get-content gibt { content: [...] } zurueck
  // elementor-get-content mit full_dump gibt { data: { content: [...] } }
  // Pipeline dumps koennen direkt ein Array sein
  const treeToCheck = dump?.data?.content ?? dump?.content ?? dump;
  // Array-Root korrekt behandeln (Novamira gibt content als Array zurueck)
  if (Array.isArray(treeToCheck)) {
    for (const node of treeToCheck) checkBinding(node, violations);
  } else {
    checkBinding(treeToCheck, violations);
  }

  if (violations.length === 0) {
    console.log('\n✅ SUCCESS: Keine Binding-Verletzungen gefunden. Alle Styles sind korrekt gebunden.');
  } else {
    console.log(`\n⚠️  WARNUNG: ${violations.length} Binding-Verletzung(en) gefunden!`);
    console.log(JSON.stringify(violations, null, 2));
    console.log('\n💡 FIX: Füge die fehlenden Style-IDs zu `settings.classes.value` hinzu oder entferne die ungenutzten Styles.');
    process.exit(1);
  }
}

main();

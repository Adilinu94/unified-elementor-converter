#!/usr/bin/env node
/**
 * extract-framer-forms.ts  —  A3: Form Extraction (Sprint 3)
 *
 * Erkennt Framer Formulare (Input-Felder, Labels, Submit-Buttons)
 * und generiert V4 Atomic Form Strukturen.
 *
 * Usage:
 *   node --import tsx scripts/extract-framer-forms.ts \
 *     --html FramerExport/index.html \
 *     --output form-plan.json
 */

import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';

// ─────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────

interface FormField {
  type: string;
  label: string;
  placeholder: string;
  required: boolean;
}

interface FormAction {
  type: 'email';
  to: string;
}

interface FormDef {
  name: string;
  action: FormAction;
  fields: FormField[];
  submit_text: string;
}

interface V4AtomicSetting {
  '$$type': string;
  value: unknown;
}

interface V4AtomicElement {
  type: string;
  elType: string;
  widgetType: string;
  id: string;
  settings: Record<string, V4AtomicSetting>;
  styles: Record<string, never>;
}

interface V4FormTree {
  widgetType: string;
  id: string;
  settings: {
    tag?: string;
    classes: V4AtomicSetting;
    [key: string]: V4AtomicSetting | string | undefined;
  };
  styles: Record<string, never>;
  elements: V4AtomicElement[];
}

interface FormWithTree extends FormDef {
  v4_tree: V4FormTree;
}

interface FormOutput {
  meta: {
    generatedAt: string;
    source: string;
    totalForms: number;
  };
  forms: FormWithTree[];
  mcpRouting: {
    ability: string;
    note: string;
    example_call: {
      ability_name: string;
      parameters: Record<string, unknown>;
    };
  };
}

// ─────────────────────────────────────────────
// CLI
// ─────────────────────────────────────────────

const { values: args } = parseArgs({
  options: {
    html:     { type: 'string' },
    xml:      { type: 'string' },
    output:   { type: 'string' },
    verbose:  { type: 'boolean', default: false },
    help:     { type: 'boolean', default: false },
  },
  strict: false,
});

const htmlPath: string | undefined = args.html as string | undefined;
const xmlPath: string | undefined = args.xml as string | undefined;
const outputPath: string | undefined = args.output as string | undefined;

if (args.help || (!htmlPath && !xmlPath)) {
  console.log(`

extract-framer-forms.ts  —  A3: Form Extraction (Sprint 3)

ZWECK:
  Erkennt Framer Formulare in HTML-Exports und generiert
  V4 Atomic Form Strukturen. Erkennt:
    • <form> Elemente mit Input-Feldern und Submit-Buttons
    • Standalone Input-Gruppen (≥2 Inputs ohne <form> Tag)
    • Labels (via <label> oder placeholder)
    • Pflichtfelder (required Attribut)
    • Submit-Text (Button oder Input[type=submit])

EINGABE (mindestens eine):
  --html FILE           Framer HTML Export
  --xml FILE            Alternative XML/HTML-Datei

OPTIONEN:
  --output FILE         Output-Pfad (form-plan.json)       [default: stdout]
  --verbose             Ausfuehrliche Logs
  --help                Diese Hilfe

BEISPIELE:
  # Aus Framer HTML-Export:
  node --import tsx scripts/extract-framer-forms.ts \\\\
    --html FramerExport/index.html \\\\
    --output form-plan.json

  # Stdout (kein --output):
  node --import tsx scripts/extract-framer-forms.ts --html index.html

OUTPUT:
  form-plan.json  — Meta, forms[] mit v4_tree, MCP-Routing

V4 ATOMIC FORM WIDGETS:
  e-field-label   — Label-Text pro Feld
  e-field-input   — Input-Feld (type: text|email, placeholder, required)
  e-field-submit  — Submit-Button mit konfigurierbarem Text

MCP-ROUTING:
  ability: novamira-adrianv2/create-atomic-form
  (B4: EINZIGE neue Ability im Sprint-Plan — muss im Plugin
   implementiert werden)

EXIT-CODES:
  0 = Forms erkannt und V4 Trees generiert
  1 = Keine Formulare gefunden
  2 = Eingabedatei nicht gefunden / kein Input-Flag
`);
  if (args.help) process.exit(0);
  process.exit(2);
}

const log = (...m: string[]) => {
  if (args.verbose) process.stderr.write('[form-extract] ' + m.join(' ') + '\n');
};

// ─── FORM DETECTION ─────────────────────────────────────────────────────────

function detectFormElements(html: string): FormDef[] {
  const forms: FormDef[] = [];

  // Find all <input>, <textarea>, <select> elements with their context
  const formRe = /<form[^>]*>([\s\S]*?)<\/form>/gi;

  // Try to find explicit <form> elements first
  let formMatch: RegExpExecArray | null;
  while ((formMatch = formRe.exec(html)) !== null) {
    const formContent = formMatch[1];
    const formAttrs = formMatch[0];
    const action = (formAttrs.match(/action=["']([^"']+)["']/) || [])[1] || 'email';

    const fields = extractFieldsFromBlock(formContent);
    const submitText = extractSubmitFromBlock(formContent);

    if (fields.length > 0) {
      forms.push({
        name: 'ContactForm',
        action: { type: 'email', to: action.replace('mailto:', '') || '{{email}}' },
        fields,
        submit_text: submitText || 'Submit',
      });
    }
  }

  // Fallback: Detect form-like patterns without <form> tag
  if (forms.length === 0) {
    const allInputs = detectStandaloneInputs(html);
    if (allInputs.length >= 2) {
      forms.push({
        name: 'ContactForm',
        action: { type: 'email', to: '{{email}}' },
        fields: allInputs,
        submit_text: detectSubmitText(html) || 'Submit',
      });
    }
  }

  return forms;
}

function extractFieldsFromBlock(html: string): FormField[] {
  const fields: FormField[] = [];

  const inputRe = /<input\s+([^>]*?)\/?>/gi;
  let m: RegExpExecArray | null;
  while ((m = inputRe.exec(html)) !== null) {
    const attrs = m[1];
    const type = (attrs.match(/type=["']([^"']+)["']/i) || [])[1] || 'text';
    const name = (attrs.match(/name=["']([^"']+)["']/i) || [])[1] || '';
    const placeholder = (attrs.match(/placeholder=["']([^"']+)["']/i) || [])[1] || '';
    const required = /\brequired\b/i.test(attrs);

    // Find preceding label for this input
    const label = findLabelForInput(html, m.index, name);

    fields.push({
      type: type === 'email' ? 'email' : 'text',
      label: label || name || placeholder || 'Field',
      placeholder: placeholder || label || '',
      required,
    });
  }

  // Detect <textarea>
  const textareaRe = /<textarea[^>]*name=["']([^"']+)["'][^>]*>([\s\S]*?)<\/textarea>/gi;
  let tm: RegExpExecArray | null;
  while ((tm = textareaRe.exec(html)) !== null) {
    fields.push({
      type: 'textarea',
      label: tm[1] || 'Message',
      placeholder: 'Your message',
      required: false,
    });
  }

  return fields;
}

function extractSubmitFromBlock(html: string): string | null {
  const buttonRe = /<button[^>]*type=["']submit["'][^>]*>([\s\S]*?)<\/button>/gi;
  const m = buttonRe.exec(html);
  if (m) return m[1].trim();

  const inputRe = /<input[^>]*type=["']submit["'][^>]*value=["']([^"']+)["'][^>]*\/?>/gi;
  const im = inputRe.exec(html);
  if (im) return im[1];

  return null;
}

function findLabelForInput(html: string, inputIndex: number, inputName: string): string | null {
  const before = html.slice(Math.max(0, inputIndex - 500), inputIndex);
  const labelMatch = before.match(/<label[^>]*>([\s\S]*?)<\/label>\s*$/i);
  if (labelMatch) return labelMatch[1].trim();

  const forMatch = before.match(/<label[^>]*for=["']([^"']+)["'][^>]*>/i);
  if (forMatch && forMatch[1] === inputName) {
    const afterLabel = html.slice(before.lastIndexOf(forMatch[0]));
    const content = afterLabel.match(/<label[^>]*>([\s\S]*?)<\/label>/i);
    if (content) return content[1].trim();
  }

  return null;
}

function detectStandaloneInputs(html: string): FormField[] {
  const fields: FormField[] = [];
  const inputRe = /<input\s+([^>]*?)\/?>/gi;
  let m: RegExpExecArray | null;
  let idx = 0;
  while ((m = inputRe.exec(html)) !== null) {
    const attrs = m[1];
    const type = (attrs.match(/type=["']([^"']+)["']/i) || [])[1] || 'text';
    if (type === 'hidden' || type === 'submit') continue;
    const placeholder = (attrs.match(/placeholder=["']([^"']+)["']/i) || [])[1] || '';
    const name = (attrs.match(/name=["']([^"']+)["']/i) || [])[1] || '';
    fields.push({
      type: type === 'email' ? 'email' : 'text',
      label: name || placeholder || `Field ${++idx}`,
      placeholder: placeholder || '',
      required: /required/i.test(attrs),
    });
  }
  return fields;
}

function detectSubmitText(html: string): string | null {
  const btnMatch = html.match(/<button[^>]*>(Submit|Send|Absenden|Senden|Sign Up|Subscribe)<\/button>/i);
  if (btnMatch) return btnMatch[1];

  const inputMatch = html.match(/<input[^>]*value=["'](Submit|Send|Absenden|Senden|Sign Up|Subscribe)["'][^>]*\/?>/i);
  if (inputMatch) return inputMatch[1];

  return null;
}

// ─── V4 ATOMIC FORM BUILDER ─────────────────────────────────────────────────

function buildAtomicFormTree(formDef: FormDef): V4FormTree {
  const containerId = `${formDef.name.replace(/[^a-zA-Z0-9]/g, '-').toLowerCase()}-form`;

  const elements: V4AtomicElement[] = [];

  for (const field of formDef.fields) {
    const fieldSlug = field.label.replace(/[^a-zA-Z0-9]/g, '-').toLowerCase();

    // Label
    elements.push({
      type: 'e-field-label',
      elType: 'widget',
      widgetType: 'e-field-label',
      id: `${containerId}-label-${fieldSlug}`,
      settings: {
        'field-label': { '$$type': 'string', value: field.label },
        classes: { '$$type': 'classes', value: [] },
      },
      styles: {},
    });

    // Input
    elements.push({
      type: 'e-field-input',
      elType: 'widget',
      widgetType: 'e-field-input',
      id: `${containerId}-input-${fieldSlug}`,
      settings: {
        'field-placeholder': { '$$type': 'string', value: field.placeholder },
        'field-required': { '$$type': 'boolean', value: field.required },
        classes: { '$$type': 'classes', value: [] },
      },
      styles: {},
    });
  }

  // Submit button
  elements.push({
    type: 'e-field-submit',
    elType: 'widget',
    widgetType: 'e-field-submit',
    id: `${containerId}-submit`,
    settings: {
      'submit-text': { '$$type': 'string', value: formDef.submit_text || 'Submit' },
      classes: { '$$type': 'classes', value: [] },
    },
    styles: {},
  });

  return {
    widgetType: 'e-flexbox',
    id: containerId,
    settings: {
      tag: 'form',
      classes: { '$$type': 'classes', value: [] },
    },
    styles: {},
    elements,
  };
}

// ─── MAIN ───────────────────────────────────────────────────────────────────

let htmlContent = '';

if (htmlPath && fs.existsSync(htmlPath)) {
  htmlContent = fs.readFileSync(htmlPath, 'utf8');
} else if (xmlPath && fs.existsSync(xmlPath)) {
  htmlContent = fs.readFileSync(xmlPath, 'utf8');
}

if (!htmlContent) {
  process.stderr.write('Error: No HTML/XML content loaded\n');
  process.exit(2);
}

const forms = detectFormElements(htmlContent);
const formTrees = forms.map(buildAtomicFormTree);

const result: FormOutput = {
  meta: {
    generatedAt: new Date().toISOString(),
    source: htmlPath || xmlPath || '',
    totalForms: forms.length,
  },
  forms: forms.map((f, i) => ({
    ...f,
    v4_tree: formTrees[i],
  })),
  // B4: create-atomic-form MCP Ability Interface
  mcpRouting: {
    ability: 'novamira-adrianv2/create-atomic-form',
    note: 'B4: Diese Ability muss im novamira-adrianv2 Plugin implementiert werden. Sie ist die EINZIGE neue Ability im gesamten Sprint-Plan.',
    example_call: {
      ability_name: 'novamira-adrianv2/create-atomic-form',
      parameters: {
        post_id: '{{post_id}}',
        form: {
          action: { type: 'email', to: 'hello@example.com', subject: 'New Contact' },
          fields: [
            { type: 'text', label: 'Full Name', placeholder: 'Your name', required: true },
            { type: 'email', label: 'Email Address', placeholder: 'you@example.com', required: true },
          ],
          submit_text: 'Send Message',
        },
      },
    },
  },
};

if (outputPath) {
  fs.mkdirSync(path.dirname(path.resolve(outputPath)), { recursive: true });
  fs.writeFileSync(outputPath, JSON.stringify(result, null, 2), 'utf8');
  process.stderr.write(`[form-extract] ${forms.length} forms → ${outputPath}\n`);
} else {
  process.stdout.write(JSON.stringify(result, null, 2) + '\n');
}

process.exit(0);

/**
 * Framer Form Extraction (Phase 51).
 * Extracts form structures from Framer HTML and maps them
 * to V4 Form widget configurations.
 * Ported from Framer-to-Elementor-V4-Pipeline/scripts/extract-framer-forms.ts
 */

// ============================================================================
// Types
// ============================================================================

export type FormFieldType =
  | 'text'
  | 'email'
  | 'tel'
  | 'number'
  | 'textarea'
  | 'select'
  | 'checkbox'
  | 'radio'
  | 'date'
  | 'file'
  | 'hidden'
  | 'submit';

export interface FormFieldOption {
  label: string;
  value: string;
  selected?: boolean;
}

export interface FormField {
  type: FormFieldType;
  name: string;
  label: string;
  placeholder?: string;
  required: boolean;
  options?: FormFieldOption[];
  validation?: {
    pattern?: string;
    minLength?: number;
    maxLength?: number;
    min?: number;
    max?: number;
  };
  width?: 'full' | 'half' | 'third';
}

export interface ExtractedForm {
  id: string;
  action?: string;
  method: 'get' | 'post';
  fields: FormField[];
  submitText: string;
  source: 'html-form' | 'framer-component';
}

export interface FormsOutput {
  meta: {
    generatedAt: string;
    source: string;
    totalForms: number;
  };
  forms: ExtractedForm[];
}

// ============================================================================
// HTML Form Extraction
// ============================================================================

/**
 * Extract forms from HTML string.
 */
export function extractFormsFromHtml(html: string): ExtractedForm[] {
  const forms: ExtractedForm[] = [];
  const formRe = /<form[^>]*>([\s\S]*?)<\/form>/gi;
  let formMatch: RegExpExecArray | null;
  let formIdx = 0;

  while ((formMatch = formRe.exec(html)) !== null) {
    const formTag = formMatch[0];
    const formContent = formMatch[1];

    const actionMatch = formTag.match(/action=["']([^"']*)["']/);
    const methodMatch = formTag.match(/method=["']([^"']*)["']/);
    const idMatch = formTag.match(/id=["']([^"']*)["']/);

    const fields = extractFieldsFromFormContent(formContent);
    const submitText = extractSubmitText(formContent);

    forms.push({
      id: idMatch?.[1] || `form-${++formIdx}`,
      action: actionMatch?.[1],
      method: (methodMatch?.[1]?.toLowerCase() as 'get' | 'post') || 'post',
      fields,
      submitText,
      source: 'html-form',
    });
  }

  return forms;
}

function extractFieldsFromFormContent(content: string): FormField[] {
  const fields: FormField[] = [];

  // Extract input fields
  const inputRe = /<input[^>]*>/gi;
  let inputMatch: RegExpExecArray | null;

  while ((inputMatch = inputRe.exec(content)) !== null) {
    const tag = inputMatch[0];
    const type = extractAttr(tag, 'type') || 'text';
    const name = extractAttr(tag, 'name') || '';
    const placeholder = extractAttr(tag, 'placeholder');
    const required = tag.includes('required');

    if (type === 'submit' || type === 'button') continue;

    fields.push({
      type: mapInputType(type),
      name,
      label: name.replace(/[-_]/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()),
      placeholder,
      required,
      validation: extractValidation(tag),
    });
  }

  // Extract textareas
  const textareaRe = /<textarea[^>]*>/gi;
  let textareaMatch: RegExpExecArray | null;

  while ((textareaMatch = textareaRe.exec(content)) !== null) {
    const tag = textareaMatch[0];
    const name = extractAttr(tag, 'name') || '';
    const placeholder = extractAttr(tag, 'placeholder');
    const required = tag.includes('required');

    fields.push({
      type: 'textarea',
      name,
      label: name.replace(/[-_]/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()),
      placeholder,
      required,
    });
  }

  // Extract selects
  const selectRe = /<select[^>]*>([\s\S]*?)<\/select>/gi;
  let selectMatch: RegExpExecArray | null;

  while ((selectMatch = selectRe.exec(content)) !== null) {
    const tag = selectMatch[0];
    const optionsHtml = selectMatch[1];
    const name = extractAttr(tag, 'name') || '';
    const required = tag.includes('required');

    const options = extractSelectOptions(optionsHtml);

    fields.push({
      type: 'select',
      name,
      label: name.replace(/[-_]/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()),
      required,
      options,
    });
  }

  return fields;
}

function extractSelectOptions(html: string): FormFieldOption[] {
  const options: FormFieldOption[] = [];
  const optionRe = /<option[^>]*>([\s\S]*?)<\/option>/gi;
  let match: RegExpExecArray | null;

  while ((match = optionRe.exec(html)) !== null) {
    const tag = match[0];
    const label = match[1].trim();
    const value = extractAttr(tag, 'value') || label;
    const selected = tag.includes('selected');

    options.push({ label, value, selected: selected || undefined });
  }

  return options;
}

function extractSubmitText(content: string): string {
  // Check for submit input
  const submitInputRe = /<input[^>]*type=["']submit["'][^>]*>/i;
  const submitMatch = content.match(submitInputRe);
  if (submitMatch) {
    const value = extractAttr(submitMatch[0], 'value');
    if (value) return value;
  }

  // Check for submit button
  const buttonRe = /<button[^>]*type=["']submit["'][^>]*>([\s\S]*?)<\/button>/i;
  const buttonMatch = content.match(buttonRe);
  if (buttonMatch) {
    return buttonMatch[1].replace(/<[^>]+>/g, '').trim() || 'Submit';
  }

  return 'Submit';
}

// ============================================================================
// Framer Component Form Detection
// ============================================================================

/**
 * Detect Framer form components from data-framer-name attributes.
 */
export function detectFramerFormComponents(html: string): ExtractedForm[] {
  const forms: ExtractedForm[] = [];
  const formComponentRe = /data-framer-name=["']([^"']*(?:form|contact|signup|newsletter)[^"']*)["']/gi;
  let match: RegExpExecArray | null;
  let idx = 0;

  while ((match = formComponentRe.exec(html)) !== null) {
    const name = match[1];
    forms.push({
      id: `framer-form-${++idx}`,
      method: 'post',
      fields: [],
      submitText: 'Submit',
      source: 'framer-component',
    });
  }

  return forms;
}

// ============================================================================
// Helpers
// ============================================================================

function extractAttr(tag: string, attr: string): string | undefined {
  const re = new RegExp(`${attr}=["']([^"']*)["']`, 'i');
  const match = tag.match(re);
  return match?.[1];
}

function mapInputType(htmlType: string): FormFieldType {
  const typeMap: Record<string, FormFieldType> = {
    text: 'text',
    email: 'email',
    tel: 'tel',
    phone: 'tel',
    number: 'number',
    checkbox: 'checkbox',
    radio: 'radio',
    date: 'date',
    file: 'file',
    hidden: 'hidden',
    password: 'text',
    url: 'text',
    search: 'text',
  };
  return typeMap[htmlType.toLowerCase()] || 'text';
}

function extractValidation(tag: string): FormField['validation'] {
  const validation: NonNullable<FormField['validation']> = {};
  let hasValidation = false;

  const pattern = extractAttr(tag, 'pattern');
  if (pattern) { validation.pattern = pattern; hasValidation = true; }

  const minLength = extractAttr(tag, 'minlength');
  if (minLength) { validation.minLength = parseInt(minLength, 10); hasValidation = true; }

  const maxLength = extractAttr(tag, 'maxlength');
  if (maxLength) { validation.maxLength = parseInt(maxLength, 10); hasValidation = true; }

  const min = extractAttr(tag, 'min');
  if (min) { validation.min = parseFloat(min); hasValidation = true; }

  const max = extractAttr(tag, 'max');
  if (max) { validation.max = parseFloat(max); hasValidation = true; }

  return hasValidation ? validation : undefined;
}

/**
 * Build the full forms output.
 */
export function buildFormsOutput(forms: ExtractedForm[], source: string): FormsOutput {
  return {
    meta: {
      generatedAt: new Date().toISOString(),
      source,
      totalForms: forms.length,
    },
    forms,
  };
}

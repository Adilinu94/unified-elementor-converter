/**
 * Pro-Detector — V2 Phase 5
 * Detects whether Elementor Pro is available on the target WordPress install.
 * Combines three independent signals for higher confidence.
 *
 * Portiert aus site-clone-to-v3/src/classifier/pro-detector.ts (Phase 45).
 */

export type ProSignal =
  | 'script-marker'
  | 'css-class'
  | 'admin-bar'
  | 'generator-meta'
  | 'rest-endpoint'
  | 'custom-element';

export interface ProSignalRecord {
  signal: ProSignal;
  detected: boolean;
  evidence: string;
}

export interface ProDetectionInput {
  scriptSrcs?: readonly string[];
  scriptBodies?: readonly string[];
  classNames?: readonly string[];
  windowGlobals?: Readonly<Record<string, unknown>>;
  generatorMeta?: readonly string[];
  restEndpoints?: Readonly<Record<string, boolean>>;
  customElements?: readonly string[];
}

export interface ProDetectionResult {
  hasPro: boolean;
  confidence: number;
  signals: ProSignalRecord[];
}

const SIGNAL_WEIGHTS: Readonly<Record<ProSignal, number>> = {
  'script-marker': 0.45,
  'css-class': 0.2,
  'admin-bar': 0.2,
  'generator-meta': 0.35,
  'rest-endpoint': 0.4,
  'custom-element': 0.15,
};

export function isProScriptSrc(src: string): boolean {
  if (!src) return false;
  return /elementor-pro(\/|\.min)?\.js/i.test(src) || /elementor-pro\/assets\//i.test(src);
}

export function isProScriptBody(body: string): boolean {
  if (!body) return false;
  return /elementorProVersion/i.test(body) || /"pro":\s*true/i.test(body) || /elementor_pro_version/i.test(body);
}

export function isProClassName(className: string): boolean {
  if (!className) return false;
  return /(^|\s)(elementor-widget-pro-|elementor-pro-)/i.test(className);
}

export function isProWindowGlobal(globalName: string, value: unknown): boolean {
  if (/^elementorPro/i.test(globalName)) return true;
  if (globalName === 'ElementorProConfig' && value) return true;
  if (globalName === 'elementor_pro_version' && typeof value === 'string' && value.length > 0) return true;
  return false;
}

export function isProGeneratorMeta(meta: string): boolean {
  if (!meta) return false;
  return /elementor\s+pro/i.test(meta);
}

export function isProRestEndpoint(path: string): boolean {
  if (!path) return false;
  return /\/elementor-pro\/v1\//i.test(path);
}

export function isProCustomElement(tag: string): boolean {
  if (!tag) return false;
  return /^elementor-pro-/i.test(tag);
}

export function detectElementorPro(input: ProDetectionInput): ProDetectionResult {
  const signals: ProSignalRecord[] = [];

  for (const src of input.scriptSrcs ?? []) {
    if (isProScriptSrc(src)) signals.push({ signal: 'script-marker', detected: true, evidence: src });
  }
  for (const body of input.scriptBodies ?? []) {
    if (isProScriptBody(body)) signals.push({ signal: 'admin-bar', detected: true, evidence: trimEvidence(body) });
  }
  for (const cls of input.classNames ?? []) {
    if (isProClassName(cls)) signals.push({ signal: 'css-class', detected: true, evidence: cls });
  }
  for (const [name, value] of Object.entries(input.windowGlobals ?? {})) {
    if (isProWindowGlobal(name, value)) signals.push({ signal: 'admin-bar', detected: true, evidence: name });
  }
  for (const meta of input.generatorMeta ?? []) {
    if (isProGeneratorMeta(meta)) signals.push({ signal: 'generator-meta', detected: true, evidence: meta });
  }
  for (const [path, ok] of Object.entries(input.restEndpoints ?? {})) {
    if (ok && isProRestEndpoint(path)) signals.push({ signal: 'rest-endpoint', detected: true, evidence: path });
    else if (!ok && isProRestEndpoint(path)) signals.push({ signal: 'rest-endpoint', detected: false, evidence: path });
  }
  for (const tag of input.customElements ?? []) {
    if (isProCustomElement(tag)) signals.push({ signal: 'custom-element', detected: true, evidence: tag });
  }

  const positiveSignals = signals.filter((s) => s.detected);
  const negativeSignals = signals.filter((s) => !s.detected);

  if (positiveSignals.length === 0 && negativeSignals.length > 0) {
    return { hasPro: false, confidence: 0.7, signals };
  }

  const totalWeight = positiveSignals.reduce((acc, s) => acc + (SIGNAL_WEIGHTS[s.signal] ?? 0.1), 0);
  const confidence = Math.min(1, totalWeight);
  return { hasPro: positiveSignals.length > 0, confidence, signals };
}

function trimEvidence(body: string): string {
  const trimmed = body.replace(/\s+/g, ' ').trim();
  return trimmed.length > 80 ? `${trimmed.slice(0, 77)}...` : trimmed;
}

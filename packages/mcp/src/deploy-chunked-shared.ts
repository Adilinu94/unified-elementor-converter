import { unwrapMcpPayload } from './readback.js';

export const READ_BACK_ABILITY = 'novamira/elementor-get-content';
export const CLEAR_CACHE_ABILITY = 'novamira/elementor-clear-document-cache';
export const DEPLOY_RETRY = 2;

export function isMcpSuccess(raw: unknown): boolean {
  const payload = unwrapMcpPayload<{ success?: boolean }>(raw, 'success');
  return payload?.success === true;
}

export function warningText(raw: unknown): string {
  const payload = unwrapMcpPayload<{ warnings?: string[]; error?: string; message?: string }>(raw, 'warnings');
  const w = Array.isArray(payload?.warnings) ? payload.warnings.join('; ') : '';
  return w || (payload as { error?: string })?.error || (payload as { message?: string })?.message || '';
}

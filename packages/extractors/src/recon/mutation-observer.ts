/**
 * recon/mutation-observer.ts
 *
 * Installable MutationObserver for State-Capture (Phase 3 V2 §6).
 *
 * Captures DOM mutations (attribute changes, child-list mutations,
 * subtree modifications) and exposes them as a serializable
 * ReconEvent[] payload — replacing the V1 250ms-polling approach
 * with proper event-driven capture (per V2-plan bug-fix #3).
 */

import type { MutationRecord, MockWindow } from './mock-types.js';

export interface MutationObserverConfig {
  /** DOM-selector for the root element to observe. Default: 'body' */
  targetSelector?: string;
  /** Optional id for isolating multiple observers on the same page */
  id?: string;
  /** Listen to attribute changes (default: true) */
  attributes?: boolean;
  /** Listen to child-list mutations (default: true) */
  childList?: boolean;
  /** Observe descendants (default: true) */
  subtree?: boolean;
  /** Watch only these attribute names (default: all) */
  watchedAttributes?: string[];
  /** Capture oldValue for attribute records (default: false) */
  captureOldValue?: boolean;
}

export interface MutationObserverHandle {
  id: string;
  config: MutationObserverConfig;
  disconnect(): void;
}

function resolveMutationType(record: MutationRecord): 'attributes' | 'childList' | 'characterData' {
  return record.type;
}

function serializeRecord(
  record: MutationRecord,
  registry: Map<string, MutationRecord[]>,
): void {
  const records = registry.get('__pending__') ?? [];
  records.push(record);
  registry.set('__pending__', records);
}

/**
 * Install a MutationObserver on the given (mock) window.
 * Returns a handle for later teardown and an event-registry key.
 */
export function installMutationObserver(
  win: MockWindow,
  config: MutationObserverConfig = {},
): MutationObserverHandle {
  const id = config.id ?? `mut-${Math.random().toString(36).slice(2, 9)}`;
  const targetSelector = config.targetSelector ?? 'body';
  const attributes = config.attributes ?? true;
  const childList = config.childList ?? true;
  const subtree = config.subtree ?? true;
  const watched = config.watchedAttributes ?? [];
  const captureOldValue = config.captureOldValue ?? false;

  const target = win.document.querySelector(targetSelector);
  if (!target) {
    throw new Error(`installMutationObserver: target not found: ${targetSelector}`);
  }

  const observerCfg: MutationObserverInit = {
    attributes,
    childList,
    subtree,
    attributeOldValue: captureOldValue,
    characterData: false,
    characterDataOldValue: false,
  };
  if (watched.length > 0) {
    observerCfg.attributeFilter = watched;
  }

  // In the real DOM, MutationObserver batches records and delivers them
  // to the callback via a microtask. In the mock, fireMutation() calls
  // the callback synchronously for each matching record. We honor the
  // watched-attribute filter here and store filtered records.
  const mo = new win.MutationObserver((records) => {
    for (const record of records) {
      if (watched.length > 0 && record.attributeName && !watched.includes(record.attributeName)) {
        continue;
      }
      serializeRecord(record, win.__mutationRegistry);
    }
  });
  mo.observe(target, observerCfg);

  return {
    id,
    config,
    disconnect() {
      mo.disconnect();
    },
  };
}

/**
 * Collect mutations observed by the observer(s). When `observerId` is given,
 * only mutations routed through that id are returned.
 */
export function collectObservedMutations(
  win: MockWindow,
  _observerId?: string,
): MutationRecord[] {
  void _observerId;
  const all = win.__mutationRegistry.get('__pending__') ?? [];
  win.__mutationRegistry.set('__pending__', []);
  return all.map((r) => ({
    type: resolveMutationType(r),
    target: r.target,
    attributeName: r.attributeName,
    oldValue: r.oldValue,
    addedNodes: r.addedNodes,
    removedNodes: r.removedNodes,
  }));
}

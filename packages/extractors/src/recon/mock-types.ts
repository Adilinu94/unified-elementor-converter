/**
 * Mock DOM types for recon tests (lives under src/recon/ to satisfy
 * rootDir; the actual mock-window fixture extends these in tests/helpers/).
 *
 * Kept here because production code (mutation-observer.ts, animation-events.ts,
 * state-capture.ts) needs to type-check against MockWindow when running tests.
 */

export interface MockElement {
  tagName: string;
  id: string;
  className: string;
  children: MockElement[];
  attributes: Record<string, string>;
  _computedStyles: Record<string, string>;
  _getAnimationsResult?: Array<{ animationName: string; playState: string; currentTime: number }>;
  parentNode?: MockElement;
  querySelector(sel: string): MockElement | null;
  appendChild(child: MockElement): MockElement;
  setAttribute(name: string, value: string): void;
  getAttribute(name: string): string | null;
  dispatchEvent(event: { type: string; [key: string]: unknown }): void;
  addEventListener(type: string, listener: (event: MockEvent) => void): void;
  getComputedStyle(): Record<string, string>;
  getAnimations(): Array<{ animationName: string; playState: string; currentTime: number }>;
  fireMutation(record: Omit<MutationRecord, 'target'>): void;
}

export interface MockEvent {
  type: string;
  target: MockElement;
  [key: string]: unknown;
}

export interface MutationRecord {
  type: 'attributes' | 'childList' | 'characterData';
  target: MockElement;
  attributeName?: string;
  oldValue?: string;
  addedNodes?: MockElement[];
  removedNodes?: MockElement[];
}

export interface MockWindow {
  document: {
    body: MockElement;
    querySelector(sel: string): MockElement | null;
    createElement(tag: string): MockElement;
  };
  MutationObserver: new (
    callback: (records: MutationRecord[]) => void,
  ) => { observe(target: MockElement, config: MutationObserverInit): void; disconnect(): void };
  performance: { now(): number };
  __mutationRegistry: Map<string, MutationRecord[]>;
  __animationRegistry: Map<string, Array<Record<string, unknown>>>;
}

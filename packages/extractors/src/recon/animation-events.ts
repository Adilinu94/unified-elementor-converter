/**
 * recon/animation-events.ts
 *
 * Listener for Web-Animation-API + CSS-animation + CSS-transition events.
 *
 * Replaces the V1 250ms-polling approach (V2-plan bug-fix #3):
 * uses native browser events (animationstart / animationend / transitionrun /
 * transitionend) so we never miss fast (<100ms) animations.
 */

import type { MockElement, MockEvent, MockWindow } from './mock-types.js';

export type AnimationEventType =
  | 'animationstart'
  | 'animationend'
  | 'animationiteration'
  | 'transitionrun'
  | 'transitionend'
  | 'transitioncancel';

export interface AnimationListenerConfig {
  /** DOM-selector for the root to observe (default: 'body') */
  targetSelector?: string;
  /** Maximum events to retain (FIFO-trim, default: 500) */
  maxEvents?: number;
  /** Capture Web-Animation-API getAnimations() probes (default: true) */
  captureWaapi?: boolean;
}

export interface CapturedAnimationEvent {
  type: AnimationEventType;
  selector: string;
  animationName: string;
  propertyName?: string;
  elapsedTime: number;
  timestamp: number;
}

const TRACKED_EVENTS: AnimationEventType[] = [
  'animationstart',
  'animationend',
  'animationiteration',
  'transitionrun',
  'transitionend',
  'transitioncancel',
];

function buildSelector(el: MockElement): string {
  if (el.id) return `#${el.id}`;
  if (el.className) {
    const cls = el.className.split(/\s+/)[0];
    if (cls) return `.${cls}`;
  }
  return el.tagName.toLowerCase();
}

/**
 * Install animation-event listeners on the matching element(s).
 * Returns a handle for later teardown.
 */
export function installAnimationListener(
  win: MockWindow,
  config: AnimationListenerConfig = {},
): { remove: () => void } {
  const targetSelector = config.targetSelector ?? 'body';
  const maxEvents = config.maxEvents ?? 500;
  const captureWaapi = config.captureWaapi ?? true;

  const target = win.document.querySelector(targetSelector);
  if (!target) {
    throw new Error(`installAnimationListener: target not found: ${targetSelector}`);
  }

  const listeners: Array<() => void> = [];

  const push = (ev: CapturedAnimationEvent) => {
    const arr = win.__animationRegistry.get('__pending__') ?? [];
    arr.push(ev as unknown as Record<string, unknown>);
    if (arr.length > maxEvents) {
      arr.splice(0, arr.length - maxEvents);
    }
    win.__animationRegistry.set('__pending__', arr);
  };

  for (const eventType of TRACKED_EVENTS) {
    const listener = (event: MockEvent) => {
      const el = event.target as MockElement;
      if (eventType.startsWith('animation')) {
        push({
          type: eventType,
          selector: buildSelector(el),
          animationName: String((event as { animationName?: unknown }).animationName ?? ''),
          elapsedTime: Number((event as { elapsedTime?: unknown }).elapsedTime ?? 0),
          timestamp: win.performance.now(),
        });
      } else {
        push({
          type: eventType,
          selector: buildSelector(el),
          animationName: '',
          propertyName: String((event as { propertyName?: unknown }).propertyName ?? ''),
          elapsedTime: Number((event as { elapsedTime?: unknown }).elapsedTime ?? 0),
          timestamp: win.performance.now(),
        });
      }
    };
    target.addEventListener(eventType, listener);
    listeners.push(() => target.dispatchEvent({ type: '__remove__', _listener: listener } as unknown as MockEvent));
  }

  if (captureWaapi && typeof target.getAnimations === 'function') {
    const anims = target.getAnimations();
    for (const anim of anims) {
      push({
        type: 'animationstart',
        selector: buildSelector(target),
        animationName: anim.animationName,
        elapsedTime: anim.currentTime / 1000,
        timestamp: win.performance.now(),
      });
    }
  }

  return {
    remove: () => {
      for (const l of listeners) l();
    },
  };
}

/**
 * Collect animation events captured since last call (clears the buffer).
 */
export function collectAnimationEvents(win: MockWindow): CapturedAnimationEvent[] {
  const all = win.__animationRegistry.get('__pending__') ?? [];
  win.__animationRegistry.set('__pending__', []);
  return all.map((r) => ({
    type: r['type'] as AnimationEventType,
    selector: String(r['selector'] ?? ''),
    animationName: String(r['animationName'] ?? ''),
    propertyName: r['propertyName'] != null ? String(r['propertyName']) : undefined,
    elapsedTime: Number(r['elapsedTime'] ?? 0),
    timestamp: Number(r['timestamp'] ?? 0),
  }));
}

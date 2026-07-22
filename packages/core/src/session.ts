/**
 * Session Manager — Session lifecycle with resume capability.
 * Each conversion run gets a unique session ID for tracking and resumption.
 */

import { randomUUID } from 'node:crypto';

export interface Session {
  id: string;
  createdAt: string;
  updatedAt: string;
  target: 'v3' | 'v4';
  sourceType: 'url' | 'framer-xml' | 'html-export';
  sourceRef: string;
  status: 'active' | 'completed' | 'failed' | 'aborted';
  currentPhase: string;
  phasesCompleted: string[];
  metadata: Record<string, unknown>;
}

export function createSession(
  target: 'v3' | 'v4',
  sourceType: Session['sourceType'],
  sourceRef: string,
): Session {
  const now = new Date().toISOString();
  return {
    id: randomUUID(),
    createdAt: now,
    updatedAt: now,
    target,
    sourceType,
    sourceRef,
    status: 'active',
    currentPhase: 'init',
    phasesCompleted: [],
    metadata: {},
  };
}

export function advancePhase(session: Session, phase: string): Session {
  return {
    ...session,
    currentPhase: phase,
    updatedAt: new Date().toISOString(),
  };
}

export function completePhase(session: Session, phase: string): Session {
  return {
    ...session,
    phasesCompleted: [...session.phasesCompleted, phase],
    updatedAt: new Date().toISOString(),
  };
}

export function finishSession(session: Session, status: 'completed' | 'failed' | 'aborted'): Session {
  return {
    ...session,
    status,
    updatedAt: new Date().toISOString(),
  };
}

export function setMetadata(session: Session, key: string, value: unknown): Session {
  return {
    ...session,
    metadata: { ...session.metadata, [key]: value },
    updatedAt: new Date().toISOString(),
  };
}

export function isResumable(session: Session): boolean {
  return session.status === 'active' && session.phasesCompleted.length > 0;
}

export function getSessionDuration(session: Session): number {
  return new Date(session.updatedAt).getTime() - new Date(session.createdAt).getTime();
}

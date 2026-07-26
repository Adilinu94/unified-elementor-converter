/**
 * Component Detection — Schicht 1: DOM-Struktur-Clustering.
 *
 * Findet wiederholte Sub-Trees innerhalb einer Section und leitet daraus
 * einen Komponenten-Typ ab. Arbeitet rein auf ComputedStyleSnapshot.
 *
 * Portiert aus site-clone-to-v3/src/classifier/detect-by-structure.ts (Phase 45).
 */
import type { ComputedStyleSnapshot, SectionInfo } from '@elconv/core';

/** Result of the structure-clustering layer (Schicht 1). */
export interface StructureDetectionResult {
  type: string;
  confidence: number;
  evidence: string;
  instances: number;
}

interface TreeNode {
  tag: string;
  children: TreeNode[];
}

function computeSignature(node: TreeNode): string {
  if (node.children.length === 0) return node.tag;
  const childSigs = node.children.map(computeSignature).join(',');
  return `${node.tag}(${childSigs})`;
}

function directChildren(parentSel: string, snapshots: ComputedStyleSnapshot[]): ComputedStyleSnapshot[] {
  const prefix = `${parentSel} > `;
  return snapshots.filter((s) => s.selector.startsWith(prefix) && !s.selector.slice(prefix.length).includes(' > '));
}

function buildTree(snap: ComputedStyleSnapshot, allSnapshots: ComputedStyleSnapshot[]): TreeNode {
  const children = directChildren(snap.selector, allSnapshots);
  return {
    tag: snap.tag,
    children: children.map((c) => buildTree(c, allSnapshots)),
  };
}

function classifyByStructure(signature: string, count: number): string {
  if (/div\(img,h[1-6],p\)/.test(signature) && count >= 3) return 'card-grid';
  if (/div\(h[1-6],p\)/.test(signature) && count >= 3) return 'feature-list';
  if (/div\((span|h[1-6])\)/.test(signature) && count >= 3) return 'stat-row';
  if (/^img(,img)*$/.test(signature) && count >= 4) return 'logo-grid';
  return 'repeated-structure';
}

/**
 * Find the largest repeated child-structure within a section.
 */
export function detectRepeatedStructures(
  section: SectionInfo,
  snapshots: ComputedStyleSnapshot[],
): StructureDetectionResult | null {
  const children = directChildren(section.selector, snapshots);
  if (children.length < 2) return null;

  const signatures = children.map((c) => computeSignature(buildTree(c, snapshots)));

  const groups = new Map<string, number>();
  for (const sig of signatures) {
    groups.set(sig, (groups.get(sig) ?? 0) + 1);
  }

  let bestSig: string | null = null;
  let bestCount = 0;
  for (const [sig, count] of groups) {
    if (count > bestCount && count >= 2) {
      bestSig = sig;
      bestCount = count;
    }
  }
  if (!bestSig || bestCount < 2) return null;

  const type = classifyByStructure(bestSig, bestCount);
  const confidence = Math.min(0.9, 0.4 + bestCount * 0.1);
  return {
    type,
    confidence,
    evidence: `${bestCount}× wiederholte Struktur: ${bestSig.slice(0, 50)}`,
    instances: bestCount,
  };
}

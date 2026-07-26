/**
 * Dependency Graph with Kahn's Algorithm (Phase 48).
 * Computes build order for components with dependencies.
 * Ported from Framer-to-Elementor-V4-Pipeline/scripts/build-dependency-graph.ts
 */

// ============================================================================
// Types
// ============================================================================

export type GraphEdgeMap = Record<string, string[]>;

export interface BuildOrderResult {
  order: string[];
  cycles: string[];
  processed: number;
  total: number;
}

export interface BuildStep {
  step: number;
  component: string;
  dependencies: string[];
  isLeaf: boolean;
}

export interface BuildOrderOutput {
  meta: {
    generated: string;
    totalComponents: number;
    buildSteps: number;
    hasCycles: boolean;
  };
  buildOrder: BuildStep[];
  cycles: string[];
  graph: GraphEdgeMap;
}

export interface ParallelGroup {
  level: number;
  components: string[];
}

// ============================================================================
// Kahn's Algorithm
// ============================================================================

/**
 * Compute build order using Kahn's algorithm (topological sort).
 * Returns the order, any cycles detected, and processing stats.
 */
export function getBuildOrder(graph: GraphEdgeMap): BuildOrderResult {
  // Collect all nodes (including dependencies not in keys)
  const allNodes = new Set(Object.keys(graph));
  for (const deps of Object.values(graph)) {
    for (const dep of deps) {
      if (!allNodes.has(dep)) {
        allNodes.add(dep);
        graph[dep] = graph[dep] ?? [];
      }
    }
  }

  const nodes = [...allNodes];

  // Calculate in-degree (number of dependencies) for each node
  const inDegree: Record<string, number> = {};
  for (const node of nodes) inDegree[node] = 0;
  for (const [node, deps] of Object.entries(graph)) {
    inDegree[node] = deps.length;
  }

  // Start with nodes that have no dependencies
  const queue = nodes.filter((n) => inDegree[n] === 0).sort();
  const result: string[] = [];

  while (queue.length > 0) {
    const node = queue.shift()!;
    result.push(node);

    // For each node that depends on this one, decrement in-degree
    for (const [other, deps] of Object.entries(graph)) {
      if (deps.includes(node)) {
        inDegree[other]--;
        if (inDegree[other] === 0) {
          queue.push(other);
          queue.sort();
        }
      }
    }
  }

  const processed = result.length;
  const total = nodes.length;
  const cycles = nodes.filter((n) => !result.includes(n));

  return { order: result, cycles, processed, total };
}

/**
 * Group components into parallel execution levels.
 * Components in the same level can be built concurrently.
 */
export function getParallelGroups(graph: GraphEdgeMap): ParallelGroup[] {
  const { order, cycles } = getBuildOrder(graph);
  if (cycles.length > 0) {
    throw new Error(`Cannot compute parallel groups: cycle detected involving ${cycles.join(', ')}`);
  }

  const levels: ParallelGroup[] = [];
  const nodeLevel = new Map<string, number>();

  for (const node of order) {
    const deps = graph[node] ?? [];
    const maxDepLevel = deps.reduce((max, dep) => Math.max(max, nodeLevel.get(dep) ?? 0), -1);
    const level = maxDepLevel + 1;
    nodeLevel.set(node, level);

    if (!levels[level]) {
      levels[level] = { level, components: [] };
    }
    levels[level].components.push(node);
  }

  return levels.filter(Boolean);
}

// ============================================================================
// Graph Building
// ============================================================================

/**
 * Build a dependency graph from component metadata.
 */
export function buildGraphFromComponents(
  components: Array<{ name: string; dependencies?: string[]; children?: string[]; uses?: string[] }>,
): GraphEdgeMap {
  const graph: GraphEdgeMap = {};

  for (const comp of components) {
    const deps = new Set<string>();

    // Add explicit dependencies
    for (const dep of comp.dependencies ?? []) deps.add(dep);

    // Add children as dependencies (parent depends on children)
    for (const child of comp.children ?? []) deps.add(child);

    // Add uses references
    for (const use of comp.uses ?? []) deps.add(use);

    graph[comp.name] = [...deps];
  }

  return graph;
}

/**
 * Build the full build order output with metadata.
 */
export function buildBuildOrderOutput(graph: GraphEdgeMap): BuildOrderOutput {
  const { order, cycles } = getBuildOrder(graph);

  const buildSteps: BuildStep[] = order.map((component, index) => ({
    step: index + 1,
    component,
    dependencies: graph[component] ?? [],
    isLeaf: (graph[component] ?? []).length === 0,
  }));

  return {
    meta: {
      generated: new Date().toISOString(),
      totalComponents: Object.keys(graph).length,
      buildSteps: buildSteps.length,
      hasCycles: cycles.length > 0,
    },
    buildOrder: buildSteps,
    cycles,
    graph,
  };
}

// ============================================================================
// Validation
// ============================================================================

/**
 * Validate a dependency graph for common issues.
 */
export function validateGraph(graph: GraphEdgeMap): { valid: boolean; issues: string[] } {
  const issues: string[] = [];

  // Check for self-dependencies
  for (const [node, deps] of Object.entries(graph)) {
    if (deps.includes(node)) {
      issues.push(`Self-dependency: ${node} depends on itself`);
    }
  }

  // Check for cycles
  const { cycles } = getBuildOrder(graph);
  if (cycles.length > 0) {
    issues.push(`Dependency cycle detected involving: ${cycles.join(', ')}`);
  }

  // Check for missing dependencies
  const allNodes = new Set(Object.keys(graph));
  for (const deps of Object.values(graph)) {
    for (const dep of deps) {
      if (!allNodes.has(dep)) {
        issues.push(`Missing dependency: ${dep} is referenced but not defined`);
      }
    }
  }

  return { valid: issues.length === 0, issues };
}

/**
 * Detect if a graph has any cycles.
 */
export function hasCycle(graph: GraphEdgeMap): boolean {
  const { cycles } = getBuildOrder(graph);
  return cycles.length > 0;
}

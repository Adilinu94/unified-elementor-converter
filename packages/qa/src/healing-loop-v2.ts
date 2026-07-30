/**
 * Healing Loop ↔ Design-Critic Integration (Phase 73).
 *
 * Feeds critical Design-Critic/QA findings into a healing path with:
 * - Mutation-Allowlist (CSS edits, element settings — never html as layout fix)
 * - Regression-Guard (E-Floor cannot regress)
 * - States: PASS / PLATEAU / MAX / ESCALATE
 * - Max 5 rounds, then ESCALATE with best_state + reason + open issues
 *
 * @module qa/healing-loop-v2
 */

// ============================================================================
// Types
// ============================================================================

export type HealingState = 'PASS' | 'PLATEAU' | 'MAX' | 'ESCALATE';

export interface HealingIssue {
  id: string;
  source: 'design-critic' | 'structural-probe' | 'geometry-probe' | 'qa-rule';
  severity: 'critical' | 'major' | 'minor';
  selector: string;
  description: string;
  fixHint: string;
}

export interface HealingMutation {
  type: 'css-edit' | 'setting-change' | 'wpcode-update';
  target: string;
  property: string;
  oldValue?: string;
  newValue: string;
  issueId: string;
}

export interface HealingRound {
  round: number;
  issuesBefore: number;
  issuesAfter: number;
  mutations: HealingMutation[];
  scoreBefore: number;
  scoreAfter: number;
  state: HealingState;
}

export interface HealingLoopResult {
  finalState: HealingState;
  totalRounds: number;
  bestScore: number;
  bestRound: number;
  remainingIssues: HealingIssue[];
  rounds: HealingRound[];
  escalationReason?: string;
  timestamp: string;
}

export interface HealingConfig {
  maxRounds: number;
  minScoreToPass: number;
  plateauThreshold: number; // score improvement below this = plateau
  editabilityFloor: number; // E-score cannot go below this
}

// ============================================================================
// Never-List (forbidden mutations)
// ============================================================================

export const NEVER_LIST: Array<{ pattern: string; reason: string }> = [
  { pattern: 'html_widget.*layout', reason: 'Never use HTML widget as layout fix' },
  { pattern: 'position:\\s*absolute', reason: 'Never use absolute positioning as fix' },
  { pattern: '!important', reason: 'Never add !important — indicates architecture problem' },
  { pattern: 'display:\\s*none', reason: 'Never hide elements instead of fixing them' },
  { pattern: 'visibility:\\s*hidden', reason: 'Never hide elements instead of fixing them' },
  { pattern: 'z-index:\\s*9999', reason: 'Never use extreme z-index as fix' },
];

/**
 * Check if a proposed mutation violates the never-list.
 */
export function violatesNeverList(mutation: HealingMutation): string | null {
  const combined = `${mutation.type} ${mutation.property} ${mutation.newValue}`.toLowerCase();
  for (const rule of NEVER_LIST) {
    if (new RegExp(rule.pattern, 'i').test(combined)) {
      return rule.reason;
    }
  }
  return null;
}

// ============================================================================
// Fixer Registry
// ============================================================================

export type FixerFn = (issue: HealingIssue) => HealingMutation | null;

const FIXER_REGISTRY = new Map<string, FixerFn>();

/** Register a fixer for a specific issue source/ID pattern. */
export function registerFixer(pattern: string, fixer: FixerFn): void {
  FIXER_REGISTRY.set(pattern, fixer);
}

/** Find a fixer for an issue. */
export function findFixer(issue: HealingIssue): FixerFn | null {
  for (const [pattern, fixer] of FIXER_REGISTRY) {
    if (issue.id.includes(pattern) || issue.source.includes(pattern)) {
      return fixer;
    }
  }
  return null;
}

// Register default fixers
registerFixer('spacing', (issue) => ({
  type: 'css-edit',
  target: issue.selector,
  property: 'padding',
  newValue: '80px 0',
  issueId: issue.id,
}));

registerFixer('typography', (issue) => ({
  type: 'setting-change',
  target: issue.selector,
  property: 'typography_font_size',
  newValue: '16px',
  issueId: issue.id,
}));

registerFixer('contrast', (issue) => ({
  type: 'css-edit',
  target: issue.selector,
  property: 'color',
  newValue: '#1a1a1a',
  issueId: issue.id,
}));

registerFixer('overflow', (issue) => ({
  type: 'css-edit',
  target: 'body',
  property: 'overflow-x',
  newValue: 'hidden',
  issueId: issue.id,
}));

// ============================================================================
// Healing Loop Engine
// ============================================================================

const DEFAULT_CONFIG: HealingConfig = {
  maxRounds: 5,
  minScoreToPass: 85,
  plateauThreshold: 2,
  editabilityFloor: 70,
};

/**
 * Run the structural healing loop with Design-Critic integration.
 *
 * Distinct from the visual `runHealingLoop` in healing-loop.ts: this one is
 * synchronous and works on a list of issues + score/editability functions
 * (mutation-based), rather than screenshot capture/diff/fix. Renamed from
 * `runHealingLoop` in Phase 101 to remove a barrel-export collision.
 *
 * @param issues - Initial issues from Design Critic / QA
 * @param scoreFn - Function to evaluate current score after mutations
 * @param editabilityFn - Function to check current editability score
 * @param config - Healing configuration
 */
export function runStructuralHealingLoop(
  issues: HealingIssue[],
  scoreFn: (mutations: HealingMutation[]) => number,
  editabilityFn: () => number,
  config: Partial<HealingConfig> = {},
): HealingLoopResult {
  const cfg = { ...DEFAULT_CONFIG, ...config };
  const rounds: HealingRound[] = [];
  let currentIssues = [...issues];
  let bestScore = 0;
  let bestRound = 0;
  let previousScore = 0;

  for (let round = 1; round <= cfg.maxRounds; round++) {
    // Check editability floor
    const editability = editabilityFn();
    if (editability < cfg.editabilityFloor) {
      return buildResult('ESCALATE', rounds, bestScore, bestRound, currentIssues,
        `Editability ${editability}% dropped below floor ${cfg.editabilityFloor}%`);
    }

    // Generate mutations for current issues
    const mutations: HealingMutation[] = [];
    const unfixable: HealingIssue[] = [];

    for (const issue of currentIssues) {
      const fixer = findFixer(issue);
      if (!fixer) {
        unfixable.push(issue);
        continue;
      }

      const mutation = fixer(issue);
      if (!mutation) {
        unfixable.push(issue);
        continue;
      }

      // Check never-list
      const violation = violatesNeverList(mutation);
      if (violation) {
        unfixable.push(issue);
        continue;
      }

      mutations.push(mutation);
    }

    if (mutations.length === 0) {
      return buildResult('ESCALATE', rounds, bestScore, bestRound, currentIssues,
        `No fixable mutations available. ${unfixable.length} issues have no registered fixer.`);
    }

    // Apply mutations and evaluate
    const scoreAfter = scoreFn(mutations);
    const scoreBefore = previousScore;

    // Check regression
    if (scoreAfter < scoreBefore - 5) {
      return buildResult('ESCALATE', rounds, bestScore, bestRound, currentIssues,
        `Score regressed from ${scoreBefore} to ${scoreAfter}. Rolling back.`);
    }

    // Track best
    if (scoreAfter > bestScore) {
      bestScore = scoreAfter;
      bestRound = round;
    }

    // Determine state
    let state: HealingState;
    if (scoreAfter >= cfg.minScoreToPass && currentIssues.filter((i) => i.severity === 'critical').length === 0) {
      state = 'PASS';
    } else if (Math.abs(scoreAfter - scoreBefore) < cfg.plateauThreshold) {
      state = 'PLATEAU';
    } else if (round >= cfg.maxRounds) {
      state = 'MAX';
    } else {
      state = 'PASS'; // continue
    }

    rounds.push({
      round,
      issuesBefore: currentIssues.length,
      issuesAfter: unfixable.length,
      mutations,
      scoreBefore,
      scoreAfter,
      state: state === 'PASS' && scoreAfter < cfg.minScoreToPass ? 'PLATEAU' : state,
    });

    previousScore = scoreAfter;

    // Check terminal states
    if (state === 'PASS' && scoreAfter >= cfg.minScoreToPass) {
      return buildResult('PASS', rounds, bestScore, bestRound, unfixable);
    }
    if (state === 'PLATEAU' && round > 1) {
      return buildResult('PLATEAU', rounds, bestScore, bestRound, unfixable,
        `Score plateaued at ${scoreAfter} (improvement < ${cfg.plateauThreshold})`);
    }

    // Update issues for next round
    currentIssues = unfixable;
  }

  return buildResult('MAX', rounds, bestScore, bestRound, currentIssues,
    `Reached max rounds (${cfg.maxRounds}) without passing`);
}

// ============================================================================
// Helpers
// ============================================================================

function buildResult(
  state: HealingState,
  rounds: HealingRound[],
  bestScore: number,
  bestRound: number,
  remainingIssues: HealingIssue[],
  escalationReason?: string,
): HealingLoopResult {
  return {
    finalState: state,
    totalRounds: rounds.length,
    bestScore,
    bestRound,
    remainingIssues,
    rounds,
    escalationReason,
    timestamp: new Date().toISOString(),
  };
}

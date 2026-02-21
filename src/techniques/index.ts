/**
 * Technique auto-selection and registry.
 * Selects applicable techniques based on intent, scores, complexity, and target.
 * Caps at 4 techniques (diminishing returns beyond that).
 */

import type { Complexity, Intent, Scores, Target } from '../types.js';
import { getTechnique, TECHNIQUES, type Technique, type TechniqueContext } from './anthropic.js';

/** Maximum techniques to apply — diminishing returns beyond this. */
const MAX_TECHNIQUES = 4;

/** Technique pairs that conflict (redundant together). Keep higher-impact one. */
const CONFLICTS: [string, string][] = [
  ['chain-of-thought', 'extended-thinking'],
  ['prompt-chaining', 'chain-of-thought'],
];

/** Technique pairs that work well together (minor boost to co-selection). */
const SYNERGIES: [string, string][] = [
  ['xml-tags', 'few-shot'],
  ['xml-tags', 'structured-output'],
  ['role-assignment', 'structured-output'],
];

/**
 * Select applicable techniques for a prompt.
 * If forcedIds provided, uses those instead of auto-selection.
 * Returns techniques sorted by impact (lowest relevant score first).
 */
export function selectTechniques(
  intent: Intent,
  scores: Scores,
  prompt: string,
  complexity: Complexity,
  target: Target,
  forcedIds?: string[],
): Technique[] {
  // Forced selection: look up by ID, skip unknown
  if (forcedIds && forcedIds.length > 0) {
    return forcedIds
      .map((id) => getTechnique(id))
      .filter((t): t is Technique => t !== undefined)
      .slice(0, MAX_TECHNIQUES);
  }

  const ctx: TechniqueContext = { intent, scores, prompt, complexity };

  // Auto-select: check each technique's when_to_use predicate
  const applicable = TECHNIQUES.filter((t) => {
    // Prefill only works with API target
    if (t.id === 'prefill' && target !== 'claude-api') return false;
    // Claude Code has built-in extended thinking — skip explicit CoT and extended-thinking
    if (t.id === 'chain-of-thought' && target === 'claude-code') return false;
    if (t.id === 'extended-thinking' && target === 'claude-code') return false;
    // Skip XML wrapping for simple Desktop prompts
    if (t.id === 'xml-tags' && target === 'claude-desktop' && complexity === 'simple') return false;
    return t.when_to_use(ctx);
  });

  // Sort by impact: technique that addresses the lowest-scoring dimension first
  const impactSorted = applicable.sort((a, b) => {
    const scoreA = relevantScore(a, scores);
    const scoreB = relevantScore(b, scores);
    return scoreA - scoreB; // Lower score = higher impact = first
  });

  // Resolve conflicts: when two conflicting techniques are selected, keep higher-impact one
  const resolved = resolveConflicts(impactSorted, scores);

  return resolved.slice(0, MAX_TECHNIQUES);
}

/** Remove lower-impact technique from conflicting pairs. */
function resolveConflicts(techniques: Technique[], scores: Scores): Technique[] {
  const ids = new Set(techniques.map((t) => t.id));
  const removed = new Set<string>();

  for (const [a, b] of CONFLICTS) {
    if (ids.has(a) && ids.has(b)) {
      // Keep the one with lower relevantScore (higher impact)
      const techA = techniques.find((t) => t.id === a)!;
      const techB = techniques.find((t) => t.id === b)!;
      const scoreA = relevantScore(techA, scores);
      const scoreB = relevantScore(techB, scores);
      removed.add(scoreA <= scoreB ? b : a);
    }
  }

  return techniques.filter((t) => !removed.has(t.id));
}

// Synergies are tracked for future use in scoring but don't change selection yet
export { SYNERGIES };

/** Map technique to the score dimension it most directly addresses. */
function relevantScore(technique: Technique, scores: Scores): number {
  switch (technique.id) {
    case 'chain-of-thought':
      return Math.min(scores.clarity, scores.specificity);
    case 'xml-tags':
      return scores.structure;
    case 'few-shot':
      return scores.examples;
    case 'role-assignment':
      return scores.specificity;
    case 'structured-output':
      return scores.output_format;
    case 'prefill':
      return scores.output_format;
    case 'prompt-chaining':
      return scores.structure;
    case 'uncertainty-permission':
      return scores.specificity;
    case 'extended-thinking':
      return Math.min(scores.clarity, scores.specificity);
    case 'long-context-tips':
      return scores.structure;
    case 'tool-use':
      return scores.specificity;
    default:
      return 5; // Neutral
  }
}

export { TECHNIQUES, type Technique } from './anthropic.js';

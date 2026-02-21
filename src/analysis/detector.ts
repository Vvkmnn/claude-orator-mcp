/**
 * Intent detection via keyword pattern-matching with disambiguation.
 *
 * Strategy:
 * 1. First-pass: priority-ordered pattern matching (system > code > ... > conversation)
 * 2. Disambiguation: "You are an expert... build me X" → system match overridden to code
 * 3. Fallback heuristics: code blocks, "build me", debugging language → code before conversation
 */

import type { Complexity, Intent } from '../types.js';

// Ordered by priority: most distinctive patterns first
const INTENT_PATTERNS: [Intent, RegExp[]][] = [
  [
    'system',
    [
      /^you are\b/i,
      /\bact as\b/i,
      /\byour role\b/i,
      /\bbehave as\b/i,
      /\bsystem prompt\b/i,
      /\byou\s+must\s+always\b/i,
      /\byour\s+task\s+is\b/i,
    ],
  ],
  [
    'code',
    [
      /\bwrite\s+(a\s+)?(\w+\s+)?function\b/i,
      /\bimplement\b/i,
      /\brefactor\b/i,
      /\bdebug\b/i,
      /\bfix\s+(the\s+)?(bug|error|issue|crash)\b/i,
      /\bcreate\s+(a\s+)?(\w+\s+)*(class|component|api|endpoint|module|service|app|application|middleware|hook|plugin|decorator|wrapper)\b/i,
      /\badd\s+(a\s+)?(method|function|handler|route|feature)\b/i,
      /\bcode\s+(that|which|to)\b/i,
      /\banalyze\s+(this\s+)?(code|function|class|module)\b/i,
      /\breview\s+(this\s+)?(code|function|PR|pull\s+request|diff)\b/i,
      /\bbuild\s+(me\s+)?(a\s+)?(\w+\s+)*(app|application|tool|script|server|client|cli|bot|crawler|fetcher|scraper|parser|service|api|site|website|page|dashboard|plugin|extension|library|package|module)\b/i,
      /\bmake\s+(me\s+)?(a\s+)?(\w+\s+)*(app|application|tool|script|server|client|cli|bot)\b/i,
      /\bwrite\s+(me\s+)?(a\s+)?(\w+\s+)*(script|program|app|tool|cli|bot)\b/i,
      /\bwhat'?s?\s+wrong\s+with\b/i,
      /\bhow\s+do\s+I\s+(fix|solve|implement|build|make|write|create)\b/i,
      /\bhere'?s?\s+(my|the|some)\s+code\b/i,
    ],
  ],
  [
    'extraction',
    [
      /\bextract\b/i,
      /\bparse\b/i,
      /\bfind\s+all\b/i,
      /\blist\s+(all|the|every)\b/i,
      /\bidentify\b/i,
      /\bcollect\b/i,
      /\bpull\s+out\b/i,
      /\bscrape\b/i,
    ],
  ],
  [
    'analysis',
    [
      /\banalyze\b/i,
      /\breview\b/i,
      /\bexplain\b/i,
      /\bevaluate\b/i,
      /\bcompare\b/i,
      /\bassess\b/i,
      /\baudit\b/i,
      /\bwhy\s+(does|did|is|are|was)\b/i,
      /\bwhat\s+causes?\b/i,
    ],
  ],
  [
    'creative',
    [
      /\bwrite\s+(a\s+)?(story|poem|essay|blog|article|post|letter|email)\b/i,
      /\bbrainstorm\b/i,
      /\bdraft\b/i,
      /\bgenerate\s+(a\s+)?(name|title|tagline|slogan|headline)\b/i,
      /\bcreate\s+(a\s+)?(story|narrative|description)\b/i,
    ],
  ],
  [
    'conversation',
    [
      /\bchat\s+(with|about)\b/i,
      /\bdiscuss\b/i,
      /\bhelp\s+me\s+(understand|think|decide)\b/i,
      /\btalk\s+(about|through)\b/i,
      /\bwhat\s+do\s+you\s+think\b/i,
    ],
  ],
];

/**
 * Signals that a prompt body is primarily about code, even if the opening
 * matches a non-code intent (e.g., "You are an expert... implement X").
 */
const CODE_BODY_SIGNALS = [
  /\bimplement\b/i,
  /\bbuild\b/i,
  /\bwrite\s+(a\s+)?(\w+\s+)*(function|class|method|script|program|app|tool|cli|bot|server|client)\b/i,
  /\brefactor\b/i,
  /\bdebug\b/i,
  /\bcreate\s+(a\s+)?(class|component|api|endpoint|module|service|app)\b/i,
  /```[\s\S]*?```/, // fenced code blocks
  /\b(async|await|function|const|let|var|import|export|class|interface|type|def|fn|pub|struct|enum)\b/,
  /\breturn\s+(a|the|an)?\s*\w/i,
  /\b(typescript|javascript|python|rust|go|java|ruby)\b/i,
];

/**
 * Fallback heuristics: detect code intent from prompts that didn't match
 * any explicit pattern (would otherwise default to 'conversation').
 */
const CODE_FALLBACK_SIGNALS = [
  /```[\s\S]*?```/, // contains code blocks
  /\bbuild\s+me\b/i, // "build me a ..."
  /\bmake\s+(it|this)\s+(work|run|compile|pass)\b/i, // "make it work"
  /\bhere'?s?\s+(my|the|some)\s+code\b/i,
  /\b(TypeError|SyntaxError|ReferenceError|Error|Exception|stack\s*trace|segfault)\b/,
  /\b(npm|pip|cargo|yarn|pnpm|go\s+get|brew|apt|gem)\s+(install|add|run|build|test)\b/i,
];

/** Detect intent from prompt content with disambiguation and fallback heuristics. */
export function detectIntent(prompt: string): Intent {
  let matched: Intent | null = null;

  for (const [intent, patterns] of INTENT_PATTERNS) {
    if (patterns.some((p) => p.test(prompt))) {
      matched = intent;
      break;
    }
  }

  // Disambiguation: "You are an expert X" + code body → code, not system
  if (matched === 'system') {
    const signalCount = CODE_BODY_SIGNALS.filter((p) => p.test(prompt)).length;
    if (signalCount >= 2) {
      return 'code';
    }
  }

  if (matched) return matched;

  // Fallback heuristics before defaulting to 'conversation'
  if (CODE_FALLBACK_SIGNALS.some((p) => p.test(prompt))) {
    return 'code';
  }

  return 'conversation';
}

/** Detect complexity based on word count and structural indicators. */
export function detectComplexity(prompt: string): Complexity {
  const wordCount = prompt.split(/\s+/).filter(Boolean).length;
  const hasMultipleClauses = /\b(and\s+also|additionally|furthermore|moreover|then\s+also)\b/i.test(
    prompt,
  );
  const hasMultipleSteps = /\b(first|second|third|step\s+\d|then)\b/i.test(prompt);
  const hasConditions = /\b(if\s+.+then|when\s+.+should|unless|except\s+when)\b/i.test(prompt);

  if (
    wordCount > 200 ||
    (wordCount > 100 && (hasMultipleClauses || hasMultipleSteps)) ||
    (hasMultipleSteps && hasConditions)
  ) {
    return 'complex';
  }
  if (wordCount > 50 || hasMultipleClauses || hasMultipleSteps) {
    return 'moderate';
  }
  return 'simple';
}

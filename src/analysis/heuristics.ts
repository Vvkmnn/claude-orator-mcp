/**
 * 7-dimension quality scoring for prompts.
 * All scoring is deterministic: same input always produces same output.
 * Each dimension is 0-10, overall is weighted sum.
 */

import {
  DIMENSION_WEIGHTS,
  type AttributedIssue,
  type AttributedSuggestion,
  type Complexity,
  type Intent,
  type ScoreDimension,
  type Scores,
  type SemanticHint,
} from '../types.js';
import {
  EMPHASIS_TIERS,
  ESCAPE_HATCH_PHRASES,
  INDUSTRY_PATTERNS,
  type IndustryPattern,
} from './industry.js';
import { countIntentMatches } from './detector.js';

// --- Pattern sets for scoring ---

const STRONG_VERBS =
  /^(write|create|implement|analyze|extract|generate|build|design|develop|refactor|debug|fix|add|remove|update|convert|transform|parse|validate|test|deploy|configure|optimize|review|explain|compare|evaluate|list|find|identify)\b/i;

const HEDGING_WORDS =
  /\b(maybe|perhaps|try to|if possible|could you|would you mind|I was wondering|it would be nice|sort of|kind of|I guess|possibly|potentially)\b/i;

const AMBIGUOUS_WORDS =
  /\b(something|stuff|things|it|this|that|somehow|whatever|etc|and so on|you know)\b/gi;

const FILLER_PHRASES =
  /\b(please|I would like you to|could you kindly|I need you to|I want you to|can you please|would you please|if you could)\b/gi;

const XML_TAG = /<[a-z_][a-z0-9_-]*>/i;
const MARKDOWN_HEADER = /^#{1,6}\s+/m;
const BULLET_LIST = /^[\s]*[-*+]\s+/m;
const NUMBERED_LIST = /^[\s]*\d+[.)]\s+/m;

const FORMAT_KEYWORDS =
  /\b(json|xml|csv|markdown|table|yaml|html|code\s+block|typescript|python|sql|array|object|dict|struct|vec|dataframe|list\s+of\s+\w+)\b/i;

const NEGATIVE_CONSTRAINTS =
  /\b(do\s+not|don't|never|avoid|must\s+not|should\s+not|shouldn't|cannot|can't|exclude|prohibit)\b/gi;

const BOUNDARY_CONDITIONS =
  /\b(at\s+most|no\s+more\s+than|at\s+least|maximum|minimum|between\s+\d+\s+and\s+\d+|up\s+to|limit|fewer\s+than|greater\s+than|under\s+\d+|below\s+\d+|within\s+\d+|less\s+than|more\s+than|over\s+\d+|exceed)\b/gi;

const SCOPE_MARKERS =
  /\b(only|focus\s+on|limited\s+to|specifically|exclusively|restricted\s+to|scope|just\s+the)\b/gi;

const LENGTH_CONSTRAINTS =
  /\b(concise|brief|short|detailed|comprehensive|2-3\s+sentences?|one\s+paragraph|under\s+\d+\s+words?|at\s+most\s+\d+|no\s+more\s+than\s+\d+)\b/i;

const TONE_KEYWORDS =
  /\b(formal|casual|technical|friendly|professional|academic|conversational|authoritative)\b/i;

const CONCRETE_CONSTRAINTS =
  /\b(must|shall|required|always|ensure|guarantee|exactly|precisely)\b/gi;

/**
 * Named technologies pattern — with /gi for .match() calls that need all occurrences.
 * IMPORTANT: Do NOT use this with .test() — /g flag advances lastIndex between calls,
 * causing intermittent false negatives. Use NAMED_TECH_TEST for .test() calls.
 */
const NAMED_TECH =
  /\b(typescript|javascript|python|rust|go|react|vue|angular|svelte|next\.?js|node\.?js|express|fastapi|django|flask|spring|rails|postgres|mysql|redis|mongodb|sqlite|docker|kubernetes|aws|gcp|azure|graphql|rest|grpc|websocket|pandas|matplotlib|numpy|scipy|reqwest|tokio|serde|actix|axum|axios|jest|vitest|lodash|tailwind|prisma|drizzle|zod|pydantic|celery|sqlalchemy|oauth2?|saml|jwt|oidc|ldap|openid|kerberos|json|csv|yaml|toml|markdown)\b/gi;

/** Safe for .test() — no /g flag, so lastIndex stays at 0 between calls. */
const NAMED_TECH_TEST =
  /\b(typescript|javascript|python|rust|go|react|vue|angular|svelte|next\.?js|node\.?js|express|fastapi|django|flask|spring|rails|postgres|mysql|redis|mongodb|sqlite|docker|kubernetes|aws|gcp|azure|graphql|rest|grpc|websocket|pandas|matplotlib|numpy|scipy|reqwest|tokio|serde|actix|axum|axios|jest|vitest|lodash|tailwind|prisma|drizzle|zod|pydantic|celery|sqlalchemy|oauth2?|saml|jwt|oidc|ldap|openid|kerberos|json|csv|yaml|toml|markdown)\b/i;

const STOP_WORDS = new Set([
  'the',
  'a',
  'an',
  'is',
  'are',
  'was',
  'were',
  'be',
  'been',
  'being',
  'to',
  'of',
  'for',
  'with',
  'and',
  'but',
  'or',
  'in',
  'on',
  'at',
  'by',
  'it',
  'its',
  'this',
  'that',
  'from',
  'as',
  'if',
  'not',
  'no',
  'so',
  'do',
  'has',
  'have',
  'had',
  'will',
  'would',
  'can',
  'could',
  'should',
]);

const DOMAIN_NOUNS =
  /\b(api|service|database|table|module|component|endpoint|system|pipeline|schema|model|controller|middleware|handler|repository|interface|worker|queue|cache|proxy|gateway|cluster|container|registry|plugin|hook)\b/i;

// --- Individual dimension scorers ---

/** Strip leading filler so "Please write..." scores as "Write..." */
function stripLeadingFiller(text: string): string {
  let result = text.trim();
  const patterns = [
    /^(please\s+)/i,
    /^(I would like you to\s+)/i,
    /^(could you (please\s+|kindly\s+)?)/i,
    /^(can you (please\s+)?)/i,
    /^(I need you to\s+)/i,
    /^(I want you to\s+)/i,
    /^(would you (please\s+|mind\s+)?)/i,
    /^(I was wondering if you could\s+)/i,
    /^(it would be (great|nice|helpful) if you (could\s+)?)/i,
    /^(do you think you could\s+)/i,
    /^(if (it's|its) not too much trouble,?\s*)/i,
  ];
  let changed = true;
  while (changed) {
    changed = false;
    for (const p of patterns) {
      const stripped = result.replace(p, '');
      if (stripped !== result) {
        result = stripped;
        changed = true;
      }
    }
  }
  return result;
}

function scoreClarity(prompt: string): number {
  let score = 0;
  const stripped = stripLeadingFiller(prompt);
  if (STRONG_VERBS.test(stripped)) score += 3;

  const hasSingleTask = !/\b(and\s+also|additionally|furthermore|plus\s+also)\b/i.test(prompt);
  if (hasSingleTask) score += 2;

  const hedges = prompt.match(HEDGING_WORDS);
  if (!hedges) score += 2;

  const ambiguous = prompt.match(AMBIGUOUS_WORDS);
  if (!ambiguous || ambiguous.length <= 1) score += 2;

  const wordCount = prompt.split(/\s+/).filter(Boolean).length;
  if (wordCount >= 5 && wordCount <= 300) score += 1;

  return Math.min(10, score);
}

function scoreSpecificity(prompt: string): number {
  let score = 0;

  const constraints = prompt.match(CONCRETE_CONSTRAINTS);
  score += Math.min(3, constraints?.length ?? 0) * (2 / 3);
  score = Math.round(score * 10) / 10;

  // Graduated tech scoring: more named technologies = more specific
  const techMatches = prompt.match(NAMED_TECH);
  const techCount = techMatches ? new Set(techMatches.map((t) => t.toLowerCase())).size : 0;
  if (techCount >= 3) score += 3;
  else if (techCount >= 2) score += 2.5;
  else if (techCount >= 1) score += 1.5;

  // Graduated numeric spec scoring: more distinct numbers = more precise
  const numbers = prompt.match(/\d+/g);
  const distinctNumbers = numbers ? new Set(numbers).size : 0;
  if (distinctNumbers >= 3) score += 2;
  else if (distinctNumbers >= 1) score += 1;

  const negatives = prompt.match(NEGATIVE_CONSTRAINTS);
  const boundaries = prompt.match(BOUNDARY_CONDITIONS);
  if ((negatives?.length ?? 0) + (boundaries?.length ?? 0) > 0) score += 2;

  // Domain context: references specific domain nouns (not just "the thing")
  if (prompt.length > 100 && DOMAIN_NOUNS.test(prompt)) score += 2;

  return Math.min(10, Math.round(score * 10) / 10);
}

function scoreStructure(prompt: string): number {
  let score = 0;
  if (XML_TAG.test(prompt)) score += 3;
  if (MARKDOWN_HEADER.test(prompt)) score += 2;
  if (BULLET_LIST.test(prompt) || NUMBERED_LIST.test(prompt)) score += 2;

  // Clear section separation (double newlines, horizontal rules)
  if (/\n\n/.test(prompt) || /^---$/m.test(prompt)) score += 2;

  // Inline numbered sequences: "1) filter, 2) group, 3) calculate"
  if (/\d+\)\s*\w[^,;]*,\s*\d+\)\s*\w/.test(prompt)) score += 1;

  // Colon-separated lists: "Consider: X, Y, Z"
  if (/\w+:\s*\w+(?:,\s*\w+){1,}/.test(prompt)) score += 1;

  // Consistent formatting (multiple structural elements present)
  const structuralElements = [XML_TAG, MARKDOWN_HEADER, BULLET_LIST, NUMBERED_LIST].filter((p) =>
    p.test(prompt),
  ).length;
  if (structuralElements >= 2) score += 1;

  return Math.min(10, score);
}

function scoreExamples(prompt: string): number {
  // Structured XML examples with input/output tags — highest score
  if (/<example>[\s\S]*?<input>[\s\S]*?<\/input>[\s\S]*?<output>[\s\S]*?<\/output>/i.test(prompt))
    return 7;

  // Test specifications (assert/expect/it/describe blocks) — tests as spec is high-quality
  if (/\b(assert|expect|it\(|describe\(|test\(|#\[test\]|def\s+test_)\b/.test(prompt)) return 7;

  // Bare <example> tags present (structured but no I/O separation)
  if (/<example>/i.test(prompt)) return 5;

  // Input/output pairs (text-based)
  const hasIOPairs =
    /\b(input|example|given|when)\b[\s\S]{0,100}\b(output|result|then|returns?|produces?)\b/i.test(
      prompt,
    );
  if (hasIOPairs) return 5;

  // JSON/structured code blocks — concrete output format examples
  const codeBlocks = prompt.match(/```[\s\S]*?```/g);
  if (codeBlocks && codeBlocks.length >= 2) return 4;
  if (/```json[\s\S]*?```/i.test(prompt)) return 4;

  // Single example present
  const hasExample =
    /\b(for\s+example|e\.g\.|such\s+as|like\s+this|here'?s?\s+(an?\s+)?example)\b/i.test(prompt);
  if (hasExample) return 3;

  // Format demonstration (code blocks, backtick content)
  if (/```[\s\S]+```/.test(prompt) || /`[^`]+`/.test(prompt)) return 2;

  return 0;
}

function scoreConstraints(prompt: string): number {
  let score = 0;
  let constraintTypes = 0;

  const negatives = prompt.match(NEGATIVE_CONSTRAINTS);
  if (negatives && negatives.length > 0) {
    score += 3;
    constraintTypes++;
  }

  const boundaries = prompt.match(BOUNDARY_CONDITIONS);
  if (boundaries && boundaries.length > 0) {
    score += 2;
    constraintTypes++;
  }

  // Edge cases mentioned
  if (
    /\b(edge\s+case|corner\s+case|empty|null|undefined|zero|negative|overflow|special\s+case)\b/i.test(
      prompt,
    )
  )
    score += 2;

  const scope = prompt.match(SCOPE_MARKERS);
  if (scope && scope.length > 0) {
    score += 3;
    constraintTypes++;
  }

  // Inline numeric constraints: "< 10", "timeout of 5s", "> 100ms"
  if (/[<>]=?\s*\d+|timeout\s+of\s+\d+|\d+\s*(?:ms|s|sec|min|mb|gb|kb)\b/i.test(prompt)) score += 1;

  // Graceful handling language: "handle X gracefully", "log any", "skip and continue"
  if (
    /\b(handle\s+\w+\s+gracefully|log\s+any|skip\s+and\s+continue|fallback\s+to|retry\s+up\s+to)\b/i.test(
      prompt,
    )
  )
    score += 1;

  // Stability bonus: prompts with 3+ constraint types produce more consistent outputs
  if (constraintTypes >= 3) score += 0.5;

  return Math.min(10, score);
}

function scoreOutputFormat(prompt: string): number {
  let score = 0;
  if (FORMAT_KEYWORDS.test(prompt)) score += 4;

  // Explicit format verbs: "return as JSON", "output as CSV"
  if (
    /\b(return\s+as|output\s+as|produce\s+as|respond\s+(in|with)|format(?:ted)?\s+as)\b/i.test(
      prompt,
    )
  )
    score += 2;

  // Structure defined (fields, columns, sections)
  if (/\b(field|column|section|property|attribute|key|include)\b/i.test(prompt)) score += 3;

  if (LENGTH_CONSTRAINTS.test(prompt)) score += 2;
  if (TONE_KEYWORDS.test(prompt)) score += 1;

  // Embedded schemas: JSON schema, TypeScript interface, Zod schema (highest specificity)
  if (/\{[^}]*"type"\s*:\s*"(string|number|object|array)"/i.test(prompt)) score += 3;
  if (/\binterface\s+\w+\s*\{/i.test(prompt)) score += 3;
  if (/\bz\.(string|number|object|array)\b/i.test(prompt)) score += 3;

  return Math.min(10, score);
}

function scoreTokenEfficiency(prompt: string): number {
  let score = 7; // Start neutral

  const fillers = prompt.match(FILLER_PHRASES);
  score -= fillers?.length ?? 0;

  // Redundant restatement detection (repeated key phrases, stop words excluded)
  const sentences = prompt.split(/[.!?]+/).filter((s) => s.trim().length > 10);
  if (sentences.length > 2) {
    const normalized = sentences.map((s) => s.toLowerCase().trim().replace(/\s+/g, ' '));
    for (let i = 0; i < normalized.length; i++) {
      for (let j = i + 1; j < normalized.length; j++) {
        const a = normalized[i]!;
        const b = normalized[j]!;
        const wordsA = new Set(a.split(' ').filter((w) => !STOP_WORDS.has(w)));
        const wordsB = new Set(b.split(' ').filter((w) => !STOP_WORDS.has(w)));
        const smaller = wordsA.size <= wordsB.size ? wordsA : wordsB;
        const larger = wordsA.size > wordsB.size ? wordsA : wordsB;
        let overlap = 0;
        for (const w of smaller) {
          if (larger.has(w)) overlap++;
        }
        if (smaller.size > 2 && overlap / smaller.size > 0.7) score -= 1;
      }
    }
  }

  // Excessive preamble
  const firstTaskVerb = prompt.search(STRONG_VERBS);
  if (firstTaskVerb > 0) {
    const preambleWords = prompt.slice(0, firstTaskVerb).split(/\s+/).filter(Boolean).length;
    if (preambleWords > 30) score -= 2;
  }

  // Bonus for concise, information-dense prompts
  const wordCount = prompt.split(/\s+/).filter(Boolean).length;
  if (wordCount > 0 && wordCount <= 150 && (fillers?.length ?? 0) === 0) score += 2;

  return Math.max(0, Math.min(10, score));
}

// --- Claude-specific anti-patterns ---

interface AntiPattern {
  pattern: RegExp;
  issue: string;
  suggestion: string;
}

const CLAUDE_ANTI_PATTERNS: AntiPattern[] = [
  {
    pattern: /\b(be creative|use your creativity|get creative)\b/i,
    issue:
      '"Be creative" is a non-instruction — Claude needs specific constraints, not vague encouragement',
    suggestion:
      'Replace "be creative" with specific constraints: tone, style, audience, length, or format',
  },
  {
    pattern: /\b(do your best|try your hardest|give it your all|put in effort)\b/i,
    issue: '"Do your best" adds no information — Claude always attempts to satisfy the instruction',
    suggestion:
      'Remove "do your best" — specify what "best" means: accuracy, brevity, completeness, etc.',
  },
  {
    pattern: /\b(pretend you are|imagine you are|act like you're|suppose you are)\b/i,
    issue: '"Pretend you are" causes hedging — use "You are" directly for stronger role adoption',
    suggestion: 'Replace "pretend you are X" with "You are X" for direct role assignment',
  },
  {
    pattern:
      /\b(as an AI|as a language model|as an LLM|as a chatbot|as an assistant|helpful (AI )?assistant)\b/i,
    issue: 'Generic AI/assistant role weakens specificity — assign a concrete expert role instead',
    suggestion:
      'Replace generic assistant role with specific expertise: "You are a senior [domain] engineer"',
  },
  {
    pattern:
      /\b(be detailed|answer in detail|provide detailed|give me a detailed|in great detail)\b/i,
    issue: '"Be detailed" is vague — specify which aspects need depth',
    suggestion:
      'Replace "be detailed" with specific depth instructions: "Include implementation steps, error handling, and edge cases"',
  },
  {
    pattern:
      /\b(don't apologize|never apologize|no need to apologize|stop apologizing|don't say sorry)\b/i,
    issue:
      'Anti-apology instructions waste tokens — better to set a confident tone via role assignment',
    suggestion:
      'Remove apology instructions — use a direct, confident role instead: "You are a direct technical advisor"',
  },

  // Claude 4.6 anti-laziness backfire (from Anthropic docs)
  {
    pattern: /\b(be thorough|think carefully|don't be lazy|be comprehensive|be meticulous)\b/i,
    issue:
      '"Be thorough"/"think carefully" causes runaway behavior on Claude 4.6 — models are already proactive',
    suggestion:
      'Remove thoroughness instructions — specify WHAT to be thorough about instead (e.g., "cover edge cases X, Y, Z")',
  },

  // Tool over-triggering (from Anthropic 4.6 best practices)
  {
    pattern: /\b(you MUST use|always use the|you are required to use)\b.*\b(tool|function|api)\b/i,
    issue: 'Imperative tool instructions ("MUST use") cause excessive tool calling on Claude 4.6',
    suggestion: 'Replace "MUST use [tool]" with "Use [tool] when it would enhance understanding"',
  },

  // Plan-sharing hurts agentic performance (from Codex research)
  {
    pattern:
      /\b(explain your (plan|approach|reasoning)|share your (thought|plan)|describe your strategy)\b/i,
    issue:
      'Asking models to explain plans before acting reduces completion quality in agentic contexts (Codex research)',
    suggestion: 'For agentic tasks, remove plan-sharing instructions — let the model act directly',
  },

  // Suggesting vs requesting (from Anthropic docs)
  {
    pattern: /\b(can you suggest|could you recommend|what would you suggest)\b/i,
    issue: '"Suggest" framing causes Claude to recommend instead of implementing',
    suggestion: 'Be direct: "Change this function to..." not "Can you suggest changes to..."',
  },

  // Meta-prompt instructions (tell model HOW to think instead of WHAT to do)
  {
    pattern:
      /\b(think\s+about\s+what\s+(?:I|you|we|the\s+user)\s+(?:actually\s+)?need|give\s+(?:me\s+)?the\s+best\s+(?:possible\s+)?(?:answer|response|output)|as\s+(?:thorough|detailed|complete|comprehensive)\s+as\s+possible|before\s+you\s+(?:respond|answer|reply),?\s*think\s+about\s+what)\b/i,
    issue:
      'Meta-prompt instructions ("think about what I need", "best possible answer") add no information — Claude already reasons before responding',
    suggestion:
      'Replace meta-instructions with concrete targets: "Prioritize practical implementation" or "Cover edge cases X, Y, Z" instead of "think about what I need"',
  },

  // --- Industry-derived anti-patterns (from 34-tool analysis) ---

  // Baseline expectations (zero-info instructions)
  {
    pattern: /\b(be helpful|be accurate|be correct|high-quality responses)\b/i,
    issue:
      '"Be helpful/accurate" adds no information — these are baseline expectations, not instructions',
    suggestion:
      'Remove baseline expectations — specify what "helpful" means: response format, depth, audience',
  },

  // Escape-hatch phrases (scope weakeners)
  {
    pattern: new RegExp(
      `\\b(${ESCAPE_HATCH_PHRASES.map((p) => p.replace(/\s+/g, '\\s+')).join('|')})\\b`,
      'i',
    ),
    issue: '"When appropriate" creates opt-out paths — the model will use them to skip work',
    suggestion:
      'Make conditions explicit: "When the input contains dates, format as ISO 8601" instead of "format dates when appropriate"',
  },
];

// --- Main scoring function ---

const DIMENSION_SCORERS: Record<string, (prompt: string) => number> = {
  clarity: scoreClarity,
  specificity: scoreSpecificity,
  structure: scoreStructure,
  examples: scoreExamples,
  constraints: scoreConstraints,
  output_format: scoreOutputFormat,
  token_efficiency: scoreTokenEfficiency,
};

/** Score a prompt across all 7 dimensions. Returns individual scores. */
export function scorePrompt(prompt: string): Scores {
  const scores: Partial<Scores> = {};
  for (const [dim, scorer] of Object.entries(DIMENSION_SCORERS)) {
    scores[dim as keyof Scores] = scorer(prompt);
  }
  return scores as Scores;
}

/** Compute weighted overall score from dimension scores. */
export function overallScore(scores: Scores): number {
  let total = 0;
  for (const [dim, weight] of Object.entries(DIMENSION_WEIGHTS)) {
    total += (scores[dim as keyof Scores] ?? 0) * weight;
  }
  return Math.round(total * 10) / 10;
}

// --- Issue & suggestion detection ---

/** Detect issues in the prompt as flat string descriptions. */
export function detectIssues(prompt: string, scores: Scores, intent?: Intent): string[] {
  return detectAttributedIssues(prompt, scores, intent).map((i) => i.message);
}

/** Generate actionable suggestions as flat strings. */
export function generateSuggestions(prompt: string, scores: Scores, intent?: Intent): string[] {
  return generateAttributedSuggestions(prompt, scores, intent).map((s) => s.message);
}

// --- Emphasis balance analysis ---

interface EmphasisAnalysis {
  monoEmphasis: boolean;
  negativeHeavy: boolean;
}

/** Analyze emphasis keyword distribution and negative/positive ratio. */
function analyzeEmphasisBalance(prompt: string): EmphasisAnalysis {
  // Count absolute emphasis keywords
  const absoluteCounts: Record<string, number> = {};
  let totalAbsolute = 0;
  for (const keyword of EMPHASIS_TIERS.absolute) {
    const regex = new RegExp(`\\b${keyword}\\b`, 'g');
    const count = (prompt.match(regex) ?? []).length;
    if (count > 0) {
      absoluteCounts[keyword] = count;
      totalAbsolute += count;
    }
  }

  // Check for tiering: any moderate/informational keywords present?
  const hasOtherTiers =
    EMPHASIS_TIERS.moderate.some((k) => new RegExp(`\\b${k}\\b`).test(prompt)) ||
    EMPHASIS_TIERS.informational.some((k) => new RegExp(`\\b${k}\\b`).test(prompt));

  // Mono-emphasis: >5 of a single absolute keyword with no tiering
  const monoEmphasis =
    !hasOtherTiers && Object.values(absoluteCounts).some((count) => count > 5) && totalAbsolute > 5;

  // Negative vs positive ratio
  const negatives = (prompt.match(/\b(do\s+not|don't|never|avoid)\b/gi) ?? []).length;
  const positives = (
    prompt.match(/\b(do|always|ensure|make\s+sure|include|provide|use|follow|implement)\b/gi) ?? []
  ).length;
  const negativeHeavy = negatives > 3 && (positives === 0 || negatives / positives > 2);

  return { monoEmphasis, negativeHeavy };
}

// --- Attribution helpers ---

/** Map IndustryPattern category to the most relevant ScoreDimension. */
function categoryToDimension(category: IndustryPattern['category']): ScoreDimension | undefined {
  const map: Record<string, ScoreDimension> = {
    structure: 'structure',
    role: 'clarity',
    constraint: 'constraints',
    examples: 'examples',
    security: 'constraints',
    scope: 'constraints',
    agentic: 'constraints',
  };
  return map[category];
}

/** Map anti-pattern issue text to the most affected ScoreDimension. */
function antiPatternDimension(issue: string): ScoreDimension {
  if (/creative|detailed|thorough|think carefully|comprehensive/i.test(issue)) return 'specificity';
  if (/do your best|pretend|apologize/i.test(issue)) return 'clarity';
  if (/AI|assistant|helpful|accurate/i.test(issue)) return 'clarity';
  if (/tool|MUST use/i.test(issue)) return 'constraints';
  if (/plan|explain your/i.test(issue)) return 'token_efficiency';
  if (/suggest|recommend/i.test(issue)) return 'clarity';
  if (/appropriate|when needed/i.test(issue)) return 'specificity';
  return 'clarity';
}

// --- Attributed issue detection (source of truth) ---

/** Detect issues with full attribution metadata. */
export function detectAttributedIssues(
  prompt: string,
  scores: Scores,
  intent?: Intent,
): AttributedIssue[] {
  const issues: AttributedIssue[] = [];

  // Dimension-triggered issues
  if (scores.clarity < 5) {
    if (HEDGING_WORDS.test(prompt))
      issues.push({
        message: 'Contains hedging language that weakens the instruction',
        dimension: 'clarity',
        source: 'dimension',
        confidence: 'high',
      });
    if (!STRONG_VERBS.test(prompt))
      issues.push({
        message: 'Does not start with a clear action verb',
        dimension: 'clarity',
        source: 'dimension',
        confidence: 'high',
      });
    const ambiguous = prompt.match(AMBIGUOUS_WORDS);
    if (ambiguous && ambiguous.length > 2)
      issues.push({
        message: `Uses ${ambiguous.length} ambiguous references (something, stuff, it, this)`,
        dimension: 'clarity',
        source: 'dimension',
        confidence: 'high',
      });
  }

  if (scores.specificity < 5) {
    if (!NAMED_TECH_TEST.test(prompt) && intent !== 'creative')
      issues.push({
        message: 'No specific technologies or formats named',
        dimension: 'specificity',
        source: 'dimension',
        confidence: 'high',
      });
    if (!/\d/.test(prompt))
      issues.push({
        message: 'No quantified requirements or constraints',
        dimension: 'specificity',
        source: 'dimension',
        confidence: 'high',
      });
  }

  if (scores.structure < 4) {
    if (prompt.length > 200)
      issues.push({
        message: 'Long prompt lacks structural formatting (XML tags, headers, lists)',
        dimension: 'structure',
        source: 'dimension',
        confidence: 'high',
      });
  }

  if (scores.examples < 3) {
    issues.push({
      message: 'No examples provided to demonstrate expected input/output',
      dimension: 'examples',
      source: 'dimension',
      confidence: 'medium',
    });
  }

  if (scores.output_format < 4) {
    issues.push({
      message: 'No output format specified',
      dimension: 'output_format',
      source: 'dimension',
      confidence: 'medium',
    });
  }

  if (scores.constraints < 4) {
    issues.push({
      message: 'Missing explicit constraints or scope boundaries',
      dimension: 'constraints',
      source: 'dimension',
      confidence: 'medium',
    });
  }

  if (scores.token_efficiency < 5) {
    const fillers = prompt.match(FILLER_PHRASES);
    if (fillers && fillers.length > 0)
      issues.push({
        message: `${fillers.length} filler phrases waste tokens (please, I would like you to, etc.)`,
        dimension: 'token_efficiency',
        source: 'dimension',
        confidence: 'high',
      });
  }

  // Claude-specific anti-patterns
  for (const ap of CLAUDE_ANTI_PATTERNS) {
    if (ap.pattern.test(prompt)) {
      issues.push({
        message: ap.issue,
        dimension: antiPatternDimension(ap.issue),
        source: 'anti_pattern',
        confidence: 'high',
      });
    }
  }

  // Industry patterns
  for (const pattern of INDUSTRY_PATTERNS) {
    if (pattern.appliesTo && intent && !pattern.appliesTo.includes(intent)) continue;
    if (pattern.minLength && prompt.length < pattern.minLength) continue;
    if (pattern.prevalence < 0.7) continue;
    if (!pattern.detect.test(prompt)) {
      issues.push({
        message: pattern.issue,
        dimension: categoryToDimension(pattern.category),
        source: 'industry',
        confidence: pattern.prevalence >= 0.85 ? 'high' : 'medium',
        pattern_id: pattern.id,
      });
    }
  }

  // Contextual: comprehensive without scope
  if (/\b(comprehensive|exhaustive|complete)\b/i.test(prompt)) {
    const match = prompt.match(/\b(comprehensive|exhaustive|complete)\b/i);
    if (match?.index !== undefined) {
      const nearby = prompt.slice(match.index, match.index + 100);
      if (!SCOPE_MARKERS.test(nearby)) {
        issues.push({
          message: "'Comprehensive' without scope leads to unbounded output",
          dimension: 'constraints',
          source: 'contextual',
          confidence: 'medium',
        });
      }
    }
  }

  // Contextual: emphasis balance
  const emphasisCounts = analyzeEmphasisBalance(prompt);
  if (emphasisCounts.monoEmphasis) {
    issues.push({
      message: 'Using only MUST (or only NEVER) for all constraints dilutes their force',
      dimension: 'constraints',
      source: 'contextual',
      confidence: 'medium',
    });
  }
  if (emphasisCounts.negativeHeavy) {
    issues.push({
      message:
        "Lists of 'don't do X' without 'do Y instead' leave the model without positive guidance",
      dimension: 'constraints',
      source: 'contextual',
      confidence: 'medium',
    });
  }

  return issues;
}

// --- Attributed suggestion generation (source of truth) ---

/** Generate suggestions with full attribution metadata. */
export function generateAttributedSuggestions(
  prompt: string,
  scores: Scores,
  intent?: Intent,
): AttributedSuggestion[] {
  const suggestions: AttributedSuggestion[] = [];

  if (scores.clarity < 5 && !STRONG_VERBS.test(prompt)) {
    suggestions.push({
      message: 'Start with a strong action verb: "Write...", "Create...", "Analyze..."',
      dimension: 'clarity',
      source: 'dimension',
      confidence: 'high',
    });
  }

  if (scores.structure < 4 && prompt.length > 200) {
    suggestions.push({
      message: 'Wrap sections in XML tags: <task>, <requirements>, <context>',
      dimension: 'structure',
      source: 'dimension',
      confidence: 'high',
    });
  }

  if (scores.examples < 3) {
    suggestions.push({
      message: 'Add an input/output example to demonstrate expected behavior',
      dimension: 'examples',
      source: 'dimension',
      confidence: 'medium',
    });
  }

  if (scores.output_format < 4) {
    suggestions.push({
      message: 'Specify output format: JSON, markdown, code block, table, etc.',
      dimension: 'output_format',
      source: 'dimension',
      confidence: 'medium',
    });
  }

  if (scores.specificity < 5) {
    suggestions.push({
      message: 'Add concrete constraints: named technologies, numeric limits, explicit boundaries',
      dimension: 'specificity',
      source: 'dimension',
      confidence: 'high',
    });
  }

  if (scores.constraints < 4) {
    suggestions.push({
      message: 'Define scope with "only", "focus on", "do not include"',
      dimension: 'constraints',
      source: 'dimension',
      confidence: 'medium',
    });
  }

  // TDD suggestion — only for code intent, suppress when prompt is already about writing tests
  if (
    scores.examples < 3 &&
    intent === 'code' &&
    /\b(implement|write|create|build|code|function|class)\b/i.test(prompt) &&
    !/\b(write|create|add|generate)\s+(\w+\s+)*(unit\s+)?tests?\b/i.test(prompt)
  ) {
    suggestions.push({
      message:
        'Consider providing test cases as specification — tests produce more precise code than prose descriptions',
      dimension: 'examples',
      source: 'dimension',
      confidence: 'medium',
    });
  }

  if (scores.token_efficiency < 5) {
    suggestions.push({
      message: 'Remove filler phrases — go directly to the instruction',
      dimension: 'token_efficiency',
      source: 'dimension',
      confidence: 'high',
    });
  }

  // Anti-pattern suggestions
  for (const ap of CLAUDE_ANTI_PATTERNS) {
    if (ap.pattern.test(prompt)) {
      suggestions.push({
        message: ap.suggestion,
        dimension: antiPatternDimension(ap.issue),
        source: 'anti_pattern',
        confidence: 'high',
      });
    }
  }

  // Industry pattern suggestions
  for (const pattern of INDUSTRY_PATTERNS) {
    if (pattern.appliesTo && intent && !pattern.appliesTo.includes(intent)) continue;
    if (pattern.minLength && prompt.length < pattern.minLength) continue;
    if (pattern.prevalence < 0.7) continue;
    if (!pattern.detect.test(prompt)) {
      suggestions.push({
        message: pattern.suggestion,
        dimension: categoryToDimension(pattern.category),
        source: 'industry',
        confidence: pattern.prevalence >= 0.85 ? 'high' : 'medium',
        pattern_id: pattern.id,
      });
    }
  }

  // Emphasis balance suggestions
  const emphasisCounts = analyzeEmphasisBalance(prompt);
  if (emphasisCounts.monoEmphasis) {
    suggestions.push({
      message:
        'Tier constraints: MUST for hard rules, SHOULD for preferences, MAY for suggestions — 95% of production tools use tiered emphasis',
      dimension: 'constraints',
      source: 'contextual',
      confidence: 'medium',
    });
  }
  if (emphasisCounts.negativeHeavy) {
    suggestions.push({
      message:
        'Pair prohibitions with positive alternatives: "Do not summarize the entire article. Instead, extract the 3 key claims."',
      dimension: 'constraints',
      source: 'contextual',
      confidence: 'medium',
    });
  }

  return suggestions;
}

// --- Semantic hint generation ---

/** Generate semantic hints — meta-observations about analysis uncertainty for calling Claude. */
export function generateSemanticHints(
  prompt: string,
  scores: Scores,
  intent: Intent,
  complexity: Complexity,
): SemanticHint[] {
  const hints: SemanticHint[] = [];

  // Intent ambiguity: multiple intent patterns match
  const matchCount = countIntentMatches(prompt);
  if (matchCount >= 2) {
    hints.push({
      area: 'intent_detection',
      reason: `Prompt matches ${matchCount} intent categories — detected as "${intent}" but could be misclassified`,
      check:
        "Verify the detected intent fits the user's actual goal before applying intent-specific scaffolding",
    });
  }

  // Borderline dimension scores (within ±1 of threshold)
  const thresholds: Partial<Record<ScoreDimension, number>> = {
    clarity: 5,
    specificity: 5,
    structure: 4,
    examples: 3,
    output_format: 4,
    constraints: 4,
    token_efficiency: 5,
  };
  for (const [dim, threshold] of Object.entries(thresholds)) {
    const score = scores[dim as ScoreDimension];
    if (Math.abs(score - threshold) <= 1 && score > 0) {
      hints.push({
        area: `borderline_${dim}`,
        reason: `${dim} score (${score}) is near the issue threshold (${threshold})`,
        check: `Assess whether ${dim} is adequate for this specific use case`,
        dimension: dim as ScoreDimension,
      });
    }
  }

  // Quality mismatch: high clarity + low specificity may be intentional vagueness
  // Only fire when gap is genuinely surprising (specificity <= 1) and not creative intent
  if (scores.clarity >= 7 && scores.specificity <= 1 && intent !== 'creative') {
    hints.push({
      area: 'quality_mismatch',
      reason: 'High clarity but low specificity — the prompt is clear but deliberately open-ended',
      check: 'Determine if the vagueness is intentional (creative/exploratory) or an oversight',
    });
  }

  // Complexity assessment
  if (complexity === 'moderate') {
    hints.push({
      area: 'complexity_assessment',
      reason:
        'Moderate complexity detected — prompt chaining or thinking scaffolds may or may not help',
      check:
        'Assess whether the task benefits from step-by-step decomposition or if direct execution is better',
    });
  }

  // Domain expertise detection
  if (/\b(medical|clinical|patient|diagnosis|treatment|pharma|drug|dosage)\b/i.test(prompt)) {
    hints.push({
      area: 'domain_expertise',
      reason: 'Medical/clinical domain keywords detected',
      check:
        'Verify domain-specific constraints are appropriate — medical prompts may need disclaimers and evidence requirements',
      dimension: 'constraints',
    });
  }
  if (/\b(legal|law|regulation|compliance|statute|liability|attorney|contract)\b/i.test(prompt)) {
    hints.push({
      area: 'domain_expertise',
      reason: 'Legal domain keywords detected',
      check: 'Verify legal disclaimers and jurisdiction-specific constraints are appropriate',
      dimension: 'constraints',
    });
  }
  if (
    /\b(financial|investment|trading|portfolio|returns?\s+on|stock|bond|dividend|equity|securities)\b/i.test(
      prompt,
    )
  ) {
    hints.push({
      area: 'domain_expertise',
      reason: 'Financial domain keywords detected',
      check: 'Verify financial disclaimers and regulatory constraints are appropriate',
      dimension: 'constraints',
    });
  }

  return hints;
}

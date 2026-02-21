/**
 * Core orchestrator: prompt in → optimized prompt out.
 * Wires detector + heuristics + techniques into a single optimize() function.
 *
 * Unlike a simple template appender, this actually decomposes the prompt,
 * extracts semantic parts, and reassembles them with proper structure.
 * The result is a substantive scaffold — not just boilerplate wrapped around the original.
 */

import { detectComplexity, detectIntent } from './analysis/detector.js';
import {
  detectIssues,
  generateSuggestions,
  overallScore,
  scorePrompt,
} from './analysis/heuristics.js';
import type { Complexity, Intent, OptimizeInput, OptimizeResult, Scores, Target } from './types.js';
import { selectTechniques, type Technique } from './techniques/index.js';

/** High-quality threshold — prompts at or above this are already well-structured. */
const QUALITY_THRESHOLD = 8.0;

export function optimize(input: OptimizeInput): OptimizeResult {
  const { prompt, target } = input;

  // 1. Detect intent and complexity
  const intent = input.intent ?? detectIntent(prompt);
  const complexity = detectComplexity(prompt);

  // 2. Score the original prompt
  const beforeScores = scorePrompt(prompt);
  const scoreBefore = overallScore(beforeScores);

  // 3. Collect issues and suggestions
  const issues = detectIssues(prompt, beforeScores);
  const suggestions = generateSuggestions(prompt, beforeScores);

  // 4. Select techniques
  const techniques = selectTechniques(
    intent,
    beforeScores,
    prompt,
    complexity,
    target,
    input.techniques,
  );

  // 5. Early return if already high quality
  if (scoreBefore >= QUALITY_THRESHOLD) {
    return {
      optimized_prompt: prompt,
      score_before: scoreBefore,
      score_after: scoreBefore,
      summary: `already well-structured (${scoreBefore})`,
      detected_intent: intent,
      applied_techniques: [],
      issues,
      suggestions,
    };
  }

  // 6. Deep rewrite: decompose, restructure, reassemble
  const decomposed = decomposePrompt(prompt);

  // Vague prompt enrichment: ultra-short prompts with no tech/constraints get clarifying scaffold
  const wordCount = prompt.split(/\s+/).filter(Boolean).length;
  if (
    wordCount < 10 &&
    decomposed.technologies.length === 0 &&
    decomposed.constraints.length === 0
  ) {
    switch (intent) {
      case 'code':
        decomposed.constraints.push(
          'Clarify: What specific functionality is needed?',
          'Clarify: What are the expected inputs and outputs?',
          'Clarify: Are there any constraints (language, performance, format)?',
        );
        break;
      case 'creative':
        decomposed.constraints.push(
          'Clarify: What form or structure? (free verse, sonnet, haiku, prose poem, etc.)',
          'Clarify: What tone or mood? (contemplative, joyful, dark, nostalgic, etc.)',
          'Clarify: What length? (short, medium, long)',
        );
        break;
      default:
        decomposed.constraints.push(
          'Clarify: What specific outcome is needed?',
          'Clarify: What context or audience?',
          'Clarify: Any constraints on format or length?',
        );
        break;
    }
  }
  const optimizedPrompt = assembleOptimizedPrompt(
    decomposed,
    techniques,
    intent,
    complexity,
    beforeScores,
    target,
  );

  // 7. Score the optimized prompt
  const afterScores = scorePrompt(optimizedPrompt);
  const scoreAfter = overallScore(afterScores);

  // 8. Build summary from technique action phrases
  const appliedIds = techniques.map((t) => t.id);
  const summary = buildSummary(techniques, issues.length);

  // Regression guard: tolerance of 0.3 because structural rewrites add value
  // that the scorer may not fully capture (XML tags, role assignment, etc.)
  if (scoreAfter < scoreBefore - 0.3) {
    return {
      optimized_prompt: prompt,
      score_before: scoreBefore,
      score_after: scoreBefore,
      summary:
        'structural rewrite did not improve score — review suggestions for manual refinement',
      detected_intent: intent,
      applied_techniques: [],
      issues,
      suggestions,
    };
  }

  return {
    optimized_prompt: optimizedPrompt,
    score_before: scoreBefore,
    score_after: scoreAfter,
    summary,
    detected_intent: intent,
    applied_techniques: appliedIds,
    issues,
    suggestions,
  };
}

// --- Prompt decomposition ---

interface DecomposedPrompt {
  /** The core task/instruction stripped of filler */
  task: string;
  /** Context sentences (background info, not instructions) */
  context: string[];
  /** Constraints already present (must, never, only, etc.) */
  constraints: string[];
  /** Any format requirements already mentioned */
  formatHints: string[];
  /** Named technologies, tools, frameworks mentioned */
  technologies: string[];
  /** Any examples already present */
  existingExamples: string[];
  /** Quantified requirements (numbers, limits) */
  quantities: string[];
}

const FILLER_PATTERNS = [
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

const CONSTRAINT_PATTERN =
  /\b(must|shall|should|never|always|do\s+not|don't|avoid|ensure|only|exclusively|at\s+most|at\s+least|no\s+more\s+than|maximum|minimum)\b/i;

/**
 * Format type pattern — only true format/output types, not programming languages.
 * Programming languages (python, typescript, sql) removed to prevent task sentences
 * like "Given a list of URLs" from being routed to formatHints.
 */
const FORMAT_TYPE_PATTERN =
  /\b(json|xml|csv|markdown|table|yaml|html|code\s+block|bullet|numbered)\b/i;

/**
 * Format verb pattern — tightened to require "as"/"in"/"with" after the verb
 * to prevent false matches on sentences like "return the sorted Vec".
 */
const FORMAT_VERB_PATTERN =
  /\b(output\s+as|return\s+as|respond\s+in|respond\s+with|format(?:ted)?\s+as|produce\s+as)\b/i;

const TECH_PATTERN =
  /\b(typescript|javascript|python|rust|go|golang|java|c\+\+|ruby|swift|kotlin|react|vue|angular|svelte|next\.?js|node\.?js|express|fastapi|django|flask|spring|rails|postgres|mysql|redis|mongodb|sqlite|docker|kubernetes|aws|gcp|azure|graphql|rest|grpc|websocket|tailwind|prisma|drizzle|zod|pydantic)\b/gi;

const QUANTITY_PATTERN =
  /\b(\d+[\s-]+(items?|results?|lines?|words?|characters?|paragraphs?|examples?|steps?|minutes?|seconds?|entries|rows?|columns?|fields?|elements?))\b/gi;

function decomposePrompt(prompt: string): DecomposedPrompt {
  let task = prompt.trim();

  // Preserve code blocks and XML blocks before decomposition
  const preserved: string[] = [];
  // Extract fenced code blocks
  task = task.replace(/```[\s\S]*?```/g, (match) => {
    preserved.push(match);
    return `__PRESERVED_${preserved.length - 1}__`;
  });
  // Extract XML blocks (multi-line tag pairs)
  task = task.replace(/<([a-z_][a-z0-9_-]*)>[\s\S]*?<\/\1>/gi, (match) => {
    preserved.push(match);
    return `__PRESERVED_${preserved.length - 1}__`;
  });

  // Strip filler prefixes iteratively
  let changed = true;
  while (changed) {
    changed = false;
    for (const pattern of FILLER_PATTERNS) {
      const stripped = task.replace(pattern, '');
      if (stripped !== task) {
        task = stripped;
        changed = true;
      }
    }
  }

  // Capitalize first letter
  if (task.length > 0) {
    task = task.charAt(0).toUpperCase() + task.slice(1);
  }

  // Preserve inline numbered sequences like "1) filter, 2) group, 3) calculate"
  // before sentence splitting tears them apart
  task = task.replace(/\b(\d+\)\s*\w[^,;]*(?:,\s*\d+\)\s*\w[^,;]*){1,})/g, (match) => {
    preserved.push(match.trim());
    return `__PRESERVED_${preserved.length - 1}__`;
  });

  // Detect and group contiguous markdown list items as single blocks
  const listBlockPattern = /(?:^|\n)((?:[\t ]*[-*+]\s+.+(?:\n|$))+)/g;
  task = task.replace(listBlockPattern, (match) => {
    preserved.push(match.trim());
    return `\n__PRESERVED_${preserved.length - 1}__\n`;
  });
  // Also group numbered lists
  const numberedListPattern = /(?:^|\n)((?:[\t ]*\d+[.)]\s+.+(?:\n|$))+)/g;
  task = task.replace(numberedListPattern, (match) => {
    preserved.push(match.trim());
    return `\n__PRESERVED_${preserved.length - 1}__\n`;
  });

  // Extract sentences for classification (preserved blocks stay as single units)
  const sentences = task
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);

  const context: string[] = [];
  const constraints: string[] = [];
  const formatHints: string[] = [];
  const taskSentences: string[] = [];
  const existingExamples: string[] = [];

  for (const sentence of sentences) {
    if (CONSTRAINT_PATTERN.test(sentence)) {
      constraints.push(sentence);
    } else if (FORMAT_TYPE_PATTERN.test(sentence) && FORMAT_VERB_PATTERN.test(sentence)) {
      formatHints.push(sentence);
    } else if (
      /\b(for\s+example|e\.g\.|such\s+as|like\s+this|here'?s?\s+(an?\s+)?example)\b/i.test(sentence)
    ) {
      existingExamples.push(sentence);
    } else if (
      /\b(currently|background|context|note that|we\s+(have|use|are)|the\s+\w+\s+is)\b/i.test(
        sentence,
      )
    ) {
      context.push(sentence);
    } else {
      taskSentences.push(sentence);
    }
  }

  // Extract technologies
  const techMatches = task.match(TECH_PATTERN) ?? [];
  const technologies = [...new Set(techMatches.map((t) => t.toLowerCase()))];

  // Extract quantities
  const quantities = (task.match(QUANTITY_PATTERN) ?? []).map((q) => q.trim());

  // Reconstruct core task from task sentences
  let coreTask = taskSentences.length > 0 ? taskSentences.join(' ') : task;

  // Restore preserved blocks (code, XML, lists)
  const restore = (text: string): string =>
    text.replace(/__PRESERVED_(\d+)__/g, (_, idx: string) => preserved[parseInt(idx)] ?? '');

  coreTask = restore(coreTask);
  const restoredContext = context.map(restore);
  const restoredConstraints = constraints.map(restore);
  const restoredFormatHints = formatHints.map(restore);
  const restoredExamples = existingExamples.map(restore);

  return {
    task: coreTask,
    context: restoredContext,
    constraints: restoredConstraints,
    formatHints: restoredFormatHints,
    technologies,
    existingExamples: restoredExamples,
    quantities,
  };
}

// --- Intelligent reassembly ---

function assembleOptimizedPrompt(
  d: DecomposedPrompt,
  techniques: Technique[],
  intent: Intent,
  complexity: Complexity,
  scores: Scores,
  target: Target = 'claude-code',
): string {
  const techIds = new Set(techniques.map((t) => t.id));
  const useXml = techIds.has('xml-tags') || d.task.length > 150;
  const parts: string[] = [];

  // 1. Role assignment — specific, not generic. Skip if prompt already has a role.
  const hasExistingRole = /^you\s+are\b/i.test(d.task.trim());
  if (techIds.has('role-assignment') && !hasExistingRole) {
    const role = inferRole(intent, d.task, d.technologies);
    parts.push(`You are ${role}.`);
    parts.push('');
  }

  // Context-first ordering (from Codex research): front-load context before the task
  // instruction so grounding data is read first. Only when substantial context exists.
  const hasSubstantialContext = d.context.length > 0;

  if (hasSubstantialContext) {
    // 2a. Context first — grounding data before the instruction
    parts.push('');
    if (useXml) {
      parts.push('<context>');
      d.context.forEach((c) => parts.push(c));
      parts.push('</context>');
    } else {
      parts.push(d.context.join(' '));
    }
    parts.push('');
  }

  // 2b. Task — the core instruction, restructured
  if (useXml) {
    parts.push('<task>');
    parts.push(d.task);
    parts.push('</task>');
  } else {
    parts.push(d.task);
  }

  // 4. Requirements — synthesize from constraints + generate missing ones
  const requirements = buildRequirements(d, intent, scores);
  if (requirements.length > 0) {
    parts.push('');
    if (useXml) {
      parts.push('<requirements>');
      requirements.forEach((r) => parts.push(`- ${r}`));
      parts.push('</requirements>');
    } else {
      parts.push('Requirements:');
      requirements.forEach((r) => parts.push(`- ${r}`));
    }
  }

  // 5. Examples — intent-specific, not generic
  if (techIds.has('few-shot')) {
    parts.push('');
    const examples = buildExamples(d, intent);
    if (useXml) {
      parts.push('<examples>');
      parts.push(examples);
      parts.push('</examples>');
    } else {
      parts.push(examples);
    }
  } else if (d.existingExamples.length > 0 && useXml) {
    parts.push('');
    parts.push('<examples>');
    d.existingExamples.forEach((e) => parts.push(e));
    parts.push('</examples>');
  }

  // 6. Output format — inferred from intent, not generic
  if (techIds.has('structured-output')) {
    parts.push('');
    const format = inferOutputFormat(d, intent);
    if (useXml) {
      parts.push('<output_format>');
      parts.push(format);
      parts.push('</output_format>');
    } else {
      parts.push(format);
    }
  } else if (d.formatHints.length > 0 && useXml) {
    parts.push('');
    parts.push('<output_format>');
    d.formatHints.forEach((f) => parts.push(f));
    parts.push('</output_format>');
  }

  // 7. Chain of thought — skip entirely for claude-code (has built-in adaptive thinking),
  // use permissive framing for other targets (prescriptive CoT is less effective on 4.6+)
  if (techIds.has('chain-of-thought') && target !== 'claude-code') {
    parts.push('');
    if (complexity === 'complex') {
      parts.push('Consider the key factors and edge cases before synthesizing your answer.');
    } else {
      parts.push('Consider the key factors before answering.');
    }
  }

  // 8. Prompt chaining — actual step breakdown derived from content
  if (techIds.has('prompt-chaining')) {
    parts.push('');
    const steps = inferSteps(d.task, intent);
    parts.push('Approach this in sequential steps:');
    steps.forEach((step, i) => parts.push(`${i + 1}. ${step}`));
  }

  // 9. Uncertainty permission
  if (techIds.has('uncertainty-permission')) {
    parts.push('');
    parts.push(
      'If uncertain about any claim, say so explicitly. Distinguish known facts from inferences.',
    );
  }

  // 10. Extended thinking — instruction for complex reasoning
  if (techIds.has('extended-thinking')) {
    parts.push('');
    parts.push('This problem requires careful, thorough reasoning.');
  }

  // 11. Long context tips — sandwich pattern for long prompts
  if (techIds.has('long-context-tips') && d.context.length > 0) {
    // Key instruction is already at the top via task; repeat at the bottom
    const keyInstruction = d.task.split(/[.!?]/)[0]?.trim();
    if (keyInstruction) {
      parts.push('');
      parts.push(`Remember: ${keyInstruction}.`);
    }
  }

  // 12. Tool use guidelines
  if (techIds.has('tool-use')) {
    parts.push('');
    if (useXml) {
      parts.push('<tool_guidelines>');
      parts.push('- Verify required parameters before calling');
      parts.push('- Handle tool errors gracefully');
      parts.push('- Prefer specific tools over general ones');
      parts.push('</tool_guidelines>');
    } else {
      parts.push('When using tools:');
      parts.push('- Verify required parameters before calling');
      parts.push('- Handle tool errors gracefully');
      parts.push('- Prefer specific tools over general ones');
    }
  }

  // 13. Structured output format suggestion (was prefill, updated for 4.6+)
  if (techIds.has('prefill')) {
    parts.push('');
    const prefill = inferPrefill(intent, d);
    if (target === 'claude-api') {
      parts.push(`Begin your response with: ${prefill}`);
    } else {
      parts.push(`Expected response format: ${prefill}`);
    }
  }

  return applyTargetAdjustments(parts.join('\n'), target, intent);
}

/** Post-process assembled prompt for target environment. */
function applyTargetAdjustments(prompt: string, target: Target, intent: Intent): string {
  switch (target) {
    case 'claude-code':
      // Remove explicit thinking instructions — CC has extended thinking built in
      prompt = prompt.replace(
        /^(Think through.*step-by-step.*|Before answering,?\s*think through.*|Before answering,?\s*work through.*)$/gm,
        '',
      );
      // Add codebase-awareness for code intent
      if (intent === 'code' && !prompt.includes('existing conventions')) {
        prompt = prompt.replace(
          /<\/requirements>/,
          '- Follow existing conventions in the codebase\n</requirements>',
        );
      }
      break;

    case 'claude-api':
      // Add result tag suggestion for parsing
      if (!/<result>/i.test(prompt)) {
        prompt += '\n\nWrap your final answer in <result> tags for structured parsing.';
      }
      break;

    case 'claude-desktop':
      // Lighter structure — strip XML for simple prompts
      if (prompt.length < 500 && intent !== 'system') {
        prompt = prompt
          .replace(/<\/?(task|context|requirements|output_format)>/g, '')
          .replace(/\n{3,}/g, '\n\n')
          .trim();
      }
      break;
  }

  // Clean up empty lines from removals
  return prompt.replace(/\n{3,}/g, '\n\n').trim();
}

// --- Requirement synthesis ---

/** Infer task-specific edge cases from the code task description. */
function inferCodeEdgeCases(taskLower: string): string[] {
  if (/\b(sort|order|rank)\b/.test(taskLower))
    return ['empty array', 'single element', 'duplicate values', 'already sorted'];
  if (/\b(parse|convert|transform|deserialize)\b/.test(taskLower))
    return ['malformed input', 'empty string', 'unexpected types'];
  if (/\b(api|endpoint|route|request|handler)\b/.test(taskLower))
    return ['invalid request body', 'missing required fields', 'auth failure'];
  if (/\b(search|filter|find|query)\b/.test(taskLower))
    return ['no results', 'partial matches', 'case sensitivity'];
  if (/\b(validate|check|verify)\b/.test(taskLower))
    return ['valid input', 'boundary values', 'missing fields', 'wrong types'];
  if (/\b(read|write|file|stream)\b/.test(taskLower))
    return ['file not found', 'permission denied', 'empty file', 'large input'];
  return ['empty input', 'null values', 'invalid types'];
}

function buildRequirements(d: DecomposedPrompt, intent: Intent, scores: Scores): string[] {
  const reqs: string[] = [];

  // Existing constraints first
  d.constraints.forEach((c) => reqs.push(c));

  // Synthesize missing requirements based on what's weak
  if (scores.constraints < 4 && d.constraints.length === 0) {
    const taskLower = d.task.toLowerCase();

    // Intent-specific constraints with task-aware edge cases
    switch (intent) {
      case 'code': {
        // Task-specific edge cases instead of generic boilerplate
        const edgeCases = inferCodeEdgeCases(taskLower);
        reqs.push(`Handle: ${edgeCases.join(', ')}`);
        reqs.push('Include error handling for expected failure modes');
        if (d.technologies.length > 0) {
          reqs.push(`Follow ${d.technologies.join(', ')} idiomatic patterns`);
        }
        break;
      }
      case 'extraction':
        reqs.push('Return all matches, not just the first');
        reqs.push('Handle missing or malformed data gracefully');
        break;
      case 'analysis':
        reqs.push('Support claims with specific evidence');
        reqs.push('Consider alternative explanations');
        break;
      case 'creative':
        reqs.push('Maintain consistent tone throughout');
        reqs.push('Consider the intended audience and adjust register accordingly');
        reqs.push('Use a clear form or structure appropriate to the genre');
        break;
      case 'system':
        reqs.push('Define what the assistant should and should not do');
        reqs.push('Define the scope of knowledge and authority');
        break;
    }
  }

  // Add scope boundary if missing
  if (
    scores.constraints < 4 &&
    !d.constraints.some((c) => /\b(only|focus|scope|limited)\b/i.test(c))
  ) {
    switch (intent) {
      case 'code':
        reqs.push('Focus only on the requested functionality — do not add extra features');
        break;
      case 'analysis':
        reqs.push('Focus your analysis on the specific question asked');
        break;
    }
  }

  return reqs;
}

// --- Example generation ---

function buildExamples(d: DecomposedPrompt, intent: Intent): string {
  // If user already has examples, preserve them
  if (d.existingExamples.length > 0) {
    return d.existingExamples.join('\n');
  }

  // Extract key nouns from the task for more specific placeholders
  const taskNouns = extractTaskNouns(d.task);
  const inputHint = taskNouns.length > 0 ? `Sample ${taskNouns[0]} to process` : 'Sample input';
  const outputHint =
    taskNouns.length > 0 ? `Expected result for the ${taskNouns[0]}` : 'Expected output';

  switch (intent) {
    case 'code':
      return [
        '<example>',
        `<input>${inputHint}</input>`,
        `<output>${outputHint}</output>`,
        '</example>',
      ].join('\n');
    case 'extraction':
      return [
        '<example>',
        `<input>${inputHint}</input>`,
        `<output>${outputHint} in structured format</output>`,
        '</example>',
      ].join('\n');
    case 'analysis':
      return [
        '<example>',
        `<input>${inputHint}</input>`,
        '<output>Findings, evidence, recommendations</output>',
        '</example>',
      ].join('\n');
    default:
      return [
        '<example>',
        `<input>${inputHint}</input>`,
        `<output>${outputHint}</output>`,
        '</example>',
      ].join('\n');
  }
}

/** Extract key nouns from a task description for example scaffolding. */
function extractTaskNouns(task: string): string[] {
  // Match "sort users", "parse CSV", "validate emails" → ["users", "CSV", "emails"]
  const objectMatch = task.match(
    /\b(?:sort|parse|validate|extract|filter|transform|convert|create|build|generate|analyze|review|process|handle)\s+((?:the|a|an|all|each)\s+)?(\w+)/i,
  );
  if (objectMatch?.[2]) return [objectMatch[2]];

  // Match noun after preposition: "function for users", "endpoint for orders"
  const prepMatch = task.match(/\b(?:for|of|from|with)\s+((?:the|a|an)\s+)?(\w+)/i);
  if (prepMatch?.[2]) return [prepMatch[2]];

  return [];
}

// --- Output format inference ---

function inferOutputFormat(d: DecomposedPrompt, intent: Intent): string {
  // If user already specified format hints, amplify them
  if (d.formatHints.length > 0) {
    return d.formatHints.join('\n');
  }

  // Infer from intent
  switch (intent) {
    case 'code':
      return [
        'Respond with:',
        '1. A brief explanation of the approach (2-3 sentences)',
        '2. The complete implementation in a fenced code block',
        '3. Usage example showing how to call the code',
      ].join('\n');
    case 'extraction':
      return [
        'Respond with the extracted data in JSON format:',
        '```json',
        '{',
        '  "items": [',
        '    { "field": "value" }',
        '  ],',
        '  "count": 0',
        '}',
        '```',
      ].join('\n');
    case 'analysis':
      return [
        'Structure your analysis as:',
        '1. **Summary** (2-3 sentences)',
        '2. **Key Findings** (bullet points with evidence)',
        '3. **Recommendations** (prioritized, actionable)',
      ].join('\n');
    case 'creative':
      return [
        'Respond with the creative content directly, no preamble or meta-commentary.',
        'Open strong — the first line should hook the reader.',
        'End with intention — the closing should feel deliberate, not trailing off.',
      ].join('\n');
    case 'system':
      return [
        'Structure the system prompt with clear sections:',
        '- Role definition',
        '- Core instructions',
        '- Constraints and boundaries',
        '- Response format guidelines',
      ].join('\n');
    default:
      return 'Be concise and direct. Structure with headers and bullet points for readability.';
  }
}

// --- Step inference for prompt chaining ---

function inferSteps(task: string, intent: Intent): string[] {
  // Strip code blocks before step matching to avoid extracting garbage like `) => {\n  const`
  const taskWithoutCode = task.replace(/```[\s\S]*?```/g, '[code]');

  // Try to extract explicit steps from the task text
  const stepMatches = taskWithoutCode.match(
    /\b(first|then|next|after\s+that|finally|second|third)\b[^.!?]*/gi,
  );
  if (stepMatches && stepMatches.length >= 2) {
    return stepMatches.map((s) =>
      s.trim().replace(/^(first|then|next|after\s+that|finally|second|third),?\s*/i, ''),
    );
  }

  // Generate intent-appropriate steps
  switch (intent) {
    case 'code':
      return [
        'Understand the requirements and identify edge cases',
        'Design the interface (function signature, types, return value)',
        'Implement the core logic',
        'Add error handling and edge case coverage',
      ];
    case 'analysis':
      return [
        'Gather and organize the relevant information',
        'Identify patterns, anomalies, or key findings',
        'Evaluate evidence and consider alternatives',
        'Synthesize conclusions and actionable recommendations',
      ];
    case 'extraction':
      return [
        'Parse the source data and identify the structure',
        'Extract all matching elements',
        'Validate and normalize the extracted data',
        'Format the output according to the specified schema',
      ];
    default:
      return [
        'Analyze the requirements',
        'Plan the approach',
        'Execute the main work',
        'Review and refine the output',
      ];
  }
}

// --- Role inference ---

function inferRole(intent: Intent, task: string, technologies: string[]): string {
  // Build a specific role from technologies + domain
  if (technologies.length > 0) {
    const techStr = technologies.slice(0, 3).join('/');

    // Check for domain patterns
    if (/\b(security|auth(entication|orization)?|vulnerability|owasp|xss|injection)\b/i.test(task))
      return `a senior security engineer specializing in ${techStr}`;
    if (/\b(devops|ci\/cd|deploy|pipeline|infrastructure)\b/i.test(task))
      return `a senior DevOps engineer with deep ${techStr} expertise`;
    if (/\b(test|spec|coverage|assertion|e2e|unit\s+test)\b/i.test(task))
      return `a senior QA engineer experienced with ${techStr} testing`;
    if (/\b(performance|optimize|latency|throughput|memory)\b/i.test(task))
      return `a senior performance engineer specializing in ${techStr}`;
    if (/\b(database|schema|migration|query|index)\b/i.test(task))
      return `a senior database engineer with ${techStr} expertise`;
    if (/\b(api|endpoint|route|controller|middleware)\b/i.test(task))
      return `a senior backend engineer building ${techStr} APIs`;
    if (/\b(component|ui|ux|layout|style|css)\b/i.test(task))
      return `a senior frontend engineer building with ${techStr}`;
    if (/\b(ml|machine\s+learning|model|training|inference|neural)\b/i.test(task))
      return `a senior ML engineer with ${techStr} expertise`;
    if (/\b(data\s+(pipeline|engineering|warehouse)|etl|spark|airflow)\b/i.test(task))
      return `a senior data engineer with ${techStr} expertise`;
    if (/\b(observability|monitoring|logging|tracing|metrics|alert)\b/i.test(task))
      return `a senior observability engineer with ${techStr} expertise`;
    if (/\b(mobile|ios|android|react\s+native|flutter)\b/i.test(task))
      return `a senior mobile engineer building with ${techStr}`;
    if (/\b(accessibility|a11y|aria|screen\s+reader|wcag)\b/i.test(task))
      return `a senior accessibility engineer with ${techStr} expertise`;

    return `a senior ${techStr} engineer`;
  }

  // Fall back to intent-based roles with more specificity
  switch (intent) {
    case 'code':
      return 'a senior software engineer who writes clean, well-tested, production-ready code';
    case 'analysis':
      return 'a senior technical analyst who provides evidence-based assessments with concrete recommendations';
    case 'extraction':
      return 'a data extraction specialist focused on accuracy, completeness, and structured output';
    case 'creative':
      return 'an experienced writer with a strong command of voice, structure, and audience awareness';
    case 'system':
      return 'a prompt engineer who designs clear, effective, well-bounded system prompts';
    case 'conversation':
      return 'a knowledgeable and direct conversational partner';
    default:
      return 'a senior technical specialist';
  }
}

// --- Prefill inference ---

function inferPrefill(intent: Intent, d: DecomposedPrompt): string {
  switch (intent) {
    case 'code':
      if (d.technologies.includes('typescript') || d.technologies.includes('javascript'))
        return '```typescript\\n';
      if (d.technologies.includes('python')) return '```python\\n';
      if (d.technologies.includes('rust')) return '```rust\\n';
      return '```\\n';
    case 'extraction':
      return '{\\n  "';
    case 'analysis':
      return '## Summary\\n\\n';
    default:
      return '';
  }
}

// --- Summary builder ---

function buildSummary(techniques: Technique[], issueCount: number): string {
  if (techniques.length === 0) {
    return issueCount > 0
      ? `Found ${issueCount} issues to address`
      : 'No significant improvements identified';
  }

  const phrases = techniques.map((t) => t.action_phrase);
  const first = phrases[0]!;
  const capitalized = first.charAt(0).toUpperCase() + first.slice(1);
  return [capitalized, ...phrases.slice(1)].join(', ');
}

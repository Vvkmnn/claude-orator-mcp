/**
 * 11 Anthropic prompt engineering techniques as structured data.
 * Each technique has auto-selection rules, a structural template, and an action phrase
 * for the notification summary line.
 *
 * Source: Anthropic's official prompt engineering documentation.
 */

import type { Complexity, Intent, Scores } from '../types.js';

export interface Technique {
  id: string;
  name: string;
  description: string;
  action_phrase: string;
  when_to_use: (ctx: TechniqueContext) => boolean;
  template: string;
  doc_url: string;
  /** Prevalence data from 34-tool industry analysis */
  industry_note?: string;
}

export interface TechniqueContext {
  intent: Intent;
  scores: Scores;
  prompt: string;
  complexity: Complexity;
}

/** Detects if prompt contains multiple distinct subtasks. */
function hasMultipleSubtasks(prompt: string): boolean {
  const stepIndicators =
    /\b(first|second|third|then|next|finally|step\s+\d|after\s+that|once\s+done)\b/gi;
  const matches = prompt.match(stepIndicators);
  return (matches?.length ?? 0) >= 2;
}

export const TECHNIQUES: Technique[] = [
  {
    id: 'chain-of-thought',
    name: 'Let Claude Think',
    description:
      'Encourage step-by-step reasoning before answering. Improves accuracy on complex, multi-step problems.',
    action_phrase: 'added step-by-step reasoning',
    when_to_use: ({ intent, scores, complexity, prompt }) =>
      intent === 'analysis' ||
      complexity === 'complex' ||
      (scores.clarity < 5 && hasMultipleSubtasks(prompt)),
    template: `Think step-by-step, then answer.

<task>
{PROMPT}
</task>`,
    doc_url:
      'https://docs.anthropic.com/en/docs/build-with-claude/prompt-engineering/chain-of-thought',
    industry_note:
      '35% of production tools include explicit thinking structures. Devin mandates <think> in 10 situations. Bolt requires 2-4 line outlines before coding.',
  },

  {
    id: 'xml-tags',
    name: 'Use XML Tags',
    description:
      'Structure complex prompts with XML tags for clear section separation. Claude naturally respects XML boundaries.',
    action_phrase: 'wrapped in XML tags',
    when_to_use: ({ prompt, scores }) => prompt.length > 200 && scores.structure < 4,
    template: `<task>
{TASK_DESCRIPTION}
</task>

<requirements>
{REQUIREMENTS}
</requirements>

<context>
{CONTEXT}
</context>`,
    doc_url: 'https://docs.anthropic.com/en/docs/build-with-claude/prompt-engineering/use-xml-tags',
    industry_note:
      '~70% of 34 production tools use XML sections. Common names: system_constraints, tool_calling, making_code_changes, communication, debugging, planning.',
  },

  {
    id: 'few-shot',
    name: 'Multishot Examples',
    description:
      'Provide input/output example pairs to demonstrate expected behavior. Critical for extraction and code generation.',
    action_phrase: 'added examples',
    when_to_use: ({ intent, scores }) =>
      scores.examples < 3 && (intent === 'extraction' || intent === 'code'),
    template: `{PROMPT}

<examples>
<example>
<input>{EXAMPLE_INPUT}</input>
<output>{EXAMPLE_OUTPUT}</output>
</example>
</examples>`,
    doc_url:
      'https://docs.anthropic.com/en/docs/build-with-claude/prompt-engineering/multishot-prompting',
    industry_note:
      '~50% use labeled good/bad example pairs. Cursor has 12+ contrastive pairs for code citation. Gemini uses anti-examples to prevent hallucination.',
  },

  {
    id: 'role-assignment',
    name: 'System Prompts & Roles',
    description:
      'Assign an expert role to focus Claude on domain-specific knowledge and conventions.',
    action_phrase: 'assigned expert role',
    when_to_use: ({ intent, scores, prompt }): boolean => {
      // Don't add a role if the prompt already starts with one
      if (/^you\s+are\b/i.test(prompt.trim())) return false;
      return intent === 'system' || scores.specificity < 4;
    },
    template: `You are an expert {ROLE} with deep knowledge of {DOMAIN}.

{PROMPT}`,
    doc_url:
      'https://docs.anthropic.com/en/docs/build-with-claude/prompt-engineering/system-prompts',
    industry_note:
      "100% of 34 tools use direct 'You are X'. ~60% use compound roles (name + expertise + domains). Average role: 20-30 words. Zero use 'pretend' or 'act as'.",
  },

  {
    id: 'structured-output',
    name: 'Control Output Format',
    description:
      'Explicitly specify the desired output format to get consistent, machine-parseable responses.',
    action_phrase: 'specified output format',
    when_to_use: ({ scores }) => scores.output_format < 4,
    template: `{PROMPT}

Respond in the following format:
{FORMAT_SPECIFICATION}`,
    doc_url:
      'https://docs.anthropic.com/en/docs/build-with-claude/prompt-engineering/be-clear-and-direct',
    industry_note:
      'Every production prompt specifies output expectations. Replit uses 7 XML output schemas. Cluely enforces headline-first pyramid format.',
  },

  {
    id: 'prefill',
    name: 'Structured Output Format',
    description:
      'Suggest a structured output format to guide response shape. For pre-4.6 API targets, this was response prefill; for 4.6+, use structured output schemas instead.',
    action_phrase: 'suggested structured output format',
    when_to_use: ({ intent, scores }) =>
      // Target check happens in selector — here we just check intent/scores
      scores.output_format < 5 && (intent === 'extraction' || intent === 'code'),
    template: `{PROMPT}

Begin your response with: {PREFILL_START}`,
    doc_url:
      'https://docs.anthropic.com/en/docs/build-with-claude/prompt-engineering/prefill-claudes-response',
  },

  {
    id: 'prompt-chaining',
    name: 'Chain Complex Tasks',
    description:
      'Break a complex task into sequential subtasks where each step builds on the previous output.',
    action_phrase: 'broke into subtask chain',
    when_to_use: ({ complexity, prompt }) =>
      (complexity === 'complex' || complexity === 'moderate') && hasMultipleSubtasks(prompt),
    template: `{PROMPT}

Sequential steps:
1. {FIRST_SUBTASK}
2. Using output from step 1, {SECOND_SUBTASK}
3. Using output from step 2, {THIRD_SUBTASK}`,
    doc_url:
      'https://docs.anthropic.com/en/docs/build-with-claude/prompt-engineering/chain-prompts',
    industry_note:
      "Amp delegates hard sub-problems to a separate 'oracle' model. Kiro uses a three-prompt classifier architecture for routing.",
  },

  {
    id: 'uncertainty-permission',
    name: 'Say "I Don\'t Know"',
    description:
      'Explicitly give Claude permission to express uncertainty. Reduces hallucination on factual tasks.',
    action_phrase: 'allowed uncertainty',
    when_to_use: ({ intent }) => intent === 'analysis' || intent === 'extraction',
    template: `{PROMPT}

If unsure about any claim, say so explicitly rather than guessing.`,
    doc_url:
      'https://docs.anthropic.com/en/docs/build-with-claude/prompt-engineering/be-clear-and-direct',
  },

  {
    id: 'extended-thinking',
    name: 'Extended Thinking',
    description:
      'Enable deep reasoning for complex analysis and code tasks. Claude uses internal reasoning before responding.',
    action_phrase: 'enabled extended thinking',
    when_to_use: ({ complexity, intent }) =>
      complexity === 'complex' && (intent === 'analysis' || intent === 'code'),
    template: `This problem requires careful, thorough reasoning.

{PROMPT}`,
    doc_url: 'https://docs.anthropic.com/en/docs/build-with-claude/extended-thinking',
  },

  {
    id: 'long-context-tips',
    name: 'Long Context Optimization',
    description:
      "Structure long prompts with key instructions at top and bottom (sandwich pattern) for Claude's attention.",
    action_phrase: 'applied long-context structure',
    when_to_use: ({ prompt }) => prompt.length > 2000 || prompt.split('\n').length > 50,
    template: `{KEY_INSTRUCTION}

<documents>
{PROMPT}
</documents>

Remember: {KEY_INSTRUCTION}`,
    doc_url:
      'https://docs.anthropic.com/en/docs/build-with-claude/prompt-engineering/long-context-tips',
    industry_note:
      '~30% use sandwich pattern (key instruction at top + bottom). Claude Code, Lovable, Bolt, Augment all repeat critical rules.',
  },

  {
    id: 'tool-use',
    name: 'Tool Use Guidelines',
    description:
      'Add tool-use best practices for prompts involving function calling, MCP tools, or API integrations.',
    action_phrase: 'added tool-use guidance',
    when_to_use: ({ prompt }) =>
      /\b(tool|function\s+call|mcp|invoke|api\s+call)\b/i.test(prompt) &&
      /\b(use|call|invoke|execute|run|trigger)\b/i.test(prompt),
    template: `{PROMPT}

When using tools:
- Verify required parameters before calling
- Handle tool errors gracefully
- Prefer specific tools over general ones`,
    doc_url: 'https://docs.anthropic.com/en/docs/build-with-claude/tool-use/overview',
    industry_note:
      "Cursor requires an 'explanation' parameter on most tools. 40% of tools require justifying each tool call.",
  },
];

/** Lookup technique by ID. */
export function getTechnique(id: string): Technique | undefined {
  return TECHNIQUES.find((t) => t.id === id);
}

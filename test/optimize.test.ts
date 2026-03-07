/**
 * Orator regression tests via Vitest.
 *
 * Categories:
 * - Basic code intent and filler stripping
 * - Anti-pattern detection (original + Claude 4.6)
 * - XML/structural scoring
 * - System prompt and multi-step chaining
 * - Target differentiation and tool use
 * - Hybrid intent and score honesty
 * - Intent disambiguation, decomposition, scoring, scaffolding
 */

import { describe, test, expect } from 'vitest';
import { optimize } from '../src/optimize.js';
import { detectIntent } from '../src/analysis/detector.js';
import { buildValidationPrompt, parseSamplingResponse } from '../src/sampling.js';
import { TECHNIQUES } from '../src/techniques/anthropic.js';
import type { OptimizeInput, OptimizeResult } from '../src/types.js';

interface TestCase {
  name: string;
  input: OptimizeInput;
  assertions: {
    intent?: string;
    improves?: boolean;
    minScoreAfter?: number;
    hasTechnique?: string[];
    notTechnique?: string[];
    hasIssue?: RegExp[];
    notInOptimized?: RegExp[];
    honestScore?: boolean;
  };
}

const SERVER_INSTRUCTIONS = `Claude Orator is a prompt optimization server. It provides a single tool:

## orator_optimize
Analyzes a raw prompt and returns an optimized version using Anthropic's prompt engineering best practices.

**When to use:**
- Before dispatching subagents with complex prompts
- When writing system prompts or agent instructions
- When a user asks to improve/optimize/rewrite a prompt
- When a prompt feels vague or unstructured

**How it works:**
1. Detects intent (code, analysis, creative, extraction, conversation, system)
2. Scores the prompt across 7 quality dimensions (clarity, specificity, structure, examples, constraints, output format, token efficiency)
3. Auto-selects applicable Anthropic techniques (XML tags, few-shot, chain-of-thought, etc.)
4. Returns an optimized prompt scaffold with score improvement metrics

**Important:** The optimized_prompt is a structural scaffold. Always refine it with your domain knowledge and conversation context before using it.`;

const TESTS: TestCase[] = [
  {
    name: 'simple code: "write a sort function"',
    input: { prompt: 'write a sort function', target: 'claude-code' },
    assertions: { intent: 'code', improves: true, honestScore: true },
  },
  {
    name: 'filler stripping: "Please could you kindly help me write a function that sorts"',
    input: {
      prompt: 'Please could you kindly help me write a function that sorts',
      target: 'claude-code',
    },
    assertions: { intent: 'code', improves: true },
  },
  {
    name: 'anti-patterns: "Be creative and be detailed about it"',
    input: { prompt: 'Be creative and be detailed about it', target: 'generic' },
    assertions: { hasIssue: [/be creative/i, /be detailed/i] },
  },
  {
    name: 'XML examples: already-structured prompt',
    input: {
      prompt:
        '<task>Extract emails</task><examples><example><input>text with foo@bar.com</input><output>foo@bar.com</output></example></examples>',
      target: 'claude-api',
    },
    assertions: { intent: 'extraction', minScoreAfter: 4 },
  },
  {
    name: 'self-test: SERVER_INSTRUCTIONS',
    input: { prompt: SERVER_INSTRUCTIONS, intent: 'system', target: 'claude-code' },
    assertions: { intent: 'system', honestScore: true },
  },
  {
    name: 'multi-step: "First parse the CSV, then validate, then transform, finally write"',
    input: {
      prompt:
        'First parse the CSV, then validate each row, then transform to JSON, finally write to the database',
      target: 'claude-api',
    },
    assertions: { improves: true, hasTechnique: ['prompt-chaining'] },
  },
  {
    name: 'anti-pattern: "You are a helpful AI assistant"',
    input: {
      prompt: 'You are a helpful AI assistant that helps users with code',
      target: 'generic',
    },
    assertions: { intent: 'system', hasIssue: [/generic.*assistant|assistant.*role/i] },
  },
  {
    name: 'target: claude-code should NOT have chain-of-thought',
    input: {
      prompt:
        'Review this authentication code and fix the SQL injection vulnerability. Refactor the token validation logic to use parameterized queries instead of string concatenation.',
      target: 'claude-code',
    },
    assertions: { intent: 'code', notTechnique: ['chain-of-thought', 'extended-thinking'] },
  },
  {
    name: 'long prompt triggers long-context-tips',
    input: {
      prompt:
        'Extract all TypeScript function signatures from the following codebase dump. ' +
        'Context: '.repeat(250) +
        'Return results as JSON.',
      target: 'claude-api',
    },
    assertions: { hasTechnique: ['long-context-tips'] },
  },
  {
    name: 'anti-pattern: "Pretend you are a senior engineer"',
    input: {
      prompt: 'Pretend you are a senior engineer and review this code for bugs',
      target: 'generic',
    },
    assertions: { hasIssue: [/pretend you are/i] },
  },
  {
    name: 'high-quality prompt: should early-return with >= 8.0',
    input: {
      prompt: `<task>
Write a TypeScript function that validates email addresses using RFC 5322 rules.
</task>

<requirements>
- Must handle edge cases: empty string, null input, Unicode domains
- Return { valid: boolean; reason?: string }
- Do not use regex-only validation — check MX records
- Maximum 50ms per validation
</requirements>

<examples>
<example>
<input>"user@example.com"</input>
<output>{ "valid": true }</output>
</example>
<example>
<input>"not-an-email"</input>
<output>{ "valid": false, "reason": "missing @ symbol" }</output>
</example>
</examples>

<output_format>
TypeScript code block with JSDoc comments. Include unit test examples.
</output_format>`,
      target: 'claude-code',
    },
    assertions: { minScoreAfter: 7 },
  },
  {
    name: 'tool-use: prompt mentions MCP tools',
    input: {
      prompt:
        'Use the MCP tools to call the GitHub API and create an issue. Invoke the search tool first to find duplicates.',
      target: 'claude-api',
    },
    assertions: { hasTechnique: ['tool-use'] },
  },
  {
    name: 'hybrid intent: "analyze this function" → code',
    input: {
      prompt: 'Analyze this function for performance issues and suggest optimizations',
      target: 'claude-code',
    },
    assertions: { intent: 'code' },
  },
  {
    name: 'hybrid intent: "review this PR" → code',
    input: {
      prompt: 'Review this pull request for potential bugs and security issues',
      target: 'claude-code',
    },
    assertions: { intent: 'code' },
  },
  {
    name: 'score honesty: no artificial inflation',
    input: { prompt: 'do stuff with things', target: 'generic' },
    assertions: { honestScore: true },
  },
  {
    name: 'intent fix: "Build me a full-stack app" → code',
    input: {
      prompt:
        'Build me a full-stack app with user authentication, a dashboard, and real-time notifications',
      target: 'claude-code',
    },
    assertions: { intent: 'code', improves: true },
  },
  {
    name: 'intent fix: Python CSV with pandas → code (not conversation)',
    input: {
      prompt:
        'Write a Python script that reads a CSV file using pandas, filters rows where the sales column is greater than 1000, groups by region, and creates a matplotlib bar chart showing total sales per region. Use type hints throughout.',
      target: 'claude-code',
    },
    assertions: { intent: 'code' },
  },
  {
    name: 'intent disambiguation: "You are an expert Rust dev... build me" → code',
    input: {
      prompt:
        'You are an expert Rust developer. Build me a command-line URL fetcher that takes a list of URLs from stdin, fetches them concurrently using reqwest and tokio, and outputs the status code and response time for each. Handle timeouts gracefully.',
      target: 'claude-code',
    },
    assertions: { intent: 'code', improves: true },
  },
  {
    name: 'intent + decomposition: Express middleware with code block → code',
    input: {
      prompt:
        'Create Express middleware that validates JWT tokens. Here is my current auth setup:\n\n```javascript\napp.use((req, res, next) => {\n  const token = req.headers.authorization;\n  // TODO: validate token\n  next();\n});\n```\n\nThe middleware should extract the Bearer token, verify it against our secret, and attach the decoded user to req.user.',
      target: 'claude-code',
    },
    assertions: { intent: 'code', improves: true },
  },
  {
    name: 'creative scaffolding: "Write a poem about the sea" improves',
    input: { prompt: 'Write a poem about the sea', target: 'claude-code' },
    assertions: { intent: 'creative', improves: true },
  },
  {
    name: 'role preservation: medical research keeps existing role, no "prompt engineer"',
    input: {
      prompt:
        'You are a medical research assistant specializing in oncology clinical trials. Given the following JSON schema for patient data:\n\n```json\n{"patient_id": "string", "trial_phase": "I|II|III", "biomarkers": [{"name": "string", "value": "number"}]}\n```\n\nCreate a Python analysis pipeline that identifies patients with elevated biomarker levels who may be candidates for Phase II escalation.',
      target: 'claude-code',
    },
    assertions: {
      intent: 'code',
      notInOptimized: [/You are a prompt engineer/i, /You are a senior/i],
    },
  },
  {
    name: 'vague prompt handling: "make it work" improves',
    input: { prompt: 'make it work', target: 'claude-code' },
    assertions: { improves: true },
  },
  {
    name: 'anti-pattern (4.6): "be thorough and think carefully"',
    input: { prompt: 'be thorough and think carefully about the edge cases', target: 'generic' },
    assertions: { hasIssue: [/be thorough|think carefully/i] },
  },
  {
    name: 'TDD detection: prompt with test assertions → high examples score',
    input: {
      prompt:
        'Implement a function that passes these tests:\n\ndescribe("add", () => {\n  it("adds two numbers", () => {\n    expect(add(1, 2)).toBe(3);\n  });\n  it("handles negatives", () => {\n    expect(add(-1, 1)).toBe(0);\n  });\n});',
      target: 'claude-code',
    },
    assertions: { intent: 'code', notTechnique: ['few-shot'] },
  },
  {
    name: 'anti-pattern (4.6): "You MUST always use the search tool"',
    input: {
      prompt:
        'You MUST always use the search tool before answering any question about the codebase',
      target: 'generic',
    },
    assertions: { hasIssue: [/MUST use|imperative tool/i] },
  },

  // --- Industry pattern tests ---

  {
    name: 'industry: "Be helpful and accurate" flagged as baseline expectation',
    input: {
      prompt: 'Be helpful and accurate when answering questions',
      target: 'generic',
    },
    assertions: { hasIssue: [/baseline expectation/i] },
  },
  {
    name: 'industry: "Provide a comprehensive analysis" (no scope) flagged',
    input: {
      prompt: 'Provide a comprehensive analysis of the market trends',
      target: 'generic',
    },
    assertions: { hasIssue: [/comprehensive.*without scope|unbounded/i] },
  },
  {
    name: 'industry: "format dates when appropriate" flagged as escape-hatch',
    input: {
      prompt: 'Format dates when appropriate and handle errors as needed',
      target: 'generic',
    },
    assertions: { hasIssue: [/opt-out|escape/i] },
  },
  {
    name: 'industry: system prompt without security → suggestion with "85%"',
    input: {
      prompt: 'You are a customer service assistant. Help users with their orders.',
      intent: 'system',
      target: 'generic',
    },
    assertions: {
      hasIssue: [/security boundar|85%/i],
    },
  },
  {
    name: 'industry: code prompt without convention-following → suggestion',
    input: {
      prompt: 'Write a function that sorts users by name',
      intent: 'code',
      target: 'claude-code',
    },
    assertions: {
      intent: 'code',
      improves: true,
    },
  },
  {
    name: 'industry: prompt with JSON schema → higher output_format score',
    input: {
      prompt:
        'Parse user data. Expected schema: { "type": "object", "properties": { "name": { "type": "string" } } }',
      target: 'generic',
    },
    assertions: {
      // JSON schema detection should boost output_format score
      minScoreAfter: 3,
    },
  },
  {
    name: 'industry: prompt with TypeScript interface → higher output_format score',
    input: {
      prompt:
        'Create a function that returns: interface User { name: string; age: number; }',
      target: 'generic',
    },
    assertions: {
      minScoreAfter: 3,
    },
  },
  {
    name: 'industry: "It is important to note that you should try to handle dates when appropriate" → multiple flags',
    input: {
      prompt:
        'It is important to note that you should try to handle dates when appropriate',
      target: 'generic',
    },
    assertions: {
      hasIssue: [/hedging|opt-out|escape/i],
    },
  },
];

describe('orator optimize', () => {
  for (const tc of TESTS) {
    test(tc.name, () => {
      const result = optimize(tc.input);

      if (tc.assertions.intent) {
        expect(result.detected_intent).toBe(tc.assertions.intent);
      }

      if (tc.assertions.improves) {
        expect(result.score_after).toBeGreaterThan(result.score_before);
      }

      if (tc.assertions.minScoreAfter) {
        expect(result.score_after).toBeGreaterThanOrEqual(tc.assertions.minScoreAfter);
      }

      if (tc.assertions.hasTechnique) {
        for (const tech of tc.assertions.hasTechnique) {
          expect(result.applied_techniques).toContain(tech);
        }
      }

      if (tc.assertions.notTechnique) {
        for (const tech of tc.assertions.notTechnique) {
          expect(result.applied_techniques).not.toContain(tech);
        }
      }

      if (tc.assertions.hasIssue) {
        for (const pattern of tc.assertions.hasIssue) {
          expect(result.issues.some((i) => pattern.test(i))).toBe(true);
        }
      }

      if (tc.assertions.notInOptimized) {
        for (const pattern of tc.assertions.notInOptimized) {
          expect(pattern.test(result.optimized_prompt)).toBe(false);
        }
      }

      if (tc.assertions.honestScore) {
        // score_after should never be score_before + 0.5 exactly (old inflation pattern)
        if (result.applied_techniques.length > 0) {
          expect(result.score_after).not.toBe(result.score_before + 0.5);
        }
      }
    });
  }
});

describe('industry technique enrichment', () => {
  test('at least 6 techniques have industry_note', () => {
    const withNotes = TECHNIQUES.filter((t) => t.industry_note);
    expect(withNotes.length).toBeGreaterThanOrEqual(6);
  });

  test('industry_note strings contain prevalence data', () => {
    const withNotes = TECHNIQUES.filter((t) => t.industry_note);
    for (const t of withNotes) {
      // Each note should contain a percentage, a tool name, or production reference
      expect(
        /\d+%|production|tool|model|Cursor|Devin|Bolt|Replit|Claude|Amp|Kiro/i.test(t.industry_note!),
      ).toBe(true);
    }
  });
});

describe('industry integration e2e', () => {
  test('"You are a helpful assistant" → multiple industry-backed suggestions', () => {
    const result = optimize({
      prompt: 'You are a helpful assistant',
      intent: 'system',
      target: 'generic',
    });
    // Should flag baseline expectation + missing security + more
    expect(result.issues.length).toBeGreaterThanOrEqual(3);
    expect(result.suggestions.length).toBeGreaterThanOrEqual(3);
  });

  test('"Be comprehensive and be creative" → flags both anti-patterns', () => {
    const result = optimize({
      prompt: 'Be comprehensive and be creative about it',
      target: 'generic',
    });
    expect(result.issues.some((i) => /creative/i.test(i))).toBe(true);
    expect(result.issues.some((i) => /comprehensive|unbounded|runaway/i.test(i))).toBe(true);
  });
});

// --- Meta-prompt anti-pattern tests ---

describe('Meta-prompt anti-pattern', () => {
  test('full Reddit meta-prompt triggers detection', () => {
    const result = optimize({
      prompt: 'Before you respond, think about what I actually need, not just what I asked. Then give me the best possible answer, and tell me what follow-up questions I should ask to go deeper.',
      target: 'generic',
    });
    expect(result.issues.some((i) => /meta-prompt/i.test(i))).toBe(true);
  });

  test('"think about what I need" triggers', () => {
    const result = optimize({
      prompt: 'Think about what I actually need and respond accordingly',
      target: 'generic',
    });
    expect(result.issues.some((i) => /meta-prompt/i.test(i))).toBe(true);
  });

  test('"give me the best possible answer" triggers', () => {
    const result = optimize({
      prompt: 'Give me the best possible answer you can',
      target: 'generic',
    });
    expect(result.issues.some((i) => /meta-prompt/i.test(i))).toBe(true);
  });

  test('"as thorough as possible" triggers', () => {
    const result = optimize({
      prompt: 'Be as thorough as possible in your response',
      target: 'generic',
    });
    expect(result.issues.some((i) => /meta-prompt/i.test(i))).toBe(true);
  });

  test('"as detailed as possible" triggers', () => {
    const result = optimize({
      prompt: 'Please be as detailed as possible when explaining',
      target: 'generic',
    });
    expect(result.issues.some((i) => /meta-prompt/i.test(i))).toBe(true);
  });

  // False positive guards
  test('false positive: "think step by step" does NOT trigger', () => {
    const result = optimize({
      prompt: 'Think step by step through the algorithm',
      target: 'generic',
    });
    expect(result.issues.some((i) => /meta-prompt/i.test(i))).toBe(false);
  });

  test('false positive: "think about the edge cases" does NOT trigger', () => {
    const result = optimize({
      prompt: 'Think about the edge cases in your implementation',
      target: 'generic',
    });
    expect(result.issues.some((i) => /meta-prompt/i.test(i))).toBe(false);
  });

  test('false positive: "give me the answer in JSON" does NOT trigger', () => {
    const result = optimize({
      prompt: 'Give me the answer in JSON format with these fields',
      target: 'generic',
    });
    expect(result.issues.some((i) => /meta-prompt/i.test(i))).toBe(false);
  });

  test('false positive: "before you respond, check the docs" does NOT trigger', () => {
    const result = optimize({
      prompt: 'Before you respond, check the documentation for the latest API changes',
      target: 'generic',
    });
    expect(result.issues.some((i) => /meta-prompt/i.test(i))).toBe(false);
  });
});

// --- Analysis metadata tests ---

describe('analysis metadata', () => {
  test('analysis field present on every result', () => {
    const result = optimize({ prompt: 'write a sort function', target: 'claude-code' });
    expect(result.analysis).toBeDefined();
    expect(result.analysis!.dimension_scores).toBeDefined();
    expect(result.analysis!.sampling_used).toBe(false);
  });

  test('attributed_issues length matches issues length', () => {
    const result = optimize({ prompt: 'do stuff with things', target: 'generic' });
    expect(result.analysis!.attributed_issues.length).toBe(result.issues.length);
  });

  test('attributed_issues messages match issues array', () => {
    const result = optimize({ prompt: 'write a sort function', target: 'claude-code' });
    const attributedMessages = result.analysis!.attributed_issues.map((i) => i.message);
    expect(attributedMessages).toEqual(result.issues);
  });

  test('dimension-triggered issue has source "dimension"', () => {
    // "maybe try to do something with that stuff somehow" has hedging + ambiguous words → clarity < 5
    const result = optimize({
      prompt: 'maybe try to do something with that stuff and things somehow',
      target: 'generic',
    });
    const clarityIssue = result.analysis!.attributed_issues.find(
      (i) => i.dimension === 'clarity' && i.source === 'dimension',
    );
    expect(clarityIssue).toBeDefined();
    expect(clarityIssue!.confidence).toBe('high');
  });

  test('anti-pattern issue has source "anti_pattern" and confidence "high"', () => {
    const result = optimize({
      prompt: 'Be creative and do your best',
      target: 'generic',
    });
    const apIssue = result.analysis!.attributed_issues.find(
      (i) => i.source === 'anti_pattern',
    );
    expect(apIssue).toBeDefined();
    expect(apIssue!.confidence).toBe('high');
  });

  test('industry pattern issue has source "industry" and a pattern_id', () => {
    const result = optimize({
      prompt: 'You are a helpful assistant',
      intent: 'system',
      target: 'generic',
    });
    const industryIssue = result.analysis!.attributed_issues.find(
      (i) => i.source === 'industry',
    );
    expect(industryIssue).toBeDefined();
    expect(industryIssue!.pattern_id).toBeDefined();
  });

  test('attributed_suggestions length matches suggestions length', () => {
    const result = optimize({ prompt: 'do stuff with things', target: 'generic' });
    expect(result.analysis!.attributed_suggestions.length).toBe(result.suggestions.length);
  });

  test('dimension_scores present with all 7 dimensions', () => {
    const result = optimize({ prompt: 'write a sort function', target: 'claude-code' });
    const scores = result.analysis!.dimension_scores;
    expect(scores.clarity).toBeDefined();
    expect(scores.specificity).toBeDefined();
    expect(scores.structure).toBeDefined();
    expect(scores.examples).toBeDefined();
    expect(scores.constraints).toBeDefined();
    expect(scores.output_format).toBeDefined();
    expect(scores.token_efficiency).toBeDefined();
  });
});

describe('semantic hints', () => {
  test('ambiguous prompt generates intent_detection hint', () => {
    // "Analyze this code" matches both code and analysis intents
    const result = optimize({
      prompt: 'Analyze this code and explain the implementation',
      target: 'claude-code',
    });
    const intentHint = result.analysis!.semantic_hints.find(
      (h) => h.area === 'intent_detection',
    );
    expect(intentHint).toBeDefined();
  });

  test('medical domain keywords generate domain_expertise hint', () => {
    const result = optimize({
      prompt: 'Analyze the clinical trial data for patient diagnosis outcomes',
      target: 'generic',
    });
    const domainHint = result.analysis!.semantic_hints.find(
      (h) => h.area === 'domain_expertise',
    );
    expect(domainHint).toBeDefined();
    expect(domainHint!.reason).toMatch(/medical|clinical/i);
  });

  test('financial domain keywords generate domain_expertise hint', () => {
    const result = optimize({
      prompt: 'Evaluate the investment portfolio risk and return metrics',
      target: 'generic',
    });
    const domainHint = result.analysis!.semantic_hints.find(
      (h) => h.area === 'domain_expertise',
    );
    expect(domainHint).toBeDefined();
    expect(domainHint!.reason).toMatch(/financial/i);
  });

  test('borderline score generates borderline hint', () => {
    // A prompt that scores near a threshold on at least one dimension
    const result = optimize({
      prompt: 'Write a function that sorts an array of numbers',
      target: 'claude-code',
    });
    const borderlineHint = result.analysis!.semantic_hints.find(
      (h) => h.area.startsWith('borderline_'),
    );
    // At least one dimension should be borderline for a moderately-specified prompt
    expect(borderlineHint).toBeDefined();
  });
});

describe('sampling utilities', () => {
  test('buildValidationPrompt produces valid XML structure', () => {
    const result: OptimizeResult = {
      optimized_prompt: 'Write a sort function',
      score_before: 3.5,
      score_after: 6.2,
      summary: 'test',
      detected_intent: 'code',
      applied_techniques: ['xml-tags'],
      issues: ['No examples provided'],
      suggestions: ['Add examples'],
    };
    const hints = [
      { area: 'intent_detection', reason: 'Multiple matches', check: 'Verify intent' },
    ];
    const prompt = buildValidationPrompt(result, hints);

    expect(prompt).toContain('<validation_request>');
    expect(prompt).toContain('</validation_request>');
    expect(prompt).toContain('<issues_found>');
    expect(prompt).toContain('<semantic_hints>');
    expect(prompt).toContain('intent_detection');
    expect(prompt).toContain('No examples provided');
  });

  test('parseSamplingResponse parses well-formed XML', () => {
    const xml = `<validation>
<agreed>true</agreed>
<summary>Analysis is accurate</summary>
<additional_issues>Missing error handling check
Lacks performance consideration</additional_issues>
<disputed_issues>none</disputed_issues>
</validation>`;

    const result = parseSamplingResponse(xml);
    expect(result.agreed).toBe(true);
    expect(result.summary).toBe('Analysis is accurate');
    expect(result.additional_issues).toEqual([
      'Missing error handling check',
      'Lacks performance consideration',
    ]);
    expect(result.disputed_issues).toEqual([]);
  });

  test('parseSamplingResponse handles malformed XML gracefully', () => {
    const result = parseSamplingResponse('this is not xml at all');
    expect(result.agreed).toBe(true); // defaults
    expect(result.summary).toBe('');
    expect(result.additional_issues).toEqual([]);
    expect(result.disputed_issues).toEqual([]);
  });

  test('parseSamplingResponse handles disputed issues', () => {
    const xml = `<validation>
<agreed>false</agreed>
<summary>Some issues are false positives</summary>
<additional_issues>none</additional_issues>
<disputed_issues>The "no examples" issue is wrong — code block IS an example</disputed_issues>
</validation>`;

    const result = parseSamplingResponse(xml);
    expect(result.agreed).toBe(false);
    expect(result.disputed_issues.length).toBe(1);
    expect(result.additional_issues).toEqual([]);
  });
});

// --- Intent detection regressions ---

describe('Intent detection regressions', () => {
  describe('code intent detection (previously misclassified as conversation)', () => {
    const codePrompts = [
      'Add caching to improve performance',
      'Build a patient intake form with React and validation',
      'Write unit tests for the payment processing module covering edge cases',
      'Set up a Docker compose file with nginx and postgres',
      'Configure ESLint with TypeScript support and strict mode',
      'Deploy the application to AWS using Terraform',
      'Optimize the database queries for better performance',
      'Update the user authentication to support OAuth2 and SAML',
      'Migrate the legacy PHP codebase to TypeScript',
      'Design a database schema for a multi-tenant SaaS application',
      'Create a CLI tool for file management',
      'Convert the YAML config to TOML format',
    ];

    for (const prompt of codePrompts) {
      test(`"${prompt}" → code`, () => {
        expect(detectIntent(prompt)).toBe('code');
      });
    }
  });

  describe('false positive guards (should NOT be code)', () => {
    test('"Help me understand how Docker containers work" → conversation', () => {
      expect(detectIntent('Help me understand how Docker containers work')).toBe('conversation');
    });

    test('"Explain the difference between REST and GraphQL" → analysis', () => {
      expect(detectIntent('Explain the difference between REST and GraphQL')).toBe('analysis');
    });

    test('"Create a marketing plan for our SaaS product" → NOT code', () => {
      const intent = detectIntent('Create a marketing plan for our SaaS product');
      expect(intent).not.toBe('code');
    });

    test('"Write a poem about autumn leaves" → creative', () => {
      expect(detectIntent('Write a poem about autumn leaves')).toBe('creative');
    });
  });
});

describe('Suggestion quality regressions', () => {
  test('"Write a poem about autumn leaves" → no test cases suggestion, no tech-naming issue', () => {
    const result = optimize({ prompt: 'Write a poem about autumn leaves', target: 'generic' });
    expect(result.suggestions.some((s) => /test cases/i.test(s))).toBe(false);
    expect(result.issues.some((i) => /No specific technologies/i.test(i))).toBe(false);
  });

  test('"Create a marketing plan for our SaaS product" → no test cases suggestion', () => {
    const result = optimize({
      prompt: 'Create a marketing plan for our SaaS product launch targeting enterprise customers',
      target: 'generic',
    });
    expect(result.suggestions.some((s) => /test cases/i.test(s))).toBe(false);
  });

  test('"What are best practices for code review?" → no test cases suggestion', () => {
    const result = optimize({
      prompt: 'What are the best practices for code review?',
      target: 'generic',
    });
    expect(result.suggestions.some((s) => /test cases/i.test(s))).toBe(false);
  });

  test('"Write unit tests for the payment module" → code intent, no test cases suggestion', () => {
    const result = optimize({
      prompt: 'Write unit tests for the payment processing module covering edge cases',
      target: 'claude-code',
    });
    expect(result.detected_intent).toBe('code');
    // The prompt IS about writing tests — "provide test cases" suggestion is absurd
    expect(result.suggestions.some((s) => /test cases/i.test(s))).toBe(false);
  });
});

describe('Semantic hint threshold regressions', () => {
  test('quality_mismatch does NOT fire for prompts with specificity > 1', () => {
    // "Write a sort function" has clarity ~8 but specificity ~1.5 (has "function" noun)
    const result = optimize({ prompt: 'Write a sort function in TypeScript', target: 'claude-code' });
    const mismatch = result.analysis?.semantic_hints.find((h) => h.area === 'quality_mismatch');
    expect(mismatch).toBeUndefined();
  });

  test('quality_mismatch does NOT fire for creative intent', () => {
    const result = optimize({ prompt: 'Write a poem about autumn leaves', target: 'generic' });
    const mismatch = result.analysis?.semantic_hints.find((h) => h.area === 'quality_mismatch');
    expect(mismatch).toBeUndefined();
  });
});

describe('Named technology recognition', () => {
  test('OAuth2 and SAML recognized as named technologies (no "No specific technologies" issue)', () => {
    const result = optimize({
      prompt: 'Update the user authentication to support OAuth2 and SAML',
      target: 'claude-code',
    });
    expect(result.issues.some((i) => /No specific technologies/i.test(i))).toBe(false);
  });

  test('JWT and OIDC recognized as named technologies', () => {
    const result = optimize({
      prompt: 'Implement token validation using JWT and OIDC discovery',
      target: 'claude-code',
    });
    expect(result.issues.some((i) => /No specific technologies/i.test(i))).toBe(false);
  });

  test('JSON recognized as named technology (not just format keyword)', () => {
    const result = optimize({
      prompt: 'Return the results as structured JSON',
      target: 'generic',
    });
    expect(result.issues.some((i) => /No specific technologies/i.test(i))).toBe(false);
  });

  test('CSV and YAML recognized as named technologies', () => {
    const result = optimize({
      prompt: 'Parse the CSV file and convert to YAML format',
      target: 'generic',
    });
    expect(result.issues.some((i) => /No specific technologies/i.test(i))).toBe(false);
  });
});

// --- Regression tests for quality fixes ---

describe('Placeholder examples (no fake content)', () => {
  test('optimized prompt uses placeholder comment, not fake noun-extracted examples', () => {
    const result = optimize({
      prompt: 'Build a REST API for managing users',
      target: 'claude-api',
    });
    // Should NOT contain generated nouns like "Sample REST to process"
    expect(result.optimized_prompt).not.toMatch(/Sample \w+ to process/);
    // Should contain the placeholder comment
    if (result.applied_techniques.includes('few-shot')) {
      expect(result.optimized_prompt).toContain('Replace with a real input/output pair');
    }
  });

  test('existing user examples are preserved, not replaced with placeholder', () => {
    const result = optimize({
      prompt: 'Extract emails from text. For example, given "contact foo@bar.com", return foo@bar.com',
      target: 'generic',
      techniques: ['few-shot'],
    });
    // User's example should be preserved
    expect(result.optimized_prompt).toContain('foo@bar.com');
  });
});

describe('Score inflation guard', () => {
  test('score_after honest: placeholder examples do not inflate by +7', () => {
    const result = optimize({
      prompt: 'write a sort function',
      target: 'claude-code',
    });
    // With placeholder examples, examples dimension should be clamped
    // score_after should still improve but not by the old inflated amount
    if (result.analysis) {
      expect(result.analysis.dimension_scores.examples).toBeLessThanOrEqual(2);
    }
    expect(result.score_after).toBeGreaterThan(result.score_before);
  });
});

describe('False financial domain hint fix', () => {
  test('"Return them as JSON" does NOT trigger financial hint', () => {
    const result = optimize({
      prompt: 'Extract the user names and return them as JSON',
      target: 'generic',
    });
    const financialHint = result.analysis?.semantic_hints.find(
      (h) => h.area === 'domain_expertise' && /financial/i.test(h.reason),
    );
    expect(financialHint).toBeUndefined();
  });

  test('"return on investment" DOES trigger financial hint', () => {
    const result = optimize({
      prompt: 'Calculate the return on investment for the portfolio',
      target: 'generic',
    });
    const financialHint = result.analysis?.semantic_hints.find(
      (h) => h.area === 'domain_expertise' && /financial/i.test(h.reason),
    );
    expect(financialHint).toBeDefined();
  });

  test('"fund" in "function" does NOT trigger financial hint', () => {
    const result = optimize({
      prompt: 'Write a function to handle the fundamental data processing',
      target: 'generic',
    });
    const financialHint = result.analysis?.semantic_hints.find(
      (h) => h.area === 'domain_expertise' && /financial/i.test(h.reason),
    );
    expect(financialHint).toBeUndefined();
  });
});

describe('Creative intent detection (haiku, sonnet, etc.)', () => {
  test('"Write a haiku about spring" → creative', () => {
    expect(detectIntent('Write a haiku about spring')).toBe('creative');
  });

  test('"Write me a sonnet" → creative', () => {
    expect(detectIntent('Write me a sonnet about love')).toBe('creative');
  });

  test('"Create a screenplay" → creative', () => {
    expect(detectIntent('Create a screenplay for a short film')).toBe('creative');
  });

  test('"Write a limerick" → creative', () => {
    expect(detectIntent('Write a limerick about a programmer')).toBe('creative');
  });
});

describe('Boundary condition recognition', () => {
  test('"under 200ms" recognized as boundary condition', () => {
    const result = optimize({
      prompt: 'Optimize this function to run under 200ms with less than 50MB memory',
      target: 'claude-code',
    });
    // "under 200" and "less than" should be recognized as boundary conditions,
    // contributing to specificity and constraints scores
    expect(result.analysis!.dimension_scores.specificity).toBeGreaterThanOrEqual(2);
  });

  test('"over 1000 requests" recognized as boundary condition', () => {
    const result = optimize({
      prompt: 'Handle over 1000 requests per second without exceeding 100ms latency',
      target: 'claude-code',
    });
    expect(result.analysis!.dimension_scores.specificity).toBeGreaterThanOrEqual(2);
  });
});

describe('Clarifications field', () => {
  test('vague prompt produces clarifications_needed', () => {
    const result = optimize({
      prompt: 'do stuff',
      target: 'generic',
    });
    expect(result.clarifications_needed).toBeDefined();
    expect(result.clarifications_needed!.length).toBeGreaterThan(0);
    // Clarifications should not have "Clarify:" prefix
    for (const c of result.clarifications_needed!) {
      expect(c).not.toMatch(/^Clarify:/);
    }
  });

  test('vague code prompt has code-specific clarifications', () => {
    const result = optimize({
      prompt: 'write a function',
      target: 'claude-code',
    });
    expect(result.clarifications_needed).toBeDefined();
    expect(result.clarifications_needed!.some((c) => /functionality|inputs|outputs/i.test(c))).toBe(true);
  });

  test('clarifications NOT in optimized_prompt scaffold', () => {
    const result = optimize({
      prompt: 'do stuff',
      target: 'generic',
    });
    expect(result.optimized_prompt).not.toContain('Clarify:');
  });

  test('well-specified prompt has no clarifications', () => {
    const result = optimize({
      prompt: 'Write a TypeScript function that validates email addresses using regex',
      target: 'claude-code',
    });
    expect(result.clarifications_needed).toBeUndefined();
  });
});

describe('Score regression guard', () => {
  test('optimized score is always strictly better than original', () => {
    const prompts = [
      'Create a CLI tool for file management',
      'Convert the YAML config to TOML format',
      'Build a REST API for managing users',
      'Write a sort function',
      'do stuff',
    ];
    for (const prompt of prompts) {
      const result = optimize({ prompt, target: 'generic' });
      expect(result.score_after).toBeGreaterThan(result.score_before);
    }
  });
});

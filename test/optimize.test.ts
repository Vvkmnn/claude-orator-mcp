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
import type { OptimizeInput } from '../src/types.js';

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

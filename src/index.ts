#!/usr/bin/env node

/**
 * Claude Orator MCP — Prompt optimization server.
 * Single tool: orator_optimize. Analyzes prompts using deterministic heuristics
 * and applies Anthropic's prompt engineering techniques to produce an optimized scaffold.
 */

import { createRequire } from 'module';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { fmt, fmtMinimal } from './format.js';
import { optimize } from './optimize.js';
import { clientSupportsSampling, validateViaSampling } from './sampling.js';
import { OptimizeInputSchema } from './types.js';

const require = createRequire(import.meta.url);
const { version: SERVER_VERSION } = require('../package.json') as {
  version: string;
};

// --- Server instructions ---

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

**Important:** The optimized_prompt is a structural scaffold. Always refine it with your domain knowledge and conversation context before using it.

## Analysis metadata

The \`analysis\` field provides enriched analysis for programmatic consumption:

- **attributed_issues**: Each issue includes \`dimension\`, \`source\` (dimension/anti_pattern/industry/contextual), and \`confidence\` (high/medium). Prioritize high-confidence dimension issues.
- **attributed_suggestions**: Same structure as issues — use source and confidence to prioritize.
- **semantic_hints**: Meta-observations about analysis uncertainty. Treat as a review checklist, not issues. Verify with the user when intent is ambiguous.
- **dimension_scores**: Raw 7-dimension breakdown (clarity, specificity, structure, examples, constraints, output_format, token_efficiency). Each 0-10.
- **sampling_used**: Whether a second-opinion was obtained via MCP sampling. Check \`sampling_validation\` for details when true.`;

// --- Tool definition ---

const optimizeToolDef = {
  name: 'orator_optimize',
  description:
    'Analyze and optimize a prompt using Anthropic best practices. Returns an optimized prompt scaffold with score metrics, detected issues, and applied techniques.',
  inputSchema: {
    type: 'object' as const,
    properties: {
      prompt: {
        type: 'string',
        description: 'The raw prompt to optimize',
      },
      intent: {
        type: 'string',
        enum: ['code', 'analysis', 'creative', 'extraction', 'conversation', 'system'],
        description: 'Intent category (auto-detected if omitted)',
      },
      target: {
        type: 'string',
        enum: ['claude-code', 'claude-api', 'claude-desktop', 'generic'],
        description: 'Target environment for the optimized prompt (default: claude-code)',
      },
      techniques: {
        type: 'array',
        items: { type: 'string' },
        description: 'Force-apply specific technique IDs',
      },
    },
    required: ['prompt'],
  },
};

// --- Server setup ---

const server = new Server(
  { name: 'claude-orator-mcp', version: SERVER_VERSION },
  { capabilities: { tools: {} }, instructions: SERVER_INSTRUCTIONS },
);

// List tools handler
server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [optimizeToolDef],
}));

// Call tool handler
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    if (name !== 'orator_optimize') {
      throw new Error(`Unknown tool: ${name}`);
    }

    const input = OptimizeInputSchema.parse(args);
    const result = optimize(input);

    // Sampling validation: ask host LLM to review analysis if it supports sampling
    if (result.analysis?.semantic_hints.length && clientSupportsSampling(server)) {
      const validation = await validateViaSampling(server, result, result.analysis.semantic_hints);
      if (validation && result.analysis) {
        result.analysis.sampling_used = true;
        result.analysis.sampling_validation = validation;
      }
    }

    // Format notification + JSON payload
    const notification =
      result.applied_techniques.length === 0 && result.score_before >= 8.0
        ? fmtMinimal(result.summary)
        : fmt(
            result.score_before,
            result.score_after,
            result.applied_techniques,
            result.issues.length,
            result.summary,
          );

    const payload = JSON.stringify(result, null, 2);
    const output = `${notification}\n\n${payload}`;

    return {
      content: [{ type: 'text', text: output }],
    };
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e);
    return {
      content: [{ type: 'text', text: `Error: ${message}` }],
      isError: true,
    };
  }
});

// --- Entry point ---

async function main(): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error(`Orator MCP v${SERVER_VERSION} running on stdio`);
}

main().catch((error: unknown) => {
  console.error('Fatal error:', error);
  process.exit(1);
});

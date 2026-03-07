<img align="right" src="claude-orator.svg" alt="claude-orator-mcp" width="220">

# claude-orator-mcp

An [Model Context Protocol (MCP)](https://modelcontextprotocol.io/) server for deterministic prompt optimization in [Claude Code](https://docs.anthropic.com/en/docs/claude-code). Score prompts across 7 quality dimensions, auto-select from 11 [Anthropic techniques](https://docs.anthropic.com/en/docs/build-with-claude/prompt-engineering/overview), and return a structural scaffold. No LLM calls, no network, sub-millisecond.

<br clear="right">

![claude-orator-mcp](demo/demo.gif)

[![npm version](https://img.shields.io/npm/v/claude-orator-mcp.svg)](https://www.npmjs.com/package/claude-orator-mcp) [![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT) [![TypeScript](https://img.shields.io/badge/TypeScript-007ACC?logo=typescript&logoColor=white)](https://www.typescriptlang.org/) [![Node.js](https://img.shields.io/badge/node-%3E%3D20-brightgreen)](https://nodejs.org/) [![Claude](https://img.shields.io/badge/Claude-D97757?logo=claude&logoColor=fff)](#) [![GitHub stars](https://img.shields.io/github/stars/Vvkmnn/claude-orator-mcp?style=social)](https://github.com/Vvkmnn/claude-orator-mcp)

---

## install

**Requirements:**

[![Claude Code](https://img.shields.io/badge/Claude_Code-555?logo=data:image/svg%2bxml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAxOCAxMCIgc2hhcGUtcmVuZGVyaW5nPSJjcmlzcEVkZ2VzIj4KICA8IS0tIENsYXdkOiBDbGF1ZGUgQ29kZSBtYXNjb3QgLS0+CiAgPCEtLSBEZWNvZGVkIGZyb206IOKWkOKWm+KWiOKWiOKWiOKWnOKWjCAvIOKWneKWnOKWiOKWiOKWiOKWiOKWiOKWm+KWmCAvIOKWmOKWmCDilp3ilp0gLS0+CiAgPCEtLSBTdWItcGl4ZWxzIGFyZSAxIHdpZGUgeCAyIHRhbGwgdG8gbWF0Y2ggdGVybWluYWwgY2hhciBjZWxsIGFzcGVjdCByYXRpbyAtLT4KICA8cmVjdCBmaWxsPSIjZDk3NzU3IiB4PSIzIiAgeT0iMCIgd2lkdGg9IjEyIiBoZWlnaHQ9IjIiLz4KICA8cmVjdCBmaWxsPSIjZDk3NzU3IiB4PSIzIiAgeT0iMiIgd2lkdGg9IjIiICBoZWlnaHQ9IjIiLz4KICA8cmVjdCBmaWxsPSIjZDk3NzU3IiB4PSI2IiAgeT0iMiIgd2lkdGg9IjYiICBoZWlnaHQ9IjIiLz4KICA8cmVjdCBmaWxsPSIjZDk3NzU3IiB4PSIxMyIgeT0iMiIgd2lkdGg9IjIiICBoZWlnaHQ9IjIiLz4KICA8cmVjdCBmaWxsPSIjZDk3NzU3IiB4PSIxIiAgeT0iNCIgd2lkdGg9IjE2IiBoZWlnaHQ9IjIiLz4KICA8cmVjdCBmaWxsPSIjZDk3NzU3IiB4PSIzIiAgeT0iNiIgd2lkdGg9IjEyIiBoZWlnaHQ9IjIiLz4KICA8cmVjdCBmaWxsPSIjZDk3NzU3IiB4PSI0IiAgeT0iOCIgd2lkdGg9IjEiICBoZWlnaHQ9IjIiLz4KICA8cmVjdCBmaWxsPSIjZDk3NzU3IiB4PSI2IiAgeT0iOCIgd2lkdGg9IjEiICBoZWlnaHQ9IjIiLz4KICA8cmVjdCBmaWxsPSIjZDk3NzU3IiB4PSIxMSIgeT0iOCIgd2lkdGg9IjEiICBoZWlnaHQ9IjIiLz4KICA8cmVjdCBmaWxsPSIjZDk3NzU3IiB4PSIxMyIgeT0iOCIgd2lkdGg9IjEiICBoZWlnaHQ9IjIiLz4KPC9zdmc+Cg==)](https://claude.ai/code)

**From shell:**

```bash
claude mcp add claude-orator-mcp -- npx claude-orator-mcp
```

**From inside Claude** (restart required):

```
Add this to our global mcp config: npx claude-orator-mcp

Install this mcp: https://github.com/Vvkmnn/claude-orator-mcp
```

**From any manually configurable `mcp.json`**: (Cursor, Windsurf, etc.)

```json
{
  "mcpServers": {
    "claude-orator-mcp": {
      "command": "npx",
      "args": ["claude-orator-mcp"],
      "env": {}
    }
  }
}
```

There is **no `npm install` required** -- no external dependencies or databases, only deterministic heuristics.

However, if `npx` resolves the wrong package, you can force resolution with:

```bash
npm install -g claude-orator-mcp
```

## [skill](.claude/skills/claude-orator)

Optionally, install the skill to teach Claude when to proactively optimize prompts:

```bash
npx skills add Vvkmnn/claude-orator-mcp --skill claude-orator --global
# Optional: add --yes to skip interactive prompt and install to all agents
```

This makes Claude automatically optimize prompts before dispatching subagents, writing system prompts, or crafting any prompt worth improving. The MCP works without the skill, but the skill improves discoverability.

## [plugin](https://github.com/Vvkmnn/claude-emporium)

For automatic prompt optimization with hooks and commands, install from the [claude-emporium](https://github.com/Vvkmnn/claude-emporium) marketplace:

```bash
/plugin marketplace add Vvkmnn/claude-emporium
/plugin install claude-orator@claude-emporium
```

The **claude-orator** plugin provides:

**Hooks** (fires before subagent dispatch):

- Before Task -- Suggest prompt optimization before launching agents

**Commands:** `/reprompt-orator`

Requires the MCP server installed first. See the emporium for other Claude Code plugins and MCPs.

## features

[MCP server](https://modelcontextprotocol.io/) with a single tool. Prompt in, optimized prompt out.

#### `orator_optimize`

Analyze a prompt across 7 quality dimensions, auto-select from 11 Anthropic techniques, and return a structurally optimized scaffold with before/after scores.

```
orator_optimize prompt="Write a function that sorts users"
  > Returns optimized scaffold with XML tags, output format, examples section

orator_optimize prompt="You are a helpful assistant" intent="system"
  > Returns role-assigned system prompt with structure and constraints

orator_optimize prompt="Extract all emails from this text" techniques=["xml-tags", "few-shot"]
  > Force-applies specific techniques regardless of auto-selection
```

**Score meter** (gradient fill bar):

```
🪶 3.2 ░░░▓▓▓▓▓▓▓▓ 7.8
   +xml-tags +few-shot +structured-output · 3 issues
   Wrapped in XML tags, added examples, specified output format
```

Three-zone bar: `░░░` (baseline) `▓▓▓▓▓` (improvement) `░░` (headroom to 10).

**Minimal case** (already well-structured):

```
🪶 ━━ already well-structured (8.4)
```

**Input:**

| Parameter    | Type     | Required | Description                                                                            |
| ------------ | -------- | -------- | -------------------------------------------------------------------------------------- |
| `prompt`     | string   | Yes      | The raw prompt to optimize                                                             |
| `intent`     | enum     | No       | `code \| analysis \| creative \| extraction \| conversation \| system` (auto-detected) |
| `target`     | enum     | No       | `claude-code \| claude-api \| claude-desktop \| generic` (default: `claude-code`)      |
| `techniques` | string[] | No       | Force-apply specific technique IDs                                                     |

**Output:**

| Field                | Type     | Description                                |
| -------------------- | -------- | ------------------------------------------ |
| `optimized_prompt`   | string   | Rewritten prompt scaffold (primary output) |
| `score_before`       | number   | Quality score of original (0-10)           |
| `score_after`        | number   | Quality score after optimization (0-10)    |
| `summary`            | string   | 1-line explanation of improvements         |
| `detected_intent`    | string   | Auto-detected intent category              |
| `applied_techniques` | string[] | Technique IDs applied                      |
| `issues`             | string[] | Detected problems                          |
| `suggestions`        | string[] | Actionable fixes                           |

The `optimized_prompt` is a structural scaffold. Claude refines it with domain knowledge, codebase context, and conversation history.

## methodology

How [claude-orator-mcp](https://github.com/Vvkmnn/claude-orator-mcp) [works](https://github.com/Vvkmnn/claude-orator-mcp/tree/main/src):

```
                🪶 claude-orator-mcp
                ════════════════════


                   orator_optimize
                   ──────────────

                      PROMPT
                        │
           ┌────────────┴────────────┐
           ▼                         ▼
     ┌───────────┐            ┌────────────┐
     │  Detect   │            │  Measure   │
     │  Intent   │            │ Complexity │
     └─────┬─────┘            └──────┬─────┘
           │                         │
     system > code >           word count +
     extraction >              clause depth
     analysis >                      │
     creative >                      │
     conversation                    │
     + disambiguation                │
     + fallback heuristics           │
           │                         │
           └────────────┬────────────┘
                        │
                        ▼
              ┌───────────────────┐
              │   Score Before    │
              │                   │
              │  clarity      20% │  strong verbs, single task
              │  specificity  20% │  named tech, constraints
              │  structure    15% │  XML tags, headers, lists
              │  examples     15% │  input/output pairs
              │  constraints  10% │  scope, edge cases
              │  output_fmt   10% │  format specification
              │  efficiency   10% │  no filler, no redundancy
              │                   │
              │  ░░░░░░░░░░  3.2  │
              └────────┬──────────┘
                       │
                       ▼
              ┌───────────────────┐       techniques?
              │ Select Techniques │◄──── (force override)
              │                   │
              │  when_to_use() ×  │  11 predicates
              │  intent match  ×  │  filtered
              │  score gaps    ×  │  sorted by impact
              │  cap at 4        │
              └────────┬──────────┘
                       │
                       ▼
              ┌───────────────────┐
              │ Template Assembly │
              │                   │
              │  role preamble    │  expert identity
              │  → <context>      │  grounding data first
              │  → <task>         │  XML-wrapped prompt
              │  → <requirements> │  constraints + gaps
              │  → <examples>     │  multishot I/O pairs
              │  → output format  │  format specification
              └────────┬──────────┘
                       │
                       ▼
              ┌───────────────────┐
              │   Score After     │
              │                   │
              │  ░░░▓▓▓▓▓▓▓░░ 7.8│
              └────────┬──────────┘
                       │
                       ▼
                    OUTPUT
              optimized_prompt
              + scores + techniques
              + issues + suggestions


     score meter (gradient fill bar):
     ─────────────────────────────────

     🪶 3.2 ░░░▓▓▓▓▓▓▓▓ 7.8
        +xml-tags +few-shot +structured-output
        Wrapped in XML, added examples, format

     ░░░  baseline    ▓▓▓  improvement    ░░  headroom
```

**7 quality dimensions** (weighted scoring, deterministic):

| Dimension        | Weight | Measures                                |
| ---------------- | ------ | --------------------------------------- |
| Clarity          | 20%    | Strong verbs, single task, no hedging   |
| Specificity      | 20%    | Named tech, numbers, constraints        |
| Structure        | 15%    | XML tags, headers, lists                |
| Examples         | 15%    | Input/output pairs, demonstrations      |
| Constraints      | 10%    | Negative constraints, scope, edge cases |
| Output Format    | 10%    | Format spec, structure definition       |
| Token Efficiency | 10%    | No filler, no redundancy                |

**11 Anthropic techniques** (auto-selected based on intent, scores, and complexity):

| ID                       | Name                                                                                                                         | Auto-selected when                     |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------------------- | -------------------------------------- |
| `chain-of-thought`       | [Let Claude Think](https://docs.anthropic.com/en/docs/build-with-claude/prompt-engineering/chain-of-thought)                 | Analysis intent, complex tasks         |
| `xml-tags`               | [Use XML Tags](https://docs.anthropic.com/en/docs/build-with-claude/prompt-engineering/use-xml-tags)                         | Long prompt + low structure score      |
| `few-shot`               | [Multishot Examples](https://docs.anthropic.com/en/docs/build-with-claude/prompt-engineering/multishot-prompting)            | Low example score + extraction/code    |
| `role-assignment`        | [System Prompts & Roles](https://docs.anthropic.com/en/docs/build-with-claude/prompt-engineering/system-prompts)             | System intent or low specificity       |
| `structured-output`      | [Control Output Format](https://docs.anthropic.com/en/docs/build-with-claude/prompt-engineering/fill-in-the-blank)           | Low output format score                |
| `prefill`                | [Structured Output Format](https://docs.anthropic.com/en/docs/build-with-claude/prompt-engineering/prefill-claudes-response) | API target + extraction/code           |
| `prompt-chaining`        | [Chain Complex Tasks](https://docs.anthropic.com/en/docs/build-with-claude/prompt-engineering/chain-prompts)                 | Complex + multiple subtasks            |
| `uncertainty-permission` | [Say "I Don't Know"](https://docs.anthropic.com/en/docs/build-with-claude/prompt-engineering/ask-claude-for-rewrites)        | Analysis or extraction intent          |
| `extended-thinking`      | [Extended Thinking](https://docs.anthropic.com/en/docs/build-with-claude/extended-thinking)                                  | Complex + analysis/code intent         |
| `long-context-tips`      | [Long Context](https://docs.anthropic.com/en/docs/build-with-claude/prompt-engineering/long-context-tips)                    | Long prompt (>2000 chars or >50 lines) |
| `tool-use`               | [Tool Use](https://docs.anthropic.com/en/docs/build-with-claude/tool-use/overview)                                           | Prompt mentions tool/function calling  |

**Core algorithms:**

- **[Intent detection](https://github.com/Vvkmnn/claude-orator-mcp/blob/main/src/analysis/detector.ts)** (`detectIntent`): Priority-ordered regex patterns across 6 categories: `system > code > extraction > analysis > creative > conversation`. Includes disambiguation (e.g., `system` + `code` signals resolves to `code`) and fallback heuristics for code blocks, "build me" patterns, and debugging language.
- **[Heuristic scoring](https://github.com/Vvkmnn/claude-orator-mcp/blob/main/src/analysis/heuristics.ts)** (`scorePrompt`): 7-dimension weighted analysis. Each dimension 0-10, overall is weighted sum. Also generates flat `issues[]` and `suggestions[]` arrays.
- **[Technique selection](https://github.com/Vvkmnn/claude-orator-mcp/blob/main/src/techniques/index.ts)** (`selectTechniques`): Each technique has a `when_to_use()` predicate. Auto-selected based on intent + scores + complexity. Sorted by impact, capped at 4.
- **[Template assembly](https://github.com/Vvkmnn/claude-orator-mcp/blob/main/src/optimize.ts)** (`optimize`): Builds structural scaffold from selected techniques. Context-first ordering: role → `<context>` → `<task>` → `<requirements>` → `<examples>` → output format.

**Design principles:**

- **Single tool**: one entry point, minimal cognitive overhead
- **Deterministic**: same input, same output. No LLM calls, no network
- **Scaffold, not final**: the optimized prompt is structural; Claude adds substance
- **Lean output**: flat string arrays for issues/suggestions, no nested objects
- **Weighted dimensions**: clarity and specificity matter most (20% each)
- **Technique cap**: max 4 techniques per optimization (diminishing returns beyond)
- **Anti-pattern detection**: 12 Claude-specific anti-patterns + 20 industry patterns from 34 production AI tools
- **Zero dependencies**: only `@modelcontextprotocol/sdk` + `zod`

## alternatives

Every existing prompt optimization tool requires LLM calls, labeled datasets, or evaluation infrastructure. When you need structural improvement at zero latency (CI/CD, subagent dispatch, offline), they cannot help.

| Feature                | **orator**              | DSPy           | promptfoo       | TextGrad       | OPRO           | LLMLingua      | Anthropic Generator |
| ---------------------- | ----------------------- | -------------- | --------------- | -------------- | -------------- | -------------- | ------------------- |
| **Zero latency**       | **Yes (<1ms)**          | No (LLM calls) | No (eval runs)  | No (LLM calls) | No (LLM calls) | No (LLM calls) | No (LLM call)       |
| **Offline/airgapped**  | **Yes**                 | No             | Partial         | No             | No             | No             | No                  |
| **Deterministic**      | **Yes**                 | No             | No              | No             | No             | Partial        | No                  |
| **No labeled data**    | **Yes**                 | No (examples)  | No (test cases) | No (feedback)  | No (examples)  | Yes            | Yes                 |
| **Claude-specific**    | **Yes (anti-patterns)** | No             | No              | No             | No             | No             | Yes                 |
| **MCP native**         | **Yes**                 | No             | No              | No             | No             | No             | No                  |
| **Structural scoring** | **7 dimensions**        | None           | Custom metrics  | None           | None           | None           | None                |
| **Dependencies**       | **0 (pure TS)**         | PyTorch + LLM  | Node + LLM      | PyTorch + LLM  | LLM            | PyTorch + LLM  | LLM API             |

**[DSPy](https://github.com/stanfordnlp/dspy)**: Stanford's framework for compiling LM programs with automatic prompt optimization. Requires labeled examples, LLM calls for optimization, and PyTorch. Optimizes for task accuracy, not structural quality. Latency: seconds to minutes per optimization. Use DSPy when you have labeled data and want to tune for a specific metric.

**[promptfoo](https://github.com/promptfoo/promptfoo)**: Test-driven prompt evaluation framework. Requires test cases, LLM calls for evaluation, and an evaluation dataset. Measures output quality, not prompt structure. Complementary: use Orator for structural scaffolding, then promptfoo to evaluate output quality.

**[TextGrad](https://github.com/zou-group/textgrad)**: Automatic differentiation via text feedback from LLMs. Requires LLM calls for both forward and backward passes. Research-oriented, PyTorch dependency. Latency: minutes. Use when iterating on prompt wording with measurable objectives.

**[OPRO](https://github.com/google-deepmind/opro)**: DeepMind's optimization by prompting. Uses an LLM to iteratively rewrite prompts. Requires examples of good/bad outputs, multiple LLM calls per iteration. Latency: minutes. Use when exploring creative prompt variations with evaluation feedback.

**[LLMLingua](https://github.com/microsoft/LLMLingua)**: Microsoft's prompt compression via perplexity-based token removal. Reduces token count by 2-20x but requires a local LLM for perplexity scoring. Different goal: compression, not structural improvement. Use when context window is the bottleneck.

**[Anthropic Prompt Generator](https://docs.anthropic.com/en/docs/build-with-claude/prompt-engineering/prompt-generator)**: Anthropic's own tool that generates prompts via Claude. Excellent quality but requires an LLM call, non-deterministic, and not available offline or via MCP. Use when you want Claude to write your prompt from scratch.

Orator's approach is deliberately different: structural analysis via deterministic heuristics. No LLM calls means no API keys, no latency variance, no cost per optimization, and identical results every run. The trade-off is that Orator optimizes prompt _structure_ (clarity, specificity, constraints, format) rather than prompt _wording_. It can't tell you if your prompt produces good _output_, only that it's well-formed for Claude. This makes it complementary to evaluation tools like promptfoo: scaffold with Orator, then validate with eval.

## development

```bash
git clone https://github.com/Vvkmnn/claude-orator-mcp && cd claude-orator-mcp
npm install && npm run build
npm test
```

**Package requirements:**

- **Node.js**: >=20.0.0 (ES modules)
- **Runtime**: `@modelcontextprotocol/sdk`, `zod`
- **Zero external databases**: works with `npx`

**Development workflow:**

```bash
npm run build          # TypeScript compilation with executable permissions
npm run dev            # Watch mode with tsc --watch
npm run start          # Run the MCP server directly
npm run lint           # ESLint code quality checks
npm run lint:fix       # Auto-fix linting issues
npm run format         # Prettier formatting (src/)
npm run format:check   # Check formatting without changes
npm run typecheck      # TypeScript validation without emit
npm run test           # Lint + type check + vitest (25 tests)
npm run prepublishOnly # Pre-publish validation (build + lint + format:check)
```

**Git hooks (via Husky):**

- **pre-commit**: Auto-formats staged `.ts` files with Prettier and ESLint

Contributing:

- Fork the repository and create feature branches
- Follow TypeScript strict mode and [MCP protocol](https://modelcontextprotocol.io/specification) standards

Learn from examples:

- [Official MCP servers](https://github.com/modelcontextprotocol/servers) for reference implementations
- [TypeScript SDK](https://github.com/modelcontextprotocol/typescript-sdk) for best practices
- [Creating Node.js modules](https://docs.npmjs.com/creating-node-js-modules) for npm package development
- [Anthropic prompt engineering docs](https://docs.anthropic.com/en/docs/build-with-claude/prompt-engineering/overview) for technique details

## acknowledgments

Industry pattern data derived from deep analysis of system prompts from 34 AI coding tools
collected in [system-prompts-and-models-of-ai-tools](https://github.com/x1xhlol/system-prompts-and-models-of-ai-tools),
including Claude Code, Cursor, Windsurf, v0, Devin, Cline, Lovable, Replit, Amp, Gemini, and
25 others. Patterns are curated with prevalence data and embedded — no external dependency
or installation required. Cross-referenced with research from the
[Prompt Report](https://arxiv.org/abs/2406.06608) (1,500 papers surveyed) and
[Anthropic's prompt engineering documentation](https://docs.anthropic.com/en/docs/build-with-claude/prompt-engineering/overview).

## license

[MIT](LICENSE)

<hr>

<a href="https://en.wikipedia.org/wiki/Cicero_Denounces_Catiline"><img src="logo/maccari-cicero.jpg" alt="Cicero Denounces Catiline -- Cesare Maccari" width="100%"></a>

<p align="center">

_**[Cicero Denounces Catiline](https://en.wikipedia.org/wiki/Cicero_Denounces_Catiline)** by **[Cesare Maccari](https://en.wikipedia.org/wiki/Cesare_Maccari)** (1889). "Quo usque tandem abutere, Catilina, patientia nostra?" (How long, Catiline, will you abuse our patience?) - [Claudius](https://en.wikipedia.org/wiki/Claudius)._

</p>

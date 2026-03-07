/**
 * MCP sampling validation layer.
 *
 * When a client supports sampling (server.createMessage), Orator can ask the
 * host LLM to validate its deterministic analysis — confirming correct findings,
 * flagging false positives, and identifying missed issues.
 *
 * This module is isolated, async, and gracefully fails to null.
 */

import type { Server } from '@modelcontextprotocol/sdk/server/index.js';
import type { OptimizeResult, SamplingValidation, SemanticHint } from './types.js';

/** Check whether the connected client advertises sampling support. */
export function clientSupportsSampling(server: Server): boolean {
  try {
    const capabilities = server.getClientCapabilities();
    return capabilities?.sampling !== undefined;
  } catch {
    return false;
  }
}

/** Build an XML-structured prompt asking the host LLM to validate the analysis. */
export function buildValidationPrompt(result: OptimizeResult, hints: SemanticHint[]): string {
  const hintsXml = hints
    .map(
      (h) =>
        `  <hint area="${h.area}">\n    <reason>${h.reason}</reason>\n    <check>${h.check}</check>\n  </hint>`,
    )
    .join('\n');

  const issuesXml = result.issues.map((i) => `  <issue>${i}</issue>`).join('\n');

  return `<validation_request>
<prompt_analyzed>${result.optimized_prompt.slice(0, 500)}</prompt_analyzed>
<detected_intent>${result.detected_intent}</detected_intent>
<score_before>${result.score_before}</score_before>
<score_after>${result.score_after}</score_after>

<issues_found>
${issuesXml}
</issues_found>

<semantic_hints>
${hintsXml}
</semantic_hints>

<instructions>
Review the analysis above. Respond with a <validation> block:
- <agreed>true/false</agreed> — do you agree with the overall assessment?
- <summary>Brief assessment of analysis quality</summary>
- <additional_issues>Issues the analysis missed (one per line, or "none")</additional_issues>
- <disputed_issues>Issues that seem like false positives (one per line, or "none")</disputed_issues>
</instructions>
</validation_request>`;
}

/** Parse a <validation> XML response into SamplingValidation. */
export function parseSamplingResponse(text: string): SamplingValidation {
  const defaults: SamplingValidation = {
    agreed: true,
    summary: '',
    additional_issues: [],
    disputed_issues: [],
  };

  try {
    const agreedMatch = text.match(/<agreed>(.*?)<\/agreed>/s);
    const summaryMatch = text.match(/<summary>(.*?)<\/summary>/s);
    const additionalMatch = text.match(/<additional_issues>(.*?)<\/additional_issues>/s);
    const disputedMatch = text.match(/<disputed_issues>(.*?)<\/disputed_issues>/s);

    const parseLines = (raw: string | undefined): string[] => {
      if (!raw || /^none$/i.test(raw.trim())) return [];
      return raw
        .split('\n')
        .map((l) => l.trim())
        .filter((l) => l.length > 0 && !/^none$/i.test(l));
    };

    return {
      agreed: agreedMatch ? agreedMatch[1]!.trim().toLowerCase() === 'true' : defaults.agreed,
      summary: summaryMatch ? summaryMatch[1]!.trim() : defaults.summary,
      additional_issues: parseLines(additionalMatch?.[1]),
      disputed_issues: parseLines(disputedMatch?.[1]),
    };
  } catch {
    return defaults;
  }
}

/** Attempt sampling validation via the host LLM. Returns null on any failure. */
export async function validateViaSampling(
  server: Server,
  result: OptimizeResult,
  hints: SemanticHint[],
): Promise<SamplingValidation | null> {
  try {
    const prompt = buildValidationPrompt(result, hints);
    const response = await server.createMessage({
      messages: [{ role: 'user', content: { type: 'text', text: prompt } }],
      maxTokens: 500,
      metadata: {
        speedPriority: 0.7,
        costPriority: 0.8,
      },
    });

    const text = response.content.type === 'text' ? response.content.text : '';

    if (!text) return null;
    return parseSamplingResponse(text);
  } catch {
    return null;
  }
}

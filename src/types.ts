import { z } from 'zod';

// --- Intent & Target enums ---

export const IntentSchema = z.enum([
  'code',
  'analysis',
  'creative',
  'extraction',
  'conversation',
  'system',
]);
export type Intent = z.infer<typeof IntentSchema>;

export const TargetSchema = z.enum(['claude-code', 'claude-api', 'claude-desktop', 'generic']);
export type Target = z.infer<typeof TargetSchema>;

// --- Complexity ---

export type Complexity = 'simple' | 'moderate' | 'complex';

// --- 7-dimension scores (internal) ---

export const SCORE_DIMENSIONS = [
  'clarity',
  'specificity',
  'structure',
  'examples',
  'constraints',
  'output_format',
  'token_efficiency',
] as const;

export type ScoreDimension = (typeof SCORE_DIMENSIONS)[number];

export type Scores = Record<ScoreDimension, number>;

export const DIMENSION_WEIGHTS: Record<ScoreDimension, number> = {
  clarity: 0.2,
  specificity: 0.2,
  structure: 0.15,
  examples: 0.15,
  constraints: 0.1,
  output_format: 0.1,
  token_efficiency: 0.1,
};

// --- Tool input/output ---

export const OptimizeInputSchema = z.object({
  prompt: z.string().describe('The raw prompt to optimize'),
  intent: IntentSchema.optional().describe('Intent category (auto-detected if omitted)'),
  target: TargetSchema.default('claude-code').describe(
    'Target environment for the optimized prompt',
  ),
  techniques: z.array(z.string()).optional().describe('Force-apply specific technique IDs'),
});
export type OptimizeInput = z.infer<typeof OptimizeInputSchema>;

export interface OptimizeResult {
  optimized_prompt: string;
  score_before: number;
  score_after: number;
  summary: string;
  detected_intent: Intent;
  applied_techniques: string[];
  issues: string[];
  suggestions: string[];
  clarifications_needed?: string[];
  analysis?: AnalysisMetadata;
}

// --- Semantic intelligence types ---

export type IssueSource = 'dimension' | 'anti_pattern' | 'industry' | 'contextual';
export type Confidence = 'high' | 'medium';

export interface AttributedIssue {
  message: string;
  dimension?: ScoreDimension;
  source: IssueSource;
  confidence: Confidence;
  pattern_id?: string;
}

export interface AttributedSuggestion {
  message: string;
  dimension?: ScoreDimension;
  source: IssueSource;
  confidence: Confidence;
  pattern_id?: string;
}

export interface SemanticHint {
  area: string;
  reason: string;
  check: string;
  dimension?: ScoreDimension;
}

export interface AnalysisMetadata {
  attributed_issues: AttributedIssue[];
  attributed_suggestions: AttributedSuggestion[];
  semantic_hints: SemanticHint[];
  dimension_scores: Scores;
  sampling_used: boolean;
  sampling_validation?: SamplingValidation;
}

export interface SamplingValidation {
  agreed: boolean;
  summary: string;
  additional_issues: string[];
  disputed_issues: string[];
}

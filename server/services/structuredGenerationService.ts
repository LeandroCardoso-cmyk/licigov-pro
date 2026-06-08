import { createHash } from "crypto";
import { runLegalReasoning } from "./legalReasoningEngine";
import { runDocumentDrafting } from "./documentDraftingEngine";
import { runLegalValidation } from "./legalValidationService";
import { correlateJurisprudence } from "./jurisprudenceCorrelationService";
import { generateClauseRecommendations } from "./clauseRecommendationService";
import { recordDraftingTrace, draftLatency, draftCompleteness, complianceScoreRecorded, riskScoreRecorded } from "./draftingObservabilityService";

export interface StructuredGenerationInput {
  organizationId: number;
  sessionId: string;
  documentType: string;
  documentContent?: string;
  variableValues?: Record<string, string>;
  legalBasisRefs?: string[];
  complianceRules?: Array<{ ruleId: string; ruleName: string; legalBasis: string; expression: string }>;
  clauses?: Array<{ id: string; content: string; legalBasis?: string }>;
  keywords?: string[];
  legalFramework?: string;
}

export interface StructuredGenerationOutput {
  drafting: ReturnType<typeof runDocumentDrafting>;
  draftingOutput: ReturnType<typeof runDocumentDrafting>;
  reasoning: ReturnType<typeof runLegalReasoning>;
  reasoningOutput: ReturnType<typeof runLegalReasoning>;
  validation: ReturnType<typeof runLegalValidation>;
  validationOutput: ReturnType<typeof runLegalValidation>;
  jurisprudence: ReturnType<typeof correlateJurisprudence>;
  clauseRecommendations: ReturnType<typeof generateClauseRecommendations>;
  overallScore: number;
  replayKey: string;
  processingMs: number;
}

const _generationHistory = new Map<number, StructuredGenerationOutput[]>();

export function runStructuredGeneration(input: StructuredGenerationInput): StructuredGenerationOutput {
  const start = Date.now();
  const {
    organizationId, sessionId, documentType,
    documentContent = "",
    variableValues = {},
    legalBasisRefs = ["Lei 14133/2021"],
    complianceRules = [],
    clauses = [],
    keywords = [],
    legalFramework = "Lei 14133/2021",
  } = input;

  const drafting = runDocumentDrafting({ organizationId, sessionId, documentType, variableValues, legalFramework });
  const reasoning = runLegalReasoning({ organizationId, sessionId, documentContent: documentContent || drafting.generation.resolvedContent, legalBasisRefs, complianceRules });
  const validation = runLegalValidation({ organizationId, sessionId, targetType: documentType, targetId: drafting.generation.id, content: drafting.generation.resolvedContent });
  const jurisprudence = correlateJurisprudence({ organizationId, sessionId, documentContent: drafting.generation.resolvedContent, legalBasisRefs, keywords });
  const clauseRecommendations = clauses.length > 0
    ? generateClauseRecommendations({ organizationId, sessionId, clauses, legalFramework })
    : generateClauseRecommendations({ organizationId, sessionId, clauses: [{ id: "default", content: drafting.generation.resolvedContent }], legalFramework });

  const overallScore = (
    drafting.completeness.completenessScore * 0.3 +
    reasoning.complianceScore * 0.3 +
    validation.report.passRate * 0.25 +
    jurisprudence.correlationScore * 0.15
  );

  const sha256 = (x: string) => createHash("sha256").update(x, "utf8").digest("hex");
  const replayKey = sha256(JSON.stringify({
    organizationId, sessionId, documentType,
    variableValuesHash: sha256(JSON.stringify(Object.entries(variableValues).sort())),
    legalBasisRefs: [...legalBasisRefs].sort(),
  }));

  const processingMs = Date.now() - start;

  // Record observability
  const correlationId = sha256(`${organizationId}${sessionId}`).slice(0, 20);
  recordDraftingTrace({
    correlationId,
    organizationId,
    sessionId,
    draftId: drafting.generation.id,
    documentType,
    stageBreakdown: {
      drafting: drafting.processingMs,
      reasoning: reasoning.processingMs,
      validation: validation.processingMs,
      jurisprudence: jurisprudence.processingMs,
    },
    totalMs: processingMs,
    completenessScore: drafting.completeness.completenessScore,
    riskScore: reasoning.riskScore,
    complianceScore: reasoning.complianceScore,
    variableCount: Object.keys(variableValues).length,
    missingVariables: drafting.completeness.missingRequired.length,
    recordedAt: new Date().toISOString(),
  });
  draftLatency(correlationId, processingMs, organizationId);
  draftCompleteness(correlationId, drafting.completeness.completenessScore, organizationId);
  complianceScoreRecorded(correlationId, reasoning.complianceScore, organizationId);
  riskScoreRecorded(correlationId, reasoning.riskScore, organizationId);

  const output: StructuredGenerationOutput = {
    drafting, draftingOutput: drafting,
    reasoning, reasoningOutput: reasoning,
    validation, validationOutput: validation,
    jurisprudence, clauseRecommendations, overallScore, replayKey, processingMs,
  };

  const existing = _generationHistory.get(organizationId) ?? [];
  _generationHistory.set(organizationId, [...existing, output]);
  return output;
}

export function getGenerationHistory(organizationId: number): StructuredGenerationOutput[] {
  return _generationHistory.get(organizationId) ?? [];
}

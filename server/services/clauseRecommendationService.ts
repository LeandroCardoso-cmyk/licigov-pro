import { createHash } from "crypto";
import {
  type ClauseRiskAnalysis,
  checkClauseCompatibility,
  analyzeClauseRisk,
  buildClauseConflictMap,
  type ClauseConflictMap,
} from "../domain/clauseIntelligence";

export interface ClauseRecommendationInput {
  organizationId: number;
  sessionId: string;
  clauses?: Array<{ id: string; content: string; legalBasis?: string; clauseType?: string }>;
  documentContent?: string;
  documentType?: string;
  legalFramework?: string;
}

export interface ClauseRecommendation {
  id: string;
  clauseId: string;
  recommendationType: "add" | "remove" | "modify" | "reorder";
  content: string;
  rationale: string;
  priority: number;
  legalBasis: string;
}

export interface ClauseRecommendationOutput {
  recommendations: ClauseRecommendation[];
  riskAnalyses: ClauseRiskAnalysis[];
  conflictMap: ClauseConflictMap;
  overallRiskScore: number;
  processingMs: number;
  replayKey: string;
}

const _recommendationHistory = new Map<number, ClauseRecommendationOutput[]>();

export function generateClauseRecommendations(input: ClauseRecommendationInput): ClauseRecommendationOutput {
  const start = Date.now();
  const { organizationId, sessionId, legalFramework = "Lei 14133/2021" } = input;
  const clauses: Array<{ id: string; content: string; legalBasis?: string; clauseType?: string }> =
    input.clauses && input.clauses.length > 0
      ? input.clauses
      : [{ id: `auto-${sessionId}`, content: input.documentContent ?? "Documento sem conteúdo" }];

  const riskAnalyses = clauses.map(c =>
    analyzeClauseRisk(c.id, c.content, c.legalBasis ?? legalFramework, organizationId)
  );

  const conflictMap = buildClauseConflictMap(
    clauses.map(c => ({ id: c.id, content: c.content, organizationId }))
  );

  const sha256 = (x: string) => createHash("sha256").update(x, "utf8").digest("hex");
  const makeId = (x: string) => sha256(x).slice(0, 20);

  const recommendations: ClauseRecommendation[] = [];
  let priority = 1;

  for (const risk of riskAnalyses.filter(r => r.riskLevel !== "none")) {
    recommendations.push({
      id: makeId(`${organizationId}${risk.clauseId}${priority}`),
      clauseId: risk.clauseId,
      recommendationType: "modify",
      content: risk.mitigationSuggestion,
      rationale: `Risco ${risk.riskLevel}: ${risk.riskFactors.join(", ")}`,
      priority: priority++,
      legalBasis: legalFramework,
    });
  }

  for (const conflict of conflictMap.conflicts.slice(0, 5)) {
    recommendations.push({
      id: makeId(`${organizationId}${conflict.clauseIdA}${conflict.clauseIdB}`),
      clauseId: conflict.clauseIdA,
      recommendationType: "modify",
      content: conflict.resolution ?? "Revisar e consolidar",
      rationale: conflict.explanation,
      priority: priority++,
      legalBasis: legalFramework,
    });
  }

  const overallRiskScore = riskAnalyses.length > 0
    ? riskAnalyses.reduce((sum, r) => sum + r.riskScore, 0) / riskAnalyses.length
    : 0;

  const replayKey = sha256(JSON.stringify({
    organizationId,
    sessionId,
    clauseIds: clauses.map(c => c.id).sort(),
  }));

  const output: ClauseRecommendationOutput = {
    recommendations,
    riskAnalyses,
    conflictMap,
    overallRiskScore,
    processingMs: Date.now() - start,
    replayKey,
  };

  const existing = _recommendationHistory.get(organizationId) ?? [];
  _recommendationHistory.set(organizationId, [...existing, output]);
  return output;
}

export function getRecommendationHistory(organizationId: number): ClauseRecommendationOutput[] {
  return _recommendationHistory.get(organizationId) ?? [];
}

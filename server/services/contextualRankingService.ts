import { createHash } from "crypto";

export type WorkflowStage = "draft" | "review" | "approval" | "published" | "archived";
export type InstitutionalRole = "procurador" | "fiscal" | "gestor" | "pregoeiro" | "dirigente" | "auditor" | "operador";
export type DocumentCategory = "legal" | "technical" | "operational" | "historical" | "institutional";

export interface RankingContext {
  organizationId: number;
  workflowStage: WorkflowStage;
  institutionalRole: InstitutionalRole;
  documentCategory: DocumentCategory;
  queryDate: string;
  semanticConfidence: number;
  legalRelevance: number;
  sessionContext: Record<string, unknown>;
}

export interface RankedItem {
  id: string;
  originalScore: number;
  contextualScore: number;
  finalScore: number;
  rankPosition: number;
  scoreBreakdown: {
    workflowBoost: number;
    roleBoost: number;
    categoryBoost: number;
    recencyBoost: number;
    legalBoost: number;
    confidenceMultiplier: number;
  };
  explanation: string;
  replayKey: string;
}

export interface RankingResult {
  organizationId: number;
  items: RankedItem[];
  context: RankingContext;
  processingMs: number;
  replayKey: string;
}

function sha20(input: string): string {
  return createHash("sha256").update(input).digest("hex").slice(0, 20);
}

const WORKFLOW_BOOSTS: Record<WorkflowStage, number> = {
  draft: 0.8,
  review: 1.0,
  approval: 1.2,
  published: 1.1,
  archived: 0.7,
};

const ROLE_BOOSTS: Record<InstitutionalRole, number> = {
  procurador: 1.2,
  pregoeiro: 1.1,
  gestor: 1.0,
  fiscal: 0.9,
  dirigente: 0.9,
  auditor: 1.15,
  operador: 0.9,
};

const CATEGORY_BOOSTS: Record<DocumentCategory, number> = {
  legal: 1.3,
  technical: 1.1,
  institutional: 1.2,
  operational: 1.0,
  historical: 0.9,
};

function computeRecencyBoost(itemDate: string | undefined, queryDate: string): number {
  if (!itemDate) return 1.0;
  const item = new Date(itemDate).getTime();
  const query = new Date(queryDate).getTime();
  if (isNaN(item) || isNaN(query)) return 1.0;
  const diffDays = (query - item) / (1000 * 60 * 60 * 24);
  if (diffDays < 0) return 1.0;
  if (diffDays <= 30) return 1.2;
  if (diffDays <= 90) return 1.1;
  if (diffDays <= 365) return 1.0;
  if (diffDays <= 730) return 0.9;
  return 0.8;
}

export function rankItems(
  items: Array<{ id: string; score: number; content: string; metadata: Record<string, unknown> }>,
  context: RankingContext
): RankingResult {
  const start = Date.now();

  const workflowBoost = WORKFLOW_BOOSTS[context.workflowStage];
  const roleBoost = ROLE_BOOSTS[context.institutionalRole];
  const categoryBoost = CATEGORY_BOOSTS[context.documentCategory];
  const legalBoost = 1.0 + context.legalRelevance * 0.3;
  const confidenceMultiplier = 0.7 + context.semanticConfidence * 0.3;

  const ranked: RankedItem[] = items.map((item) => {
    const recencyBoost = computeRecencyBoost(
      item.metadata["date"] as string | undefined,
      context.queryDate
    );

    const contextualScore =
      item.score * workflowBoost * roleBoost * categoryBoost * recencyBoost * legalBoost * confidenceMultiplier;
    const finalScore = Math.min(1.0, contextualScore);

    const replayKey = sha20(
      `${item.id}${item.score}${context.workflowStage}${context.institutionalRole}${context.documentCategory}${context.semanticConfidence}${context.legalRelevance}`
    );

    const explanation =
      `Score original ${item.score.toFixed(3)} ajustado por: ` +
      `workflow=${workflowBoost}, role=${roleBoost}, category=${categoryBoost}, ` +
      `recency=${recencyBoost.toFixed(2)}, legal=${legalBoost.toFixed(2)}, ` +
      `confidence=${confidenceMultiplier.toFixed(2)} → final=${finalScore.toFixed(3)}`;

    return {
      id: item.id,
      originalScore: item.score,
      contextualScore,
      finalScore,
      rankPosition: 0,
      scoreBreakdown: {
        workflowBoost,
        roleBoost,
        categoryBoost,
        recencyBoost,
        legalBoost,
        confidenceMultiplier,
      },
      explanation,
      replayKey,
    };
  });

  ranked.sort((a, b) => b.finalScore - a.finalScore);
  ranked.forEach((item, idx) => {
    item.rankPosition = idx + 1;
  });

  const contextKey = sha20(
    JSON.stringify({
      organizationId: context.organizationId,
      workflowStage: context.workflowStage,
      institutionalRole: context.institutionalRole,
      documentCategory: context.documentCategory,
      queryDate: context.queryDate,
      semanticConfidence: context.semanticConfidence,
      legalRelevance: context.legalRelevance,
    }) + ranked.map((r) => r.id).join("")
  );

  return {
    organizationId: context.organizationId,
    items: ranked,
    context,
    processingMs: Date.now() - start,
    replayKey: contextKey,
  };
}

export function computeConfidencePropagation(
  items: RankedItem[],
  propagationFactor = 0.9
): RankedItem[] {
  return items.map((item, idx) => {
    if (idx === 0) return item;
    const prev = items[idx - 1];
    const propagated = prev.finalScore * propagationFactor;
    const newFinal = Math.min(1.0, item.finalScore * propagated);
    return { ...item, finalScore: newFinal };
  });
}

export function explainRanking(item: RankedItem): string {
  const b = item.scoreBreakdown;
  return [
    `## Explicação do Ranking — Item \`${item.id}\``,
    ``,
    `**Posição:** ${item.rankPosition}`,
    `**Score Original:** ${item.originalScore.toFixed(4)}`,
    `**Score Contextual:** ${item.contextualScore.toFixed(4)}`,
    `**Score Final:** ${item.finalScore.toFixed(4)}`,
    ``,
    `### Decomposição dos Boosts`,
    `| Fator | Valor |`,
    `|-------|-------|`,
    `| Workflow Boost | ${b.workflowBoost} |`,
    `| Role Boost | ${b.roleBoost} |`,
    `| Category Boost | ${b.categoryBoost} |`,
    `| Recency Boost | ${b.recencyBoost.toFixed(2)} |`,
    `| Legal Boost | ${b.legalBoost.toFixed(2)} |`,
    `| Confidence Multiplier | ${b.confidenceMultiplier.toFixed(2)} |`,
    ``,
    `### Explicação`,
    item.explanation,
    ``,
    `*replayKey: \`${item.replayKey}\`*`,
  ].join("\n");
}

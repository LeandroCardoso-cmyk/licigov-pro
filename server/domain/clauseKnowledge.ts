import { createHash } from "crypto";

export type ClauseCategory =
  | "objeto"
  | "prazo"
  | "pagamento"
  | "garantia"
  | "penalidade"
  | "rescisao"
  | "obrigacao_contratante"
  | "obrigacao_contratada"
  | "fiscalizacao"
  | "subcontratacao"
  | "reajuste"
  | "confidencialidade";

export type ClauseRiskLevel = "baixo" | "medio" | "alto" | "critico";

export interface ClauseKnowledgeItem {
  readonly id: string;
  readonly organizationId: number;
  readonly category: ClauseCategory;
  readonly title: string;
  readonly content: string;
  readonly purpose: string;
  readonly riskLevel: ClauseRiskLevel;
  readonly legalBasis: string;
  readonly relatedDocumentTypes: readonly string[];
  readonly prerequisites: readonly string[];
  readonly active: boolean;
  readonly createdAt: string;
}

export function createClauseKnowledge(params: {
  organizationId: number;
  category: ClauseCategory;
  title: string;
  content: string;
  purpose?: string;
  riskLevel?: ClauseRiskLevel;
  legalBasis?: string;
  relatedDocumentTypes?: string[];
  prerequisites?: string[];
}): ClauseKnowledgeItem {
  const id = createHash("sha256")
    .update(`ck:${params.organizationId}:${params.category}:${params.title.toLowerCase().trim()}`)
    .digest("hex").slice(0, 20);
  return {
    id,
    organizationId: params.organizationId,
    category: params.category,
    title: params.title,
    content: params.content,
    purpose: params.purpose ?? "",
    riskLevel: params.riskLevel ?? "baixo",
    legalBasis: params.legalBasis ?? "",
    relatedDocumentTypes: params.relatedDocumentTypes ?? [],
    prerequisites: params.prerequisites ?? [],
    active: true,
    createdAt: new Date().toISOString(),
  };
}

export function assessClauseRisk(clause: ClauseKnowledgeItem): { level: ClauseRiskLevel; reason: string } {
  if (clause.riskLevel === "critico") return { level: "critico", reason: "Cláusula marcada como risco crítico" };
  if (clause.prerequisites.length > 3) return { level: "alto", reason: "Muitos pré-requisitos obrigatórios" };
  if (!clause.legalBasis) return { level: "medio", reason: "Sem fundamentação legal explícita" };
  return { level: clause.riskLevel, reason: "Risco conforme classificação" };
}

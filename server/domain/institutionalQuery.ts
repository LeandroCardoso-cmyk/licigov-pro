import { createHash } from "crypto";

// ─── Types ──────────────────────────────────────────────────────────────────

export type QueryIntent =
  | "legal_consultation"
  | "tr_generation"
  | "item_search"
  | "jurisprudence"
  | "compliance_check"
  | "document_review"
  | "general";

export type QueryType =
  | "factual"
  | "analytical"
  | "generative"
  | "comparative"
  | "procedural";

export type ContextStrategy =
  | "full_context"
  | "selective"
  | "minimal"
  | "legal_focused"
  | "municipal_focused";

export type RetrievalStrategy =
  | "hybrid"
  | "semantic_only"
  | "lexical_only"
  | "legal_priority"
  | "municipal_priority";

export interface InstitutionalQuery {
  readonly id: string;
  readonly organizationId: number;
  readonly workflowId: string | null;
  readonly userId: string;
  readonly query: string;
  readonly normalizedQuery: string;
  readonly intent: QueryIntent;
  readonly queryType: QueryType;
  readonly contextStrategy: ContextStrategy;
  readonly retrievalStrategy: RetrievalStrategy;
  readonly createdAt: string;
}

// ─── Functions ──────────────────────────────────────────────────────────────

export function normalizeQuery(raw: string): string {
  return raw.toLowerCase().trim().replace(/\s+/g, " ");
}

export function classifyIntent(query: string): QueryIntent {
  const normalized = normalizeQuery(query);
  if (/\b(lei|artigo|art\.|§|parágrafo|inciso|alínea|decreto|instrução normativa)\b/i.test(normalized)) return "legal_consultation";
  if (/\b(termo de referência|tr |elaborar tr|gerar tr)\b/i.test(normalized)) return "tr_generation";
  if (/\b(item|catmat|catser|material|serviço|produto)\b/i.test(normalized)) return "item_search";
  if (/\b(jurisprudência|acórdão|decisão|tribunal|tcu|tce)\b/i.test(normalized)) return "jurisprudence";
  if (/\b(compliance|conformidade|verificar|validar|checklist)\b/i.test(normalized)) return "compliance_check";
  if (/\b(documento|dfd|etp|edital|parecer|contrato)\b/i.test(normalized)) return "document_review";
  return "general";
}

export function determineContextStrategy(intent: QueryIntent, queryType: QueryType): ContextStrategy {
  if (intent === "legal_consultation" || intent === "jurisprudence") return "legal_focused";
  if (intent === "tr_generation" || intent === "document_review") return "full_context";
  if (queryType === "factual") return "minimal";
  if (queryType === "comparative" || queryType === "analytical") return "selective";
  return "selective";
}

export function determineRetrievalStrategy(intent: QueryIntent, queryType: QueryType): RetrievalStrategy {
  if (intent === "legal_consultation" || intent === "jurisprudence") return "legal_priority";
  if (intent === "item_search") return "lexical_only";
  if (queryType === "factual") return "semantic_only";
  if (queryType === "generative" || queryType === "analytical") return "hybrid";
  return "hybrid";
}

export function createQuery(params: {
  organizationId: number;
  userId: string;
  query: string;
  workflowId?: string | null;
  intent?: QueryIntent;
  queryType?: QueryType;
}): InstitutionalQuery {
  const normalized = normalizeQuery(params.query);
  const intent = params.intent ?? classifyIntent(params.query);
  const queryType = params.queryType ?? "factual";
  const id = createHash("sha256")
    .update(`iq:${params.organizationId}:${normalized}:${params.userId}`)
    .digest("hex").slice(0, 20);
  return {
    id,
    organizationId: params.organizationId,
    workflowId: params.workflowId ?? null,
    userId: params.userId,
    query: params.query,
    normalizedQuery: normalized,
    intent,
    queryType,
    contextStrategy: determineContextStrategy(intent, queryType),
    retrievalStrategy: determineRetrievalStrategy(intent, queryType),
    createdAt: new Date().toISOString(),
  };
}

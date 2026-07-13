/**
 * FASE 5 — Contratação Direta: Justificativas, Documentação, Ratificação, Publicação
 *
 * Agregados finais do fluxo de Dispensa/Inexigibilidade. Todo conteúdo é editável.
 * Determinísticos, multi-tenant, replay-safe.
 */

import { createHash } from "crypto";

// ─── Justificativa da Contratação ─────────────────────────────────────────────

export interface ContractJustification {
  readonly id: string;
  readonly organizationId: number;
  readonly workspaceId: string;
  readonly need: string;
  readonly publicInterest: string;
  readonly motivation: string;
  readonly legalFoundation: string;
  readonly benefits: string;
  readonly alternatives: string;
  readonly correlationId: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export function createContractJustification(params: {
  organizationId: number;
  workspaceId: string;
  need?: string;
  publicInterest?: string;
  motivation?: string;
  legalFoundation?: string;
  benefits?: string;
  alternatives?: string;
  correlationId: string;
  createdAt?: string;
}): ContractJustification {
  const id = createHash("sha256").update(`cjs:${params.organizationId}:${params.workspaceId}`).digest("hex").slice(0, 20);
  const ts = params.createdAt ?? new Date().toISOString();
  return {
    id, organizationId: params.organizationId, workspaceId: params.workspaceId,
    need: params.need ?? "", publicInterest: params.publicInterest ?? "", motivation: params.motivation ?? "",
    legalFoundation: params.legalFoundation ?? "", benefits: params.benefits ?? "", alternatives: params.alternatives ?? "",
    correlationId: params.correlationId, createdAt: ts, updatedAt: ts,
  };
}

// ─── Justificativa do Preço ───────────────────────────────────────────────────

export type PriceJustificationSource = "pesquisa" | "manual" | "documento";

export interface PriceJustification {
  readonly id: string;
  readonly organizationId: number;
  readonly workspaceId: string;
  readonly source: PriceJustificationSource;
  readonly justification: string;
  readonly referenceValue: number;
  readonly researchId: string;
  readonly documentReferences: readonly string[];
  readonly correlationId: string;
  readonly createdAt: string;
}

export function createPriceJustification(params: {
  organizationId: number;
  workspaceId: string;
  source: PriceJustificationSource;
  justification?: string;
  referenceValue?: number;
  researchId?: string;
  documentReferences?: string[];
  correlationId: string;
  createdAt?: string;
}): PriceJustification {
  const id = createHash("sha256").update(`pjs:${params.organizationId}:${params.workspaceId}`).digest("hex").slice(0, 20);
  return {
    id, organizationId: params.organizationId, workspaceId: params.workspaceId, source: params.source,
    justification: params.justification ?? "", referenceValue: params.referenceValue ?? 0, researchId: params.researchId ?? "",
    documentReferences: params.documentReferences ?? [], correlationId: params.correlationId,
    createdAt: params.createdAt ?? new Date().toISOString(),
  };
}

// ─── Documentação Obrigatória (checklist dinâmico) ────────────────────────────

export type RequiredDocumentStatus = "pendente" | "anexado" | "validado";

export interface RequiredDocument {
  readonly id: string;
  readonly organizationId: number;
  readonly workspaceId: string;
  readonly name: string;
  readonly required: boolean;
  readonly status: RequiredDocumentStatus;
  readonly documentReference: string;
  readonly correlationId: string;
}

/** Checklist base por modalidade/fundamento (dinâmico, extensível pelo órgão). */
export function baseRequiredDocuments(type: "dispensa" | "inexigibilidade"): string[] {
  const common = [
    "Documento de Formalização da Demanda (DFD)",
    "Justificativa da Contratação",
    "Justificativa do Preço",
    "Comprovação de regularidade fiscal do contratado",
    "Autorização da autoridade competente",
  ];
  if (type === "inexigibilidade") {
    return [...common, "Comprovação de inviabilidade de competição", "Justificativa de exclusividade / notória especialização"];
  }
  return [...common, "Pesquisa de preços", "Proposta do fornecedor"];
}

export function createRequiredDocument(params: {
  organizationId: number;
  workspaceId: string;
  name: string;
  required?: boolean;
  status?: RequiredDocumentStatus;
  documentReference?: string;
  index?: number;
  correlationId: string;
}): RequiredDocument {
  const id = createHash("sha256")
    .update(`rqd:${params.organizationId}:${params.workspaceId}:${params.name}:${params.index ?? 0}`)
    .digest("hex").slice(0, 20);
  return {
    id, organizationId: params.organizationId, workspaceId: params.workspaceId, name: params.name,
    required: params.required ?? true, status: params.status ?? "pendente", documentReference: params.documentReference ?? "",
    correlationId: params.correlationId,
  };
}

export function attachRequiredDocument(doc: RequiredDocument, reference: string): RequiredDocument {
  return { ...doc, documentReference: reference, status: "anexado" };
}

export function validateRequiredDocument(doc: RequiredDocument): RequiredDocument {
  return { ...doc, status: "validado" };
}

export function pendRequiredDocument(doc: RequiredDocument): RequiredDocument {
  return { ...doc, status: "pendente" };
}

// ─── Ratificação ──────────────────────────────────────────────────────────────

export interface Ratification {
  readonly id: string;
  readonly organizationId: number;
  readonly workspaceId: string;
  readonly responsible: number;
  readonly decision: "ratificado" | "nao_ratificado";
  readonly justification: string;
  readonly evidence: readonly string[];
  readonly correlationId: string;
  readonly ratifiedAt: string;
}

export function createRatification(params: {
  organizationId: number;
  workspaceId: string;
  responsible: number;
  decision?: "ratificado" | "nao_ratificado";
  justification?: string;
  evidence?: string[];
  correlationId: string;
  ratifiedAt?: string;
}): Ratification {
  const id = createHash("sha256").update(`rat:${params.organizationId}:${params.workspaceId}`).digest("hex").slice(0, 20);
  return {
    id, organizationId: params.organizationId, workspaceId: params.workspaceId, responsible: params.responsible,
    decision: params.decision ?? "ratificado", justification: params.justification ?? "", evidence: params.evidence ?? [],
    correlationId: params.correlationId, ratifiedAt: params.ratifiedAt ?? new Date().toISOString(),
  };
}

// ─── Publicação ───────────────────────────────────────────────────────────────

export type PublicationKind = "aviso" | "ratificacao" | "extrato_contrato" | "instrucoes" | "cronograma";

export interface GeneratedPublication {
  readonly id: string;
  readonly organizationId: number;
  readonly workspaceId: string;
  readonly kind: PublicationKind;
  readonly title: string;
  readonly content: string;
  readonly correlationId: string;
  readonly createdAt: string;
}

export function createGeneratedPublication(params: {
  organizationId: number;
  workspaceId: string;
  kind: PublicationKind;
  title: string;
  content: string;
  correlationId: string;
  createdAt?: string;
}): GeneratedPublication {
  const id = createHash("sha256").update(`pub:${params.organizationId}:${params.workspaceId}:${params.kind}`).digest("hex").slice(0, 20);
  return {
    id, organizationId: params.organizationId, workspaceId: params.workspaceId, kind: params.kind,
    title: params.title, content: params.content, correlationId: params.correlationId,
    createdAt: params.createdAt ?? new Date().toISOString(),
  };
}

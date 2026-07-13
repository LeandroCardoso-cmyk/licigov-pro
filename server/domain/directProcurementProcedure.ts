/**
 * FASE 5 — Contratação Direta: Procedimento, Propostas, Fundamento e Necessidade
 *
 * Agregados de apoio ao DirectProcurementWorkspace. Determinísticos, multi-tenant.
 * O recebimento de propostas NÃO faz envio automático (Future Evolution) — apenas
 * registra fornecedores, propostas e documentos anexados por referência.
 */

import { createHash } from "crypto";

// ─── Procedimento (Forma de Condução) ────────────────────────────────────────

export type ProcedureMode = "eletronico" | "presencial";
export type ElectronicPlatform = "compras_gov" | "bll" | "licitanet" | "portal_proprio" | "outra";
export type PresentialReceiptMethod = "email" | "protocolo" | "entrega_presencial" | "outro";

export interface DirectProcurementProcedure {
  readonly id: string;
  readonly organizationId: number;
  readonly workspaceId: string;
  readonly procedureType: ProcedureMode;
  readonly platform: ElectronicPlatform | null;
  readonly receiptMethod: PresentialReceiptMethod | null;
  readonly instructions: string;
  readonly correlationId: string;
  readonly createdAt: string;
}

export function createDirectProcurementProcedure(params: {
  organizationId: number;
  workspaceId: string;
  procedureType: ProcedureMode;
  platform?: ElectronicPlatform | null;
  receiptMethod?: PresentialReceiptMethod | null;
  instructions?: string;
  correlationId: string;
  createdAt?: string;
}): DirectProcurementProcedure {
  const id = createHash("sha256").update(`dpp:${params.organizationId}:${params.workspaceId}`).digest("hex").slice(0, 20);
  return {
    id,
    organizationId: params.organizationId,
    workspaceId: params.workspaceId,
    procedureType: params.procedureType,
    platform: params.procedureType === "eletronico" ? (params.platform ?? null) : null,
    receiptMethod: params.procedureType === "presencial" ? (params.receiptMethod ?? null) : null,
    instructions: params.instructions ?? "",
    correlationId: params.correlationId,
    createdAt: params.createdAt ?? new Date().toISOString(),
  };
}

// ─── Recebimento das Propostas ────────────────────────────────────────────────

export interface ProposalCollection {
  readonly id: string;
  readonly organizationId: number;
  readonly workspaceId: string;
  readonly supplierName: string;
  readonly supplierDocument: string; // CNPJ/CPF
  readonly proposalValue: number;
  readonly protocol: string;
  readonly receivedVia: PresentialReceiptMethod | "sistema";
  readonly correlationId: string;
  readonly createdAt: string;
}

export function createProposalCollection(params: {
  organizationId: number;
  workspaceId: string;
  supplierName: string;
  supplierDocument?: string;
  proposalValue?: number;
  protocol?: string;
  receivedVia?: ProposalCollection["receivedVia"];
  index?: number;
  correlationId: string;
  createdAt?: string;
}): ProposalCollection {
  const id = createHash("sha256")
    .update(`prc:${params.organizationId}:${params.workspaceId}:${params.supplierName}:${params.index ?? 0}`)
    .digest("hex").slice(0, 20);
  return {
    id,
    organizationId: params.organizationId,
    workspaceId: params.workspaceId,
    supplierName: params.supplierName,
    supplierDocument: params.supplierDocument ?? "",
    proposalValue: params.proposalValue ?? 0,
    protocol: params.protocol ?? "",
    receivedVia: params.receivedVia ?? "protocolo",
    correlationId: params.correlationId,
    createdAt: params.createdAt ?? new Date().toISOString(),
  };
}

/** Documento anexado a uma proposta — SEMPRE por referência (nunca cópia). */
export type ProposalDocumentKind = "proposta_pdf" | "email" | "protocolo" | "outro";

export interface ProposalDocument {
  readonly id: string;
  readonly organizationId: number;
  readonly proposalId: string;
  readonly workspaceId: string;
  readonly kind: ProposalDocumentKind;
  readonly title: string;
  readonly documentReference: string; // chave S3/id — nunca conteúdo
  readonly correlationId: string;
  readonly createdAt: string;
}

export function createProposalDocument(params: {
  organizationId: number;
  proposalId: string;
  workspaceId: string;
  kind: ProposalDocumentKind;
  title: string;
  documentReference: string;
  correlationId: string;
  createdAt?: string;
}): ProposalDocument {
  const id = createHash("sha256")
    .update(`prd:${params.organizationId}:${params.proposalId}:${params.documentReference}`)
    .digest("hex").slice(0, 20);
  return {
    id,
    organizationId: params.organizationId,
    proposalId: params.proposalId,
    workspaceId: params.workspaceId,
    kind: params.kind,
    title: params.title,
    documentReference: params.documentReference,
    correlationId: params.correlationId,
    createdAt: params.createdAt ?? new Date().toISOString(),
  };
}

// ─── Fundamento Legal ─────────────────────────────────────────────────────────

/** Fundamentos usuais (Lei 14.133/2021) — nunca bloqueia: o servidor pode alterar. */
export const COMMON_LEGAL_BASIS: Record<string, string[]> = {
  dispensa: ["Art. 75, I", "Art. 75, II", "Art. 75, IV", "Art. 75, VIII"],
  inexigibilidade: ["Art. 74, I", "Art. 74, II", "Art. 74, III", "Art. 74, IV"],
};

export function suggestLegalBasis(type: "dispensa" | "inexigibilidade"): string[] {
  return COMMON_LEGAL_BASIS[type] ?? [];
}

// ─── Caracterização da Necessidade ────────────────────────────────────────────

export interface NeedCharacterization {
  readonly workspaceId: string;
  readonly organizationId: number;
  readonly description: string;
  readonly justification: string;
  readonly estimatedValue: number;
  readonly correlationId: string;
}

export function createNeedCharacterization(params: {
  workspaceId: string;
  organizationId: number;
  description?: string;
  justification?: string;
  estimatedValue?: number;
  correlationId: string;
}): NeedCharacterization {
  return {
    workspaceId: params.workspaceId,
    organizationId: params.organizationId,
    description: params.description ?? "",
    justification: params.justification ?? "",
    estimatedValue: params.estimatedValue ?? 0,
    correlationId: params.correlationId,
  };
}

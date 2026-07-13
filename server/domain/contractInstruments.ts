/**
 * FASE 5 — Contratos: Instrumentos (Aditivos, Apostilamentos, Ocorrências, Minutas)
 *
 * Agregados que representam os instrumentos contratuais e os documentos gerados.
 * Documentos por REFERÊNCIA (nunca duplicados). Determinísticos, multi-tenant.
 */

import { createHash } from "crypto";

// ─── Aditivo (Addendum) ───────────────────────────────────────────────────────

export type AddendumType = "prazo" | "valor" | "quantitativo" | "qualitativo";
export type AddendumStatus = "solicitado" | "justificado" | "minuta" | "aguardando_parecer" | "finalizado";

export interface ContractAddendum {
  readonly id: string;
  readonly organizationId: number;
  readonly contractId: string;
  readonly addendumType: AddendumType;
  readonly sequence: number;
  readonly justification: string;
  readonly newValue: number;
  readonly newTerm: string;
  readonly status: AddendumStatus;
  readonly documentReference: string;
  readonly legalOpinionRequestId: string;
  readonly correlationId: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export function createContractAddendum(params: {
  organizationId: number;
  contractId: string;
  addendumType: AddendumType;
  sequence: number;
  justification?: string;
  newValue?: number;
  newTerm?: string;
  correlationId: string;
  createdAt?: string;
}): ContractAddendum {
  const id = createHash("sha256")
    .update(`add:${params.organizationId}:${params.contractId}:${params.sequence}`)
    .digest("hex").slice(0, 20);
  const ts = params.createdAt ?? new Date().toISOString();
  return {
    id, organizationId: params.organizationId, contractId: params.contractId, addendumType: params.addendumType,
    sequence: params.sequence, justification: params.justification ?? "", newValue: params.newValue ?? 0,
    newTerm: params.newTerm ?? "", status: params.justification ? "justificado" : "solicitado",
    documentReference: "", legalOpinionRequestId: "", correlationId: params.correlationId, createdAt: ts, updatedAt: ts,
  };
}

const ADDENDUM_TRANSITIONS: Record<AddendumStatus, AddendumStatus[]> = {
  solicitado: ["justificado"],
  justificado: ["minuta"],
  minuta: ["aguardando_parecer", "finalizado"],
  aguardando_parecer: ["finalizado"],
  finalizado: [],
};

export function advanceAddendum(a: ContractAddendum, to: AddendumStatus, at?: string): ContractAddendum {
  if (!ADDENDUM_TRANSITIONS[a.status].includes(to)) {
    throw new Error(`Transição de aditivo inválida: ${a.status} → ${to}`);
  }
  return { ...a, status: to, updatedAt: at ?? new Date().toISOString() };
}

// ─── Apostilamento (Apostille) ────────────────────────────────────────────────

export type ApostilleKind = "reajuste" | "gestor" | "fiscal" | "legal";

export interface ContractApostille {
  readonly id: string;
  readonly organizationId: number;
  readonly contractId: string;
  readonly kind: ApostilleKind;
  readonly sequence: number;
  readonly description: string;
  readonly newValue: number;
  readonly newManager: string;
  readonly newInspector: string;
  readonly documentReference: string;
  readonly correlationId: string;
  readonly createdAt: string;
}

export function createContractApostille(params: {
  organizationId: number;
  contractId: string;
  kind: ApostilleKind;
  sequence: number;
  description?: string;
  newValue?: number;
  newManager?: string;
  newInspector?: string;
  correlationId: string;
  createdAt?: string;
}): ContractApostille {
  const id = createHash("sha256")
    .update(`apo:${params.organizationId}:${params.contractId}:${params.sequence}`)
    .digest("hex").slice(0, 20);
  return {
    id, organizationId: params.organizationId, contractId: params.contractId, kind: params.kind, sequence: params.sequence,
    description: params.description ?? "", newValue: params.newValue ?? 0, newManager: params.newManager ?? "",
    newInspector: params.newInspector ?? "", documentReference: "", correlationId: params.correlationId,
    createdAt: params.createdAt ?? new Date().toISOString(),
  };
}

// ─── Ocorrência (registro simples — sem workflow complexo) ────────────────────

export interface ContractOccurrence {
  readonly id: string;
  readonly organizationId: number;
  readonly contractId: string;
  readonly description: string;
  readonly occurredOn: string;
  readonly attachments: readonly string[];
  readonly notes: string;
  readonly correlationId: string;
  readonly createdAt: string;
}

export function createContractOccurrence(params: {
  organizationId: number;
  contractId: string;
  description: string;
  occurredOn?: string;
  attachments?: string[];
  notes?: string;
  index?: number;
  correlationId: string;
  createdAt?: string;
}): ContractOccurrence {
  const id = createHash("sha256")
    .update(`occ:${params.organizationId}:${params.contractId}:${params.index ?? 0}:${params.description}`)
    .digest("hex").slice(0, 20);
  const ts = params.createdAt ?? new Date().toISOString();
  return {
    id, organizationId: params.organizationId, contractId: params.contractId, description: params.description,
    occurredOn: params.occurredOn ?? ts, attachments: params.attachments ?? [], notes: params.notes ?? "",
    correlationId: params.correlationId, createdAt: ts,
  };
}

// ─── Documento gerado (minuta) — por referência, nunca duplicado ──────────────

export type ContractDocumentKind = "contrato" | "aditivo" | "apostilamento" | "rescisao" | "anexo";

export interface ContractGeneratedDocument {
  readonly id: string;
  readonly organizationId: number;
  readonly contractId: string;
  readonly kind: ContractDocumentKind;
  readonly title: string;
  readonly content: string;
  readonly refId: string;
  readonly correlationId: string;
  readonly createdAt: string;
}

export function createContractGeneratedDocument(params: {
  organizationId: number;
  contractId: string;
  kind: ContractDocumentKind;
  title: string;
  content: string;
  refId?: string;
  correlationId: string;
  createdAt?: string;
}): ContractGeneratedDocument {
  const id = createHash("sha256")
    .update(`cdoc:${params.organizationId}:${params.contractId}:${params.kind}:${params.refId ?? ""}`)
    .digest("hex").slice(0, 20);
  return {
    id, organizationId: params.organizationId, contractId: params.contractId, kind: params.kind, title: params.title,
    content: params.content, refId: params.refId ?? "", correlationId: params.correlationId,
    createdAt: params.createdAt ?? new Date().toISOString(),
  };
}

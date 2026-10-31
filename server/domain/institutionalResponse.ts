/**
 * Kernel — Institutional Response
 *
 * Resposta de uma solicitação institucional, devolvida automaticamente ao domínio
 * de origem. Suporta assinatura (apenas placeholders de infraestrutura — manual,
 * ICP-Brasil, GOV.BR, certificado A1). Determinístico.
 */

import { createHash } from "crypto";

export type ResponseType = "parecer" | "revisao" | "aprovacao" | "informacao" | "correcao" | "assinatura";

export type ResponseStatus = "favoravel" | "desfavoravel" | "com_ressalvas" | "informativo" | "concluido";

/** Métodos de assinatura previstos (infraestrutura apenas — não implementada). */
export type SignatureMethod = "manual" | "icp_brasil" | "gov_br" | "certificado_a1";

export interface InstitutionalResponse {
  readonly id: string;
  readonly requestId: string;
  readonly organizationId: number;
  readonly responder: number;
  readonly responseType: ResponseType;
  readonly responseStatus: ResponseStatus;
  readonly comments: string;
  readonly attachedDocuments: readonly string[];
  readonly signed: boolean;
  readonly signatureMethod: SignatureMethod | null;
  readonly signedAt: string | null;
  readonly correlationId: string;
  readonly createdAt: string;
}

export function createInstitutionalResponse(params: {
  requestId: string;
  organizationId: number;
  responder: number;
  responseType: ResponseType;
  responseStatus: ResponseStatus;
  comments?: string;
  attachedDocuments?: string[];
  correlationId: string;
  createdAt?: string;
}): InstitutionalResponse {
  const id = createHash("sha256")
    .update(`ires:${params.organizationId}:${params.requestId}:${params.responder}`)
    .digest("hex").slice(0, 20);
  return {
    id,
    requestId: params.requestId,
    organizationId: params.organizationId,
    responder: params.responder,
    responseType: params.responseType,
    responseStatus: params.responseStatus,
    comments: params.comments ?? "",
    attachedDocuments: params.attachedDocuments ?? [],
    signed: false,
    signatureMethod: null,
    signedAt: null,
    correlationId: params.correlationId,
    createdAt: params.createdAt ?? new Date().toISOString(),
  };
}

/**
 * Placeholder de assinatura — marca a resposta como assinada por um método.
 * NÃO implementa assinatura digital real; apenas registra a infraestrutura.
 */
export function signResponse(response: InstitutionalResponse, method: SignatureMethod, signedAt: string): InstitutionalResponse {
  return { ...response, signed: true, signatureMethod: method, signedAt };
}

export const SUPPORTED_SIGNATURE_METHODS: SignatureMethod[] = ["manual", "icp_brasil", "gov_br", "certificado_a1"];

// ─── NEW-007 — proveniência do parecer entregue aos consumidores ─────────────

/**
 * `GOVERNED_LEGAL_OPINION` — resposta comprovadamente devolvida pelo fluxo do Parecer (workspace + parecer assinado + procurador
 * designado); `PENDING` — solicitação jurídica coerente ainda sem resposta; `NOT_GOVERNED` — qualquer outra coisa: resposta
 * institucional (histórico preservado), nunca apresentada como parecer jurídico. A marcação `signed` da resposta institucional
 * NÃO é prova de origem (é placeholder de infraestrutura).
 */
export type LegalOpinionProvenanceStatus = "GOVERNED_LEGAL_OPINION" | "PENDING" | "NOT_GOVERNED";
export type LegalOpinionProvenanceReason =
  | "GOVERNED" | "AWAITING_LEGAL_OPINION" | "REQUEST_NOT_FOUND" | "SOURCE_DOMAIN_MISMATCH" | "NOT_LEGAL_OPINION_REQUEST"
  | "LEGAL_OPINION_ROUTING_INVALID" | "NOT_PARECER_RESPONSE" | "NO_GOVERNED_WORKSPACE" | "OPINION_NOT_SIGNED"
  | "RESPONDER_NOT_DESIGNATED_LAWYER" | "WORKSPACE_NOT_RETURNED";

export interface LegalOpinionProvenance {
  readonly status: LegalOpinionProvenanceStatus;
  readonly reason: LegalOpinionProvenanceReason;
  readonly workspaceId?: string;
  readonly signedBy?: number | null;
  readonly signatureMethod?: string | null;
  readonly signedAt?: string | null;
}

const LEGAL_TYPES = new Set(["LEGAL_OPINION_INITIAL", "LEGAL_OPINION_FINAL"]);

/** Classificação determinística (pura) — mesma regra para Contratos, Contratação Direta e a leitura genérica. */
export function classifyLegalOpinionProvenance(p: {
  request: { sourceDomain: string; destinationDomain: string; requestType: string } | null;
  /** Domínio de origem que o consumidor espera (Contratos ⇒ `contratos`); omitido na leitura genérica. */
  expectedSourceDomain?: string;
  response: { responseType: string; responder: number } | null;
  workspace: { id: string; requestId: string; assignedLawyer: number | null; currentStage: string } | null;
  draft: { workspaceId: string; signed: boolean; signedBy: number | null; signatureMethod: string | null; signedAt: string | null } | null;
}): LegalOpinionProvenance {
  const no = (reason: LegalOpinionProvenanceReason): LegalOpinionProvenance => ({ status: "NOT_GOVERNED", reason });
  const { request, response, workspace, draft } = p;
  if (!request) return no("REQUEST_NOT_FOUND");
  if (p.expectedSourceDomain && request.sourceDomain !== p.expectedSourceDomain) return no("SOURCE_DOMAIN_MISMATCH");
  if (request.destinationDomain !== "parecer_juridico") {
    return no(LEGAL_TYPES.has(request.requestType) ? "LEGAL_OPINION_ROUTING_INVALID" : "NOT_LEGAL_OPINION_REQUEST");
  }
  if (!response) return { status: "PENDING", reason: "AWAITING_LEGAL_OPINION" };
  if (response.responseType !== "parecer") return no("NOT_PARECER_RESPONSE");
  if (!workspace) return no("NO_GOVERNED_WORKSPACE");
  if (!draft || draft.workspaceId !== workspace.id || !draft.signed) return no("OPINION_NOT_SIGNED");
  if (workspace.assignedLawyer == null || response.responder !== workspace.assignedLawyer) return no("RESPONDER_NOT_DESIGNATED_LAWYER");
  if (workspace.currentStage !== "RETURNED" && workspace.currentStage !== "ARCHIVED") return no("WORKSPACE_NOT_RETURNED");
  return { status: "GOVERNED_LEGAL_OPINION", reason: "GOVERNED", workspaceId: workspace.id, signedBy: draft.signedBy, signatureMethod: draft.signatureMethod, signedAt: draft.signedAt };
}

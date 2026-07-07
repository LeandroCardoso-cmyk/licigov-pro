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

/**
 * Kernel — Institutional Request Engine
 *
 * Solicitação institucional trocada entre Business Domains SEM acoplamento direto.
 * Os domínios nunca conversam entre si — toda comunicação passa por este Engine.
 * Componente do Cognitive Kernel. Determinístico, multi-tenant, replay-safe.
 */

import { createHash } from "crypto";

export type BusinessDomainCode =
  | "processo_licitatorio"
  | "contratacao_direta"
  | "contratos"
  | "parecer_juridico"
  | "gestao_departamento"
  | "controle_interno";

export type RequestType =
  | "LEGAL_OPINION_INITIAL"
  | "LEGAL_OPINION_FINAL"
  | "CONTROL_REVIEW"
  | "TECHNICAL_REVIEW"
  | "DOCUMENT_REVIEW"
  | "APPROVAL"
  | "SIGNATURE"
  | "INFORMATION_REQUEST"
  | "CORRECTION_REQUEST";

export type RequestStatus =
  | "NEW"
  | "PENDING"
  | "RECEIVED"
  | "IN_PROGRESS"
  | "WAITING_INFORMATION"
  | "COMPLETED"
  | "RETURNED"
  | "ARCHIVED";

export type RequestPriority = "baixa" | "media" | "alta" | "urgente";

export interface InstitutionalRequest {
  readonly id: string;
  readonly organizationId: number;
  readonly sourceDomain: BusinessDomainCode;
  readonly destinationDomain: BusinessDomainCode;
  readonly requestType: RequestType;
  readonly referenceProcessId: string;
  readonly referenceDocumentId: string;
  readonly title: string;
  readonly description: string;
  readonly priority: RequestPriority;
  readonly status: RequestStatus;
  readonly requestedBy: number;
  readonly assignedTo: number | null;
  readonly correlationId: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

const STATUS_TRANSITIONS: Record<RequestStatus, RequestStatus[]> = {
  NEW: ["PENDING", "ARCHIVED"],
  PENDING: ["RECEIVED", "RETURNED", "ARCHIVED"],
  RECEIVED: ["IN_PROGRESS", "RETURNED", "ARCHIVED"],
  IN_PROGRESS: ["WAITING_INFORMATION", "COMPLETED", "RETURNED", "ARCHIVED"],
  WAITING_INFORMATION: ["IN_PROGRESS", "RETURNED", "ARCHIVED"],
  COMPLETED: ["RETURNED", "ARCHIVED"],
  RETURNED: ["ARCHIVED", "PENDING"],
  ARCHIVED: [],
};

export function createInstitutionalRequest(params: {
  organizationId: number;
  sourceDomain: BusinessDomainCode;
  destinationDomain: BusinessDomainCode;
  requestType: RequestType;
  referenceProcessId: string;
  referenceDocumentId?: string;
  title: string;
  description?: string;
  priority?: RequestPriority;
  requestedBy: number;
  correlationId: string;
  createdAt?: string;
}): InstitutionalRequest {
  const id = createHash("sha256")
    .update(`ireq:${params.organizationId}:${params.sourceDomain}:${params.destinationDomain}:${params.requestType}:${params.referenceProcessId}:${params.correlationId}`)
    .digest("hex").slice(0, 20);
  const ts = params.createdAt ?? new Date().toISOString();
  return {
    id,
    organizationId: params.organizationId,
    sourceDomain: params.sourceDomain,
    destinationDomain: params.destinationDomain,
    requestType: params.requestType,
    referenceProcessId: params.referenceProcessId,
    referenceDocumentId: params.referenceDocumentId ?? "",
    title: params.title,
    description: params.description ?? "",
    priority: params.priority ?? "media",
    status: "NEW",
    requestedBy: params.requestedBy,
    assignedTo: null,
    correlationId: params.correlationId,
    createdAt: ts,
    updatedAt: ts,
  };
}

export function canTransition(from: RequestStatus, to: RequestStatus): boolean {
  return STATUS_TRANSITIONS[from].includes(to);
}

export function transition(request: InstitutionalRequest, to: RequestStatus, at?: string): InstitutionalRequest {
  if (!canTransition(request.status, to)) {
    throw new Error(`Transição de solicitação inválida: ${request.status} → ${to}`);
  }
  return { ...request, status: to, updatedAt: at ?? new Date().toISOString() };
}

export function assignTo(request: InstitutionalRequest, userId: number, at?: string): InstitutionalRequest {
  return { ...request, assignedTo: userId, updatedAt: at ?? new Date().toISOString() };
}

export function isTerminal(request: InstitutionalRequest): boolean {
  return STATUS_TRANSITIONS[request.status].length === 0;
}

/** Solicitações "pendentes" para a inbox de um domínio (aguardando ação do destino). */
export function isPendingForDestination(request: InstitutionalRequest): boolean {
  return request.status === "PENDING" || request.status === "RECEIVED" || request.status === "IN_PROGRESS" || request.status === "WAITING_INFORMATION";
}

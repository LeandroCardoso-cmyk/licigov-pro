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

// ─── NEW-007 — autoridade jurídica: roteamento e fluxo governado ─────────────

/** Domínio dono do parecer jurídico governado (procurador designado, `legalOpinionWorkspace.*`). */
export const LEGAL_OPINION_DOMAIN: BusinessDomainCode = "parecer_juridico";
/** Tipos juridicamente tipificados: só o domínio Parecer Jurídico os trata. */
export const LEGAL_OPINION_REQUEST_TYPES: readonly RequestType[] = ["LEGAL_OPINION_INITIAL", "LEGAL_OPINION_FINAL"];
export const LEGAL_OPINION_ROUTING_INVALID = "LEGAL_OPINION_ROUTING_INVALID";
export const LEGAL_OPINION_GOVERNED_FLOW = "LEGAL_OPINION_GOVERNED_FLOW";

export function isLegalOpinionRequestType(requestType: string | null | undefined): boolean {
  return (LEGAL_OPINION_REQUEST_TYPES as readonly string[]).includes(requestType ?? "");
}

/**
 * Solicitação que só o fluxo GOVERNADO do Parecer pode designar, receber, responder/assinar, devolver ou arquivar: destinada ao
 * Parecer Jurídico OU juridicamente tipificada (inclusive registro legado incoerente, p.ex. `LEGAL_OPINION_*` → `controle_interno`,
 * que nunca é tratado — nem promovido — pelo caminho genérico).
 */
export function requiresGovernedLegalOpinionFlow(request: { destinationDomain: string; requestType?: string | null }): boolean {
  return request.destinationDomain === LEGAL_OPINION_DOMAIN || isLegalOpinionRequestType(request.requestType);
}

/**
 * Roteamento coerente na CRIAÇÃO (antes de qualquer escrita). Origem ≠ destino; `LEGAL_OPINION_*` só com destino Parecer Jurídico
 * (senão a solicitação escaparia da guarda do fluxo governado e voltaria como "parecer"). Pedidos técnicos (CONTROL_REVIEW,
 * TECHNICAL_REVIEW, DOCUMENT_REVIEW…) seguem livres entre domínios. Retorna a mensagem da recusa, ou null.
 */
export function requestRoutingViolation(p: { sourceDomain: string; destinationDomain: string; requestType: string }): string | null {
  if (p.sourceDomain === p.destinationDomain) return "Origem e destino não podem ser o mesmo domínio.";
  if (isLegalOpinionRequestType(p.requestType) && p.destinationDomain !== LEGAL_OPINION_DOMAIN) {
    return `${LEGAL_OPINION_ROUTING_INVALID}: solicitação de parecer jurídico (${p.requestType}) só pode ser destinada ao domínio Parecer Jurídico; para análise técnica use um pedido técnico (ex.: revisão do controle interno).`;
  }
  return null;
}

/**
 * FASE 5 — Business Domain: Parecer Jurídico
 *
 * LegalOpinionWorkspace representa TODO o trabalho do Procurador sobre UMA
 * solicitação institucional recebida. Este domínio NÃO cria processos: consome
 * solicitações vindas do Institutional Request Engine e devolve o parecer à
 * origem pelo mesmo Engine — jamais acessa outro Business Domain diretamente.
 *
 * Cada etapa é um ESTADO com regras próprias. Determinístico, multi-tenant,
 * replay-safe. Todo acesso ao Kernel ocorre via kernelAccessService.
 */

import { createHash } from "crypto";

/** Etapas do fluxo do Procurador dentro da Caixa Institucional. */
export type LegalOpinionStage =
  | "INBOX"
  | "RECEIVED"
  | "UNDER_ANALYSIS"
  | "WAITING_INFORMATION"
  | "DRAFT"
  | "REVIEW"
  | "SIGNED"
  | "RETURNED"
  | "ARCHIVED";

export type LegalOpinionWorkspaceStatus =
  | "na_caixa"
  | "recebido"
  | "em_analise"
  | "aguardando_informacao"
  | "em_elaboracao"
  | "em_revisao"
  | "assinado"
  | "devolvido"
  | "arquivado";

export type LegalOpinionPriority = "baixa" | "media" | "alta" | "urgente";

export interface LegalOpinionWorkspace {
  readonly id: string;
  readonly organizationId: number;
  /** Solicitação institucional que originou este trabalho (nunca copiada). */
  readonly requestId: string;
  /** Domínio que solicitou o parecer (para devolução automática). */
  readonly sourceDomain: string;
  /** Processo referenciado por REFERÊNCIA (nunca acessado diretamente). */
  readonly referenceProcessId: string;
  readonly requestType: string;
  readonly currentStage: LegalOpinionStage;
  readonly status: LegalOpinionWorkspaceStatus;
  readonly assignedLawyer: number | null;
  readonly responsibleSector: string;
  readonly priority: LegalOpinionPriority;
  readonly correlationId: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/** Ordem canônica das etapas. */
export const LEGAL_OPINION_STAGE_ORDER: LegalOpinionStage[] = [
  "INBOX", "RECEIVED", "UNDER_ANALYSIS", "WAITING_INFORMATION",
  "DRAFT", "REVIEW", "SIGNED", "RETURNED", "ARCHIVED",
];

const STAGE_TRANSITIONS: Record<LegalOpinionStage, LegalOpinionStage[]> = {
  INBOX: ["RECEIVED", "ARCHIVED"],
  RECEIVED: ["UNDER_ANALYSIS", "ARCHIVED"],
  UNDER_ANALYSIS: ["WAITING_INFORMATION", "DRAFT", "ARCHIVED"],
  WAITING_INFORMATION: ["UNDER_ANALYSIS", "ARCHIVED"],
  DRAFT: ["REVIEW", "UNDER_ANALYSIS", "ARCHIVED"],
  REVIEW: ["SIGNED", "DRAFT", "ARCHIVED"],
  SIGNED: ["RETURNED", "ARCHIVED"],
  RETURNED: ["ARCHIVED"],
  ARCHIVED: [],
};

const STAGE_STATUS: Record<LegalOpinionStage, LegalOpinionWorkspaceStatus> = {
  INBOX: "na_caixa",
  RECEIVED: "recebido",
  UNDER_ANALYSIS: "em_analise",
  WAITING_INFORMATION: "aguardando_informacao",
  DRAFT: "em_elaboracao",
  REVIEW: "em_revisao",
  SIGNED: "assinado",
  RETURNED: "devolvido",
  ARCHIVED: "arquivado",
};

export function createLegalOpinionWorkspace(params: {
  organizationId: number;
  requestId: string;
  sourceDomain: string;
  referenceProcessId: string;
  requestType: string;
  assignedLawyer?: number | null;
  responsibleSector?: string;
  priority?: LegalOpinionPriority;
  correlationId: string;
  createdAt?: string;
}): LegalOpinionWorkspace {
  const id = createHash("sha256")
    .update(`low:${params.organizationId}:${params.requestId}`)
    .digest("hex").slice(0, 20);
  const ts = params.createdAt ?? new Date().toISOString();
  return {
    id,
    organizationId: params.organizationId,
    requestId: params.requestId,
    sourceDomain: params.sourceDomain,
    referenceProcessId: params.referenceProcessId,
    requestType: params.requestType,
    currentStage: "INBOX",
    status: "na_caixa",
    assignedLawyer: params.assignedLawyer ?? null,
    responsibleSector: params.responsibleSector ?? "",
    priority: params.priority ?? "media",
    correlationId: params.correlationId,
    createdAt: ts,
    updatedAt: ts,
  };
}

export function canLegalTransition(from: LegalOpinionStage, to: LegalOpinionStage): boolean {
  return STAGE_TRANSITIONS[from].includes(to);
}

/** Move o workspace para uma etapa, validando a transição. Lança se inválida. */
export function transitionLegalStage(
  ws: LegalOpinionWorkspace,
  to: LegalOpinionStage,
  at?: string,
): LegalOpinionWorkspace {
  if (!canLegalTransition(ws.currentStage, to)) {
    throw new Error(`Transição de parecer inválida: ${ws.currentStage} → ${to}`);
  }
  return { ...ws, currentStage: to, status: STAGE_STATUS[to], updatedAt: at ?? new Date().toISOString() };
}

export function assignLawyer(ws: LegalOpinionWorkspace, lawyerId: number, at?: string): LegalOpinionWorkspace {
  return { ...ws, assignedLawyer: lawyerId, updatedAt: at ?? new Date().toISOString() };
}

export function isLegalTerminal(ws: LegalOpinionWorkspace): boolean {
  return STAGE_TRANSITIONS[ws.currentStage].length === 0;
}

/** Etapas em que o parecer ainda está sendo trabalhado (aparece na caixa). */
export function isLegalActive(ws: LegalOpinionWorkspace): boolean {
  return ws.currentStage !== "RETURNED" && ws.currentStage !== "ARCHIVED";
}

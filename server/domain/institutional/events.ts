/**
 * RC-4.3 — Institutional Operating Model · Eventos institucionais (declarativo).
 *
 * Modela os EVENTOS do Departamento de Licitações. Cada evento declara origem, destino,
 * objetos relacionados e papéis envolvidos. Declarativo — não é workflow nem automação.
 * Puro e determinístico.
 */

import type { InstitutionalObjectId } from "./objects";
import type { InstitutionalRoleId } from "./roles";

export type InstitutionalEventId =
  | "recebimento" | "solicitacao" | "publicacao" | "sessao" | "assinatura"
  | "vigencia" | "vencimento" | "renovacao" | "rescisao" | "arquivamento";

export interface InstitutionalEvent {
  readonly id: InstitutionalEventId;
  readonly name: string;
  /** Objeto/estado de origem do evento (declarativo). */
  readonly origin: string;
  /** Objeto/estado de destino do evento (declarativo). */
  readonly destination: string;
  readonly relatedObjects: readonly InstitutionalObjectId[];
  readonly involvedRoles: readonly InstitutionalRoleId[];
}

export const INSTITUTIONAL_EVENTS: Record<InstitutionalEventId, InstitutionalEvent> = {
  solicitacao: { id: "solicitacao", name: "Solicitação", origin: "necessidade", destination: "dfd", relatedObjects: ["dfd", "processo"], involvedRoles: ["solicitante", "departamento_licitacoes"] },
  recebimento: { id: "recebimento", name: "Recebimento", origin: "dfd", destination: "processo", relatedObjects: ["processo", "dfd"], involvedRoles: ["departamento_licitacoes"] },
  publicacao: { id: "publicacao", name: "Publicação", origin: "documento", destination: "ato_publicado", relatedObjects: ["edital", "aviso", "ata", "publicacao"], involvedRoles: ["departamento_licitacoes"] },
  sessao: { id: "sessao", name: "Sessão", origin: "edital", destination: "ata", relatedObjects: ["sessao", "edital", "ata"], involvedRoles: ["agente_contratacao", "comissao", "fornecedor"] },
  assinatura: { id: "assinatura", name: "Assinatura", origin: "processo", destination: "contrato", relatedObjects: ["contrato", "processo"], involvedRoles: ["autoridade_competente", "fornecedor", "gestor_contrato"] },
  vigencia: { id: "vigencia", name: "Vigência", origin: "contrato", destination: "execucao", relatedObjects: ["contrato"], involvedRoles: ["gestor_contrato", "fiscal_contrato"] },
  vencimento: { id: "vencimento", name: "Vencimento", origin: "contrato", destination: "encerramento", relatedObjects: ["contrato"], involvedRoles: ["gestor_contrato"] },
  renovacao: { id: "renovacao", name: "Renovação", origin: "contrato", destination: "aditivo", relatedObjects: ["contrato", "aditivo"], involvedRoles: ["gestor_contrato", "autoridade_competente"] },
  rescisao: { id: "rescisao", name: "Rescisão", origin: "contrato", destination: "encerramento", relatedObjects: ["contrato"], involvedRoles: ["gestor_contrato", "autoridade_competente"] },
  arquivamento: { id: "arquivamento", name: "Arquivamento", origin: "processo", destination: "arquivo", relatedObjects: ["processo", "contrato"], involvedRoles: ["departamento_licitacoes"] },
};

export const ALL_EVENT_IDS: InstitutionalEventId[] = Object.keys(INSTITUTIONAL_EVENTS) as InstitutionalEventId[];

export function isInstitutionalEvent(id: string): id is InstitutionalEventId {
  return id in INSTITUTIONAL_EVENTS;
}

export function getInstitutionalEvent(id: InstitutionalEventId): InstitutionalEvent {
  return INSTITUTIONAL_EVENTS[id];
}

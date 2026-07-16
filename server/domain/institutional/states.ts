/**
 * RC-4.3 — Institutional Operating Model · Estados institucionais (declarativo).
 *
 * Modela os ESTADOS possíveis dos objetos institucionais e suas TRANSIÇÕES permitidas.
 * É declarativo: NÃO é workflow, NÃO automatiza, NÃO executa. Apenas descreve os estados
 * que um objeto pode assumir e para quais estados pode transicionar. Puro e determinístico.
 */

export type InstitutionalStateId =
  | "recebido"
  | "em_elaboracao"
  | "em_revisao"
  | "aguardando_aprovacao"
  | "publicado"
  | "em_execucao"
  | "suspenso"
  | "cancelado"
  | "concluido"
  | "arquivado";

export interface InstitutionalState {
  readonly id: InstitutionalStateId;
  readonly name: string;
  /** Estados para os quais este estado PODE transicionar (declarativo — não é automação). */
  readonly transitions: readonly InstitutionalStateId[];
}

export const INSTITUTIONAL_STATES: Record<InstitutionalStateId, InstitutionalState> = {
  recebido: { id: "recebido", name: "Recebido", transitions: ["em_elaboracao", "arquivado", "cancelado"] },
  em_elaboracao: { id: "em_elaboracao", name: "Em elaboração", transitions: ["em_revisao", "cancelado"] },
  em_revisao: { id: "em_revisao", name: "Em revisão", transitions: ["aguardando_aprovacao", "em_elaboracao", "cancelado"] },
  aguardando_aprovacao: { id: "aguardando_aprovacao", name: "Aguardando aprovação", transitions: ["publicado", "em_revisao", "cancelado"] },
  publicado: { id: "publicado", name: "Publicado", transitions: ["em_execucao", "suspenso", "cancelado"] },
  em_execucao: { id: "em_execucao", name: "Em execução", transitions: ["suspenso", "concluido", "cancelado"] },
  suspenso: { id: "suspenso", name: "Suspenso", transitions: ["em_execucao", "cancelado", "concluido"] },
  cancelado: { id: "cancelado", name: "Cancelado", transitions: ["arquivado"] },
  concluido: { id: "concluido", name: "Concluído", transitions: ["arquivado"] },
  arquivado: { id: "arquivado", name: "Arquivado", transitions: [] },
};

export const ALL_STATE_IDS: InstitutionalStateId[] = Object.keys(INSTITUTIONAL_STATES) as InstitutionalStateId[];

export function isInstitutionalState(id: string): id is InstitutionalStateId {
  return id in INSTITUTIONAL_STATES;
}

export function getInstitutionalState(id: InstitutionalStateId): InstitutionalState {
  return INSTITUTIONAL_STATES[id];
}

/** true se a transição declarada é válida (declarativa — não executa nada). */
export function canTransition(from: InstitutionalStateId, to: InstitutionalStateId): boolean {
  return INSTITUTIONAL_STATES[from]?.transitions.includes(to) ?? false;
}

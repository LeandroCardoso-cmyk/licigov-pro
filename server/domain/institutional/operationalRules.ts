/**
 * RC-4.3 — Institutional Operating Model · Regras operacionais (declarativo).
 *
 * Regras INSTITUCIONAIS/OPERACIONAIS declarativas (NÃO jurídicas): "Não existe X sem Y".
 * Descrevem dependências operacionais de existência entre objetos do departamento.
 * Puro e determinístico — nada executável.
 */

import type { InstitutionalObjectId } from "./objects";

export interface OperationalRule {
  readonly id: string;
  /** Enunciado declarativo ("Não existe X sem Y"). */
  readonly statement: string;
  /** Objeto que não existe sem o pré-requisito. */
  readonly subject: InstitutionalObjectId;
  /** Pré-requisito operacional. */
  readonly requires: InstitutionalObjectId;
}

export const OPERATIONAL_RULES: Record<string, OperationalRule> = {
  contrato_requer_processo: { id: "contrato_requer_processo", statement: "Não existe Contrato sem Contratação", subject: "contrato", requires: "processo" },
  aditivo_requer_contrato: { id: "aditivo_requer_contrato", statement: "Não existe Aditivo sem Contrato", subject: "aditivo", requires: "contrato" },
  apostilamento_requer_contrato: { id: "apostilamento_requer_contrato", statement: "Não existe Apostilamento sem Contrato", subject: "apostilamento", requires: "contrato" },
  publicacao_requer_documento: { id: "publicacao_requer_documento", statement: "Não existe Publicação sem Documento", subject: "publicacao", requires: "edital" },
  sessao_requer_edital: { id: "sessao_requer_edital", statement: "Não existe Sessão sem Edital", subject: "sessao", requires: "edital" },
  ata_requer_sessao: { id: "ata_requer_sessao", statement: "Não existe Ata sem Sessão", subject: "ata", requires: "sessao" },
  aviso_requer_edital: { id: "aviso_requer_edital", statement: "Não existe Aviso sem Edital", subject: "aviso", requires: "edital" },
  empenho_requer_contrato: { id: "empenho_requer_contrato", statement: "Não existe Empenho sem Contrato", subject: "empenho", requires: "contrato" },
  etp_requer_dfd: { id: "etp_requer_dfd", statement: "Não existe ETP sem DFD", subject: "etp", requires: "dfd" },
  tr_requer_etp: { id: "tr_requer_etp", statement: "Não existe TR sem ETP", subject: "tr", requires: "etp" },
};

export const ALL_OPERATIONAL_RULE_IDS: string[] = Object.keys(OPERATIONAL_RULES);

export function getOperationalRule(id: string): OperationalRule | null {
  return OPERATIONAL_RULES[id] ?? null;
}

/** Regras operacionais que se aplicam a um objeto (como subject). */
export function operationalRulesForObject(objectId: InstitutionalObjectId): OperationalRule[] {
  return ALL_OPERATIONAL_RULE_IDS.map(id => OPERATIONAL_RULES[id]).filter(r => r.subject === objectId).sort((a, b) => a.id.localeCompare(b.id));
}

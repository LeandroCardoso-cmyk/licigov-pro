/**
 * RC-4.3.1 — Cenários institucionais (testes de expressividade).
 *
 * Prova que a Ontologia Operacional representa qualquer processo administrativo de
 * licitações SEM alterações estruturais. Cada cenário é uma COMPOSIÇÃO de elementos
 * EXISTENTES (papéis/objetos/eventos/estados) — nenhum conceito novo, nenhum conteúdo
 * jurídico. Declarativo e determinístico.
 */

import { isInstitutionalObject, type InstitutionalObjectId } from "./objects";
import { isInstitutionalRole, type InstitutionalRoleId } from "./roles";
import { isInstitutionalEvent, type InstitutionalEventId } from "./events";
import { isInstitutionalState, type InstitutionalStateId } from "./states";

export interface InstitutionalScenario {
  readonly id: string;
  readonly name: string;
  readonly objects: readonly InstitutionalObjectId[];
  readonly roles: readonly InstitutionalRoleId[];
  readonly events: readonly InstitutionalEventId[];
  readonly states: readonly InstitutionalStateId[];
}

const FULL_FLOW: InstitutionalObjectId[] = ["processo", "dfd", "etp", "tr", "pesquisa_precos", "edital", "aviso", "sessao", "ata", "contrato"];
const CORE_ROLES: InstitutionalRoleId[] = ["solicitante", "departamento_licitacoes", "agente_contratacao", "autoridade_competente", "fornecedor", "gestor_contrato", "fiscal_contrato"];
const CORE_STATES: InstitutionalStateId[] = ["em_elaboracao", "em_revisao", "aguardando_aprovacao", "publicado", "em_execucao", "concluido", "arquivado"];

export const INSTITUTIONAL_SCENARIOS: readonly InstitutionalScenario[] = [
  { id: "pregao", name: "Pregão (processo completo)", objects: FULL_FLOW, roles: [...CORE_ROLES, "equipe_apoio"], events: ["solicitacao", "recebimento", "publicacao", "sessao", "assinatura", "vigencia"], states: CORE_STATES },
  { id: "concorrencia", name: "Concorrência", objects: FULL_FLOW, roles: [...CORE_ROLES, "comissao"], events: ["solicitacao", "publicacao", "sessao", "assinatura"], states: CORE_STATES },
  { id: "dispensa", name: "Dispensa", objects: ["contratacao_direta", "dfd", "pesquisa_precos", "parecer", "contrato"], roles: ["solicitante", "departamento_licitacoes", "agente_contratacao", "assessoria_juridica", "autoridade_competente", "gestor_contrato"], events: ["solicitacao", "publicacao", "assinatura"], states: ["em_elaboracao", "publicado", "em_execucao", "concluido"] },
  { id: "inexigibilidade", name: "Inexigibilidade", objects: ["contratacao_direta", "dfd", "parecer", "contrato"], roles: ["solicitante", "departamento_licitacoes", "assessoria_juridica", "prefeito", "gestor_contrato"], events: ["solicitacao", "publicacao", "assinatura"], states: ["em_elaboracao", "publicado", "em_execucao"] },
  { id: "credenciamento", name: "Credenciamento", objects: ["processo", "edital", "aviso", "publicacao", "contrato"], roles: ["departamento_licitacoes", "agente_contratacao", "autoridade_competente", "fornecedor"], events: ["publicacao", "assinatura"], states: ["publicado", "em_execucao"] },
  { id: "registro_precos", name: "Registro de Preços (Ata)", objects: ["processo", "edital", "sessao", "ata", "contrato"], roles: ["departamento_licitacoes", "agente_contratacao", "autoridade_competente", "fornecedor", "gestor_contrato"], events: ["publicacao", "sessao", "assinatura"], states: ["publicado", "em_execucao"] },
  { id: "contrato", name: "Contrato + instrumentos", objects: ["processo", "contrato", "aditivo", "apostilamento", "empenho"], roles: ["gestor_contrato", "fiscal_contrato", "fornecedor", "autoridade_competente"], events: ["assinatura", "vigencia", "vencimento"], states: ["em_execucao", "suspenso", "concluido"] },
  { id: "convenio", name: "Convênio (instrumento contratual)", objects: ["processo", "contrato"], roles: ["departamento_licitacoes", "autoridade_competente", "gestor_contrato"], events: ["assinatura", "vigencia"], states: ["em_execucao", "concluido"] },
  { id: "aditivo", name: "Aditivo", objects: ["contrato", "aditivo"], roles: ["gestor_contrato", "autoridade_competente"], events: ["renovacao"], states: ["em_execucao"] },
  { id: "apostilamento", name: "Apostilamento", objects: ["contrato", "apostilamento"], roles: ["gestor_contrato"], events: ["vigencia"], states: ["em_execucao"] },
  { id: "rescisao", name: "Rescisão", objects: ["contrato"], roles: ["gestor_contrato", "autoridade_competente"], events: ["rescisao"], states: ["em_execucao", "cancelado", "arquivado"] },
  { id: "fiscalizacao", name: "Fiscalização", objects: ["contrato", "evento"], roles: ["fiscal_contrato", "gestor_contrato"], events: ["vigencia"], states: ["em_execucao"] },
  { id: "encerramento", name: "Encerramento", objects: ["processo", "contrato"], roles: ["departamento_licitacoes", "gestor_contrato"], events: ["vencimento", "arquivamento"], states: ["concluido", "arquivado"] },
  { id: "contratacao_emergencial", name: "Contratação Emergencial", objects: ["contratacao_direta", "parecer", "contrato"], roles: ["solicitante", "assessoria_juridica", "autoridade_competente", "gestor_contrato"], events: ["solicitacao", "assinatura"], states: ["em_elaboracao", "em_execucao"] },
  { id: "processo_legado", name: "Processo Legado (dados parciais)", objects: ["processo", "contrato"], roles: ["departamento_licitacoes", "gestor_contrato"], events: ["recebimento", "arquivamento"], states: ["recebido", "em_execucao", "arquivado"] },
  { id: "processo_erp", name: "Processo iniciado no ERP", objects: ["processo", "evento", "contrato"], roles: ["departamento_licitacoes", "gestor_contrato"], events: ["recebimento", "assinatura"], states: ["recebido", "em_execucao"] },
  { id: "processo_licigov", name: "Processo iniciado no LiciGov", objects: FULL_FLOW, roles: CORE_ROLES, events: ["solicitacao", "recebimento", "publicacao", "sessao", "assinatura"], states: CORE_STATES },
  { id: "processo_parcial", name: "Processo parcialmente importado", objects: ["processo", "dfd", "edital", "contrato"], roles: ["departamento_licitacoes", "agente_contratacao", "gestor_contrato"], events: ["recebimento", "publicacao", "assinatura"], states: ["recebido", "publicado", "em_execucao"] },
  { id: "planejamento_demanda", name: "Planejamento da demanda", objects: ["processo", "dfd", "etp"], roles: ["solicitante", "secretario", "departamento_licitacoes"], events: ["solicitacao", "recebimento"], states: ["em_elaboracao", "em_revisao", "aguardando_aprovacao"] },
  { id: "controle_conformidade", name: "Controle de conformidade", objects: ["processo", "checklist"], roles: ["controle_interno", "departamento_licitacoes"], events: ["recebimento"], states: ["em_elaboracao", "concluido"] },
];

export const ALL_SCENARIO_IDS: string[] = INSTITUTIONAL_SCENARIOS.map(s => s.id);

export interface ScenarioValidation { readonly id: string; readonly representable: boolean; readonly missing: readonly string[]; }

/** Verifica se o cenário é representável APENAS com a ontologia existente. */
export function validateScenario(scenario: InstitutionalScenario): ScenarioValidation {
  const missing: string[] = [];
  for (const o of scenario.objects) if (!isInstitutionalObject(o)) missing.push(`object:${o}`);
  for (const r of scenario.roles) if (!isInstitutionalRole(r)) missing.push(`role:${r}`);
  for (const e of scenario.events) if (!isInstitutionalEvent(e)) missing.push(`event:${e}`);
  for (const s of scenario.states) if (!isInstitutionalState(s)) missing.push(`state:${s}`);
  return { id: scenario.id, representable: missing.length === 0, missing };
}

/** Valida todos os cenários oficiais. */
export function validateAllScenarios(): ScenarioValidation[] {
  return INSTITUTIONAL_SCENARIOS.map(validateScenario);
}

/** Cobertura da ontologia exercitada pelos cenários (objetos/papéis/eventos/estados únicos). */
export function scenarioCoverage(): { objects: number; roles: number; events: number; states: number } {
  const o = new Set<string>(), r = new Set<string>(), e = new Set<string>(), s = new Set<string>();
  for (const sc of INSTITUTIONAL_SCENARIOS) {
    sc.objects.forEach(x => o.add(x)); sc.roles.forEach(x => r.add(x));
    sc.events.forEach(x => e.add(x)); sc.states.forEach(x => s.add(x));
  }
  return { objects: o.size, roles: r.size, events: e.size, states: s.size };
}

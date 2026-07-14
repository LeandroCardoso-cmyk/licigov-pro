/**
 * FASE 5 — Centro de Operações: Dashboard e Painel de Acompanhamento (lógica pura)
 *
 * Funções puras que CONSOLIDAM (sem duplicar) dados vindos dos Business Domains —
 * processos, contratações diretas, contratos, pareceres, solicitações. Calculam os
 * indicadores operacionais (NUNCA financeiros) e a "Situação Geral" por cor.
 * Determinístico, replay-safe.
 */

/** Cores da Situação Geral do painel (substitui a planilha). */
export type SituationColor = "verde" | "amarelo" | "azul" | "vermelho" | "cinza";

export const SITUATION_MEANING: Record<SituationColor, string> = {
  verde: "Concluído",
  amarelo: "Em andamento",
  azul: "Evento futuro",
  vermelho: "Atrasado",
  cinza: "Não iniciado",
};

export interface ConsolidatedInput {
  readonly processes: ReadonlyArray<{ status: string; currentStage: string }>;
  readonly directProcurements: ReadonlyArray<{ status: string; currentStage: string }>;
  readonly contracts: ReadonlyArray<{ status: string }>;
  readonly legalOpinionsPending: number;
  readonly institutionalRequestsPending: number;
  readonly addendaCount: number;
  readonly contractsExpiringSoon: number;
  readonly pendingTasks: number;
}

export interface OperationalIndicators {
  readonly activeProcesses: number;
  readonly concludedProcesses: number;
  readonly legalOpinionsAwaiting: number;
  readonly activeContracts: number;
  readonly contractsExpiring: number;
  readonly addenda: number;
  readonly pendingTasks: number;
  readonly pendingRequests: number;
}

const CONCLUDED_PROCESS = new Set(["emitido", "arquivado", "concluido", "publicado"]);
const CONCLUDED_CONTRACT = new Set(["encerrado", "arquivado", "rescindido"]);

/** Indicadores operacionais consolidados. NUNCA inclui valores financeiros. */
export function computeIndicators(input: ConsolidatedInput): OperationalIndicators {
  const allProcesses = [...input.processes, ...input.directProcurements];
  const activeProcesses = allProcesses.filter(p => !CONCLUDED_PROCESS.has(p.status)).length;
  const concludedProcesses = allProcesses.filter(p => CONCLUDED_PROCESS.has(p.status)).length;
  const activeContracts = input.contracts.filter(c => !CONCLUDED_CONTRACT.has(c.status)).length;
  return {
    activeProcesses,
    concludedProcesses,
    legalOpinionsAwaiting: input.legalOpinionsPending,
    activeContracts,
    contractsExpiring: input.contractsExpiringSoon,
    addenda: input.addendaCount,
    pendingTasks: input.pendingTasks,
    pendingRequests: input.institutionalRequestsPending,
  };
}

/** Marco do painel: status + data (ex.: parecer inicial enviado/recebido, publicação). */
export interface PanelMarker {
  readonly done: boolean;
  readonly date: string;
}

/**
 * Situação Geral de uma contratação (cor) a partir do estado consolidado. Regras:
 * atrasado > concluído > evento futuro > em andamento > não iniciado.
 */
export function situationColor(params: {
  overdue: boolean;
  concluded: boolean;
  hasFutureEvent: boolean;
  started: boolean;
}): SituationColor {
  if (params.overdue) return "vermelho";
  if (params.concluded) return "verde";
  if (params.hasFutureEvent) return "azul";
  if (params.started) return "amarelo";
  return "cinza";
}

/** Linha do Painel de Acompanhamento (versão inteligente da planilha). */
export interface MonitoringRow {
  readonly processId: string;
  readonly processNumber: string;
  readonly object: string;
  readonly modality: string;
  readonly currentStage: string;
  readonly origin: string;
  readonly situation: SituationColor;
}

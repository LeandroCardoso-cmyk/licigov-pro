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
  /** Registros operacionais ATIVOS (concluídos no ciclo de vida ficam fora das superfícies ativas). */
  readonly operationalRecords?: ReadonlyArray<{ currentStage: string }>;
  /** Registros concluídos no ciclo de vida operacional (histórico; métrica separada). */
  readonly completedOperationalRecords?: number;
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
  /** Registros legados/manuais, separados das métricas canônicas para não contar duas vezes. */
  readonly trackedRecords: number;
  readonly finalizedRecords: number;
  readonly completedRecords: number;
}

import { isFinalizedOperationRecord } from "./operationRecordSchedule";
import { addIsoDays, CONTRACT_EXPIRING_WINDOW_DAYS } from "@shared/operationalIndicators";

// R9 / SEM-070 — classificação ÚNICA do status de processo/contratação direta.
// "Concluído" é o status REAL de conclusão: `emitido` (processo licitatório, etapa ISSUED) e `concluido`
// (contratação direta, etapa CONTRACT). `arquivado` NÃO é conclusão (fica fora de ativos e de concluídos) e
// `publicado` (mera ENTRADA na etapa PUBLICATION da contratação direta) continua ATIVO.
const CONCLUDED_PROCESS_STATUSES = new Set(["emitido", "concluido"]);
const ARCHIVED_PROCESS_STATUSES = new Set(["arquivado"]);

/** Status de contrato que encerram a vigência (fora de "Contratos ativos" e de "Contratos vencendo"). */
export const ENDED_CONTRACT_STATUSES: readonly string[] = ["encerrado", "rescindido", "arquivado"];
const CONCLUDED_CONTRACT = new Set(ENDED_CONTRACT_STATUSES);

export type ProcessSituationClass = "ativo" | "concluido" | "arquivado";

/** R9 / SEM-070 — ativo × concluído (status real) × arquivado (fora das duas métricas). */
export function classifyProcessStatus(status: string): ProcessSituationClass {
  if (CONCLUDED_PROCESS_STATUSES.has(status)) return "concluido";
  if (ARCHIVED_PROCESS_STATUSES.has(status)) return "arquivado";
  return "ativo";
}

/** R9 / SEM-070 — janela documentada de "Contratos vencendo": [hoje, hoje + 30 dias]. */
export function contractExpiringWindow(today: string): { from: string; to: string } {
  return { from: today, to: addIsoDays(today, CONTRACT_EXPIRING_WINDOW_DAYS) };
}

/**
 * R9 / SEM-070 — "Atrasado" de um registro operacional: a agenda (data final, ou a data do evento quando não
 * há data final) já passou e o registro não está finalizado. Sem agenda ⇒ nunca atrasado (sem sinal inventado).
 */
export function isOperationRecordOverdue(record: { currentStage: string; eventDate: string; eventEndDate: string }, today: string): boolean {
  if (!record.eventDate) return false;
  if (isFinalizedOperationRecord(record.currentStage)) return false;
  return (record.eventEndDate || record.eventDate) < today;
}

/** Contagem agregada por chave (resultado de GROUP BY no banco). */
export interface KeyCount {
  readonly key: string;
  readonly count: number;
}

/**
 * R9 / SEM-070 — entrada AGREGADA (SQL COUNT/GROUP BY por tenant) dos indicadores. Substitui a contagem em
 * memória sobre listas truncadas por `limit` (200/500): cada número é exato para o órgão inteiro.
 */
export interface ConsolidatedCounts {
  readonly processesByStatus: ReadonlyArray<KeyCount>;
  readonly directProcurementsByStatus: ReadonlyArray<KeyCount>;
  readonly contractsByStatus: ReadonlyArray<KeyCount>;
  readonly legalOpinionsPending: number;
  readonly institutionalRequestsPending: number;
  readonly addendaCount: number;
  readonly contractsExpiringSoon: number;
  readonly pendingTasks: number;
  /** Registros operacionais ATIVOS agrupados por etapa (finalizado = regra pura sobre a etapa). */
  readonly activeRecordsByStage?: ReadonlyArray<KeyCount>;
  readonly completedOperationalRecords?: number;
}

function sumWhere(rows: ReadonlyArray<KeyCount>, predicate: (key: string) => boolean): number {
  return rows.reduce((n, r) => (predicate(r.key) ? n + r.count : n), 0);
}

/** R9 / SEM-070 — indicadores a partir das contagens agregadas. NUNCA inclui valores financeiros. */
export function computeIndicatorsFromCounts(input: ConsolidatedCounts): OperationalIndicators {
  const processRows = [...input.processesByStatus, ...input.directProcurementsByStatus];
  const records = input.activeRecordsByStage ?? [];
  return {
    activeProcesses: sumWhere(processRows, s => classifyProcessStatus(s) === "ativo"),
    concludedProcesses: sumWhere(processRows, s => classifyProcessStatus(s) === "concluido"),
    legalOpinionsAwaiting: input.legalOpinionsPending,
    activeContracts: sumWhere(input.contractsByStatus, s => !CONCLUDED_CONTRACT.has(s)),
    contractsExpiring: input.contractsExpiringSoon,
    addenda: input.addendaCount,
    pendingTasks: input.pendingTasks,
    pendingRequests: input.institutionalRequestsPending,
    trackedRecords: sumWhere(records, () => true),
    finalizedRecords: sumWhere(records, s => isFinalizedOperationRecord(s)),
    completedRecords: input.completedOperationalRecords ?? 0,
  };
}

function countBy<T>(items: ReadonlyArray<T>, key: (item: T) => string): KeyCount[] {
  const map = new Map<string, number>();
  for (const item of items) map.set(key(item), (map.get(key(item)) ?? 0) + 1);
  return [...map.entries()].map(([k, count]) => ({ key: k, count }));
}

/** Indicadores operacionais consolidados a partir de listas (adaptador puro de `computeIndicatorsFromCounts`). */
export function computeIndicators(input: ConsolidatedInput): OperationalIndicators {
  return computeIndicatorsFromCounts({
    processesByStatus: countBy(input.processes, p => p.status),
    directProcurementsByStatus: countBy(input.directProcurements, p => p.status),
    contractsByStatus: countBy(input.contracts, c => c.status),
    legalOpinionsPending: input.legalOpinionsPending,
    institutionalRequestsPending: input.institutionalRequestsPending,
    addendaCount: input.addendaCount,
    contractsExpiringSoon: input.contractsExpiringSoon,
    pendingTasks: input.pendingTasks,
    activeRecordsByStage: countBy(input.operationalRecords ?? [], r => r.currentStage),
    completedOperationalRecords: input.completedOperationalRecords,
  });
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
  readonly eventDate?: string;
  readonly eventEndDate?: string;
  readonly eventTime?: string;
}

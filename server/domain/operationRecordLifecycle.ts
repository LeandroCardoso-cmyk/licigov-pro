/**
 * Ciclo de vida OPERACIONAL do registro do Centro de Operações (active ⇄ completed).
 *
 * Concluir é uma TRANSIÇÃO de estado auditável — nunca exclusão: o registro, sua agenda, os eventos
 * vinculados (certame, aditivo, homologação…) e a timeline permanecem persistidos. A agenda BASE de um
 * registro concluído apenas deixa as superfícies operacionais ativas (Visão Geral, Painel, Calendário).
 * Eventos vinculados seguem o próprio ciclo de vida. Nada aqui altera processos canônicos, nem a etapa
 * textual do registro (ex.: "Finalizado" vindo do cronograma), que é informação distinta.
 */

export type OperationRecordLifecycle = "active" | "completed";

export const OPERATION_RECORD_LIFECYCLES: readonly OperationRecordLifecycle[] = ["active", "completed"];

/** Valor persistido desconhecido/vazio é tratado como ativo (compatível com linhas anteriores à 0309). */
export function normalizeLifecycle(value: string | null | undefined): OperationRecordLifecycle {
  return value === "completed" ? "completed" : "active";
}

export function isActiveOperationRecord(record: { lifecycleStatus?: string | null }): boolean {
  return normalizeLifecycle(record.lifecycleStatus) === "active";
}

export type LifecycleAction = "complete" | "reopen";

export const LIFECYCLE_TARGET: Record<LifecycleAction, OperationRecordLifecycle> = { complete: "completed", reopen: "active" };

export type LifecycleTransitionPlan =
  | { kind: "transition"; from: OperationRecordLifecycle; to: OperationRecordLifecycle }
  /** Já está no estado pedido: nenhuma escrita, nenhuma entrada nova de timeline (idempotente). */
  | { kind: "noop"; state: OperationRecordLifecycle };

export function planLifecycleTransition(current: string | null | undefined, action: LifecycleAction): LifecycleTransitionPlan {
  const from = normalizeLifecycle(current);
  const to = LIFECYCLE_TARGET[action];
  return from === to ? { kind: "noop", state: from } : { kind: "transition", from, to };
}

export const LIFECYCLE_LABEL: Record<OperationRecordLifecycle, string> = { active: "ativo", completed: "concluído" };

export const LIFECYCLE_TIMELINE_ACTION: Record<LifecycleAction, string> = {
  complete: "registro_concluido",
  reopen: "registro_reaberto",
};

/** Resumo da timeline (sem conteúdo sensível): estado anterior → posterior e motivo, se houver. */
export function lifecycleTimelineSummary(from: OperationRecordLifecycle, to: OperationRecordLifecycle, reason: string): string {
  const base = `Registro operacional ${to === "completed" ? "concluído" : "reaberto"} (estado ${LIFECYCLE_LABEL[from]} → ${LIFECYCLE_LABEL[to]}).`;
  return reason ? `${base} Motivo: ${reason}` : base;
}

export const COMPLETION_REASON_MAX = 500;

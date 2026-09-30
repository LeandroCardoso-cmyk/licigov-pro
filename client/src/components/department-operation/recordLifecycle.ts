/**
 * Ciclo de vida operacional do registro no cliente (puro/testável). O servidor é a autoridade:
 * concluir/reabrir são transições auditadas — nunca exclusão.
 */
export type RecordLifecycle = "active" | "completed";
export type RecordLifecycleFilter = RecordLifecycle | "all";

export const LIFECYCLE_FILTERS: Array<{ key: RecordLifecycleFilter; label: string }> = [
  { key: "active", label: "Ativos" },
  { key: "completed", label: "Concluídos" },
  { key: "all", label: "Todos" },
];

export type RecordAction = "schedule" | "addEvent" | "complete" | "reopen";

/** Ações disponíveis por estado: ativo → agenda, evento, concluir; concluído → reabrir. */
export function recordActions(lifecycle: RecordLifecycle | undefined): RecordAction[] {
  return lifecycle === "completed" ? ["reopen"] : ["schedule", "addEvent", "complete"];
}

export const LIFECYCLE_CONFIRM: Record<"complete" | "reopen", { title: string; description: string; confirm: string }> = {
  complete: {
    title: "Concluir este registro operacional?",
    description: "Ele deixará de aparecer nas visões operacionais e no calendário, mas continuará disponível no histórico. Nenhum dado será excluído.",
    confirm: "Concluir registro",
  },
  reopen: {
    title: "Reabrir este registro operacional?",
    description: "Ele voltará a aparecer nas visões operacionais e sua agenda voltará ao calendário. Nada será recriado ou duplicado.",
    confirm: "Reabrir registro",
  },
};

export const EMPTY_LIST_MESSAGE: Record<RecordLifecycleFilter, string> = {
  active: "Nenhum registro ativo.",
  completed: "Nenhum registro concluído.",
  all: "Nenhum registro cadastrado.",
};

/**
 * R9 / SEM-071 — Autoridade ÚNICA de prazo das tarefas da Gestão do Departamento.
 *
 * Antes havia três definições de "Atrasada" (KPI calculado pelo prazo × status manual `atrasada` ×
 * Excel/PDF olhando só o status) e as cores de prazo divergiam da regra documentada. Este módulo é a
 * ÚNICA fonte: KPI, lista/badges, calendário, Excel/PDF, estatísticas e notificações do servidor usam
 * estas funções puras (cliente e servidor importam `@shared/taskDeadline`).
 *
 * Regra de "Atrasada" (isTaskOverdue):
 *  - tarefa ENCERRADA (`concluida` | `cancelada`) nunca está atrasada;
 *  - caso contrário, está atrasada se o prazo (instante) já passou OU se um humano a marcou
 *    explicitamente com o status `atrasada` (sinal humano preservado, nunca ocultado).
 *
 * Regra de cor do prazo (taskDeadlineBucket) — CLAUDE.md "Indicadores visuais de prazo":
 *  - vermelho: atrasada (regra acima);
 *  - laranja:  vence em até 3 dias (inclui "vence hoje, ainda não venceu");
 *  - amarelo:  vence em mais de 3 e até 7 dias;
 *  - verde:    vence em mais de 7 dias;
 *  - sem_prazo / encerrada: sem cor de urgência.
 * Fronteiras: exatamente 3 dias ⇒ laranja; exatamente 7 dias ⇒ amarelo (diferença em milissegundos).
 */

export const TASK_TERMINAL_STATUSES = ["concluida", "cancelada"] as const;

/** Status manual que um humano usa para declarar a tarefa atrasada (preservado como sinal). */
export const TASK_MANUAL_OVERDUE_STATUS = "atrasada" as const;

/** Limiares (em dias) da regra documentada de cores de prazo. */
export const TASK_DEADLINE_ORANGE_MAX_DAYS = 3;
export const TASK_DEADLINE_YELLOW_MAX_DAYS = 7;

const DAY_MS = 24 * 60 * 60 * 1000;

export interface TaskDeadlineInput {
  readonly status: string;
  readonly deadline: Date | string | null | undefined;
}

export type TaskDeadlineBucket = "vermelho" | "laranja" | "amarelo" | "verde" | "sem_prazo" | "encerrada";

export const TASK_DEADLINE_BUCKET_LABELS: Record<TaskDeadlineBucket, string> = {
  vermelho: "Atrasada",
  laranja: "Vence em até 3 dias",
  amarelo: "Vence em 3 a 7 dias",
  verde: "Mais de 7 dias",
  sem_prazo: "Sem prazo",
  encerrada: "Encerrada",
};

export function isTaskTerminal(status: string): boolean {
  return (TASK_TERMINAL_STATUSES as readonly string[]).includes(status);
}

/** Instante do prazo em ms; prazo ausente ou inválido ⇒ null (nunca inventa atraso). */
function deadlineTime(deadline: TaskDeadlineInput["deadline"]): number | null {
  if (deadline === null || deadline === undefined || deadline === "") return null;
  const time = deadline instanceof Date ? deadline.getTime() : new Date(deadline).getTime();
  return Number.isNaN(time) ? null : time;
}

/** R9 / SEM-071 — definição ÚNICA de "Atrasada". */
export function isTaskOverdue(task: TaskDeadlineInput, now: Date): boolean {
  if (isTaskTerminal(task.status)) return false;
  if (task.status === TASK_MANUAL_OVERDUE_STATUS) return true;
  const time = deadlineTime(task.deadline);
  return time !== null && time < now.getTime();
}

/** R9 / SEM-071 — faixa ÚNICA de cor do prazo (regra documentada verde/amarelo/laranja/vermelho). */
export function taskDeadlineBucket(task: TaskDeadlineInput, now: Date): TaskDeadlineBucket {
  if (isTaskTerminal(task.status)) return "encerrada";
  if (isTaskOverdue(task, now)) return "vermelho";
  const time = deadlineTime(task.deadline);
  if (time === null) return "sem_prazo";
  const daysLeft = (time - now.getTime()) / DAY_MS;
  if (daysLeft <= TASK_DEADLINE_ORANGE_MAX_DAYS) return "laranja";
  if (daysLeft <= TASK_DEADLINE_YELLOW_MAX_DAYS) return "amarelo";
  return "verde";
}

/** Contagem de tarefas atrasadas com a regra única (KPI, PDF, estatísticas). */
export function countOverdueTasks(tasks: ReadonlyArray<TaskDeadlineInput>, now: Date): number {
  return tasks.reduce((n, t) => (isTaskOverdue(t, now) ? n + 1 : n), 0);
}

import type { TaskDeadlineBucket } from "@shared/taskDeadline";

/**
 * R9 / SEM-071 — classes visuais da faixa ÚNICA de prazo (shared/taskDeadline.ts), conforme a regra
 * documentada: verde >7d, amarelo 3–7d, laranja ≤3d, vermelho atrasada. Usada pela lista e pelo Kanban
 * (antes cada um tinha 5 faixas próprias: ≤2d vermelho, ≤7d laranja, ≤15d amarelo).
 */
export const DEADLINE_BUCKET_CLASSES: Record<TaskDeadlineBucket, string> = {
  vermelho: "text-red-600 dark:text-red-400 font-bold",
  laranja: "text-orange-600 dark:text-orange-400",
  amarelo: "text-yellow-600 dark:text-yellow-400",
  verde: "text-green-600 dark:text-green-400",
  sem_prazo: "text-muted-foreground",
  encerrada: "text-muted-foreground",
};

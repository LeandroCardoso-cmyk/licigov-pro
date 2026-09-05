/**
 * Linguagem CANÔNICA de status institucional do LiciGov Pro (V1 Visual Refinement).
 *
 * A MESMA semântica deve ter a MESMA representação em todos os módulos. Em vez de
 * cada domínio inventar sua combinação de cores, mapeia-se o estado para um TOM
 * institucional, com variantes light/dark coerentes (theme-aware) e cores funcionais
 * preservando significado. Não introduz cor nova nem paleta por módulo.
 *
 * Tons:
 *  - neutral   → estados neutros/não iniciados (Pendente, Não iniciado, Rascunho)
 *  - info      → em curso/informativo (Em análise, Em elaboração, Em revisão, Gerado)
 *  - success   → positivo/consolidado (Assinado, Emitido, Ratificado, Concluído, Ativo)
 *  - warning   → atenção (Vencendo, Aguardando, Pausada)
 *  - danger    → negativo/bloqueio (Não ratificado, Bloqueado, Vencido, Cancelado)
 *  - priority  → prioridade alta/urgente
 *  - cognitive → camada de apoio cognitivo (reasoning/explainability)
 */

export type StatusTone =
  | "neutral" | "info" | "success" | "warning" | "danger" | "priority" | "cognitive";

/** Classes de um badge/chip para o tom — theme-aware (light + dark). */
export const STATUS_TONE_CLASSES: Record<StatusTone, string> = {
  neutral: "bg-muted text-muted-foreground",
  info: "bg-blue-100 dark:bg-blue-950 text-blue-700 dark:text-blue-300",
  success: "bg-green-100 dark:bg-green-950 text-green-700 dark:text-green-300",
  warning: "bg-amber-100 dark:bg-amber-950 text-amber-800 dark:text-amber-200",
  danger: "bg-red-100 dark:bg-red-950 text-red-700 dark:text-red-300",
  priority: "bg-orange-100 dark:bg-orange-950 text-orange-800 dark:text-orange-200",
  cognitive: "bg-indigo-100 dark:bg-indigo-950 text-indigo-700 dark:text-indigo-300",
};

/** Retorna as classes do tom institucional. */
export function statusTone(tone: StatusTone): string {
  return STATUS_TONE_CLASSES[tone];
}

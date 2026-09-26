/**
 * R1 / PR-01A (NEW-001) — regra de replay da atribuição de responsável por etapa (legado `stage_assignments`).
 *
 * `stage_assignments` NÃO tem chave única em (processId, docType): o antigo "upsert" (onDuplicateKeyUpdate) nunca
 * colidia e cada chamada INSERIA uma nova linha — um retry duplicava a atribuição. O estado da etapa é, por
 * contrato, UMA atribuição (a UI lê `find(docType)`), então a decisão é determinística sobre TODAS as linhas da
 * chave (inclusive duplicatas históricas):
 *
 *  - nenhuma linha                                   ⇒ `insert` (1 linha nova);
 *  - todas as linhas já expressam o estado pedido    ⇒ `unchanged` (sucesso idempotente: sem notificação/log);
 *  - qualquer divergência (usuário ou nota)          ⇒ `update` (TODAS as linhas da chave convergem ao pedido).
 *
 * `assignedBy` não faz parte da intenção (quem repete a mesma atribuição não a altera). Nota ausente, `null` e
 * string vazia são equivalentes (o router sempre persistiu `note || null`). Pura: sem I/O.
 */

export interface StageAssignmentState {
  assignedUserId: number;
  note: string | null;
}

export type StageAssignmentDecision = "insert" | "update" | "unchanged";

export function normalizeStageNote(note: string | null | undefined): string | null {
  return note ? note : null;
}

export function decideStageAssignment(
  current: readonly StageAssignmentState[],
  requested: StageAssignmentState,
): StageAssignmentDecision {
  if (current.length === 0) return "insert";
  const wanted = normalizeStageNote(requested.note);
  const same = current.every(
    (row) => row.assignedUserId === requested.assignedUserId && normalizeStageNote(row.note) === wanted,
  );
  return same ? "unchanged" : "update";
}
